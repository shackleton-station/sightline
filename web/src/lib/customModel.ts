import type { BandAccuracy, CustomMeta, Summary, TimeWindow, TrackPoint, YearSummary } from '../data/contract'
import type { SiteFlags } from './flags'
import { EARTH_CLEARANCES_DEG } from './mission'

/**
 * Sun and Earth visibility for any coordinates, computed in the browser. This is the same geometry as
 * the Python pipeline. Horizons need fine terrain only close to the observer, so this reads small
 * tiles near the point and coarse maps beyond. customModel.test.ts checks it against Python, and
 * conventions match pipeline/src/clps/geometry.py and custom.py.
 */

export const MOON_RADIUS_M = 1_737_400
export const SUN_RADIUS_KM = 695_700
export const EARTH_RADIUS_KM = 6_371
const AZ_STEP_DEG = 0.5
const HOUR_MS = 3_600_000
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export type Vec3 = [number, number, number]

export interface TerrainAssets {
  meta: CustomMeta
  /** Coarse global heights (m), north to south from 0° east. */
  terrain: Int16Array
  /** Coarse polar heights, in units of the polar quantization. */
  polarFar: Int16Array
}

export interface CustomAssets extends TerrainAssets {
  /** Hourly Sun and Earth positions from the Moon's center, in km: x, y, z, x, y, z per hour. */
  positions: Float32Array
}

/** Fine tiles already loaded, keyed by "polar/row_col" or "global/row_col". */
export type TileStore = Map<string, Int16Array>

/** Reads a tile's decompressed bytes. */
export type TileReader = (name: string) => Promise<ArrayBuffer>

export interface CustomSiteModel {
  horizon: { az: number; el: number }[]
  heightM: number
  /** UTC milliseconds of the first hour. */
  startMs: number
  sunAz: Float64Array
  sunEl: Float64Array
  sunFrac: Float64Array
  earthAz: Float64Array
  earthEl: Float64Array
  earthFrac: Float64Array
  /** Unit vector to the Sun in MOON_ME: x, y, z per hour. */
  sunVec: Float32Array
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2])

export function unitVector(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * RAD
  const lon = lonDeg * RAD
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}

/** Local east, north and up at a site; north points toward the Moon's north pole. */
export function enuBasis(latDeg: number, lonDeg: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const up = unitVector(latDeg, lonDeg)
  const length = Math.hypot(up[0], up[1])
  const east: Vec3 = [-up[1] / length, up[0] / length, 0]
  const north: Vec3 = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ]
  return { east, north, up }
}

/** Undo the delta coding used for tiles; 16-bit wrap-around matches the encoder. */
export function decodeTile(buffer: ArrayBuffer, width: number): Int16Array {
  const tile = new Int16Array(buffer)
  const height = tile.length / width
  for (let row = 1; row < height; row += 1) tile[row * width] += tile[(row - 1) * width]
  for (let row = 0; row < height; row += 1) {
    const start = row * width
    for (let col = 1; col < width; col += 1) tile[start + col] += tile[start + col - 1]
  }
  return tile
}

/** South polar stereographic x and y (m), matching the DEM's projection. */
export function polarXY(latDeg: number, lonDeg: number): { x: number; y: number } {
  const rho = 2 * MOON_RADIUS_M * Math.tan(((90 + latDeg) * RAD) / 2)
  return { x: rho * Math.sin(lonDeg * RAD), y: rho * Math.cos(lonDeg * RAD) }
}

/** Latitude and longitude from south polar stereographic x and y (m). */
export function polarLatLon(xM: number, yM: number): { lat: number; lon: number } {
  const rho = Math.hypot(xM, yM)
  return { lat: -90 + 2 * Math.atan(rho / (2 * MOON_RADIUS_M)) * DEG, lon: Math.atan2(xM, yM) * DEG }
}

