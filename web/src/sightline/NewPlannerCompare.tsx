import type { TrackPoint } from '../data/contract'
import { LandingSky } from '../planner/LandingSky'
import { clockTime } from '../lib/sightline'
import { shortReason } from '../lib/sightlineSky'
import { type ScenarioMeasure, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { PlannerPower } from './PlannerPower'
import { PlannerSunChart } from './PlannerSunChart'
import type { ScenarioFacts } from './useScenarioFacts'

interface Props {
  start: string
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  measures: (ScenarioMeasure | null)[]
  /** Each pick's mission hour by hour, for the Sun chart and the power budget. */
  tracks: (TrackPoint[] | null | undefined)[]
  active: number
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  heightsNote: string | null
}

/** A landing hour of the data as ISO, to the hour. */
function isoAt(start: string, hour: number): string {
  return new Date(Date.parse(start) + hour * 3_600_000).toISOString().replace('.000Z', 'Z')
}

/**
 * Compare: your picks side by side, each column the landing brief's own picture of what matters
 * (whether it fits and why not, sunset and Earthset, power and radio over the mission, the mission
 * hour by hour, the Sun's height and the skyline), then the Sun's height for every pick on one scale
 * and a rough power budget. The columns line up row for row so the eye can run across them.
 */
export function NewPlannerCompare({ start, scenarios, facts, mission, measures, tracks, active, onSelect, onRemove, heightsNote }: Props) {
  if (scenarios.length < 2) {
    return (
      <div className="np-compare-empty" role="tabpanel" aria-label="Compare">
        <h3>Nothing to compare yet</h3>
        <p>Add a place and time on the left, or keep a landing from Find, and your picks line up here side by side (up to four).</p>
      </div>
    )
  }
  return (
    <div className="np-compare" role="tabpanel" aria-label="Compare">
      <div className="np-compare-cols" style={{ gridTemplateColumns: `repeat(${scenarios.length}, minmax(17rem, 1fr))` }}>
        {scenarios.map((scenario, i) => {
          const fact = facts[i]
          const measure = measures[i]
          const fits = measure ? measure.problems.length === 0 : null
          return (
            <article key={i} className={`pl-brief np-pick ${fits === false ? 'tight' : 'works'} ${i === active ? 'is-on-show' : ''}`} aria-label={`${SCENARIO_LETTERS[i]}: ${fact.site.name}`}>
              <header className="np-pick-head">
                <p className="np-pick-tag">
                  <span className="pl-sunrow-letter">{SCENARIO_LETTERS[i]}</span> {i === active ? 'On show' : 'Kept'}
                  <span className={`np-pick-fit ${fits ? 'fits' : 'misses'}`}>{fits === null ? '…' : fits ? '✓ Fits' : '✗ Misses'}</span>
                </p>
                <h3>{fact.site.name}</h3>
                <p className="np-pick-when">{clockTime(start, scenario.landing)}</p>
                {measure && measure.problems.length > 0 && <p className="np-pick-why">{measure.problems.map(shortReason).join(' · ')}</p>}
                <p className="np-pick-actions">
                  {i !== active && (
                    <button type="button" className="sl-small" onClick={() => onSelect(i)}>
                      Show
                    </button>
                  )}
                  {scenarios.length > 1 && (
                    <button type="button" className="sl-small" onClick={() => onRemove(i)}>
                      Remove
                    </button>
                  )}
                </p>
              </header>
              {fact.flags ? <LandingSky site={fact.site} flags={fact.flags} t={isoAt(start, scenario.landing)} requirements={mission.requirements} /> : <p className="sl-quiet">Working out {fact.site.name}…</p>}
            </article>
          )
        })}
      </div>
      <div className="np-compare-all">
        <PlannerSunChart rows={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i] }))} missionDays={mission.requirements.missionDays} />
        <PlannerPower columns={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i], sunGapH: measures[i]?.sunGapH ?? null }))} heightsNote={heightsNote} />
      </div>
    </div>
  )
}
