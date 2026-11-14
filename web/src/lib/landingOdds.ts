/**
 * Landing accuracy: a lander aimed at a point comes down somewhere around it. This works out, for
 * the ground around the target, where a landing would fit the mission, and the chance of coming
 * down on such ground.
 *
 * The miss is taken as a bell curve (a normal distribution) centred on the target: the same in
 * every direction, or longer along the approach path by a factor the visitor sets. That is an
 * assumption, not a measurement of any lander. The accuracy a visitor types is the radius that
 * holds 99% of landings, measured across the approach path.
 *
 * All distances are meters in the light grid's south-polar map plane, x to the right and y up,
 * measured from the target.
 */

/** The accuracy a first visit starts from, and the range offered, in meters. */
export const DEFAULT_ACCURACY_M = 100
export const ACCURACY_RANGE = { min: 50, max: 1000, step: 25 }

/** How many times longer the miss is along the approach path than across it, and which way the path runs on the map. */
export const STRETCH_RANGE = { min: 1, max: 4, step: 0.5 }
export const BEARING_RANGE = { min: 0, max: 175, step: 5 }

/**
 * How a lander's misses are spread around its target. Across the approach path, 99% of landings
 * fall within `accuracyM`; along it, within `stretch` times that. The path runs `bearingDeg`
 * clockwise from up on the map (0° E longitude is up); with no stretch the direction means nothing.
 */
export interface Spread {
  accuracyM: number
  stretch: number
  bearingDeg: number
}

export const DEFAULT_SPREAD: Spread = { accuracyM: DEFAULT_ACCURACY_M, stretch: 1, bearingDeg: 0 }

/** The same spread at another accuracy. */
export function withAccuracy(spread: Spread, accuracyM: number): Spread {
  return { ...spread, accuracyM }
}

/** The color of ground where a landing fits the mission. */
export const FIT_COLOR = '#57c08a'

/** The rings drawn on the map: the outlines holding these shares of landings. */
export const RING_SHARES = [0.5, 0.9, 0.99]

/** The share of landings inside the accuracy radius. */
export const ACCURACY_SHARE = 0.99

/** The size (in sigmas) of the outline holding a share of landings. */
function sigmasHolding(share: number): number {
  return Math.sqrt(-2 * Math.log(1 - share))
}

/** The bell curve's spread across the approach path (m) for an accuracy radius (m). */
export function sigmaM(accuracyM: number): number {
  return accuracyM / sigmasHolding(ACCURACY_SHARE)
}

