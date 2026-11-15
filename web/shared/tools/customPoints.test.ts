import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { viewFacts } from '../../copilot/chat/chat'
import { scenarioScene } from '../../copilot/chat/scenarios'
import { viewFrom } from '../../copilot/chat/actions'
import type { CustomMeta } from '../../src/data/contract'
import { computeSite, type CustomAssets, decodeTile, loadTiles, modelFlags, type TileStore } from '../../src/lib/customModel'
import { hourOf } from '../../src/lib/mission'
import { measureScenario, readScenarioLink } from '../../src/lib/sightlineMission'
import type { Bucket } from '../bucket'
import { siteData } from './data'
import { runTool } from './tools'
import { DEFAULT_LIMITS } from './defaults'

// A custom point a few metres from Connecting Ridge: the committed test tiles cover it, so this runs in CI.
const POINT = '-89.45267,-137.14865'
const dataDir = fileURLToPath(new URL('../../public/data', import.meta.url))
const tileDirs = ['../../public/tiles/', '../../src/lib/test-tiles/'].map((dir) => fileURLToPath(new URL(dir, import.meta.url)))
const tilePath = (name: string) => tileDirs.map((dir) => `${dir}${name}.bin.gz`).find((path) => existsSync(path))

/** A bucket that holds only the terrain tiles, as the real one serves them. */
const bucket: Bucket = {
  async get(key) {
    const match = /^tiles\/((?:polar|global)\/\d+_\d+)\.bin\.gz$/.exec(key)
    const path = match ? tilePath(match[1]) : undefined
    if (!path) return null
    const body = readFileSync(path)
    return { status: 200, body: new Response(body).body, length: String(body.length), contentRange: null, etag: null }
  },
}
const data = siteData(dataDir, bucket)

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/** The point as the visitor's page works it out: the page's own code, over one span of years (here 2027 alone). */
async function pageModel() {
  const file = (name: string) => readFileSync(`${dataDir}/custom/${name}`)
  const year = 2027
  const start = `${year}-01-01T00:00:00Z`
  const positions = new Float32Array(arrayBuffer(file(`ephemeris-${year}.bin`)))
  const meta = { ...(JSON.parse(file('meta.json').toString()) as CustomMeta), start, hours: positions.length / 6 }
  const north = new Int16Array(arrayBuffer(file('terrain-north.bin')))
  const terrain = new Int16Array(meta.rows * meta.cols)
  terrain.set(north)
  terrain.set(new Int16Array(arrayBuffer(file('terrain-south.bin'))), north.length)
  const assets: CustomAssets = { meta, terrain, polarFar: decodeTile(arrayBuffer(gunzipSync(file('polar-far.bin.gz'))), meta.polar.far_size), positions }
  const tiles: TileStore = new Map()
  const [lat, lon] = POINT.split(',').map(Number)
  await loadTiles(meta, lat, lon, tiles, async (name) => arrayBuffer(gunzipSync(readFileSync(tilePath(name) as string))))
  return { start, flags: modelFlags(computeSite(assets, tiles, lat, lon)) }
}

describe('a custom point, worked out for the co-pilot', () => {
  it('is a site the tools can name, with the page\'s own name for it', async () => {
    const site = await data.site(POINT)
    expect(site).toMatchObject({ id: POINT, name: 'Custom point 89.453°S, 137.149°W', group: 'Custom' })
    expect(site?.slope?.deg).toBeGreaterThanOrEqual(0)
    // Not a custom point, and not a listed site.
    expect(await data.site('nowhere')).toBeNull()
  })

  it('has, hour for hour, the Sun and Earth the visitor\'s page works out', async () => {
    const page = await pageModel()
    const here = await data.flags(POINT)
    const from = hourOf(here.start, page.start)
    expect(here.sun.slice(from, from + page.flags.sun.length)).toEqual(page.flags.sun)
    expect(here.earth.slice(from, from + page.flags.earth.length)).toEqual(page.flags.earth)
    for (const degrees of Object.keys(page.flags.earthAbove)) {
      expect(here.earthAbove[degrees].slice(from, from + page.flags.sun.length)).toEqual(page.flags.earthAbove[degrees])
    }
    // At any height it is the same point, read at 2 m, as on the page.
    expect(await data.flagsAt(POINT, { panelM: 10, antennaM: 4 })).toBe(here)
  })

  it('gives Scout the figures of the page\'s Compare table for a scenario at a custom point', async () => {
    const link = `#a=${POINT}@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&sc=0`
    const scene = await scenarioScene(link, viewFrom(link), data)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('scenario_a')).toMatch(/^Custom point 89\.453°S, 137\.149°W, landing /)
    expect(value('scenario_a_figures')).toBeUndefined()

    const site = await data.site(POINT)
    const flags = await data.flags(POINT)
    const read = readScenarioLink(link, flags.start, flags.sun.length)
    if (!site || !read) throw new Error('the link or the point could not be read')
    const measure = measureScenario(read.scenarios[0], site, flags, read.mission, site.slope?.deg ?? null)
    expect(value('scenario_a_sunlit_share_of_mission')).toBe(`${(measure.sunPct as number).toFixed(0)}%`)
    expect(value('scenario_a_earth_in_view_share_of_mission')).toBe(`${(measure.earthPct as number).toFixed(0)}%`)
    expect(value('scenario_a_ground_slope')).toBe(`${(measure.slopeDeg as number).toFixed(1)}°`)
    expect(value('scenario_a_verdict_words')).toMatch(/^(Fits the mission|Fits, marginal|Does not fit the mission)$/)
  })

  it('is named in the view as itself, with the id the tools take, and no longer stood in for by the nearest listed site', async () => {
    const view = Object.fromEntries((await viewFacts(viewFrom(`#a=${POINT}@2027-05&t=100&limits=14_72_72_1_1&mode=plan`), data)).map((item) => [item.key, item.value]))
    expect(view.site).toBe('Custom point 89.453°S, 137.149°W')
    expect(view.site_id).toBe(POINT)
    expect(view.site_nearest).toBe('Connecting Ridge')
  })

  it('answers the tools for a custom point as for a listed site', async () => {
    const ctx = { data, requirements: DEFAULT_LIMITS }
    for (const [tool, args] of [
      ['conditions_at', { site: POINT, time: '2027-05-06T13' }],
      ['month_summary', { site: POINT, month: '2027-05' }],
      ['year_summary', { site: POINT, year: 2027 }],
      ['next_landing', { site: POINT, time: '2027-05-06T13' }],
      ['site_info', { site: POINT }],
    ] as const) {
      const result = await runTool(tool, args, ctx)
      expect(result.ok, `${tool}: ${result.ok ? '' : result.error}`).toBe(true)
    }
  })

  it('cannot be worked out without the terrain tiles, and says so by giving nothing', async () => {
    expect(await siteData(dataDir, { get: async () => null }).site(POINT)).toBeNull()
  })
})