/** The fine tiles a site needs, from a square of the near distance around it (wider if asked). */
export function requiredTiles(
  meta: CustomMeta,
  latDeg: number,
  lonDeg: number,
  polarReachM = meta.near_polar_m,
): string[] {
  const names = new Set<string>()
  const { polar, global } = meta
  const margin = 2 * polar.res_m
  let globalNeeded = true
  if (latDeg < 0) {
    const { x, y } = polarXY(latDeg, lonDeg)
    const reach = polarReachM + margin
    const toIndex = (value: number) => Math.floor((value + polar.half_m) / polar.res_m)
    const inside = (value: number) => Math.abs(value) - reach < polar.half_m
    if (inside(x) && inside(y)) {
      const clampTile = (i: number) =>
        Math.floor(Math.max(0, Math.min(polar.size - 1, i)) / polar.tile_px)
      for (let r = clampTile(toIndex(-y - reach)); r <= clampTile(toIndex(-y + reach)); r += 1) {
        for (let c = clampTile(toIndex(x - reach)); c <= clampTile(toIndex(x + reach)); c += 1) {
          names.add(`polar/${r}_${c}`)
        }
      }
    }
    // Nearby ground outside the polar map needs global tiles; inside it, the far map covers it.
    const farReach = meta.near_global_m + polar.far_res_m
    globalNeeded = !(
      Math.abs(x) + farReach < polar.half_m && Math.abs(y) + farReach < polar.half_m
    )
  }
  if (globalNeeded) {
    const reachDeg = ((meta.near_global_m + global.res_m) / MOON_RADIUS_M) * DEG
    const cosLat = Math.cos(Math.min(89.9, Math.abs(latDeg) + reachDeg) * RAD)
    const lonReach = Math.abs(latDeg) + reachDeg >= 89.5 ? 180 : reachDeg / cosLat
    const lineOf = (lat: number) => global.line_offset - lat * global.pix_per_deg
    const clampRow = (line: number) =>
      Math.floor(Math.max(0, Math.min(global.lines - 1, line)) / global.tile_px)
    const columns = global.samples / global.tile_px
    const sampleOf = (lon: number) =>
      global.sample_offset + (((lon % 360) + 360) % 360 - global.center_lon) * global.pix_per_deg
    const firstCol = Math.floor(sampleOf(lonDeg) / global.tile_px)
    const span = Math.ceil((lonReach * global.pix_per_deg + 1) / global.tile_px)
    for (let r = clampRow(lineOf(latDeg + reachDeg) - 1); r <= clampRow(lineOf(latDeg - reachDeg) + 1); r += 1) {
      for (let c = firstCol - span; c <= firstCol + span; c += 1) {
        names.add(`global/${r}_${((c % columns) + columns) % columns}`)
      }
    }
  }
  return [...names]
}

/** Fetch and decode every tile a site needs that isn't already loaded. */
export async function loadTiles(
  meta: CustomMeta,
  latDeg: number,
  lonDeg: number,
  store: TileStore,
  read: TileReader,
  polarReachM?: number,
): Promise<void> {
  const missing = requiredTiles(meta, latDeg, lonDeg, polarReachM).filter((name) => !store.has(name))
  await Promise.all(
    missing.map(async (name) => {
      const buffer = await read(name)
      const isPolar = name.startsWith('polar/')
      const width = isPolar
        ? widthOfPolarTile(meta, name)
        : meta.global.tile_px
      store.set(name, decodeTile(buffer, width))
    }),
  )
}

function widthOfPolarTile(meta: CustomMeta, name: string): number {
  const col = Number(name.split('_')[1])
  const { size, tile_px: tilePx } = meta.polar
  return Math.min(tilePx, size - col * tilePx)
}

/** Terrain as the browser reads it, for rays from one site; matches custom.py's BrowserTerrain. */
export class Terrain {
  private readonly meta: CustomMeta
  private readonly assets: TerrainAssets
  private readonly tiles: TileStore
  private readonly farRes: number

  constructor(assets: TerrainAssets, tiles: TileStore) {
    this.assets = assets
    this.meta = assets.meta
    this.tiles = tiles
    this.farRes = this.meta.polar.far_res_m
  }

