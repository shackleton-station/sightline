import { EARTH_RADIUS_KM, enuBasis, MOON_RADIUS_M, SUN_RADIUS_KM } from './customModel'
import { cellChances, type FitMap, FITS, type LandingOdds, landingOdds, type Miss, missCode, MISSES, type Spread } from './landingOdds'
import { isNoGapLimit, type Requirements } from './mission'
import { maskAt } from './pointHorizons'

/**
 * Landing accuracy from points, not from a grid. Around the aim point a lattice of landing points
 * is laid out, and at each the mission is judged the way the verdict judges a point: the point's
 * own skyline from the 20 m terrain (`pointHorizons.ts`), the Sun seen from the panel's height and
 * Earth from the antenna's, hour by hour from the landing to the mission's end.
 *
 * What is kept for each point is how far it is from each limit, not a yes or no. Between the
 * points those margins are read off smoothly, and ground fits where every margin is on the right
 * side, so the picture and the odds have no squares in them. The ground's slope is read on a finer
 * lattice of its own, since it costs little.
 *
 * All distances are meters in the south-polar map plane, x to the right and y up, from the target.
 */

/** A square lattice of points centred on the target: `n` along a side (odd), `stepM` apart. */
export interface Lattice {
  n: number
  stepM: number
}

/** The spacings a lattice may have (m): the terrain's own 20 m at the tightest. */
const STEPS_M = [20, 30, 40, 60, 80, 120, 160, 240, 320, 480, 640, 960]
/** Points across the bell curve's long reach: enough that the curve is well sampled, few enough to work out in seconds. */
const STEPS_PER_REACH = 4
/** How far the lattice reaches, in accuracy radii along the long way: holds all but about 1 landing in 100,000, with room to look for a better aim. */
const REACH_RADII = 2

/** How far a spread's lattice reaches from the target, each way (m). */
export function latticeReachM(lattice: Lattice): number {
  return ((lattice.n - 1) / 2) * lattice.stepM
}

/** The lattice for a spread: its points are closer together the tighter the lander. */
export function latticeFor(spread: Spread): Lattice {
  const longM = spread.accuracyM * spread.stretch
  const stepM = STEPS_M.find((step) => step >= longM / STEPS_PER_REACH) ?? (STEPS_M.at(-1) as number)
  return { n: 2 * Math.ceil((REACH_RADII * longM) / stepM) + 1, stepM }
}

/** Where a lattice's point is, from the target (m): row 0 is the top. */
export function latticePointM(lattice: Lattice, index: number): { x: number; y: number } {
  const half = (lattice.n - 1) / 2
  return { x: ((index % lattice.n) - half) * lattice.stepM, y: (half - Math.floor(index / lattice.n)) * lattice.stepM }
}

/** A landing point's skylines: the Sun's from the panel's height, Earth's from the antenna's. */
export interface PointSky {
  lat: number
  lon: number
  /** The ground's height (m). */
  heightM: number
  panelM: number
  antennaM: number
  sunMask: Float32Array
  earthMask: Float32Array
}

/** What a mission does at one landing point. */
export interface PointLight {
  /** How far the Sun's upper edge is above the skyline at landing (degrees): above 0, some of the Sun shows. */
  sunAtDeg: number
  /** The same for Earth; with a clearance asked for, how far Earth's center is above that clearance. */
  earthAtDeg: number
  /** The longest run of hours without the Sun, and without Earth, from landing to the mission's end. */
  sunGapH: number
  earthGapH: number
}

/**
 * One landing point judged over a mission's hours. `positions` holds the Sun's and Earth's
 * positions from the Moon's center for each hour of the mission from the landing (km, MOON_ME: six
 * numbers an hour, as the ephemeris files have them). The Sun is up when any of its disk shows;
 * Earth when any of it shows, or with a clearance when its center is that far above the skyline:
 * the same tests as `computeSite` and `modelFlags`.
 */
