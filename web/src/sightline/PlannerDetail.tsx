import { isBaseHeights } from '../lib/heights'
import { clockTime, degWords, isoAt } from '../lib/sightline'
import { type ScenarioMeasure, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { LandingSky } from '../planner/LandingSky'
import { PlannerCompareVisuals } from './PlannerCompareVisuals'
import { PlannerPower } from './PlannerPower'
import { PlannerSunChart } from './PlannerSunChart'
import { useMissionTracks } from './useMissionTracks'
import type { LandingShares, ScenarioFacts } from './useScenarioFacts'
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
  /** The Sun's and Earth's heights at each landing, at the mission's own heights above the ground; null while its month loads. */
  landings: (LandingShares | null)[]
  active: number
  onSelect: (index: number) => void
}

/** The Sun's height above a flat horizon, in words: "1.2° below a flat horizon", "5.8° above a flat horizon". */
function fromLevelWords(elDeg: number): string {
  return `${degWords(Math.abs(elDeg))} ${elDeg < 0 ? 'below' : 'above'} a flat horizon`
}

/**
 * Compare, in depth: under the table, the scenario on show read hour by hour from its landing (when
 * the Sun and Earth set and rise, the four figures of the mission, the mission's hours, the Sun's
 * height and the skyline), then, for every scenario, the Sun's height over its mission and a rough
 * power and battery budget, and last, folded, the missions played together and a battery hour by hour.
 *
 * One scenario's detail at a time: the one on show, chosen by its letter here or in its column.
 * Every part is the detailed planner's own component, imported as it is and drawn inside the wrapper
 * that gives it this screen's colors and type (`plannerHost.css`).
 */
export function PlannerDetail({ start, hours, scenarios, facts, mission, measures, landings, active, onSelect }: Props) {
  const tracks = useMissionTracks(
    start,
    hours,
    scenarios,
    facts.map((fact) => fact.site),
    mission.requirements.missionDays,
  )
  const scenario = scenarios[active]
  const fact = facts[active]
  // The Sun's height at landing, led by the figure the rest of the screen leads with: above the skyline.
  const at = landings[active]
  const track = tracks[active]
  const inView = track ? track.filter((point) => point.sun_up).map((point) => point.sun_el) : []
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
      {/* The Sun's height in the screen's own words: the height above the skyline leads, as everywhere else,
          and the other is said with what it is measured from. The imported part's own lines are left out. */}
      <div className="pl-detail-sun">
        <h4>The Sun’s height, for power</h4>
        <p className="pl-detail-main">{at ? `${degWords(Math.abs(at.sunAboveDeg))} ${at.sunAboveDeg < 0 ? 'below' : 'above'} the skyline at landing` : '…'}</p>
        {at && (
          <p className="pl-detail-small">
            {fromLevelWords(at.sunElDeg)}
            {at.sunElDeg < 0 && at.sunAboveDeg > 0 ? '; this high ground sees a little below level' : ''}
          </p>
        )}
        {inView.length > 0 && (
          <p className="pl-detail-small">
            While in view during the mission: from {fromLevelWords(Math.min(...inView))} to {fromLevelWords(Math.max(...inView))}
          </p>
        )}
      </div>
      <div className="plh planner plh-detail plh-all">
        <div className="plh-sunchart">
          <h4>The Sun’s height over each mission</h4>
          <p className="sl-quiet">Height above a flat horizon, which a panel’s power follows. Every row is on one scale and lined up on its own landing. Hover a row to read an hour.</p>
          <PlannerSunChart rows={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i] }))} missionDays={mission.requirements.missionDays} />
        </div>
        <div className="plh-power">
        <PlannerPower columns={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i], sunGapH: measures[i]?.sunGapH ?? null }))} heightsNote={null} />
          <p className="sl-quiet">
            A first estimate: a vertical panel turned to face the Sun, the mission’s own sunlight, and the load running through its longest time without Sun. It leaves out dust, temperature, battery depth of discharge and wiring losses, so a
            real design needs margin on top. ★ best of your scenarios.{heightsNote ? ` ${heightsNote}` : ''}
          </p>
        </div>
      </div>
      {/* Two more looks at every scenario's mission, each folded behind its heading until asked for. */}
      <PlannerCompareVisuals start={start} scenarios={scenarios} facts={facts} mission={mission} tracks={tracks} heightsNote={heightsNote} />
    </section>
  )
}
