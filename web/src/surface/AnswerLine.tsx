import type { Summary, TrackPoint } from '../data/contract'
import { answerAt, headlineOf } from '../lib/answer'
import type { SiteFlags } from '../lib/flags'

interface Props {
  siteName: string
  now: TrackPoint
  summary: Summary
  /** The site's hourly flags across all the data, for the countdowns; null until they load. */
  flags: SiteFlags | null
  flagsFailed: boolean
  lastYear: number
}

/**
 * The answer in words, from the same functions as the other designs: is the Sun up, is Earth in
 * view, and how long until each changes.
 */
export function AnswerLine({ siteName, now, summary, flags, flagsFailed, lastYear }: Props) {
  const next = flags ? answerAt(now, flags, lastYear) : null
  return (
    <section className="sf-answer" aria-label="The answer for this hour">
      <p className="sf-answer-where">
        {siteName} · {summary.obs_height_m} m above the ground
      </p>
      <h1>{headlineOf(now)}</h1>
      <p className="sf-answer-next">
        {next ? (
          <>
            <span className="sun">{next.sun.label}</span>
            <span className="earth">{next.earth.label}</span>
          </>
        ) : flagsFailed ? (
          'The time until that changes could not be loaded.'
        ) : (
          'Working out how long until that changes…'
        )}
      </p>
    </section>
  )
}
