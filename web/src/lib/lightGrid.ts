/**
 * The light grid: the pipeline's Sun and Earth visibility at every pixel of a square around the south
 * pole (`pipeline/src/clps/lightgrid.py`). A month holds, for each pixel, the hours at which the Sun
 * (and Earth) changes between up and down, starting from "down": a pixel is up at hour `t` when an
 * odd number of its flips are at or before `t`. Unused slots hold the number of hours in the month.
 *
 * The grid lives in the terrain's own south-polar map plane: row 0 is the largest map y, column 0
 * the smallest map x, and values are at pixel centers.
 */

import { hoursByMonth } from './span'

/** The light grids as the app works with them: `data/light/meta.json`, with every month named (`lightMeta`). */
export interface LightMeta {
  size: number
  pixel_m: number
  half_width_m: number
  radius_m: number
  /** The east longitudes that map x and map y point toward, in degrees. */
  x_axis_lon_deg: number
  y_axis_lon_deg: number
  obs_height_m: number
  sun_slots: number
  earth_slots: number
  /**
   * The slope images of the grid's square (`tiles/light/slope_x.jpg` and `slope_y.jpg`): their
   * pixels along a side, and the slope (rise over run) at the ends of their 8-bit range.
   */
  slope_map_size?: number
  slope_max?: number
  /** Hours in each month the grid has, keyed "2027-05". */
  hours: Record<string, number>
  /**
   * A second, coarser grid around this one, on the same plane and for the same months: larger
   * pixels reaching farther from the pole. Its month files are read the same way.
   */
  wide?: { size: number; pixel_m: number; half_width_m: number; hours?: Record<string, number> }
  /**
   * Patches: squares of this grid's cells worked out again at the terrain's own pixel size, each
   * named for the site it is round. A patch's month files are read as this grid's are.
   */
  patches?: Record<string, LightPatch>
}

/** A patch of the grid: whole cells, each split into `sub` pixels along a side. */
export interface LightPatch {
  /** Patch pixels along a side (`cells * sub`), and their size in meters. */
  size: number
  pixel_m: number
  /** The grid's column and row of the patch's top-left cell, and the grid cells along a side. */
  col: number
  row: number
  cells: number
  /** Patch pixels along one grid cell. */
  sub: number
}

/** A patch as a grid description of its own, for reading its month files: the grid's months and slots at the patch's size. */
export function patchGrid(meta: LightMeta, patch: LightPatch): LightMeta {
  return { ...meta, size: patch.size, pixel_m: patch.pixel_m, wide: undefined, patches: undefined }
}

/**
 * `data/light/meta.json` as the pipeline writes it. A grid's months are named by their first and
 * last, not listed, so the file is the same size however many years the grids cover.
 */
export interface LightMetaFile extends Omit<LightMeta, 'hours' | 'wide'> {
  first_month: string
  last_month: string
  wide?: { size: number; pixel_m: number; half_width_m: number; first_month: string; last_month: string }
}

/** The pipeline's description with each grid's months listed, each with its hours by the calendar. */
export function lightMeta(file: LightMetaFile): LightMeta {
  const { wide, ...fine } = file
  return {
    ...fine,
    hours: hoursByMonth(file.first_month, file.last_month),
    wide: wide ? { ...wide, hours: hoursByMonth(wide.first_month, wide.last_month) } : undefined,
  }
}

/** The wide grid as a grid description of its own, or null if this build has none. */
export function wideGrid(meta: LightMeta): LightMeta | null {
  return meta.wide ? { ...meta, ...meta.wide, wide: undefined } : null
}

export interface LightMonth {
  month: string
  hours: number
  size: number
  sunSlots: number
  earthSlots: number
  /** Flips, slot by slot: `slots` planes of `size * size`. */
  sun: Uint16Array
  earth: Uint16Array
}

