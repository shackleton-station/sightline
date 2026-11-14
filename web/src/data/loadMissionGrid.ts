import { LIGHT_URLS } from '../atlas/useLightGrid'
import { type LightMeta, lightMeta, type LightMetaFile, type LightMonth, readMonth } from '../lib/lightGrid'
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

/** A picture's 8-bit values: a square of it as stored, or the whole of it shrunk to `side` pixels. */
async function imageValues(url: string, side: number, crop: { left: number; top: number } | null): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const blob = await response.blob()
  // No color conversion may touch the values: they are slopes, not colors.
  const picture = crop
    ? await createImageBitmap(blob, crop.left, crop.top, side, side, { colorSpaceConversion: 'none' })
    : await createImageBitmap(blob, { resizeWidth: side, resizeHeight: side, resizeQuality: 'high', colorSpaceConversion: 'none' })
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

let whole: Promise<Float32Array | null> | null = null

/**
 * The whole grid's slope in degrees, `WHOLE_SUB` values along each light cell: the slope images
 * shrunk, so each value is the slope across that much ground. Read once and kept. Null if it can't be.
 */
export function loadSlopeWhole(meta: LightMeta): Promise<Float32Array | null> {
  whole ??= (async () => {
    const slopeMax = meta.slope_max
    if (!slopePixelsPerCell(meta) || !slopeMax) return null
    try {
      const [x, y] = await Promise.all(LIGHT_URLS.slopes.map((url) => imageValues(url, meta.size * WHOLE_SUB, null)))
      return slopeDegFrom(x, y, slopeMax)
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
