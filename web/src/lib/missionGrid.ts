import { cellAtM, type FitMap, FITS, missCode, VERDICT_RGB } from './landingOdds'
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
 * The share (0 to 1) of each picture pixel's ground that is not too steep to land on. The two slope
 * images hold `per` values along each of the picture's pixels (`x` and `y`, row by row from the
 * top, 8 bits each as `slopeDegFrom` reads them). Each value is one piece of ground, steeper than
 * `maxSlopeDeg` or not, and a pixel is the share of its pieces that are not. Averaging the slopes
 * first would call a pixel that is half steep and half level wholly level.
 */
export function flatShare(x: Uint8Array | Uint8ClampedArray, y: Uint8Array | Uint8ClampedArray, slopeMax: number, per: number, maxSlopeDeg: number): Float32Array {
  const across = Math.round(Math.sqrt(x.length))
  const side = across / per
  // The square of the rise over run each 8-bit value stands for, and of the limit's.
  const squares = Float64Array.from({ length: 256 }, (_, value) => (((value - 128) / 127) * slopeMax) ** 2)
  const limit = Math.tan((maxSlopeDeg * Math.PI) / 180) ** 2
  const share = new Float32Array(side * side)
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      let flat = 0
      for (let dRow = 0; dRow < per; dRow += 1) {
        const at = (row * per + dRow) * across + col * per
        for (let dCol = 0; dCol < per; dCol += 1) if (squares[x[at + dCol]] + squares[y[at + dCol]] <= limit) flat += 1
      }
      share[row * side + col] = flat / (per * per)
    }
  }
  return share
}

/**
 * Where a landing fits, across the whole grid: from 1 (it fits) to 0 for each pixel, `sub` pixels
 * along each light cell. `flat` holds the share of each pixel's ground that is not too steep
 * (`flatShare`), or is null when the slope could not be read: a pixel's value is the Sun and Earth
 * verdict there times that share. With `soft`, the Sun and Earth verdict is read between the light
 * cells' middles rather than cell by cell, so a picture of it has no squares: a way of drawing a
 * grid that is known only at those middles, not finer knowledge of the ground.
 */
export function fitField(gaps: GridGaps, req: Requirements, sub: number, flat: Float32Array | null, soft = false): Float32Array {
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
      const share = flat ? flat[pixel] : 1
      if (share === 0) continue
      const x = soft ? Math.min(last, Math.max(0, (col + 0.5) / sub - 0.5)) : Math.floor(col / sub)
      const x0 = Math.floor(x)
      const x1 = Math.min(last, x0 + 1)
      const fx = x - x0
      field[pixel] = share * ((light[y0 * size + x0] * (1 - fx) + light[y0 * size + x1] * fx) * (1 - fy) + (light[y1 * size + x0] * (1 - fx) + light[y1 * size + x1] * fx) * fy)
    }
  }
  return field
}

/**
 * A patch laid into a field of where a landing fits (`fitField`): inside the patch, each of the
 * field's pixels becomes the share of the patch's pixels under it where a landing fits, so ground
 * the grid's one value a cell could not tell apart is told apart. `gaps` are the patch's own, one
 * per patch pixel. `flat` is the field's own (`fitField`): the share of a pixel that is not too
 * steep scales it as it does there. Nothing is changed unless the patch's pixels divide the
 * field's exactly.
 */
export function layPatch(field: Float32Array, sub: number, gridSize: number, patch: LightPatch, gaps: GridGaps, req: Requirements, flat: Float32Array | null): void {
  const per = patch.sub / sub
  if (!Number.isInteger(per) || per < 1 || gaps.size !== patch.size) return
  const side = gridSize * sub
  const across = patch.cells * sub
  for (let j = 0; j < across; j += 1) {
    for (let i = 0; i < across; i += 1) {
      const pixel = (patch.row * sub + j) * side + patch.col * sub + i
      const share = flat ? flat[pixel] : 1
      if (share === 0) continue
      let fits = 0
      for (let dj = 0; dj < per; dj += 1) {
        for (let di = 0; di < per; di += 1) {
          if (lightVerdict(gaps, (j * per + dj) * patch.size + i * per + di, req) === FITS) fits += 1
        }
      }
      field[pixel] = (share * fits) / (per * per)
    }
  }
}

/**
 * What a landing does at every pixel of the grid, as a picture (RGBA) in the verdict's own colors
 * (`VERDICT_RGB`): the green of a landing that fits, or the color of the first limit it breaks, as
 * Landing accuracy's map is colored. `sub` pixels along each light cell. A pixel's color is that of
 * the Sun and Earth verdict there, mixed with the color of ground too steep by the share of the
 * pixel that is (`flat`, from `flatShare`; null when the slope could not be read). With `soft`,
 * the Sun and Earth color is read between the light cells' middles rather than cell by cell, so the
 * picture has no squares: a way of drawing a grid known only at those middles, not finer knowledge
 * of the ground. Every pixel is drawn at full strength. It is `fitField` in colors: where that
 * says 1 the pixel is the fit's green.
 */
