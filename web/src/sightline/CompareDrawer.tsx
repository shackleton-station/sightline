import { clockTime } from '../lib/sightline'
import { bestIn, COMPARE_ROWS, MAX_SCENARIOS, measureScenario, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import type { ScenarioFacts } from './useScenarioFacts'

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
  /** The odds (0 to 1) that a landing fits, for each scenario, once Landing accuracy has been used; null where not known. */
  odds?: (number | null)[]
  /** The accuracy those odds are for, in words: "250 m". */
  oddsFor?: string
}

/**
 * Compare: the scenarios side by side, each measured over its own mission. A short list says which
 * site and landing each letter is; the table holds bare numbers, with the unit in each row's name, so
 * four scenarios fit without scrolling sideways. The best value in a row is marked; there is no
 * blended score, because its weights would be invented.
 */
export function CompareDrawer({ start, scenarios, facts, mission, active, onSelect, onAdd, onClose, marginal: marginalOf, odds, oddsFor }: Props) {
  const measures = scenarios.map((scenario, i) => {
    const { site, flags, slopeDeg } = facts[i]
    return flags ? measureScenario(scenario, site, flags, mission, slopeDeg) : null
  })
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
          {COMPARE_ROWS.map((row) => {
            const values = measures.map((measure) => measure?.[row.key] ?? null)
            const best = bestIn(values, row.better, row.tie)
            return (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {values.map((value, i) => (
                  <td key={i} className={best[i] ? 'is-best' : undefined}>
                    {value === null ? (measures[i] ? '?' : '…') : value.toFixed(row.digits)}
                    {best[i] && (
                      <span className="sl-best" title="Best in this row">
                        {' '}
                        ★
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
          {odds?.some((one) => one !== null) && (
            <tr>
              <th scope="row">Landings that fit, %</th>
              {(() => {
                const best = bestIn(odds, 'high', 0.005)
                return odds.map((one, i) => (
                  <td key={i} className={best[i] ? 'is-best' : undefined}>
                    {one === null ? '–' : one > 0.99 && one < 1 ? '>99' : one < 0.01 && one > 0 ? '<1' : Math.round(100 * one)}
                    {best[i] && (
                      <span className="sl-best" title="Best in this row">
                        {' '}
                        ★
                      </span>
                    )}
                  </td>
                ))
              })()}
            </tr>
          )}
          <tr>
            <th scope="row">Fits the mission</th>            {measures.map((measure, i) => (
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
      <p className="sl-quiet">★ best in its row{odds?.some((one) => one !== null) && oddsFor ? `. Landings that fit: the odds of coming down where the mission fits, at ${oddsFor} accuracy` : ''}</p>
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
