import { clockTime } from '../lib/sightline'
import { MAX_SCENARIOS, measureScenario, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { landingRows, type PlannerRow, plannerRows } from './plannerTable'
import type { LandingShares, ScenarioFacts } from './useScenarioFacts'

interface Props {
  start: string
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  active: number
  onSelect: (index: number) => void
  /** Add what is on screen (the active site, at the time on screen) as a new scenario. */
  onAdd: () => void
  onClose: () => void
  /** Why each scenario, if it fits, is only a marginal fit: one line each; empty when it is not. */
  marginal: string[][]
  /** Each scenario's landing hour, for the Sun's and Earth's angles; null while its month loads. */
  landings: (LandingShares | null)[]
  /** The average sunlight on a panel over each scenario's mission, in W/m²; undefined while its months load. */
  sunlightWm2: (number | null | undefined)[]
}

/** One row of the table: its name, then each scenario's figure, the best marked, and the hours under a share. */
function Row({ row }: { row: PlannerRow }) {
  return (
    <tr>
      <th scope="row" title={row.title}>
        {row.label}
      </th>
      {row.cells.map((cell, i) => (
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
      ))}
    </tr>
  )
}

/**
 * Compare: the scenarios side by side, each measured over its own mission. A short list says which
 * site and landing each letter is; the table holds bare numbers, with the unit in each row's name, so
 * four scenarios fit without scrolling sideways. Under a share of the mission are the hours behind it
 * ("12 of 24 h"). The rows are the Planner's Compare table's own (`plannerRows`), then the Sun's and
 * Earth's angles at each landing. The best value in a row is marked; there is no blended score,
 * because its weights would be invented.
 */
export function CompareDrawer({ start, scenarios, facts, mission, active, onSelect, onAdd, onClose, marginal: marginalOf, landings, sunlightWm2 }: Props) {
  const measures = scenarios.map((scenario, i) => {
    const { site, flags, slopeDeg } = facts[i]
    return flags ? measureScenario(scenario, site, flags, mission, slopeDeg) : null
  })
  const rows = plannerRows(
    scenarios,
    measures,
    facts.map((fact) => fact.flags),
    mission,
    sunlightWm2,
  )
  const marginal = measures.flatMap((measure, i) => {
    const words = measure && measure.problems.length === 0 ? marginalOf[i] : []
    return words.length > 0 ? [{ letter: SCENARIO_LETTERS[i], words: words.join(', and ') }] : []
  })
  const misses = measures.flatMap((measure, i) => (measure && measure.problems.length > 0 ? [{ letter: SCENARIO_LETTERS[i], problems: measure.problems }] : []))

  return (
    <aside className="sl-drawer sl-compare" aria-label="Compare scenarios">
      <header className="sl-drawer-head">
        <h2>Compare</h2>
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      <ul className="sl-compare-legend">
        {scenarios.map((scenario, i) => (
          <li key={i}>
            <button type="button" className="sl-small" aria-pressed={i === active} aria-label={`Scenario ${SCENARIO_LETTERS[i]}`} onClick={() => onSelect(i)}>
              {SCENARIO_LETTERS[i]}
            </button>
            <span>
              {facts[i].site.name}
              <small>{clockTime(start, scenario.landing)}</small>
            </span>
          </li>
        ))}
      </ul>
      <table>
        <caption>Over the {mission.requirements.missionDays}-day mission</caption>
        <thead>
          <tr>
            <td />
            {scenarios.map((_, i) => (
              <th key={i} scope="col">
                {SCENARIO_LETTERS[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.key} row={row} />
          ))}
          <tr className="sl-compare-group">
            <th scope="row" colSpan={scenarios.length + 1}>
              At landing
            </th>
          </tr>
          {landingRows(landings).map((row) => (
            <Row key={row.key} row={row} />
          ))}
          <tr>
            <th scope="row">Fits the mission</th>
            {measures.map((measure, i) => (
              <td key={i} className={measure && measure.problems.length === 0 ? 'is-best' : undefined}>
                {!measure ? '…' : measure.problems.length > 0 ? '✗ No' : marginalOf[i].length > 0 ? '✓ Marginal' : '✓ Yes'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {marginal.length > 0 && (
        <ul className="sl-compare-why is-info">
          {marginal.map((one) => (
            <li key={one.letter}>
              <b>{one.letter}</b> fits, marginal: {one.words}.
            </li>
          ))}
        </ul>
      )}
      {misses.length > 0 && (
        <ul className="sl-compare-why">
          {misses.map((miss) => (
            <li key={miss.letter}>
              <b>{miss.letter}</b> does not fit: {miss.problems.join(' ')}
            </li>
          ))}
        </ul>
      )}
      <p className="sl-quiet">★ best in its row</p>
      {scenarios.length < MAX_SCENARIOS && (
        <div className="sl-compare-actions">
          <button type="button" className="sl-small" onClick={onAdd}>
            Add this view as scenario {SCENARIO_LETTERS[scenarios.length]}
          </button>
        </div>
      )}
    </aside>
  )
}
