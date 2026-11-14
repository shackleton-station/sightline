import { useState } from 'react'
import { LIMIT_BOUNDS } from '../lib/ask'
import { EARTH_CLEARANCES_DEG, type Requirements } from '../lib/mission'
import { nearestStop, sliderStops } from './plannerModel'

interface Props {
  value: Requirements
  /** The example mission the page starts from, to go back to. */
  example: Requirements
  onChange: (value: Requirements) => void
}

// Slider positions: every day up to two weeks, then wider steps; hours grow the same way. The
// number beside each slider takes any whole value inside the bounds.
const DAY_STOPS = sliderStops([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 21, 24, 28, 30, 35, 42, 45, 60, 75, 90, 120, 150], LIMIT_BOUNDS.missionDays)
const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 60, 72, 96, 120, 168, 240, 336, 480, 720, 1440, 2160, 4380]
const SUN_STOPS = sliderStops(HOUR_STEPS, LIMIT_BOUNDS.maxSunGapH)
const EARTH_STOPS = sliderStops(HOUR_STEPS, LIMIT_BOUNDS.maxEarthGapH)

interface DialProps {
  id: string
  label: string
  unit: string
  value: number
  bounds: readonly [number, number]
  stops: number[]
  onChange: (value: number) => void
}

/** One limit: a number to type and a slider to drag. Either one redraws the grid as it changes. */
export function Dial({ id, label, unit, value, bounds: [min, max], stops, onChange }: DialProps) {
  // The number can be empty or out of range while typing; only a valid value counts.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="pl-dial">
      <label className="pl-label" htmlFor={id}>
        {label}
      </label>
      <div className="pl-dial-value">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? value}
          style={{ width: `${String(draft ?? value).length + 0.4}ch` }}
          onChange={(event) => {
            const text = event.target.value
            setDraft(text)
            const next = Number(text)
            if (text !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(Math.round(next))
          }}
          onBlur={() => {
            const next = Number(draft)
            if (draft !== null && draft !== '' && Number.isFinite(next)) onChange(Math.max(min, Math.min(max, Math.round(next))))
            setDraft(null)
          }}
        />
        <span className="pl-dial-unit">{unit}</span>
      </div>
      <input
        className="pl-slider"
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={nearestStop(value, stops)}
        aria-label={`${label}, slider`}
        aria-valuetext={`${value} ${unit}`}
        onChange={(event) => {
          setDraft(null)
          onChange(stops[Number(event.target.value)])
        }}
      />
    </div>
  )
}

const sameLimits = (a: Requirements, b: Requirements) =>
  a.missionDays === b.missionDays &&
  a.maxSunGapH === b.maxSunGapH &&
  a.maxEarthGapH === b.maxEarthGapH &&
  a.sunAtLanding === b.sunAtLanding &&
  a.earthAtLanding === b.earthAtLanding &&
  a.minEarthClearanceDeg === b.minEarthClearanceDeg

/** The mission, as the page's main control: change a limit and the whole grid redraws. */
export function MissionBar({ value, example, onChange }: Props) {
  return (
    <form className="pl-mission" aria-label="Your mission" onSubmit={(event) => event.preventDefault()}>
      <Dial id="pl-days" label="Mission length" unit="days" value={value.missionDays} bounds={LIMIT_BOUNDS.missionDays} stops={DAY_STOPS} onChange={(missionDays) => onChange({ ...value, missionDays })} />
      <Dial id="pl-sun" label="Longest time without Sun" unit="hours" value={value.maxSunGapH} bounds={LIMIT_BOUNDS.maxSunGapH} stops={SUN_STOPS} onChange={(maxSunGapH) => onChange({ ...value, maxSunGapH })} />
      <Dial id="pl-earth" label="Longest time without Earth" unit="hours" value={value.maxEarthGapH} bounds={LIMIT_BOUNDS.maxEarthGapH} stops={EARTH_STOPS} onChange={(maxEarthGapH) => onChange({ ...value, maxEarthGapH })} />
      <fieldset className="pl-at-landing">
        <legend className="pl-label">At landing</legend>
        <label className="pl-check">
          <input type="checkbox" checked={value.sunAtLanding} onChange={(event) => onChange({ ...value, sunAtLanding: event.target.checked })} />
          <span>Sun must be up</span>
        </label>
        <label className="pl-check">
          <input type="checkbox" checked={value.earthAtLanding} onChange={(event) => onChange({ ...value, earthAtLanding: event.target.checked })} />
          <span>Earth must be in view</span>
        </label>
      </fieldset>
      <div className="pl-earth-rule">
        <label className="pl-label" htmlFor="pl-clearance">
          Earth counts as in view when
        </label>
        <select id="pl-clearance" value={value.minEarthClearanceDeg} onChange={(event) => onChange({ ...value, minEarthClearanceDeg: Number(event.target.value) })}>
          <option value={0}>Any part shows (optimistic for radio)</option>
          {EARTH_CLEARANCES_DEG.map((degrees) => (
            <option key={degrees} value={degrees}>
              Its center is {degrees}° above the terrain
            </option>
          ))}
        </select>
        <p className="pl-mission-note">
          {sameLimits(value, example) ? (
            'These are example values. Set your own.'
          ) : (
            <button type="button" className="pl-link" onClick={() => onChange(example)}>
              Back to the example mission
            </button>
          )}
        </p>
      </div>
    </form>
  )
}
