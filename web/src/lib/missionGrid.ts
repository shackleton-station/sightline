import { cellAtM, erf, type FitMap, FITS, missCode, sigmaM, type Spread } from './landingOdds'
import { cellAt, type LightMeta, type LightMonth, type LightPatch, planeXY } from './lightGrid'
import { locateHour, type Requirements } from './mission'

/**
 * The mission judged at every cell of the light grid, for one landing hour: is the Sun (and Earth)
 * up at landing, and how long is each gone for during the mission. From those four numbers a cell
 * a landing fits is told from one it does not, under any limits, without reading the grid again.
 */
export interface GridGaps {
  /** Cells along a side of the grid; every array is row by row from the top. */
  size: number
  /** 1 where the Sun, and Earth, is up at the landing hour. */
  sunAt: Uint8Array
  earthAt: Uint8Array
  /** The longest run of hours without the Sun, and without Earth, from landing to the mission's end. */
  sunGapH: Uint16Array
  earthGapH: Uint16Array
}

/** Gaps being counted month by month: the run of "down" hours each cell is in as the last month ended. */
export interface GapsRun extends GridGaps {
  sunRun: Uint16Array
  earthRun: Uint16Array
}

/** One month of a mission: its name and the hours of it the mission covers, `to` exclusive. */
export interface MonthPart {
  month: string
  from: number
  to: number
}

function monthAfter(month: string): string {
  const year = Number(month.slice(0, 4))
  const next = Number(month.slice(5, 7)) + 1
  return next > 12 ? `${year + 1}-01` : `${year}-${String(next).padStart(2, '0')}`
}

/**
 * The months a mission covers and the hours of each, for a landing at `landing` hours from
 * `startIso`. Null when it runs past the grid's last month.
 */
export function missionMonths(meta: LightMeta, startIso: string, landing: number, missionDays: number): MonthPart[] | null {
  const first = locateHour(startIso, landing)
  return missionMonthsAt(meta, first.month, first.index, missionDays)
}

/** The same, for a landing given as a month and the hour within it. */
export function missionMonthsAt(meta: LightMeta, firstMonth: string, index: number, missionDays: number): MonthPart[] | null {
  const parts: MonthPart[] = []
  let month = firstMonth
  let from = index
  let left = missionDays * 24
  while (left > 0) {
    const hours = meta.hours[month]
    if (hours === undefined) return null
    const to = Math.min(hours, from + left)
    parts.push({ month, from, to })
    left -= to - from
    month = monthAfter(month)
    from = 0
  }
  return parts
}

export function startGaps(size: number): GapsRun {
  const cells = size * size
  return {
    size,
    sunAt: new Uint8Array(cells),
    earthAt: new Uint8Array(cells),
    sunGapH: new Uint16Array(cells),
    earthGapH: new Uint16Array(cells),
    sunRun: new Uint16Array(cells),
    earthRun: new Uint16Array(cells),
  }
}

/**
 * Count one body's hours of one month into the gaps, for the hours `from` to `to` of it. A month
 * holds, for each cell, the hours at which the body flips between down and up, starting from down
 * (`lightGrid.ts`): the stretches between flips are walked, never the hours one by one.
 */
function addBody(planes: Uint16Array, slots: number, month: LightMonth, part: MonthPart, at: Uint8Array | null, run: Uint16Array, longest: Uint16Array): void {
  const cells = month.size * month.size
  for (let cell = 0; cell < cells; cell += 1) {
    let up = 0
    let start = 0
    let current = run[cell]
    let most = longest[cell]
    for (let slot = 0; slot <= slots && start < month.hours; slot += 1) {
      // After the last flip the body stays as it is to the month's end.
      const end = slot < slots ? Math.min(planes[slot * cells + cell], month.hours) : month.hours
      const first = Math.max(start, part.from)
      const length = Math.min(end, part.to) - first
      if (length > 0) {
        if (at && first === part.from) at[cell] = up
        if (up) current = 0
        else {
          current += length
          if (current > most) most = current
        }
      }
      start = end
      up ^= 1
    }
    run[cell] = current
    longest[cell] = most
  }
}

/** Count one month of the mission into the gaps. The first month given also says what is up at landing. */
export function addMonth(run: GapsRun, month: LightMonth, part: MonthPart, first: boolean): void {
  if (month.size !== run.size) throw new Error('the month is not this grid')
  addBody(month.sun, month.sunSlots, month, part, first ? run.sunAt : null, run.sunRun, run.sunGapH)
  addBody(month.earth, month.earthSlots, month, part, first ? run.earthAt : null, run.earthRun, run.earthGapH)
}

