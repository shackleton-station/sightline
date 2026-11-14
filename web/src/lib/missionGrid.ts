import { cellAtM, type FitMap, FITS, missCode } from './landingOdds'
import { cellAt, type LightMeta, type LightMonth, planeXY } from './lightGrid'
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
  const parts: MonthPart[] = []
  let month = first.month
  let from = first.index
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
 * The whole grid as a picture's pixels (RGBA), `sub` pixels along each light cell: one color where
 * a landing fits and another where it does not, for laying over the Moon. `slopeDeg` holds the
 * slope for each pixel, or is null when it could not be read.
 */
export function fitPixels(gaps: GridGaps, req: Requirements, maxSlopeDeg: number, sub: number, slopeDeg: Float32Array | null, fit: readonly [number, number, number], miss: readonly [number, number, number]): Uint8ClampedArray {
  const side = gaps.size * sub
  const pixels = new Uint8ClampedArray(4 * side * side)
  for (let row = 0; row < gaps.size; row += 1) {
    for (let col = 0; col < gaps.size; col += 1) {
      const lightFits = lightVerdict(gaps, row * gaps.size + col, req) === FITS
      for (let dRow = 0; dRow < sub; dRow += 1) {
        for (let dCol = 0; dCol < sub; dCol += 1) {
          const pixel = (row * sub + dRow) * side + col * sub + dCol
          const color = lightFits && !(slopeDeg && slopeDeg[pixel] > maxSlopeDeg) ? fit : miss
          pixels[4 * pixel] = color[0]
          pixels[4 * pixel + 1] = color[1]
          pixels[4 * pixel + 2] = color[2]
          pixels[4 * pixel + 3] = 255
        }
      }
    }
  }
  return pixels
}
