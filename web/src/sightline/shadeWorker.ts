import { loadYearPositions } from '../data/customSite'
import { gapsAt, patchGapsAt, type SlopeImages, wideGapsAt } from '../data/loadMissionGrid'
import { type LightMeta, wideGrid } from '../lib/lightGrid'
import type { Requirements } from '../lib/mission'
import { codePixels, flatShare, layPatchPixels, verdictPixels } from '../lib/missionGrid'
import { smoothMoonVerdict, WASH_SIZE } from '../lib/moonWash'

/**
 * The "Landings that fit" pictures, worked out off the page's own thread: a picture of the polar
 * ground is a pass over a month or two of the light grid and four million pixels to color, too
 * much to do between two frames of a time bar being played.
 *
 * Each picture says what a landing exactly at each spot does, in the colors of Landing accuracy's
 * map: the fit's green, or the color of the first limit broken. It is not blurred by a lander's
 * miss: that is what the panel's rings and simulated landers show, on the same ground.
 */

/** Pixels along a light cell in the polar picture. A patch's 20 m pixels are a third of these: nine to a pixel. */
const POLAR_SUB = 2
/**
 * How strongly the smooth Moon's picture is drawn, as a share of the terrain pictures' strength. It
 * knows no terrain, so it is a guide to day, night and the side Earth is on, not what a landing on
 * that ground does: drawn fainter, it does not read as the same answer as the ground round the pole.
 */
const SMOOTH_STRENGTH = 0.5

/** What the page asks for. Every ask is answered, in the order asked. */
export type ShadeAsk =
  /** The whole grid's slope images at their own detail: given once, before any polar picture. */
  | { id: number; kind: 'slope'; slope: SlopeImages | null }
  /** The polar picture for a landing at hour `index` of `month`. */
  | { id: number; kind: 'polar'; meta: LightMeta; month: string; index: number; requirements: Requirements; maxSlopeDeg: number }
  /** The picture of the ground the wide grid holds, round the polar one, for the same landing. The slope is not judged there: there are no slope images of it. */
  | { id: number; kind: 'wide'; meta: LightMeta; month: string; index: number; requirements: Requirements }
  /** The whole Moon's picture for a landing at hour `hour` of `year`. */
  | { id: number; kind: 'wash'; year: number; hour: number; requirements: Requirements }

/** A picture's pixels (RGBA), or none: the mission runs past the data, or the picture could not be made. */
export interface ShadeAnswer {
  id: number
  width: number
  height: number
  pixels: ArrayBuffer | null
}

let slope: SlopeImages | null = null
/** The share of each picture pixel's ground under the slope limit last asked for: a mission's limit changes seldom. */
let flat: { maxSlopeDeg: number; share: Float32Array } | null = null

function flatFor(maxSlopeDeg: number): Float32Array | null {
  if (!slope) return null
  if (flat?.maxSlopeDeg !== maxSlopeDeg) flat = { maxSlopeDeg, share: flatShare(slope.x, slope.y, slope.slopeMax, slope.per, maxSlopeDeg) }
  return flat.share
}

async function polar(ask: Extract<ShadeAsk, { kind: 'polar' }>): Promise<{ side: number; pixels: Uint8ClampedArray } | null> {
  const gaps = await gapsAt(ask.meta, ask.month, ask.index, ask.requirements.missionDays)
  if (gaps === 'past') return null
  const level = flatFor(ask.maxSlopeDeg)
  const pixels = verdictPixels(gaps, ask.requirements, POLAR_SUB, level, true)
  // Round the ridge sites the ground is known at the terrain's own 20 m: laid in over the grid's 120 m cells.
  for (const [site, patch] of Object.entries(ask.meta.patches ?? {})) {
    const fine = await patchGapsAt(ask.meta, site, ask.month, ask.index, ask.requirements.missionDays)
    if (fine && fine !== 'past') layPatchPixels(pixels, POLAR_SUB, gaps.size, patch, fine, ask.requirements, level)
  }
  return { side: gaps.size * POLAR_SUB, pixels }
}

/**
 * The wide grid's picture: a pixel a cell. Its cells are far larger than a lander's miss, so there is
 * nothing to gain from more pixels; the globe reads between their middles as it draws them.
 */
async function wide(ask: Extract<ShadeAsk, { kind: 'wide' }>): Promise<{ side: number; pixels: Uint8ClampedArray } | null> {
  const grid = wideGrid(ask.meta)
  const gaps = grid ? await wideGapsAt(ask.meta, ask.month, ask.index, ask.requirements.missionDays) : null
  if (!grid || !gaps || gaps === 'past') return null
  return { side: gaps.size, pixels: verdictPixels(gaps, ask.requirements, 1, null) }
}

async function wash(ask: Extract<ShadeAsk, { kind: 'wash' }>): Promise<Uint8ClampedArray | null> {
  const first = await loadYearPositions(ask.year)
  let positions = first
  // A mission that runs into the next year needs that year's positions too.
  if ((ask.hour + ask.requirements.missionDays * 24) * 6 > first.length) {
    const second = await loadYearPositions(ask.year + 1).catch(() => null)
    if (second) {
      positions = new Float32Array(first.length + second.length)
      positions.set(first)
      positions.set(second, first.length)
    }
  }
  const verdict = smoothMoonVerdict(positions, ask.hour, ask.requirements)
  return verdict ? codePixels(verdict, SMOOTH_STRENGTH) : null
}

async function answer(ask: ShadeAsk): Promise<ShadeAnswer> {
  const none = { id: ask.id, width: 0, height: 0, pixels: null }
  if (ask.kind === 'slope') {
    slope = ask.slope
    flat = null
    return none
  }
  if (ask.kind === 'polar' || ask.kind === 'wide') {
    const made = ask.kind === 'polar' ? await polar(ask) : await wide(ask)
    return made ? { id: ask.id, width: made.side, height: made.side, pixels: made.pixels.buffer as ArrayBuffer } : none
  }
  const pixels = await wash(ask)
  return pixels ? { id: ask.id, width: WASH_SIZE.width, height: WASH_SIZE.height, pixels: pixels.buffer as ArrayBuffer } : none
}

// One ask at a time, in order: a picture is tens of megabytes while it is made.
let last: Promise<unknown> = Promise.resolve()
const post = (message: ShadeAnswer) => (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(message, message.pixels ? [message.pixels] : [])
addEventListener('message', (event: MessageEvent<ShadeAsk>) => {
  const ask = event.data
  last = last
    .then(() => answer(ask))
    .catch((reason: unknown) => {
      console.error(reason)
      return { id: ask.id, width: 0, height: 0, pixels: null }
    })
    .then(post)
})