/** The radius (m) that holds a share (0 to 1) of landings, across the approach path. */
export function radiusHolding(share: number, sigma: number): number {
  return sigma * sigmasHolding(share)
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

/** Each reason's color on the maps: warm for the Sun, cool for Earth, violet for the ground. */
export const MISS_COLORS: Record<Miss, string> = {
  slope: '#9a7be0',
  sunAtLanding: '#c2452d',
  earthAtLanding: '#3f7fd9',
  dark: '#e08a2e',
  silence: '#2aa7b8',
}

/** A cell's color from its code. */
export function verdictColor(code: number): string {
  const miss = missOf(code)
  return miss ? MISS_COLORS[miss] : FIT_COLOR
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

/** Parts along a cell's side the bell curve is sampled at when it is turned: enough that each is a quarter of a sigma or less. */
function samplesAlong(cellM: number, sigma: number): number {
  return Math.min(8, Math.max(2, Math.ceil((4 * cellM) / sigma)))
}

/**
 * The chance of landing inside each cell of the map, for a lander aimed at the target. A bell curve
 * lined up with the map (no stretch, or the approach straight up or across) is counted exactly,
 * edge to edge. One turned on the map is sampled at several points inside each cell.
 */
export function cellChances(map: FitMap, spread: Spread): Float64Array {
  const across = sigmaM(spread.accuracyM)
  const along = across * spread.stretch
  const chances = new Float64Array(map.size * map.size)
  const turn = ((spread.bearingDeg % 180) + 180) % 180
  if (spread.stretch === 1 || turn === 0 || turn === 90) {
    // Straight up the map the long axis is y; across it, x.
    const [sigmaX, sigmaY] = spread.stretch === 1 ? [across, across] : turn === 0 ? [across, along] : [along, across]
    const xs = axisChances(map.leftM, map.cellM, map.size, sigmaX)
    const ys = axisChances(map.topM, -map.cellM, map.size, sigmaY)
    for (let row = 0; row < map.size; row += 1) for (let col = 0; col < map.size; col += 1) chances[row * map.size + col] = ys[row] * xs[col]
    return chances
  }
  // The approach path's direction on the map: clockwise from up.
  const sin = Math.sin((turn * Math.PI) / 180)
  const cos = Math.cos((turn * Math.PI) / 180)
  const parts = samplesAlong(map.cellM, across)
  const step = map.cellM / parts
  const weight = (step * step) / (2 * Math.PI * across * along)
  for (let row = 0; row < map.size; row += 1) {
    for (let col = 0; col < map.size; col += 1) {
      let sum = 0
      for (let i = 0; i < parts; i += 1) {
        const y = map.topM - row * map.cellM - (i + 0.5) * step
        for (let k = 0; k < parts; k += 1) {
          const x = map.leftM + col * map.cellM + (k + 0.5) * step
          const u = x * sin + y * cos
          const v = x * cos - y * sin
          sum += Math.exp(-0.5 * ((u * u) / (along * along) + (v * v) / (across * across)))
        }
      }
      chances[row * map.size + col] = sum * weight
    }
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
 * The odds of a landing fitting, from the chance of landing in each cell (`cellChances`). The odds
 * are among landings on the map (`covered` of all of them).
 */
export function landingOdds(map: FitMap, chances: Float64Array): LandingOdds {
  const byCode = new Float64Array(MISSES.length + 1)
  for (let cell = 0; cell < chances.length; cell += 1) byCode[map.verdict[cell]] += chances[cell]
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
  /** The chance (0 to 1) that a landing misses by this much, among landings on the map. */
  chance: number
}

/** Rings of equal width out to `outToM`, for the curve of how likely each miss is and how it fares. */
export function rings(map: FitMap, chances: Float64Array, widthM: number, outToM: number): Ring[] {
  const count = Math.max(1, Math.round(outToM / widthM))
  const fits = new Float64Array(count)
  const all = new Float64Array(count)
  const chance = new Float64Array(count)
  let covered = 0
  for (let cell = 0; cell < map.verdict.length; cell += 1) {
    covered += chances[cell]
    const { x, y } = cellCentreM(map, cell)
    const ring = Math.floor(Math.hypot(x, y) / widthM)
    if (ring >= count) continue
    all[ring] += 1
    chance[ring] += chances[cell]
    if (map.verdict[cell] === FITS) fits[ring] += 1
  }
  return Array.from({ length: count }, (_, i) => ({
    fromM: i * widthM,
    toM: (i + 1) * widthM,
    fitShare: all[i] > 0 ? fits[i] / all[i] : null,
    chance: covered > 0 ? chance[i] / covered : 0,
  }))
}

/** How far the map reaches from the target in every direction (m). */
export function reachM(map: FitMap): number {
  const side = map.size * map.cellM
  return Math.min(-map.leftM, map.leftM + side, map.topM, side - map.topM)
}

/** The largest accuracy radius (m) the map can answer for at a stretch: nearly every landing must fall on it. */
export function largestAccuracyM(map: FitMap, stretch = 1): number {
  // A square reaching 1.25 radii each way holds all but about 1 landing in 3,000.
  return reachM(map) / (1.25 * stretch)
}

/**
 * The loosest accuracy (m), among those offered, at which the odds of fitting are still at least
 * `atLeast`, for a spread's stretch and direction; null if even the tightest falls short. Only
 * accuracies the map can answer for count.
 */
export function loosestAccuracyM(map: FitMap, atLeast: number, offered: number[], spread: Spread = DEFAULT_SPREAD): number | null {
  const limit = largestAccuracyM(map, spread.stretch)
  let loosest: number | null = null
  for (const accuracyM of offered) {
    if (accuracyM > limit) break
    if (landingOdds(map, cellChances(map, withAccuracy(spread, accuracyM))).fit < atLeast) break
    loosest = accuracyM
  }
  return loosest
}

/** The accuracies the slider offers, tightest first. */
export function offeredAccuracies(): number[] {
  const { min, max, step } = ACCURACY_RANGE
  return Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step)
}

/** A better place to aim: where it is from the target (m), and the odds of fitting there. */
export interface Aim {
  x: number
  y: number
  fit: number
}

/** Odds this much better (as a share) are worth moving the target for. */
const WORTH_MOVING = 0.01

/**
 * The aim point within `withinM` of the target with the best odds of fitting, if it beats aiming at
 * the target by a point or more; null if none does. Aim points are tried on every `step`-th cell.
 * Moving the aim moves the whole bell curve, so `chances` (for an aim at the target) is slid over
 * the map; an aim whose landings would fall off the map is not tried.
 */
export function bestAim(map: FitMap, chances: Float64Array, withinM: number, step = 2): Aim | null {
  const { size, cellM, verdict } = map
  let total = 0
  let most = 0
  for (const chance of chances) {
    total += chance
    if (chance > most) most = chance
  }
  if (total <= 0) return null
  // The cells that carry the bell curve: the rest add nothing worth the sums.
  const floor = most * 1e-6
  const rows: number[] = []
  const cols: number[] = []
  const weights: number[] = []
  let carried = 0
  for (let cell = 0; cell < chances.length; cell += 1) {
    if (chances[cell] <= floor) continue
    rows.push(Math.floor(cell / size))
    cols.push(cell % size)
    weights.push(chances[cell])
    carried += chances[cell]
  }
  const oddsAt = (dCol: number, dRow: number): number | null => {
    let fit = 0
    let held = 0
    for (let i = 0; i < weights.length; i += 1) {
      const row = rows[i] + dRow
      const col = cols[i] + dCol
      if (row < 0 || col < 0 || row >= size || col >= size) continue
      held += weights[i]
      if (verdict[row * size + col] === FITS) fit += weights[i]
    }
    // An aim that sends landings off the map cannot be judged.
    return held >= 0.995 * carried ? fit / held : null
  }
  const here = oddsAt(0, 0)
  if (here === null) return null
  let best: Aim | null = null
  let bestDistance = 0
  const reach = Math.floor(withinM / cellM / step) * step
  for (let dRow = -reach; dRow <= reach; dRow += step) {
    for (let dCol = -reach; dCol <= reach; dCol += step) {
      const distance = Math.hypot(dCol, dRow) * cellM
      if (distance > withinM || (dCol === 0 && dRow === 0)) continue
      const fit = oddsAt(dCol, dRow)
      if (fit === null || fit < here + WORTH_MOVING) continue
      // The better odds win; between equals, the nearer aim is the smaller change.
      if (!best || fit > best.fit + 1e-9 || (Math.abs(fit - best.fit) <= 1e-9 && distance < bestDistance)) {
        best = { x: dCol * cellM, y: -dRow * cellM, fit }
        bestDistance = distance
      }
    }
  }
  return best
}

/** "87%", "under 1%" or "over 99%": odds never read as certain when they are not. */
export function oddsWords(chance: number): string {
  if (chance <= 0) return '0%'
  if (chance >= 1) return '100%'
  if (chance < 0.01) return 'under 1%'
  if (chance > 0.99) return 'over 99%'
  return `${Math.round(100 * chance)}%`
}

/** "250 m", or "250 m by 500 m" for a spread longer along the approach. */
export function spreadWords(spread: Spread): string {
  return spread.stretch === 1 ? `${spread.accuracyM} m` : `${spread.accuracyM} m by ${Math.round(spread.accuracyM * spread.stretch)} m`
}

function snap(value: number, range: { min: number; max: number; step: number }): number {
  const stepped = range.min + Math.round((value - range.min) / range.step) * range.step
  return Math.min(Math.max(stepped, range.min), range.max)
}

/**
 * The spread as the end of a link: "&acc=250", with "&accs=2&accd=45" when the miss is longer along
 * the approach. The other pages do not know these and ignore them.
 */
export function spreadLink(spread: Spread): string {
  return `&acc=${spread.accuracyM}${spread.stretch === 1 ? '' : `&accs=${spread.stretch}&accd=${spread.bearingDeg}`}`
}

/** The spread a link carries, each value brought onto its slider's stops; null if it carries none. */
export function readSpreadLink(hash: string): Spread | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const accuracy = Number(params.get('acc') ?? Number.NaN)
  if (!Number.isFinite(accuracy)) return null
  const stretch = Number(params.get('accs') ?? 1)
  const bearing = Number(params.get('accd') ?? 0)
  const stretched = Number.isFinite(stretch) ? snap(stretch, STRETCH_RANGE) : 1
  return {
    accuracyM: snap(accuracy, ACCURACY_RANGE),
    stretch: stretched,
    bearingDeg: stretched > 1 && Number.isFinite(bearing) ? snap(bearing, BEARING_RANGE) : 0,
  }
}
