import type { NearbyMeta, SiteInfo } from '../data/contract'
import { polarLatLon, polarXY } from './customModel'

/** What a nearby map shows. Longest without Sun is the one where lower is better. */
export type NearbyMetric = 'both' | 'sun' | 'earth' | 'sunGap'

/** One month of a map, one value per cell, row by row from the top. */
export interface NearbyMonth {
  sun: Uint8Array
  earth: Uint8Array
  both: Uint8Array
  sunGapH: Uint16Array
}

/** A month's bytes: three byte planes, then the gap as little-endian uint16 (see NearbyMeta). */
export function decodeNearbyMonth(buffer: ArrayBuffer, size: number): NearbyMonth {
  const n = size * size
  if (buffer.byteLength !== 5 * n) throw new Error(`expected ${5 * n} bytes, got ${buffer.byteLength}`)
  return {
    sun: new Uint8Array(buffer, 0, n),
    earth: new Uint8Array(buffer, n, n),
    both: new Uint8Array(buffer, 2 * n, n),
    // Three planes of odd size leave this unaligned, and typed arrays need alignment.
    sunGapH: new Uint16Array(buffer.slice(3 * n)),
  }
}

export function cellValue(month: NearbyMonth, metric: NearbyMetric, cell: number): number {
  if (metric === 'sunGap') return month.sunGapH[cell]
  return month[metric][cell]
}

/** The largest longest-gap in the map, so the map's shade can run from none to it. */
export function largestGapH(month: NearbyMonth): number {
  return month.sunGapH.reduce((largest, gap) => Math.max(largest, gap), 0)
}

/**
 * How good a cell is, 0 to 100, for shading. Percentages use their whole range, so a month looks the
 * way it should next to another. Hours without Sun run from the map's worst to none.
 */
export function goodnessPct(metric: NearbyMetric, value: number, worstGapH: number): number {
  if (metric !== 'sunGap') return value
  return worstGapH === 0 ? 100 : 100 * (1 - value / worstGapH)
}

export function centerCell(meta: NearbyMeta): number {
  const middle = (meta.size - 1) / 2
  return middle * meta.size + middle
}

/** A cell's offset from the site (m): x to the right, y up the map. */
export function cellOffsetM(meta: NearbyMeta, cell: number): { x: number; y: number } {
  const middle = (meta.size - 1) / 2
  const row = Math.floor(cell / meta.size)
  const col = cell % meta.size
  return { x: (col - middle) * meta.step_m, y: (middle - row) * meta.step_m }
}

export function cellDistanceM(meta: NearbyMeta, cell: number): number {
  const { x, y } = cellOffsetM(meta, cell)
  return Math.hypot(x, y)
}

/** A cell's coordinates, rounded to about a meter or finer at these latitudes. */
export function cellLatLon(meta: NearbyMeta, cell: number): { lat: number; lon: number } {
  const { x, y } = cellOffsetM(meta, cell)
  const { lat, lon } = polarLatLon(meta.center_x_m + x, meta.center_y_m + y)
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(4)) }
}

/** The cell holding a point; null outside the map. */
export function cellAt(meta: NearbyMeta, lat: number, lon: number): number | null {
  const { x, y } = polarXY(lat, lon)
  const middle = (meta.size - 1) / 2
  const col = middle + Math.round((x - meta.center_x_m) / meta.step_m)
  const row = middle - Math.round((y - meta.center_y_m) / meta.step_m)
  if (col < 0 || col >= meta.size || row < 0 || row >= meta.size) return null
  return row * meta.size + col
}

/** The site whose nearby map covers a point: itself, or the closest such site around it. */
export function nearbyAnchor(site: SiteInfo, sites: SiteInfo[]): SiteInfo | null {
  if (site.nearby_half_m) return site
  if (site.lat > -80) return null
  const point = polarXY(site.lat, site.lon)
  let best: SiteInfo | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of sites) {
    if (!candidate.nearby_half_m) continue
    const center = polarXY(candidate.lat, candidate.lon)
    const dx = Math.abs(point.x - center.x)
    const dy = Math.abs(point.y - center.y)
    const distance = Math.hypot(dx, dy)
    if (dx <= candidate.nearby_half_m && dy <= candidate.nearby_half_m && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function slopeDeg(slope: Uint8Array, quantDeg: number, cell: number): number {
  return slope[cell] * quantDeg
}

/** Whether a cell is gentle enough; no limit means every cell is. */
export function withinSlope(slope: Uint8Array, quantDeg: number, cell: number, limitDeg: number | null): boolean {
  return limitDeg === null || slopeDeg(slope, quantDeg, cell) <= limitDeg
}

/** Share of the map no steeper than a limit, in percent. */
export function shareWithinSlope(slope: Uint8Array, quantDeg: number, limitDeg: number): number {
  let count = 0
  for (let cell = 0; cell < slope.length; cell += 1) {
    if (slope[cell] * quantDeg <= limitDeg) count += 1
  }
  return (100 * count) / slope.length
}

export interface NearbyRange {
  low: number
  high: number
}

/** The range of a metric across the map's gentle-enough cells; null if none are. */
export function valueRange(
  month: NearbyMonth,
  metric: NearbyMetric,
  slope: Uint8Array,
  quantDeg: number,
  limitDeg: number | null,
): NearbyRange | null {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (let cell = 0; cell < slope.length; cell += 1) {
    if (!withinSlope(slope, quantDeg, cell, limitDeg)) continue
    const value = cellValue(month, metric, cell)
    if (value < low) low = value
    if (value > high) high = value
  }
  return Number.isFinite(low) ? { low, high } : null
}

/** Spots closer than this are really one place, so the list shows different places. */
export const MIN_SPOT_SEPARATION_M = 500

/**
 * The best places on the map, better than the site itself (or the cell `from`, for a point that is not
 * the map's centre) and gentle enough, best first. When values tie, the nearest comes first: reaching
 * a closer place is the smaller change to a mission.
 */
export function bestSpots(
  meta: NearbyMeta,
  month: NearbyMonth,
  metric: NearbyMetric,
  slope: Uint8Array,
  limitDeg: number | null,
  count: number,
  from: number = centerCell(meta),
): number[] {
  const center = from
  const origin = cellOffsetM(meta, from)
  const away = (cell: number) => {
    const at = cellOffsetM(meta, cell)
    return Math.hypot(at.x - origin.x, at.y - origin.y)
  }
  const lowerIsBetter = metric === 'sunGap'
  const here = cellValue(month, metric, center)
  const candidates: number[] = []
  for (let cell = 0; cell < slope.length; cell += 1) {
    if (cell === center || !withinSlope(slope, meta.slope_quant_deg, cell, limitDeg)) continue
    const value = cellValue(month, metric, cell)
    if (lowerIsBetter ? value < here : value > here) candidates.push(cell)
  }
  candidates.sort((a, b) => {
    const difference = cellValue(month, metric, a) - cellValue(month, metric, b)
    if (difference !== 0) return lowerIsBetter ? difference : -difference
    return away(a) - away(b)
  })
  const chosen: number[] = []
  for (const cell of candidates) {
    const place = cellOffsetM(meta, cell)
    const apart = chosen.every((other) => {
      const taken = cellOffsetM(meta, other)
      return Math.hypot(place.x - taken.x, place.y - taken.y) >= MIN_SPOT_SEPARATION_M
    })
    if (apart) chosen.push(cell)
    if (chosen.length === count) break
  }
  return chosen
}
