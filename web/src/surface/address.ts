import type { Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import type { ShortlistEntry } from '../lib/shortlist'
import { decodeView, encodeView } from '../lib/urlState'

/**
 * What the Surface tab keeps in the address: the app's own view link, so the other tabs open on the
 * same site, month, hour and limits, and a link made there opens here. Which way the two views face
 * is not in it: one always follows the Sun and the other Earth.
 */
export interface SurfaceAddress {
  /** A listed site's id, or "lat,lon" from a link made on another tab. */
  site: string
  month: string
  /** The hour within the month. */
  index: number
  /** Parts of a link this tab doesn't change, kept so going back to another tab loses nothing. */
  kept: { requirements: Requirements; mode: Mode; view3d: boolean; shortlist: ShortlistEntry[] }
}

/** Links carry mission limits; this tab doesn't change them, so a link with none gets the app's example ones. */
export const EXAMPLE_LIMITS: Requirements = { missionDays: 14, maxSunGapH: 72, maxEarthGapH: 72, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

/** The site, month, hour and limits a link names; null if it isn't a view link. Never throws on a bad link. */
export function readAddress(hash: string): SurfaceAddress | null {
  const view = decodeView(hash, EXAMPLE_LIMITS)
  if (!view) return null
  return {
    site: view.a.site,
    month: view.a.month,
    index: view.index,
    kept: { requirements: view.requirements, mode: view.mode, view3d: view.view3d, shortlist: view.shortlist },
  }
}

/** The app's own link for this view: what the other tabs are given. */
export function viewLink(address: SurfaceAddress): string {
  return encodeView({ a: { site: address.site, month: address.month }, b: null, index: address.index, ...address.kept })
}

const HOUR_MS = 3_600_000

/**
 * `base` moved to the whole hour nearest `iso` (UTC): that hour's month, and the hour within it.
 * Half past rounds up, so 23:30 on the last day of a month opens the next month's first hour.
 */
export function atNearestHour(base: SurfaceAddress, iso: string): SurfaceAddress {
  const at = new Date(Math.round(Date.parse(iso) / HOUR_MS) * HOUR_MS)
  const month = at.toISOString().slice(0, 7)
  return { ...base, month, index: (at.getTime() - Date.parse(`${month}-01T00:00:00Z`)) / HOUR_MS }
}
