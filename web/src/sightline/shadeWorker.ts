import { loadYearPositions } from '../data/customSite'
import { gapsAt, patchGapsAt, type SlopeImages, wideGapsAt } from '../data/loadMissionGrid'
import type { Spread } from '../lib/landingOdds'
import { type LightMeta, wideGrid } from '../lib/lightGrid'
import type { Requirements } from '../lib/mission'
import { blurReads, fitField, flatShare, halved, layPatch, oddsField, oddsPixels } from '../lib/missionGrid'
import { smoothMoonFit, softened, WASH_SIZE } from '../lib/moonWash'

/**
 * The "Landings that fit" pictures, worked out off the page's own thread: a picture of
 * the polar ground is a pass over a month or two of the light grid and a blur of four million
 * pixels, too much to do between two frames of a time bar being played.
 */

/**
 * Pixels along a light cell in the polar picture. A patch's 20 m pixels are a third of these: nine to a pixel.
 *
 * The picture is blurred by the lander's own spread and by nothing more. It used to be softened by
 * at least 75 m so that no cell showed as a square; reading the grid between its cells' middles
 * already sees to that, and the extra blur drew a lander of 100 m as one of about 230 m: against
 * the ground judged point by point it doubled the picture's error where the grid is all there is,
 * and made it five times worse over a patch (`scripts/fit-layer-check.ts`, docs/VALIDATION.md §19).
 */
const POLAR_SUB = 2
/** The most pixel reads one picture may cost: past it, the picture is made at half the size. */
const READS_BUDGET = 80e6

/** What the page asks for. Every ask is answered, in the order asked. */
export type ShadeAsk =
  /** The whole grid's slope images at their own detail: given once, before any polar picture. */
  | { id: number; kind: 'slope'; slope: SlopeImages | null }
  /** The polar picture for a landing at hour `index` of `month`. */
  | { id: number; kind: 'polar'; meta: LightMeta; month: string; index: number; requirements: Requirements; maxSlopeDeg: number; spread: Spread }
  /** The picture of the ground the wide grid holds, round the polar one, for the same landing. The slope is not judged there: there are no slope images of it. */
  | { id: number; kind: 'wide'; meta: LightMeta; month: string; index: number; requirements: Requirements; spread: Spread }
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
  const full = gaps.size * POLAR_SUB
  const fullM = ask.meta.pixel_m / POLAR_SUB
  const level = flatFor(ask.maxSlopeDeg)
  const fits = fitField(gaps, ask.requirements, POLAR_SUB, level, true)
  // Round the ridge sites the ground is known at the terrain's own 20 m: laid in over the grid's 120 m cells.
  for (const [site, patch] of Object.entries(ask.meta.patches ?? {})) {
    const fine = await patchGapsAt(ask.meta, site, ask.month, ask.index, ask.requirements.missionDays)
    if (fine && fine !== 'past') layPatch(fits, POLAR_SUB, gaps.size, patch, fine, ask.requirements, level)
  }
  // A wide spread blurs far: at half the size it reads a quarter of the pixels over half the distance.
  const small = full * full * blurReads(fullM, ask.spread) > READS_BUDGET
  const side = small ? full / 2 : full
  const odds = oddsField(small ? halved(fits, full) : fits, side, small ? 2 * fullM : fullM, ask.spread)
  return { side, pixels: oddsPixels(odds) }
}

/**
 * The wide grid's picture: a pixel a cell. Its cells are far larger than a lander's miss, so there is
 * nothing to gain from more pixels; the globe reads between their middles as it draws them.
 */
async function wide(ask: Extract<ShadeAsk, { kind: 'wide' }>): Promise<{ side: number; pixels: Uint8ClampedArray } | null> {
  const grid = wideGrid(ask.meta)
  const gaps = grid ? await wideGapsAt(ask.meta, ask.month, ask.index, ask.requirements.missionDays) : null
  if (!grid || !gaps || gaps === 'past') return null
  const odds = oddsField(fitField(gaps, ask.requirements, 1, null), gaps.size, grid.pixel_m, ask.spread)
  return { side: gaps.size, pixels: oddsPixels(odds) }
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
  const fit = smoothMoonFit(positions, ask.hour, ask.requirements)
  return fit ? oddsPixels(softened(fit, WASH_SIZE)) : null
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
