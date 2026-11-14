import { screenUp, unitOf, type Vec3 } from '../lib/polarCamera'
import { turn } from '../lib/trackball'
import type { GlobeFrame } from '../three/GlobeViewer'

/**
 * The fixed motion both globes follow, as a function of the seconds since it started, so two runs
 * (and the two sides of one run) draw the same pictures: the camera turns slowly and the Sun goes
 * through a month of the pipeline's hourly directions.
 */

/** The whole Moon, or the south pole close up, where the polar map and its slopes are on screen. */
export type Scene = 'moon' | 'pole'

/** How fast the camera turns: once around in a minute. */
const TURN_DEG_PER_S = 6
/** How fast the Sun moves: half a day of its real motion every second, a month in about a minute. */
const SUN_HOURS_PER_S = 12
const MOON_LAT_DEG = -20
/** Magnification at the pole: the view is about 580 km across, inside the polar map. */
const POLE_ZOOM = 6
const SOUTH_POLE: Vec3 = [0, 0, -1]

/** The Sun's direction (MOON_ME) at a number of hours into the month, between the two nearest hourly rows. */
export function sunAt(hours: number, suns: readonly Vec3[]): Vec3 {
  const at = ((hours % suns.length) + suns.length) % suns.length
  const from = suns[Math.floor(at)]
  const to = suns[(Math.floor(at) + 1) % suns.length]
  const share = at - Math.floor(at)
  const mixed = from.map((value, i) => value + (to[i] - value) * share)
  const length = Math.hypot(mixed[0], mixed[1], mixed[2])
  return [mixed[0] / length, mixed[1] / length, mixed[2] / length]
}

/** What to draw at a moment of the scripted motion. `suns` are the pipeline's hourly Sun directions. */
export function frameAt(seconds: number, scene: Scene, suns: readonly Vec3[]): GlobeFrame {
  const sun = sunAt(seconds * SUN_HOURS_PER_S, suns)
  const turned_deg = seconds * TURN_DEG_PER_S
  if (scene === 'pole') {
    // Looking straight down at the pole, the picture turns around it.
    const up = turn(screenUp(SOUTH_POLE), SOUTH_POLE, (turned_deg * Math.PI) / 180)
    return { view: { lat: -90, lon: 0 }, zoom: POLE_ZOOM, sun, up }
  }
  const lon = ((turned_deg + 180) % 360) - 180
  return { view: { lat: MOON_LAT_DEG, lon }, zoom: 1, sun, up: screenUp(unitOf(MOON_LAT_DEG, lon)) }
}
