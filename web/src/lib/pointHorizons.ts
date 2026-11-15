import type { CustomMeta } from '../data/contract'
import { enuBasis, MOON_RADIUS_M, polarLatLon, rayDistances, type TileStore } from './customModel'

/**
 * The skyline at many points close together near the south pole, fast enough to work out a few
 * hundred of them while a visitor waits. It is the browser model's own horizon (`horizonMask` in
 * `customModel.ts`): the same rays, the same distances along them and the same terrain, read the
 * same way. Only the arithmetic is shorter:
 *
 * - the fine terrain is copied once into one block around the points, so a height is four array
 *   reads and not four lookups by a tile's name;
 * - a point along a ray goes straight from its direction to the terrain's map plane, with no
 *   latitude and longitude in between;
 * - the angle to a point of terrain is kept as its tangent, and turned into degrees once per ray.
 *
 * `pointHorizons.test.ts` requires the result to be `horizonMask`'s to a millionth of a degree.
 *
 * It answers only where every ray stays on the polar maps: within about 100 km of the south pole
 * (`reachesPolarMaps`).
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const AZ_STEP_DEG = 0.5
/** Rays around the compass: one every half degree, as `horizonMask` has them. */
export const AZIMUTHS = Math.round(360 / AZ_STEP_DEG)
/** How far the rays run (m): the last of `rayDistances`. */
const RAY_REACH_M = 200_000

/** The fine polar terrain around some points, as one block of the tiles' own 16-bit values. */
export interface PolarBlock {
  /** The fine map's column and row of the block's first value, and the block's size. */
  col0: number
  row0: number
  width: number
  height: number
  values: Int16Array
}

/** What the horizons are worked out from. */
export interface PolarGround {
  meta: CustomMeta
  /** The coarse polar map, in units of the polar quantization (`TerrainAssets.polarFar`). */
  polarFar: Int16Array
  block: PolarBlock
}

/**
 * Whether every ray from points within `aroundM` of a map-plane point stays on the polar maps, so
 * that this file's horizons are the browser model's.
 */
export function reachesPolarMaps(meta: CustomMeta, x: number, y: number, aroundM: number): boolean {
  const edge = meta.polar.half_m - RAY_REACH_M - aroundM - 2 * meta.polar.far_res_m
  return Math.abs(x) < edge && Math.abs(y) < edge
}

/** How far from the points the fine terrain is read (m): the model's near distance and a margin. */
export function blockReachM(meta: CustomMeta, aroundM: number): number {
  return meta.near_polar_m + aroundM + 3 * meta.polar.res_m
}

/**
 * The fine terrain within `reachM` of a map-plane point, copied out of the loaded tiles. Throws if
 * a tile it needs is not loaded (`loadTiles` with the same reach loads them).
 */
export function polarBlock(meta: CustomMeta, tiles: TileStore, x: number, y: number, reachM: number): PolarBlock {
  const { half_m: half, res_m: res, size, tile_px: tilePx } = meta.polar
  const clamp = (value: number) => Math.max(0, Math.min(size - 1, value))
  const col0 = clamp(Math.floor((x - reachM + half) / res) - 1)
  const col1 = clamp(Math.ceil((x + reachM + half) / res) + 1)
  const row0 = clamp(Math.floor((half - y - reachM) / res) - 1)
  const row1 = clamp(Math.ceil((half - y + reachM) / res) + 1)
  const width = col1 - col0 + 1
  const height = row1 - row0 + 1
  const values = new Int16Array(width * height)
  for (let tileRow = Math.floor(row0 / tilePx); tileRow <= Math.floor(row1 / tilePx); tileRow += 1) {
    for (let tileCol = Math.floor(col0 / tilePx); tileCol <= Math.floor(col1 / tilePx); tileCol += 1) {
      const name = `polar/${tileRow}_${tileCol}`
      const tile = tiles.get(name)
      if (!tile) throw new Error(`terrain tile not loaded: ${name}`)
      const tileWidth = Math.min(tilePx, size - tileCol * tilePx)
      const firstRow = Math.max(row0, tileRow * tilePx)
      const lastRow = Math.min(row1, tileRow * tilePx + tilePx - 1)
      const firstCol = Math.max(col0, tileCol * tilePx)
      const lastCol = Math.min(col1, tileCol * tilePx + tilePx - 1)
      for (let row = firstRow; row <= lastRow; row += 1) {
        const from = (row - tileRow * tilePx) * tileWidth + (firstCol - tileCol * tilePx)
        values.set(tile.subarray(from, from + lastCol - firstCol + 1), (row - row0) * width + (firstCol - col0))
      }
    }
  }
  return { col0, row0, width, height, values }
}