export interface Cell {
  col: number
  row: number
}

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** A month file's bytes (already unpacked) as flips. Throws if it isn't this grid's shape. */
export function readMonth(buffer: ArrayBuffer, meta: LightMeta, month: string): LightMonth {
  const cells = meta.size * meta.size
  const hours = meta.hours[month]
  if (hours === undefined) throw new Error(`the light grid has no ${month}`)
  if (buffer.byteLength !== 2 * cells * (meta.sun_slots + meta.earth_slots)) {
    throw new Error(`light grid ${month}: ${buffer.byteLength} bytes is not this grid`)
  }
  const all = new Uint16Array(buffer)
  return {
    month,
    hours,
    size: meta.size,
    sunSlots: meta.sun_slots,
    earthSlots: meta.earth_slots,
    sun: all.subarray(0, cells * meta.sun_slots),
    earth: all.subarray(cells * meta.sun_slots),
  }
}

/** Map x and y (meters) of a point, in the grid's south-polar stereographic plane. */
export function planeXY(meta: LightMeta, latDeg: number, lonDeg: number): { x: number; y: number } {
  const lat = latDeg * RAD
  const lon = lonDeg * RAD
  // Distance from the pole on the map: 2R tan(colatitude / 2), written to stay exact near the pole.
  const reach = (2 * meta.radius_m * Math.cos(lat)) / (1 - Math.sin(lat))
  return {
    x: reach * Math.cos(lon - meta.x_axis_lon_deg * RAD),
    y: reach * Math.cos(lon - meta.y_axis_lon_deg * RAD),
  }
}

/** The grid cell holding a point, or null outside the grid. */
export function cellAt(meta: LightMeta, latDeg: number, lonDeg: number): Cell | null {
  if (latDeg > -60) return null
  const { x, y } = planeXY(meta, latDeg, lonDeg)
  const col = Math.floor((x + meta.half_width_m) / meta.pixel_m)
  const row = Math.floor((meta.half_width_m - y) / meta.pixel_m)
  return col >= 0 && col < meta.size && row >= 0 && row < meta.size ? { col, row } : null
}

/** Latitude and longitude (degrees) of a cell's center. */
export function cellCenter(meta: LightMeta, cell: Cell): { lat: number; lon: number } {
  return planeLatLon(meta, -meta.half_width_m + (cell.col + 0.5) * meta.pixel_m, meta.half_width_m - (cell.row + 0.5) * meta.pixel_m)
}

/** Latitude and longitude (degrees) of a point given by its map x and y (meters) in the grid's plane: `planeXY` the other way. */
export function planeLatLon(meta: LightMeta, x: number, y: number): { lat: number; lon: number } {
  const colat = 2 * Math.atan(Math.hypot(x, y) / (2 * meta.radius_m))
  const ax = meta.x_axis_lon_deg * RAD
  const ay = meta.y_axis_lon_deg * RAD
  const east = x * Math.sin(ax) + y * Math.sin(ay)
  const zero = x * Math.cos(ax) + y * Math.cos(ay)
  return { lat: colat * DEG - 90, lon: Math.atan2(east, zero) * DEG }
}

/** Up (1) or down (0) for every hour of the month at one cell. */
export function upSeries(month: LightMonth, body: 'sun' | 'earth', cell: Cell): Uint8Array {
  const slots = body === 'sun' ? month.sunSlots : month.earthSlots
  const planes = body === 'sun' ? month.sun : month.earth
  const cells = month.size * month.size
  const at = cell.row * month.size + cell.col
  const series = new Uint8Array(month.hours)
  let up = 0
  let from = 0
  for (let slot = 0; slot < slots; slot++) {
    const flip = Math.min(planes[slot * cells + at], month.hours)
    if (up) series.fill(1, from, flip)
    from = flip
    up ^= 1
    if (flip >= month.hours) return series
  }
  if (up) series.fill(1, from, month.hours)
  return series
}

export interface SpotNumbers {
  pctSun: number
  pctEarth: number
  pctBoth: number
  /** The longest run of hours without the Sun, and without Earth, inside the month. */
  sunGapH: number
  earthGapH: number
}

function longestDown(series: Uint8Array): number {
  let longest = 0
  let run = 0
  for (const up of series) {
    run = up ? 0 : run + 1
    if (run > longest) longest = run
  }
  return longest
}

