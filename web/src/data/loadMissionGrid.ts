import { LIGHT_URLS } from '../atlas/useLightGrid'
import { type LightMeta, lightMeta, type LightMetaFile, type LightMonth, patchGrid, readMonth, wideGrid } from '../lib/lightGrid'
import { locateHour } from '../lib/mission'
import { addMonth, type GridGaps, missionMonthsAt, slopeDegFrom, type SlopePart, type Square, startGaps } from '../lib/missionGrid'
import { bytes, gunzip } from './customSite'

/**
 * The mission's gaps at every cell of the light grid, for a landing at `landing` hours from
 * `startIso`; 'past' when the mission runs past the grid's last month. Months are read one after
 * another and let go: each is tens of megabytes unpacked, and the gaps keep six bytes a cell.
 */
export async function loadGaps(meta: LightMeta, startIso: string, landing: number, missionDays: number): Promise<GridGaps | 'past'> {
  const { month, index } = locateHour(startIso, landing)
  return loadGapsAt(meta, month, index, missionDays)
}

/** The same, for a landing given as a month and the hour within it. */
export async function loadGapsAt(meta: LightMeta, month: string, index: number, missionDays: number): Promise<GridGaps | 'past'> {
  const parts = missionMonthsAt(meta, month, index, missionDays)
  if (!parts) return 'past'
  const run = startGaps(meta.size)
  for (const [i, part] of parts.entries()) {
    addMonth(run, await monthFor(meta, part.month), part, i === 0)
  }
  return run
}

/** A picture's 8-bit values: a square of it, `side` pixels along, as stored. */
async function imageValues(url: string, side: number, crop: { left: number; top: number }): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const blob = await response.blob()
  // No color conversion may touch the values: they are slopes, not colors.
  const picture = await createImageBitmap(blob, crop.left, crop.top, side, side, { colorSpaceConversion: 'none' })
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('no canvas to read the slope image with')
  context.drawImage(picture, 0, 0)
  picture.close()
  const rgba = context.getImageData(0, 0, side, side).data
  const values = new Uint8Array(side * side)
  for (let i = 0; i < values.length; i += 1) values[i] = rgba[4 * i]
  return values
}

/** How many of the slope images' pixels fit along one light cell; 0 when this build has no usable slope images. */
function slopePixelsPerCell(meta: LightMeta): number {
  const per = meta.slope_map_size ? meta.slope_map_size / meta.size : 0
  return meta.slope_max && Number.isInteger(per) ? per : 0
}

/**
 * The slope of a square of light cells, at the slope images' own detail. Null if this build has no
 * slope images or they can't be read: the map is then drawn from Sun and Earth alone.
 */
export async function loadSlopePart(meta: LightMeta, square: Square): Promise<SlopePart | null> {
  const sub = slopePixelsPerCell(meta)
  if (!sub || !meta.slope_max) return null
  try {
    const crop = { left: square.col * sub, top: square.row * sub }
    const [x, y] = await Promise.all(LIGHT_URLS.slopes.map((url) => imageValues(url, square.cells * sub, crop)))
    return { ...square, sub, deg: slopeDegFrom(x, y, meta.slope_max) }
  } catch (reason) {
    console.error(reason)
    return null
  }
}

/** Pixels along a light cell in the picture laid over the Moon: half the slope images' detail, to keep it a few megabytes. */
export const WHOLE_SUB = 2

/**
 * The two slope images of the grid's whole square as they are stored, a value for each of their
 * own pixels (row by row from the top): `per` of them along each pixel of the picture laid over
 * the Moon, and the slope (rise over run) at the ends of their 8-bit range.
 */
export interface SlopeImages {
  x: Uint8Array
  y: Uint8Array
  per: number
  slopeMax: number
}

