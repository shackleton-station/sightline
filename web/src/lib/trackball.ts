import { latLonOf, screenUp, unitOf, type Vec3 } from './polarCamera'

/**
 * A camera that holds its own orientation, so nothing special happens at the poles.
 *
 * The old camera stored only where the view was centered and always put north up. Near a pole that
 * breaks down: north is in every direction at once, so a small drag swings the whole picture round.
 * Here the camera keeps two directions, the point in the middle of the view (`center`) and which
 * way is up the screen (`up`), and a drag turns both together, the way a ball turns under a hand.
 * When the hand lets go, `up` eases back to the usual way up for that place (north, or the polar
 * map's way up near a pole), so the picture is never left lying at an odd angle.
 *
 * Vectors are unit vectors in MOON_ME: x toward 0° E, y toward 90° E, z north.
 */
export interface Pose {
  center: Vec3
  up: Vec3
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2])

function unit(a: Vec3, otherwise: Vec3): Vec3 {
  const size = length(a)
  return size > 1e-12 ? scale(a, 1 / size) : otherwise
}

/** `v` turned by `angle` radians around the unit vector `axis` (counter-clockwise seen from its tip). */
export function turn(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)))
}

/** The turn that carries the unit vector `from` to `to` by the shortest way: its axis and angle. */
export function turnBetween(from: Vec3, to: Vec3): { axis: Vec3; angle: number } {
  const normal = cross(from, to)
  const sin = length(normal)
  return sin < 1e-12 ? { axis: [0, 0, 1], angle: 0 } : { axis: scale(normal, 1 / sin), angle: Math.atan2(sin, dot(from, to)) }
}

/** A pose with `up` made exactly square to `center` again; rounding lets it drift over many turns. */
export function squared(pose: Pose): Pose {
  const center = unit(pose.center, [0, 0, 1])
  const flat = add(pose.up, scale(center, -dot(pose.up, center)))
  return { center, up: unit(flat, screenUp(center)) }
}

/** The whole camera turned by one turn. */
export function turnPose(pose: Pose, axis: Vec3, angle: number): Pose {
  return angle === 0 ? pose : squared({ center: turn(pose.center, axis, angle), up: turn(pose.up, axis, angle) })
}

/**
 * The pose after the ground is dragged so that the point `held` sits where `under` (the point now
 * under the pointer) was. Both directions turn together, so the picture never spins on its own.
 */
export function dragPose(pose: Pose, held: Vec3, under: Vec3): Pose {
  const { axis, angle } = turnBetween(under, held)
  return turnPose(pose, axis, angle)
}

/** How far `up` must turn around `center` to reach `goalUp`, in radians, by the shorter way. */
export function twistTo(pose: Pose, goalUp: Vec3): number {
  const goal = add(goalUp, scale(pose.center, -dot(goalUp, pose.center)))
  if (length(goal) < 1e-9) return 0
  return Math.atan2(dot(cross(pose.up, goal), pose.center), dot(pose.up, goal))
}

/** The pose with `up` turned part of the way (0 to 1) toward the usual way up for where it is looking. */
export function leveled(pose: Pose, share: number): Pose {
  return squared({ center: pose.center, up: turn(pose.up, pose.center, twistTo(pose, screenUp(pose.center)) * share) })
}

/**
 * Part of the way (0 to 1) along a flight from one pose to a place: the middle of the view goes
 * along the great circle, and the picture turns steadily so it arrives the right way up.
 */
export function flightPose(from: Pose, goal: Vec3, t: number): Pose {
  const { axis, angle } = turnBetween(from.center, goal)
  const arrived = turnPose(from, axis, angle)
  const twist = twistTo({ center: goal, up: arrived.up }, screenUp(goal))
  const along = turnPose(from, axis, angle * t)
  return squared({ center: along.center, up: turn(along.up, along.center, twist * t) })
}

/** A pose looking at a latitude and longitude (degrees), the usual way up. */
export function poseAt(lat: number, lon: number): Pose {
  const center = unitOf(lat, lon)
  return { center, up: screenUp(center) }
}

/** The latitude and longitude (degrees) in the middle of a pose's view. */
export function viewOf(pose: Pose): { lat: number; lon: number } {
  return latLonOf(pose.center)
}
