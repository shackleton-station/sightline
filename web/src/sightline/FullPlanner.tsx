import { isCustomSite } from '../data/customSite'
import { useMemo } from 'react'
import type { SiteInfo, Summary } from '../data/contract'
import type { FlaggedSite } from '../data/useAllFlags'
import { monthSpans } from '../lib/grid'
import { measureScenario, missionWords, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { spanOfHours } from '../lib/span'
import { Mascot } from '../scout/Mascot'
import { ExportMenu } from './ExportMenu'
import { HeaderTools } from './HeaderTools'
import { saveHourlyCsv, saveText } from './hourlyExport'
import { AdvancedControls, MissionControls } from './MissionDrawer'
import { PlannerCompare } from './PlannerCompare'
import { type FindSite, PlannerFind } from './PlannerFind'
import type { PlannerTab } from './plannerFit'
import { compareGroups, plannerCsv } from './plannerTable'
import { useSiteValidations } from '../data/useSiteValidations'
import { shareTies } from '../lib/starTie'
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
  { id: 'find', label: 'Find', title: 'Shows every site by month: where and when a landing fits the mission.' },
  { id: 'compare', label: 'Compare', title: 'Shows your scenarios side by side, row by row.' },
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
  // Find's rows: the listed sites, then each point of the visitor's own that a scenario is at, once its hours are worked out.
  const findSites: FindSite[] = useMemo(() => {
    const seen = new Set(flagged.map((one) => one.site.id))
    const own = facts.flatMap((fact) => (isCustomSite(fact.site) && fact.flags !== null && !seen.has(fact.site.id) && seen.add(fact.site.id) ? [{ site: fact.site, flags: fact.flags, slopeDeg: fact.slopeDeg }] : []))
    return [...flagged, ...own]
  }, [flagged, facts])
  // The distances to permanent shadow are Compare's alone: fetched when it first opens, never for Find.
  const shadow = useShadow(tab === 'compare')
  const siteIds = facts.map((fact) => (isCustomSite(fact.site) ? null : fact.site.id))
  // For the star in the three rows that are a share of the mission, between two different sites (lib/starTie.ts).
  const validations = useSiteValidations(siteIds)
  const groups = compareGroups({
    scenarios,
    siteIds,
    measures,
    flags: facts.map((fact) => fact.flags),
    mission,
    landings,
    sunlightWm2,
    shadow,
    ties: shareTies(scenarios.map((scenario, i) => ({ site: scenario.site, siteId: siteIds[i], validation: siteIds[i] === null ? undefined : validations[siteIds[i]] }))),
  })
  const spans = useMemo(() => monthSpans(start, hours), [start, hours])

  const exportTable = () => {
    const csv = plannerCsv(
      start,
      scenarios,
      facts.map((fact) => fact.site.name),
      groups.flatMap((group) => group.rows),
      measures,
      missionWords(mission),
    )
    saveText('sightline-scenarios.csv', csv)
  }
  // The scenario on show over its mission, hour by hour: read as the screen reads it, from the mission's heights.
  const exportHourly = () => saveHourlyCsv({ site: facts[active].site, start, landing: scenarios[active].landing, missionDays: mission.requirements.missionDays, years: spanOfHours(start, hours), heights: mission.heights })
  const days = mission.requirements.missionDays

  return (
    <section className="sl-full" aria-label="Planner">
      <header className="sl-full-head pl-header">
        <button type="button" className="sl-small pl-back" title="Closes the Planner and shows the Moon again (Esc)." onClick={onBack}>
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
          <button type="button" className="sl-small" title="Opens a written summary of the scenario on show." onClick={onBrief}>
            Brief
          </button>
          <HeaderTools onBrief={onBrief} />
          <ExportMenu onTable={exportTable} onHourly={exportHourly} hourlyOf={`Scenario ${SCENARIO_LETTERS[active]} over its ${days} ${days === 1 ? 'day' : 'days'}`} />
          <button type="button" className="sl-small sl-rail-scout" aria-pressed={scoutOpen} title="Opens Scout, an AI guide, to ask about these scenarios." onClick={onScout}>
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
            <PlannerFind start={start} hours={hours} flagged={findSites} scenarios={scenarios} shown={{ siteId: facts[active].site.id, landing: scenarios[active].landing }} spans={spans} year={year} mission={mission} onMission={onMission} count={scenarios.length} onAdd={onAdd} />
          ) : (
            <PlannerCompare start={start} hours={hours} flagged={flagged} scenarios={scenarios} facts={facts} mission={mission} groups={groups} active={active} onSelect={onSelect} onChange={onChange} onAdd={onAdd} onRemove={onRemove} />
          )}
        </div>
      </div>
    </section>
  )
}
