import { type FormEvent, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { customSiteInfo, loadCustomMeta } from '../data/customSite'
import { parseCoordinate } from '../lib/customModel'
import { NOT_A_LOGIN } from './inputs'

interface Props {
  /** The sites the dropdown offers, in their groups; a custom point on show is among them. */
  sites: SiteInfo[]
  /** The site on show, by its id. */
  siteId: string
  /** The landing on show, ISO, to the hour. */
  landing: string
  /** The first and last hour of the data, ISO, so the time box can't leave it. */
  first: string
  last: string
  onSite: (siteId: string) => void
  /** A typed point, as the app's links name one ("lat,lon"). */
  onPoint: (value: string, site: SiteInfo) => void
  onLanding: (iso: string) => void
}

/** "2026-11-17T09:00:00Z" → "2026-11-17T09:00", the form a datetime box takes (read as UTC here). */
function boxValue(iso: string): string {
  return iso.slice(0, 16)
}

/**
 * Where and when, at the top of the Planner: a site from the list or typed coordinates, and the
 * landing's date and hour (UTC). Each one moves the landing on show, which the Moon shows too.
 */
export function PlannerLocation({ sites, siteId, landing, first, last, onSite, onPoint, onLanding }: Props) {
  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  // What is typed, for the landing it was typed against: when the landing moves from elsewhere (a square, the brief, the Moon), the box shows the new one.
  const [draft, setDraft] = useState<{ landing: string; value: string } | null>(null)
  const when = draft?.landing === landing ? draft.value : boxValue(landing)
  const groups = [...new Set(sites.map((site) => site.group))]

  const goTo = async (event: FormEvent) => {
    event.preventDefault()
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
    setProblem(null)
    const site = customSiteInfo(lat, lon > 180 ? lon - 360 : lon)
    onPoint(`${site.lat},${site.lon}`, site)
  }

  const setTime = (value: string) => {
    setDraft({ landing, value })
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return
    const iso = `${value.slice(0, 13)}:00:00Z`
    if (iso < first || iso > last) return
    onLanding(iso)
  }

  return (
    <div className="pl-where" role="group" aria-label="Where and when">
      <label className="pl-where-field">
        <span className="pl-label">Location</span>
        <select value={siteId} onChange={(event) => onSite(event.target.value)}>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {sites
                .filter((site) => site.group === group)
                .map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <form className="pl-where-field pl-where-point" onSubmit={(event) => void goTo(event)}>
        <span className="pl-label">Or coordinates</span>
        <span className="pl-where-row">
          <input type="text" name="latitude" {...NOT_A_LOGIN} inputMode="decimal" value={latText} placeholder="Latitude" title="Degrees, south negative, e.g. −89.45" aria-label="Latitude in degrees, south negative" onChange={(event) => setLatText(event.target.value)} />
          <input type="text" name="longitude" {...NOT_A_LOGIN} inputMode="decimal" value={lonText} placeholder="Longitude" title="Degrees, east positive, e.g. −137.1" aria-label="Longitude in degrees, east positive" onChange={(event) => setLonText(event.target.value)} />
          <button type="submit" className="pl-button">
            Go
          </button>
        </span>
      </form>
      <label className="pl-where-field">
        <span className="pl-label">Landing (UTC)</span>
        <input type="datetime-local" step={3600} min={boxValue(first)} max={boxValue(last)} value={when} onChange={(event) => setTime(event.target.value)} />
      </label>
      {problem && (
        <p className="pl-where-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
