import type { HorizonPoint } from '../data/contract'
import { EARTH_RADIUS_KM, horizonAt, MOON_RADIUS_M, SUN_RADIUS_KM, unitVector } from './customModel'

/**
 * The geometry of the Surface tab: standing at the site, 2 m up, looking at the pipeline's horizon
 * and at the Sun and Earth where the track puts them. Plain functions, so the picture can be checked
 * against the data without a graphics card (surfaceView.test.ts). The Three.js view (three/SurfaceViewer)
 * draws with a camera set from the same numbers.
 *
 * Directions are azimuth (degrees from north, clockwise) and elevation (degrees above eye level), as
 * in the track. Vectors are east, north, up.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export type Vec3 = [number, number, number]

/** Where the visitor looks, and through what lens. */
export interface Look {
  /** The azimuth in the middle of the picture. */
  headingDeg: number
  /** The true elevation in the middle of the picture. */
  pitchDeg: number
  /** The field of view from the bottom of the picture to the top. */
  fovDeg: number
  /** How many times taller heights are drawn. 1 is true scale. */
  stretch: number
}

/** A look, on a picture this many times wider than tall. */
export interface Lens extends Look {
  aspect: number
}

/** The narrowest and widest fields of view offered (degrees, bottom to top). */
export const FOV_MIN_DEG = 2
export const FOV_MAX_DEG = 80
/** The picture's middle stays this far from straight up or down, as drawn, so "up" stays defined. */
const DRAWN_PITCH_MAX_DEG = 85

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** An azimuth brought into 0 to 360. */
export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** The shortest turn from one azimuth to another: negative is to the left, at most half a turn. */
export function turnBetween(fromDeg: number, toDeg: number): number {
  return wrap360(toDeg - fromDeg + 180) - 180
}

/**
 * The elevation a true elevation is drawn at when heights are stretched. The stretch multiplies
 * every height above or below eye level (the tangent of the elevation), as a relief map does: it is
 * the whole scene scaled along "up". Eye level stays put and straight up stays straight up.
 */
export function drawnEl(elDeg: number, stretch: number): number {
  if (stretch === 1) return elDeg
  return Math.atan2(stretch * Math.sin(elDeg * RAD), Math.cos(elDeg * RAD)) * DEG
}

/** The true elevation of something drawn at this elevation: the inverse of `drawnEl`. */
export function trueEl(drawnDeg: number, stretch: number): number {
  if (stretch === 1) return drawnDeg
  return Math.atan2(Math.sin(drawnDeg * RAD), stretch * Math.cos(drawnDeg * RAD)) * DEG
}

/** The unit vector toward a direction in the sky. */
export function skyVector(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * RAD
  const el = elDeg * RAD
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)]
}

/** The camera's right, up and forward for a look. The horizon is always level: there is no roll. */
export function cameraAxes(look: Look): { right: Vec3; up: Vec3; forward: Vec3 } {
  const heading = look.headingDeg * RAD
  const forward = skyVector(look.headingDeg, drawnEl(look.pitchDeg, look.stretch))
  const right: Vec3 = [Math.cos(heading), -Math.sin(heading), 0]
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  return { right, up, forward }
}

export interface ScreenPoint {
  /** Across the picture: -1 is its left edge, 1 its right edge. */
  x: number
  /** Up the picture: -1 is its bottom edge, 1 its top edge. */
  y: number
  /** False for a direction behind the visitor, which is on no part of the picture. */
  inFront: boolean
}

/** Where a direction in the sky lands on the picture. */
export function project(lens: Lens, azDeg: number, elDeg: number): ScreenPoint {
  const { right, up, forward } = cameraAxes(lens)
  const point = skyVector(azDeg, drawnEl(elDeg, lens.stretch))
  const depth = dot(point, forward)
  const half = Math.tan((lens.fovDeg * RAD) / 2)
  return {
    x: dot(point, right) / (Math.abs(depth) * half * lens.aspect),
    y: dot(point, up) / (Math.abs(depth) * half),
    inFront: depth > 1e-9,
  }
}

/** The direction in the sky under a point of the picture: the inverse of `project`. */
export function unproject(lens: Lens, x: number, y: number): { az: number; el: number } {
  const { right, up, forward } = cameraAxes(lens)
  const half = Math.tan((lens.fovDeg * RAD) / 2)
  const across = x * half * lens.aspect
  const along = y * half
  const east = forward[0] + across * right[0] + along * up[0]
  const north = forward[1] + across * right[1] + along * up[1]
  const upward = forward[2] + across * right[2] + along * up[2]
  const drawn = Math.atan2(upward, Math.hypot(east, north)) * DEG
  return { az: wrap360(Math.atan2(east, north) * DEG), el: trueEl(drawn, lens.stretch) }
}

