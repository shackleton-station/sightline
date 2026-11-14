import { EARTH_CLEARANCES_DEG, type Requirements } from './mission'
import type { Mode } from './mode'
import { MAX_SHORTLIST, type ShortlistEntry } from './shortlist'

/** One side of a view: a curated site id or "lat,lon" for custom coordinates, plus a month. */
export interface LinkScenario {
  site: string
  month: string
}

export interface ViewState {
  a: LinkScenario
  b: LinkScenario | null
  index: number
  requirements: Requirements
  view3d: boolean
  mode: Mode
  shortlist: ShortlistEntry[]
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const CUSTOM = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/
const SITE = /^[a-z0-9,.-]+$/
const HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}$/

function encodeScenario({ site, month }: LinkScenario): string {
  return `${site}@${month}`
}

function decodeScenario(text: string | null): LinkScenario | null {
  if (!text) return null
  const [site, month] = text.split('@')
  if (!site || !month || !MONTH.test(month) || !SITE.test(site)) return null
  return { site, month }
}

/** The view as a URL fragment, so a link reopens exactly this view. */
export function encodeView(view: ViewState): string {
  const { missionDays, maxSunGapH, maxEarthGapH, sunAtLanding, earthAtLanding, minEarthClearanceDeg } =
    view.requirements
  const params = new URLSearchParams()
  params.set('a', encodeScenario(view.a))
  if (view.b) params.set('b', encodeScenario(view.b))
  params.set('t', String(view.index))
  const limits = [missionDays, maxSunGapH, maxEarthGapH, Number(sunAtLanding), Number(earthAtLanding)]
  if (minEarthClearanceDeg > 0) limits.push(minEarthClearanceDeg)
  params.set('limits', limits.join('_'))
  if (view.view3d) params.set('view', '3d')
  // Always written: a fresh visit opens in Learn, but a link with no mode means Plan (older links).
  params.set('mode', view.mode)
  if (view.shortlist.length > 0) {
    params.set('list', view.shortlist.map(({ site, at }) => `${site}@${at}`).join('~'))
  }
  return `#${params.toString().replaceAll('%2C', ',').replaceAll('%40', '@').replaceAll('%7E', '~').replaceAll('%3A', ':')}`
}

function decodeRequirements(text: string | null, fallback: Requirements): Requirements {
  const parts = text?.split('_').map(Number)
  // Links from before the Earth clearance limit have five parts.
  if (!parts || parts.length < 5 || parts.length > 6 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return fallback
  }
  return {
    missionDays: Math.max(1, Math.round(parts[0])),
    maxSunGapH: Math.round(parts[1]),
    maxEarthGapH: Math.round(parts[2]),
    sunAtLanding: parts[3] === 1,
    earthAtLanding: parts[4] === 1,
    minEarthClearanceDeg: EARTH_CLEARANCES_DEG.includes(parts[5]) ? parts[5] : 0,
  }
}

/** A shortlist from a link, leaving out anything malformed, or too much of it. */
function decodeShortlist(text: string | null): ShortlistEntry[] {
  if (!text) return []
  return text
    .split('~')
    .flatMap((part) => {
      const [site, at] = part.split('@')
      return site && at && SITE.test(site) && HOUR.test(at) ? [{ site, at }] : []
    })
    .slice(0, MAX_SHORTLIST)
}

/** Read a view from a URL fragment; null if it doesn't describe one. Never throws on bad links. */
export function decodeView(hash: string, fallback: Requirements): ViewState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const a = decodeScenario(params.get('a'))
  if (!a) return null
  const index = Number(params.get('t'))
  return {
    a,
    b: decodeScenario(params.get('b')),
    index: Number.isInteger(index) && index >= 0 ? index : 0,
    requirements: decodeRequirements(params.get('limits'), fallback),
    view3d: params.get('view') === '3d',
    // Links from before Learn existed all show planning detail, so that stays the default in a link.
    mode: params.get('mode') === 'learn' ? 'learn' : 'plan',
    shortlist: decodeShortlist(params.get('list')),
  }
}

/** Latitude and longitude from a custom site value, or null if it's a curated site id. */
export function parseCustomSite(site: string): { lat: number; lon: number } | null {
  if (!CUSTOM.test(site)) return null
  const [lat, lon] = site.split(',').map(Number)
  if (Math.abs(lat) > 90 || Math.abs(lon) > 360) return null
  return { lat, lon }
}
