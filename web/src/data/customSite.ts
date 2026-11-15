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
  type TerrainAssets,
  type TileStore,
  yearSummary,
} from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import { spanHours, type YearSpan, yearsOf } from '../lib/span'
import type { BandAccuracy, CustomMeta, MastHeight, SiteInfo } from './contract'

export { CUSTOM_GROUP, customSiteInfo, isCustomSite } from '../lib/customPoint'

const base = () => import.meta.env.BASE_URL

export async function bytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

/**
 * Unpack a gzipped file. Some servers mark .gz files as compressed, so the browser has already
 * unpacked them by the time they arrive; gzip's first two bytes tell the cases apart.
 */
export async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const start = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
  if (start[0] !== 0x1f || start[1] !== 0x8b) return buffer
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

let metaRequest: Promise<CustomMeta> | null = null

export function loadCustomMeta(): Promise<CustomMeta> {
  metaRequest ??= fetch(`${base()}data/custom/meta.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`meta.json: HTTP ${response.status}`)
      return response.json() as Promise<CustomMeta>
    })
    .catch((reason: unknown) => {
      metaRequest = null
      throw reason
    })
  return metaRequest
}

let terrainRequest: Promise<TerrainAssets> | null = null

/** The coarse maps, fetched only when someone uses custom coordinates or the 3D view. */
function loadTerrainAssets(): Promise<TerrainAssets> {
  terrainRequest ??= (async () => {
    const meta = await loadCustomMeta()
    const dir = `${base()}data/custom`
    const [north, south, polarFar] = await Promise.all([
      bytes(`${dir}/terrain-north.bin`),
      bytes(`${dir}/terrain-south.bin`),
      bytes(`${dir}/polar-far.bin.gz`).then(gunzip),
    ])
    const terrain = new Int16Array(meta.rows * meta.cols)
    terrain.set(new Int16Array(north))
    terrain.set(new Int16Array(south), new Int16Array(north).length)
    return { meta, terrain, polarFar: decodeTile(polarFar, meta.polar.far_size) }
  })().catch((reason: unknown) => {
    terrainRequest = null
    throw reason
  })
  return terrainRequest
}

const yearPositions = new Map<number, Promise<Float32Array>>()

/**
 * Where the Sun and Earth are from the Moon's center for every hour of a year, in MOON_ME (km):
 * the pipeline's ephemeris file, six numbers an hour from 1 January 00:00 UTC. Their distances
 * give the size each disk appears from a site.
 */
export function loadYearPositions(year: number): Promise<Float32Array> {
  const cached = yearPositions.get(year)
  if (cached) return cached
  const request = bytes(`${base()}data/custom/ephemeris-${year}.bin`).then((buffer) => new Float32Array(buffer))
  request.catch(() => yearPositions.delete(year))
  yearPositions.set(year, request)
  return request
}

const spanKey = (span: YearSpan) => `${span.from}-${span.to}`

/** The last span's terrain and positions: a point's model and its taller masts share them. */
let assetsFor: { key: string; request: Promise<CustomAssets> } | null = null

/**
 * What a custom point is computed from, for a span of years: the coarse terrain, and the Sun's and
 * Earth's positions for those years only, so a point costs the same however long the range is.
 */
function loadAssets(span: YearSpan): Promise<CustomAssets> {
  const key = spanKey(span)
  if (assetsFor?.key === key) return assetsFor.request
  const request = (async () => {
    const [terrain, years] = await Promise.all([loadTerrainAssets(), Promise.all(yearsOf(span).map(loadYearPositions))])
    const { start, hours } = spanHours(span)
    const positions = new Float32Array(hours * 6)
    let offset = 0
    for (const year of years) {
      if (offset + year.length > positions.length) throw new Error('the ephemeris files hold more hours than their years have')
      positions.set(year, offset)
      offset += year.length
    }
    if (offset !== positions.length) throw new Error('the ephemeris files hold fewer hours than their years have')
    // The model counts its hours from `start`: here the span's first hour, not the whole range's.
    return { ...terrain, meta: { ...terrain.meta, start, hours }, positions }
  })()
  assetsFor = { key, request }
  request.catch(() => {
    if (assetsFor?.request === request) assetsFor = null
  })
  return request
}

/** Shared across points, so moving a short way reuses what's loaded. */
const tiles: TileStore = new Map()

const readTile = (name: string) => bytes(`${base()}tiles/${name}.bin.gz`).then(gunzip)

/**
 * Terrain for drawing a site in 3D, with fine tiles out to this distance where they exist. These
 * tiles have their own store, so they're freed once the site is drawn and don't build up in memory.
 */
export async function loadDrawingTerrain(lat: number, lon: number, polarReachM: number): Promise<Terrain> {
  const assets = await loadTerrainAssets()
  const drawingTiles: TileStore = new Map()
  await loadTiles(assets.meta, lat, lon, drawingTiles, readTile, polarReachM)
  return new Terrain(assets, drawingTiles)
}

interface LoadedModel {
  model: CustomSiteModel
  meta: CustomMeta
  slope: { deg: number; baseline_m: number }
}

/** Each point's model for the span last asked for; a longer span replaces the shorter one. */
const models = new Map<string, { key: string; request: Promise<LoadedModel> }>()

function loadModel(site: SiteInfo, span: YearSpan): Promise<LoadedModel> {
  const key = spanKey(span)
  const known = models.get(site.id)
  if (known?.key === key) return known.request
  {
    const request = (async () => {
      const assets = await loadAssets(span)
      await loadTiles(assets.meta, site.lat, site.lon, tiles, readTile)
      const halfStepM = nearResolutionM(assets.meta, site.lat, site.lon)
      return {
        meta: assets.meta,
        model: computeSite(assets, tiles, site.lat, site.lon),
        slope: {
          deg: Number(slopeAt(new Terrain(assets, tiles), site.lat, site.lon, halfStepM).toFixed(1)),
          baseline_m: Math.round(2 * halfStepM),
        },
      }
    })()
    models.set(site.id, { key, request })
    request.catch(() => {
      if (models.get(site.id)?.request === request) models.delete(site.id)
    })
    return request
  }
}

export async function loadCustomMonth(site: SiteInfo, month: string, span: YearSpan) {
  const { model, meta, slope } = await loadModel(site, span)
  if (!modelMonths(model).includes(month)) throw new Error(`${month} is outside our data`)
  const accuracy: BandAccuracy | null = accuracyAt(meta.bands, meta.max_abs_lat, site.lat)
  if (!accuracy) throw new Error(`latitude ${site.lat} is too close to a pole`)
  return {
    accuracy,
    resolutionM: nearResolutionM(meta, site.lat, site.lon),
    modelError: meta.model_error,
    slope,
    ridges: site.lat <= -85 ? meta.polar_ridges : null,
    horizon: model.horizon.map((point) => ({ az: point.az, el: Number(point.el.toFixed(2)) })),
    track: monthTrack(model, month),
    summary: monthSummary(model, month, meta.obs_height_m),
    year: yearSummary(model, month),
  }
}

/** A custom point's yearly numbers at each height above the ground. */
export async function loadCustomHeights(site: SiteInfo, heightsM: number[], span: YearSpan): Promise<MastHeight[]> {
  const { model, meta } = await loadModel(site, span)
  const assets = await loadAssets(span)
  return heightsM.map((obs_height_m) => {
    const atHeight =
      obs_height_m === meta.obs_height_m
        ? model
        : computeSite(assets, tiles, site.lat, site.lon, obs_height_m)
    return { obs_height_m, years: yearSummary(atHeight, '').years }
  })
}

const customFlags = new Map<string, { key: string; request: Promise<SiteFlags> }>()

/** Hourly flags for a custom point over a span of years, for everything the app works out across dates. Worked out once per span. */
export function loadCustomFlags(site: SiteInfo, span: YearSpan): Promise<SiteFlags> {
  const key = spanKey(span)
  const known = customFlags.get(site.id)
  if (known?.key === key) return known.request
  const request = loadModel(site, span).then(({ model }) => modelFlags(model))
  customFlags.set(site.id, { key, request })
  request.catch(() => {
    if (customFlags.get(site.id)?.request === request) customFlags.delete(site.id)
  })
  return request
}
