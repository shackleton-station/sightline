import { useEffect, useState } from 'react'
import type { ShadowDistances } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { loadShadow } from '../data/loadSite'
import { shadowCell, shadowMeans } from '../lib/shadowWords'
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
  /** Start the short guide to this panel; null while a guide is already on. */
  onShowHow?: (() => void) | null
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
 * the next. The rows are the Planner's Compare table's own (`plannerRows`). Three folds, closed until
 * asked for, hold the rest: "More" (the Sun and Earth together, the sunlight on a panel), "At
 * landing" (the Sun's and Earth's angles) and "Science" (how far the site is from permanently
 * shadowed ground, in NASA's maps: not part of the verdict). The best value in a row is marked; there
 * is no blended score, because its weights would be invented.
 */
export function CompareDrawer({ start, scenarios, facts, mission, active, onSelect, onAdd, onClose, marginal: marginalOf, odds, oddsFor, landings, sunlightWm2, onFull, onShowHow = null }: Props) {
  const [more, setMore] = useState(false)
  const [atLanding, setAtLanding] = useState(false)
  // The third fold, "Science": what a science team asks of a site, beside the engineering rows. One row for
  // now: how far the site is from permanently shadowed ground, in NASA's maps. Its file is asked for when the
  // fold is first opened, and not before. It is not part of the verdict, and no value in it is marked best.
  const [science, setScience] = useState(false)
  const [shadow, setShadow] = useState<ShadowDistances | null>(null)
  useEffect(() => {
    if (!science || shadow) return
    let current = true
    loadShadow()
      .then((loaded) => current && setShadow(loaded))
      // Without it the row keeps waiting; the rest of the table does not depend on it.
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [science, shadow])
  // Each scenario's distance, as the row writes it; null where there is none to write (a custom point, or not loaded yet).
  const shade = facts.map(({ site }) => (shadow && !isCustomSite(site) && shadow.sites[site.id] ? shadowCell(shadow.sites[site.id].patch) : null))
  const noShade = science ? shade.flatMap((cell, i) => (cell?.explain ? [{ letter: SCENARIO_LETTERS[i], words: cell.words }] : [])) : []
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
        {onShowHow && (
          <button type="button" className="sl-link sl-show-how" onClick={onShowHow}>
            Show me how
          </button>
        )}
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
              <button type="button" className="sl-compare-fold" aria-expanded={science} title="What a science team asks of a site: how far it is from permanently shadowed ground" onClick={() => setScience(!science)}>
                Science
              </button>
            </th>
          </tr>
          {more && rows.filter((row) => MORE_ROWS.includes(row.key)).map((row) => <Row key={row.key} row={row} hoursPrinted={hoursPrinted} />)}
          {atLanding && landingRows(landings).map((row) => <Row key={row.key} row={row} hoursPrinted={hoursPrinted} />)}
          {science && (
            <tr className="sl-compare-science">
              <th scope="row" title={shadow ? shadowMeans(shadow) : undefined}>
                Shadowed ground, km
              </th>
              {shade.map((cell, i) => (
                <td key={i} title={cell ? `${facts[i].site.name}: ${cell.words}` : isCustomSite(facts[i].site) && shadow ? 'Not worked out for a custom point' : undefined}>
                  {cell ? cell.cell : shadow ? '?' : '…'}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      {noShade.length > 0 && (
        <ul className="sl-compare-why is-info sl-compare-shade">
          {noShade.map((one) => (
            <li key={one.letter}>
              <b>{one.letter}</b> permanently shadowed ground: {one.words}.
            </li>
          ))}
        </ul>
      )}
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
