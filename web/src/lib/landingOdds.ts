/**
 * Landing accuracy: a lander aimed at a point comes down somewhere around it. This works out, for
 * the ground around the target, where a landing would fit the mission, and the chance of coming
 * down on such ground.
 *
 * The miss is taken as a circular bell curve (a normal distribution, the same in every direction)
 * centred on the target. That is an assumption, not a measurement of any lander: a real landing
 * ellipse is usually longer along the approach path. The accuracy a visitor types is the radius
 * that holds 99% of landings.
 *
 * All distances are meters in the light grid's south-polar map plane, x to the right and y up,
 * measured from the target.
 */

/** The accuracy a first visit starts from, and the range offered, in meters. */
export const DEFAULT_ACCURACY_M = 100
export const ACCURACY_RANGE = { min: 50, max: 1000, step: 25 }

/** The map's two colors: where a landing fits the mission, and where it does not. */
export const FIT_COLOR = '#57c08a'
export const MISS_COLOR = '#c2452d'

/** The rings drawn on the map: the circles holding these shares of landings. */
export const RING_SHARES = [0.5, 0.9, 0.99]

/** The share of landings inside the accuracy radius. */
export const ACCURACY_SHARE = 0.99

/** The radius (in sigmas) of the circle holding a share of landings: a miss's distance is Rayleigh. */
function sigmasHolding(share: number): number {
  return Math.sqrt(-2 * Math.log(1 - share))
}

/** The bell curve's spread along one axis (m) for an accuracy radius (m). */
export function sigmaM(accuracyM: number): number {
  return accuracyM / sigmasHolding(ACCURACY_SHARE)
}

/** The radius (m) that holds a share (0 to 1) of landings. */
export function radiusHolding(share: number, sigma: number): number {
  return sigma * sigmasHolding(share)
}

/** The chance (0 to 1) that a landing misses by between two distances (m). */
export function chanceBetween(fromM: number, toM: number, sigma: number): number {
  const within = (r: number) => 1 - Math.exp(-(r * r) / (2 * sigma * sigma))
  return within(toM) - within(fromM)
}

/** The error function, to about 1e-7 (Abramowitz and Stegun, 7.1.26). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - poly * Math.exp(-a * a))
}

/** The chance that one coordinate of the miss is below `x` (m). */
function below(x: number, sigma: number): number {
  return 0.5 * (1 + erf(x / (sigma * Math.SQRT2)))
}

/** Why a landing on a cell does not fit, as the cell's code; 0 means it fits. */
export const FITS = 0
export const MISSES = ['slope', 'sunAtLanding', 'earthAtLanding', 'dark', 'silence'] as const
export type Miss = (typeof MISSES)[number]

/** A cell's code for a reason: 1 for the first of `MISSES`, and so on. */
export function missCode(miss: Miss): number {
  return MISSES.indexOf(miss) + 1
}

/** The reason a code stands for; null for a cell that fits. */
export function missOf(code: number): Miss | null {
  return code === FITS ? null : MISSES[code - 1]
}

/** What each reason is called, as the end of "… of landings: <words>". */
export const MISS_WORDS: Record<Miss, string> = {
  slope: 'ground too steep',
  sunAtLanding: 'Sun down at landing',
  earthAtLanding: 'Earth out of view at landing',
  dark: 'darkness too long',
  silence: 'radio silence too long',
}

/** Where a landing fits: one code per cell of a square grid around the target. */
export interface FitMap {
  /** Cells along a side, and their size (m). */
  size: number
  cellM: number
  /** The map's left edge and top edge, from the target (m). */
  leftM: number
  topM: number
  /** 0 where a landing fits, or the code of the reason it does not; row by row from the top. */
  verdict: Uint8Array
}

/** The centre of a cell, from the target (m). */
export function cellCentreM(map: FitMap, cell: number): { x: number; y: number } {
  const row = Math.floor(cell / map.size)
  const col = cell % map.size
  return { x: map.leftM + (col + 0.5) * map.cellM, y: map.topM - (row + 0.5) * map.cellM }
}

/** The cell holding a point given from the target (m); null outside the map. */
export function cellAtM(map: FitMap, x: number, y: number): number | null {
  const col = Math.floor((x - map.leftM) / map.cellM)
  const row = Math.floor((map.topM - y) / map.cellM)
  return col >= 0 && col < map.size && row >= 0 && row < map.size ? row * map.size + col : null
}