  /** Height (m) at a point this far from the site along the ground. */
  heightAt(latDeg: number, lonDeg: number, distM: number): number {
    const { polar } = this.meta
    if (latDeg < 0) {
      const { x, y } = polarXY(latDeg, lonDeg)
      if (distM <= this.meta.near_polar_m) {
        const col = (x + polar.half_m) / polar.res_m - 0.5
        const row = (polar.half_m - y) / polar.res_m - 0.5
        if (col >= 0 && col <= polar.size - 1 && row >= 0 && row <= polar.size - 1) {
          return this.polarFine(row, col)
        }
      }
      const farCol = (x + polar.half_m) / this.farRes - 0.5
      const farRow = (polar.half_m - y) / this.farRes - 0.5
      const last = polar.far_size - 1
      if (farCol >= 0 && farCol <= last && farRow >= 0 && farRow <= last) {
        return this.polarFar(farRow, farCol)
      }
    }
    return distM <= this.meta.near_global_m ? this.globalFine(latDeg, lonDeg) : this.coarse(latDeg, lonDeg)
  }

  /** Height (m) from the finest terrain loaded here, for drawing rather than for rays. */
  surfaceHeight(latDeg: number, lonDeg: number): number {
    const { polar, global: g } = this.meta
    if (latDeg < 0) {
      const { x, y } = polarXY(latDeg, lonDeg)
      const col = (x + polar.half_m) / polar.res_m - 0.5
      const row = (polar.half_m - y) / polar.res_m - 0.5
      const last = polar.size - 2
      if (col >= 0 && col <= last && row >= 0 && row <= last) {
        const tile = (r: number, c: number) =>
          this.tiles.has(`polar/${Math.floor(r / polar.tile_px)}_${Math.floor(c / polar.tile_px)}`)
        const r0 = Math.floor(row)
        const c0 = Math.floor(col)
        if (tile(r0, c0) && tile(r0 + 1, c0 + 1) && tile(r0, c0 + 1) && tile(r0 + 1, c0)) {
          return this.polarFine(row, col)
        }
      }
      const farCol = (x + polar.half_m) / this.farRes - 0.5
      const farRow = (polar.half_m - y) / this.farRes - 0.5
      const last2 = polar.far_size - 1
      if (farCol >= 0 && farCol <= last2 && farRow >= 0 && farRow <= last2) {
        return this.polarFar(farRow, farCol)
      }
    }
    const line = g.line_offset - latDeg * g.pix_per_deg
    const sample = g.sample_offset + ((((lonDeg % 360) + 360) % 360) - g.center_lon) * g.pix_per_deg
    const r0 = Math.max(0, Math.min(g.lines - 2, Math.floor(line)))
    const c0 = ((Math.floor(sample) % g.samples) + g.samples) % g.samples
    const c1 = (c0 + 1) % g.samples
    const has = (r: number, c: number) =>
      this.tiles.has(`global/${Math.floor(r / g.tile_px)}_${Math.floor(c / g.tile_px)}`)
    if (has(r0, c0) && has(r0, c1) && has(r0 + 1, c0) && has(r0 + 1, c1)) {
      return this.globalFine(latDeg, lonDeg)
    }
    return this.coarse(latDeg, lonDeg)
  }

  private polarFine(row: number, col: number): number {
    const { size, tile_px: tilePx, quant_m: quant } = this.meta.polar
    const r0 = Math.max(0, Math.min(size - 2, Math.floor(row)))
    const c0 = Math.max(0, Math.min(size - 2, Math.floor(col)))
    const fr = row - r0
    const fc = col - c0
    const at = (r: number, c: number) => {
      const name = `polar/${Math.floor(r / tilePx)}_${Math.floor(c / tilePx)}`
      const tile = this.tiles.get(name)
      if (!tile) throw new Error(`terrain tile not loaded: ${name}`)
      const width = Math.min(tilePx, size - Math.floor(c / tilePx) * tilePx)
      return tile[(r % tilePx) * width + (c % tilePx)]
    }
    const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc
    const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc
    return (top * (1 - fr) + bottom * fr) * quant
  }

