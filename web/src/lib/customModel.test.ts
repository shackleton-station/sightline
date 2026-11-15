/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { CustomMeta } from '../data/contract'
import {
  accuracyAt,
  computeSite,
  type CustomAssets,
  decodeTile,
  enuBasis,
  loadTiles,
  modelFlags,
  modelMonths,
  monthSummary,
  monthTrack,
  nearResolutionM,
  parseCoordinate,
  requiredTiles,
  slopeAt,
  Terrain,
  type TileStore,
  visibleFraction,
  yearSummary,
} from './customModel'

const dataFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../public/data/custom/${name}`, import.meta.url)))

const arrayBuffer = (buffer: Buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

const fixtureFile = JSON.parse(dataFile('fixture.json').toString()) as { start: string; hours: number; years: number[]; points: FixtureSite[] }
// The model is computed over the fixture's own years, as the app computes it over the years a page shows.
const meta = { ...(JSON.parse(dataFile('meta.json').toString()) as CustomMeta), start: fixtureFile.start, hours: fixtureFile.hours }
const north = new Int16Array(arrayBuffer(dataFile('terrain-north.bin')))
const south = new Int16Array(arrayBuffer(dataFile('terrain-south.bin')))
const terrain = new Int16Array(north.length + south.length)
terrain.set(north)
terrain.set(south, north.length)
const assets: CustomAssets = {
  meta,
  terrain,
  polarFar: decodeTile(
    arrayBuffer(gunzipSync(dataFile('polar-far.bin.gz'))),
    meta.polar.far_size,
  ),
  positions: new Float32Array(
    arrayBuffer(Buffer.concat(fixtureFile.years.map((year) => dataFile(`ephemeris-${year}.bin`)))),
  ),
}

/** Tiles from a full local build if there is one, otherwise the small set committed for CI. */
const tileDirs = ['../../public/tiles/', './test-tiles/'].map((dir) =>
  fileURLToPath(new URL(dir, import.meta.url)),
)
const tilePath = (name: string) =>
  tileDirs.map((dir) => `${dir}${name}.bin.gz`).find((path) => existsSync(path))
const readTile = async (name: string) => {
  const path = tilePath(name)
  if (!path) throw new Error(`no tile ${name}`)
  return arrayBuffer(gunzipSync(readFileSync(path)))
}
const hasTiles = (lat: number, lon: number) =>
  requiredTiles(meta, lat, lon).every((name) => tilePath(name) !== undefined)

interface FixtureSite {
  id: string
  lat: number
  lon: number
  height_m: number
  mask_el: number[]
  pct_sun: number
  pct_earth: number
  pct_earth_above: Record<string, number>
  slope_20m_deg: number
  hour: number
  sun_az: number
  sun_el: number
  earth_az: number
  earth_el: number
}
const fixture = fixtureFile.points

const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

const FIXTURE_IN_CI = ['connecting-ridge', 'seam', 'polar-edge']

describe('browser model vs Python, same terrain', () => {
  const available = fixture.filter((site) => hasTiles(site.lat, site.lon))

  it('always covers the points committed for CI', () => {
    expect(available.map((site) => site.id)).toEqual(expect.arrayContaining(FIXTURE_IN_CI))
  })

  it.each(available.map((site) => [site.id, site] as const))('%s', async (_id, site) => {
    const tiles: TileStore = new Map()
    await loadTiles(meta, site.lat, site.lon, tiles, readTile)
    const model = computeSite(assets, tiles, site.lat, site.lon)
    expect(model.heightM).toBeCloseTo(site.height_m, 2)
    site.mask_el.forEach((el, i) => {
      expect(Math.abs(model.horizon[i * 60].el - el)).toBeLessThan(0.001)
    })
    const i = site.hour
    expect(azDiff(model.sunAz[i], site.sun_az)).toBeLessThan(0.02)
    expect(Math.abs(model.sunEl[i] - site.sun_el)).toBeLessThan(0.02)
    expect(azDiff(model.earthAz[i], site.earth_az)).toBeLessThan(0.02)
    expect(Math.abs(model.earthEl[i] - site.earth_el)).toBeLessThan(0.02)
    const share = (frac: Float64Array) => (100 * frac.filter((f) => f > 0).length) / frac.length
    expect(Math.abs(share(model.sunFrac) - site.pct_sun)).toBeLessThan(0.1)
    expect(Math.abs(share(model.earthFrac) - site.pct_earth)).toBeLessThan(0.1)
    const { earthAbove } = modelFlags(model)
    expect(Object.keys(earthAbove).sort()).toEqual(Object.keys(site.pct_earth_above).sort())
    for (const [degrees, expected] of Object.entries(site.pct_earth_above)) {
      const up = earthAbove[degrees]
      expect(Math.abs((100 * up.filter(Boolean).length) / up.length - expected)).toBeLessThan(0.1)
    }
    const slope = slopeAt(new Terrain(assets, tiles), site.lat, site.lon, 20)
    expect(Math.abs(slope - site.slope_20m_deg)).toBeLessThan(0.1)
  })
})

describe('summaries from the model', () => {
  const site = fixture.find((point) => point.id === 'seam') as FixtureSite
  const modelOf = async () => {
    const tiles: TileStore = new Map()
    await loadTiles(meta, site.lat, site.lon, tiles, readTile)
    return computeSite(assets, tiles, site.lat, site.lon)
  }

  it('covers each month of the year in order', async () => {
    const model = await modelOf()
    expect(modelMonths(model)).toHaveLength(48)
    expect(modelMonths(model)[4]).toBe('2027-05')
    expect(modelMonths(model)[47]).toBe('2030-12')
    // A leap year, to check hours are counted across years.
    expect(monthTrack(model, '2028-02')).toHaveLength(29 * 24)
    expect(monthTrack(model, '2028-02')[0].t).toBe('2028-02-01T00:00:00Z')
    expect(monthTrack(model, '2027-05')).toHaveLength(31 * 24)
    expect(monthTrack(model, '2027-02')).toHaveLength(28 * 24)
  })

  it('builds a month summary consistent with its track', async () => {
    const model = await modelOf()
    const track = monthTrack(model, '2027-05')
    const summary = monthSummary(model, '2027-05', 2)
    const up = track.filter((p) => p.sun_up).length
    expect(summary.pct_sun).toBeCloseTo((100 * up) / track.length, 1)
    expect(summary.pct_earth).toBe(100)
    expect(summary.max_earth_gap_h).toBe(0)
    const windowHours = summary.sun_windows.reduce(
      (sum, w) => sum + (Date.parse(w.end) - Date.parse(w.start)) / 3_600_000,
      0,
    )
    expect(windowHours).toBe(up)
    expect(summary.range).toEqual({
      start: '2027-05-01T00:00:00Z',
      end: '2027-06-01T00:00:00Z',
      step_h: 1,
    })
    expect(summary.earth_windows).toEqual([
      { start: '2027-05-01T00:00:00Z', end: '2027-06-01T00:00:00Z' },
    ])
  })

  it('builds a year summary', async () => {
    const year = yearSummary(await modelOf(), '2027-05')
    expect(year.months).toHaveLength(48)
    expect(year.default_month).toBe('2027-05')
    expect(year.years.map((row) => row.year)).toEqual([2027, 2028, 2029, 2030])
    expect(year.years[0].pct_earth).toBe(100)
    expect(year.years[3].max_sun_gap_h).toBeGreaterThan(300)
  })

  it('gives flags for every hour, matching the monthly summaries', async () => {
    const model = await modelOf()
    const { start, sun, earth } = modelFlags(model)
    expect(start).toBe('2027-01-01T00:00:00Z')
    expect(sun).toHaveLength(meta.hours)
    expect(earth.every(Boolean)).toBe(true)
    const summary = monthSummary(model, '2029-03', 2)
    const from = (Date.parse(summary.range.start) - Date.parse(start)) / 3_600_000
    const up = sun.slice(from, from + 31 * 24).filter(Boolean).length
    expect(summary.pct_sun).toBeCloseTo((100 * up) / (31 * 24), 1)
  })
})

describe('requiredTiles', () => {
  it('needs only polar tiles well inside the polar map', () => {
    const names = requiredTiles(meta, -89.45, -137.15)
    expect(names.length).toBeGreaterThan(0)
    expect(names.length).toBeLessThanOrEqual(4)
    expect(names.every((name) => name.startsWith('polar/'))).toBe(true)
  })

  it('needs only global tiles away from the pole', () => {
    const names = requiredTiles(meta, 20, 30)
    expect(names.length).toBeLessThanOrEqual(9)
    expect(names.every((name) => name.startsWith('global/'))).toBe(true)
  })

  it('wraps across the 0° longitude seam', () => {
    const names = requiredTiles(meta, 5, 0.4)
    const cols = new Set(names.map((name) => Number(name.split('_')[1])))
    expect(cols.has(0)).toBe(true)
    expect(cols.has(71)).toBe(true)
  })

  it('takes every longitude next to the north pole', () => {
    const cols = new Set(requiredTiles(meta, 89.8, 10).map((name) => name.split('_')[1]))
    expect(cols.size).toBe(72)
  })

  it('uses both kinds at the edge of the polar map', () => {
    const names = requiredTiles(meta, -79.5, 120)
    expect(names.some((name) => name.startsWith('global/'))).toBe(true)
  })
})

describe('decodeTile', () => {
  it('undoes the delta coding, with 16-bit wrap-around', () => {
    const encoded = Int16Array.from([0, 32000, 1536, 100, -32000, 5])
    const decoded = decodeTile(encoded.buffer, 3)
    expect(Array.from(decoded)).toEqual([0, 32000, -32000, 100, -31900, -31895])
  })
})

describe('geometry helpers', () => {
  it('points north toward the north pole and keeps a right-handed basis', () => {
    const { east, north: n, up } = enuBasis(10, 20)
    expect(n[2]).toBeGreaterThan(0)
    expect(east[2]).toBe(0)
    const cross = [
      east[1] * n[2] - east[2] * n[1],
      east[2] * n[0] - east[0] * n[2],
      east[0] * n[1] - east[1] * n[0],
    ]
    cross.forEach((value, i) => expect(value).toBeCloseTo(up[i], 10))
  })

  it('draws the same height the model uses', async () => {
    for (const site of fixture.filter((point) => hasTiles(point.lat, point.lon))) {
      const tiles: TileStore = new Map()
      await loadTiles(meta, site.lat, site.lon, tiles, readTile)
      expect(new Terrain(assets, tiles).surfaceHeight(site.lat, site.lon)).toBeCloseTo(site.height_m, 2)
    }
  })

  it('draws from coarser terrain where no fine tiles are loaded', () => {
    const empty = new Terrain(assets, new Map())
    expect(empty.surfaceHeight(10, 20)).toBeCloseTo(empty.coarse(10, 20), 6)
    // Inside the polar map, the 500 m grid comes before the global one.
    expect(empty.surfaceHeight(-89, 0)).toBeCloseTo(empty.heightAt(-89, 0, 100_000), 6)
  })

  it('asks for more tiles for a wider view, including all the usual ones', () => {
    const usual = requiredTiles(meta, -89, 0)
    const wide = requiredTiles(meta, -89, 0, 40_000)
    expect(wide.length).toBeGreaterThan(usual.length)
    expect(wide).toEqual(expect.arrayContaining(usual))
  })

  it('wraps longitude', () => {
    const coarse = new Terrain(assets, new Map())
    expect(coarse.coarse(10, -100)).toBeCloseTo(coarse.coarse(10, 260), 6)
  })

  it('computes disk fractions', () => {
    expect(visibleFraction(1, 0.27)).toBe(1)
    expect(visibleFraction(-1, 0.27)).toBe(0)
    expect(visibleFraction(0, 0.27)).toBeCloseTo(0.5, 10)
  })

  it('knows the terrain resolution near a point', () => {
    expect(nearResolutionM(meta, -89, 0)).toBe(20)
    expect(nearResolutionM(meta, 89, 0)).toBeCloseTo(237, 0)
    expect(nearResolutionM(meta, -60, 0)).toBeCloseTo(237, 0)
  })
})

describe('input limits', () => {
  it('finds the measured accuracy for a latitude', () => {
    expect(accuracyAt(meta.bands, meta.max_abs_lat, -12)?.max_abs_lat).toBe(30)
    expect(accuracyAt(meta.bands, meta.max_abs_lat, 89.5)?.max_abs_lat).toBe(90)
  })

  it('refuses only the poles themselves', () => {
    expect(accuracyAt(meta.bands, meta.max_abs_lat, -90)).toBeNull()
    expect(accuracyAt(meta.bands, meta.max_abs_lat, 89.99)).not.toBeNull()
  })

  it('parses coordinates and rejects bad input', () => {
    expect(parseCoordinate(' 12.5 ', -70, 70)).toBe(12.5)
    expect(parseCoordinate('-70', -70, 70)).toBe(-70)
    expect(parseCoordinate('71', -70, 70)).toBeNull()
    expect(parseCoordinate('', -70, 70)).toBeNull()
    expect(parseCoordinate('abc', -70, 70)).toBeNull()
    // The forms the app prints: a compass letter, a degree sign, a typographic minus.
    expect(parseCoordinate('89.5 S', -90, 90)).toBe(-89.5)
    expect(parseCoordinate('89.453°S', -90, 90)).toBe(-89.453)
    expect(parseCoordinate('12n', -90, 90)).toBe(12)
    expect(parseCoordinate('137.1 W', -180, 360)).toBe(-137.1)
    expect(parseCoordinate('40°E', -180, 360)).toBe(40)
    expect(parseCoordinate('\u221289.45', -90, 90)).toBe(-89.45)
    expect(parseCoordinate('-89.45°', -90, 90)).toBe(-89.45)
    // A latitude takes no E or W, a sign and a letter are not both read, and the limits still hold.
    expect(parseCoordinate('40 W', -90, 90)).toBeNull()
    expect(parseCoordinate('-89 S', -90, 90)).toBeNull()
    expect(parseCoordinate('91 S', -90, 90)).toBeNull()
    expect(parseCoordinate('S', -90, 90)).toBeNull()
  })
})
