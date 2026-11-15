import type { ReactNode } from 'react'
import { Flow, type FlowStep, GuideStep } from './GuideParts'

interface Props {
  /** The Sun's share of the month on show, as the page writes it, for the worked example. */
  sunShare: string
  /** The model Scout's service reports right now; null when it says none. */
  model: string | null
  /** The year of the landing on show, for the ready question that names one; null on a page with no plan. */
  year: string | null
  /** Today's counts of questions, drawn by the page that reads them. */
  children: ReactNode
}

/**
 * Scout: what to ask him, how he is kept from inventing a number, and what on the site is made by
 * AI. The model's name comes from his service's own status, so it cannot go stale.
 */
export function GuideScout({ sunShare, model, year, children }: Props) {
  // The questions Scout's own panel offers, word for word.
  const asks = ['Why is landing here hard?', `When is the best landing here in ${year ?? 'a year'}?`, 'Which of my scenarios is best, and why?', 'How much margin does this landing have?']
  const answer: FlowStep[] = [
    { name: 'You ask', does: '“How sunny is it here this month?”', tech: 'POST /api/chat' },
    { name: 'Scout picks a tool', does: 'He may only call our own read-only lookups.', tech: 'Claude tool use: month_summary' },
    { name: 'Our code computes', does: `Sun up: ${sunShare}`, tech: 'the same function the page uses' },
    { name: 'Scout writes a blank', does: '“The Sun is up {{r1.pct_sun}} of the month.”', tech: 'a reference, never a number' },
    { name: 'The server fills it in', does: `“The Sun is up ${sunShare} of the month.”`, tech: 'a reply with a typed digit is refused' },
  ]
  return (
    <GuideStep
      id="how-scout"
      kicker="Your guide"
      title="Meet Scout"
      intro="Scout is the built-in assistant. Ask a question in plain words and he looks the answer up in the same data the screen uses. He also runs the tour."
    >
      <ul className="how-asks" aria-label="Things to ask Scout">
        {asks.map((ask) => (
          <li key={ask}>{ask}</li>
        ))}
      </ul>

      <h3>How Scout stays honest</h3>
      <p className="how-caption">A language model is good with words and unreliable with numbers. So Scout’s is never allowed to write one.</p>
      <Flow steps={answer} label="How Scout answers" />
      <p className="how-caption">
        The same rule covers his buttons: the server rebuilds each one from parts it has checked, so the model can only send you to a real site, month and hour.
      </p>

      <h3>What is made by AI</h3>
      <p className="how-caption">
        Two things are made by AI, and carry an “AI” tag where they appear: Scout’s answers, which a language model writes from our numbers (his voice is synthetic too), and
        Scout’s mark, the round badge beside his name. Scout’s answers and his mark are AI-generated.
      </p>
      {/* Which model, from what Scout's service reports right now, so this cannot go stale. */}
      <p className="how-caption how-scout-model">
        Scout is Anthropic’s Claude{model ? ` (${model})` : ''}. He reads the same data as the screen, through the service’s read-only tools, and never works out a number himself:
        the server fills in every number, date and time from that data.
      </p>

      <h3>Questions to Scout today</h3>
      {children}
    </GuideStep>
  )
}