/** The ground's height (m) at a map-plane point, from the fine terrain: `Terrain.heightAt` at distance 0. */
export function groundHeightM(ground: PolarGround, x: number, y: number): number {
  const { half_m: half, res_m: res, size, quant_m: quant } = ground.meta.polar
  const { col0, row0, width, values } = ground.block
  const col = (x + half) / res - 0.5
  const row = (half - y) / res - 0.5
  const r0 = Math.max(0, Math.min(size - 2, Math.floor(row)))
  const c0 = Math.max(0, Math.min(size - 2, Math.floor(col)))
  const fr = row - r0
  const fc = col - c0
  const at = (r0 - row0) * width + (c0 - col0)
  const top = values[at] * (1 - fc) + values[at + 1] * fc
  const bottom = values[at + width] * (1 - fc) + values[at + width + 1] * fc
  return (top * (1 - fr) + bottom * fr) * quant
}

/**
 * The ground's slope (degrees) at a map-plane point, from heights `halfStepM` to each side toward
 * the east and toward the north, as `slopeAt` takes them. On the south-polar map north is straight
 * away from the pole and east a quarter turn from it; near the pole the map is true to the ground to
 * a few parts in ten thousand, so a step on it is the same step on the Moon.
 */
export function groundSlopeDeg(ground: PolarGround, x: number, y: number, halfStepM: number): number {
  const rho = Math.hypot(x, y)
  // At the pole itself every way is north: any two directions at right angles do.
  const nx = rho > 0 ? x / rho : 0
  const ny = rho > 0 ? y / rho : 1
  const rise = (dx: number, dy: number) => (groundHeightM(ground, x + halfStepM * dx, y + halfStepM * dy) - groundHeightM(ground, x - halfStepM * dx, y - halfStepM * dy)) / (2 * halfStepM)
  return Math.atan(Math.hypot(rise(ny, -nx), rise(nx, ny))) * DEG
}

/** Each sample distance's cosine and sine of its angle at the Moon's center, and where the fine terrain stops. */
function raySteps(meta: CustomMeta): { cos: Float64Array; sin: Float64Array; near: number } {
  const distances = rayDistances()
  const cos = new Float64Array(distances.length)
  const sin = new Float64Array(distances.length)
  let near = 0
  for (let i = 0; i < distances.length; i += 1) {
    cos[i] = Math.cos(distances[i] / MOON_RADIUS_M)
    sin[i] = Math.sin(distances[i] / MOON_RADIUS_M)
    if (distances[i] <= meta.near_polar_m) near = i + 1
  }
  return { cos, sin, near }
}

let steps: { meta: CustomMeta; value: ReturnType<typeof raySteps> } | null = null

/** A point's skylines and where it stands. */
export interface PointHorizons {
  /** The ground's height at the point (m). */
  heightM: number
  /** For each observer height asked for, the highest terrain angle (degrees) at each of `AZIMUTHS` bearings from north, clockwise. */
  masks: Float32Array[]
}

/**
 * The skyline from a map-plane point, for observers at each of `obsHeightsM` above its ground. One
 * pass over the terrain serves every height: only where the observer stands differs between them.
 */
