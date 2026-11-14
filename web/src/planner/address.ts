import { LIMIT_BOUNDS } from '../lib/ask'
import type { Requirements } from '../lib/mission'
import type { ShortlistEntry } from '../lib/shortlist'
import { DEFAULT_VIEW } from '../lib/siteTabs'
import { decodeView, encodeView, type LinkScenario } from '../lib/urlState'

/**
 * What the Planner keeps in the address. It is the app's own view link, so the other tabs open on
 * the same site, month, hour and limits, and a link made there opens here.
 */
export interface PlannerAddress {
  /** A listed site's id, or "lat,lon" from a link made on another tab. */
  site: string
  month: string
  /** The landing hour within the month. */
  index: number
  requirements: Requirements
  shortlist: ShortlistEntry[]
  /** Parts of a link the Planner doesn't show, kept so going back to another tab loses nothing. */
  kept: { b: LinkScenario | null; view3d: boolean }
}

const clamp = (value: number, [min, max]: readonly [number, number]) => Math.max(min, Math.min(max, value))

/** Limits inside the bounds of the inputs, so a hand-edited link can't put a control out of range. */
export function boundedLimits(requirements: Requirements): Requirements {
  return {
    ...requirements,
    missionDays: clamp(requirements.missionDays, LIMIT_BOUNDS.missionDays),
    maxSunGapH: clamp(requirements.maxSunGapH, LIMIT_BOUNDS.maxSunGapH),
    maxEarthGapH: clamp(requirements.maxEarthGapH, LIMIT_BOUNDS.maxEarthGapH),
  }
}

/** The state a link describes; null if it isn't a view link. Never throws on a bad link. */
export function readAddress(hash: string, fallback: Requirements): PlannerAddress | null {
  const view = decodeView(hash, fallback)
  if (!view) return null
  return {
    site: view.a.site,
    month: view.a.month,
    index: view.index,
    requirements: boundedLimits(view.requirements),
    shortlist: view.shortlist,
    kept: { b: view.b, view3d: view.view3d },
  }
}

/** The link for a state, in the app's encoding. Limits are the point here, so it opens in Plan mode. */
export function writeAddress(address: PlannerAddress): string {
  return encodeView({
    a: { site: address.site, month: address.month },
    b: address.kept.b,
    index: address.index,
    requirements: address.requirements,
    view3d: address.kept.view3d,
    mode: 'plan',
    shortlist: address.shortlist,
  })
}

/** Where the Planner opens when the address names nothing: the same view the other tabs default to. */
export function defaultAddress(fallback: Requirements): PlannerAddress {
  const address = readAddress(DEFAULT_VIEW, fallback)
  if (!address) throw new Error('the default view is not a view link')
  return address
}
