import { degWords, elevationWords } from './sightline'
import { EDGE_ONLY_UNDER } from './sightlineSky'

/** How a figure stands against the mission: within its limit, only just, past it, or there is no limit to hold it to. */
export type Check = 'ok' | 'marginal' | 'miss' | 'none'

/** Each state's mark, so its colour is never the only sign. A figure with no limit has none. */
export const CHECK_MARK: Record<Check, string> = { ok: '✓', marginal: '◇', miss: '✗', none: '' }

const GAP_WORDS = {
  sun: { gap: 'Longest dark spell', none: 'No dark spell' },
  earth: { gap: 'Longest radio silence', none: 'No radio silence' },
}

/**
 * The longest time without the Sun, or without Earth, during the mission, against the mission's
 * limit: "Longest dark spell 95 h · limit 24 h". `limitH` is null when the mission sets none.
 */
export function gapCheck(body: 'sun' | 'earth', gapH: number, limitH: number | null, missionDays: number): { check: Check; words: string; hours: string | null; limit: string } {
  const words = GAP_WORDS[body]
  const check: Check = limitH === null ? 'none' : gapH > limitH ? 'miss' : 'ok'
  const limit = limitH === null ? 'no limit' : `limit ${limitH} h`
  if (gapH === 0) return { check, words: `${words.none} in these ${missionDays} ${missionDays === 1 ? 'day' : 'days'}`, hours: null, limit }
  return { check, words: words.gap, hours: `${gapH} h`, limit }
}

/**
 * A body at the landing's hour against the mission: out of view when the mission needs it in view is
 * a miss; in view by under half its disc is marginal, as the verdict counts it; in view when the
 * mission needs it is within. With no such need, and nothing marginal, there is nothing to mark.
 */
export function landingCheck(required: boolean, up: boolean, share: number | null): Check {
  if (!up) return required ? 'miss' : 'none'
  if (share !== null && share > 0 && share < EDGE_ONLY_UNDER) return 'marginal'
  return required ? 'ok' : 'none'
}

/**
 * The line about a body at the landing's hour: "At landing: 0.3° above the skyline · sets in 5 d 11 h".
 * Where the skyline cuts the disc the line says whose position the angle is, the center's, and what
 * still shows: "center 0.8° below the skyline, edge showing (under 1%)". Any part
 * showing counts as in view, so a center below the skyline beside "in view" is not a contradiction.
 */
export function landingWords(figure: string, side: string, next: string, showing: string | null): string {
  if (!showing) return `At landing: ${figure} ${side} · ${next}`
  const disc = side.startsWith('below') ? `edge showing (${showing.replace(/ of the disc showing$/, '')})` : showing
  return `At landing: center ${figure} ${side}, ${disc} · ${next}`
}

/**
 * The Sun's elevation at the landing's hour, beside the row's name: "elevation −1.2° from level at
 * landing". The angle is named by what it is measured from, so it is not read as "above the skyline".
 */
export function elevationAtLanding(elDeg: number): string {
  return `${elevationWords(elDeg)} at landing`
}

/** Its hover text: what the angle is, and why a figure below level can still be in view. */
export function elevationMeans(obsHeightM: number): string {
  const up = obsHeightM === 2 ? '' : `, ${obsHeightM} m up`
  return `The Sun’s elevation at landing: its height above a flat horizon, seen from the panel${up}. From high ground the skyline lies below 0°, so a negative figure can still be in view.`
}

/**
 * The same angle over the mission's sunlit hours, after their count: "at −2.0° to −1.2°", or one
 * figure when the lowest and the highest round to the same tenth.
 */
export function whileUpWords(lowDeg: number, highDeg: number): string {
  const low = degWords(lowDeg)
  const high = degWords(highDeg)
  return low === high ? `at ${low}` : `at ${low} to ${high}`
}

/** Its hover text. */
export const WHILE_UP_MEANS = 'The Sun’s elevation, its height above a flat horizon, over the mission’s hours with any of it in view: lowest to highest.'

/** A share of the mission as the row's main figure: "61%". */
export function sharePct(pct: number): string {
  return `${Math.round(pct)}%`
}


/**
 * What a row's share of the mission is, for its tooltip: one idea, then how to read it. The height
 * above the ground is said only when it is not the screen's own 2 m, where it changes the figure.
 */
export function shareMeans(body: 'sun' | 'earth', obsHeightM: number): string {
  const up = obsHeightM === 2 ? '' : `, ${obsHeightM} m up`
  return body === 'sun'
    ? `The share of the mission’s hours with any of the Sun in view from the panel${up}. More means more solar power.`
    : `The share of the mission’s hours with Earth in view from the antenna${up}, by your rule. More means more time with a direct radio link.`
}