/** A picture's 8-bit values at its own size, read a quarter at a time: the whole of one is tens of megabytes as a canvas. */
async function wholeImageValues(url: string, side: number): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const blob = await response.blob()
  const part = side / 2
  const canvas = document.createElement('canvas')
  canvas.width = part
  canvas.height = part
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('no canvas to read the slope image with')
  const values = new Uint8Array(side * side)
  for (const top of [0, part]) {
    for (const left of [0, part]) {
      // No color conversion may touch the values: they are slopes, not colors.
      const picture = await createImageBitmap(blob, left, top, part, part, { colorSpaceConversion: 'none' })
      context.drawImage(picture, 0, 0)
      picture.close()
      const rgba = context.getImageData(0, 0, part, part).data
      for (let row = 0; row < part; row += 1) {
        const to = (top + row) * side + left
        for (let col = 0; col < part; col += 1) values[to + col] = rgba[4 * (row * part + col)]
      }
    }
  }
  return values
}

let whole: Promise<SlopeImages | null> | null = null

/**
 * The slope images of the whole grid at their own detail, for the picture laid over the Moon: each
 * of its pixels is then judged by the slopes under it, one by one (`flatShare`), not by their
 * average. Read once. Null if this build has none, they do not divide the picture's pixels, or
 * they can't be read.
 */
export function loadSlopeWhole(meta: LightMeta): Promise<SlopeImages | null> {
  whole ??= (async () => {
    const slopeMax = meta.slope_max
    const per = slopePixelsPerCell(meta) / WHOLE_SUB
    if (!meta.slope_map_size || !slopeMax || !Number.isInteger(per) || per < 1) return null
    try {
      // One after the other: each is read through a canvas of sixteen megabytes.
      const x = await wholeImageValues(LIGHT_URLS.slopes[0], meta.slope_map_size)
      const y = await wholeImageValues(LIGHT_URLS.slopes[1], meta.slope_map_size)
      return { x, y, per, slopeMax }
    } catch (reason) {
      console.error(reason)
      return null
    }
  })()
  return whole
}

/**
 * A few results kept by key: asked for once, read again at no cost, and the oldest let go. `now`
 * gives a result that has arrived, without waiting, so a page can draw from it as it renders.
 */
function keep<T>(limit: number) {
  const asked = new Map<string, Promise<T>>()
  const arrived = new Map<string, T>()
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const before = asked.get(key)
      if (before) return before
      const request = load()
      asked.set(key, request)
      request.then(
        (value) => {
          if (asked.get(key) === request) arrived.set(key, value)
        },
        () => asked.delete(key),
      )
      while (asked.size > limit) {
        const oldest = asked.keys().next().value as string
        asked.delete(oldest)
        arrived.delete(oldest)
      }
      return request
    },
    now: (key: string): T | undefined => arrived.get(key),
  }
}

/**
 * A month of the grid, unpacked: tens of megabytes, so only the last two are kept. A landing moved
 * along the time bar reads the same one or two months over and over.
 */
const monthsKept = keep<LightMonth>(2)
function monthFor(meta: LightMeta, month: string): Promise<LightMonth> {
  return monthsKept.get(month, async () => readMonth(await gunzip(await bytes(LIGHT_URLS.month(month))), meta, month))
}

/** One landing's gaps are six megabytes; four scenarios at most are on show. */
const gapsKept = keep<GridGaps | 'past'>(4)
const slopeKept = keep<SlopePart | null>(4)

/** A landing's name among those kept: its month, the hour within it and the mission's length. */
export function gapsKeyAt(month: string, index: number, missionDays: number): string {
  return `${month}+${index}+${missionDays}`
}

export function gapsKey(startIso: string, landing: number, missionDays: number): string {
  const { month, index } = locateHour(startIso, landing)
  return gapsKeyAt(month, index, missionDays)
}

/** `loadGapsAt`, kept: a landing already read is not read again. */
export function gapsAt(meta: LightMeta, month: string, index: number, missionDays: number): Promise<GridGaps | 'past'> {
  return gapsKept.get(gapsKeyAt(month, index, missionDays), () => loadGapsAt(meta, month, index, missionDays))
}

/** The gaps for a landing if they have arrived. */
export function gapsAtNow(month: string, index: number, missionDays: number): GridGaps | 'past' | undefined {
  return gapsKept.now(gapsKeyAt(month, index, missionDays))
}

