/** A direction in degrees: azimuth clockwise from north, elevation above the horizontal. */
export interface AzEl {
  az: number
  el: number
}

/**
 * Split a track where azimuth wraps past 0°/360°, so a line chart doesn't draw a stray stroke across
 * the whole panorama.
 */
export function splitAtWrap(points: AzEl[], maxJumpDeg = 180): AzEl[][] {
  const segments: AzEl[][] = []
  let current: AzEl[] = []
  for (const point of points) {
    const previous = current[current.length - 1]
    if (previous && Math.abs(point.az - previous.az) > maxJumpDeg) {
      segments.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/** Closes the horizon at 360° by repeating its first point, so the silhouette spans the full width. */
export function closeHorizon(horizon: AzEl[]): AzEl[] {
  if (horizon.length === 0) return []
  return [...horizon, { az: 360, el: horizon[0].el }]
}

/** Elevation axis range (degrees) covering every value, padded and rounded out to whole degrees. */
export function elevationDomain(values: number[], padDeg = 0.5): [number, number] {
  if (values.length === 0) return [-1, 1]
  return [Math.floor(Math.min(...values) - padDeg), Math.ceil(Math.max(...values) + padDeg)]
}

/** How far below the lowest horizon the axis extends; deeper paths run off the chart. */
const BELOW_HORIZON_DEG = 10

/**
 * Elevation axis for a site: its horizon plus the Sun and Earth paths, cut off well below the
 * horizon. Away from the pole, the Sun sinks tens of degrees, which would squash the terrain.
 */
export function panoramaDomain(
  horizon: AzEl[],
  track: { sun_el: number; earth_el: number }[],
): [number, number] {
  const terrain = horizon.map((point) => point.el)
  const paths = track.flatMap((point) => [point.sun_el, point.earth_el])
  const [low, high] = elevationDomain([...terrain, ...paths])
  return [Math.max(low, Math.floor(Math.min(...terrain)) - BELOW_HORIZON_DEG), high]
}

/** One axis covering both ranges, so side-by-side panoramas share a scale. */
export function combineDomains(a: [number, number], b: [number, number]): [number, number] {
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])]
}