/** How many pixels one degree covers in the middle of a picture this tall. */
export function pixelsPerDegree(fovDeg: number, heightPx: number): number {
  return (heightPx / 2 / Math.tan((fovDeg * RAD) / 2)) * RAD
}

/** How many degrees the picture spans from its left edge to its right, through its middle. */
export function acrossDeg(lens: Lens): number {
  return 2 * Math.atan(lens.aspect * Math.tan((lens.fovDeg * RAD) / 2)) * DEG
}

/** The outline of a disk on the picture: its middle and half-widths, in the units of `project`. */
export function diskOutline(lens: Lens, azDeg: number, elDeg: number, radiusDeg: number): ScreenPoint & { rx: number; ry: number } {
  const middle = project(lens, azDeg, elDeg)
  const top = project(lens, azDeg, elDeg + radiusDeg)
  const side = project(lens, azDeg + radiusDeg / Math.max(Math.cos(elDeg * RAD), 0.01), elDeg)
  return { ...middle, rx: Math.abs(side.x - middle.x), ry: Math.abs(top.y - middle.y) }
}

const TICK_STEPS_DEG = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30]

/**
 * Marks for a scale of true elevation down one side of the picture (at `x`, in the units of
 * `project`): round elevations at least `minGapPx` apart, each with where it falls up the picture.
 * When heights are stretched the marks spread apart, which is the stretch made visible.
 */
export function elevationMarks(lens: Lens, x: number, heightPx: number, minGapPx: number): { el: number; y: number; stepDeg: number }[] {
  const low = unproject(lens, x, -1).el
  const high = unproject(lens, x, 1).el
  const needDeg = ((high - low) / heightPx) * minGapPx
  const stepDeg = TICK_STEPS_DEG.find((step) => step >= needDeg) ?? 30
  const marks: { el: number; y: number; stepDeg: number }[] = []
  for (let k = Math.ceil(low / stepDeg); k * stepDeg <= high; k += 1) {
    const el = k * stepDeg
    // The azimuth under this side of the picture changes with height, so find it in two passes.
    const first = project(lens, unproject(lens, x, 0).az, el).y
    const y = project(lens, unproject(lens, x, first).az, el).y
    if (Math.abs(y) <= 1) marks.push({ el: Math.round(el * 10) / 10, y, stepDeg })
  }
  return marks
}

/** A look kept inside what the view can show. */
export function boundedLook(look: Look): Look {
  const stretch = Math.max(1, look.stretch)
  const pitchMax = trueEl(DRAWN_PITCH_MAX_DEG, stretch)
  return {
    headingDeg: wrap360(look.headingDeg),
    pitchDeg: clamp(look.pitchDeg, -pitchMax, pitchMax),
    fovDeg: clamp(look.fovDeg, FOV_MIN_DEG, FOV_MAX_DEG),
    stretch,
  }
}

/**
 * The look after dragging the picture by some pixels: the scene follows the pointer, so dragging
 * right turns the visitor left, and dragging down tips the view up.
 */
export function dragLook(look: Look, dxPx: number, dyPx: number, heightPx: number): Look {
  const perDegree = pixelsPerDegree(look.fovDeg, heightPx)
  const drawnPitch = drawnEl(look.pitchDeg, look.stretch)
  // Near the horizon a degree of turn is a degree on screen; looking up, it covers less.
  const turn = dxPx / perDegree / Math.max(Math.cos(drawnPitch * RAD), 0.2)
  return boundedLook({
    ...look,
    headingDeg: look.headingDeg - turn,
    pitchDeg: trueEl(clamp(drawnPitch + dyPx / perDegree, -DRAWN_PITCH_MAX_DEG, DRAWN_PITCH_MAX_DEG), look.stretch),
  })
}

/**
 * The elevation to put in the middle of the picture when facing a body, so the body and the skyline
 * under it are both in view when the lens allows: halfway between the two, with the body never more
 * than `share` of the picture's height from the middle. Low over the hills, it shows both; high in
 * the sky, it shows the body.
 */
export function framingPitch(bodyElDeg: number, skylineElDeg: number, look: Look, share = 0.25): number {
  // Near eye level a stretched picture takes in this much true elevation.
  const reach = (look.fovDeg / look.stretch) * share
  return bodyElDeg - clamp(bodyElDeg - skylineElDeg, -2 * reach, 2 * reach) / 2
}

