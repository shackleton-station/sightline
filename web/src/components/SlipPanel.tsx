import { useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import type { ScenarioData } from '../data/loadSite'
import { useAllFlags } from '../data/useAllFlags'
import { useScenario } from '../data/useScenario'
import type { SiteFlags } from '../lib/flags'
import type { Requirements } from '../lib/mission'
import { hourOf, locateHour } from '../lib/mission'
import { formatDuration } from '../lib/nextChange'
import {
  alternativesAt,
  conditionsAt,
  nextViable,
  type Slip,
  SLIPS,
  slipTime,
  slipVerdict,
  type SlipVerdict,
} from '../lib/slip'
import { formatUtc } from '../lib/timeline'

interface Props {
  data: ScenarioData
  index: number
  flags: SiteFlags | null
  sites: SiteInfo[]
  /** The limits that decide whether a landing works: yours in Plan, Sun and Earth up in Learn. */
  requirements: Requirements
  plan: boolean
  onGo: (site: SiteInfo, month: string, index: number) => void
  /** Move to the slipped date, then show the ground around the site; absent where there's no map. */
  onSeeNearby?: () => void
  onShortlist?: (iso: string) => void
}

const MAX_ALTERNATIVES = 3

function verdictText(verdict: SlipVerdict, plan: boolean): string {
  const limits = plan ? 'your limits' : 'Sun and Earth both up'
  switch (verdict) {
    case 'still-works':
      return `Still fine: the new date meets ${limits}, like the old one.`
    case 'breaks':
      return `This slip breaks it: the old date met ${limits}, and the new one doesn't.`
    case 'fixes':
      return `This slip helps: the old date missed ${limits}, and the new one meets them.`
    case 'still-fails':
      return `Still no good: neither date meets ${limits}.`
    case 'no-data':
      return 'That goes past the end of our data.'
  }
}

/** The schedule moved: what does that do to this landing, and what are the alternatives? */
export function SlipPanel({ data, index, flags, sites, requirements, plan, onGo, onSeeNearby, onShortlist }: Props) {
  const [slip, setSlip] = useState<Slip | null>(null)
  const before = data.track[Math.min(index, data.track.length - 1)]
  const after = slip ? slipTime(before.t, slip) : null
  const inData = after !== null && flags !== null && conditionsAt(flags, after, requirements) !== null
  const afterMonth = after?.slice(0, 7) ?? data.month
  const afterData = useScenario(slip && inData ? data.site : null, afterMonth).data
  const curated = useMemo(() => (slip ? sites : []), [slip, sites])
  const others = useAllFlags(curated)

  const conditions = useMemo(() => {
    if (!flags || !after) return null
    const old = conditionsAt(flags, before.t, requirements)
    const moved = conditionsAt(flags, after, requirements)
    return { old, moved, verdict: slipVerdict(old, moved) }
  }, [flags, before.t, after, requirements])

  const fixes = useMemo(() => {
    if (!flags || !after || !conditions?.moved || conditions.moved.problems.length === 0) return null
    return nextViable(flags, after, requirements)
  }, [flags, after, conditions, requirements])

  const alternatives = useMemo(() => {
    if (!others || !after || !conditions?.moved) return []
    return alternativesAt(data.site, after, others, requirements, MAX_ALTERNATIVES)
  }, [others, after, conditions, data.site, requirements])

  const point =
    afterData && after && afterData.site.id === data.site.id && afterData.month === afterMonth
      ? afterData.track.find((row) => row.t === after)
      : null

  const left = (up: boolean, hours: number | null | undefined, set: string, rise: string) => {
    const event = up ? set : rise
    return hours === null || hours === undefined ? `No ${event.toLowerCase()} in our data` : `${event} in ${formatDuration(hours)}`
  }
  const upWord = (up: boolean | undefined) => (up ? 'Up' : 'Down')

  return (
    <section className="slip" aria-labelledby="slip-title">
      <h2 id="slip-title">Landing date slipped?</h2>
      <div className="choice" role="group" aria-label="Delay the landing by">
        {SLIPS.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={slip?.label === option.label}
            onClick={() => setSlip(slip?.label === option.label ? null : option)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {slip && after && conditions && (
        <div className="slip-result" role="status">
          <p className={`slip-verdict ${conditions.verdict}`}>{verdictText(conditions.verdict, plan)}</p>
          {conditions.old && conditions.moved && (
            <table className="compare">
              <thead>
                <tr>
                  <th scope="col" className="visually-hidden">
                    Condition
                  </th>
                  <th scope="col">Now</th>
                  <th scope="col">{slip.label}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Date (UTC)</th>
                  <td>{formatUtc(before.t).slice(0, 16)}</td>
                  <td>{formatUtc(after).slice(0, 16)}</td>
                </tr>
                <tr>
                  <th scope="row">Sun</th>
                  <td>{upWord(conditions.old.sunUp)}, {left(conditions.old.sunUp, conditions.old.sunChangeH, 'Sunset', 'Sunrise')}</td>
                  <td>{upWord(conditions.moved.sunUp)}, {left(conditions.moved.sunUp, conditions.moved.sunChangeH, 'Sunset', 'Sunrise')}</td>
                </tr>
                <tr>
                  <th scope="row">Earth</th>
                  <td>{upWord(conditions.old.earthUp)}, {left(conditions.old.earthUp, conditions.old.earthChangeH, 'Earthset', 'Earthrise')}</td>
                  <td>{upWord(conditions.moved.earthUp)}, {left(conditions.moved.earthUp, conditions.moved.earthChangeH, 'Earthset', 'Earthrise')}</td>
                </tr>
                <tr>
                  <th scope="row">Sun height</th>
                  <td>{before.sun_el.toFixed(1)}°</td>
                  <td>{point ? `${point.sun_el.toFixed(1)}°` : '…'}</td>
                </tr>
              </tbody>
            </table>
          )}
          {conditions.moved && conditions.moved.problems.length > 0 && plan && (
            <ul className="problems">
              {conditions.moved.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <div className="slip-actions">
            {conditions.moved && (
              <button
                type="button"
                onClick={() => {
                  const place = flags && locateHour(flags.start, hourOf(flags.start, after))
                  if (place) onGo(data.site, place.month, place.index)
                  setSlip(null)
                }}
              >
                Go to this date
              </button>
            )}
            {conditions.moved && plan && onShortlist && (
              <button type="button" onClick={() => onShortlist(after)}>
                Add the new date to the shortlist
              </button>
            )}
            {fixes && (
              <button
                type="button"
                onClick={() => {
                  onGo(data.site, fixes.month, fixes.index)
                  setSlip(null)
                }}
              >
                Next good date here: {fixes.t.slice(0, 10)}, {formatDuration(fixes.waitH)} later
              </button>
            )}
          </div>
          {conditions.moved && conditions.moved.problems.length > 0 && !fixes && (
            <p className="note">Nothing later in our data works at this site.</p>
          )}
          {conditions.moved && onSeeNearby && (
            <button
              type="button"
              className="plain-button slip-nearby"
              onClick={() => {
                const place = flags && locateHour(flags.start, hourOf(flags.start, after))
                if (place) onGo(data.site, place.month, place.index)
                setSlip(null)
                onSeeNearby()
              }}
            >
              See the ground around this site that month
            </button>
          )}
          {alternatives.length > 0 && (
            <>
              <h3>Other sites that work on the new date</h3>
              <ul className="windows">
                {alternatives.map(({ site, distanceKm }) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const place = flags && locateHour(flags.start, hourOf(flags.start, after))
                        if (place) onGo(site, place.month, place.index)
                        setSlip(null)
                      }}
                    >
                      {site.name}, {Math.round(distanceKm).toLocaleString('en-US')} km away
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
