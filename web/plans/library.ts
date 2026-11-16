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
 * It sends only what the service worked out from the plan's view: the place, the landing, and when
 * the plan was saved. Anyone can save a plan without signing in, and the library is open to
 * everyone, so nothing a visitor typed is in it: not the plan's title, not its note. The plan's id
 * is left out too, because the id is the link that opens the title and the note, and those are for
 * whoever was given that link.
 */

/** One scenario of one saved plan, as the library sends it (API.md, "The library"). */
export interface LibraryScenario {
  /** When the plan it is in was saved. */
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

/**
 * The title of a plan the deploy's own check saved (scripts/plans-checks.mjs saves one on every
 * deploy, always the same landing). Those are not anyone's plan, so the library leaves them out;
 * their links still open them.
 */
const CHECK_TITLE = /^Deploy check \(/

const HOUR_MS = 3_600_000
const hourIso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`

/** The scenarios a plan holds, first the one its view opens on. None if the view cannot be read. */
export function scenariosOf(plan: Plan): LibraryScenario[] {
  const view = decodeView(plan.view, DEFAULT_LIMITS)
  if (!view) return []
  const first = Date.parse(`${view.a.month}-01T00:00:00Z`) + view.index * HOUR_MS
  if (!Number.isFinite(first)) return []
  const places = [{ site: view.a.site, landing: hourIso(first) }, ...view.shortlist.map((entry) => ({ site: entry.site, landing: toIso(entry.at) }))]
  return places.slice(0, PER_PLAN).map((place) => ({ saved: plan.created, ...place }))
}

/** The library made from the newest plans: expired ones and the deploy's own checks left out, the rest taken apart, newest plan first. */
export function libraryOf(plans: Plan[], now: number): LibraryScenario[] {
  return plans.filter((plan) => !CHECK_TITLE.test(plan.title) && !(Date.parse(plan.expires) <= now)).flatMap(scenariosOf)
}
