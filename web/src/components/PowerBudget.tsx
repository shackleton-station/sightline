import { useState } from 'react'
import { powerBudget, type PowerInputs } from '../lib/power'
import { NumberField } from './MissionInputs'

interface Props {
  /** Monthly average sunlight on a vertical, Sun-facing panel, from the pipeline (W/m²). */
  verticalSunlightWm2: number
  /** This month's longest time without any of the Sun's disk, from the pipeline (h). */
  longestSunGapH: number
}

/** Example values, clearly marked as such. People replace them with their own design. */
const EXAMPLE: PowerInputs = { panelAreaM2: 2, efficiency: 0.3, nightLoadW: 100 }

function kWh(wh: number): string {
  return wh >= 1000 ? `${(wh / 1000).toFixed(1)} kWh` : `${Math.round(wh)} Wh`
}

/** Turns this month's sunlight and longest night into watts and a battery size, for the user's panel. */
export function PowerBudget({ verticalSunlightWm2, longestSunGapH }: Props) {
  const [inputs, setInputs] = useState<PowerInputs>(EXAMPLE)
  const budget = powerBudget(verticalSunlightWm2, longestSunGapH, inputs)
  return (
    <div className="power-budget">
      <h3>Power and battery, roughly</h3>
      <fieldset className="mission-inputs">
        <legend>Your panel and load (example values, so set your own)</legend>
        <NumberField
          label="Panel area (m²)"
          value={inputs.panelAreaM2}
          min={1}
          max={50}
          onChange={(panelAreaM2) => setInputs({ ...inputs, panelAreaM2 })}
        />
        <NumberField
          label="Panel efficiency (%)"
          value={Math.round(inputs.efficiency * 100)}
          min={1}
          max={50}
          onChange={(percent) => setInputs({ ...inputs, efficiency: percent / 100 })}
        />
        <NumberField
          label="Load with no Sun (W)"
          value={inputs.nightLoadW}
          min={0}
          max={5000}
          onChange={(nightLoadW) => setInputs({ ...inputs, nightLoadW })}
        />
      </fieldset>
      <dl className="stats">
        <div>
          <dt>Average panel power this month</dt>
          <dd>{Math.round(budget.averagePanelW)} W</dd>
        </div>
        <div>
          <dt>Battery for the longest night ({longestSunGapH} h)</dt>
          <dd>{longestSunGapH === 0 ? 'none needed' : kWh(budget.batteryWh)}</dd>
        </div>
      </dl>
      <p className="note">
        A first estimate: a vertical panel that turns to face the Sun, this month's average sunlight, and the
        load running through the longest time without Sun. It leaves out dust, temperature, battery depth of
        discharge and wiring losses, so a real design needs margin on top.
      </p>
    </div>
  )
}
