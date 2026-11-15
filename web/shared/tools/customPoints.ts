import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { CustomMeta, DataRange, SiteInfo, YearSummary } from '../../src/data/contract'
import type { ScenarioData } from '../../src/data/scenarioData'
import {
  accuracyAt,
  computeSite,
  type CustomAssets,
  type CustomSiteModel,
  decodeTile,
  loadTiles,
  modelFlags,
  modelMonths,
  monthSummary,
  monthTrack,
  nearResolutionM,
  slopeAt,
  Terrain,
  type TileStore,
  yearSummary,
} from '../../src/lib/customModel'
import { customSiteInfo } from '../../src/lib/customPoint'
import type { SiteFlags } from '../../src/lib/flags'
import { yearsOf } from '../../src/lib/span'
import { parseCustomSite } from '../../src/lib/urlState'
import type { Bucket } from '../bucket'

/**
 * A custom point (typed coordinates, "lat,lon" as a link carries it), worked out here by the same
 * code the visitor's page runs (src/lib/customModel.ts) from the same files: the coarse terrain and
 * the ephemeris in data/custom, and the fine terrain tiles around the point. So a tool's numbers for
 * a custom point are the ones on the visitor's screen. Like the page, a custom point is worked out
 * at the app's own 2 m above the ground.
 */
export interface CustomPoint {
  /** The point as a site. Its id is the link's own "lat,lon", so buttons can be built from it. */
  site: SiteInfo
  flags: SiteFlags
  year: YearSummary
  /** Everything one month's view works from, as the page builds it for a custom point. */
  scenario(month: string): ScenarioData
}

export interface CustomPoints {
  /** The point for a "lat,lon" id; null when the id is not one, or the point cannot be worked out here (no terrain tiles, too near a pole). */
  get(siteId: string): Promise<CustomPoint | null>
}

/** A point's model holds every hour of the data (about 13 MB): keep only the last few asked about. */
const MAX_POINTS = 6
/** Fine tiles are half a megabyte each and a point needs a handful: past this many the store starts again. */
const MAX_TILES = 96

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
/** Some stores hand a .gz file over already unpacked; gzip's first two bytes tell the cases apart. */
const unpacked = (bytes: Uint8Array): Uint8Array => (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes)

/**
 * Custom points for the co-pilot's tools. The fine tiles come from the bucket (`tiles/<name>.bin.gz`,
 * where the page reads them through the CDN), or from the `tiles` folder beside the data on a
 * developer's machine. With neither, no custom point can be worked out, and `get` gives null.
 */
export function customPoints(dataDir: string, bucket: Bucket | null | undefined, range: () => Promise<DataRange>): CustomPoints {
  let assetsOnce: Promise<CustomAssets> | null = null
  const assets = (): Promise<CustomAssets> => {
    assetsOnce ??= (async () => {
      const dir = join(dataDir, 'custom')
      const { first_year, last_year } = await range()
      const [metaText, north, south, far, ...years] = await Promise.all([
        readFile(join(dir, 'meta.json'), 'utf8'),
        readFile(join(dir, 'terrain-north.bin')),
        readFile(join(dir, 'terrain-south.bin')),
        readFile(join(dir, 'polar-far.bin.gz')),
        ...yearsOf({ from: first_year, to: last_year }).map((year) => readFile(join(dir, `ephemeris-${year}.bin`))),
      ])
      const meta = JSON.parse(metaText) as CustomMeta
      const terrain = new Int16Array(meta.rows * meta.cols)
      const northHeights = new Int16Array(arrayBuffer(north))
      terrain.set(northHeights)
      terrain.set(new Int16Array(arrayBuffer(south)), northHeights.length)
      const positions = new Float32Array(meta.hours * 6)
      let offset = 0
      for (const year of years) {
        const part = new Float32Array(arrayBuffer(year))
        if (offset + part.length > positions.length) throw new Error('the ephemeris files hold more hours than the data has')
        positions.set(part, offset)
        offset += part.length
      }
      if (offset !== positions.length) throw new Error('the ephemeris files hold fewer hours than the data has')
      return { meta, terrain, polarFar: decodeTile(arrayBuffer(unpacked(far)), meta.polar.far_size), positions }
    })()
    assetsOnce.catch(() => {
      assetsOnce = null
    })
    return assetsOnce
  }

  const tiles: TileStore = new Map()
  const readTile = async (name: string): Promise<ArrayBuffer> => {
    if (bucket) {
      const object = await bucket.get(`tiles/${name}.bin.gz`)
      if (!object) throw new Error(`no terrain tile ${name}`)
      return arrayBuffer(unpacked(new Uint8Array(await new Response(object.body).arrayBuffer())))
    }
    return arrayBuffer(unpacked(await readFile(join(dataDir, '..', 'tiles', `${name}.bin.gz`))))
  }

  const points = new Map<string, Promise<CustomPoint | null>>()

  const build = async (lat: number, lon: number): Promise<CustomPoint | null> => {
    const loaded = await assets()
    const { meta } = loaded
    const named = customSiteInfo(lat, lon)
    const accuracy = accuracyAt(meta.bands, meta.max_abs_lat, named.lat)
    if (!accuracy) return null
    if (tiles.size > MAX_TILES) tiles.clear()
    await loadTiles(meta, named.lat, named.lon, tiles, readTile)
    const model: CustomSiteModel = computeSite(loaded, tiles, named.lat, named.lon)
    const halfStepM = nearResolutionM(meta, named.lat, named.lon)
    // The slope as the page states it for a custom point: one decimal, over two steps of the near terrain.
    const slope = { deg: Number(slopeAt(new Terrain(loaded, tiles), named.lat, named.lon, halfStepM).toFixed(1)), baseline_m: Math.round(2 * halfStepM) }
    const site: SiteInfo = { ...named, id: `${named.lat},${named.lon}`, slope }
    const months = new Set(modelMonths(model))
    const year = yearSummary(model, '')
    return {
      site,
      flags: modelFlags(model),
      year,
      scenario(month) {
        if (!months.has(month)) throw new Error(`${month} is outside our data`)
        return {
          site,
          month,
          validation: null,
          custom: { accuracy, ridges: named.lat <= -85 ? meta.polar_ridges : null, resolutionM: halfStepM, modelError: meta.model_error },
          slope,
          horizon: model.horizon.map((point) => ({ az: point.az, el: Number(point.el.toFixed(2)) })),
          track: monthTrack(model, month),
          summary: monthSummary(model, month, meta.obs_height_m),
          year: { ...year, default_month: month },
        }
      },
    }
  }

  return {
    get(siteId) {
      const at = typeof siteId === 'string' && siteId.length <= 40 ? parseCustomSite(siteId) : null
      if (!at) return Promise.resolve(null)
      const named = customSiteInfo(at.lat, at.lon)
      const key = `${named.lat},${named.lon}`
      let found = points.get(key)
      // Asked about again: it moves to the end, so the least recently used point is the one dropped.
      if (found) points.delete(key)
      else {
        found = build(at.lat, at.lon).catch((reason: unknown) => {
          console.warn(`custom point ${key} could not be worked out`, reason)
          return null
        })
        // A point that could not be worked out (a tile that did not load) is tried again next time.
        void found.then((point) => {
          if (!point && points.get(key) === found) points.delete(key)
        })
      }
      points.set(key, found)
      if (points.size > MAX_POINTS) points.delete(points.keys().next().value as string)
      return found
    },
  }
}