/** `gapsAt`, for a landing counted in hours from `startIso`. */
export function gapsFor(meta: LightMeta, startIso: string, landing: number, missionDays: number): Promise<GridGaps | 'past'> {
  const { month, index } = locateHour(startIso, landing)
  return gapsAt(meta, month, index, missionDays)
}

/** `gapsAtNow`, for a landing counted in hours from `startIso`. */
export function gapsNow(startIso: string, landing: number, missionDays: number): GridGaps | 'past' | undefined {
  return gapsKept.now(gapsKey(startIso, landing, missionDays))
}

/** A patch's months are a few megabytes unpacked, and four patches may be read for one picture. */
const patchMonthsKept = keep<LightMonth>(12)
const patchGapsKept = keep<GridGaps | 'past' | null>(16)

/**
 * The mission's gaps at every pixel of a patch (`LightMeta.patches`), for a landing at hour `index`
 * of `month`: the grid's own count, on the patch's finer pixels. 'past' when the mission runs past
 * the last month; null when the patch's files could not be read, so the grid's own cells stand.
 */
export function patchGapsAt(meta: LightMeta, site: string, month: string, index: number, missionDays: number): Promise<GridGaps | 'past' | null> {
  return patchGapsKept.get(`${site}/${gapsKeyAt(month, index, missionDays)}`, async () => {
    const patch = meta.patches?.[site]
    if (!patch) return null
    const parts = missionMonthsAt(meta, month, index, missionDays)
    if (!parts) return 'past'
    const grid = patchGrid(meta, patch)
    try {
      const run = startGaps(patch.size)
      for (const [i, part] of parts.entries()) {
        const read = await patchMonthsKept.get(`${site}/${part.month}`, async () => readMonth(await gunzip(await bytes(LIGHT_URLS.patchMonth(site, part.month))), grid, part.month))
        addMonth(run, read, part, i === 0)
      }
      return run
    } catch (reason) {
      console.error(reason)
      return null
    }
  })
}

/** The wide grid's months are as large as the fine grid's, and read the same way: the last two are kept. */
const wideMonthsKept = keep<LightMonth>(2)
const wideGapsKept = keep<GridGaps | 'past' | null>(4)

/**
 * The mission's gaps at every cell of the wide grid (`LightMeta.wide`: larger cells reaching
 * farther from the pole), for a landing at hour `index` of `month`. 'past' when the mission runs
 * past the last month; null when this build has no wide grid or its files could not be read, so
 * the ground beyond the fine grid is left to the smooth Moon.
 */
export function wideGapsAt(meta: LightMeta, month: string, index: number, missionDays: number): Promise<GridGaps | 'past' | null> {
  return wideGapsKept.get(gapsKeyAt(month, index, missionDays), async () => {
    const grid = wideGrid(meta)
    if (!grid) return null
    const parts = missionMonthsAt(grid, month, index, missionDays)
    if (!parts) return 'past'
    try {
      const run = startGaps(grid.size)
      for (const [i, part] of parts.entries()) {
        const read = await wideMonthsKept.get(part.month, async () => readMonth(await gunzip(await bytes(LIGHT_URLS.wideMonth(part.month))), grid, part.month))
        addMonth(run, read, part, i === 0)
      }
      return run
    } catch (reason) {
      console.error(reason)
      return null
    }
  })
}

/** The light grids' description, or null when this build has none: asked for once. */
let metaAsked: Promise<LightMeta | null> | null = null
export function loadLightMeta(): Promise<LightMeta | null> {
  metaAsked ??= fetch(LIGHT_URLS.meta)
    .then(async (response) => (response.ok ? lightMeta((await response.json()) as LightMetaFile) : null))
    .catch(() => null)
  return metaAsked
}

function squareKey(square: Square): string {
  return `${square.col},${square.row},${square.cells}`
}

/** `loadSlopePart`, kept. */
export function slopePartFor(meta: LightMeta, square: Square): Promise<SlopePart | null> {
  return slopeKept.get(squareKey(square), () => loadSlopePart(meta, square))
}

/** A square's slope if it has arrived: null when it could not be read, undefined while it has not arrived. */
export function slopePartNow(square: Square): SlopePart | null | undefined {
  return slopeKept.now(squareKey(square))
}
