import { project, type Vec3 } from './polarCamera'

/**
 * What is drawn around the Moon on Sightline's stage: a field of stars and Earth.
 *
 * The stars are made up, for looks only: they are not a star map and stand for no real star. They
 * are fixed to the Moon's own frame, so they turn with the view. Earth is real in two ways and not
 * in a third: its direction from the Moon and the way the Sun lights it come from the pipeline's
 * ephemeris for the moment on show, but it is drawn right beside the Moon, about a hundred times
 * closer than it is. The page says "not to scale".
 */

export interface Star {
  /** Where it is on the sky, as a unit vector in the Moon's frame. */
  dir: Vec3
  /** Radius in CSS pixels and opacity, 0 to 1: most are small and faint, a few are not. */
  size: number
  alpha: number
  /** -1 a little blue, 1 a little warm. */
  tint: number
}

/** A small, repeatable random number generator (mulberry32): the same sky on every visit. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A made-up sky: points spread evenly over the sphere, with far more faint ones than bright ones. */
export function makeStars(count = 1100, seed = 20261113): Star[] {
  const random = generator(seed)
  const stars: Star[] = []
  for (let i = 0; i < count; i += 1) {
    const z = 2 * random() - 1
    const angle = 2 * Math.PI * random()
    const flat = Math.sqrt(1 - z * z)
    // Cubed, so brightness falls off the way it does in a real sky: each step fainter has more stars.
    const bright = random() ** 3
    stars.push({ dir: [flat * Math.cos(angle), flat * Math.sin(angle), z], size: 0.45 + 0.9 * bright, alpha: 0.16 + 0.5 * bright, tint: 2 * random() - 1 })
  }
  return stars
}

export interface SkyPose {
  /** The Moon point in the middle of the view (a unit vector toward the viewer) and which way is up the screen. */
  center: Vec3
  up: Vec3
}

/** The Moon's disc on the stage, in CSS pixels. */
export interface Disc {
  x: number
  y: number
  r: number
}

/**
 * The stars in view, placed on the stage. The sky is the half of the sphere beyond the Moon, seen
 * flat-on and scaled so it covers the stage whatever the zoom: zooming moves the viewer toward the
 * Moon, which does not move the stars. None is placed over the Moon's disc.
 */
export function starsInView(stars: Star[], pose: SkyPose, box: { width: number; height: number }, disc: Disc): { x: number; y: number; size: number; alpha: number; tint: number }[] {
  const reach = Math.hypot(box.width, box.height) / 2
  const placed = []
  for (const star of stars) {
    const p = project(star.dir, pose.center, pose.up)
    // Only the far half: a star on the viewer's side is behind the viewer.
    if (p.facing >= 0) continue
    const x = box.width / 2 + p.x * reach
    const y = box.height / 2 - p.y * reach
    if (x < 0 || y < 0 || x > box.width || y > box.height) continue
    if (Math.hypot(x - disc.x, y - disc.y) <= disc.r + star.size + 1) continue
    placed.push({ x, y, size: star.size, alpha: star.alpha, tint: star.tint })
  }
  return placed
}

/** How far toward or away from the viewer Earth must lean before it is fully in front of, or behind, the Moon’s edge: about 3.5°, half of its monthly swing north and south. */
const EARTH_SETS_OVER = 0.06

