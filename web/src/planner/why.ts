import type { SiteFlags } from '../lib/flags'
import { landingProblems, missionEarth, type Requirements } from '../lib/mission'
import { TIGHT_DAYS } from './plannerModel'

/** The limit that rules a landing out, by kind. */
export type WhyKind = 'sunAtLanding' | 'earthAtLanding' | 'sunGap' | 'earthGap' | 'pastData'

export interface MonthWhy {
  /** Days in the month with no landing that works. */
  failedDays: number
  /** Of those, how many fail mostly on each limit, largest first. */
  reasons: { kind: WhyKind; days: number }[]
}

/** The kind of one of `landingProblems`' sentences. */
function kindOf(problem: string): WhyKind | null {
  if (problem.startsWith('The Sun is down at landing')) return 'sunAtLanding'
  if (problem.startsWith('Earth is out of view at landing') || /^Earth is less than .* at landing/.test(problem)) return 'earthAtLanding'
  if (problem.startsWith('The mission runs past the end')) return 'pastData'
  if (problem.startsWith('The Sun is gone')) return 'sunGap'
  if (problem.startsWith('Earth is')) return 'earthGap'
  return null
}

/**
 * Why the days of a month without a landing fail: for each such UTC day, the limit its hours break
 * most often (the first one `landingProblems` names at each hour), counted over the month. The same
 * check the grid's counts come from, so the reasons always add up to the days the grid leaves out.
 */
export function monthWhy(sun: boolean[], earth: boolean[], span: { from: number; to: number }, viable: Uint8Array, req: Requirements): MonthWhy {
  const totals = new Map<WhyKind, number>()
  let failedDays = 0
  for (let day = span.from; day < span.to; day += 24) {
    const end = Math.min(day + 24, span.to)
    let works = false
    for (let h = day; h < end && !works; h += 1) works = viable[h] === 1
    if (works) continue
    failedDays += 1
    const counts = new Map<WhyKind, number>()
    for (let h = day; h < end; h += 1) {
      const kind = landingProblems(sun, earth, h, req).map(kindOf).find((one) => one !== null)
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top) totals.set(top[0], (totals.get(top[0]) ?? 0) + 1)
  }
  return { failedDays, reasons: [...totals.entries()].map(([kind, days]) => ({ kind, days })).sort((a, b) => b.days - a.days) }
}

/** One limit in plain words, with the mission's own figure in it. */
export function whyWords(kind: WhyKind, req: Requirements): string {
  switch (kind) {
    case 'sunAtLanding':
      return 'the Sun is down at landing'
    case 'earthAtLanding':
      return req.minEarthClearanceDeg > 0 ? `Earth isn't ${req.minEarthClearanceDeg}° clear of the skyline at landing` : 'Earth is out of view at landing'
    case 'sunGap':
      return `a dark spell runs past your ${req.maxSunGapH} h limit`
    case 'earthGap':
      return `a radio silence runs past your ${req.maxEarthGapH} h limit`
    case 'pastData':
      return 'the mission would run past the end of our data'
  }
}

/**
 * The month's "why" in one sentence, or null when there is nothing to explain (no day fails).
 * "On 24 of the 29 days without a landing, a dark spell runs past your 72 h limit; on 5, the Sun is down at landing."
 */
export function whySentence(why: MonthWhy, req: Requirements): string | null {
  if (why.failedDays === 0 || why.reasons.length === 0) return null
  const [first, ...rest] = why.reasons
  const lead = first.days === why.failedDays ? `On every day without a landing, ${whyWords(first.kind, req)}` : `On ${first.days} of the ${why.failedDays} days without a landing, ${whyWords(first.kind, req)}`
  const more = rest.map((reason) => `on ${reason.days}, ${whyWords(reason.kind, req)}`)
  return `${[lead, ...more].join('; ')}.`
}

/** The "why" for a brief's month, worked out only for a tight or empty month (the only ones that show it). */
export function briefWhy(flags: SiteFlags, span: { from: number; to: number }, viable: Uint8Array, days: number, req: Requirements): string | null {
  if (days > TIGHT_DAYS) return null
  return whySentence(monthWhy(flags.sun, missionEarth(flags, req), span, viable, req), req)
}
