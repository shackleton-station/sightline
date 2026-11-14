import { type CountsState, shareOf } from '../data/questionCounts'

/** "2026-11-12" as "12 November 2026", without a time zone shifting the day. */
function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Today's co-pilot questions, counted by the events worker. Three plain states besides the numbers:
 * still loading, nothing asked yet today, and counts that can't be read.
 */
export function QuestionCounts({ counts }: { counts: CountsState }) {
  if (counts.state === 'loading') return <p className="how-caption">Loading today’s counts…</p>
  if (counts.state === 'unavailable') return <p className="how-caption">Today’s counts can’t be read right now. Nothing else on the site depends on them.</p>

  const { day, questions, cached, fallback, busy, failed } = counts.counts
  if (questions === 0) return <p className="how-caption">No questions have been counted yet today ({dayLabel(day)}, UTC). Ask the co-pilot one and open this page again.</p>

  const rows: { label: string; value: number; note: string }[] = [
    { label: 'Questions', value: questions, note: 'put to the co-pilot' },
    { label: 'From the cache', value: cached, note: 'answered without calling the model' },
    { label: 'From the facts', value: fallback, note: 'the model failed to write, so the looked-up facts were sent' },
    { label: 'Model busy', value: busy, note: 'the visitor was asked to try again' },
    { label: 'Failed', value: failed, note: 'no answer could be given' },
  ]
  return (
    <>
      <dl className="how-counts" aria-label={`Co-pilot questions on ${dayLabel(day)}, UTC`}>
        {rows.map(({ label, value, note }, i) => {
          const share = i > 0 ? shareOf(value, questions) : null
          return (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <strong>{value.toLocaleString('en-US')}</strong>
                {share !== null && <span> ({share}%)</span>}
                <small>{note}</small>
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="how-caption">
        {dayLabel(day)}, counted in UTC, up to half a minute old. Only counts are kept here: never a question’s words, and nothing about who asked.
      </p>
    </>
  )
}
