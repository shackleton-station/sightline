import { HYPE_PATH } from './hypeEgg'

/**
 * The tabs along the top of every page. This demo keeps several designs of the same thing side by
 * side so the team can compare them; each one is a tab. To add another design, add a line here and
 * render <SiteTabs current="its id" /> at the top of it. 'hype' is a page with no tab of its own.
 */
export type TabId = 'sightline' | 'moon' | 'classic' | 'mission' | 'scout' | 'planner' | 'atlas' | 'briefing' | 'surface' | 'tour' | 'video' | 'how' | 'hype'

interface TabSpec {
  id: TabId
  label: string
  /** What the tab is, for the tooltip and screen readers. */
  hint: string
  /** One of the designs of the site page, shown as a group so they read as alternatives. */
  design: boolean
  /** The tab's address. `view` is the site, month and hour on screen, as the "#a=…" part of a link; `chosen` is false when it is only the default. */
  href: (view: string, chosen?: boolean) => string
}

/** The view a design opens on when nothing has been chosen yet. Its limits are the app's default mission (lib/mission.ts; siteTabs.test.ts holds them together). */
export const DEFAULT_VIEW = '#a=connecting-ridge@2027-05&t=0&limits=14_24_24_1_1&view=3d&mode=learn'

/**
 * Where the site as it was before Sightline lives: the Whole Moon page, the Classic and Mission
 * control designs, the tour, the demo video and shared plans. Their old addresses at "/" are
 * forwarded (lib/oldAddress.ts).
 */
export const OLD_HOME = '/classic/'

export const HOW_HASH = '#how'
export const DEMO_HASH = '#demo'
export const TOUR_HASH = '#tour'

const TABS: TabSpec[] = [
  // The front page is Sightline, which has no tab bar of its own. The pages that keep theirs lead to it first.
  { id: 'sightline', label: 'Sightline', hint: 'The front page: one screen for where to land and when', design: false, href: (view, chosen) => (chosen ? `/${view}` : '/') },
  { id: 'moon', label: 'Whole Moon', hint: 'The Moon, lit as it is: the front page before Sightline', design: false, href: () => OLD_HOME },
  { id: 'classic', label: 'Classic', hint: 'The first design of the site page', design: true, href: (view) => `${OLD_HOME}${view}` },
  { id: 'mission', label: 'Mission control', hint: 'The site page as one screen with a time river', design: true, href: (view) => `${OLD_HOME}?ui=next${view}` },
  { id: 'scout', label: 'Scout', hint: 'A guide with a speech-bubble chat', design: true, href: (view) => `/scout/${view}` },
  { id: 'planner', label: 'Planner', hint: 'Every site and month against your mission, with no globe', design: true, href: (view) => `/planner/${view}` },
  { id: 'atlas', label: 'Atlas', hint: 'True light on the polar ground: move time, tap anywhere', design: true, href: (view) => `/atlas/${view}` },
  { id: 'briefing', label: 'Briefing', hint: 'The two-minute story of a month at the pole, ending on a landing', design: true, href: (view) => `/briefing/${view}` },
  { id: 'surface', label: 'Surface', hint: 'Stand at the site and look around: the real horizon, the Sun and Earth at true size', design: true, href: (view) => `/surface/${view}` },
  { id: 'tour', label: '1-minute tour', hint: 'A guided tour of four sites', design: false, href: () => `${OLD_HOME}${TOUR_HASH}` },
  { id: 'video', label: 'Demo video', hint: 'A narrated walkthrough', design: false, href: () => `${OLD_HOME}${DEMO_HASH}` },
  { id: 'how', label: 'How it works', hint: 'The data, the checks and the tech stack', design: false, href: () => `/${HOW_HASH}` },
]

/**
 * The pages the tabs lead to ("/", "/scout/", …), and the Hype page, which has no tab (it is an
 * easter egg: lib/hypeEgg.ts): the only places a presenter can take followers (lib/follow.ts).
 */
export const SITE_PATHS: readonly string[] = [...new Set([...TABS.map((tab) => tab.href('').split(/[?#]/)[0]), HYPE_PATH])]

export interface TabLink {
  id: TabId
  label: string
  hint: string
  design: boolean
  href: string
}

/**
 * Every tab with its address. The designs open on the same site, month and hour that is on
 * screen now, so they can be compared like for like.
 */
export function tabLinks(view: string): TabLink[] {
  const chosen = view.startsWith('#a=')
  const shown = chosen ? view : DEFAULT_VIEW
  return TABS.map(({ href, ...tab }) => ({ ...tab, href: href(shown, chosen) }))
}
