import { type FormEvent, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { customSiteInfo, isCustomSite, loadCustomMeta } from '../data/customSite'
import { parseCoordinate } from '../lib/customModel'
import { NOT_A_LOGIN } from './inputs'

interface Props {
  /** The sites the dropdown offers, in their groups; a custom point on show is among them. */
  sites: SiteInfo[]
  /** The site on show, by its id: where the dropdown starts. */
  siteId: string
  /** The landing on show, ISO, to the hour: where the time box starts. */
  landing: string
  /** The first and last hour of the data, ISO, so the time box can't leave it. */
  first: string
  last: string
  /** The letter the next pick gets, or null when there are four already. */
  nextLetter: string | null
  /** Add a pick at this site ("lat,lon" for a point) and landing hour, and show it. */
  onAdd: (site: string, iso: string) => void
}

/** "2026-11-17T09:00:00Z" → "2026-11-17T09:00", the form a datetime box takes (read as UTC here). */
function boxValue(iso: string): string {
  return iso.slice(0, 16)
}

/**
 * Where and when, at the top of the Planner, as a new pick: a site from the list or typed
 * coordinates, and the landing's date and hour (UTC). "Add" makes it the next scenario (up to four,
 * as everywhere in the app) and shows it, so the Moon goes there too. Both start from the landing on show.
 */
export function PlannerLocation({ sites, siteId, landing, first, last, nextLetter, onAdd }: Props) {
  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  // What is chosen or typed, for the landing it was chosen against: when the landing on show moves, both start again from it.
  const [siteDraft, setSiteDraft] = useState<{ landing: string; siteId: string; value: string } | null>(null)
  const [timeDraft, setTimeDraft] = useState<{ landing: string; value: string } | null>(null)
  const site = siteDraft?.landing === landing && siteDraft.siteId === siteId ? siteDraft.value : siteId
  const when = timeDraft?.landing === landing ? timeDraft.value : boxValue(landing)
  const groups = [...new Set(sites.map((one) => one.group))]

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!nextLetter) return
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) {
      setProblem('Choose a landing date and hour.')
      return
    }
    const iso = `${when.slice(0, 13)}:00:00Z`
    if (iso < first || iso > last) {
      setProblem(`Our data runs from ${boxValue(first).replace('T', ' ')} to ${boxValue(last).replace('T', ' ')} UTC.`)
      return
    }
    let value = sites.find((one) => one.id === site)
    let name = value ? (isCustomSite(value) ? `${value.lat},${value.lon}` : value.id) : site
    if (latText.trim() !== '' || lonText.trim() !== '') {
      const lat = parseCoordinate(latText, -90, 90)
      const lon = parseCoordinate(lonText, -180, 360)
      if (lat === null || lon === null) {
        setProblem('Latitude is −90 to 90 (south is negative); longitude is −180 to 360, east positive.')
        return
      }
      const meta = await loadCustomMeta().catch(() => null)
      if (meta && Math.abs(lat) > meta.max_abs_lat) {
        setProblem(`A point exactly at a pole has no local north. Use a latitude within ${meta.max_abs_lat}°.`)
        return
      }
      value = customSiteInfo(lat, lon > 180 ? lon - 360 : lon)
      name = `${value.lat},${value.lon}`
    }
    setProblem(null)
    setLatText('')
    setLonText('')
    setSiteDraft(null)
    setTimeDraft(null)
    onAdd(name, iso)
  }

  return (
    <form className="pl-where" aria-label="Add a pick: where and when" onSubmit={(event) => void add(event)}>
      <label className="pl-where-field">
        <span className="pl-label">Location</span>
        <select value={site} onChange={(event) => setSiteDraft({ landing, siteId, value: event.target.value })}>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {sites
                .filter((one) => one.group === group)
                .map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="pl-where-field pl-where-point">
        <span className="pl-label">Or coordinates</span>
        <span className="pl-where-row">
          <input type="text" name="latitude" {...NOT_A_LOGIN} inputMode="decimal" value={latText} placeholder="Latitude" title="Degrees, south negative, e.g. −89.45" aria-label="Latitude in degrees, south negative" onChange={(event) => setLatText(event.target.value)} />
          <input type="text" name="longitude" {...NOT_A_LOGIN} inputMode="decimal" value={lonText} placeholder="Longitude" title="Degrees, east positive, e.g. −137.1" aria-label="Longitude in degrees, east positive" onChange={(event) => setLonText(event.target.value)} />
        </span>
      </div>
      <label className="pl-where-field">
        <span className="pl-label">Landing (UTC)</span>
        <input type="datetime-local" step={3600} min={boxValue(first)} max={boxValue(last)} value={when} onChange={(event) => setTimeDraft({ landing, value: event.target.value })} />
      </label>
      <div className="pl-where-field pl-where-add">
        <span className="pl-label">{nextLetter ? 'New pick' : 'Four picks'}</span>
        <span className="pl-where-row">
          <button type="submit" className="pl-button" disabled={!nextLetter} title={nextLetter ? `Add this place and time as pick ${nextLetter}, and show it` : 'Four picks at most, as everywhere in the app: remove one first'}>
            {nextLetter ? `Add as ${nextLetter}` : 'Remove one first'}
          </button>
        </span>
      </div>
      {problem && (
        <p className="pl-where-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  )
}
