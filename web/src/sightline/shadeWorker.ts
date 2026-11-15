import { loadYearPositions } from '../data/customSite'
import { gapsAt } from '../data/loadMissionGrid'
import type { Spread } from '../lib/landingOdds'
import type { LightMeta } from '../lib/lightGrid'
import type { Requirements } from '../lib/mission'
import { blurReads, fitField, halved, oddsField, oddsPixels } from '../lib/missionGrid'
import { smoothMoonFit, softened, WASH_SIZE } from '../lib/moonWash'

/**
 * The "Landings that fit" pictures, worked out off the page's own thread: a picture of
 * the polar ground is a pass over a month or two of the light grid and a blur of four million
 * pixels, too much to do between two frames of a time bar being played.
 */

/** Pixels along a light cell in the polar picture. */
const POLAR_SUB = 2
/** The least the polar picture is softened by, in its own pixels (60 m each at full size): the grid's 120 m cells do not show as squares. */
const SOFTEN_PX = 1.25
/** The most pixel reads one picture may cost: past it, the picture is made at half the size. */
const READS_BUDGET = 80e6

/** What the page asks for. Every ask is answered, in the order asked. */
export type ShadeAsk =
  /** The whole grid's slope in degrees, `POLAR_SUB` values along each light cell: given once, before any polar picture. */
  | { id: number; kind: 'slope'; slope: Float32Array | null }
  /** The polar picture for a landing at hour `index` of `month`. */
  | { id: number; kind: 'polar'; meta: LightMeta; month: string; index: number; requirements: Requirements; maxSlopeDeg: number; spread: Spread }
  /** The whole Moon's picture for a landing at hour `hour` of `year`. */
  | { id: number; kind: 'wash'; year: number; hour: number; requirements: Requirements }

/** A picture's pixels (RGBA), or none: the mission runs past the data, or the picture could not be made. */
export interface ShadeAnswer {
  id: number
  width: number
  height: number
  pixels: ArrayBuffer | null
}

let slope: Float32Array | null = null

async function polar(ask: Extract<ShadeAsk, { kind: 'polar' }>): Promise<{ side: number; pixels: Uint8ClampedArray } | null> {
  const gaps = await gapsAt(ask.meta, ask.month, ask.index, ask.requirements.missionDays)
  if (gaps === 'past') return null
  const full = gaps.size * POLAR_SUB
  const fullM = ask.meta.pixel_m / POLAR_SUB
  const fits = fitField(gaps, ask.requirements, ask.maxSlopeDeg, POLAR_SUB, slope, true)
  // A wide spread blurs far: at half the size it reads a quarter of the pixels over half the distance.
  const small = full * full * blurReads(fullM, ask.spread) > READS_BUDGET
  const side = small ? full / 2 : full
  const odds = oddsField(small ? halved(fits, full) : fits, side, small ? 2 * fullM : fullM, ask.spread, small ? SOFTEN_PX / 2 : SOFTEN_PX)
  return { side, pixels: oddsPixels(odds) }
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
    return none
  }
  if (ask.kind === 'polar') {
    const made = await polar(ask)
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