/**
 * Whether a landing on a cell fits the mission's Sun and Earth limits, as a code: the first limit
 * it breaks, in the order the app's own verdict lists them (`landingProblems`), or 0.
 */
export function lightVerdict(gaps: GridGaps, cell: number, req: Requirements): number {
  if (req.sunAtLanding && !gaps.sunAt[cell]) return missCode('sunAtLanding')
  if (req.earthAtLanding && !gaps.earthAt[cell]) return missCode('earthAtLanding')
  if (gaps.sunGapH[cell] > req.maxSunGapH) return missCode('dark')
  if (gaps.earthGapH[cell] > req.maxEarthGapH) return missCode('silence')
  return FITS
}

/**
 * The ground's slope in degrees on a square grid finer than the light grid's: `sub` slope cells
 * along one light cell, starting at the light grid's column `col` and row `row`, `cells` light cells
 * along a side.
 */
export interface SlopePart {
  col: number
  row: number
  cells: number
  sub: number
  /** Row by row from the top: `(cells * sub)` squared values. */
  deg: Float32Array
}

/** Which light cells a square around a target takes in: the first column and row, and the cells along a side. */
export interface Square {
  col: number
  row: number
  cells: number
}

/**
 * The square of light cells reaching at least `reachM` from a target in every direction; null when
 * it does not lie wholly inside the grid.
 */
export function squareAround(meta: LightMeta, lat: number, lon: number, reachM: number): Square | null {
  const centre = cellAt(meta, lat, lon)
  if (!centre) return null
  // The target can be anywhere in its cell, so one more cell each way keeps the reach.
  const around = Math.ceil(reachM / meta.pixel_m) + 1
  const col = centre.col - around
  const row = centre.row - around
  const cells = 2 * around + 1
  return col < 0 || row < 0 || col + cells > meta.size || row + cells > meta.size ? null : { col, row, cells }
}

/**
 * Where a landing fits, around a target: the square's light cells judged against the mission, each
 * split into the slope's finer cells where the slope is known. A cell too steep says so, whatever
 * its light. Distances are from the target, in the grid's map plane.
 */
export function fitMapAround(meta: LightMeta, gaps: GridGaps, square: Square, lat: number, lon: number, req: Requirements, maxSlopeDeg: number, slope: SlopePart | null): FitMap {
  const usable = slope && slope.col === square.col && slope.row === square.row && slope.cells === square.cells ? slope : null
  const sub = usable?.sub ?? 1
  const size = square.cells * sub
  const verdict = new Uint8Array(size * size)
  const steep = missCode('slope')
  for (let row = 0; row < square.cells; row += 1) {
    for (let col = 0; col < square.cells; col += 1) {
      const light = lightVerdict(gaps, (square.row + row) * gaps.size + square.col + col, req)
      for (let dRow = 0; dRow < sub; dRow += 1) {
        for (let dCol = 0; dCol < sub; dCol += 1) {
          const cell = (row * sub + dRow) * size + col * sub + dCol
          verdict[cell] = usable && usable.deg[cell] > maxSlopeDeg ? steep : light
        }
      }
    }
  }
  const target = planeXY(meta, lat, lon)
  return {
    size,
    cellM: meta.pixel_m / sub,
    leftM: -meta.half_width_m + square.col * meta.pixel_m - target.x,
    topM: meta.half_width_m - square.row * meta.pixel_m - target.y,
    verdict,
  }
}

/** The patch that holds a square of the grid's cells whole, with its name; null if none does. */
export function patchHolding(meta: LightMeta, square: Square): { site: string; patch: LightPatch } | null {
  for (const [site, patch] of Object.entries(meta.patches ?? {})) {
    if (square.col >= patch.col && square.row >= patch.row && square.col + square.cells <= patch.col + patch.cells && square.row + square.cells <= patch.row + patch.cells) return { site, patch }
  }
  return null
}

/**
 * `fitMapAround` where a patch holds the square: the Sun and Earth verdict is each patch pixel's
 * own, not one for the whole cell, so the map's cells are the patch's pixels. `gaps` are the
 * patch's. The slope is read from its own finer cells, the one each patch pixel's middle falls in.
 */
