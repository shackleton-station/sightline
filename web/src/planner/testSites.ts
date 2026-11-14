import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from '../lib/flags'
import type { Requirements } from '../lib/mission'
import type { PlannerSite } from './plannerModel'

/** Made-up sites for the tests: January and February 2027, hour by hour. Not real places or data. */
export const START = '2027-01-01T00:00:00Z'
export const HOURS = (31 + 28) * 24

const site = (id: string, lat: number): SiteInfo => ({ id, name: id.toUpperCase(), lat, lon: 0, source_url: '', group: 'Test' })

/** Flags with the Sun up over the given spans of hours, and Earth always in view. */
function flags(sunUp: [number, number][]): SiteFlags {
  const sun = new Array<boolean>(HOURS).fill(false)
  for (const [from, to] of sunUp) sun.fill(true, from, to)
  return { start: START, sun, earth: new Array<boolean>(HOURS).fill(true), earthAbove: {} }
}

/** A two-day mission that can go 12 h without the Sun and must land in sunlight. */
export const MISSION: Requirements = {
  missionDays: 2,
  maxSunGapH: 12,
  maxEarthGapH: 12,
  sunAtLanding: true,
  earthAtLanding: false,
  minEarthClearanceDeg: 0,
}

/**
 * Site "a": ten days of Sun, ten days of night, then Sun to the end. With MISSION, a landing works
 * in hours [0, 205) and [480, 1369): the last landing before the night can see 12 h of it, and the
 * mission must end inside the data.
 */
export const A: PlannerSite = { site: site('a', -89), flags: flags([[0, 240], [480, HOURS]]) }
/** Site "b": never any Sun, so never a landing. */
export const B: PlannerSite = { site: site('b', -88), flags: flags([]) }
/** Site "c": Sun for the first 60 hours only. With MISSION, a landing works in hours [0, 25). */
export const C: PlannerSite = { site: site('c', -85), flags: flags([[0, 60]]) }
