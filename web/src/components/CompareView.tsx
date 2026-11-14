import type { SiteInfo } from '../data/contract'
import type { ScenarioData } from '../data/loadSite'
import type { Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import { combineDomains, panoramaDomain } from '../lib/panorama'
import type { Scenario } from '../lib/scenario'
import { CompareTable } from './CompareTable'
import { MissionInputs } from './MissionInputs'
import { ScenarioColumn } from './ScenarioColumn'

interface Props {
  sites: SiteInfo[]
  scenarioA: Scenario
  scenarioB: Scenario
  dataA: ScenarioData | null
  dataB: ScenarioData | null
  index: number
  requirements: Requirements
  mode: Mode
  onScenarioA: (scenario: Scenario) => void
  onScenarioB: (scenario: Scenario) => void
  onIndex: (index: number) => void
  onRequirements: (value: Requirements) => void
}

/** Two scenarios side by side, on one time slider and one elevation scale. */
export function CompareView({
  sites,
  scenarioA,
  scenarioB,
  dataA,
  dataB,
  index,
  requirements,
  mode,
  onScenarioA,
  onScenarioB,
  onIndex,
  onRequirements,
}: Props) {
  const domain =
    dataA && dataB
      ? combineDomains(panoramaDomain(dataA.horizon, dataA.track), panoramaDomain(dataB.horizon, dataB.track))
      : undefined
  const column = { sites, index, onIndexChange: onIndex, domain, requirements, mode }
  return (
    <>
      {mode === 'plan' && <MissionInputs value={requirements} onChange={onRequirements} />}
      {dataA && dataB && <CompareTable a={dataA} b={dataB} />}
      {dataA && dataB && (
        <p className="note">
          Thin lines: full paths this month. Filled marker: up. Hollow marker: blocked by terrain. Both
          panoramas use the same vertical scale. "Too close" uses errors measured on 18.6-year averages against
          NASA's maps. Single months have no such check, so treat small differences with care.
        </p>
      )}
      <div className="columns comparing">
        <ScenarioColumn {...column} title="Scenario A" scenario={scenarioA} onChange={onScenarioA} data={dataA} />
        <ScenarioColumn {...column} title="Scenario B" scenario={scenarioB} onChange={onScenarioB} data={dataB} />
      </div>
    </>
  )
}
