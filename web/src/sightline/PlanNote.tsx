import { useLayoutEffect, useRef } from 'react'
import type { Plan } from '../lib/plans'
import './planNote.css'

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Under this width the window is a phone's: the card lies along its foot. */
const PHONE_UNDER_PX = 761
/** The air the card keeps from the edge of what it lies in. */
const EDGE_PX = 8
/** In Watch, on a laptop, the card is this wide and sits this far under the window's top, beside the Moon and not on it. */
const WATCH_WIDTH_PX = 288
const WATCH_TOP_PX = 60

interface CardProps {
  /** The plan opened from a short link; null when none is. */
  plan: Plan | null
  /** Why a short link could not be opened; null when there is nothing to say. */
  problem: string | null
  onDismiss: () => void
  /** Drawn in the Planner's header, as a row of it. Anywhere else the card is placed over the screen. */
  inHeader?: boolean
  /** What the screen is showing, in a word: the card is placed again when it changes. */
  layout?: string
}

/**
 * A saved plan's card: it says the screen is showing a saved plan, then the plan's name and, under
 * it, the note its author left, with a button that puts the card away for the rest of the visit. It
 * is in sight as the link opens, with no press: the name and the note are why the link was sent.
 * When a short link cannot be opened, the same card says why in plain words.
 *
 * It never moves the screen and never lies on the Moon on a laptop. In the Planner it is a row of
 * the Planner's header. With the plan column open it lies along the column's foot, inside it. In
 * Watch it sits in the corner under the page's name. On a phone it lies along the window's foot,
 * over whatever sheet is open. A long note wraps and, past a few lines, scrolls inside the card.
 */
export function SavedPlanCard({ plan, problem, onDismiss, inHeader = false, layout = '' }: CardProps) {
  const card = useRef<HTMLElement>(null)
  const there = plan !== null || problem !== null
  useLayoutEffect(() => {
    if (inHeader || !there) return
    const place = () => {
      const el = card.current
      if (!el) return
      const phone = window.innerWidth < PHONE_UNDER_PX
      const column = phone ? null : document.querySelector('.sl-col')?.getBoundingClientRect()
      const inColumn = column !== null && column !== undefined && column.width > 0
      const left = inColumn ? column.left + EDGE_PX : phone ? EDGE_PX : 2 * EDGE_PX
      el.style.left = `${left}px`
      el.style.width = `${inColumn ? column.width - 2 * EDGE_PX : phone ? window.innerWidth - 2 * EDGE_PX : WATCH_WIDTH_PX}px`
      el.style.top = inColumn || phone ? 'auto' : `${WATCH_TOP_PX}px`
      el.style.bottom = inColumn ? `${window.innerHeight - column.bottom + EDGE_PX}px` : phone ? `${EDGE_PX}px` : 'auto'
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [inHeader, there, layout])
  if (!there) return null
  return (
    <section ref={card} className={`sl-saved-card${inHeader ? ' is-in-header' : ''}${plan ? '' : ' is-problem'}`} aria-label={plan ? 'Saved plan' : 'Saved plan link'}>
      <div className="sl-saved-card-words" role="status">
        {plan ? (
          <>
            <p className="sl-saved-card-kind">Saved plan</p>
            <p className="sl-saved-card-name">{plan.title}</p>
            {plan.note !== '' && <p className="sl-saved-card-note">{plan.note}</p>}
          </>
        ) : (
          <p className="sl-saved-card-problem">{problem}</p>
        )}
      </div>
      <button type="button" className="sl-small sl-saved-card-away" title={plan ? 'Hides the saved plan’s name and note for the rest of this visit.' : 'Hides this message.'} onClick={onDismiss}>
        Put away
      </button>
    </section>
  )
}

/**
 * A saved plan's own brief, for the top of the written brief: its name and note, and what the data
 * said about it when it was saved, as the plans service worked it out then.
 */
export function SavedBrief({ plan }: { plan: Plan }) {
  return (
    <section className="sl-saved-brief" aria-label="The saved plan">
      <h2>{plan.title}</h2>
      {plan.note && <p className="sl-saved-note">{plan.note}</p>}
      <dl>
        {plan.brief.map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
      <p className="sl-quiet">
        What the data said when this plan was saved, on {DAY.format(new Date(plan.created))}. It is kept until {DAY.format(new Date(plan.expires))}.
      </p>
    </section>
  )
}
