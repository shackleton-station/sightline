import { useState } from 'react'
import { savedDay } from '../lib/library'
import { myPlans } from '../lib/myPlans'

interface Props {
  /** Open a saved plan again, as its link would: its scenarios, its mission and the screen it was saved on. */
  onResume: (id: string) => void
}

/**
 * Your plans: the ones saved from this browser, newest first, each with one button to pick it up
 * where it was left. It is the first thing in the Library, because coming back to your own plan is
 * what most visits to it are for. The titles here are the visitor's own, kept in this browser: the
 * library everyone reads carries no title and no plan's id, so nothing here comes from it.
 */
export function MyPlans({ onResume }: Props) {
  // Read once as the Library opens: a plan saved since is there the next time it does.
  const [plans] = useState(myPlans)
  return (
    <section className="lib-mine" aria-label="Your plans">
      <h3>Your plans</h3>
      {plans.length === 0 ? (
        <p className="lib-mine-none">Nothing saved from this browser yet. Save a plan with a name from Share, and it waits here to be picked up again.</p>
      ) : (
        <ul>
          {plans.map((plan) => (
            <li key={plan.id}>
              <div>
                <strong>{plan.title}</strong>
                <small>Saved {savedDay(plan.saved)}</small>
              </div>
              <button type="button" className="sl-small lib-resume" title="Opens this plan again: its scenarios, its mission and the screen it was saved on" onClick={() => onResume(plan.id)}>
                Resume
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
