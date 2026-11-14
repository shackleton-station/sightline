import { useEffect, useState } from 'react'
import type { CustomMeta, SiteInfo } from '../data/contract'
import { customSiteInfo, loadCustomMeta } from '../data/customSite'
import { parseCoordinate } from '../lib/customModel'
import type { Scenario } from '../lib/scenario'

interface Props {
  sites: SiteInfo[]
  scenario: Scenario
  onChange: (scenario: Scenario) => void
  /** Leave out coordinates and their source: Learn shows them on the map instead. */
  brief?: boolean
}

const CUSTOM_OPTION = 'custom'

function formatLatLon(lat: number, lon: number): string {
  const latText = `${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}`
  const lonText = `${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`
  return `${latText}, ${lonText}`
}

/** Choose a landing site from the curated list or type coordinates; months are on the year strip. */
export function ScenarioPicker({ sites, scenario, onChange, brief = false }: Props) {
  const [typing, setTyping] = useState(false)
  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [meta, setMeta] = useState<CustomMeta | null>(null)

  useEffect(() => {
    if (typing && !meta) {
      loadCustomMeta()
        .then(setMeta)
        .catch((reason: unknown) => setProblem(String(reason)))
    }
  }, [typing, meta])

  // A site chosen elsewhere, such as on the grid or map, ends any typing in progress.
  useEffect(() => {
    setTyping(false)
    setProblem(null)
  }, [scenario.siteId])

  const site = scenario.custom ?? sites.find((s) => s.id === scenario.siteId)

  const apply = () => {
    if (!meta) return
    const lat = parseCoordinate(latText, -90, 90)
    const lon = parseCoordinate(lonText, -180, 360)
    if (lat === null || lon === null) {
      setProblem('Enter latitude from -90 to 90 and longitude from -180 to 360.')
      return
    }
    if (Math.abs(lat) > meta.max_abs_lat) {
      setProblem(`A point exactly at a pole has no local north. Use a latitude within ${meta.max_abs_lat}°.`)
      return
    }
    setProblem(null)
    const custom = customSiteInfo(lat, lon > 180 ? lon - 360 : lon)
    onChange({ ...scenario, siteId: custom.id, custom })
  }

  return (
    <div className="picker">
      <label>
        Landing site
        <select
          value={typing || scenario.custom ? CUSTOM_OPTION : scenario.siteId}
          onChange={(event) => {
            const value = event.target.value
            setTyping(value === CUSTOM_OPTION)
            setProblem(null)
            if (value !== CUSTOM_OPTION) onChange({ month: scenario.month, siteId: value })
          }}
        >
          {[...new Set(sites.map((s) => s.group))].map((group) => (
            <optgroup key={group} label={group}>
              {sites
                .filter((s) => s.group === group)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
          ))}
          <option value={CUSTOM_OPTION}>Custom coordinates…</option>
        </select>
      </label>
      {typing && (
        <form
          className="custom-form"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <label>
            Latitude (°, north positive)
            <input inputMode="decimal" value={latText} onChange={(e) => setLatText(e.target.value)} />
          </label>
          <label>
            Longitude (°, east positive)
            <input inputMode="decimal" value={lonText} onChange={(e) => setLonText(e.target.value)} />
          </label>
          <button type="submit" disabled={!meta}>
            Show this point
          </button>
          {problem && (
            <p className="form-problem" role="alert">
              {problem}
            </p>
          )}
        </form>
      )}
      {scenario.custom && !typing && (
        <button
          type="button"
          className="plain-button"
          onClick={() => {
            setLatText(String(scenario.custom?.lat ?? ''))
            setLonText(String(scenario.custom?.lon ?? ''))
            setTyping(true)
          }}
        >
          Change coordinates
        </button>
      )}
      {site && !brief && (
        <p className="note">
          {formatLatLon(site.lat, site.lon)}
          {site.source_url && (
            <>
              {' · '}
              <a href={site.source_url} target="_blank" rel="noreferrer">
                location source
              </a>
            </>
          )}
        </p>
      )}
    </div>
  )
}
