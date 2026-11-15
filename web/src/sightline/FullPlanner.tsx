import { isCustomSite } from '../data/customSite'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import type { SiteInfo, Summary } from '../data/contract'
import type { FlaggedSite } from '../data/useAllFlags'
import { monthSpans } from '../lib/grid'
import { measureScenario, missionWords, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { marginalAtLanding } from '../lib/landingVerdict'
import { spanOfHours } from '../lib/span'
import { useWidth } from '../lib/useWidth'
import { Mascot } from '../scout/Mascot'
import { ExportMenu } from './ExportMenu'
import { HeaderTools } from './HeaderTools'
import { saveHourlyCsv, saveText } from './hourlyExport'
import { AdvancedControls, MissionControls } from './MissionDrawer'
import { buildGrid } from '../planner/plannerModel'
import { cardsOf, type LibraryCard } from '../lib/library'
import { MAX_SCENARIOS } from '../lib/sightlineMission'
import { LibraryTray } from './LibraryTray'
import { PlannerLibrary } from './PlannerLibrary'
import { useLibrary, useTray } from './useLibrary'
import './library.css'
import { PlannerCompare } from './PlannerCompare'
import { PlannerCompareMore } from './PlannerCompareMore'
import { PlannerDetail } from './PlannerDetail'
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
  /** The first and last year of all the data, of which the page holds a few at a time. */
  dataYears?: { first: number; last: number }
  /** Ask for a year beyond those on hand; true if it is on its way without starting the page again. */
  onYear?: (year: number) => boolean
  /** The first and last hour of all the data, as a date field holds them. */
  landingBounds?: { first: string; last: string }
  /** Move a scenario's landing to a date beyond the years on hand; false if the data does not cover it. */
  onFarLanding?: (index: number, value: string) => boolean
  /** The average sunlight on a panel over each scenario's mission, in W/m²; undefined while its months load. */
  sunlightWm2: (number | null | undefined)[]
  /** A notice for the header's last row: a saved plan's name and note. */
  banner?: ReactNode
}

const TABS: { id: PlannerTab; label: string; title: string }[] = [
  { id: 'find', label: 'Find', title: 'Shows every site by month: where and when a landing fits the mission.' },
  { id: 'compare', label: 'Compare', title: 'Shows your scenarios side by side, row by row.' },
]

/**
 * Below this width of its own (px) the Planner has no room for the Mission column beside a grid whose
 * twelve months can be read: the column's 19rem, the site names, and a month every 2.1rem.
 */
const ROOM_FOR_BOTH_PX = 1000

/**
 * The Planner: the same scenarios and the same mission, with room to work. Mission limits down the
 * left for both tabs. Find is every site by month, where a cell adds a scenario; Compare is the
 * scenarios side by side. The Moon stays as a small live view in the corner (drawn by the screen,
 * not here), and is itself a way back.
 */
