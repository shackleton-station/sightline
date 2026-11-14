import type { TrackPoint } from '../data/contract'

export type Vec3 = [number, number, number]

/** Wrap a fractional hour into 0..length, so the time-lapse loops over the track. */
export function wrapHour(hour: number, length: number): number {
  return ((hour % length) + length) % length
}

/**
 * How many hours of the track the time-lapse should loop over, so it wraps without a jump.
 *
 * A calendar month of hours (e.g. 744) is longer than the Sun's cycle as seen from the Moon
 * (a synodic month, about 709 h), so looping the whole track snaps the Sun, and the globe
 * camera that follows it, about 16° at the wrap. Instead loop up to the hour, in the second half
 * of the track, whose Sun direction is closest to the first hour's: the last hour then blends into
 * the first by about one ordinary hourly step.
 */
export function loopHours(track: readonly TrackPoint[]): number {
  if (track.length < 4) return track.length
  const [x0, y0, z0] = track[0].sun_vec_me
  let best = track.length
  let bestDot = -Infinity
  for (let i = Math.ceil(track.length / 2); i < track.length; i++) {
    const [x, y, z] = track[i].sun_vec_me
    const dot = x * x0 + y * y0 + z * z0
    if (dot > bestDot) {
      bestDot = dot
      best = i
    }
  }
  return best
}

/**
 * The Sun direction at a fractional hour of the track, blended between the two nearest hourly
 * points, looping over the first `loop` hours (the last of them blends into the first). Only for
 * drawing light: the Sun moves about 0.5° an hour as seen from the Moon, so a straight blend
 * renormalized is well within the precision budget. Numbers on the page always come from whole
 * track rows.
 */
export function sunAt(track: readonly TrackPoint[], hour: number, loop = track.length): Vec3 {
  const length = Math.max(1, Math.min(loop, track.length))
  const at = wrapHour(hour, length)
  const i = Math.floor(at)
  const t = at - i
  const a = track[i].sun_vec_me
  const b = track[(i + 1) % length].sun_vec_me
  const x = a[0] + (b[0] - a[0]) * t
  const y = a[1] + (b[1] - a[1]) * t
  const z = a[2] + (b[2] - a[2]) * t
  const norm = Math.hypot(x, y, z) || 1
  return [x / norm, y / norm, z / norm]
}