export function verdictPixels(gaps: GridGaps, req: Requirements, sub: number, flat: Float32Array | null, soft = false): Uint8ClampedArray {
  const { size } = gaps
  const codes = new Uint8Array(size * size)
  for (let cell = 0; cell < codes.length; cell += 1) codes[cell] = lightVerdict(gaps, cell, req)
  const side = size * sub
  const pixels = new Uint8ClampedArray(4 * side * side)
  const steep = VERDICT_RGB[missCode('slope')]
  const last = size - 1
  for (let row = 0; row < side; row += 1) {
    // Where this pixel's middle falls among the light cells' middles.
    const y = soft ? Math.min(last, Math.max(0, (row + 0.5) / sub - 0.5)) : Math.floor(row / sub)
    const y0 = Math.floor(y)
    const y1 = Math.min(last, y0 + 1)
    const fy = y - y0
    for (let col = 0; col < side; col += 1) {
      const x = soft ? Math.min(last, Math.max(0, (col + 0.5) / sub - 0.5)) : Math.floor(col / sub)
      const x0 = Math.floor(x)
      const x1 = Math.min(last, x0 + 1)
      const fx = x - x0
      const a = VERDICT_RGB[codes[y0 * size + x0]]
      const b = VERDICT_RGB[codes[y0 * size + x1]]
      const c = VERDICT_RGB[codes[y1 * size + x0]]
      const d = VERDICT_RGB[codes[y1 * size + x1]]
      const pixel = row * side + col
      const share = flat ? flat[pixel] : 1
      for (let i = 0; i < 3; i += 1) {
        const light = (a[i] * (1 - fx) + b[i] * fx) * (1 - fy) + (c[i] * (1 - fx) + d[i] * fx) * fy
        pixels[4 * pixel + i] = share * light + (1 - share) * steep[i]
      }
      pixels[4 * pixel + 3] = 255
    }
  }
  return pixels
}

/**
 * A patch laid into a picture of what a landing does (`verdictPixels`): inside the patch, each of
 * the picture's pixels becomes the mean color of the patch's pixels under it, each in its own
 * verdict's color, so ground the grid's one value a cell could not tell apart is told apart. `gaps`
 * are the patch's own and `flat` the picture's own, as for `layPatch`, which this is in colors.
 * Nothing is changed unless the patch's pixels divide the picture's exactly.
 */
export function layPatchPixels(pixels: Uint8ClampedArray, sub: number, gridSize: number, patch: LightPatch, gaps: GridGaps, req: Requirements, flat: Float32Array | null): void {
  const per = patch.sub / sub
  if (!Number.isInteger(per) || per < 1 || gaps.size !== patch.size) return
  const side = gridSize * sub
  const across = patch.cells * sub
  const steep = VERDICT_RGB[missCode('slope')]
  const light = [0, 0, 0]
  for (let j = 0; j < across; j += 1) {
    for (let i = 0; i < across; i += 1) {
      light.fill(0)
      for (let dj = 0; dj < per; dj += 1) {
        for (let di = 0; di < per; di += 1) {
          const color = VERDICT_RGB[lightVerdict(gaps, (j * per + dj) * patch.size + i * per + di, req)]
          for (let k = 0; k < 3; k += 1) light[k] += color[k]
        }
      }
      const pixel = (patch.row * sub + j) * side + patch.col * sub + i
      const share = flat ? flat[pixel] : 1
      for (let k = 0; k < 3; k += 1) pixels[4 * pixel + k] = (share * light[k]) / (per * per) + (1 - share) * steep[k]
    }
  }
}

/** Verdict codes as a picture's pixels (RGBA), each in its verdict's color, drawn at `strength` (0 to 1) of full. */
export function codePixels(codes: Uint8Array, strength = 1): Uint8ClampedArray {
  const alpha = Math.round(255 * strength)
  const pixels = new Uint8ClampedArray(4 * codes.length)
  for (let i = 0; i < codes.length; i += 1) {
    const color = VERDICT_RGB[codes[i]]
    pixels[4 * i] = color[0]
    pixels[4 * i + 1] = color[1]
    pixels[4 * i + 2] = color[2]
    pixels[4 * i + 3] = alpha
  }
  return pixels
}

/** A value at a point given from the map's target (m), from values held one a cell of the map; null off the map. */
export function valueAt(map: FitMap, values: Float32Array, x: number, y: number): number | null {
  const cell = cellAtM(map, x, y)
  return cell === null ? null : values[cell]
}

/**
 * Looking around from a site near the south pole: for each compass bearing (degrees clockwise from
 * north), the mean of a value held one a cell of the map (one channel of the verdict's color, say)
 * over the ground from `fromM` to `toM` out that way. On the polar map, north
 * at a site is straight away from the pole and east is a quarter turn clockwise from it, seen from
 * above the south pole. Null for a bearing whose ground is off the map.
 */
export function meanAlongBearings(map: FitMap, values: Float32Array, lonDeg: number, bearingsDeg: number[], fromM: number, toM: number): (number | null)[] {
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
      const here = valueAt(map, values, out * dx, out * dy)
      if (here === null) continue
      sum += here
      count += 1
    }
    return count > 0 ? sum / count : null
  })
}