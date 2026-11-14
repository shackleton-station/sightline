import { useState } from 'react'
import { EARTH_CLEARANCES_DEG, type Requirements } from '../lib/mission'

interface Props {
  value: Requirements
  onChange: (value: Requirements) => void
}

/** A number that can be empty while typing: only a valid value counts, and leaving the field settles it. */
export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={draft ?? value}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          const next = Number(text)
          if (text !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(Math.round(next))
        }}
        onBlur={() => {
          const next = Number(draft)
          if (draft !== null && draft !== '' && Number.isFinite(next)) {
            onChange(Math.max(min, Math.min(max, Math.round(next))))
          }
          setDraft(null)
        }}
      />
    </label>
  )
}

/** The limits a mission can tolerate. Defaults are examples, to be replaced with real numbers. */
export function MissionInputs({ value, onChange }: Props) {
  return (
    <fieldset className="mission-inputs">
      <legend>Your mission's limits (example values, so set your own)</legend>
      <NumberField
        label="Mission length (days)"
        value={value.missionDays}
        min={1}
        max={180}
        onChange={(missionDays) => onChange({ ...value, missionDays })}
      />
      <NumberField
        label="Longest time without Sun (hours)"
        value={value.maxSunGapH}
        min={0}
        max={8760}
        onChange={(maxSunGapH) => onChange({ ...value, maxSunGapH })}
      />
      <NumberField
        label="Longest time without Earth (hours)"
        value={value.maxEarthGapH}
        min={0}
        max={8760}
        onChange={(maxEarthGapH) => onChange({ ...value, maxEarthGapH })}
      />
      <label>
        Earth counts as up when
        <select
          value={value.minEarthClearanceDeg}
          onChange={(event) => onChange({ ...value, minEarthClearanceDeg: Number(event.target.value) })}
        >
          <option value={0}>Any part shows (optimistic for radio)</option>
          {EARTH_CLEARANCES_DEG.map((degrees) => (
            <option key={degrees} value={degrees}>
              Center is {degrees}° above the terrain
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value.sunAtLanding}
          onChange={(event) => onChange({ ...value, sunAtLanding: event.target.checked })}
        />
        Sun up at landing
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value.earthAtLanding}
          onChange={(event) => onChange({ ...value, earthAtLanding: event.target.checked })}
        />
        Earth up at landing
      </label>
    </fieldset>
  )
}