export function fitMapInPatch(meta: LightMeta, patch: LightPatch, gaps: GridGaps, square: Square, lat: number, lon: number, req: Requirements, maxSlopeDeg: number, slope: SlopePart | null): FitMap {
  const usable = slope && slope.col === square.col && slope.row === square.row && slope.cells === square.cells ? slope : null
  const sub = patch.sub
  const size = square.cells * sub
  const verdict = new Uint8Array(size * size)
  const steep = missCode('slope')
  const slopeSide = usable ? square.cells * usable.sub : 0
  for (let row = 0; row < size; row += 1) {
    const patchRow = (square.row - patch.row) * sub + row
    for (let col = 0; col < size; col += 1) {
      const patchCol = (square.col - patch.col) * sub + col
      let tooSteep = false
      if (usable) {
        const slopeRow = Math.min(slopeSide - 1, Math.floor(((row + 0.5) * usable.sub) / sub))
        const slopeCol = Math.min(slopeSide - 1, Math.floor(((col + 0.5) * usable.sub) / sub))
        tooSteep = usable.deg[slopeRow * slopeSide + slopeCol] > maxSlopeDeg
      }
      verdict[row * size + col] = tooSteep ? steep : lightVerdict(gaps, patchRow * patch.size + patchCol, req)
    }
  }
  const target = planeXY(meta, lat, lon)
  return {
    size,
    cellM: meta.pixel_m / sub,
    leftM: -meta.half_width_m + square.col * meta.pixel_m - target.x,
    topM: meta.half_width_m - square.row * meta.pixel_m - target.y,
    verdict,
  }
}

/** Whether a landing at the target itself fits, by the map's cell there; null if the target is off the map. */
export function fitsAtTarget(map: FitMap): boolean | null {
  const cell = cellAtM(map, 0, 0)
  return cell === null ? null : map.verdict[cell] === FITS
}

/**
 * Slope in degrees from the two slope images' 8-bit values (rise over run along the map's x and y,
 * `pipeline/src/clps/slopes.py`): 128 is level and `slopeMax` is the steepest stored.
 */
export function slopeDegFrom(x: Uint8Array | Uint8ClampedArray, y: Uint8Array | Uint8ClampedArray, slopeMax: number): Float32Array {
  const out = new Float32Array(x.length)
  for (let i = 0; i < out.length; i += 1) {
    const dx = ((x[i] - 128) / 127) * slopeMax
    const dy = ((y[i] - 128) / 127) * slopeMax
    out[i] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI
  }
  return out
}

/**
 * Where a landing fits, across the whole grid: from 1 (it fits) to 0 for each pixel, `sub` pixels
 * along each light cell. `slopeDeg` holds the slope for each pixel, or is null when it could not
 * be read. With `soft`, the Sun and Earth verdict is read between the light cells' middles rather
 * than cell by cell, so a picture of it has no squares: a way of drawing a grid that is known only
 * at those middles, not finer knowledge of the ground.
 */
export function fitField(gaps: GridGaps, req: Requirements, maxSlopeDeg: number, sub: number, slopeDeg: Float32Array | null, soft = false): Float32Array {
  const { size } = gaps
  const light = new Float32Array(size * size)
  for (let cell = 0; cell < light.length; cell += 1) light[cell] = lightVerdict(gaps, cell, req) === FITS ? 1 : 0
  const side = size * sub
  const field = new Float32Array(side * side)
  const last = size - 1
  for (let row = 0; row < side; row += 1) {
    // Where this pixel's middle falls among the light cells' middles.
    const y = soft ? Math.min(last, Math.max(0, (row + 0.5) / sub - 0.5)) : Math.floor(row / sub)
    const y0 = Math.floor(y)
    const y1 = Math.min(last, y0 + 1)
    const fy = y - y0
    for (let col = 0; col < side; col += 1) {
      const pixel = row * side + col
      if (slopeDeg && slopeDeg[pixel] > maxSlopeDeg) continue
      const x = soft ? Math.min(last, Math.max(0, (col + 0.5) / sub - 0.5)) : Math.floor(col / sub)
      const x0 = Math.floor(x)
      const x1 = Math.min(last, x0 + 1)
      const fx = x - x0
      field[pixel] = (light[y0 * size + x0] * (1 - fx) + light[y0 * size + x1] * fx) * (1 - fy) + (light[y1 * size + x0] * (1 - fx) + light[y1 * size + x1] * fx) * fy
    }
  }
  return field
}

/**
 * A patch laid into a field of where a landing fits (`fitField`): inside the patch, each of the
 * field's pixels becomes the share of the patch's pixels under it where a landing fits, so ground
 * the grid's one value a cell could not tell apart is told apart. `gaps` are the patch's own, one
 * per patch pixel. A pixel too steep stays at 0, as in the field. Nothing is changed unless the
 * patch's pixels divide the field's exactly.
 */
