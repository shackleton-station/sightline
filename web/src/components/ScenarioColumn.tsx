import type { SiteInfo } from '../data/contract'
import type { ScenarioData } from '../data/loadSite'
import type { Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import type { Scenario } from '../lib/scenario'
import { MoonMap } from './MoonMap'
import { ScenarioPicker } from './ScenarioPicker'
import { ScenarioView } from './ScenarioView'
import { Section } from './Section'
import { YearStrip } from './YearStrip'

interface Props {
  title: string
  sites: SiteInfo[]
  scenario: Scenario
  onChange: (scenario: Scenario) => void
  data: ScenarioData | null
  index: number
  onIndexChange: (index: number) => void
  domain?: [number, number]
  requirements: Requirements
  mode: Mode
}

/** One side of a comparison: its controls and its view. */
export function ScenarioColumn({
  title,
  sites,
  scenario,
  onChange,
  data,
  index,
  onIndexChange,
  domain,
  requirements,
  mode,
}: Props) {
  return (
    <div className="column">
      <h2 className="column-title">{title}</h2>
      <ScenarioPicker sites={sites} scenario={scenario} onChange={onChange} />
      <Section title="Map of landing sites">
        <MoonMap
          sites={sites}
          scenario={scenario}
          onChange={onChange}
          now={data ? data.track[Math.min(index, data.track.length - 1)] : null}
        />
      </Section>
      {data && (
        <>
          <YearStrip
            year={data.year}
            month={scenario.month}
            onSelect={(month) => onChange({ ...scenario, month })}
          />
          <ScenarioView
            data={data}
            index={index}
            onIndexChange={onIndexChange}
            domain={domain}
            requirements={requirements}
            mode={mode}
            onJump={(month, target) => {
              onChange({ ...scenario, month })
              onIndexChange(target)
            }}
          />
        </>
      )}
    </div>
  )
}
