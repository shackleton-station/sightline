import type { SiteInfo } from '../../src/data/contract'
import { sanitizeAsk } from '../../src/lib/ask'
import type { SiteFlags } from '../../src/lib/flags'
import { hourOf, locateHour, type Requirements } from '../../src/lib/mission'
import { decodeView, encodeView, type ViewState } from '../../src/lib/urlState'
import { type Args, monthArg, timeArg } from '../../shared/tools/args'
import { DEFAULT_LIMITS } from '../../shared/tools/defaults'
import { limitWords, monthWords, whenLabel } from '../../shared/tools/facts'

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

/**
 * Turns what the model asked for into buttons. Nothing the model wrote reaches the page: each
 * button is rebuilt here from checked parts (a listed site, a month or hour inside the data, limits
 * inside their bounds), and its label is written here too. Anything that doesn't check out is dropped.
 */
export function buildActions(raw: unknown, base: ViewState, sites: SiteInfo[], flags: SiteFlags): ChatAction[] {
  if (!Array.isArray(raw)) return []
  const actions: ChatAction[] = []
  for (const item of raw) {
    if (actions.length === MAX_ACTIONS) break
    try {
      const action = buildAction((item ?? {}) as Args, base, sites, flags)
      if (action && !actions.some((made) => made.hash === action.hash)) actions.push(action)
    } catch {
      // A bad month, hour or site: leave this button out.
    }
  }
  return actions
}

function buildAction(args: Args, base: ViewState, sites: SiteInfo[], flags: SiteFlags): ChatAction | null {
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
    return {
      label: `Open ${site.name}, ${monthWords(month)}`,
      hash: encodeView({ ...base, a: { site: site.id, month }, b: null, index: 0 }),
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
