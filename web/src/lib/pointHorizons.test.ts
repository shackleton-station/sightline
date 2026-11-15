/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { CustomMeta } from '../data/contract'
import { computeSite, decodeTile, horizonAt, horizonMask, loadTiles, modelFlags, polarLatLon, polarXY, slopeAt, Terrain, type TileStore } from './customModel'
import { marginsOf, pointLight, verdictAt } from './landingField'
import { missOf } from './landingOdds'
import { DEFAULT_MISSION, landingMiss, type SightlineMission } from './sightlineMission'
import { AZIMUTHS, blockReachM, groundHeightM, groundSlopeDeg, maskAt, pointHorizons, polarBlock, type PolarGround, reachesPolarMaps } from './pointHorizons'

const dataFile = (name: string) => readFileSync(fileURLToPath(new URL(`../../public/data/custom/${name}`, import.meta.url)))
const arrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

const meta = JSON.parse(dataFile('meta.json').toString()) as CustomMeta
const north = new Int16Array(arrayBuffer(dataFile('terrain-north.bin')))
const south = new Int16Array(arrayBuffer(dataFile('terrain-south.bin')))
const coarse = new Int16Array(north.length + south.length)
coarse.set(north)
coarse.set(south, north.length)
const polarFar = decodeTile(arrayBuffer(gunzipSync(dataFile('polar-far.bin.gz'))), meta.polar.far_size)

/** Tiles from a full local build if there is one, otherwise the small set committed for CI. */
const tileDirs = ['../../public/tiles/', './test-tiles/'].map((dir) => fileURLToPath(new URL(dir, import.meta.url)))
const readTile = async (name: string) => {
  const path = tileDirs.map((dir) => `${dir}${name}.bin.gz`).find((candidate) => existsSync(candidate))
  if (!path) throw new Error(`no tile ${name}`)
  return arrayBuffer(gunzipSync(readFileSync(path)))
}

// Connecting Ridge, whose tiles are committed for CI.
const SITE = { lat: -89.45267, lon: -137.14865 }
/** How far from the site the points tried are (m). */
const AROUND_M = 300

async function groundAround(): Promise<{ ground: PolarGround; terrain: Terrain; x: number; y: number }> {
  const tiles: TileStore = new Map()
  const reach = blockReachM(meta, AROUND_M)
  await loadTiles(meta, SITE.lat, SITE.lon, tiles, readTile, reach)
  const { x, y } = polarXY(SITE.lat, SITE.lon)
  const ground = { meta, polarFar, block: polarBlock(meta, tiles, x, y, reach) }
  return { ground, terrain: new Terrain({ meta, terrain: coarse, polarFar }, tiles), x, y }
}

describe('the fast horizon against the browser model', () => {
  // The site itself, and points up to 300 m off it in each direction.
  const offsets = [
    [0, 0],
    [AROUND_M, 0],
    [0, -AROUND_M],
    [-137, 211],
    [-AROUND_M, AROUND_M],
  ]

  it.each(offsets)('gives the same skyline %d m across and %d m up the map, at 2 m and at 10 m', async (dx, dy) => {
    const { ground, terrain, x, y } = await groundAround()
    const { lat, lon } = polarLatLon(x + dx, y + dy)
    const heightM = terrain.heightAt(lat, lon, 0)
    const fast = pointHorizons(ground, x + dx, y + dy, [2, 10])
    expect(fast.heightM).toBeCloseTo(heightM, 6)
    ;[2, 10].forEach((obs, h) => {
      const slow = horizonMask(terrain, lat, lon, heightM, obs)
      expect(slow).toHaveLength(AZIMUTHS)
      let worst = 0
      slow.forEach((ray, a) => {
        worst = Math.max(worst, Math.abs(ray.el - fast.masks[h][a]))
      })
      // A mask kept as 32-bit numbers holds a degree to about a ten-millionth.
      expect(worst).toBeLessThan(1e-6)
      expect(maskAt(fast.masks[h], 123.3)).toBeCloseTo(horizonAt(slow, 123.3), 5)
    })
  })

  it('sees farther over the skyline from higher up', async () => {
    const { ground, x, y } = await groundAround()
    const { masks } = pointHorizons(ground, x, y, [2, 10])
    for (let a = 0; a < AZIMUTHS; a += 1) expect(masks[1][a]).toBeLessThanOrEqual(masks[0][a])
  })

  it('reads the ground and its slope as the browser model does', async () => {
    const { ground, terrain, x, y } = await groundAround()
    for (const [dx, dy] of offsets) {
      const { lat, lon } = polarLatLon(x + dx, y + dy)
      expect(groundHeightM(ground, x + dx, y + dy)).toBeCloseTo(terrain.heightAt(lat, lon, 0), 6)
      expect(Math.abs(groundSlopeDeg(ground, x + dx, y + dy, 20) - slopeAt(terrain, lat, lon, 20))).toBeLessThan(0.01)
    }
  })
})

