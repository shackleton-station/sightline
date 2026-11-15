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

/** The line about a body at the landing's hour: "At landing: 0.3° above the skyline · sets in 5 d 11 h", with the share of a cut disc between. */
export function landingWords(figure: string, side: string, next: string, showing: string | null): string {
  return `At landing: ${figure} ${side}${showing ? `, ${showing}` : ''} · ${next}`
}

/** A share of the mission as the row's main figure: "61%". */
export function sharePct(pct: number): string {
  return `${Math.round(pct)}%`
}

