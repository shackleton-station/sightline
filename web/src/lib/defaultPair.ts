import type { SightlineScenario } from './sightlineMission'

/**
 * The two prospective landing sites Plan compares when a visitor first opens it: the same hour at
 * two places, so the first thing compared is what the place alone changes. Having only A would make
 * a visitor add B before the comparison could be used at all.
 */
export const DEFAULT_PAIR = ['connecting-ridge', 'shackleton-rim'] as const

/**
 * The scenarios Plan starts with when the address carries none: A on the site given (the pair's
 * first when none is), B on the pair's first site, or its second when A is the first; both landing
 * at the same hour. Only A when the pair's site is not among the sites on hand.
 */
export function defaultScenarios(siteIds: string[], landing: number, a?: string): SightlineScenario[] {
  const first = a ?? (siteIds.includes(DEFAULT_PAIR[0]) ? DEFAULT_PAIR[0] : siteIds[0])
  const second = first === DEFAULT_PAIR[0] ? DEFAULT_PAIR[1] : DEFAULT_PAIR[0]
  return siteIds.includes(second) && second !== first ? [{ site: first, landing }, { site: second, landing }] : [{ site: first, landing }]
}