/** The look turned to put a direction in the middle of the picture across, keeping the lens. */
export function faceToward(look: Look, azDeg: number, elDeg: number): Look {
  return boundedLook({ ...look, headingDeg: azDeg, pitchDeg: elDeg })
}

/**
 * How far the highest-standing point of a disk's rim is above the skyline under it (degrees).
 * Positive: some of the disk shows over the land. Negative: the land covers all of it.
 *
 * The skyline is the horizon file's 720 points joined by straight lines, which is also the top edge
 * of the land the view draws. Exact for that shape: on each straight piece the gap between the rim
 * and the line is greatest where their slopes match.
 */
export function diskClearanceDeg(horizon: HorizonPoint[], azDeg: number, elDeg: number, radiusDeg: number): number {
  const stepDeg = 360 / horizon.length
  // A degree of azimuth is narrower on the sky away from eye level.
  const perAz = Math.max(Math.cos(elDeg * RAD), 0.01)
  const gapAt = (u: number) => elDeg + Math.sqrt(Math.max(radiusDeg * radiusDeg - u * u, 0)) - horizonAt(horizon, azDeg + u / perAz)
  const first = Math.floor((azDeg - radiusDeg / perAz) / stepDeg)
  const last = Math.floor((azDeg + radiusDeg / perAz) / stepDeg)
  let best = Number.NEGATIVE_INFINITY
  for (let piece = first; piece <= last; piece += 1) {
    const from = Math.max((piece * stepDeg - azDeg) * perAz, -radiusDeg)
    const to = Math.min(((piece + 1) * stepDeg - azDeg) * perAz, radiusDeg)
    if (from > to) continue
    const slope = (horizonAt(horizon, (piece + 1) * stepDeg) - horizonAt(horizon, piece * stepDeg)) / (stepDeg * perAz)
    const matched = (-radiusDeg * slope) / Math.hypot(1, slope)
    best = Math.max(best, gapAt(from), gapAt(to), gapAt(clamp(matched, from, to)))
  }
  return best
}

/**
 * The share of a disk (0 to 1) that shows above the skyline: what the view draws. The pipeline's own
 * figure (`sun_frac`) treats the skyline under the disk as level, at its height under the disk's
 * middle; this follows the skyline's shape across the disk, so the two differ a little where the
 * land slopes under it.
 */
export function shownDiskShare(horizon: HorizonPoint[], azDeg: number, elDeg: number, radiusDeg: number, columns = 256): number {
  const perAz = Math.max(Math.cos(elDeg * RAD), 0.01)
  const width = (2 * radiusDeg) / columns
  let shown = 0
  for (let i = 0; i < columns; i += 1) {
    const u = -radiusDeg + (i + 0.5) * width
    const halfChord = Math.sqrt(radiusDeg * radiusDeg - u * u)
    const above = elDeg + halfChord - horizonAt(horizon, azDeg + u / perAz)
    shown += clamp(above, 0, 2 * halfChord) * width
  }
  return shown / (Math.PI * radiusDeg * radiusDeg)
}

/** The Sun's and Earth's angular radii (degrees) at one hour, from the site. */
export interface BodyRadii {
  sun: number
  earth: number
}

/**
 * The radius each disk appears to have, as the pipeline works it out (visibility.py): the angle
 * whose sine is the body's radius over its distance from the site.
 *
 * `positions` holds the Sun's then Earth's position from the Moon's center in MOON_ME (km), six
 * numbers an hour: the pipeline's ephemeris files. The site is put on the Moon's reference sphere;
 * its real height above it (a few km at most) changes Earth's size by under one part in 10,000.
 */
export function bodyRadiiDeg(positions: ArrayLike<number>, hour: number, latDeg: number, lonDeg: number): BodyRadii {
  const [x, y, z] = unitVector(latDeg, lonDeg)
  const siteKm = MOON_RADIUS_M / 1000
  const radius = (offset: number, bodyKm: number) => {
    const at = hour * 6 + offset
    const distKm = Math.hypot(positions[at] - x * siteKm, positions[at + 1] - y * siteKm, positions[at + 2] - z * siteKm)
    return Math.asin(bodyKm / distKm) * DEG
  }
  return { sun: radius(0, SUN_RADIUS_KM), earth: radius(3, EARTH_RADIUS_KM) }
}

/** The 16 compass points, for saying which way the visitor faces. */
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** "SW" for 226°. */
export function compassPoint(azDeg: number): string {
  return POINTS[Math.round(wrap360(azDeg) / 22.5) % 16]
}
