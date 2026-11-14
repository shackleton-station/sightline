import { useEffect, useState } from 'react'
import type { MastHeight, SiteInfo } from '../data/contract'
import { loadMastHeights } from '../data/loadSite'
import { mastRows, mastSummary } from '../lib/mast'
import { pct } from '../lib/verdict'

interface Props {
  site: SiteInfo
  year: number
}

/** What raising the panels or antenna would change at this site. */
export function MastHeights({ site, year }: Props) {
  const [loaded, setLoaded] = useState<{ siteId: string; heights: MastHeight[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    setFailed(false)
    loadMastHeights(site)
      .then((heights) => {
        if (current) setLoaded({ siteId: site.id, heights })
      })
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [site])

  if (failed) return <p className="pending">These heights could not be loaded.</p>
  if (loaded?.siteId !== site.id) return <p className="note">Working out each height…</p>
  const rows = mastRows(loaded.heights, year)
  const summary = mastSummary(rows)

  return (
    <div className="mast">
      {summary && <p>{summary}</p>}
      <table className="compare">
        <caption className="visually-hidden">
          Sun and Earth at {site.name} in {year}, by height above the ground
        </caption>
        <thead>
          <tr>
            <th scope="col">Height</th>
            <th scope="col">Sun up</th>
            <th scope="col">Both up</th>
            <th scope="col">Longest without Sun</th>
            <th scope="col">Longest without Earth</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.obs_height_m}>
              <th scope="row">{row.obs_height_m} m</th>
              <td>{pct(row.pct_sun)}</td>
              <td>{pct(row.pct_both)}</td>
              <td>{row.max_sun_gap_h} h</td>
              <td>{row.max_earth_gap_h} h</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        All of {year}, from the same model and terrain. Only 2 m has been compared with NASA's maps, and on ridge
        tops those comparisons differ by up to 24 points, so read this as how much height matters, not as exact values.
      </p>
    </div>
  )
}
