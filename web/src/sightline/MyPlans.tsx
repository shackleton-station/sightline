import { useState } from 'react'
import type { LibraryCard } from '../lib/library'
import { type MyPlan, myPlans } from '../lib/myPlans'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

interface Props {
  /** The library's cards, to say which places each of your plans holds. */
  cards: LibraryCard[]
  /** Open a saved plan again, as its link would: its scenarios, its mission and the screen it was saved on. */
  onResume: (id: string) => void
}

/** The places a plan holds, in a few words, from the library's cards; null when the library does not list it. */
function placesOf(plan: MyPlan, cards: LibraryCard[]): string | null {
  const places = cards.filter((card) => card.entry.plan === plan.id).map((card) => card.place)
  if (places.length === 0) return null
  const named = [...new Set(places)]
  return `${places.length} ${places.length === 1 ? 'landing' : 'landings'}: ${named.slice(0, 3).join(', ')}${named.length > 3 ? '…' : ''}`
}

/**
 * Your plans: the ones saved from this browser, newest first, each with one button to pick it up
 * where it was left. It is the first thing in the Library, because coming back to your own plan is
 * what most visits to it are for.
 */
export function MyPlans({ cards, onResume }: Props) {
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
                <small>
                  Saved {day(plan.saved)}
                  {placesOf(plan, cards) ? ` · ${placesOf(plan, cards)}` : ''}
                </small>
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
