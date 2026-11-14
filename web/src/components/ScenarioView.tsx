import type { ScenarioData } from '../data/loadSite'
import { useSiteFlags } from '../data/useSiteFlags'
import { meanSunElevationUp } from '../lib/compare'
import type { Requirements } from '../lib/mission'
import { monthLabel } from '../lib/months'
import { panelSunlight } from '../lib/power'
import { HorizonPanorama } from './HorizonPanorama'
import { AnswerCard } from './AnswerCard'
import type { Mode } from '../lib/mode'
import { MissionCheck } from './MissionCheck'
import { SummaryCard } from './SummaryCard'
import { Timeline } from './Timeline'
import { TrustNotes } from './TrustNotes'

interface Props {
  data: ScenarioData
  index: number
  onIndexChange: (index: number) => void
  domain?: [number, number]
  requirements: Requirements
  mode: Mode
  onJump: (month: string, index: number) => void
}

/** Everything about one site in one month, for one side of a comparison. */
export function ScenarioView({ data, index, onIndexChange, domain, requirements, mode, onJump }: Props) {
  const { site, month, horizon, track, summary } = data
  const clamped = Math.min(index, track.length - 1)
  const flags = useSiteFlags(site)
  const plan = mode === 'plan'
  return (
    <div className="scenario">
      <section>
        <AnswerCard data={data} index={clamped} flags={flags} requirements={requirements} mode={mode} />
        <h2>
          Horizon from {site.name}, {monthLabel(month)}
        </h2>
        <HorizonPanorama horizon={horizon} track={track} index={clamped} domain={domain} />
      </section>
      {plan && (
        <div className="scenario-wide">
          <MissionCheck data={data} index={clamped} requirements={requirements} onJump={onJump} />
        </div>
      )}
      <section>
        <h2>When each is up</h2>
        <Timeline summary={summary} track={track} index={clamped} onSelect={onIndexChange} />
      </section>
      <section>
        <SummaryCard
          summary={summary}
          meanSunElevationDeg={meanSunElevationUp(data)}
          sunlight={panelSunlight(track)}
          plan={plan}
        />
        {plan && (
          <>
            <h3>How far to trust this</h3>
            <TrustNotes data={data} />
          </>
        )}
      </section>
    </div>
  )
}
