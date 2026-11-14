import { useMemo } from 'react'
import type { Requirements } from '../lib/mission'
import { formatDuration } from '../lib/nextChange'
import { GAP_TIE_H, MAX_SHORTLIST, measureEntry, rankOptions, sameEntry, type ShortlistEntry, toIso } from '../lib/shortlist'
import type { PlannerSite } from './plannerModel'
import { plural, whenUtc } from './words'

interface Props {
  sites: PlannerSite[]
  list: ShortlistEntry[]
  /** The option on screen, marked in the list. */
  current: ShortlistEntry
  requirements: Requirements
  onOpen: (entry: ShortlistEntry) => void
  onRemove: (entry: ShortlistEntry) => void
  onClear: () => void
}

const gapText = (hours: number | null) => (hours === null ? 'no data' : hours === 0 ? 'none' : formatDuration(hours))

/**
 * A few site-and-date options side by side, in the order the app's shortlist rule gives them, with
 * the reasons. No blended score: the cards show the same three numbers and leave the trade to the team.
 */
export function ShortList({ sites, list, current, requirements, onOpen, onRemove, onClear }: Props) {
  const rows = useMemo(() => {
    const measured = list.flatMap((entry) => {
      const known = sites.find(({ site }) => site.id === entry.site)
      return known ? [measureEntry(entry, known.site, known.flags, requirements)] : []
    })
    return rankOptions(measured)
  }, [sites, list, requirements])
  // Options at custom coordinates come from another tab; the Planner keeps them in the link but can't measure them.
  const unlisted = list.length - rows.length

  return (
    <section className="pl-list" aria-labelledby="pl-list-title">
      <div className="pl-list-head">
        <h2 id="pl-list-title">Short list</h2>
        <p className="pl-fine">
          {list.length === 0 ? 'Compare a few options side by side.' : `${plural(list.length, 'option')} of up to ${MAX_SHORTLIST}, best first.`}
        </p>
        {list.length > 0 && (
          <button type="button" className="pl-link" onClick={onClear}>
            Clear the list
          </button>
        )}
      </div>
      {list.length === 0 && (
        <p className="pl-list-empty">
          Nothing here yet. Choose a square, then “Keep this option” on the brief. Do it again for another site or date, and the two sit side by side with what each one costs. The link to this page keeps the list.
        </p>
      )}
      {rows.length > 0 && (
        <ol className="pl-cards">
          {rows.map((row) => {
            const meets = row.problems.length === 0
            const shared = rows.filter((other) => other.rank === row.rank).length > 1
            const when = whenUtc(toIso(row.entry.at))
            return (
              <li key={`${row.entry.site}@${row.entry.at}`} className={['pl-card', meets ? 'meets' : 'misses', sameEntry(row.entry, current) ? 'is-current' : ''].join(' ')}>
                <p className="pl-card-place">
                  <span className="pl-card-rank" aria-hidden="true">
                    {row.rank}
                    {shared ? '=' : ''}
                  </span>
                  <span className="visually-hidden">
                    Place {row.rank}
                    {shared ? ', shared' : ''}.
                  </span>
                  {shared ? 'shared place' : ''}
                </p>
                <h3>{row.site.name}</h3>
                <p className="pl-card-when">{when}</p>
                <dl>
                  <div>
                    <dt>Longest without Sun</dt>
                    <dd>{gapText(row.sunGapH)}</dd>
                  </div>
                  <div>
                    <dt>Longest without Earth</dt>
                    <dd>{gapText(row.earthGapH)}</dd>
                  </div>
                  <div>
                    <dt>Sun up, share of mission</dt>
                    <dd>{row.sunPct === null ? 'no data' : `${Math.round(row.sunPct)}%`}</dd>
                  </div>
                </dl>
                <ul className="pl-card-why">
                  {row.reasons.map((reason) => (
                    <li key={reason} className={row.problems.includes(reason) ? 'problem' : undefined}>
                      {reason}
                    </li>
                  ))}
                </ul>
                <p className="pl-card-actions">
                  <button type="button" className="pl-link" onClick={() => onOpen(row.entry)}>
                    Open
                  </button>
                  <button type="button" className="pl-link" aria-label={`Remove ${row.site.name} at ${when}`} onClick={() => onRemove(row.entry)}>
                    Remove
                  </button>
                </p>
              </li>
            )
          })}
        </ol>
      )}
      {unlisted > 0 && (
        <p className="pl-fine">
          {plural(unlisted, 'option')} in this link {unlisted === 1 ? 'is' : 'are'} at custom coordinates, which the Planner doesn't measure. {unlisted === 1 ? 'It stays' : 'They stay'} in the link; open it in Classic to see {unlisted === 1 ? 'it' : 'them'}.
        </p>
      )}
      {rows.length > 1 && (
        <p className="pl-fine">
          Options that meet your limits come first. Within those, the option whose longest stretch without the Sun is shortest leads, and Earth decides when two are within {GAP_TIE_H} h, which is as close as hourly data can tell apart. Options within {GAP_TIE_H} h on both share a place. There is no combined score, because any weights would be made up.
        </p>
      )}
    </section>
  )
}
