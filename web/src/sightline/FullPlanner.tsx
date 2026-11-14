import { isCustomSite } from '../data/customSite'
import { useMemo, useState } from 'react'
import type { SiteInfo, Summary } from '../data/contract'
import type { FlaggedSite } from '../data/useAllFlags'
import { monthSpans, shadePct } from '../lib/grid'
import { clockTime, degWords, stateAt, stateRuns } from '../lib/sightline'
import { MAX_SCENARIOS, measureScenario, missionWords, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { Mascot } from '../scout/Mascot'
import { AdvancedControls, MissionControls } from './MissionDrawer'
import { plannerCsv, plannerRows, sunMonths, yearSpans } from './plannerTable'
import { BAND, STATE_CHIP } from './states'
import type { LandingShares, ScenarioFacts } from './useScenarioFacts'

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  /** Every listed site with its hourly flags, for the month grid. */
  flagged: FlaggedSite[]
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  onMission: (mission: SightlineMission) => void
  active: number
  onSelect: (index: number) => void
  /** Add a scenario and show it. With four already, nothing is added. */
  onAdd: (scenario: SightlineScenario) => void
  onRemove: (index: number) => void
  onBack: () => void
  /** Scout's panel opens beside the table, on the right. */
  scoutOpen: boolean
  onScout: () => void
  /** The scenario on show: its site, and its landing's month, year and summary, for the notes under Advanced. */
  site: SiteInfo
  month: string
  year: number
  summary: Summary | null
  /** Each scenario's landing hour, for the Sun's and Earth's elevations; null while its month loads. */
  landings: (LandingShares | null)[]
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Above this shade a grid cell's text turns dark to keep its contrast on the gold. */
const DARK_INK_FROM_PCT = 55

/** How many days apart the labels under the aligned rows are, so about ten fit. */
function dayStep(missionDays: number): number {
  return Math.max(1, Math.ceil(missionDays / 10))
}

/**
 * The Planner: the same scenarios and the same mission, with room to work. Mission limits down
 * the left; then the scenarios side by side with every row the app can measure, one time row per
 * scenario lined up on its own landing, and every site by month for a year, where a cell adds a
 * scenario. The Moon stays as a small live view in the corner (drawn by the screen, not here).
 */
export function FullPlanner({ start, hours, flagged, scenarios, facts, mission, onMission, active, onSelect, onAdd, onRemove, onBack, scoutOpen, onScout, site, month, year, summary, landings }: Props) {
  const measures = scenarios.map((scenario, i) => {
    const { site: at, flags, slopeDeg } = facts[i]
    return flags ? measureScenario(scenario, at, flags, mission, slopeDeg) : null
  })
  const rows = plannerRows(
    scenarios,
    measures,
    facts.map((fact) => fact.flags),
    mission,
  )
  const missionH = mission.requirements.missionDays * 24
  const step = dayStep(mission.requirements.missionDays)

  const spans = useMemo(() => monthSpans(start, hours), [start, hours])
  const years = useMemo(() => [...new Set(spans.map((span) => Number(span.month.slice(0, 4))))], [spans])
  const [gridYear, setGridYear] = useState(year)
  const shown = useMemo(() => yearSpans(spans, gridYear), [spans, gridYear])
  const room = scenarios.length < MAX_SCENARIOS

  const exportTable = () => {
    const csv = plannerCsv(
      start,
      scenarios,
      facts.map((fact) => fact.site.name),
      rows,
      measures,
      missionWords(mission),
    )
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'sightline-scenarios.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="sl-full" aria-label="Planner">
      <header className="sl-full-head">
        <h2>Planner</h2>
        <button type="button" className="sl-small sl-rail-scout" aria-pressed={scoutOpen} title="Ask Scout about these scenarios" onClick={onScout}>
          <Mascot state={null} size={16} /> Scout
        </button>
        <button type="button" className="sl-small" title="The table below as a CSV file" onClick={exportTable}>
          Export table
        </button>
        <button type="button" className="sl-small sl-full-back" title="Back to the Moon (Esc)" onClick={onBack}>
          Back to the Moon
        </button>
      </header>
      <div className="sl-full-body">
        <div className="sl-full-mission">
          <h3>Mission</h3>
          <MissionControls mission={mission} onMission={onMission} />
          <h3>Advanced</h3>
          <AdvancedControls
            mission={mission}
            onMission={onMission}
            site={site}
            month={month}
            year={year}
            summary={summary}
            heightChoice={{ off: isCustomSite(site) ? 'A custom point is worked out at 2 m only.' : null }}
          />
        </div>

        <div className="sl-full-main">
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
                    <th scope="row">{row.label}</th>
                    {row.cells.map((cell, i) => (
                      <td key={i} className={row.best[i] ? 'is-best' : undefined}>
                        {cell ?? '…'}
                        {row.best[i] && (
                          <span className="sl-best" title="Best in this row">
                            {' '}
                            ★
                          </span>
                        )}
                      </td>
                    ))}
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
                {/* The conventional figures, measured from a level horizon (the column gives height above the skyline instead). Units in the row's name, as in the rows above. */}
                <tr>
                  <th scope="row" title="At landing, measured from a level horizon. The column gives height above the skyline instead.">
                    Sun's elevation, °
                  </th>
                  {landings.map((landing, i) => (
                    <td key={i}>{landing ? degWords(landing.sunElDeg).replace('°', '') : '…'}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" title="At landing, measured from a level horizon. The column gives height above the skyline instead.">
                    Earth's elevation, °
                  </th>
                  {landings.map((landing, i) => (
                    <td key={i}>{landing ? degWords(landing.earthElDeg).replace('°', '') : '…'}</td>
                  ))}
                </tr>
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

          <h3>
            Every site, month by month{' '}
            <select aria-label="Year" value={gridYear} onChange={(event) => setGridYear(Number(event.target.value))}>
              {years.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          </h3>
          <p className="sl-quiet">
            Share of each month with the Sun in view, in percent. {room ? 'Choose a cell to add that site and month as a scenario.' : 'Four scenarios at most: remove one to add another.'}
          </p>
          <div className="sl-full-scroll">
            <table className="sl-full-grid">
              <thead>
                <tr>
                  <td />
                  {shown.map((span) => (
                    <th key={span.month} scope="col">
                      {MONTH_NAMES[Number(span.month.slice(5)) - 1]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flagged.map(({ site: listed, flags }) => (
                  <tr key={listed.id}>
                    <th scope="row">{listed.name}</th>
                    {sunMonths(flags, shown).map((cell) => {
                      const shade = shadePct(cell.share, 1, 'sun')
                      const name = `${MONTH_NAMES[Number(cell.month.slice(5)) - 1]} ${cell.month.slice(0, 4)}`
                      return (
                        <td key={cell.month}>
                          <button
                            type="button"
                            className={shade > DARK_INK_FROM_PCT ? 'is-dark-ink' : undefined}
                            style={{ background: `rgb(233 180 76 / ${(0.85 * shade).toFixed(0)}%)` }}
                            disabled={!room}
                            data-site={listed.id}
                            data-month={cell.month}
                            aria-label={`${listed.name}, ${name}: the Sun is in view ${cell.text}% of the month.${room ? ' Add as a scenario.' : ''}`}
                            onClick={() => onAdd({ site: listed.id, landing: cell.firstHour })}
                          >
                            {cell.text}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
