import type { SiteInfo } from '../../src/data/contract'
import { sanitizeAsk } from '../../src/lib/ask'
import type { SiteFlags } from '../../src/lib/flags'
import { hourOf, locateHour, type Requirements } from '../../src/lib/mission'
import { decodeView, encodeView, type ViewState } from '../../src/lib/urlState'
import { type Args, monthArg, timeArg } from '../../shared/tools/args'
import { DEFAULT_LIMITS } from '../../shared/tools/defaults'
import { limitWords, monthWords, whenLabel } from '../../shared/tools/facts'
import type { Tie } from '../../shared/tools/ties'

/** A button under the answer. `hash` is an ordinary link to a view of the app, like any shared link. */
export interface ChatAction {
  label: string
  hash: string
}

export { DEFAULT_LIMITS }

const DEFAULT_VIEW: ViewState = {
  a: { site: 'connecting-ridge', month: '2027-05' },
  b: null,
  index: 0,
  requirements: DEFAULT_LIMITS,
  view3d: false,
  mode: 'learn',
  shortlist: [],
}

/** The view the visitor is looking at, from the part of their address after "#". */
export function viewFrom(hash: unknown): ViewState {
  if (typeof hash !== 'string' || hash.length > 1500) return DEFAULT_VIEW
  return decodeView(hash, DEFAULT_LIMITS) ?? DEFAULT_VIEW
}

const MAX_ACTIONS = 3

/** The arguments with which a tool tries limits other than the visitor's. */
export const LIMIT_ARGS = ['mission_days', 'max_sun_gap_h', 'max_earth_gap_h', 'sun_at_landing', 'earth_at_landing', 'earth_clearance_deg']

/**
 * Whether a message asks what would change the verdict, or to try other limits: "what if my mission
 * were only 3 days", "what would one more day of battery change", "how could I make this fit". Only
 * then is a button that changes the limits offered: under "why doesn't this fit" it would read as
 * advice to loosen the mission, which nobody asked for.
 */
export function asksToChangeLimits(message: string): boolean {
  return /\bwhat if\b|\bwhat (would|could|should)\b.*\b(change|fit|work|help|take|need)\b|\bhow (can|could|do|would) (i|we)\b.*\b(fit|work|make|get|land)\b|\b(change|changing|relax|loosen|tighten|raise|lower|extend|shorten)\b|\bif (my|the|our) mission\b|\b(longer|shorter|more|fewer|less) (mission|battery|days?|hours?|darkness)\b|\binstead\b/i.test(message)
}

/**
 * Turns what the model asked for into buttons. Nothing the model wrote reaches the page: each
 * button is rebuilt here from checked parts (a listed site, a month or hour inside the data, limits
 * inside their bounds), and its label is written here too. Anything that doesn't check out is dropped.
 */
export function buildActions(raw: unknown, base: ViewState, sites: SiteInfo[], flags: SiteFlags, ties: Tie[] = [], limitsAsked = true): ChatAction[] {
  if (!Array.isArray(raw)) return []
  const actions: ChatAction[] = []
  for (const item of raw) {
    if (actions.length === MAX_ACTIONS) break
    // A button that changes the limits is kept only when the visitor asked what would change the verdict.
    if (!limitsAsked && (item as Args | null)?.type === 'limits') continue
    try {
      const action = buildAction((item ?? {}) as Args, base, sites, flags, ties)
      if (action && !actions.some((made) => made.hash === action.hash)) actions.push(action)
    } catch {
      // A bad month, hour or site: leave this button out.
    }
  }
  return actions
}

function buildAction(args: Args, base: ViewState, sites: SiteInfo[], flags: SiteFlags, ties: Tie[]): ChatAction | null {
  const named = (id: unknown) => sites.find((site) => site.id === id) ?? null

  if (args.type === 'open') {
    const site = named(args.site)
    if (!site) return null
    if (args.time !== undefined) {
      const iso = timeArg(args.time, flags)
      const { month, index } = locateHour(flags.start, hourOf(flags.start, iso))
      return {
        label: `Open ${site.name} at ${whenLabel(iso)}`,
        hash: encodeView({ ...base, a: { site: site.id, month }, b: null, index }),
      }
    }
    const month = args.month === undefined ? base.a.month : monthArg(args.month, flags)
    // With no month or hour asked for, the button opens the site at the date the answer is about (the
    // base view's own hour), so "Show me" and "Plan this" under it go there and not to a month's first hour.
    const index = args.month === undefined ? base.index : 0
    // A button for one of several months (or sites) a tool found tied for best opens the first of
    // them and says there are others, so a tie never reads as one winner. Buttons for the others
    // become the same button, and only one is kept.
    const monthsTie = ties.find((tie) => tie.kind === 'months' && tie.site === site.id && tie.months.includes(month))
    if (monthsTie?.kind === 'months') {
      const first = monthsTie.months[0]
      return {
        label: `Open ${site.name}, ${monthWords(first)} (first of ${monthsTie.months.length} tied months)`,
        hash: encodeView({ ...base, a: { site: site.id, month: first }, b: null, index: 0 }),
      }
    }
    const sitesTie = ties.find((tie) => tie.kind === 'sites' && tie.month === month && tie.sites.includes(site.id))
    const firstSite = sitesTie?.kind === 'sites' ? named(sitesTie.sites[0]) : null
    if (sitesTie?.kind === 'sites' && firstSite) {
      return {
        label: `Open ${firstSite.name}, ${monthWords(month)} (first of ${sitesTie.sites.length} tied sites)`,
        hash: encodeView({ ...base, a: { site: firstSite.id, month }, b: null, index: 0 }),
      }
    }
    return {
      label: `Open ${site.name}, ${monthWords(month)}`,
      hash: encodeView({ ...base, a: { site: site.id, month }, b: null, index }),
    }
  }

  if (args.type === 'compare') {
    const [a, b] = [named(args.site), named(args.site_b)]
    if (!a || !b || a.id === b.id) return null
    const month = args.month === undefined ? base.a.month : monthArg(args.month, flags)
    return {
      label: `Compare ${a.name} and ${b.name}, ${monthWords(month)}`,
      hash: encodeView({ ...base, a: { site: a.id, month }, b: { site: b.id, month }, index: 0 }),
    }
  }

  if (args.type === 'limits') {
    const tried = sanitizeAsk(
      {
        missionDays: args.mission_days,
        maxSunGapH: args.max_sun_gap_h,
        maxEarthGapH: args.max_earth_gap_h,
        sunAtLanding: args.sun_at_landing,
        earthAtLanding: args.earth_at_landing,
        minEarthClearanceDeg: args.earth_clearance_deg,
      },
      [],
    )
    if (!tried) return null
    const requirements = { ...base.requirements, ...tried.requirements }
    const changed = (Object.keys(tried.requirements) as (keyof Requirements)[]).filter(
      (key) => requirements[key] !== base.requirements[key],
    )
    if (changed.length === 0) return null
    const words = limitWords(requirements)
    // Limits only show in Plan mode, so the button opens it.
    return {
      label: `Change the limits: ${changed.map((key) => words[key]).join(', ')}`,
      hash: encodeView({ ...base, requirements, mode: 'plan' }),
    }
  }
  return null
}