export function pointLight(sky: PointSky, positions: Float32Array, clearanceDeg: number): PointLight {
  const { east, north, up } = enuBasis(sky.lat, sky.lon)
  const DEG = 180 / Math.PI
  const hours = positions.length / 6
  /** How far a body's center is above the skyline (degrees), and its radius in the sky (degrees). */
  const above = (hour: number, offset: number, obsM: number, bodyRadiusKm: number, mask: Float32Array): [number, number] => {
    const radiusKm = (MOON_RADIUS_M + sky.heightM + obsM) / 1000
    const x = positions[hour * 6 + offset] - up[0] * radiusKm
    const y = positions[hour * 6 + offset + 1] - up[1] * radiusKm
    const z = positions[hour * 6 + offset + 2] - up[2] * radiusKm
    const dist = Math.hypot(x, y, z)
    const e = (x * east[0] + y * east[1] + z * east[2]) / dist
    const n = (x * north[0] + y * north[1] + z * north[2]) / dist
    const u = (x * up[0] + y * up[1] + z * up[2]) / dist
    const az = ((Math.atan2(e, n) * DEG) % 360 + 360) % 360
    const el = Math.atan2(u, Math.hypot(e, n)) * DEG
    return [el - maskAt(mask, az), Math.asin(bodyRadiusKm / dist) * DEG]
  }
  let sunAtDeg = 0
  let earthAtDeg = 0
  let sunGapH = 0
  let earthGapH = 0
  let sunRun = 0
  let earthRun = 0
  for (let hour = 0; hour < hours; hour += 1) {
    const [sunClear, sunRadius] = above(hour, 0, sky.panelM, SUN_RADIUS_KM, sky.sunMask)
    const [earthClear, earthRadius] = above(hour, 3, sky.antennaM, EARTH_RADIUS_KM, sky.earthMask)
    const sunOver = sunClear + sunRadius
    const earthOver = clearanceDeg > 0 ? earthClear - clearanceDeg : earthClear + earthRadius
    if (hour === 0) {
      sunAtDeg = sunOver
      earthAtDeg = earthOver
    }
    sunRun = sunOver > 0 ? 0 : sunRun + 1
    // With a clearance, Earth exactly at it counts as up (`modelFlags`).
    earthRun = (clearanceDeg > 0 ? earthOver >= 0 : earthOver > 0) ? 0 : earthRun + 1
    if (sunRun > sunGapH) sunGapH = sunRun
    if (earthRun > earthGapH) earthGapH = earthRun
  }
  return { sunAtDeg, earthAtDeg, sunGapH, earthGapH }
}

/** The mission at every point of a lattice around a target, and the ground's slope on a finer one. */
export interface LandingField {
  lattice: Lattice
  /** One value per lattice point, row by row from the top (`PointLight`). */
  sunAtDeg: Float32Array
  earthAtDeg: Float32Array
  sunGapH: Float32Array
  earthGapH: Float32Array
  /** The slope's own lattice, centred on the target too, and the slope at each of its points (degrees). */
  slope: Lattice
  slopeDeg: Float32Array
}

/** The slope's lattice for a light lattice: the same reach, as fine as the terrain but no more than about 250 points across. */
export function slopeLatticeFor(lattice: Lattice, terrainStepM: number): Lattice {
  const reach = latticeReachM(lattice)
  const stepM = Math.max(terrainStepM, Math.ceil((2 * reach) / 250 / terrainStepM) * terrainStepM)
  return { n: 2 * Math.ceil(reach / stepM) + 1, stepM }
}

/**
 * How far past a limit counts as wholly past it, for reading between points. A margin is cut off
 * at one of these either way, so that between a point well inside a limit and one well outside,
 * the line falls midway and not next to whichever is nearer its limit.
 */
const FULL = { deg: 0.5, hours: 6, slopeDeg: 2 }

/** A field's margins for a mission: at each point, above 0 where a limit is kept and below where it is broken, from -1 to 1. */
export interface Margins {
  lattice: Lattice
  /** In `MISSES`' order after the slope: Sun at landing, Earth at landing, darkness, radio silence. */
  light: Float32Array[]
  slope: Lattice
  ground: Float32Array
}

const clamp = (value: number) => Math.max(-1, Math.min(1, value))

/**
 * The margins of a field under a mission's limits. `anchor` is the verdict at the target itself,
 * from the app's own numbers for that point: null where it fits, or the reason it does not. The
 * target's own lattice point is made to agree with it, so the map under the cross never says other
 * than the verdict. Leave it undefined when there is no verdict to agree with.
 */