export function layPatch(field: Float32Array, sub: number, gridSize: number, patch: LightPatch, gaps: GridGaps, req: Requirements, maxSlopeDeg: number, slopeDeg: Float32Array | null): void {
  const per = patch.sub / sub
  if (!Number.isInteger(per) || per < 1 || gaps.size !== patch.size) return
  const side = gridSize * sub
  const across = patch.cells * sub
  for (let j = 0; j < across; j += 1) {
    for (let i = 0; i < across; i += 1) {
      const pixel = (patch.row * sub + j) * side + patch.col * sub + i
      if (slopeDeg && slopeDeg[pixel] > maxSlopeDeg) continue
      let fits = 0
      for (let dj = 0; dj < per; dj += 1) {
        for (let di = 0; di < per; di += 1) {
          if (lightVerdict(gaps, (j * per + dj) * patch.size + i * per + di, req) === FITS) fits += 1
        }
      }
      field[pixel] = fits / (per * per)
    }
  }
}

/**
 * A bell curve of spread `sigmaPx` as weights for whole pixels either side of the middle: each is
 * the curve's share over that pixel's width, so they add up to one. With `exact` false the curve
 * is read at each pixel's middle instead, for a line that crosses pixels at a slant.
 */
function bellWeights(sigmaPx: number, exact: boolean): Float32Array {
  const reach = Math.max(1, Math.ceil(3.5 * sigmaPx))
  const weights = new Float32Array(2 * reach + 1)
  const below = (x: number) => 0.5 * (1 + erf(x / (sigmaPx * Math.SQRT2)))
  let sum = 0
  for (let k = -reach; k <= reach; k += 1) {
    weights[k + reach] = exact ? below(k + 0.5) - below(k - 0.5) : Math.exp((-0.5 * k * k) / (sigmaPx * sigmaPx))
    sum += weights[k + reach]
  }
  for (let i = 0; i < weights.length; i += 1) weights[i] /= sum
  return weights
}

/** One pass of a blur: each pixel becomes the weighted mean of those `stepX`, `stepY` apart along a line through it. Past the picture's edge, the edge is repeated. */
function blurAlong(from: Float32Array, side: number, weights: Float32Array, stepX: number, stepY: number): Float32Array {
  const reach = (weights.length - 1) / 2
  // How far each weight's pixel is from the middle one, in whole pixels: the same for every pixel.
  const dx = Int32Array.from(weights, (_, i) => Math.round((i - reach) * stepX))
  const dy = Int32Array.from(weights, (_, i) => Math.round((i - reach) * stepY))
  const to = new Float32Array(from.length)
  const last = side - 1
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      let sum = 0
      for (let i = 0; i < weights.length; i += 1) {
        const x = Math.min(last, Math.max(0, col + dx[i]))
        const y = Math.min(last, Math.max(0, row + dy[i]))
        sum += weights[i] * from[y * side + x]
      }
      to[row * side + col] = sum
    }
  }
  return to
}

/** A picture at half the size: each pixel the mean of four. */
export function halved(from: Float32Array, side: number): Float32Array {
  const half = side / 2
  const to = new Float32Array(half * half)
  for (let row = 0; row < half; row += 1) {
    for (let col = 0; col < half; col += 1) {
      const at = 2 * row * side + 2 * col
      to[row * half + col] = (from[at] + from[at + 1] + from[at + side] + from[at + side + 1]) / 4
    }
  }
  return to
}

/**
 * How many pixels the blur reads for each pixel it writes: the cost of `oddsField`, to choose
 * between a picture and its half-size copy.
 */
export function blurReads(pixelM: number, spread: Spread): number {
  const across = sigmaM(spread.accuracyM) / pixelM
  const taps = (sigmaPx: number) => 2 * Math.max(1, Math.ceil(3.5 * sigmaPx)) + 1
  return 2 * taps(across) + (spread.stretch > 1 ? taps(across * Math.sqrt(spread.stretch * spread.stretch - 1)) : 0)
}

/**
 * The odds of a landing fitting for a lander aimed at each pixel: the field of where a landing
 * fits, blurred by the lander's spread. A round spread is two passes, across and down. A spread
 * longer along the approach is those two and a third along the approach's line, which together make
 * the same stretched bell curve. Pixels are `pixelM` meters; the picture's top is the map's up.
 */
export function oddsField(field: Float32Array, side: number, pixelM: number, spread: Spread, atLeastPx = 0): Float32Array {
  // `atLeastPx` softens a picture by at least that many pixels, so a tight spread does not show the grid.
  const across = Math.max(sigmaM(spread.accuracyM) / pixelM, atLeastPx)
  const round = bellWeights(across, true)
  let odds = blurAlong(blurAlong(field, side, round, 1, 0), side, round, 0, 1)
  if (spread.stretch > 1) {
    // What the round blur lacks along the approach: sigma² along = sigma² across + this².
    const more = across * Math.sqrt(spread.stretch * spread.stretch - 1)
    const turn = (spread.bearingDeg * Math.PI) / 180
    // The approach runs clockwise from up; up on the picture is toward smaller rows.
    odds = blurAlong(odds, side, bellWeights(more, false), Math.sin(turn), -Math.cos(turn))
  }
  return odds
}