export function FullPlanner({ start, hours, flagged, scenarios, facts, mission, onMission, active, onSelect, onAdd, onChange, onAddShown, onRemove, onBack, tab, onTab, onBrief, scoutOpen, onScout, site, month, year, summary, landings, sunlightWm2, dataYears, onYear, landingBounds, onFarLanding, banner = null }: Props) {
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

  // The library: landings other people saved, to search and pull into Compare. It is a third tab that
  // the link does not hold (a saved plan opens on Find or Compare), and it is read from the plans
  // service the first time it or the tray is opened, not before.
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryWanted, setLibraryWanted] = useState(false)
  const wantLibrary = useCallback(() => setLibraryWanted(true), [])
  const library = useLibrary(libraryWanted || libraryOpen)
  const [tray, toggleTray] = useTray()
  // Each card's share of its month's days with a landing that fits: the month grid's own count, built only once the library is wanted.
  const grid = useMemo(() => (libraryWanted || libraryOpen ? buildGrid(flagged, mission.requirements) : null), [libraryWanted, libraryOpen, flagged, mission.requirements])
  const monthShare = useCallback((siteId: string, at: string) => grid?.rows.find((row) => row.site.id === siteId)?.cells.find((cell) => cell.month === at)?.share ?? null, [grid])
  const libraryCards = useMemo(() => (library.state.kind === 'ready' ? cardsOf(library.state.entries, start, hours, flagged, mission, monthShare) : []), [library.state, start, hours, flagged, mission, monthShare])
  const trayCards = useMemo(() => cardsOf(tray, start, hours, flagged, mission, monthShare), [tray, start, hours, flagged, mission, monthShare])
  const letterOf = (card: LibraryCard) => {
    const i = scenarios.findIndex((scenario) => scenario.site === card.scenario?.site && scenario.landing === card.scenario.landing)
    return i < 0 ? null : SCENARIO_LETTERS[i]
  }

  const exportTable = () => {
    const csv = plannerCsv(
      start,
      scenarios,
      facts.map((fact) => fact.site.name),
      groups.flatMap((group) => group.rows),
      measures,
      missionWords(mission),
      landings.map((landing) => marginalAtLanding(mission.requirements, landing)),
    )
    saveText('sightline-scenarios.csv', csv)
  }
  // The scenario on show over its mission, hour by hour: read as the screen reads it, from the mission's heights.
  const exportHourly = () => saveHourlyCsv({ site: facts[active].site, start, landing: scenarios[active].landing, missionDays: mission.requirements.missionDays, years: spanOfHours(start, hours), heights: mission.heights })
  const days = mission.requirements.missionDays
  // The Planner's own width, whatever else is open beside it. Too narrow for the Mission column and
  // a readable grid side by side, the column folds away above the grid.
  const [box, boxWidth] = useWidth()
  const narrow = boxWidth > 0 && boxWidth < ROOM_FOR_BOTH_PX
  const [limitsOpen, setLimitsOpen] = useState(false)

  return (
    <section className="sl-full" aria-label="Planner" ref={box} data-room={narrow ? 'narrow' : 'wide'}>
      <header className="sl-full-head pl-header">
        <button type="button" className="sl-small pl-back" title="Closes the Planner and shows the Moon again (Esc)." onClick={onBack}>
          ‹ Moon
        </button>
        <h2>Planner</h2>
        <div className="pl-tabs" role="tablist" aria-label="Planner">
          {TABS.map((one) => (
            <button
              key={one.id}
              type="button"
              role="tab"
              aria-selected={one.id === tab && !libraryOpen}
              title={one.title}
              onClick={() => {
                setLibraryOpen(false)
                onTab(one.id)
              }}
            >
              {one.label}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={libraryOpen} title="Shows landings other people saved: search them and pull them in to compare." onClick={() => setLibraryOpen(true)}>
            Library
          </button>
        </div>
        <LibraryTray
          start={start}
          cards={trayCards}
          letterOf={letterOf}
          room={scenarios.length < MAX_SCENARIOS}
          onCompare={(card) => {
            if (!card.scenario) return
            // Added for comparing, not opened: the scenario on show stays the one you are working on.
            const working = active
            onAdd(card.scenario)
            onSelect(working)
          }}
          onRemove={toggleTray}
          onOpenCompare={() => {
            setLibraryOpen(false)
            onTab('compare')
          }}
          onOpenLibrary={() => setLibraryOpen(true)}
          onWanted={wantLibrary}
        />
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
        {banner}
      </header>
      <div className="sl-full-body" data-limits={limitsOpen ? 'open' : 'folded'}>
        {/* Shown only where the Mission column is folded away: the mission in a few words, and the way to it. */}
        <p className="pl-limits-fold">
          <button type="button" className="sl-small" aria-expanded={limitsOpen} aria-controls="pl-limits" onClick={() => setLimitsOpen(!limitsOpen)}>
            {limitsOpen ? 'Hide the mission' : 'Change the mission'}
          </button>
          <span>Mission: {missionWords(mission)}.</span>
        </p>
        <div className="sl-full-mission" id="pl-limits">
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
          {libraryOpen ? (
            <PlannerLibrary
              start={start}
              state={library.state}
              cards={libraryCards}
              sites={flagged.map((one) => one.site)}
              firstMonth={start.slice(0, 7)}
              lastMonth={new Date(Date.parse(start) + (hours - 1) * 3_600_000).toISOString().slice(0, 7)}
              tray={tray}
              onToggle={toggleTray}
              onReload={library.reload}
            />
          ) : tab === 'find' ? (
            <PlannerFind start={start} hours={hours} flagged={findSites} scenarios={scenarios} shown={{ siteId: facts[active].site.id, landing: scenarios[active].landing }} spans={spans} year={year} mission={mission} onMission={onMission} count={scenarios.length} onAdd={onAdd} dataYears={dataYears} onYear={onYear} />
          ) : (
            <>
              <PlannerCompare start={start} hours={hours} flagged={flagged} scenarios={scenarios} facts={facts} mission={mission} groups={groups} active={active} onSelect={onSelect} onChange={onChange} onAdd={onAdd} onRemove={onRemove} bounds={landingBounds} onFar={onFarLanding} />
              {scenarios.length > 1 ? (
                <PlannerCompareMore start={start} hours={hours} scenarios={scenarios} facts={facts} mission={mission} measures={measures} active={active} onSelect={onSelect} onRemove={onRemove} />
              ) : (
                <PlannerDetail start={start} hours={hours} scenarios={scenarios} facts={facts} mission={mission} measures={measures} landings={landings} active={active} onSelect={onSelect} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