  private polarFar(row: number, col: number): number {
    const { far_size: size, quant_m: quant } = this.meta.polar
    const grid = this.assets.polarFar
    const r0 = Math.max(0, Math.min(size - 2, Math.floor(row)))
    const c0 = Math.max(0, Math.min(size - 2, Math.floor(col)))
    const fr = row - r0
    const fc = col - c0
    const at = (r: number, c: number) => grid[r * size + c]
    const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc
    const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc
    return (top * (1 - fr) + bottom * fr) * quant
  }

  private globalFine(latDeg: number, lonDeg: number): number {
    const g = this.meta.global
    const lon = ((lonDeg % 360) + 360) % 360
    const line = g.line_offset - latDeg * g.pix_per_deg
    const sample = g.sample_offset + (lon - g.center_lon) * g.pix_per_deg
    const r0 = Math.max(0, Math.min(g.lines - 2, Math.floor(line)))
    const fr = Math.max(0, Math.min(1, line - r0))
    const floor = Math.floor(sample)
    const c0 = ((floor % g.samples) + g.samples) % g.samples
    const c1 = (c0 + 1) % g.samples
    const fc = sample - floor
    const at = (r: number, c: number) => {
      const name = `global/${Math.floor(r / g.tile_px)}_${Math.floor(c / g.tile_px)}`
      const tile = this.tiles.get(name)
      if (!tile) throw new Error(`terrain tile not loaded: ${name}`)
      return tile[(r % g.tile_px) * g.tile_px + (c % g.tile_px)]
    }
    const top = at(r0, c0) * (1 - fc) + at(r0, c1) * fc
    const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c1) * fc
    return (top * (1 - fr) + bottom * fr) * g.scale
  }

  coarse(latDeg: number, lonDeg: number): number {
    const { rows, cols, ppd } = this.meta
    const { terrain } = this.assets
    const lon = ((lonDeg % 360) + 360) % 360
    const line = (90 - latDeg) * ppd - 0.5
    const sample = lon * ppd - 0.5
    const r0 = Math.max(0, Math.min(rows - 2, Math.floor(line)))
    const fr = Math.max(0, Math.min(1, line - r0))
    const floor = Math.floor(sample)
    const c0 = ((floor % cols) + cols) % cols
    const c1 = (c0 + 1) % cols
    const fc = sample - floor
    const at = (r: number, c: number) => terrain[r * cols + c]
    const top = at(r0, c0) * (1 - fc) + at(r0, c1) * fc
    const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c1) * fc
    return top * (1 - fr) + bottom * fr
  }
}

/** Sample distances (m) along each ray, matching custom.py's browser_distances_m. */
export function rayDistances(): Float64Array {
  const distances: number[] = []
  for (let d = 20; d <= 5_000; d += 20) distances.push(d)
  for (let d = 5_150; d <= 40_000; d += 150) distances.push(d)
  for (let d = 40_400; d <= 200_000; d += 400) distances.push(d)
  return Float64Array.from(distances)
}

/** Highest terrain angle (degrees) at each azimuth, from 0° clockwise in 0.5° steps. */
export function horizonMask(
  terrain: Terrain,
  latDeg: number,
  lonDeg: number,
  heightM: number,
  obsHeightM: number,
): { az: number; el: number }[] {
  const { east, north, up } = enuBasis(latDeg, lonDeg)
  const siteRadius = MOON_RADIUS_M + heightM + obsHeightM
  const distances = rayDistances()
  const mask: { az: number; el: number }[] = []
  for (let az = 0; az < 360; az += AZ_STEP_DEG) {
    const c = Math.cos(az * RAD)
    const s = Math.sin(az * RAD)
    const horizontal: Vec3 = [
      c * north[0] + s * east[0],
      c * north[1] + s * east[1],
      c * north[2] + s * east[2],
    ]
    let best = Number.NEGATIVE_INFINITY
    for (let i = 0; i < distances.length; i += 1) {
      const d = distances[i]
      const delta = d / MOON_RADIUS_M
      const cd = Math.cos(delta)
      const sd = Math.sin(delta)
      const x = cd * up[0] + sd * horizontal[0]
      const y = cd * up[1] + sd * horizontal[1]
      const z = cd * up[2] + sd * horizontal[2]
      const lat = Math.atan2(z, Math.hypot(x, y)) * DEG
      const lon = Math.atan2(y, x) * DEG
      const radius = MOON_RADIUS_M + terrain.heightAt(lat, lon, d)
      const rel: Vec3 = [
        radius * x - siteRadius * up[0],
        radius * y - siteRadius * up[1],
        radius * z - siteRadius * up[2],
      ]
      const relUp = dot(rel, up)
      const relHorizontal = Math.hypot(
        rel[0] - relUp * up[0],
        rel[1] - relUp * up[1],
        rel[2] - relUp * up[2],
      )
      const el = Math.atan2(relUp, relHorizontal) * DEG
      if (el > best) best = el
    }
    mask.push({ az, el: best })
  }
  return mask
}

