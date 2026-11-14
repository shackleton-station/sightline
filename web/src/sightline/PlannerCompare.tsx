import { clockTime, stateAt, stateRuns } from '../lib/sightline'
import { type ScenarioMeasure, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import type { PlannerRow } from './plannerTable'
import { BAND, STATE_CHIP } from './states'
import type { ScenarioFacts } from './useScenarioFacts'

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  measures: (ScenarioMeasure | null)[]
  rows: PlannerRow[]
  active: number
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  /** The Sun's and Earth's angles at each landing, under the "At landing" row. */
  landingRows: PlannerRow[]
}

/** The cells of one row with a number in them: the figure, the best mark, and the hours behind a share. */
function RowCells({ row }: { row: PlannerRow }) {
  return row.cells.map((cell, i) => (
    <td key={i} className={row.best[i] ? 'is-best' : undefined}>
      {cell ?? '…'}
      {row.best[i] && (
        <span className="sl-best" title="Best in this row">
          {' '}
          ★
        </span>
      )}
      {row.notes[i] && <small> {row.notes[i]}</small>}
    </td>
  ))
}

/** How many days apart the labels under the aligned rows are, so about ten fit. */
function dayStep(missionDays: number): number {
  return Math.max(1, Math.ceil(missionDays / 10))
}

/**
 * Compare: "which of my picks is best?" The scenarios side by side with every row the app can
 * measure, then one time row per scenario lined up on its own landing.
 */
export function PlannerCompare({ start, hours, scenarios, facts, mission, measures, rows, active, onSelect, onRemove, landingRows }: Props) {
  const missionH = mission.requirements.missionDays * 24
  const step = dayStep(mission.requirements.missionDays)
  return (
    <div className="pl-compare" role="tabpanel" aria-label="Compare">
      <h3>Scenarios, over the {mission.requirements.missionDays}-day mission</h3>
      <div className="sl-full-scroll">
        <table className="sl-full-table">
          <thead>
            <tr>
              <td />
              {scenarios.map((scenario, i) => (
                <th key={i} scope="col">
                  {/* The letter at the left, the site, its landing and "remove" stacked beside it: the same shape however narrow the column. */}
                  <div className="sl-full-th">
                    <button type="button" className="sl-small" aria-pressed={i === active} aria-label={`Scenario ${SCENARIO_LETTERS[i]}`} onClick={() => onSelect(i)}>
                      {SCENARIO_LETTERS[i]}
                    </button>
                    <span>
                      {facts[i].site.name}
                      <small>{clockTime(start, scenario.landing)}</small>
                    </span>
                    {scenarios.length > 1 && (
                      <button type="button" className="sl-link" aria-label={`Remove scenario ${SCENARIO_LETTERS[i]}`} onClick={() => onRemove(i)}>
                        remove
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" title={row.title}>
                  {row.label}
                </th>
                <RowCells row={row} />
              </tr>
            ))}
            <tr>
              <th scope="row">At landing</th>
              {scenarios.map((scenario, i) => {
                const flags = facts[i].flags
                const state = flags ? stateAt(flags, scenario.landing) : null
                return (
                  <td key={i} data-state={state ?? undefined}>
                    {state ? (
                      <>
                        <i className={`sl-key is-${state}`} aria-hidden="true" /> {STATE_CHIP[state]}
                      </>
                    ) : (
                      '…'
                    )}
                  </td>
                )
              })}
            </tr>
            {/* Each body's angle at landing, both ways: from a level horizon (the conventional figure) and above the skyline. */}
            {landingRows.map((row) => (
              <tr key={row.key}>
                <th scope="row" title={row.title}>
                  {row.label}
                </th>
                <RowCells row={row} />
              </tr>
            ))}
            <tr>
              <th scope="row">Fits the mission</th>
              {measures.map((measure, i) => (
                <td key={i} className={measure && measure.problems.length === 0 ? 'is-best sl-full-fit' : 'sl-full-fit'}>
                  {!measure ? '…' : measure.problems.length === 0 ? '✓ Yes' : `✗ No: ${measure.problems.join(' ')}`}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="sl-quiet">★ best in its row</p>

      <h3>Each mission from its own landing</h3>
      <p className="sl-quiet">Days since landing. Every row starts at its own landing, so two landings can be compared band for band.</p>
      <div className="sl-aligned">
        {scenarios.map((scenario, i) => {
          const flags = facts[i].flags
          const end = Math.min(scenario.landing + missionH, hours)
          return (
            <div key={i} className="sl-row sl-aligned-row" data-first-hour={scenario.landing} data-hours={end - scenario.landing}>
              <span className="sl-row-name" title={`${SCENARIO_LETTERS[i]} · ${facts[i].site.name}, from ${clockTime(start, scenario.landing)}`}>
                {SCENARIO_LETTERS[i]} · {facts[i].site.name}
              </span>
              <div className="sl-track">
                <svg viewBox={`0 0 ${missionH} 12`} preserveAspectRatio="none" aria-hidden="true">
                  {flags &&
                    stateRuns(flags, scenario.landing, end).map((run) => (
                      <rect key={run.from} className={`sl-run is-${run.state}`} x={run.from} y={BAND[run.state].y} width={run.to - run.from} height={BAND[run.state].height} />
                    ))}
                </svg>
              </div>
            </div>
          )
        })}
        <div className="sl-row sl-axis" aria-hidden="true">
          <span />
          <div className="sl-track">
            {Array.from({ length: Math.floor(mission.requirements.missionDays / step) + 1 }, (_, n) => n * step).map((day) => (
              // The numbers next to "landing" and to the last day are the first to go where the row is narrow.
              <span key={day} className={day === mission.requirements.missionDays ? 'is-end' : day === step || (day > 0 && day + step >= mission.requirements.missionDays) ? 'is-near' : undefined} style={{ left: `${(100 * day) / mission.requirements.missionDays}%` }}>
                {day === 0 ? 'landing' : day === mission.requirements.missionDays ? `day ${day}` : day}
              </span>
            ))}
          </div>
        </div>
        <p className="sl-legend">
          <i className="sl-key is-sun" /> Sun <i className="sl-key is-earth" /> Earth <i className="sl-key is-both" /> Both <i className="sl-key is-none" /> Neither
        </p>
      </div>
    </div>
  )
}
