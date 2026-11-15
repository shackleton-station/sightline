import type { SiteInfo } from '../data/contract'
import { distanceKm } from './slip'

/**
 * The app's ready example of why a small change of place matters: two listed sites on the south
 * pole's ridges a few kilometres apart, and one date on which the same short stay does very
 * differently at each. Picked from the pipeline's data, where on this date the difference between
 * the two is the largest of 2027; `nearbyPair.test.ts` checks the figures against that data, so a
 * new pipeline run that changes them fails there instead of leaving the example untrue.
 */
export const NEARBY_PAIR = { a: 'connecting-ridge', b: 'shackleton-rim', landing: '2027-02-18T12:00:00Z' }

/** How far apart the two sites are, to the kilometre; null when either is not among the sites on hand. */
export function nearbyPairKm(sites: SiteInfo[]): number | null {
  const a = sites.find((site) => site.id === NEARBY_PAIR.a)
  const b = sites.find((site) => site.id === NEARBY_PAIR.b)
  return a && b ? Math.round(distanceKm(a, b)) : null
}