/** The colors odds are drawn in: none of the landings fit, half of them, all of them. */
export const ODDS_RAMP: readonly (readonly [number, number, number])[] = [
  [194, 69, 45],
  [224, 178, 58],
  [87, 192, 138],
]

/** The ramp's color for odds from 0 to 1. */
export function oddsColor(odds: number): [number, number, number] {
  const at = Math.min(1, Math.max(0, odds)) * (ODDS_RAMP.length - 1)
  const low = Math.min(ODDS_RAMP.length - 2, Math.floor(at))
  const part = at - low
  const mix = (i: number) => Math.round(ODDS_RAMP[low][i] + (ODDS_RAMP[low + 1][i] - ODDS_RAMP[low][i]) * part)
  return [mix(0), mix(1), mix(2)]
}

/** How strongly the shading is drawn where no landing fits, as a share of its full strength: faint, so the ground reads through the red. */
export const FEW_STRENGTH = 0.4
/** The odds from which the shading is drawn at full strength: the ramp's amber, where it is a coin's toss. */
const FULL_STRENGTH_FROM = 0.5

/**
 * How strongly odds are drawn, as a share of the shading's full strength. Faint where few landings
 * fit and full from amber up, so ground where a landing may fit stands out against a Moon that
 * otherwise looks like itself.
 */
export function oddsStrength(odds: number): number {
  const part = Math.min(1, Math.max(0, odds) / FULL_STRENGTH_FROM)
  return FEW_STRENGTH + (1 - FEW_STRENGTH) * part
}

/** Odds as a picture's pixels (RGBA), each in the ramp's color; a pixel's alpha is how strongly it is drawn (`oddsStrength`). */
export function oddsPixels(odds: Float32Array): Uint8ClampedArray {
  // The ramp is looked up, not worked out, for each of a few million pixels.
  const table = Array.from({ length: 256 }, (_, i) => [...oddsColor(i / 255), Math.round(255 * oddsStrength(i / 255))])
  const pixels = new Uint8ClampedArray(4 * odds.length)
  for (let i = 0; i < odds.length; i += 1) {
    const color = table[Math.min(255, Math.max(0, Math.round(255 * odds[i])))]
    pixels[4 * i] = color[0]
    pixels[4 * i + 1] = color[1]
    pixels[4 * i + 2] = color[2]
    pixels[4 * i + 3] = color[3]
  }
  return pixels
}
/** A fit map as a field: 1 where a landing fits and 0 where it does not, for `oddsField`. */
export function fieldOf(map: FitMap): Float32Array {
  return Float32Array.from(map.verdict, (code) => (code === FITS ? 1 : 0))
}

/** The odds at a point given from the map's target (m), from odds worked out over the map; null off the map. */
export function oddsAt(map: FitMap, odds: Float32Array, x: number, y: number): number | null {
  const cell = cellAtM(map, x, y)
  return cell === null ? null : odds[cell]
}

/**
 * Looking around from a site near the south pole: for each compass bearing (degrees clockwise from
 * north), the mean odds over the ground from `fromM` to `toM` out that way. On the polar map, north
 * at a site is straight away from the pole and east is a quarter turn clockwise from it, seen from
 * above the south pole. Null for a bearing whose ground is off the map.
 */
export function oddsAlongBearings(map: FitMap, odds: Float32Array, lonDeg: number, bearingsDeg: number[], fromM: number, toM: number): (number | null)[] {
  const lon = (lonDeg * Math.PI) / 180
  const north = [Math.sin(lon), Math.cos(lon)]
  const east = [Math.cos(lon), -Math.sin(lon)]
  const steps = Math.max(1, Math.round((toM - fromM) / map.cellM))
  return bearingsDeg.map((bearing) => {
    const turn = (bearing * Math.PI) / 180
    const dx = north[0] * Math.cos(turn) + east[0] * Math.sin(turn)
    const dy = north[1] * Math.cos(turn) + east[1] * Math.sin(turn)
    let sum = 0
    let count = 0
    for (let i = 0; i <= steps; i += 1) {
      const out = fromM + ((toM - fromM) * i) / steps
      const here = oddsAt(map, odds, out * dx, out * dy)
      if (here === null) continue
      sum += here
      count += 1
    }
    return count > 0 ? sum / count : null
  })
}