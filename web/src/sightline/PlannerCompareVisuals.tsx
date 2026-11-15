import type { TrackPoint } from '../data/contract'
import { isoAt } from '../lib/sightline'
import { SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { MissionCharts } from './MissionCharts'
import { MissionPlayback } from './MissionPlayback'
import { PlannerFold } from './PlannerFold'
import { useHorizons } from './useMissionTracks'
import type { ScenarioFacts } from './useScenarioFacts'

interface Props {
  start: string
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  /** Each scenario's mission hour by hour from its landing; undefined while it loads, null if it failed. */
  tracks: (TrackPoint[] | null | undefined)[]
  /** Set when the mission's heights aren't 2 m: the hour-by-hour track is read at 2 m. */
  heightsNote: string | null
}

/** The playback with the skylines it needs. Mounted only while its fold is open, so the skylines are read then. */
function Playback({ start, scenarios, facts, mission, tracks }: Omit<Props, 'heightsNote'>) {
  const horizons = useHorizons(
    start,
    scenarios,
    facts.map((fact) => fact.site),
  )
  return (
    <MissionPlayback
      picks={scenarios.map((scenario, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, flags: facts[i].flags, t: isoAt(start, scenario.landing), track: tracks[i], horizon: horizons[i] }))}
      requirements={mission.requirements}
    />
  )
}

/**
 * Compare's two moving pictures of every scenario's mission, each folded behind its heading: the
 * skylines played together from landing to the last day, and a battery hour by hour for a panel,
 * load and battery the visitor sets. Both are the detailed planner's own components, imported as
 * they are. The second also draws the Sun's height and the Sun and Earth bands, which Compare
 * already shows above, so the wrapper leaves those two out (`plannerHost.css`).
 */
export function PlannerCompareVisuals({ start, scenarios, facts, mission, tracks, heightsNote }: Props) {
  return (
    <div className="plh planner sl-np plh-folds">
      <PlannerFold id="playback" title="Watch the missions" hint="Every scenario’s skyline from landing to the last day, with the Sun and Earth moving.">
        <Playback start={start} scenarios={scenarios} facts={facts} mission={mission} tracks={tracks} />
      </PlannerFold>
      <PlannerFold id="battery" title="A battery through each mission" hint="Hour by hour, for a panel, a load and a battery you set.">
        <div className="plh-battery">
          <MissionCharts picks={scenarios.map((scenario, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, flags: facts[i].flags, t: isoAt(start, scenario.landing), track: tracks[i] }))} requirements={mission.requirements} heightsNote={heightsNote} />
        </div>
      </PlannerFold>
    </div>
  )
}
