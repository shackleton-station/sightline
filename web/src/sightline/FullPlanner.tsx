import { isCustomSite } from '../data/customSite'
import { useMemo } from 'react'
import type { SiteInfo, Summary } from '../data/contract'
import type { FlaggedSite } from '../data/useAllFlags'
import { monthSpans } from '../lib/grid'
import { measureScenario, missionWords, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { Mascot } from '../scout/Mascot'
import { HeaderTools } from './HeaderTools'
import { AdvancedControls, MissionControls } from './MissionDrawer'
import { PlannerCompare } from './PlannerCompare'
import { PlannerFind } from './PlannerFind'
import type { PlannerTab } from './plannerFit'
import { plannerCsv, plannerRows } from './plannerTable'
import { ScenarioTabs } from './Scenarios'
import type { LandingShares, ScenarioFacts } from './useScenarioFacts'
import './planner.css'

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
  /** The tray's "+": add what is on the main screen, as there. */
  onAddShown: () => void
  onRemove: (index: number) => void
  onBack: () => void
  /** Which tab is open; the link holds it. */
  tab: PlannerTab
  onTab: (tab: PlannerTab) => void
  /** Open the written brief for the scenario on show, as the main screen does. */
  onBrief: () => void
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

const TABS: { id: PlannerTab; label: string; title: string }[] = [
  { id: 'find', label: 'Find', title: 'Where and when could I land? Every site, month by month' },
  { id: 'compare', label: 'Compare', title: 'Which of my picks is best? The scenarios side by side' },
]

/**
 * The Planner: the same scenarios and the same mission, with room to work. Mission limits down the
 * left for both tabs. Find is every site by month, where a cell adds a scenario; Compare is the
 * scenarios side by side. The Moon stays as a small live view in the corner (drawn by the screen,
 * not here), and is itself a way back.
 */
export function FullPlanner({ start, hours, flagged, scenarios, facts, mission, onMission, active, onSelect, onAdd, onAddShown, onRemove, onBack, tab, onTab, onBrief, scoutOpen, onScout, site, month, year, summary, landings }: Props) {
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
  const spans = useMemo(() => monthSpans(start, hours), [start, hours])

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
      <header className="sl-full-head pl-head">
        <button type="button" className="sl-small pl-back" title="Back to the Moon (Esc)" onClick={onBack}>
          ‹ Moon
        </button>
        <h2>Planner</h2>
        <div className="pl-tabs" role="tablist" aria-label="Planner">
          {TABS.map((one) => (
            <button key={one.id} type="button" role="tab" aria-selected={one.id === tab} title={one.title} onClick={() => onTab(one.id)}>
              {one.label}
            </button>
          ))}
        </div>
        <ScenarioTabs count={scenarios.length} active={active} onSelect={onSelect} onAdd={onAddShown} onRemove={onRemove} />
        <span className="pl-tools">
          <button type="button" className="sl-small" title="The written brief for the scenario on show" onClick={onBrief}>
            Brief
          </button>
          <HeaderTools onBrief={onBrief} />
          <button type="button" className="sl-small" title="The Compare table as a CSV file" onClick={exportTable}>
            Export
          </button>
          <button type="button" className="sl-small sl-rail-scout" aria-pressed={scoutOpen} title="Ask Scout about these scenarios" onClick={onScout}>
            <Mascot state={null} size={16} /> Scout
          </button>
        </span>
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
          {tab === 'find' ? (
            <PlannerFind start={start} flagged={flagged} spans={spans} year={year} mission={mission} onMission={onMission} count={scenarios.length} onAdd={onAdd} />
          ) : (
            <PlannerCompare start={start} hours={hours} scenarios={scenarios} facts={facts} mission={mission} measures={measures} rows={rows} active={active} onSelect={onSelect} onRemove={onRemove} landings={landings} />
          )}
        </div>
      </div>
    </section>
  )
}
