import { isBaseHeights } from '../lib/heights'
import { clockTime, isoAt } from '../lib/sightline'
import { type ScenarioMeasure, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { LandingSky } from '../planner/LandingSky'
import { PlannerPower } from './PlannerPower'
import { PlannerSunChart } from './PlannerSunChart'
import { useMissionTracks } from './useMissionTracks'
import type { ScenarioFacts } from './useScenarioFacts'
import './plannerHost.css'

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  /** Each scenario measured against the mission; null while its site is being worked out. */
  measures: (ScenarioMeasure | null)[]
  active: number
  onSelect: (index: number) => void
}

/**
 * Compare, in depth: under the table, the scenario on show read hour by hour from its landing (when
 * the Sun and Earth set and rise, the four figures of the mission, the mission's hours, the Sun's
 * height and the skyline), then, for every scenario, the Sun's height over its mission and a rough
 * power and battery budget.
 *
 * One scenario's detail at a time: the one on show, chosen by its letter here or in its column.
 * Every part is the detailed planner's own component, imported as it is and drawn inside the wrapper
 * that gives it this screen's colors and type (`plannerHost.css`).
 */
export function PlannerDetail({ start, hours, scenarios, facts, mission, measures, active, onSelect }: Props) {
  const tracks = useMissionTracks(
    start,
    hours,
    scenarios,
    facts.map((fact) => fact.site),
    mission.requirements.missionDays,
  )
  const scenario = scenarios[active]
  const fact = facts[active]
  // The Sun chart and the power budget read the app's own 2 m track; the longest dark is at the mission's heights.
  const heightsNote = isBaseHeights(mission.heights) ? null : "The Sun's height and the sunlight are read at 2 m above the ground; the longest dark is at your panel's height."
  return (
    <section className="pl-detail" aria-label="The scenario on show, in depth" data-scenario={SCENARIO_LETTERS[active]}>
      <header className="pl-detail-head">
        <h3>
          Scenario {SCENARIO_LETTERS[active]} in depth
          <small>
            {fact.site.name} · {clockTime(start, scenario.landing)}
          </small>
        </h3>
        {scenarios.length > 1 && (
          <span className="pl-detail-pick" role="group" aria-label="Which scenario to read in depth">
            {scenarios.map((_, i) => (
              <button key={i} type="button" className="sl-small" aria-pressed={i === active} aria-label={`Scenario ${SCENARIO_LETTERS[i]} in depth`} onClick={() => onSelect(i)}>
                {SCENARIO_LETTERS[i]}
              </button>
            ))}
          </span>
        )}
      </header>
      <div className="plh planner pl-brief plh-detail plh-sky">
        {fact.flags ? <LandingSky site={fact.site} flags={fact.flags} t={isoAt(start, scenario.landing)} requirements={mission.requirements} /> : <p className="sl-quiet">Working out {fact.site.name}…</p>}
      </div>
      <div className="plh planner plh-detail plh-all">
        <PlannerSunChart rows={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i] }))} missionDays={mission.requirements.missionDays} />
        <PlannerPower columns={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i], sunGapH: measures[i]?.sunGapH ?? null }))} heightsNote={heightsNote} />
      </div>
    </section>
  )
}
