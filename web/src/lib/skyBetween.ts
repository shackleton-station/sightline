import type { TrackPoint } from '../data/contract'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Where the Sun and Earth are drawn (degrees). */
export interface SkyPair {
  sunAz: number
  sunEl: number
  earthAz: number
  earthEl: number
}

type Vec3 = [number, number, number]

const toVector = (azDeg: number, elDeg: number): Vec3 => {
  const az = azDeg * RAD
  const el = elDeg * RAD
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)]
}

const toAzEl = ([east, north, up]: Vec3): { az: number; el: number } => ({
  az: (((Math.atan2(east, north) * DEG) % 360) + 360) % 360,
  el: Math.atan2(up, Math.hypot(east, north)) * DEG,
})

/**
 * The direction a share `t` (0 to 1) of the way from one direction to another along the great
 * circle through them: what a body moving steadily across the sky passes through. Near straight up,
 * where a body's azimuth swings round fast, this is still a short, even step; azimuth and elevation
 * interpolated on their own would swing the long way round.
 */
export function directionBetween(fromAz: number, fromEl: number, toAz: number, toEl: number, t: number): { az: number; el: number } {
  if (t <= 0) return { az: fromAz, el: fromEl }
  if (t >= 1) return { az: toAz, el: toEl }
  const a = toVector(fromAz, fromEl)
  const b = toVector(toAz, toEl)
  const cos = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const angle = Math.acos(cos)
  if (angle < 1e-9) return { az: toAz, el: toEl }
  const sin = Math.sin(angle)
  const wa = Math.sin((1 - t) * angle) / sin
  const wb = Math.sin(t * angle) / sin
  return toAzEl([wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]])
}

/**
 * The Sun and Earth at a moment between two hours of the track (`hour` may have a fraction): each
 * along the great circle from one hour's position to the next. At a whole hour it is that hour's own
 * position exactly. Outside the track it holds the end.
 */
export function skyAt(track: TrackPoint[], hour: number): SkyPair {
  const last = track.length - 1
  const clamped = Math.min(Math.max(hour, 0), last)
  const from = Math.floor(clamped)
  const t = clamped - from
  const a = track[from]
  if (t === 0 || from >= last) return { sunAz: a.sun_az, sunEl: a.sun_el, earthAz: a.earth_az, earthEl: a.earth_el }
  const b = track[from + 1]
  const sun = directionBetween(a.sun_az, a.sun_el, b.sun_az, b.sun_el, t)
  const earth = directionBetween(a.earth_az, a.earth_el, b.earth_az, b.earth_el, t)
  return { sunAz: sun.az, sunEl: sun.el, earthAz: earth.az, earthEl: earth.el }
}
