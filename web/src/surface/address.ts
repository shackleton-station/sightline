import type { Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import type { ShortlistEntry } from '../lib/shortlist'
import { boundedLook, type Look } from '../lib/surfaceView'
import { decodeView, encodeView } from '../lib/urlState'

/**
 * What the Surface tab keeps in the address. The first part is the app's own view link, so the
 * other tabs open on the same site, month, hour and limits, and a link made there opens here. Two
 * more values say which way the visitor faces: `look` (heading, elevation and field of view in
 * degrees) and `tall` (how many times taller heights are drawn, only when they are). Without a
 * `look`, `face` says which views are open: one following the Sun, one following Earth, or both
 * side by side. The other tabs ignore all three, and the links to them leave them out.
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

/** The most a link may stretch heights by. The page itself offers one stretch (see SurfaceStage). */
const MAX_STRETCH = 20

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

/** Which way a link faces, or null if it doesn't say (or says it badly). */
export function readLook(hash: string): Look | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const parts = params.get('look')?.split('_').map(Number)
  if (!parts || parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  const tall = Number(params.get('tall') ?? 1)
  const stretch = Number.isFinite(tall) ? Math.min(Math.max(Math.round(tall), 1), MAX_STRETCH) : 1
  return boundedLook({ headingDeg: parts[0], pitchDeg: parts[1], fovDeg: parts[2], stretch })
}

/** Which views are open: one that follows the Sun, one that follows Earth, or both side by side. */
export type Facing = 'both' | 'sun' | 'earth'

/** Which views a link opens, or null if it doesn't say. */
export function readFacing(hash: string): Facing | null {
  const face = new URLSearchParams(hash.replace(/^#/, '')).get('face')
  return face === 'both' || face === 'sun' || face === 'earth' ? face : null
}

/** The app's own link for this view: what the other tabs are given. */
export function viewLink(address: SurfaceAddress): string {
  return encodeView({ a: { site: address.site, month: address.month }, b: null, index: address.index, ...address.kept })
}

const hundredths = (value: number) => String(Math.round(value * 100) / 100)

/** The link that reopens this view facing the same way: a free look, or else the views that follow the Sun and Earth. */
export function writeAddress(address: SurfaceAddress, look: Look | null, facing: Facing | null = null): string {
  const base = viewLink(address)
  if (!look) return facing ? `${base}&face=${facing}` : base
  const direction = `&look=${hundredths(look.headingDeg)}_${hundredths(look.pitchDeg)}_${hundredths(look.fovDeg)}`
  return `${base}${direction}${look.stretch > 1 ? `&tall=${look.stretch}` : ''}`
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
