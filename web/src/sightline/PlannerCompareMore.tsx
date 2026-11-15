import { isBaseHeights } from '../lib/heights'
import type { ScenarioMeasure, SightlineMission, SightlineScenario } from '../lib/sightlineMission'
import { NewPlannerCompare } from './NewPlannerCompare'
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
}

/**
 * The New Planner's Compare under the Planner's table: a scorecard for every objective, the missions
 * played out side by side, each scenario in full, then the Sun's height, a battery through the mission
 * and the Sun and Earth windows on one time axis. The same component as the New Planner's, set in an
 * inset wrapper so its styles apply without the New Planner's page layout.
 */
export function PlannerCompareMore({ start, hours, scenarios, facts, mission, measures, active, onSelect, onRemove }: Props) {
  const sites = facts.map((fact) => fact.site)
  const tracks = useMissionTracks(start, hours, scenarios, sites, mission.requirements.missionDays)
  const horizons = useHorizons(start, scenarios, sites)
  const heightsNote = isBaseHeights(mission.heights) ? null : "The Sun's height and the sunlight are read at 2 m above the ground; the longest dark is at your panel's height."
  return (
    <div className="sl-np is-inset">
      <NewPlannerCompare start={start} scenarios={scenarios} facts={facts} mission={mission} measures={measures} tracks={tracks} horizons={horizons} active={active} onSelect={onSelect} onRemove={onRemove} heightsNote={heightsNote} />
    </div>
  )
}
