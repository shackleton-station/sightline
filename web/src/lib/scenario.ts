import type { SiteInfo } from '../data/contract'

/** What a user is looking at: one landing site in one month. */
export interface Scenario {
  siteId: string
  month: string
  /** Set when the site comes from typed coordinates rather than the curated list. */
  custom?: SiteInfo
}
