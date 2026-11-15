import { gapLimitsWords, limitWords, type VerdictState } from '../lib/landingVerdict'
import { isNoGapLimit, type Requirements } from '../lib/mission'
import { monthLabel, monthName } from '../lib/months'
import { formatDuration } from '../lib/nextChange'
import type { Landing, MonthAnswer, MonthWindow, SlipCheck } from './monthAnswer'
import { isoAt } from './monthAnswer'
import { type CellStatus, type Loosening, statusOf } from './plannerModel'

/** "13 May 2027" from an ISO time. */
export function dayUtc(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7))} ${iso.slice(0, 4)}`
}

/** "13 May 2027, 06:00 UTC" from an ISO time. */
export function whenUtc(iso: string): string {
  return `${dayUtc(iso)}, ${iso.slice(11, 16)} UTC`
}

/** "13 May, 06:00": for a list under a heading that already names the year and UTC. */
export function shortWhen(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7))}, ${iso.slice(11, 16)}`
}

/** "89.453°S, 137.149°W": where a site is, as the site picker writes it. */
export function placeWords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** What a grid cell says to a screen reader, and in the line under the grid. */
export function cellWords(siteName: string, month: string, days: number): string {
  const count = days === 0 ? 'no landing meets your limits' : `a landing meets your limits on ${plural(days, 'day')}`
  return `${siteName}, ${monthLabel(month)}: ${count}.${statusOf(days) === 'tight' ? ' Tight.' : ''}`
}

function atLandingWords(requirements: Requirements): string {
  if (requirements.sunAtLanding && requirements.earthAtLanding) return 'landing with the Sun up and Earth in view'
  if (requirements.sunAtLanding) return 'landing with the Sun up'
  if (requirements.earthAtLanding) return 'landing with Earth in view'
  return 'landing at any hour'
}

/** The mission in one sentence, so a printed brief says what it was worked out for. */
export function missionWords(requirements: Requirements): string {
  const earth =
    requirements.minEarthClearanceDeg > 0
      ? `Earth counts as in view when its center is ${requirements.minEarthClearanceDeg}° above the terrain.`
      : 'Earth counts as in view when any part of it shows.'
  return `A ${requirements.missionDays}-day mission that ${gapLimitsWords(requirements.maxSunGapH, requirements.maxEarthGapH)}, ${atLandingWords(requirements)}. ${earth}`
}

export interface Verdict {
  status: CellStatus
  headline: string
  sentence: string
}

/** The answer for one site and month, words first. */
export function verdictWords(siteName: string, month: string, requirements: Requirements, answer: MonthAnswer): Verdict {
  const status = statusOf(answer.days)
  const mission = `${requirements.missionDays}-day mission`
  const where = `at ${siteName} in ${monthLabel(month)}`
  if (status === 'none') {
    return { status, headline: 'No landing works', sentence: `No landing ${where} survives a ${mission} within your limits.` }
  }
  const windows = plural(answer.windows.length, 'window')
  if (status === 'tight') {
    return {
      status,
      headline: `Tight: ${plural(answer.days, 'landing day')}`,
      sentence: `A ${mission} can land ${where}, but only on ${plural(answer.days, 'day')}, in ${windows}.`,
    }
  }
  return {
    status,
    headline: plural(answer.days, 'landing day'),
    sentence: `A ${mission} can land ${where} on ${plural(answer.days, 'day')}, in ${windows}.`,
  }
}

/**
 * What the brief calls the landing it is written for, and what its "go back" button says. A landing
 * either meets the limits or it does not. In a month with no landing that meets them, the brief is
 * written for the hour that misses the fewest: that is "closest to your limits", never a "closest
 * landing", so it cannot be read as one that works beside "No landing works" and "the next landing
 * that works is ...". A landing that fits only marginally is never headed "best": it is "This
 * landing", with what makes it marginal said under it.
 */
export function landingWords(isBest: boolean, landingDays: number, monthName: string, state: VerdictState = 'fits'): { heading: string; note: string | null; back: string } {
  if (landingDays === 0) {
    return {
      heading: isBest ? `Closest to your limits in ${monthName}: still a miss` : 'This landing',
      note: isBest ? `No hour in ${monthName} meets your limits. This is the hour that misses the fewest of them.` : null,
      back: 'Back to the hour closest to your limits',
    }
  }
  return { heading: isBest && state === 'fits' ? 'Best landing this month' : 'This landing', note: null, back: 'Use the best landing' }
}