/** Ground slope at a point (degrees), from heights this far away to each side, as in nearby.py. */
export function slopeAt(terrain: Terrain, latDeg: number, lonDeg: number, halfStepM: number): number {
  const { east, north, up } = enuBasis(latDeg, lonDeg)
  const delta = halfStepM / MOON_RADIUS_M
  const height = (direction: Vec3, sign: number) => {
    const x = Math.cos(delta) * up[0] + sign * Math.sin(delta) * direction[0]
    const y = Math.cos(delta) * up[1] + sign * Math.sin(delta) * direction[1]
    const z = Math.cos(delta) * up[2] + sign * Math.sin(delta) * direction[2]
    return terrain.heightAt(Math.atan2(z, Math.hypot(x, y)) * DEG, Math.atan2(y, x) * DEG, halfStepM)
  }
  const dEast = (height(east, 1) - height(east, -1)) / (2 * halfStepM)
  const dNorth = (height(north, 1) - height(north, -1)) / (2 * halfStepM)
  return Math.atan(Math.hypot(dEast, dNorth)) * DEG
}

/** Horizon elevation at an azimuth, interpolated with wrap-around. */
export function horizonAt(mask: { az: number; el: number }[], azDeg: number): number {
  const position = (((azDeg % 360) + 360) % 360) / AZ_STEP_DEG
  const i = Math.floor(position)
  const f = position - i
  return mask[i % mask.length].el * (1 - f) + mask[(i + 1) % mask.length].el * f
}

/** Fraction of a disk above a locally flat horizon, as in visibility.py. */
export function visibleFraction(clearanceDeg: number, radiusDeg: number): number {
  const x = Math.max(-1, Math.min(1, clearanceDeg / radiusDeg))
  return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI
}

