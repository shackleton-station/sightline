import { type Dispatch, useEffect } from 'react'
import { setAddressBar } from '../lib/address'
import { opens3dFirst, readDeviceHints } from '../lib/device'
import { planHash } from '../lib/plans'
import { DEMO_HASH, HOW_HASH, TOUR_HASH } from '../lib/siteTabs'
import { type Action, hashOf, type View } from './viewStore'

const FIXED = [HOW_HASH, DEMO_HASH, TOUR_HASH]

/**
 * Keeps the address bar and the view in step, both ways. Returns the link for the current view.
 * - The view changes: the address is rewritten, so copying it shares this exact view. The front page
 *   has no hash; the tour, the demo video and How it works are #tour, #demo and #how.
 * - A link is pasted into the open tab, or the tab is following a presenter (lib/followClient.ts): the
 *   view follows it. The app's own rewrites don't fire this.
 */
export function useUrlSync(view: View, dispatch: Dispatch<Action>): string {
  const hash = hashOf(view)
  const touring = view.tour !== null
  // The pages that aren't a view of a site have a fixed address each.
  const plan = view.page === 'plan' && view.planId ? planHash(view.planId) : null
  const fixed = touring ? TOUR_HASH : view.page === 'how' ? HOW_HASH : view.page === 'demo' ? DEMO_HASH : plan

  useEffect(() => {
    if (fixed) setAddressBar(fixed)
    else if (hash && !view.landing) setAddressBar(hash)
    // Back on the front page: drop the address of the page just left, so a reload opens the front page.
    // Only then: while the site list is still loading, a #tour address must stay for the tour to start from.
    // The same when the front page is opened from a site: the front page's address is the bare one, so a
    // reload, a copied link and someone following a presenter all get the front page, not the site just left.
    else if (view.landing && (FIXED.includes(window.location.hash) || window.location.hash.startsWith('#a='))) setAddressBar(window.location.pathname + window.location.search)
  }, [hash, view.landing, fixed])

  useEffect(() => {
    const onHashChange = (event: HashChangeEvent) => {
      // Where the visitor went, from the event: by now the address bar may already have been
      // rewritten (the tour rewrites it as it plays).
      const to = new URL(event.newURL).hash
      if (to === TOUR_HASH) dispatch({ type: 'startTour', open3d: opens3dFirst(readDeviceHints()) })
      // No hash is the front page's address: leave whatever was open (a site, the tour, How it works) for it.
      else if (to === '') {
        dispatch({ type: 'closeTour', keepView: true })
        dispatch({ type: 'openLanding' })
      } else dispatch({ type: 'applyLink', hash: to })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [dispatch])

  return hash
}
