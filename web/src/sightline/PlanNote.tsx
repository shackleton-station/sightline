import type { Plan } from '../lib/plans'
import './planNote.css'

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

interface NoteProps {
  /** The plan opened from a short link; null when none is. */
  plan: Plan | null
  /** Why a short link could not be opened; null when there is nothing to say. */
  problem: string | null
  onDismiss: () => void
}

/**
 * One quiet line beside the screen's name, for a plan opened from a short link: its name, with its
 * note in the hover text, and a button that puts the line away. It takes no room of its own, so
 * nothing on the screen moves. The same line says so, in plain words, when a link could not be opened.
 */
export function PlanNote({ plan, problem, onDismiss }: NoteProps) {
  if (!plan && !problem) return null
  return (
    <p className={problem ? 'sl-plan-note is-problem' : 'sl-plan-note'} role="status">
      <span className="sl-plan-note-words" title={plan ? [plan.title, plan.note].filter(Boolean).join(': ') : (problem ?? undefined)}>
        {plan ? `Plan: ${plan.title}` : problem}
      </span>
      <button type="button" className="sl-plan-note-close" aria-label={plan ? 'Put away the plan’s name' : 'Put this message away'} title="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </p>
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