/** Compute all the years of Sun and Earth visibility at a site, for an observer this high up. */
export function computeSite(
  assets: CustomAssets,
  tiles: TileStore,
  latDeg: number,
  lonDeg: number,
  obsHeightM = assets.meta.obs_height_m,
): CustomSiteModel {
  const { meta } = assets
  const terrain = new Terrain(assets, tiles)
  const heightM = terrain.heightAt(latDeg, lonDeg, 0)
  const mask = horizonMask(terrain, latDeg, lonDeg, heightM, obsHeightM)
  const { east, north, up } = enuBasis(latDeg, lonDeg)
  const radiusKm = (MOON_RADIUS_M + heightM + obsHeightM) / 1000
  const site: Vec3 = [up[0] * radiusKm, up[1] * radiusKm, up[2] * radiusKm]
  const n = meta.hours
  const model: CustomSiteModel = {
    horizon: mask,
    heightM,
    startMs: Date.parse(meta.start),
    sunAz: new Float64Array(n),
    sunEl: new Float64Array(n),
    sunFrac: new Float64Array(n),
    earthAz: new Float64Array(n),
    earthEl: new Float64Array(n),
    earthFrac: new Float64Array(n),
    sunVec: new Float32Array(n * 3),
  }
  const observe = (i: number, offset: number, bodyRadiusKm: number) => {
    const p = assets.positions
    const rel: Vec3 = [
      p[i * 6 + offset] - site[0],
      p[i * 6 + offset + 1] - site[1],
      p[i * 6 + offset + 2] - site[2],
    ]
    const dist = norm(rel)
    const unit: Vec3 = [rel[0] / dist, rel[1] / dist, rel[2] / dist]
    const e = dot(unit, east)
    const nn = dot(unit, north)
    const u = dot(unit, up)
    const az = ((Math.atan2(e, nn) * DEG) % 360 + 360) % 360
    const el = Math.atan2(u, Math.hypot(e, nn)) * DEG
    const radiusDeg = Math.asin(bodyRadiusKm / dist) * DEG
    return { az, el, frac: visibleFraction(el - horizonAt(mask, az), radiusDeg), unit }
  }
  for (let i = 0; i < n; i += 1) {
    const sun = observe(i, 0, SUN_RADIUS_KM)
    const earth = observe(i, 3, EARTH_RADIUS_KM)
    model.sunAz[i] = sun.az
    model.sunEl[i] = sun.el
    model.sunFrac[i] = sun.frac
    model.earthAz[i] = earth.az
    model.earthEl[i] = earth.el
    model.earthFrac[i] = earth.frac
    model.sunVec.set(sun.unit, i * 3)
  }
  return model
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function isoHour(model: CustomSiteModel, hour: number): string {
  return new Date(model.startMs + hour * HOUR_MS).toISOString().replace('.000Z', 'Z')
}

/** Hour indices [from, to) of a "YYYY-MM" month in the model. */
function monthRange(model: CustomSiteModel, month: string): [number, number] {
  const [year, m] = month.split('-').map(Number)
  return [
    (Date.UTC(year, m - 1, 1) - model.startMs) / HOUR_MS,
    (Date.UTC(year, m, 1) - model.startMs) / HOUR_MS,
  ]
}

export function monthTrack(model: CustomSiteModel, month: string): TrackPoint[] {
  const [from, to] = monthRange(model, month)
  const track: TrackPoint[] = []
  for (let i = from; i < to; i += 1) {
    const [x, y, z] = model.sunVec.subarray(i * 3, i * 3 + 3)
    track.push({
      t: isoHour(model, i),
      sun_az: round(model.sunAz[i], 2),
      sun_el: round(model.sunEl[i], 2),
      sun_frac: round(model.sunFrac[i], 3),
      sun_up: model.sunFrac[i] > 0,
      earth_az: round(model.earthAz[i], 2),
      earth_el: round(model.earthEl[i], 2),
      earth_up: model.earthFrac[i] > 0,
      sun_vec_me: [round(x, 5), round(y, 5), round(z, 5)],
    })
  }
  return track
}

/** Windows when ``up`` is true, where ``up[0]`` is the model's hour ``firstHour``. */
function windowsOf(model: CustomSiteModel, firstHour: number, up: boolean[]): TimeWindow[] {
  const windows: TimeWindow[] = []
  let from = -1
  for (let i = 0; i <= up.length; i += 1) {
    const value = i < up.length && up[i]
    if (value && from < 0) from = i
    if (!value && from >= 0) {
      windows.push({ start: isoHour(model, firstHour + from), end: isoHour(model, firstHour + i) })
      from = -1
    }
  }
  return windows
}

function longestGap(up: boolean[]): number {
  let longest = 0
  let current = 0
  for (const value of up) {
    current = value ? 0 : current + 1
    if (current > longest) longest = current
  }
  return longest
}

function stats(sun: boolean[], earth: boolean[]) {
  const n = sun.length
  const share = (count: number) => round((100 * count) / n, 1)
  return {
    pct_sun: share(sun.filter(Boolean).length),
    pct_earth: share(earth.filter(Boolean).length),
    pct_both: share(sun.filter((value, i) => value && earth[i]).length),
    max_sun_gap_h: longestGap(sun),
    max_earth_gap_h: longestGap(earth),
  }
}

function flags(model: CustomSiteModel, from: number, to: number) {
  return {
    sun: Array.from(model.sunFrac.subarray(from, to), (f) => f > 0),
    earth: Array.from(model.earthFrac.subarray(from, to), (f) => f > 0),
  }
}

export function monthSummary(model: CustomSiteModel, month: string, obsHeightM: number): Summary {
  const [from, to] = monthRange(model, month)
  const { sun, earth } = flags(model, from, to)
  return {
    range: { start: isoHour(model, from), end: isoHour(model, to), step_h: 1 },
    obs_height_m: obsHeightM,
    ...stats(sun, earth),
    sun_windows: windowsOf(model, from, sun),
    earth_windows: windowsOf(model, from, earth),
  }
}

/** The months present in the model, as "YYYY-MM". */
export function modelMonths(model: CustomSiteModel): string[] {
  const months: string[] = []
  const hours = model.sunFrac.length
  for (let hour = 0; hour < hours; ) {
    const month = isoHour(model, hour).slice(0, 7)
    months.push(month)
    hour = monthRange(model, month)[1]
  }
  return months
}

export function yearSummary(model: CustomSiteModel, defaultMonth: string): YearSummary {
  const months = modelMonths(model).map((month) => {
    const [from, to] = monthRange(model, month)
    const { sun, earth } = flags(model, from, to)
    return { month, ...stats(sun, earth) }
  })
  const years = [...new Set(months.map(({ month }) => Number(month.slice(0, 4))))].map((year) => {
    const from = (Date.UTC(year, 0, 1) - model.startMs) / HOUR_MS
    const to = (Date.UTC(year + 1, 0, 1) - model.startMs) / HOUR_MS
    const { sun, earth } = flags(model, from, to)
    return { year, ...stats(sun, earth) }
  })
  return { default_month: defaultMonth, months, years }
}

/** Hourly Sun and Earth flags for everything in the model, from its first hour. */
export function modelFlags(model: CustomSiteModel): SiteFlags {
  const earthAbove: Record<string, boolean[]> = {}
  const clearance = Float64Array.from(
    model.earthEl,
    (el, i) => el - horizonAt(model.horizon, model.earthAz[i]),
  )
  for (const degrees of EARTH_CLEARANCES_DEG) {
    earthAbove[String(degrees)] = Array.from(clearance, (value) => value >= degrees)
  }
  return { start: isoHour(model, 0), ...flags(model, 0, model.sunFrac.length), earthAbove }
}

/** The accuracy measured for a latitude, or null at the poles themselves. */
export function accuracyAt(
  bands: BandAccuracy[],
  maxAbsLat: number,
  latDeg: number,
): BandAccuracy | null {
  const abs = Math.abs(latDeg)
  if (abs > maxAbsLat) return null
  return bands.find((band) => abs >= band.min_abs_lat && abs <= band.max_abs_lat) ?? null
}

/** Terrain resolution near a point (m per pixel). */
export function nearResolutionM(meta: CustomMeta, latDeg: number, lonDeg: number): number {
  if (latDeg >= 0) return meta.global.res_m
  const { x, y } = polarXY(latDeg, lonDeg)
  return Math.abs(x) < meta.polar.half_m && Math.abs(y) < meta.polar.half_m
    ? meta.polar.res_m
    : meta.global.res_m
}

/**
 * Parse a coordinate typed by a user; null if it isn't a number within the limits.
 *
 * It reads the forms the app itself prints: a plain number ("-89.45", or with a typographic minus),
 * with or without a degree sign, and a number with a compass letter ("89.45°S", "137.1 W"), where
 * south and west are negative. A latitude (limits within ±90) takes N or S, a longitude E or W.
 */
export function parseCoordinate(text: string, min: number, max: number): number | null {
  const typed = text.trim().replace(/\u2212/g, '-').replace(/°/g, '').trim()
  const lettered = /^(.*?)\s*([nsew])$/i.exec(typed)
  const letter = lettered ? lettered[2].toLowerCase() : null
  const digits = lettered ? lettered[1].trim() : typed
  if (digits === '') return null
  let value = Number(digits)
  if (!Number.isFinite(value)) return null
  if (letter) {
    const allowed = max <= 90 ? 'ns' : 'ew'
    // A sign and a letter together say the direction twice: not read.
    if (!allowed.includes(letter) || value < 0) return null
    if (letter === 's' || letter === 'w') value = -value
  }
  if (value < min || value > max) return null
  return value
}