describe('where the fast horizon answers', () => {
  it('covers the ground near the pole and stops where a ray would leave the polar maps', () => {
    expect(reachesPolarMaps(meta, 0, 0, 4000)).toBe(true)
    expect(reachesPolarMaps(meta, 61_000, -61_000, 4000)).toBe(true)
    expect(reachesPolarMaps(meta, 110_000, 0, 0)).toBe(false)
    expect(reachesPolarMaps(meta, 0, -99_000, 4000)).toBe(false)
  })
})

describe('a landing point judged over a mission, against the browser model', () => {
  const fixture = JSON.parse(dataFile('fixture.json').toString()) as { start: string; hours: number; years: number[] }
  const positions = new Float32Array(arrayBuffer(Buffer.concat(fixture.years.map((year) => dataFile(`ephemeris-${year}.bin`)))))

  it('gives the verdict the full model gives at the same point, for a landing every 29 hours of the fixture’s years', { timeout: 60_000 }, async () => {
    const { ground, x, y } = await groundAround()
    const tiles: TileStore = new Map()
    await loadTiles(meta, SITE.lat, SITE.lon, tiles, readTile)
    const assets = { meta: { ...meta, start: fixture.start, hours: fixture.hours }, terrain: coarse, polarFar, positions }
    const flags = modelFlags(computeSite(assets, tiles, SITE.lat, SITE.lon))
    const { heightM, masks } = pointHorizons(ground, x, y, [2])
    const sky = { ...SITE, heightM, panelM: 2, antennaM: 2, sunMask: masks[0], earthMask: masks[0] }
    const missions: SightlineMission[] = [
      DEFAULT_MISSION,
      { ...DEFAULT_MISSION, requirements: { ...DEFAULT_MISSION.requirements, minEarthClearanceDeg: 2, maxEarthGapH: 48 } },
      { ...DEFAULT_MISSION, requirements: { ...DEFAULT_MISSION.requirements, missionDays: 30, maxSunGapH: 6, sunAtLanding: false } },
    ]
    let landings = 0
    for (const mission of missions) {
      const req = mission.requirements
      const hours = req.missionDays * 24
      for (let landing = 0; landing + hours <= fixture.hours; landing += 29) {
        const light = pointLight(sky, positions.subarray(landing * 6, (landing + hours) * 6), req.minEarthClearanceDeg)
        // One point all round: the lattice's reading at the target is this point's own.
        const lattice = { n: 3, stepM: 20 }
        const all = (value: number) => new Float32Array(9).fill(value)
        const field = { lattice, sunAtDeg: all(light.sunAtDeg), earthAtDeg: all(light.earthAtDeg), sunGapH: all(light.sunGapH), earthGapH: all(light.earthGapH), slope: lattice, slopeDeg: all(0) }
        const code = verdictAt(marginsOf(field, req, mission.maxSlopeDeg), 0, 0)
        const expected = landingMiss(flags, landing, mission, 0)
        expect(code === 0 ? null : missOf(code), `landing ${landing}`).toBe(expected)
        landings += 1
      }
    }
    expect(landings).toBeGreaterThan(3000)
  })
})
