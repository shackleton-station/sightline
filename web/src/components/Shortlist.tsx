import { useMemo } from 'react'
import type { SiteInfo } from '../data/contract'
import { customSiteInfo } from '../data/customSite'
import { useAllFlags } from '../data/useAllFlags'
import type { Requirements } from '../lib/mission'
import { formatUtc } from '../lib/timeline'
import { measureEntry, rankOptions, type ShortlistEntry, toIso } from '../lib/shortlist'
import { parseCustomSite } from '../lib/urlState'

interface Props {
  sites: SiteInfo[]
  list: ShortlistEntry[]
  /** The site and hour on show, to add. */
  current: ShortlistEntry
  requirements: Requirements
  onChange: (list: ShortlistEntry[]) => void
  onAdd: (entries: ShortlistEntry[]) => void
  onOpen: (site: SiteInfo, iso: string) => void
}

function siteOf(id: string, sites: SiteInfo[]): SiteInfo | null {
  const point = parseCustomSite(id)
  return point ? customSiteInfo(point.lat, point.lon) : (sites.find((site) => site.id === id) ?? null)
}

/** Options a team is weighing, ranked against the mission's limits, with the reasons. */
export function Shortlist({ sites, list, current, requirements, onChange, onAdd, onOpen }: Props) {
  const known = useMemo(() => {
    const ids = [...new Set(list.map((entry) => entry.site))]
    return ids.flatMap((id) => {
      const site = siteOf(id, sites)
      return site ? [{ id, site }] : []
    })
  }, [list, sites])
  const places = useMemo(() => known.map(({ site }) => site), [known])
  const all = useAllFlags(places)

  const rows = useMemo(() => {
    if (!all) return null
    const measured = list.flatMap((entry) => {
      const site = known.find(({ id }) => id === entry.site)?.site
      const flags = all.find((item) => item.site.id === site?.id)?.flags
      return site && flags ? [measureEntry(entry, site, flags, requirements)] : []
    })
    return rankOptions(measured)
  }, [all, list, known, requirements])

  const onList = list.some((entry) => entry.site === current.site && entry.at === current.at)
  const everySite = sites.map((site) => ({ site: site.id, at: current.at }))
  const when = formatUtc(toIso(current.at))

  return (
    <div className="shortlist">
      <div className="slip-actions">
        <button type="button" disabled={onList} onClick={() => onAdd([current])}>
          {onList ? 'This site and date is on the list' : `Add this site at ${when}`}
        </button>
        <button type="button" onClick={() => onAdd(everySite)}>
          Add every site at this date
        </button>
        {list.length > 0 && (
          <button type="button" onClick={() => onChange([])}>
            Clear the list
          </button>
        )}
      </div>
      {list.length === 0 && (
        <p className="note">
          Nothing here yet. Add options to rank them against your limits; the link to this page keeps the list, so
          you can send it to the rest of your team.
        </p>
      )}
      {list.length > 0 && !rows && <p className="note">Working out each option…</p>}
      {rows && rows.length > 0 && (
        <div className="shortlist-scroll">
          <table className="compare">
            <caption className="visually-hidden">Landing options, best first</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Site and landing time</th>
                <th scope="col">Sun during mission</th>
                <th scope="col">Longest without Sun</th>
                <th scope="col">Longest without Earth</th>
                <th scope="col">Why</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.entry.site}@${row.entry.at}`}>
                  <td className="shortlist-rank" data-label="Rank">{row.rank}</td>
                  <th scope="row">
                    {row.site.name}
                    <span className="shortlist-when">{formatUtc(toIso(row.entry.at))}</span>
                  </th>
                  <td data-label="Sun during mission">{row.sunPct === null ? '—' : `${Math.round(row.sunPct)}%`}</td>
                  <td data-label="Longest without Sun">{row.sunGapH === null ? '—' : `${row.sunGapH} h`}</td>
                  <td data-label="Longest without Earth">{row.earthGapH === null ? '—' : `${row.earthGapH} h`}</td>
                  <td>
                    <ul className="shortlist-why">
                      {row.reasons.map((reason) => (
                        <li key={reason} className={row.problems.includes(reason) ? 'not-viable' : undefined}>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="shortlist-actions">
                    <button type="button" className="plain-button" onClick={() => onOpen(row.site, toIso(row.entry.at))}>
                      Open
                    </button>
                    <button
                      type="button"
                      className="plain-button"
                      aria-label={`Remove ${row.site.name} at ${formatUtc(toIso(row.entry.at))}`}
                      onClick={() => onChange(list.filter((entry) => entry !== row.entry))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length > 1 && (
        <p className="note">
          Options that meet your limits come first, then those that miss, then any we can't measure. Within each,
          the shortest longest time without Sun leads, and Earth decides when Suns are within 2 h. Options within 2 h
          on both share a place. There's no combined score, because any weights would be made up. Between ridge
          sites the model's Sun can differ by up to about 21 points (see "How far to trust this"), so treat close
          calls as close.
        </p>
      )}
    </div>
  )
}