/** A part of the stage Earth must keep off: a control drawn over the Moon's square. */
export interface KeepClear {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EarthPlace {
  x: number
  y: number
  /** In front of the Moon's edge, slipping behind it, behind the Moon, or with no room on the stage (the last two are not drawn). */
  state: 'front' | 'setting' | 'behind' | 'no-room'
  /** 1, or less as Earth passes straight behind the viewer, where it has no place beside the disc. */
  opacity: number
  /** How far round the Moon's edge it had to move from its true bearing to fit, in degrees: 0 where there is room. */
  movedDeg: number
  /** Which way round it went: 1 anticlockwise, -1 clockwise, 0 where it did not move. Hand it back as `lastSide` next time. */
  side: -1 | 0 | 1
}

/**
 * Once Earth has gone one way round the Moon's edge it stays that way until the other way is nearer
 * by more than this many degrees. Earth's bearing swings about 8° either way over a month, which
 * must not carry it back and forth across the Moon.
 */
const EARTH_STAYS_DEG = 25
/** Clear space kept between Earth and the stage's edge, the Moon's disc and any control, in pixels. */
const EARTH_MARGIN_PX = 8

/**
 * Where Earth is drawn: just outside the Moon's edge, on the side Earth really lies toward. Its
 * whole disc is kept inside the stage and off the controls: where its true bearing has no room
 * (the Moon nearly fills the stage's height), it goes round the Moon's edge to the nearest place
 * that has, and stays on that side (`lastSide`) while its true bearing drifts. As Earth swings to the far side of the Moon from the viewer it slides in behind the
 * edge from there, like a setting, and is gone when it is behind the Moon.
 */
export function earthPlace(earth: Vec3, pose: SkyPose, disc: Disc, earthR: number, box: { width: number; height: number }, keepClear: KeepClear[] = [], lastSide: -1 | 0 | 1 = 0): EarthPlace {
  const p = project(earth, pose.center, pose.up)
  const across = Math.hypot(p.x, p.y)
  const share = Math.max(0, Math.min(1, (p.facing + EARTH_SETS_OVER) / (2 * EARTH_SETS_OVER)))
  const opacity = p.facing > 0 ? Math.min(1, across / 0.25) : 1
  const bearing = across > 1e-6 ? Math.atan2(p.y, p.x) : Math.PI / 2
  const outside = disc.r + earthR + EARTH_MARGIN_PX
  const reach = earthR + EARTH_MARGIN_PX
  const fits = (x: number, y: number) =>
    x - reach >= 0 && y - reach >= 0 && x + reach <= box.width && y + reach <= box.height && !keepClear.some((area) => x + reach > area.left && x - reach < area.right && y + reach > area.top && y - reach < area.bottom)
  const fitsAt = (angle: number) => fits(disc.x + outside * Math.cos(angle), disc.y - outside * Math.sin(angle))
  // How far round the Moon's edge, one way (+1 anticlockwise, -1 clockwise), the nearest place with
  // room is: found to the degree, then to a few thousandths of one, so that it holds still while
  // Earth's true bearing drifts inside the part of the edge that has no room.
  const roundTo = (way: 1 | -1): number | null => {
    for (let step = 1; step <= 180; step += 1) {
      if (!fitsAt(bearing + (way * step * Math.PI) / 180)) continue
      let blocked = step - 1
      let free = step
      for (let i = 0; i < 12; i += 1) {
        const middle = (blocked + free) / 2
        if (fitsAt(bearing + (way * middle * Math.PI) / 180)) free = middle
        else blocked = middle
      }
      return free
    }
    return null
  }
  let found: { angle: number; moved: number; side: -1 | 0 | 1 } | null = null
  if (fitsAt(bearing)) found = { angle: bearing, moved: 0, side: 0 }
  else {
    const anticlockwise = roundTo(1)
    const clockwise = roundTo(-1)
    if (anticlockwise !== null && clockwise !== null) {
      // The nearer way round, but not a new way each time the two are nearly as near: Earth stays on
      // the side it is on until the other is clearly nearer, or it would hop across the Moon.
      const stay = lastSide === 1 ? anticlockwise <= clockwise + EARTH_STAYS_DEG : lastSide === -1 ? clockwise <= anticlockwise + EARTH_STAYS_DEG : null
      const side = stay === true ? (lastSide as 1 | -1) : stay === false ? (lastSide === 1 ? -1 : 1) : anticlockwise <= clockwise ? 1 : -1
      const moved = side === 1 ? anticlockwise : clockwise
      found = { angle: bearing + (side * moved * Math.PI) / 180, moved, side }
    } else if (anticlockwise !== null) found = { angle: bearing + (anticlockwise * Math.PI) / 180, moved: anticlockwise, side: 1 }
    else if (clockwise !== null) found = { angle: bearing - (clockwise * Math.PI) / 180, moved: clockwise, side: -1 }
  }
  if (!found) return { x: disc.x, y: disc.y, state: 'no-room', opacity: 0, movedDeg: 0, side: 0 }
  if (share === 0) return { x: disc.x, y: disc.y, state: 'behind', opacity, movedDeg: found.moved, side: found.side }
  const eased = share * share * (3 - 2 * share)
  const hidden = Math.max(disc.r - earthR - 2, 0)
  const r = hidden + (outside - hidden) * eased
  return { x: disc.x + r * Math.cos(found.angle), y: disc.y - r * Math.sin(found.angle), state: share === 1 ? 'front' : 'setting', opacity, movedDeg: found.moved, side: found.side }
}

/** A direction in the Moon's frame as the viewer sees it: x to the right, y up the screen, z toward the viewer. */
export function toScreenFrame(direction: Vec3, pose: SkyPose): Vec3 {
  const p = project(direction, pose.center, pose.up)
  return [p.x, p.y, p.facing]
}

/**
 * How brightly the Sun lights a point of Earth's disc, 0 to 1: x and y run -1 to 1 across the disc
 * and `sun` is the Sun's direction in the screen's frame. The edge between day and night is soft,
 * and the night side keeps a little light so the disc still reads as a ball.
 */
export function earthShade(x: number, y: number, sun: Vec3): number {
  const z = Math.sqrt(Math.max(1 - x * x - y * y, 0))
  const toSun = x * sun[0] + y * sun[1] + z * sun[2]
  const day = Math.max(0, Math.min(1, (toSun + 0.06) / 0.2))
  return 0.07 + 0.93 * day * day * (3 - 2 * day)
}

/** The share of Earth's disc that is lit, as the viewer sees it: 1 full, 0 new. */
export function earthLitShare(sun: Vec3): number {
  return (1 + sun[2]) / 2
}
