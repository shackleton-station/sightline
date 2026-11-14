import type { ScenarioData } from '../data/loadSite'
import { answerAt, clearanceWords, diskShareWords, headlineOf, sunHeightWords } from '../lib/answer'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import { hourOf, landingProblems, missionEarth, type Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import { formatUtc } from '../lib/timeline'

interface Props {
  data: ScenarioData
  index: number
  flags: SiteFlags | null
  /** True if the data across dates couldn't load; this moment's answer still shows. */
  flagsFailed?: boolean
  requirements: Requirements
  mode: Mode
}

/** The answer first: is there sunlight, can you see Earth, and for how long? */
export function AnswerCard({ data, index, flags, flagsFailed = false, requirements, mode }: Props) {
  const now = data.track[Math.min(index, data.track.length - 1)]
  const lastYear = data.year.years[data.year.years.length - 1].year
  const answer = flags && answerAt(now, flags, lastYear)
  const hour = flags ? hourOf(flags.start, now.t) : 0
  const problems = flags ? landingProblems(flags.sun, missionEarth(flags, requirements), hour, requirements) : []
  const plan = mode === 'plan'

  return (
    <section className="answer" aria-label={`Conditions at ${data.site.name}`}>
      <p className="answer-when">{formatUtc(now.t)}</p>
      <p className="answer-headline">{headlineOf(now)}</p>
      <dl className="answer-tiles">
        <div>
          <dt>
            <span className={`dot sun ${now.sun_up ? 'up' : 'blocked'}`} aria-hidden="true" /> Sun
          </dt>
          <dd>{answer?.sun.label ?? (flagsFailed ? 'Time left unavailable' : '…')}</dd>
          {plan && <dd className="answer-detail">azimuth {now.sun_az.toFixed(1)}°</dd>}
          {plan && now.sun_up && now.sun_frac < 1 && (
            <dd className="answer-detail">{diskShareWords(now.sun_frac)} of disk visible</dd>
          )}
          {plan && (
            <dd className="answer-detail">{clearanceWords(now.sun_el - horizonAt(data.horizon, now.sun_az))}</dd>
          )}
        </div>
        <div>
          <dt>
            <span className={`dot earth ${now.earth_up ? 'up' : 'blocked'}`} aria-hidden="true" /> Earth
          </dt>
          <dd>{answer?.earth.label ?? (flagsFailed ? 'Time left unavailable' : '…')}</dd>
          {plan && (
            <dd className="answer-detail">
              azimuth {now.earth_az.toFixed(1)}°, elevation {now.earth_el.toFixed(1)}°
            </dd>
          )}
          {plan && (
            <dd className="answer-detail">{clearanceWords(now.earth_el - horizonAt(data.horizon, now.earth_az))}</dd>
          )}
        </div>
        <div>
          <dt>{plan ? 'Solar elevation' : 'Sun height'}</dt>
          <dd>{plan ? `${now.sun_el.toFixed(1)}°` : sunHeightWords(now.sun_el, now.sun_up)}</dd>
        </div>
      </dl>
      {plan && data.slope && (
        <p className="answer-slope">
          Ground slope {data.slope.deg.toFixed(1)}°
          {data.slope.err_deg !== undefined && ` ±${data.slope.err_deg.toFixed(1)}°`} over {data.slope.baseline_m} m.
          Rocks and smaller bumps don't show at this scale.
        </p>
      )}
      {plan &&
        flags &&
        (problems.length === 0 ? (
          <p className="viable">
            <span aria-hidden="true">✓ </span>A landing now meets your limits.
          </p>
        ) : (
          <p className="not-viable">
            <span aria-hidden="true">✕ </span>A landing now misses your limits: {problems[0]}
          </p>
        ))}
    </section>
  )
}
