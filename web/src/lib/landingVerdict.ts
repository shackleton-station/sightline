import { isNoGapLimit, type Requirements } from './mission'
import { marginalReasons } from './sightlineSky'

/** Whether a landing fits the mission: with room, only just, or not. Every screen that says so says one of these three. */
export type VerdictState = 'fits' | 'marginal' | 'miss'

/** Each state's mark, so its color is never the only sign. */
export const VERDICT_MARK: Record<VerdictState, string> = { fits: '✓', marginal: '◇', miss: '✗' }

/** Each state in the plan column's words. */
export const VERDICT_WORDS: Record<VerdictState, string> = { fits: 'Fits the mission', marginal: 'Fits, marginal', miss: 'Does not fit the mission' }

/** How much of the Sun's and of Earth's disc is in view at a landing's hour; Earth's is null where its size could not be read. */
export interface DiscsAtLanding {
  sun: number
  earth: number | null
  earthUp: boolean
}

/**
 * Why a landing that meets every limit only just does: the mission needs the Sun, or Earth, in view
 * at landing, and under half of its disc is. Empty when neither, or while the discs are not known.
 */
export function marginalAtLanding(requirements: Pick<Requirements, 'sunAtLanding' | 'earthAtLanding'>, at: DiscsAtLanding | null): string[] {
  return at ? marginalReasons(requirements.sunAtLanding ? at.sun : null, requirements.earthAtLanding ? at.earth : null, at.earthUp) : []
}

export interface LandingVerdict {
  state: VerdictState
  mark: string
  words: string
  /** Why: the limits it misses, or what makes a fit marginal; empty for a plain fit. */
  reasons: string[]
}

/**
 * The verdict on one landing, from the limits it misses (`fitProblems`) and what makes a fit
 * marginal (`marginalAtLanding`). The plan column, both Compare tables, the exported table and the
 * written brief all take theirs from here.
 */
export function landingVerdict(problems: string[], marginal: string[]): LandingVerdict {
  const state: VerdictState = problems.length > 0 ? 'miss' : marginal.length > 0 ? 'marginal' : 'fits'
  return { state, mark: VERDICT_MARK[state], words: VERDICT_WORDS[state], reasons: state === 'miss' ? problems : state === 'marginal' ? marginal : [] }
}

/** A limit on a time without the Sun or Earth, as it is written anywhere: "24 h", or "no limit" for the number a link carries in its place. */
export function limitWords(hours: number): string {
  return isNoGapLimit(hours) ? 'no limit' : `${hours} h`
}

/**
 * A mission's two limits on time without the Sun and without Earth, as part of a sentence: "can go
 * up to 24 h without the Sun and 48 h without Earth". A limit that is not set is said so, never as
 * hours: "can go up to 24 h without the Sun, with no limit on time without Earth".
 */
export function gapLimitsWords(maxSunGapH: number, maxEarthGapH: number, upTo = 'up to '): string {
  const sun = !isNoGapLimit(maxSunGapH)
  const earth = !isNoGapLimit(maxEarthGapH)
  if (sun && earth) return `can go ${upTo}${maxSunGapH} h without the Sun and ${maxEarthGapH} h without Earth`
  if (sun) return `can go ${upTo}${maxSunGapH} h without the Sun, with no limit on time without Earth`
  if (earth) return `can go ${upTo}${maxEarthGapH} h without Earth, with no limit on time without the Sun`
  return 'has no limit on time without the Sun or Earth'
}
