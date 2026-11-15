import { isBaseHeights } from '../lib/heights'
import { type ScenarioMeasure, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { NewPlannerCompare } from './NewPlannerCompare'
import { PicksScorecard } from './PicksScorecard'
import { useHorizons, useMissionTracks } from './useMissionTracks'
import type { ScenarioFacts } from './useScenarioFacts'
import './newPlanner.css'

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  measures: (ScenarioMeasure | null)[]
  active: number
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  /** The scorecard alone (above the Planner's table), or the rest (under it). */
  part: 'glance' | 'rest'
}

/**
 * The New Planner's Compare under the Planner's table: a scorecard for every objective, the missions
 * played out side by side, each scenario in full, then the Sun's height, a battery through the mission
 * and the Sun and Earth windows on one time axis. The same component as the New Planner's, set in an
 * inset wrapper so its styles apply without the New Planner's page layout.
 */
export function PlannerCompareMore({ start, hours, scenarios, facts, mission, measures, active, onSelect, onRemove, part }: Props) {
  const sites = facts.map((fact) => fact.site)
  const tracks = useMissionTracks(start, hours, scenarios, sites, mission.requirements.missionDays)
  const horizons = useHorizons(start, scenarios, sites)
  const heightsNote = isBaseHeights(mission.heights) ? null : "The Sun's height and the sunlight are read at 2 m above the ground; the longest dark is at your panel's height."
  if (part === 'glance') {
    return (
      <div className="sl-np is-inset is-glance">
        <PicksScorecard rows={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, measure: measures[i], track: tracks[i] }))} mission={mission} active={active} onSelect={onSelect} />
      </div>
    )
  }
  return (
    <div className="sl-np is-inset">
      <NewPlannerCompare start={start} scenarios={scenarios} facts={facts} mission={mission} measures={measures} tracks={tracks} horizons={horizons} active={active} onSelect={onSelect} onRemove={onRemove} heightsNote={heightsNote} full={false} glance={false} />
    </div>
  )
}