export function marginsOf(field: LandingField, req: Requirements, maxSlopeDeg: number, anchor?: Miss | null): Margins {
  const points = field.lattice.n * field.lattice.n
  const always = () => new Float32Array(points).fill(1)
  const gap = (hours: Float32Array, limit: number) => (isNoGapLimit(limit) ? always() : Float32Array.from(hours, (h) => clamp((limit - h + 0.5) / FULL.hours)))
  const light = [
    req.sunAtLanding ? Float32Array.from(field.sunAtDeg, (deg) => clamp(deg / FULL.deg)) : always(),
    req.earthAtLanding ? Float32Array.from(field.earthAtDeg, (deg) => clamp(deg / FULL.deg)) : always(),
    gap(field.sunGapH, req.maxSunGapH),
    gap(field.earthGapH, req.maxEarthGapH),
  ]
  const ground = Float32Array.from(field.slopeDeg, (deg) => clamp((maxSlopeDeg - deg) / FULL.slopeDeg))
  const margins = { lattice: field.lattice, light, slope: field.slope, ground }
  if (anchor === undefined) return margins
  const centre = (points - 1) / 2
  const groundCentre = (ground.length - 1) / 2
  if (anchor === null) {
    for (const margin of light) if (margin[centre] < 0) margin[centre] = ANCHOR
    if (ground[groundCentre] < 0) ground[groundCentre] = ANCHOR
  } else if (verdictAt(margins, 0, 0) === FITS) {
    if (anchor === 'slope') ground[groundCentre] = -ANCHOR
    else light[MISSES.indexOf(anchor) - 1][centre] = -ANCHOR
  }
  return margins
}

/** How far on the verdict's side of a limit the target's own point is put when the lattice read it otherwise. */
const ANCHOR = 0.25

/** A lattice's values read at a point from the target (m), between its four nearest points; the edge's value beyond the edge. */
function readAt(lattice: Lattice, values: Float32Array, x: number, y: number): number {
  const half = (lattice.n - 1) / 2
  const last = lattice.n - 1
  const col = Math.min(last, Math.max(0, x / lattice.stepM + half))
  const row = Math.min(last, Math.max(0, half - y / lattice.stepM))
  const c0 = Math.min(last - 1, Math.floor(col))
  const r0 = Math.min(last - 1, Math.floor(row))
  const fc = col - c0
  const fr = row - r0
  const at = r0 * lattice.n + c0
  return (values[at] * (1 - fc) + values[at + 1] * fc) * (1 - fr) + (values[at + lattice.n] * (1 - fc) + values[at + lattice.n + 1] * fc) * fr
}

/**
 * Whether a landing at a point from the target (m) fits, as a code: 0, or the first limit it
 * breaks. The ground's slope is asked first, then the limits in the verdict's own order.
 */
export function verdictAt(margins: Margins, x: number, y: number): number {
  if (readAt(margins.slope, margins.ground, x, y) < 0) return missCode('slope')
  for (let i = 0; i < margins.light.length; i += 1) if (readAt(margins.lattice, margins.light[i], x, y) < 0) return i + 2
  return FITS
}

/** Cells along a side of the map the odds are counted on. */
const MAP_CELLS = 96

/** Where a landing fits, as a map of small cells over the lattice's whole reach: each cell is its middle's verdict. */
export function fitMapOf(margins: Margins): FitMap {
  const reach = latticeReachM(margins.lattice)
  const cellM = (2 * reach) / MAP_CELLS
  const verdict = new Uint8Array(MAP_CELLS * MAP_CELLS)
  for (let row = 0; row < MAP_CELLS; row += 1) {
    const y = reach - (row + 0.5) * cellM
    for (let col = 0; col < MAP_CELLS; col += 1) verdict[row * MAP_CELLS + col] = verdictAt(margins, -reach + (col + 0.5) * cellM, y)
  }
  return { size: MAP_CELLS, cellM, leftM: -reach, topM: reach, verdict }
}

/**
 * The verdict at every pixel of a square picture reaching `viewM` from the target each way, `side`
 * pixels along a side, row by row from the top.
 */
export function verdictPicture(margins: Margins, viewM: number, side: number): Uint8Array {
  const codes = new Uint8Array(side * side)
  const perPixel = (2 * viewM) / side
  for (let row = 0; row < side; row += 1) {
    const y = viewM - (row + 0.5) * perPixel
    for (let col = 0; col < side; col += 1) codes[row * side + col] = verdictAt(margins, -viewM + (col + 0.5) * perPixel, y)
  }
  return codes
}

/** A field read under a mission and a spread: everything the panel, the verdict's line and Compare show comes from this one reading. */
export interface FieldReading {
  margins: Margins
  map: FitMap
  /** The chance of landing in each of the map's cells, and the odds they add up to. */
  chances: Float64Array
  odds: LandingOdds
}

/** The odds of a landing fitting, with the map and margins they come from. `anchor` as for `marginsOf`. */
export function readField(field: LandingField, req: Requirements, maxSlopeDeg: number, spread: Spread, anchor?: Miss | null): FieldReading {
  const margins = marginsOf(field, req, maxSlopeDeg, anchor)
  const map = fitMapOf(margins)
  const chances = cellChances(map, spread)
  return { margins, map, chances, odds: landingOdds(map, chances) }
}
