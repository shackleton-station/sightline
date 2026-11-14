import { type FormEvent, useState } from 'react'
import { customSiteInfo, loadCustomMeta } from '../data/customSite'
import { parseCoordinate } from '../lib/customModel'
import { clockTime, fieldAt, hourFromField } from '../lib/sightline'
import { SCENARIO_LETTERS, type SightlineScenario } from '../lib/sightlineMission'
import { NOT_A_LOGIN } from './inputs'
import { LandingPick } from './LandingPick'

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  /** The landing the box starts from: the scenario's on show, in clock hours. */
  landing: number
  /** The next scenario's letter, or null when there are four already. */
  letter: string | null
  /** The scenarios, so the same place and hour is not added twice. */
  scenarios: SightlineScenario[]
  onAdd: (scenario: SightlineScenario) => void
}

/**
 * A point of the visitor's own, for Find: a latitude, a longitude and a landing, added as the next
 * scenario. Once added it has a row of its own in the grid. The landing is set with the Planner's
 * own control, in UTC, as in Compare's column headers.
 */
export function PlannerOwnPoint({ start, hours, landing, letter, scenarios, onAdd }: Props) {
  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  // The landing chosen here, for the landing it started from: when the scenario on show moves, it starts again from it.
  const [draft, setDraft] = useState<{ from: number; hour: number } | null>(null)
  const when = draft?.from === landing ? draft.hour : landing
  const [problem, setProblem] = useState<string | null>(null)

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!letter) return
    const lat = parseCoordinate(latText, -90, 90)
    const lon = parseCoordinate(lonText, -180, 360)
    if (lat === null || lon === null) {
      setProblem('Latitude is −90 to 90 (south is negative); longitude is −180 to 360 (east is positive).')
      return
    }
    const meta = await loadCustomMeta().catch(() => null)
    if (meta && Math.abs(lat) > meta.max_abs_lat) {
      setProblem(`A point at a pole has no north. Use a latitude within ${meta.max_abs_lat}°.`)
      return
    }
    const point = customSiteInfo(lat, lon > 180 ? lon - 360 : lon)
    const site = `${point.lat},${point.lon}`
    const twin = scenarios.findIndex((scenario) => scenario.site === site && scenario.landing === when)
    if (twin >= 0) {
      setProblem(`That is scenario ${SCENARIO_LETTERS[twin]}: the same place and landing hour.`)
      return
    }
    setProblem(null)
    setLatText('')
    setLonText('')
    setDraft(null)
    onAdd({ site, landing: when })
  }

  return (
    <form className="pl-own-form" aria-label="A point of your own" onSubmit={(event) => void add(event)}>
      <label>
        Latitude
        <input type="text" name="latitude" {...NOT_A_LOGIN} inputMode="decimal" value={latText} placeholder="−89.45" title="In degrees; south is negative." onChange={(event) => setLatText(event.target.value)} />
      </label>
      <label>
        Longitude
        <input type="text" name="longitude" {...NOT_A_LOGIN} inputMode="decimal" value={lonText} placeholder="−137.1" title="In degrees; east is positive." onChange={(event) => setLonText(event.target.value)} />
      </label>
      <div className="pl-own-when">
        <span>Landing</span>
        <LandingPick
          landing={clockTime(start, when)}
          landingField={fieldAt(start, when)}
          firstField={fieldAt(start, 0)}
          lastField={fieldAt(start, hours - 1)}
          onPick={(value) => {
            const picked = hourFromField(start, value, hours)
            if (picked === null) return false
            setDraft({ from: landing, hour: picked })
            return true
          }}
        />
      </div>
      <button type="submit" className="sl-small is-main" disabled={!letter} title={letter ? undefined : 'Four scenarios is the most: remove one first.'}>
        {letter ? `Add as ${letter}` : 'Four scenarios at most'}
      </button>
      {problem && (
        <p className="pl-own-problem" role="alert">
          {problem}
        </p>
      )}
      <p className="sl-quiet">Added as a scenario, the point then has a row of its own in the grid.</p>
    </form>
  )
}