/**
 * The brief's stamp: the verdict on the landing it is written for, in the plan column's three states
 * and marks. In a month with no landing that meets the limits it says that instead.
 */
export function stampWords(landingDays: number, state: VerdictState, mark: string): string {
  if (landingDays === 0) return 'No landing'
  return `${mark} ${{ fits: 'Fits', marginal: 'Fits, marginal', miss: 'Does not fit' }[state]}`
}

/** "3 May, 04:00 to 7 May, 15:00 (4 d 12 h)", with a note when the window runs past the month. */
export function windowWords(start: string, window: MonthWindow): string {
  const from = isoAt(start, window.from)
  const lastHour = isoAt(start, window.to - 1)
  const length = formatDuration(window.to - window.from)
  const edges = [window.opensBefore ? 'open since the month before' : '', window.staysOpenAfter ? 'stays open into the next month' : '']
    .filter(Boolean)
    .join(', ')
  const span = window.to - window.from === 1 ? shortWhen(from) : `${shortWhen(from)} to ${shortWhen(lastHour)}`
  return `${span} (${length}${edges ? `; ${edges}` : ''})`
}

/** A limit beside a measured time: "your limit: 24 h", or that there is none. */
function limitNote(hours: number): string {
  return isNoGapLimit(hours) ? 'you set no limit' : `your limit: ${limitWords(hours)}`
}

/** The mission that follows a landing, in sentences; empty when it runs past the data. */
export function missionFacts(landing: Landing, requirements: Requirements): string[] {
  if (landing.sunGapH === null || landing.earthGapH === null || landing.sunPct === null) return []
  const sun =
    landing.sunGapH === 0
      ? 'The Sun never sets during the mission.'
      : `The Sun is up for ${Math.round(landing.sunPct)}% of the mission, and is never gone for longer than ${formatDuration(landing.sunGapH)} (${limitNote(requirements.maxSunGapH)}).`
  const earth =
    landing.earthGapH === 0
      ? 'Earth never leaves view.'
      : `Earth is never out of view for longer than ${formatDuration(landing.earthGapH)} (${limitNote(requirements.maxEarthGapH)}).`
  return [sun, earth]
}

export type SlipAnswer = 'yes' | 'partly' | 'no' | 'misses'

export interface SlipWords {
  answer: SlipAnswer
  headline: string
  sentences: string[]
}

/** The slip check in words: does a later landing still work, and if not, when is the next one. */
export function slipWords(check: SlipCheck, landing: Landing): SlipWords {
  const within = `within ${plural(check.days, 'day')}`
  const reopens = check.next !== null && check.next.waitH <= check.days * 24
  const next = !check.next
    ? 'Nothing later in our data works at this site.'
    : reopens
      ? `A landing works again from ${whenUtc(check.next.t)}, ${formatDuration(check.next.waitH)} after this one.`
      : `The next landing that works here is ${whenUtc(check.next.t)}, ${formatDuration(check.next.waitH)} after this one.`
  if (!check.landingWorks || !check.lastGood) {
    return { answer: 'misses', headline: 'This landing already misses your limits', sentences: [next] }
  }
  const room =
    landing.roomH === 0
      ? 'This is the last landing hour of its window: an hour later no longer works.'
      : `This window's last landing hour is ${whenUtc(check.lastGood)}, ${formatDuration(landing.roomH)} after this one.`
  if (check.holds) {
    return { answer: 'yes', headline: `Yes: any landing up to ${plural(check.days, 'day')} late still works`, sentences: [room] }
  }
  if (landing.roomH > 0) {
    return { answer: 'partly', headline: `Only for a slip of up to ${formatDuration(landing.roomH)}`, sentences: [room, next] }
  }
  return reopens
    ? { answer: 'partly', headline: `No room right now, but a landing works again ${within}`, sentences: [room, next] }
    : { answer: 'no', headline: `No: nothing else works ${within}`, sentences: [room, next] }
}

/** One line of the "nothing works" state: what taking a limit away would open up. */
export function looseningWords(loosening: Loosening): string {
  const what = {
    sun: 'With no limit on time without the Sun',
    earth: 'With no limit on time without Earth',
    landing: 'With no need for the Sun or Earth at landing',
  }[loosening.what]
  return loosening.withLanding === 0
    ? `${what}: still nothing.`
    : `${what}: ${plural(loosening.withLanding, 'site-and-month square')} would have a landing.`
}