/** The chance of landing between each pair of neighbouring edges along one axis. */
function axisChances(firstEdgeM: number, stepM: number, count: number, sigma: number): Float64Array {
  const chances = new Float64Array(count)
  let last = below(firstEdgeM, sigma)
  for (let i = 0; i < count; i += 1) {
    const next = below(firstEdgeM + (i + 1) * stepM, sigma)
    chances[i] = Math.abs(next - last)
    last = next
  }
  return chances
}

export interface LandingOdds {
  /** The chance (0 to 1) that a landing comes down where it fits the mission. */
  fit: number
  /** The chance of each reason for not fitting; with `fit` they add up to 1. */
  misses: Record<Miss, number>
  /** The share of landings the map holds; the rest fall outside it and are left out of the odds. */
  covered: number
}

/**
 * The odds of a landing fitting, for a bell curve of spread `sigma` (m) on the target. Each cell
 * counts by the exact chance of landing inside its square, so the result does not depend on where
 * the cell's centre falls. The odds are among landings on the map (`covered` of all of them).
 */
export function landingOdds(map: FitMap, sigma: number): LandingOdds {
  const across = axisChances(map.leftM, map.cellM, map.size, sigma)
  const down = axisChances(map.topM, -map.cellM, map.size, sigma)
  const byCode = new Float64Array(MISSES.length + 1)
  for (let row = 0; row < map.size; row += 1) {
    for (let col = 0; col < map.size; col += 1) byCode[map.verdict[row * map.size + col]] += down[row] * across[col]
  }
  const covered = byCode.reduce((sum, chance) => sum + chance, 0)
  const share = (code: number) => (covered > 0 ? byCode[code] / covered : 0)
  const misses = Object.fromEntries(MISSES.map((miss) => [miss, share(missCode(miss))])) as Record<Miss, number>
  return { fit: share(FITS), misses, covered }
}

/** One ring around the target: how much of its ground fits, and the chance of landing in it. */
export interface Ring {
  fromM: number
  toM: number
  /** The share (0 to 1) of the ring's ground where a landing fits; null if the map has none of it. */
  fitShare: number | null
  /** The chance (0 to 1) that a landing misses by this much. */
  chance: number
}

/** Rings of equal width out to `outToM`, for the curve of how likely each miss is and how it fares. */
export function rings(map: FitMap, sigma: number, widthM: number, outToM: number): Ring[] {
  const count = Math.max(1, Math.round(outToM / widthM))
  const fits = new Float64Array(count)
  const all = new Float64Array(count)
  for (let cell = 0; cell < map.verdict.length; cell += 1) {
    const { x, y } = cellCentreM(map, cell)
    const ring = Math.floor(Math.hypot(x, y) / widthM)
    if (ring >= count) continue
    all[ring] += 1
    if (map.verdict[cell] === FITS) fits[ring] += 1
  }
  return Array.from({ length: count }, (_, i) => ({
    fromM: i * widthM,
    toM: (i + 1) * widthM,
    fitShare: all[i] > 0 ? fits[i] / all[i] : null,
    chance: chanceBetween(i * widthM, (i + 1) * widthM, sigma),
  }))
}

/** How far the map reaches from the target in every direction (m). */
export function reachM(map: FitMap): number {
  const side = map.size * map.cellM
  return Math.min(-map.leftM, map.leftM + side, map.topM, side - map.topM)
}

/** The largest accuracy radius (m) the map can answer for: nearly every landing must fall on it. */
export function largestAccuracyM(map: FitMap): number {
  // A square reaching 1.25 radii each way holds all but about 1 landing in 3,000.
  return reachM(map) / 1.25
}

/**
 * The loosest accuracy (m), among those offered, at which the odds of fitting are still at least
 * `atLeast`; null if even the tightest falls short. Only accuracies the map can answer for count.
 */
export function loosestAccuracyM(map: FitMap, atLeast: number, offered: number[]): number | null {
  const limit = largestAccuracyM(map)
  let loosest: number | null = null
  for (const accuracyM of offered) {
    if (accuracyM > limit) break
    if (landingOdds(map, sigmaM(accuracyM)).fit < atLeast) break
    loosest = accuracyM
  }
  return loosest
}

/** The accuracies the slider offers, tightest first. */
export function offeredAccuracies(): number[] {
  const { min, max, step } = ACCURACY_RANGE
  return Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step)
}

/** "87%", "under 1%" or "over 99%": odds never read as certain when they are not. */
export function oddsWords(chance: number): string {
  if (chance <= 0) return '0%'
  if (chance >= 1) return '100%'
  if (chance < 0.01) return 'under 1%'
  if (chance > 0.99) return 'over 99%'
  return `${Math.round(100 * chance)}%`
}
