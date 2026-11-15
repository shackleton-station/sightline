import type { FlaggedSite } from '../data/useAllFlags'
import { MAX_SCENARIOS, missionWords, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { LibraryTray } from './LibraryTray'
import { MyPlans } from './MyPlans'
import { PlannerLibrary } from './PlannerLibrary'
import { useLibraryCards } from './useLibrary'
import './library.css'

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  /** Every listed site with its hourly flags: what each saved landing is judged from. */
  flagged: FlaggedSite[]
  scenarios: SightlineScenario[]
  mission: SightlineMission
  active: number
  onSelect: (index: number) => void
  /** Add a scenario and show it. With four already, nothing is added. */
  onAdd: (scenario: SightlineScenario) => void
  onBack: () => void
  /** Open the Planner on Compare, where the landings pulled in are set side by side. */
  onCompare: () => void
  /** Put a landing in the plan (or choose it, if it is there) and go back to the main screen, where the plan column shows it. */
  onShow: (scenario: SightlineScenario) => void
  /** Open a saved plan again, as its link would. */
  onResume: (id: string) => void
}

/**
 * The Library, a page of its own beside the Planner: every landing in the plans people have saved,
 * to search and filter. It is not part of planning one mission, which is why it is not a tab of the
 * Planner: it is where to look at what others chose. A landing pulled in goes to the tray, here and
 * in the Planner's header, and from the tray into Compare. First on the page are your own plans,
 * the ones saved from this browser, each with one button to pick it up again.
 */
export function LibraryPage({ start, hours, flagged, scenarios, mission, active, onSelect, onAdd, onBack, onCompare, onShow, onResume }: Props) {
  const library = useLibraryCards({ wanted: true, start, hours, flagged, mission, scenarios })
  return (
    <section className="sl-full lib-page" aria-label="Library">
      <header className="sl-full-head pl-header">
        <button type="button" className="sl-small pl-back" title="Closes the Library and shows the Moon again (Esc)." onClick={onBack}>
          ‹ Moon
        </button>
        <h2>Library</h2>
        <LibraryTray
          start={start}
          cards={library.trayCards}
          letterOf={library.letterOf}
          room={scenarios.length < MAX_SCENARIOS}
          onCompare={(card) => {
            if (!card.scenario) return
            // Added for comparing, not opened: the scenario on show stays the one you are working on.
            const working = active
            onAdd(card.scenario)
            onSelect(working)
          }}
          onRemove={library.toggle}
          onOpenCompare={onCompare}
          onOpenLibrary={null}
          onWanted={NOTHING}
        />
      </header>
      <MyPlans cards={library.cards} onResume={onResume} />
      <h3 className="lib-all">Everyone’s landings</h3>
      <p className="lib-page-lead">
        Landings from the plans people have saved here. Each is judged against your mission ({missionWords(mission)}), not the one it was saved for. “Show in plan” puts one in your plan on the main screen; “Pull in” keeps it in the tray to set beside your own in Compare.
      </p>
      <PlannerLibrary
        start={start}
        state={library.state}
        cards={library.cards}
        sites={flagged.map((one) => one.site)}
        firstMonth={start.slice(0, 7)}
        lastMonth={new Date(Date.parse(start) + (hours - 1) * 3_600_000).toISOString().slice(0, 7)}
        tray={library.tray}
        onToggle={library.toggle}
        onShow={(card) => card.scenario && onShow(card.scenario)}
        letterOf={library.letterOf}
        room={scenarios.length < MAX_SCENARIOS}
        onReload={library.reload}
        onOpenPlan={onResume}
      />
    </section>
  )
}

/** The page reads the library as it opens, so the tray has nothing to ask for. */
const NOTHING = () => {}
