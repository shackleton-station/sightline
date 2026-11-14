import { forwardOldAddress } from './oldAddress'
import { planHash } from './plans'
import { savedBySightline } from './planView'
import { OLD_HOME } from './siteTabs'

/**
 * Short links to saved plans, on the Sightline screen.
 *
 * Every plan's short link is the site's front page with its id: "/#plan=<id>". The Sightline screen
 * fetches the plan and decides from its stored view where it opens (`sightlineView`). The older
 * screen's own address ("/classic/#plan=<id>") keeps opening its plan page, as it always did.
 */

/** The short link to a plan saved from the Sightline screen. */
export function planLink(origin: string, id: string): string {
  return `${origin}/${planHash(id)}`
}

/** Where the older screen opens a plan: where a plan goes when the Sightline screen cannot show its view. */
export function classicPlanAddress(id: string): string {
  return `${OLD_HOME}${planHash(id)}`
}

/**
 * A stored view as the Sightline screen opens it; null when it is to open on the older screen.
 *
 * Which it is depends on what the plans service returns, never on the address the short link was
 * opened at (old short links live at the front door too, on either host name):
 *
 * - A view with the Sightline mark was saved from this screen, and opens here as it is.
 * - A view without it came from an older page (or from this screen before the mark existed). It
 *   opens here only if nothing it held would be lost: it is in Plan, not the older screen's Learn,
 *   and its 3D switch is off. A comparison ("b=") is not lost: it becomes a second scenario, by
 *   the same rewriting a link to the front page gets.
 * - Anything else opens where plans always opened, on the older screen.
 */
export function sightlineView(view: string): string | null {
  if (!view.startsWith('#a=')) return null
  if (savedBySightline(view)) return view
  const params = new URLSearchParams(view.slice(1))
  if (params.get('view') !== null || params.get('mode') === 'learn') return null
  const to = forwardOldAddress({ pathname: '/', search: '', hash: view })
  if (to.kind === 'stay') return view
  return to.kind === 'rewrite' ? to.to.slice(1) : null
}
