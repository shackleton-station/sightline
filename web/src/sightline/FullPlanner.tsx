import { isCustomSite } from '../data/customSite'
import { useMemo } from 'react'
import type { SiteInfo, Summary } from '../data/contract'
import type { FlaggedSite } from '../data/useAllFlags'
import { monthSpans } from '../lib/grid'
import { measureScenario, missionWords, scenarioLink, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { Mascot } from '../scout/Mascot'
import { HeaderTools } from './HeaderTools'
import { AdvancedControls, MissionControls } from './MissionDrawer'
import { PlannerCompare } from './PlannerCompare'
import { PlannerFind } from './PlannerFind'
import type { PlannerTab } from './plannerFit'
import { compareGroups, plannerCsv } from './plannerTable'
import { ScenarioTabs } from './Scenarios'
import type { LandingShares, ScenarioFacts } from './useScenarioFacts'
import { useShadow } from './useShadow'
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
  /** Change one scenario's site or landing, in place. */
  onChange: (index: number, scenario: SightlineScenario) => void
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
  /** Each scenario's landing hour, for the Sun's and Earth's angles; null while its month loads. */
  landings: (LandingShares | null)[]
  /** The average sunlight on a panel over each scenario's mission, in W/m²; undefined while its months load. */
  sunlightWm2: (number | null | undefined)[]
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
export function FullPlanner({ start, hours, flagged, scenarios, facts, mission, onMission, active, onSelect, onAdd, onChange, onAddShown, onRemove, onBack, tab, onTab, onBrief, scoutOpen, onScout, site, month, year, summary, landings, sunlightWm2 }: Props) {
  const measures = scenarios.map((scenario, i) => {
    const { site: at, flags, slopeDeg } = facts[i]
    return flags ? measureScenario(scenario, at, flags, mission, slopeDeg) : null
  })
  // The distances to permanent shadow are Compare's alone: fetched when it first opens, never for Find.
  const shadow = useShadow(tab === 'compare')
  const groups = compareGroups({
    scenarios,
    siteIds: facts.map((fact) => (isCustomSite(fact.site) ? null : fact.site.id)),
    measures,
    flags: facts.map((fact) => fact.flags),
    mission,
    landings,
    sunlightWm2,
    shadow,
  })
  const spans = useMemo(() => monthSpans(start, hours), [start, hours])
  // The detailed planner is a page of its own that reads the app's view link: it opens on the scenario
  // on show, with the mission's limits, and keeps the other scenarios in its shortlist.
  const detailed = `/planner/${scenarioLink([scenarios[active], ...scenarios.filter((_, i) => i !== active)], 0, start, mission)}`

  const exportTable = () => {
    const csv = plannerCsv(
      start,
      scenarios,
      facts.map((fact) => fact.site.name),
      groups.flatMap((group) => group.rows),
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
      <header className="sl-full-head pl-header">
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
          <a className="sl-link pl-detailed" href={detailed} title="The detailed planner, a page of its own, opened on the scenario on show">
            Detailed planner
          </a>
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
            <PlannerCompare start={start} hours={hours} flagged={flagged} scenarios={scenarios} facts={facts} mission={mission} groups={groups} active={active} onSelect={onSelect} onChange={onChange} onAdd={onAdd} onRemove={onRemove} />
          )}
        </div>
      </div>
    </section>
  )
}
