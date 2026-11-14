import type { TrackPoint } from '../data/contract'
import { answerAt, headlineOf } from '../lib/answer'
import type { SiteFlags } from '../lib/flags'
import { monthLabel } from '../lib/months'

interface Props {
  siteName: string
  month: string
  now: TrackPoint
  flags: SiteFlags | null
  lastYear: number
  /** In Plan mode: why a landing at this hour misses the limits, or an empty list if it meets them. */
  problems: string[] | null
}

/** The answer in one line, over the picture: what is up now, and when that changes. */
export function StatusLine({ siteName, month, now, flags, lastYear, problems }: Props) {
  const answer = flags ? answerAt(now, flags, lastYear) : null
  return (
    <section className="mc-status" aria-live="polite" aria-label={`Conditions at ${siteName}`}>
      <p className="mc-status-where">
        {siteName} · {monthLabel(month)}
      </p>
      <h1>{headlineOf(now)}</h1>
      {answer && (
        <p className="mc-status-next">
          <span className={`dot sun ${now.sun_up ? 'up' : 'blocked'}`} aria-hidden="true" /> {answer.sun.label}
          <span className={`dot earth ${now.earth_up ? 'up' : 'blocked'}`} aria-hidden="true" /> {answer.earth.label}
        </p>
      )}
      {problems &&
        (problems.length === 0 ? (
          <p className="mc-status-verdict ok">✓ A landing now meets your limits</p>
        ) : (
          <p className="mc-status-verdict miss">✕ {problems[0]}</p>
        ))}
    </section>
  )
}