/** A cell's month in numbers, counted the way a site's summary is: hours up over hours in the month. */
export function numbersFor(sun: Uint8Array, earth: Uint8Array): SpotNumbers {
  let sunUp = 0
  let earthUp = 0
  let both = 0
  for (let hour = 0; hour < sun.length; hour++) {
    sunUp += sun[hour]
    earthUp += earth[hour]
    both += sun[hour] & earth[hour]
  }
  const pct = (count: number) => (100 * count) / sun.length
  return { pctSun: pct(sunUp), pctEarth: pct(earthUp), pctBoth: pct(both), sunGapH: longestDown(sun), earthGapH: longestDown(earth) }
}

export interface Spot {
  cell: Cell
  sun: Uint8Array
  earth: Uint8Array
  numbers: SpotNumbers
  /** The lowest and highest of each number among this cell and the eight around it. */
  nearby: { [K in keyof SpotNumbers]: [number, number] }
}

/** Everything the grid knows about one cell for the month, with how much its neighbours differ. */
export function spotAt(month: LightMonth, cell: Cell): Spot {
  const sun = upSeries(month, 'sun', cell)
  const earth = upSeries(month, 'earth', cell)
  const numbers = numbersFor(sun, earth)
  const nearby = Object.fromEntries(Object.entries(numbers).map(([key, value]) => [key, [value, value]])) as Spot['nearby']
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      const next = { col: cell.col + dCol, row: cell.row + dRow }
      if ((dRow === 0 && dCol === 0) || next.col < 0 || next.row < 0 || next.col >= month.size || next.row >= month.size) continue
      const theirs = numbersFor(upSeries(month, 'sun', next), upSeries(month, 'earth', next))
      for (const key of Object.keys(numbers) as (keyof SpotNumbers)[]) {
        nearby[key] = [Math.min(nearby[key][0], theirs[key]), Math.max(nearby[key][1], theirs[key])]
      }
    }
  }
  return { cell, sun, earth, numbers, nearby }
}

/** "62%", or "48 to 71%" when the neighbours differ by a whole point or more. */
export function rangeWords([low, high]: [number, number], unit = '%'): string {
  const a = Math.round(low)
  const b = Math.round(high)
  return a === b ? `${a}${unit}` : `${a} to ${b}${unit}`
}

/** Great-circle distance between two points on the Moon, in kilometers. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }, radiusM: number): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2
  return (2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)))) / 1000
}

/** The share (0 to 1) of the grid's cells that have the Sun for at least `share` of the month. */
export function cellsWithSunAtLeast(month: LightMonth, share: number): number {
  const cells = month.size * month.size
  const needed = share * month.hours
  let count = 0
  for (let cell = 0; cell < cells; cell++) {
    // Flips come in pairs: the start and end of a run of hours with the Sun up.
    let up = 0
    for (let slot = 0; slot + 1 < month.sunSlots; slot += 2) up += month.sun[(slot + 1) * cells + cell] - month.sun[slot * cells + cell]
    if (up >= needed) count += 1
  }
  return count / cells
}

function upAt(planes: Uint16Array, slots: number, cells: number, cell: number, hour: number): boolean {
  let passed = 0
  for (let slot = 0; slot < slots; slot++) if (planes[slot * cells + cell] <= hour) passed += 1
  return passed % 2 === 1
}

/** The shares (0 to 1) of the grid's cells that see the Sun, Earth, and both, at one hour of the month. */
export function cellsUpAt(month: LightMonth, hour: number): { sun: number; earth: number; both: number } {
  const cells = month.size * month.size
  let sun = 0
  let earth = 0
  let both = 0
  for (let cell = 0; cell < cells; cell++) {
    const sunUp = upAt(month.sun, month.sunSlots, cells, cell, hour)
    const earthUp = upAt(month.earth, month.earthSlots, cells, cell, hour)
    if (sunUp) sun += 1
    if (earthUp) earth += 1
    if (sunUp && earthUp) both += 1
  }
  return { sun: sun / cells, earth: earth / cells, both: both / cells }
}
