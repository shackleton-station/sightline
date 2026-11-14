const MOON_RADIUS_M = 1_737_400
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Position on the whole-Moon map, as fractions from the top left; 0° longitude is centered. */
export function moonMapPosition(latDeg: number, lonDeg: number): { x: number; y: number } {
  const lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180
  return { x: (lon + 180) / 360, y: (90 - latDeg) / 180 }
}

/** Latitude and longitude for a click on the whole-Moon map. */
export function moonMapLatLon(x: number, y: number): { lat: number; lon: number } {
  return { lat: 90 - y * 180, lon: x * 360 - 180 }
}

/** South polar stereographic x and y (m), matching the DEM's projection. */
function polarXY(latDeg: number, lonDeg: number): { x: number; y: number } {
  const rho = 2 * MOON_RADIUS_M * Math.tan(((90 + latDeg) * RAD) / 2)
  return { x: rho * Math.sin(lonDeg * RAD), y: rho * Math.cos(lonDeg * RAD) }
}

/** Position on the polar close-up as fractions from the top left, or null if off the image. */
export function poleMapPosition(
  latDeg: number,
  lonDeg: number,
  halfWidthM: number,
): { x: number; y: number } | null {
  if (latDeg > 0) return null
  const { x, y } = polarXY(latDeg, lonDeg)
  if (Math.abs(x) > halfWidthM || Math.abs(y) > halfWidthM) return null
  return { x: (x + halfWidthM) / (2 * halfWidthM), y: (halfWidthM - y) / (2 * halfWidthM) }
}

/** Latitude and longitude for a click on the polar close-up (fractions from the top left). */
export function poleMapLatLon(x: number, y: number, halfWidthM: number): { lat: number; lon: number } {
  const px = (2 * x - 1) * halfWidthM
  const py = (1 - 2 * y) * halfWidthM
  const rho = Math.hypot(px, py)
  return { lat: 2 * Math.atan(rho / (2 * MOON_RADIUS_M)) * DEG - 90, lon: Math.atan2(px, py) * DEG }
}

/** The point on the Moon with the Sun overhead, from a direction vector in MOON_ME. */
export function subPoint(vector: [number, number, number]): { lat: number; lon: number } {
  const [x, y, z] = vector
  return { lat: Math.atan2(z, Math.hypot(x, y)) * DEG, lon: Math.atan2(y, x) * DEG }
}

export interface NightStrip {
  lat: number
  /** Night longitudes as [west, east] in -180..180; a strip crossing ±180° becomes two ranges. */
  ranges: [number, number][]
}

function wrap(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/** Half-degree-accurate night shading: for each band of latitude, the longitudes in darkness. */
export function nightStrips(
  sub: { lat: number; lon: number },
  stepDeg = 2,
): NightStrip[] {
  const strips: NightStrip[] = []
  for (let lat = -90 + stepDeg / 2; lat < 90; lat += stepDeg) {
    const cosine = -Math.tan(lat * RAD) * Math.tan(sub.lat * RAD)
    if (cosine >= 1) {
      // The Sun never rises at this latitude right now: dark all the way around.
      strips.push({ lat, ranges: [[-180, 180]] })
      continue
    }
    if (cosine <= -1) {
      strips.push({ lat, ranges: [] })
      continue
    }
    const dayHalfWidth = Math.acos(cosine) * DEG
    const west = wrap(sub.lon + dayHalfWidth)
    const east = wrap(sub.lon - dayHalfWidth)
    strips.push({
      lat,
      ranges:
        west <= east
          ? [[west, east]]
          : [
              [west, 180],
              [-180, east],
            ],
    })
  }
  return strips
}
