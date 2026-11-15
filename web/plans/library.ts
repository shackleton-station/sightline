import { toIso } from '../src/lib/shortlist'
import { decodeView } from '../src/lib/urlState'
import { DEFAULT_LIMITS } from '../shared/tools/defaults'
import type { Plan } from './store'

/**
 * The library: every scenario in every listed plan, for anyone to search and pull into Compare.
 *
 * A plan is stored as a whole view, which can hold up to four scenarios: the view's own site and
 * hour, and the others in its shortlist (src/lib/sightlineMission.ts). The library takes each plan
 * apart into those scenarios, so one card is one place and one landing time.
 *
 * It sends the plan's title but not its note: anyone can save a plan without signing in, and a
 * title is the least a card needs. The note is still shown to whoever opens the plan itself.
 */

/** One scenario of one saved plan, as the library sends it (API.md, "The library"). */
export interface LibraryScenario {
  /** The plan it was saved in, and that plan's name. */
  plan: string
  title: string
  /** When the plan was saved. */
  saved: string
  /** A listed site's id, or "lat,lon" for a custom point. */
  site: string
  /** The landing time, to the hour. */
  landing: string
}

/** How many of the newest plans the library is made from. Past this, older plans are still opened by their links but are not listed. */
export const LIBRARY_PLANS = 200
/** At most this many scenarios from one plan: the screen holds four. */
const PER_PLAN = 4
/** How long one copy of the service answers from what it last read, so a busy library costs one read of the database in this time. */
export const LIBRARY_FRESH_MS = 30_000

const HOUR_MS = 3_600_000
const hourIso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`

/** The scenarios a plan holds, first the one its view opens on. None if the view cannot be read. */
export function scenariosOf(plan: Plan): LibraryScenario[] {
  const view = decodeView(plan.view, DEFAULT_LIMITS)
  if (!view) return []
  const first = Date.parse(`${view.a.month}-01T00:00:00Z`) + view.index * HOUR_MS
  if (!Number.isFinite(first)) return []
  const places = [{ site: view.a.site, landing: hourIso(first) }, ...view.shortlist.map((entry) => ({ site: entry.site, landing: toIso(entry.at) }))]
  return places.slice(0, PER_PLAN).map((place) => ({ plan: plan.id, title: plan.title, saved: plan.created, ...place }))
}

/** The library made from the newest plans: expired ones left out, the rest taken apart, newest plan first. */
export function libraryOf(plans: Plan[], now: number): LibraryScenario[] {
  return plans.filter((plan) => !(Date.parse(plan.expires) <= now)).flatMap(scenariosOf)
}
