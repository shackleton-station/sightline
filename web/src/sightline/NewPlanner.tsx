import { customSiteInfo, isCustomSite } from '../data/customSite'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SiteInfo, Summary } from '../data/contract'
import { loadOverview } from '../data/loadSite'
import type { FlaggedSite } from '../data/useAllFlags'
import { hourOf, locateHour } from '../lib/mission'
import { SLIPS } from '../lib/slip'
import { parseCustomSite } from '../lib/urlState'
import { defaultAddress } from '../planner/address'
import { Brief } from '../planner/Brief'
import { LandingSky } from '../planner/LandingSky'
import { briefWhy } from '../planner/why'
import { NothingWorks } from '../planner/NothingWorks'
import { SlipCheck } from '../planner/SlipCheck'
import { type Plan, usePlannerView } from '../planner/usePlannerView'
import { MissionBar } from '../planner/MissionBar'
import { WindowGrid } from '../planner/WindowGrid'
import type { PlannerSite } from '../planner/plannerModel'
import { EXAMPLE_REQUIREMENTS } from '../state/viewStore'
import { type KeptPick, PlannerAlternatives } from './PlannerAlternatives'
import { PlannerLocation } from './PlannerLocation'
import { PlannerMore } from './PlannerMore'
import { PlannerNearby } from './PlannerNearby'
import { PlannerPower } from './PlannerPower'
import { PlannerSunChart } from './PlannerSunChart'
import { useMissionTracks } from './useMissionTracks'
import { isBaseHeights } from '../lib/heights'
import { siteValue } from './site'
import '../planner/planner.css'
import '../planner/planner-brief.css'
import './newPlanner.css'
import { MAX_SCENARIOS, measureScenario, missionWords, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { Mascot } from '../scout/Mascot'
import { plannerCsv, plannerRows } from './plannerTable'
import type { LandingShares, ScenarioFacts } from './useScenarioFacts'

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
  onRemove: (index: number) => void
  /** Move the scenario on show to another site and landing: the Moon and the rest of the screen follow. */
  onScenario: (scenario: SightlineScenario) => void
  onBack: () => void
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

/** The slip first asked about: the app's shortest listed delay, a week. */
const FIRST_SLIP_DAYS = SLIPS[0].days ?? 7

/** The site, month and hour the brief is written for; a null hour is the month's best landing. */
type Chosen = Pick<Plan, 'site' | 'month' | 'index'>

/**
 * The Planner, in the Planner page's look and on this screen's own data. At the top, where and when
 * (a site or typed coordinates, and the landing's date and hour) and the mission; then every site
 * against every month for the mission, the written brief for the square chosen, and the scenarios
 * kept to compare. The brief is always the scenario on show: choosing a square, a site, a point or
 * a time moves it, and the Moon follows; moving it on the Moon moves the brief.
 */
export function NewPlanner({ start, hours, flagged, scenarios, facts, mission, onMission, active, onSelect, onAdd, onRemove, onScenario, onBack, scoutOpen, onScout, site, month, year, summary }: Props) {
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

  const room = scenarios.length < MAX_SCENARIOS
  // Each pick's mission, hour by hour, for the Sun's height and the power budget under the cards.
  const tracks = useMissionTracks(
    start,
    hours,
    scenarios,
    facts.map((fact) => fact.site),
    mission.requirements.missionDays,
  )
  const heightsNote = isBaseHeights(mission.heights) ? null : "The Sun's height and the sunlight are read at 2 m above the ground; the longest dark is at your panel's height."

  // The sites the grid and the dropdown hold: the listed ones, and any custom point a scenario is at, once its flags are in.
  const sites: PlannerSite[] | null = useMemo(() => {
    if (flagged.length === 0) return null
    const custom = facts.filter((fact): fact is typeof fact & { flags: NonNullable<typeof fact.flags> } => isCustomSite(fact.site) && fact.flags !== null)
    const seen = new Set(flagged.map((one) => one.site.id))
    return [...flagged, ...custom.filter((fact) => !seen.has(fact.site.id) && seen.add(fact.site.id)).map((fact) => ({ site: fact.site, flags: fact.flags }))]
  }, [flagged, facts])

  // What the brief is written for: the scenario on show. A null hour is the month's best landing.
  const shown = scenarios[active]
  // The grid's id for the scenario's site, read from the scenario itself: its facts can lag a render behind a new scenario.
  const shownSiteId = useMemo(() => {
    if (!shown) return site.id
    const point = parseCustomSite(shown.site)
    return point ? customSiteInfo(point.lat, point.lon).id : shown.site
  }, [shown, site.id])
  const fromShown = useCallback((): Chosen => {
    if (!shown) return { site: shownSiteId, month: null, index: null }
    const at = locateHour(start, shown.landing)
    return { site: shownSiteId, month: at.month, index: at.index }
  }, [shown, shownSiteId, start])
  const [chosen, setChosen] = useState<Chosen>(fromShown)
  const [slipDays, setSlipDays] = useState(FIRST_SLIP_DAYS)
  const plan: Plan = useMemo(() => ({ ...chosen, requirements: mission.requirements, shortlist: [], kept: { b: null, view3d: false } }), [chosen, mission.requirements])
  const fallback = useMemo(() => defaultAddress(mission.requirements), [mission.requirements])
  const view = usePlannerView(sites, plan, fallback, slipDays)
  const why = useMemo(() => (view ? briefWhy(view.row.flags, view.answer.span, view.viable, view.answer.days, mission.requirements) : null), [view, mission.requirements])
  const [obsHeightM, setObsHeightM] = useState<number | null>(null)
  useEffect(() => {
    let current = true
    loadOverview()
      .then((overview) => current && setObsHeightM(overview.obs_height_m))
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [])

  // One landing, two views. What you choose in the planner (a square's best landing, a day, a time) becomes the scenario on show...
  const pushed = useRef<string | null>(null)
  // Whether the planner's choice is yours (pushed to the Moon) or follows the scenario on show (never pushed back).
  const yours = useRef(false)
  const choose = useCallback((next: Chosen) => {
    yours.current = true
    setChosen(next)
  }, [])
  const ready = view !== null && view.row.site.id === chosen.site
  const settledSite = ready ? siteValue(view.row.site) : null
  const settledHour = ready ? hourOf(start, view.landing.t) : null
  // Only the planner's own choice changing pushes: the scenario moving elsewhere must not be pushed back over.
  const shownRef = useRef(shown)
  useEffect(() => {
    shownRef.current = shown
  })
  useEffect(() => {
    const now = shownRef.current
    if (!yours.current || settledSite === null || settledHour === null || !now) return
    const key = `${settledSite}@${settledHour}`
    if (key === `${now.site}@${now.landing}`) return
    pushed.current = key
    onScenario({ site: settledSite, landing: settledHour })
  }, [settledSite, settledHour, onScenario])
  // ...and a scenario moved anywhere else (the Moon, the time bar, another column chosen) moves the planner.
  const shownKey = shown ? `${shown.site}@${shown.landing}` : null
  useEffect(() => {
    if (shownKey === null || shownKey === pushed.current) return
    yours.current = false
    setChosen(fromShown())
  }, [shownKey, active, fromShown])

  // A square chosen with the pointer: bring the brief up if it is out of sight, so the click visibly answers. Keyboard choices stay on the grid.
  const briefRef = useRef<HTMLDivElement>(null)
  const pick = useCallback((siteId: string, month: string, byPointer = false) => {
    choose({ site: siteId, month, index: null })
    if (!byPointer) return
    requestAnimationFrame(() => {
      const box = briefRef.current
      if (!box) return
      const top = box.getBoundingClientRect().top
      if (top > 0 && top < window.innerHeight * 0.6) return
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      box.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    })
  }, [choose])
  /** A landing at an exact time, at this site or another. */
  const landAt = (siteId: string, iso: string) => {
    const flagsStart = view?.row.flags.start ?? start
    const place = locateHour(flagsStart, hourOf(flagsStart, iso))
    choose({ site: siteId, month: place.month, index: place.index })
  }
  // Whether the brief's landing is already one of the scenarios, other than the one on show it is.
  const keptHere = view ? scenarios.some((scenario, i) => i !== active && scenario.site === siteValue(view.row.site) && scenario.landing === hourOf(start, view.landing.t)) : false
  const select = (i: number) => onSelect(i)
  // Your picks, for the compare cards: every scenario, the one on show marked.
  const keptPicks: KeptPick[] = scenarios.map((scenario, i) => ({
    letter: SCENARIO_LETTERS[i],
    site: facts[i]?.site ?? site,
    flags: facts[i]?.flags ?? null,
    iso: new Date(Date.parse(start) + scenario.landing * 3_600_000).toISOString().replace('.000Z', 'Z'),
    onShow: i === active,
    onShowIt: () => select(i),
    onRemove: scenarios.length > 1 ? () => onRemove(i) : null,
  }))
  // The squares with a kept scenario, as "site@month", marked on the grid.
  const listed = useMemo(() => new Set(scenarios.map((scenario, i) => `${facts[i]?.site.id ?? scenario.site}@${locateHour(start, scenario.landing).month}`)), [scenarios, facts, start])

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
    <section className="sl-np" aria-label="New Planner">
      <header className="sl-full-head">
        <div className="np-title">
          <h2>Where and when can this mission land?</h2>
          <p>Pick a place and time, or set your mission and let the grid show every site against every month. Whatever you choose here is what the Moon shows.</p>
        </div>
        <button type="button" className="sl-small sl-rail-scout" aria-pressed={scoutOpen} title="Ask Scout about these scenarios" onClick={onScout}>
          <Mascot state={null} size={16} /> Scout
        </button>
        <button type="button" className="sl-small" title="The table below as a CSV file" onClick={exportTable}>
          Export table
        </button>
        <button type="button" className="sl-small sl-full-back" title="Back to the Moon (Esc)" onClick={onBack}>
          Back to the Moon
        </button>
      </header>
      <div className="planner sl-fp">
        <header className="pl-head">
          {view && (
            <p className="pl-tally" aria-live="polite">
              <strong className={view.grid.tally.withLanding === 0 ? 'none' : undefined}>{view.grid.tally.withLanding}</strong>
              <span>
                of {view.grid.tally.total} months across {view.grid.rows.length} sites have at least one day this mission can land and get through
                {view.grid.tally.tight > 0 ? `. ${view.grid.tally.tight} of those have only one or two` : ''}.
              </span>
            </p>
          )}
        </header>

        {sites && view && (
          <PlannerLocation
            sites={sites.map((one) => one.site)}
            siteId={view.row.site.id}
            landing={view.landing.t}
            first={view.row.flags.start}
            last={new Date(Date.parse(view.row.flags.start) + (view.row.flags.sun.length - 1) * 3_600_000).toISOString().replace('.000Z', 'Z')}
            nextLetter={room ? SCENARIO_LETTERS[scenarios.length] : null}
            onAdd={(value, iso) => onAdd({ site: value, landing: hourOf(start, iso) })}
          />
        )}
        {shown && facts[active] && isCustomSite(facts[active].site) && !facts[active].flags && <p className="pl-notice" role="status">Working out {facts[active].site.name}…</p>}

        <MissionBar value={mission.requirements} example={EXAMPLE_REQUIREMENTS} onChange={(requirements) => onMission({ ...mission, requirements })} />
        <PlannerMore
          mission={mission}
          onMission={onMission}
          site={site}
          month={month}
          year={year}
          summary={summary}
          heightsOff={isCustomSite(site) ? 'A custom point is worked out at 2 m only.' : null}
        />


        {view && view.grid.tally.withLanding === 0 && sites && <NothingWorks sites={sites} requirements={mission.requirements} onChange={(requirements) => onMission({ ...mission, requirements })} />}

        <div className="pl-body">
          {/* Left: compare, then the grid. Right: the brief, level with the top of compare. */}
          <div className="sl-fp-left">
            {sites && view && (
              <PlannerAlternatives
                sites={sites}
                requirements={mission.requirements}
                maxSlopeDeg={mission.maxSlopeDeg}
                landing={view.landing.t}
                siteId={view.row.site.id}
                kept={keptPicks}
                room={room}
                onOpen={(siteId, iso) => landAt(siteId, iso)}
                onKeep={(kept, iso) => {
                  // Kept for comparing, not opened: the landing on show stays the one you are working on.
                  const working = active
                  onAdd({ site: siteValue(kept), landing: hourOf(start, iso) })
                  onSelect(working)
                }}
              />
            )}
            <details className="np-detail">
              <summary>Sun height and power for your picks</summary>
              <PlannerSunChart rows={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i] }))} missionDays={mission.requirements.missionDays} />
              <PlannerPower columns={scenarios.map((_, i) => ({ letter: SCENARIO_LETTERS[i], name: facts[i].site.name, track: tracks[i], sunGapH: measures[i]?.sunGapH ?? null }))} heightsNote={heightsNote} />
            </details>
            {view ? <WindowGrid grid={view.grid} siteId={view.row.site.id} month={view.month} listed={listed} onPick={pick} keptWords="kept to compare" /> : <p className="pl-grid sl-quiet">Reading every site and month…</p>}
            {view && (
              <PlannerNearby
                site={view.row.site}
                month={view.month}
                onSpot={(lat, lon) => {
                  const atSite = Math.abs(lat - view.row.site.lat) < 1e-6 && Math.abs(lon - view.row.site.lon) < 1e-6
                  onScenario({ site: atSite ? siteValue(view.row.site) : siteValue(customSiteInfo(lat, lon)), landing: hourOf(start, view.landing.t) })
                }}
              />
            )}
          </div>
          <div className="pl-answer sl-fp-brief" ref={briefRef}>
            {view && obsHeightM !== null ? (
              <Brief
                site={view.row.site}
                month={view.month}
                requirements={mission.requirements}
                start={view.row.flags.start}
                answer={view.answer}
                landing={view.landing}
                others={view.others}
                obsHeightM={obsHeightM}
                link={window.location.href}
                kept={!room || keptHere}
                keepWords={{ keep: 'Keep to compare', kept: keptHere ? 'Kept to compare' : 'Compare is full' }}
                onKeep={() => onAdd({ site: siteValue(view.row.site), landing: hourOf(start, view.landing.t) })}
                onDay={(day) => {
                  // The day's first landing hour that works, or its midnight if none does.
                  const first = Array.from({ length: 24 }, (_, h) => day * 24 + h).find((index) => view.viable[view.answer.span.from + index] === 1)
                  choose({ site: view.row.site.id, month: view.month, index: first ?? day * 24 })
                }}
                onUseBest={() => choose({ site: view.row.site.id, month: view.month, index: null })}
                onPick={(siteId, month) => pick(siteId, month)}
                sky={<LandingSky site={view.row.site} flags={view.row.flags} t={view.landing.t} requirements={mission.requirements} />}
                why={why}
              >
                <SlipCheck check={view.check} landing={view.landing} onDays={setSlipDays} late={view.late} onPlan={(siteId, t) => landAt(siteId ?? view.row.site.id, t)} />
              </Brief>
            ) : (
              <p className="sl-quiet">Writing the brief…</p>
            )}
          </div>

        </div>
      </div>
    </section>
  )
}
