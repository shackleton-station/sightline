import { forwardOldAddress } from './oldAddress'
import { planHash } from './plans'
import { OLD_HOME } from './siteTabs'

/**
 * Short links to saved plans, on the Sightline screen.
 *
 * A plan saved from the Sightline screen is opened by the site's front page: "/#plan=<id>". A plan
 * saved from the older screen has its link there ("/classic/#plan=<id>"), and that address keeps
 * opening the older screen's plan page, as it always did.
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
 * A stored view as the Sightline screen opens it; null when it has no match there. A view saved by
 * the older screen may hold a comparison ("b=") or its 3D switch: the same rewriting a link to the
 * front page gets turns the comparison into a second scenario and drops what Sightline does not read.
 */
export function sightlineView(view: string): string | null {
  if (!view.startsWith('#a=')) return null
  const to = forwardOldAddress({ pathname: '/', search: '', hash: view })
  if (to.kind === 'stay') return view
  return to.kind === 'rewrite' ? to.to.slice(1) : null
}
