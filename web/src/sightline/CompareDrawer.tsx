import { useState } from 'react'
import { clockTime } from '../lib/sightline'
import { bestIn, MAX_SCENARIOS, measureScenario, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
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
  /** The odds (0 to 1) that a landing fits, for each scenario, once Landing accuracy has been used; null where not known. */
  odds?: (number | null)[]
  /** The accuracy those odds are for, in words: "250 m". */
  oddsFor?: string
  /** Each scenario's landing hour, for the Sun's and Earth's angles; null while its month loads. */
  landings: (LandingShares | null)[]
  /** The average sunlight on a panel over each scenario's mission, in W/m²; undefined while its months load. */
  sunlightWm2: (number | null | undefined)[]
  /** Open the Planner on its Compare tab: the full comparison, with the whole window to work in. */
  onFull: () => void
}

/** With this many scenarios or fewer, a column is wide enough to print the hours behind a share under it. */
const HOURS_PRINTED_UP_TO = 2
/**
 * The rows folded under "More" with the angles at landing: figures worth having, but not ones the
 * verdict rests on, and with them shown four scenarios no longer fit a small laptop without scrolling.
 */
const MORE_ROWS = ['bothPct', 'sunlightWm2']
/** How each verdict is drawn in its column: a mark, with the words in its hover text. */
const VERDICT_MARK = { yes: '✓', marginal: '◇', no: '✕' } as const

/**
 * One row of the table: its name, then each scenario's figure, the best marked. The hours behind a
 * share ("302 of 336 h") are printed under it while the columns are wide enough, and are the
 * figure's hover text otherwise, so no cell ever holds more than its column can.
 */
function Row({ row, hoursPrinted }: { row: PlannerRow; hoursPrinted: boolean }) {
  return (
    <tr>
      <th scope="row" title={row.title}>
        {row.label}
      </th>
      {row.cells.map((cell, i) => (
        <td key={i} className={row.best[i] ? 'is-best' : undefined} title={!hoursPrinted && row.notes[i] ? row.notes[i] : undefined}>
          {cell ?? '…'}
          {row.best[i] && (
            <span className="sl-best" title="Best in this row">
              {' '}
              ★
            </span>
          )}
          {hoursPrinted && row.notes[i] && <small> {row.notes[i]}</small>}
        </td>
      ))}
    </tr>
  )
}

/**
 * Compare: the scenarios side by side, each measured over its own mission. This panel is the short
 * comparison; the Planner's Compare tab is the full one, and the panel ends with a link to it.
 *
 * A short list says which site and landing each letter is. The table's first row is the verdict, a
 * mark for each scenario with the words in its hover text (the lists under the table say the rest).
 * Then come bare numbers, with the unit in each row's name: the name column is wide enough for two
 * lines and wraps, and one to four scenarios share the rest equally, so nothing in a cell can reach
 * the next. The rows are the Planner's Compare table's own (`plannerRows`). Two folds, closed until
 * asked for, hold the rest: "More" (the Sun and Earth together, the sunlight on a panel) and "At
 * landing" (the Sun's and Earth's angles). The best value in a row is marked; there
 * is no blended score, because its weights would be invented.
 */
export function CompareDrawer({ start, scenarios, facts, mission, active, onSelect, onAdd, onClose, marginal: marginalOf, odds, oddsFor, landings, sunlightWm2, onFull }: Props) {
  const [more, setMore] = useState(false)
  const [atLanding, setAtLanding] = useState(false)
  const hoursPrinted = scenarios.length <= HOURS_PRINTED_UP_TO
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
        <colgroup>
          <col className="sl-compare-names" />
          {scenarios.map((_, i) => (
            <col key={i} />
          ))}
        </colgroup>
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
          <tr className="sl-compare-verdict">
            <th scope="row">Fits the mission</th>
            {measures.map((measure, i) => {
              if (!measure) return <td key={i}>…</td>
              const verdict = measure.problems.length > 0 ? 'no' : marginalOf[i].length > 0 ? 'marginal' : 'yes'
              const words = verdict === 'no' ? `Does not fit: ${measure.problems.join(' ')}` : verdict === 'marginal' ? `Fits, marginal: ${marginalOf[i].join(', and ')}` : 'Fits the mission'
              return (
                <td key={i} className={`is-${verdict}`} title={words} aria-label={words} data-verdict={verdict}>
                  {VERDICT_MARK[verdict]}
                </td>
              )
            })}
          </tr>
          {rows
            .filter((row) => !MORE_ROWS.includes(row.key))
            .map((row) => (
              <Row key={row.key} row={row} hoursPrinted={hoursPrinted} />
            ))}
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
          <tr className="sl-compare-group">
            <th scope="row" colSpan={scenarios.length + 1}>
              <button type="button" className="sl-compare-fold" aria-expanded={more} title="Sun and Earth together, and the sunlight on a panel" onClick={() => setMore(!more)}>
                More
              </button>
              <button type="button" className="sl-compare-fold" aria-expanded={atLanding} title="The Sun's and Earth's angles at each landing" onClick={() => setAtLanding(!atLanding)}>
                At landing
              </button>
            </th>
          </tr>
          {more && rows.filter((row) => MORE_ROWS.includes(row.key)).map((row) => <Row key={row.key} row={row} hoursPrinted={hoursPrinted} />)}
          {atLanding && landingRows(landings).map((row) => <Row key={row.key} row={row} hoursPrinted={hoursPrinted} />)}
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
      <div className="sl-compare-actions">
        {scenarios.length < MAX_SCENARIOS && (
          <button type="button" className="sl-small" onClick={onAdd}>
            Add this view as scenario {SCENARIO_LETTERS[scenarios.length]}
          </button>
        )}
        <button type="button" className="sl-link sl-compare-full" title="Open the Planner on its Compare tab: every row, with the hours behind each share" onClick={onFull}>
          Full comparison ›
        </button>
      </div>
    </aside>
  )
}
