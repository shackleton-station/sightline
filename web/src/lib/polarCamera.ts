/**
 * The geometry of one continuous view of the Moon, from the whole disk down to a ridge at the pole.
 * (How the view moves under a drag or a flight is in lib/trackball.ts.)
 * Seen from far away (orthographic): screen coordinates run -1..1 across the Moon's disk at zoom 1,
 * x to the right and y up. Vectors are unit vectors in MOON_ME (x toward 0° E, y toward 90° E, z north).
 *
 * Unlike lib/globe.ts, the middle of the view can be anywhere, the pole included. Over most of the
 * Moon north is up. Near a pole "north" spins around under the camera, so there the view turns to
 * the way polar maps are printed: at the south pole, 0° longitude (the side facing Earth) is up.
 */

export type Vec3 = readonly [number, number, number]

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
/**
 * Between these latitudes (degrees from the equator) the view turns from north-up to the polar map's
 * way up. The turn is finished well outside the Atlas's computed ground (its corners reach 82.9° S),
 * so the map never turns while that ground is in the middle of the view.
 */
const TURN_FROM_DEG = 72
/** From this latitude to the pole, the polar map's way up. */
export const POLAR_UP_FROM_DEG = 82

export function unitOf(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * RAD
  const lon = lonDeg * RAD
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}

export function latLonOf(v: Vec3): { lat: number; lon: number } {
  return { lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) * DEG, lon: Math.atan2(v[1], v[0]) * DEG }
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2])
  return length > 0 ? scale(a, 1 / length) : [0, 0, 1]
}

/** The part of `a` at right angles to the unit vector `axis`, as a unit vector; null if there is none. */
function across(a: Vec3, axis: Vec3): Vec3 | null {
  const flat = add(a, scale(axis, -dot(a, axis)))
  return Math.hypot(flat[0], flat[1], flat[2]) > 1e-9 ? normalize(flat) : null
}

/**
 * Which way is up the screen when `center` is in the middle of the view. North, except near a pole,
 * where it turns smoothly to the polar map's way up.
 *
 * No rule for "up" can be smooth over a whole sphere; north-up breaks at the poles. This one moves the
 * break off the poles to a single point on the far side: halfway through the turn at 180° longitude
 * (77° S; at the north pole, 77° N at 0°), where north and the polar map's way up are opposite and
 * cancel. The two are mixed as arrows, not as an angle, so everywhere else it is smooth, across 180° too.
 */
export function screenUp(center: Vec3): Vec3 {
  const lat = Math.asin(Math.max(-1, Math.min(1, center[2]))) * DEG
  const polar = across([center[2] < 0 ? 1 : -1, 0, 0], center)
  const north = across([0, 0, 1], center)
  if (!north) return polar ?? [1, 0, 0]
  if (!polar) return north
  const t = Math.max(0, Math.min(1, (Math.abs(lat) - TURN_FROM_DEG) / (POLAR_UP_FROM_DEG - TURN_FROM_DEG)))
  const share = t * t * (3 - 2 * t)
  if (share === 0) return north
  return across(add(scale(north, 1 - share), scale(polar, share)), center) ?? north
}

/** Where a point lands on the disk (zoom 1), and whether it faces the viewer. */
export function project(point: Vec3, center: Vec3, up: Vec3): { x: number; y: number; facing: number } {
  const right = cross(up, center)
  return { x: dot(point, right), y: dot(point, up), facing: dot(point, center) }
}

/** The Moon point under a spot on the disk (zoom 1), or null outside it. */
export function unproject(x: number, y: number, center: Vec3, up: Vec3): Vec3 | null {
  const rr = x * x + y * y
  if (rr > 1) return null
  const right = cross(up, center)
  return normalize(add(add(scale(right, x), scale(up, y)), scale(center, Math.sqrt(1 - rr))))
}

/** Kilometers of ground across one screen pixel in the middle of the view. */
export function kmPerPixel(zoom: number, sidePx: number, radiusKm: number): number {
  return (2 * radiusKm) / (sidePx * zoom)
}
