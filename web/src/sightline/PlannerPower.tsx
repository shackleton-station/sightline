import { useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { panelSunlight, powerBudget, type PowerInputs } from '../lib/power'

interface Column {
  letter: string
  name: string
  /** The mission hour by hour from its landing; undefined while it loads, null if it failed. */
  track: TrackPoint[] | null | undefined
  /** The mission's longest time without the Sun, from the same flags as the table above (h); null past the data. */
  sunGapH: number | null
}

interface Props {
  columns: Column[]
  /** Set when the mission's heights aren't 2 m: these figures are worked out at 2 m. */
  heightsNote: string | null
}

/** Example values, clearly marked as such: the same ones the site's first power budget used. People replace them with their own design. */
const EXAMPLE: PowerInputs = { panelAreaM2: 2, efficiency: 0.3, nightLoadW: 100 }

function energy(wh: number): string {
  return wh >= 1000 ? `${(wh / 1000).toFixed(1)} kWh` : `${Math.round(wh)} Wh`
}

/** One example value to change: a number, its unit and its bounds. */
function Field({ label, unit, value, min, max, onChange }: { label: string; unit: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="pl-power-field">
      <span>{label}</span>
      <span className="pl-power-input">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          value={draft ?? value}
          onChange={(event) => {
            setDraft(event.target.value)
            const next = Number(event.target.value)
            if (event.target.value !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(next)
          }}
          onBlur={() => setDraft(null)}
        />
        <small>{unit}</small>
      </span>
    </label>
  )
}

/**
 * What the sunlight means for the lander, roughly: the average power a panel would make over each
 * mission, and the battery it needs to ride out the mission's longest dark spell. The panel, its
 * efficiency and the load are example values to replace. Sunlight is the pipeline's own: how much of
 * the Sun's disc shows, hour by hour, on a vertical panel turned to face it (`lib/power.ts`).
 */
export function PlannerPower({ columns, heightsNote }: Props) {
  const [inputs, setInputs] = useState<PowerInputs>(EXAMPLE)
  const example = inputs.panelAreaM2 === EXAMPLE.panelAreaM2 && inputs.efficiency === EXAMPLE.efficiency && inputs.nightLoadW === EXAMPLE.nightLoadW
  const budgets = columns.map((column) => {
    if (!column.track || column.sunGapH === null) return null
    return powerBudget(panelSunlight(column.track).vertical, column.sunGapH, inputs)
  })
  const most = Math.max(0, ...budgets.map((budget) => budget?.averagePanelW ?? 0))
  const least = Math.min(...budgets.filter((budget) => budget !== null).map((budget) => (budget as { batteryWh: number }).batteryWh))
  return (
    <section className="pl-power" aria-labelledby="pl-power-title">
      <h3 id="pl-power-title">Power and battery, roughly</h3>
      <div className="pl-power-inputs" role="group" aria-label="Your panel and load">
        <Field label="Panel" unit="m²" value={inputs.panelAreaM2} min={0.1} max={50} onChange={(panelAreaM2) => setInputs({ ...inputs, panelAreaM2 })} />
        <Field label="Efficiency" unit="%" value={Math.round(inputs.efficiency * 100)} min={1} max={50} onChange={(percent) => setInputs({ ...inputs, efficiency: percent / 100 })} />
        <Field label="Load in the dark" unit="W" value={inputs.nightLoadW} min={0} max={5000} onChange={(nightLoadW) => setInputs({ ...inputs, nightLoadW })} />
        <p className="pl-power-example">
          {example ? (
            'Example values: set your own.'
          ) : (
            <button type="button" className="sl-link" onClick={() => setInputs(EXAMPLE)}>
              Back to the example values
            </button>
          )}
        </p>
      </div>
      <div className="pl-power-cards">
        {columns.map((column, i) => {
          const budget = budgets[i]
          return (
            <div key={column.letter} className="pl-power-card">
              <p className="pl-power-name">
                <span className="pl-sunrow-letter">{column.letter}</span> {column.name}
              </p>
              {budget === null ? (
                <p className="sl-quiet">{column.track === undefined ? 'Loading…' : column.sunGapH === null ? 'The mission runs past our data.' : 'Didn’t load.'}</p>
              ) : (
                <dl>
                  <div>
                    <dt>Average panel power</dt>
                    <dd>
                      {Math.round(budget.averagePanelW)} W{budget.averagePanelW === most && columns.length > 1 && most > 0 ? <span className="sl-best"> ★</span> : null}
                    </dd>
                    <dd className="pl-power-bar" aria-hidden="true">
                      <i style={{ width: `${most > 0 ? (100 * budget.averagePanelW) / most : 0}%` }} />
                    </dd>
                  </div>
                  <div>
                    <dt>Battery for the longest dark ({column.sunGapH} h)</dt>
                    <dd>
                      {column.sunGapH === 0 ? 'none needed' : energy(budget.batteryWh)}
                      {budget.batteryWh === least && columns.length > 1 ? <span className="sl-best"> ★</span> : null}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )
        })}
      </div>
      <p className="sl-quiet">
        A first estimate: a vertical panel turned to face the Sun, the mission's own sunlight, and the load running through its longest time without Sun. It leaves out dust, temperature, battery depth of discharge and wiring
        losses, so a real design needs margin on top. ★ best of your picks.{heightsNote ? ` ${heightsNote}` : ''}
      </p>
    </section>
  )
}
