import type { SiteInfo } from '../data/contract'
import { customSiteInfo, isCustomSite } from '../data/customSite'
import { DEFAULT_REQUIREMENTS, type Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import type { Scenario } from '../lib/scenario'
import type { ShortlistEntry } from '../lib/shortlist'
import type { CameraCue } from '../lib/story'
import { decodeView, encodeView, type LinkScenario, parseCustomSite, type ViewState as LinkView } from '../lib/urlState'
import { planIdFrom } from '../lib/plans'
import { DEMO_HASH, HOW_HASH } from '../lib/siteTabs'

export const DEFAULT_MONTH = '2027-05'

/** Starting values for the mission limits: examples only, shown as such in the UI. The app's one default mission. */
export const EXAMPLE_REQUIREMENTS: Requirements = DEFAULT_REQUIREMENTS

export interface Tour {
  /** What to go back to on leaving the tour. */
  saved: { scenario: Scenario | null; other: Scenario | null; index: number; view3d: boolean }
  camera: CameraCue
}

/** Everything that decides what's on screen. One place, so links, the tour and the chat all agree. */
export interface View {
  sites: SiteInfo[]
  sitesError: string | null
  /** The site and month being looked at; null until the site list has loaded. */
  a: Scenario | null
  /** The other side of a comparison, when comparing. */
  b: Scenario | null
  /** The hour within the month. */
  index: number
  requirements: Requirements
  view3d: boolean
  mode: Mode
  shortlist: ShortlistEntry[]
  tour: Tour | null
  tourPaused: boolean
  /** Showing the whole-Moon front page. */
  landing: boolean
  /** 'how' is the How it works page (#how); 'demo' is the demo video (#demo); 'plan' is a shared plan (#plan=<id>). */
  page: 'app' | 'demo' | 'how' | 'plan'
  /** The shared plan being shown, when the page is 'plan'. */
  planId: string | null
  /** Counts requests to open the "where and when" grid, so each one scrolls to it. */
  gridRequest: number
}

export type Side = 'a' | 'b'

export type Action =
  | { type: 'sitesLoaded'; sites: SiteInfo[]; hash: string; open3d: boolean }
  | { type: 'sitesFailed'; error: string }
  | { type: 'applyLink'; hash: string }
  | { type: 'setScenario'; side: Side; scenario: Scenario | null }
  | { type: 'setIndex'; index: number }
  | { type: 'setRequirements'; requirements: Requirements }
  | { type: 'setView3d'; view3d: boolean }
  | { type: 'setMode'; mode: Mode }
  | { type: 'setShortlist'; shortlist: ShortlistEntry[] }
  | { type: 'openCompare' }
  | { type: 'closeCompare' }
  | { type: 'startTour'; open3d: boolean }
  | { type: 'tourScene'; siteId: string; month: string; camera: CameraCue }
  | { type: 'pauseTour'; paused: boolean }
  | { type: 'closeTour'; keepView: boolean }
  | { type: 'openGrid' }
  | { type: 'openLanding' }
  | { type: 'enterSite'; site: SiteInfo }
  | { type: 'leaveLanding' }
  | { type: 'setPage'; page: View['page'] }

/** The view before anything has loaded. A fresh visit (no link) opens on the whole Moon. */
export { HOW_HASH }

export function initialView(hash: string): View {
  return {
    sites: [],
    sitesError: null,
    a: null,
    b: null,
    index: 0,
    requirements: EXAMPLE_REQUIREMENTS,
    view3d: false,
    mode: 'learn',
    shortlist: [],
    tour: null,
    tourPaused: false,
    landing: !hash || hash === HOW_HASH,
    page: hash === HOW_HASH ? 'how' : hash === DEMO_HASH ? 'demo' : planIdFrom(hash) ? 'plan' : 'app',
    planId: planIdFrom(hash),
    gridRequest: 0,
  }
}

/** A scenario from a link; null if the site isn't known. */
export function fromLink(link: LinkScenario, sites: SiteInfo[]): Scenario | null {
  const point = parseCustomSite(link.site)
  if (point) {
    const custom = customSiteInfo(point.lat, point.lon)
    return { siteId: custom.id, month: link.month, custom }
  }
  return sites.some((site) => site.id === link.site) ? { siteId: link.site, month: link.month } : null
}

export function toLink(scenario: Scenario): LinkScenario {
  const { custom } = scenario
  return { site: custom ? `${custom.lat},${custom.lon}` : scenario.siteId, month: scenario.month }
}

/** The link that reopens this view, or '' before a site is chosen. */
export function hashOf(view: View): string {
  if (!view.a) return ''
  const link: LinkView = {
    a: toLink(view.a),
    b: view.b && toLink(view.b),
    index: view.index,
    requirements: view.requirements,
    view3d: view.view3d,
    mode: view.mode,
    shortlist: view.shortlist,
  }
  return encodeView(link)
}

/** The view a link describes, or the same view if the link doesn't describe one. */
function withLink(view: View, hash: string): View {
  const link = decodeView(hash, EXAMPLE_REQUIREMENTS)
  const a = link && fromLink(link.a, view.sites)
  if (!link || !a) return view
  return {
    ...view,
    tour: null,
    a,
    b: link.b && fromLink(link.b, view.sites),
    index: link.index,
    view3d: link.view3d,
    requirements: link.requirements,
    mode: link.mode,
    shortlist: link.shortlist,
  }
}

function withTour(view: View, open3d: boolean): View {
  return {
    ...view,
    tour: { saved: { scenario: view.a, other: view.b, index: view.index, view3d: view.view3d }, camera: 'above' },
    tourPaused: false,
    b: null,
    view3d: open3d ? true : view.view3d,
  }
}

export function viewReducer(view: View, action: Action): View {
  switch (action.type) {
    case 'sitesLoaded': {
      const loaded = { ...view, sites: action.sites }
      const linked = withLink(loaded, action.hash)
      if (linked !== loaded || !action.sites[0]) return linked
      const fresh: View = {
        ...loaded,
        a: { siteId: action.sites[0].id, month: DEFAULT_MONTH },
        view3d: action.open3d,
      }
      return action.hash.includes('tour') ? withTour(fresh, action.open3d) : fresh
    }
    case 'sitesFailed':
      return { ...view, sitesError: action.error }
    case 'applyLink': {
      if (action.hash === HOW_HASH) return { ...view, page: 'how', tour: null }
      if (action.hash === DEMO_HASH) return { ...view, page: 'demo', landing: false, tour: null }
      const planId = planIdFrom(action.hash)
      if (planId) return { ...view, page: 'plan', planId, landing: false, tour: null }
      const linked = withLink(view, action.hash)
      // A link to a view leaves whatever page was open (the front page, How it works, the video) for it.
      return linked === view ? view : { ...linked, page: 'app', landing: false }
    }
    case 'setScenario':
      return action.side === 'a' ? { ...view, a: action.scenario } : { ...view, b: action.scenario }
    case 'setIndex':
      return { ...view, index: action.index }
    case 'setRequirements':
      return { ...view, requirements: action.requirements }
    case 'setView3d':
      return { ...view, view3d: action.view3d }
    case 'setMode':
      return { ...view, mode: action.mode }
    case 'setShortlist':
      return { ...view, shortlist: action.shortlist }
    case 'openCompare': {
      if (!view.a) return view
      const other = view.sites.find((site) => site.id !== view.a?.siteId) ?? view.sites[0]
      return other ? { ...view, b: { siteId: other.id, month: view.a.month } } : view
    }
    case 'closeCompare':
      return { ...view, b: null }
    case 'startTour':
      return view.a ? withTour({ ...view, landing: false, page: 'app' }, action.open3d) : { ...view, landing: false, page: 'app' }
    case 'tourScene':
      return {
        ...view,
        a: { siteId: action.siteId, month: action.month },
        tour: view.tour && { ...view.tour, camera: action.camera },
      }
    case 'pauseTour':
      return { ...view, tourPaused: action.paused }
    case 'closeTour': {
      const { tour } = view
      if (!tour || action.keepView) return { ...view, tour: null }
      const { scenario, other, index, view3d } = tour.saved
      return { ...view, tour: null, a: scenario, b: other, index, view3d }
    }
    case 'openGrid':
      return { ...view, tour: null, gridRequest: view.gridRequest + 1 }
    case 'openLanding':
      return { ...view, page: 'app', landing: true }
    case 'enterSite': {
      const month = view.a?.month ?? DEFAULT_MONTH
      const { site } = action
      const a = isCustomSite(site) ? { siteId: site.id, month, custom: site } : { siteId: site.id, month }
      return { ...view, a, b: null, landing: false }
    }
    case 'leaveLanding':
      return { ...view, landing: false }
    case 'setPage':
      return { ...view, page: action.page }
  }
}
