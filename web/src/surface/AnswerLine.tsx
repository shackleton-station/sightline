import type { HorizonPoint, Summary, TrackPoint } from '../data/contract'
import { answerAt, clearanceWords, diskShareWords, headlineOf, sunHeightWords } from '../lib/answer'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import { monthLabel } from '../lib/months'
import { verdict } from '../lib/verdict'

interface Props {
  siteName: string
  month: string
  now: TrackPoint
  horizon: HorizonPoint[]
  summary: Summary
  /** The site's hourly flags across all the data, for the countdowns; null until they load. */
  flags: SiteFlags | null
  flagsFailed: boolean
  lastYear: number
}

/** How the Sun stands this hour, in the words the other designs use. */
function sunWords(now: TrackPoint): string {
  const height = sunHeightWords(now.sun_el, now.sun_up)
  if (!now.sun_up) return `behind the land, ${height}`
  return now.sun_frac < 1 ? `${diskShareWords(now.sun_frac)} of its disk showing, ${height}` : `all of its disk showing, ${height}`
}

/**
 * The answer in words, from the same functions as the other designs: is the Sun up, is Earth in
 * view, and how long until each changes. Then the month in one line.
 */
export function AnswerLine({ siteName, month, now, horizon, summary, flags, flagsFailed, lastYear }: Props) {
  const next = flags ? answerAt(now, flags, lastYear) : null
  const earthClearance = now.earth_el - horizonAt(horizon, now.earth_az)
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
      <dl className="sf-answer-detail">
        <div>
          <dt className="sun">Sun</dt>
          <dd>{sunWords(now)}</dd>
        </div>
        <div>
          <dt className="earth">Earth</dt>
          <dd>
            {now.earth_up ? 'in view' : 'behind the land'}, {clearanceWords(earthClearance)}
          </dd>
        </div>
        <div>
          <dt>{monthLabel(month)}</dt>
          <dd>{verdict(summary)}</dd>
        </div>
      </dl>
    </section>
  )
}