export function pointHorizons(ground: PolarGround, x: number, y: number, obsHeightsM: number[]): PointHorizons {
  const { meta, polarFar, block } = ground
  const { half_m: half, res_m: res, size, quant_m: quant, far_res_m: farRes, far_size: farSize } = meta.polar
  if (steps?.meta !== meta) steps = { meta, value: raySteps(meta) }
  const { cos, sin, near } = steps.value
  const { lat, lon } = polarLatLon(x, y)
  const { east, north, up } = enuBasis(lat, lon)
  const heightM = groundHeightM(ground, x, y)
  const heights = obsHeightsM.length
  const siteRadius = obsHeightsM.map((obs) => MOON_RADIUS_M + heightM + obs)
  const masks = obsHeightsM.map(() => new Float32Array(AZIMUTHS))
  const best = new Float64Array(heights)
  const { col0, row0, width, values } = block
  const twoR = 2 * MOON_RADIUS_M
  const lastFine = size - 2
  const lastFar = farSize - 2
  const count = cos.length
  for (let a = 0; a < AZIMUTHS; a += 1) {
    const c = Math.cos(a * AZ_STEP_DEG * RAD)
    const s = Math.sin(a * AZ_STEP_DEG * RAD)
    const hx = c * north[0] + s * east[0]
    const hy = c * north[1] + s * east[1]
    const hz = c * north[2] + s * east[2]
    best.fill(Number.NEGATIVE_INFINITY)
    for (let i = 0; i < count; i += 1) {
      const cd = cos[i]
      const sd = sin[i]
      const px = cd * up[0] + sd * hx
      const py = cd * up[1] + sd * hy
      const pz = cd * up[2] + sd * hz
      // South polar stereographic, straight from the direction: x along 90° E, y along 0° E.
      const scale = twoR / (1 - pz)
      const mapX = scale * py
      const mapY = scale * px
      let height: number
      if (i < near) {
        const col = (mapX + half) / res - 0.5
        const row = (half - mapY) / res - 0.5
        const r0 = Math.max(0, Math.min(lastFine, Math.floor(row)))
        const c0 = Math.max(0, Math.min(lastFine, Math.floor(col)))
        const fr = row - r0
        const fc = col - c0
        const at = (r0 - row0) * width + (c0 - col0)
        const top = values[at] * (1 - fc) + values[at + 1] * fc
        const bottom = values[at + width] * (1 - fc) + values[at + width + 1] * fc
        height = (top * (1 - fr) + bottom * fr) * quant
      } else {
        const col = (mapX + half) / farRes - 0.5
        const row = (half - mapY) / farRes - 0.5
        const r0 = Math.max(0, Math.min(lastFar, Math.floor(row)))
        const c0 = Math.max(0, Math.min(lastFar, Math.floor(col)))
        const fr = row - r0
        const fc = col - c0
        const at = r0 * farSize + c0
        const top = polarFar[at] * (1 - fc) + polarFar[at + 1] * fc
        const bottom = polarFar[at + farSize] * (1 - fc) + polarFar[at + farSize + 1] * fc
        height = (top * (1 - fr) + bottom * fr) * quant
      }
      // The terrain point is `radius` from the Moon's center, the observer `siteRadius` along `up`:
      // its height over the observer's level, over its distance along that level.
      const radius = MOON_RADIUS_M + height
      const along = radius * sd
      const rise = radius * cd
      for (let h = 0; h < heights; h += 1) {
        const tangent = (rise - siteRadius[h]) / along
        if (tangent > best[h]) best[h] = tangent
      }
    }
    for (let h = 0; h < heights; h += 1) masks[h][a] = Math.atan(best[h]) * DEG
  }
  return { heightM, masks }
}

/** The skyline's height (degrees) at a bearing, read between its two nearest rays: `horizonAt` for a mask held as numbers. */
export function maskAt(mask: Float32Array, azDeg: number): number {
  const position = (((azDeg % 360) + 360) % 360) / AZ_STEP_DEG
  const i = Math.floor(position)
  const f = position - i
  return mask[i % AZIMUTHS] * (1 - f) + mask[(i + 1) % AZIMUTHS] * f
}
