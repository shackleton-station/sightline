import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DataRange, SiteInfo } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import type { ScenarioData } from '../data/scenarioData'
import type { FlaggedSite } from '../data/useAllFlags'
import { useScenario } from '../data/useScenario'
import { setAddressBar } from '../lib/address'
import { horizonAt } from '../lib/customModel'
import { BASE_HEIGHT_M, DEFAULT_HEIGHTS, heightsWords } from '../lib/heights'
import { chipWords, earthShare as earthShareOf, marginalReasons, shortWhen } from '../lib/sightlineSky'
import { bodyRadiiDeg } from '../lib/surfaceView'
import { HowItWorks } from '../shell/HowItWorks'
import { hourOf, locateHour } from '../lib/mission'
import { type RiverState, riverState } from '../lib/river'
import { spanOfHours, yearsInHash } from '../lib/span'
import {
  clockDate,
  clockTime,
  DEFAULT_SPEED,
  fieldAt,
  hourFromField,
  monthSpan,
  STATE_WORDS,
  stateAt,
  earthDirection,
  sunDirection,
  tabTitle,
  wholeHour,
  yearHour,
} from '../lib/sightline'
import {
  betterDate,
  steadierLanding,
  DEFAULT_MISSION,
  fitProblems,
  MAX_SCENARIOS,
  missionWords,
  presetOf,
  readScenarioLink,
  rowLabels,
  type RemovedScenario,
  removeScenarioAt,
  restoreScenario,
  SCENARIO_LETTERS,
  scenarioLink,
  type SightlineScenario,
} from '../lib/sightlineMission'
import { ROVER_PRESET } from '../lib/csaRover'
import { type TrekLayerId, trekLayer } from '../lib/trekLayers'
import { Answer } from './Answer'
import { ScoutPanel, useScoutChat } from './AskScout'
import { FullPlanner } from './FullPlanner'
import { HeaderTools } from './HeaderTools'
import { Tips } from './Tips'
import { Tour } from './Tour'
import type { TourFile } from '../lib/tour'
import tourFile from './tour.json'
import { CompareDrawer } from './CompareDrawer'
import { nowIso, useClock, useIdle, useStored, useYearPositions } from './hooks'
import { useLightGrid } from '../atlas/useLightGrid'
import { cellAt, upSeries } from '../lib/lightGrid'
import { useFinePhoto } from '../data/finePhoto'
import { LayersDrawer } from './LayersDrawer'
import { RoverDrawer } from './RoverDrawer'
import { AdvancedDrawer, MissionDrawer } from './MissionDrawer'
import { useTrekOverlay } from './useTrekOverlay'
import { Fields, PlanColumn, Verdict } from './PlanColumn'
import { Rail, type StageMode } from './Rail'
import { River } from './River'
import {RemovedNotice, ScenarioTabs } from './Scenarios'
import { siteValue } from './site'
import { Skyline } from './Skyline'
import { Stage } from './Stage'
import { useHeightFlags } from './useHeights'
import { useLandingShares, useScenarioFacts } from './useScenarioFacts'
import { useTutorialVideo } from './useTutorialVideo'
import { PlayControl, ScoutLine } from './WatchControls'

/** The site "Plan a landing" opens on. */
// The brief brings the old Planner page's own code and styles: loaded only when it is opened.
const BriefSheet = lazy(() => import('./BriefSheet'))
const FEATURED = 'connecting-ridge'
/** While time plays in Watch, the controls fade after this long with nothing moved, touched or pressed. */
const FADE_AFTER_MS = 3000
/** Room kept clear under the Moon in Watch for the play control, so the control is never over the Moon's disc. */
const PLAY_CONTROL_ROOM_PX = 64
/** How far Scout's block sits above the stage's bottom edge in Watch, with a little air over it. */
const SCOUT_FOOT_PX = 84
/** Under this window width Scout's bubble would reach the Moon's disc, so the Moon is fitted above it. */
const NARROW_UNDER_PX = 1180

/** A sheet across the bottom of a phone's screen has this much air between it and the Moon. */
const SHEET_AIR_PX = 10
/** How long the Moon takes to glide aside for Scout's card (the same time as in the styles). */
const GLIDE_MS = 350

/** How much room the window has for Scout's card beside the Moon: a phone, a narrow window, or a wide one. */
function useRoom(): 'phone' | 'narrow' | 'wide' {
  const read = (): 'phone' | 'narrow' | 'wide' => (window.innerWidth < 761 ? 'phone' : window.innerWidth < NARROW_UNDER_PX ? 'narrow' : 'wide')
  const [room, setRoom] = useState(read)
  useEffect(() => {
    const onResize = () => setRoom(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return room
}
/** Room kept under the Moon in Plan for the note that says the Moon is not showing the landing. */
const NOTE_ROOM_PX = 30
/** How long a removed scenario can be brought back. */
const UNDO_MS = 5000
/** Scout's tour: its steps, words and what each rings, from the one file the video's recorder reads too. */
const TOUR = tourFile as TourFile

/** The phone's bottom sheet has three heights: the answer; half the screen; nearly all of it. */
const SHEET_HEIGHTS = 3

interface Props {
  sites: SiteInfo[]
  /** Every listed site's flags for the years on hand: a few of the years the data covers. */
  flagged: FlaggedSite[]
  /** The whole span the data covers, from its own description: the date picker's limits, and where the clock starts. */
  range: DataRange
  /**
   * Ask for years that are not on hand. True if they are being fetched. A link says where to go
   * once they are here; without one (time playing on), only the years just ahead are added.
   */
  onNeed: (years: number[], link?: string) => boolean
  /** Open with How it works on show. */
  openHow?: boolean
}

/** The light grid reaches from the pole to about here: south of it, a site's close-up is lit from the grid. */
const GRID_FROM_LAT_DEG = -85

/**
 * The one screen. Watch is the Moon playing with everything else hideable; Plan puts a frame round
 * the Moon with the question (At, On, For) and the answer. One clock drives both.
 */
export function Sightline({ sites, flagged, range, onNeed, openHow = false }: Props) {
  // Every site's flags share one start and length: the years on hand. Clock hours count from that
  // start. More years are only ever added after them, so an hour keeps its number while the page is open.
  const start = flagged[0].flags.start
  const hours = flagged[0].flags.sun.length
  const held = useMemo(() => spanOfHours(start, hours), [start, hours])
  // Where the clock starts: the data's default month, the one Scout and the Surface open on.
  // Watch opens on the current hour, so the Moon on screen is the Moon now. If the clock is outside
  // the hours on hand, it opens on the data's default month instead.
  const nowHour = Math.floor(hourOf(start, nowIso()))
  const opening = nowHour >= 0 && nowHour < hours ? nowHour : Math.min(Math.max(hourOf(start, `${range.default_month}-01T00:00:00Z`), 0), hours - 1)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  // A link that carries a scenario opens Plan on it, paused at its landing, so it shows what was shared.
  const [linked] = useState(() => readScenarioLink(window.location.hash, start, hours))
  const clock = useClock(hours, linked?.scenarios[linked.active].landing ?? opening, !still && !linked, DEFAULT_SPEED)
  const hour = wholeHour(clock.hour, hours)
  const { setPlaying, setHour, playing } = clock

  const [plan, setPlan] = useState(linked !== null)
  // Up to four scenarios, A to D; the column, the skyline and the answer are about the active one.
  const [scenarios, setScenarios] = useState<SightlineScenario[]>(() => linked?.scenarios ?? [{ site: sites.some((site) => site.id === FEATURED) ? FEATURED : sites[0].id, landing: opening }])
  const [chosen, setActive] = useState(linked?.active ?? 0)
  const active = Math.min(chosen, scenarios.length - 1)
  const scenario = scenarios[active]
  const setScenario = useCallback((change: (current: SightlineScenario) => SightlineScenario) => setScenarios((all) => all.map((one, i) => (i === active ? change(one) : one))), [active])
  const [mission, setMission] = useState(linked?.mission ?? DEFAULT_MISSION)
  // One panel on the right at a time. Scout's conversation lives here, so closing his panel keeps it.
  const [drawer, setDrawer] = useState<'scout' | 'mission' | 'advanced' | 'compare' | 'layers' | 'rover' | null>(null)
  const chat = useScoutChat()
  // The Planner takes the whole window, with the Moon kept small in a corner; How it works opens as a sheet over the scene.
  const [full, setFull] = useState(false)
  const [how, setHow] = useState(openHow)
  // The written brief for the scenario on show, as a sheet too.
  const [brief, setBrief] = useState(false)
  // Scout's chat card in Watch: whether it is open, how tall it is, and how wide the window is. On a
  // window too narrow for the card to sit beside the Moon, the Moon moves aside (up) for it.
  const [scoutOpen, setScoutOpen] = useState(false)
  const [scoutHeight, setScoutHeight] = useState(0)
  // The Moon glides only while it makes room for the card or takes it back: any other change of size is at once.
  const [gliding, setGliding] = useState(false)
  useEffect(() => {
    setGliding(true)
    const timer = window.setTimeout(() => setGliding(false), GLIDE_MS + 100)
    return () => window.clearTimeout(timer)
  }, [scoutOpen])
  const room = useRoom()
  // The site a reply of Scout's names is ringed on the Moon while that reply is the latest and his card is open.
  const lastSaid = chat.thread.at(-1)
  const ringed = useMemo(() => {
    if (plan || !scoutOpen || !lastSaid || lastSaid.role !== 'assistant' || lastSaid.failed) return null
    const link = lastSaid.actions?.[0] ? readScenarioLink(lastSaid.actions[0].hash, start, hours) : null
    const linked = link ? sites.find((listed) => listed.id === link.scenarios[link.active].site) : undefined
    return (linked ?? sites.find((listed) => lastSaid.text.includes(listed.name)))?.id ?? null
  }, [plan, scoutOpen, lastSaid, sites, start, hours])
  // The Moon Trek layer laid over the south pole, if one is switched on.
  const [layer, setLayer] = useState<TrekLayerId | null>(null)
  // The app's own computed light, as a layer: off by default, so Site view opens on the Moon's own picture.
  const [shade, setShade] = useState(false)
  const trek = useTrekOverlay(layer)
  const [mode, setMode] = useState<StageMode>('orbit')
  const [sheet, setSheet] = useState(1)

  const [bare, setBare] = useStored('clear', false)
  const [pillMin, setPillMin] = useStored('pillMin', false)
  const [riverMin, setRiverMin] = useStored('riverMin', false)
  const [skyMin, setSkyMin] = useStored('skyMin', false)
  const idle = useIdle(clock.playing && !bare && !plan, FADE_AFTER_MS)
  const [pointed, setPointed] = useState<SiteInfo | null>(null)

  // Scout's tour: which step is on show (null when it is not running), and the screen as the
  // visitor had it, to put back when the tour is closed at any step. It never starts by itself.
  const [tourAt, setTourAt] = useState<number | null>(null)
  const beforeTour = useRef<{ plan: boolean; scenarios: SightlineScenario[]; chosen: number; drawer: typeof drawer; full: boolean; brief: boolean; scoutOpen: boolean; mode: StageMode; sheet: number; bare: boolean; pillMin: boolean; riverMin: boolean; skyMin: boolean; hour: number; playing: boolean } | null>(null)
  /** Whether the tour has put its own landing in Plan yet: once, so what the visitor tries on the way is kept. */
  const tourPlanned = useRef(false)
  // The offer in Scout's closed line shows on a first visit only: remembered once seen or taken.
  const [tourSeen, setTourSeen] = useStored('tourSeen', false)
  /** Whether the visitor has taken the tour: How it works then offers it "again". */
  const [tourTaken, setTourTaken] = useStored('tourTaken', false)
  const tutorialVideo = useTutorialVideo(TOUR.video, tourAt !== null || how)
  /** How it works opens at its video when the tour's last step asks for it. */
  const [howAtVideo, setHowAtVideo] = useState(false)

  // The listed sites' flags with the Sun seen from the panel's height and Earth from the antenna's.
  // At 2 m and 2 m they are the flags given, and nothing more is loaded.
  const lit = useHeightFlags(flagged, held, mission.heights)
  // A link that names a site this build doesn't know falls back to the first listed one.
  const facts = useScenarioFacts(sites, lit.flagged, scenarios, start)
  const { site, flags } = facts[active]
  // The heights this scenario's numbers are for: a custom point is worked out at 2 m only.
  const siteHeights = isCustomSite(site) ? DEFAULT_HEIGHTS : lit.applied
  const forHeights = (data: ScenarioData) => (data.heights?.panelM ?? BASE_HEIGHT_M) === siteHeights.panelM && (data.heights?.antennaM ?? BASE_HEIGHT_M) === siteHeights.antennaM
  // Two moments, each with its month of the pipeline's track. The landing's is what the column is
  // about. The time bar's is what the Moon, the dots, the skyline and the river's readout follow.
  // One small line by the Sun and Earth rows when a height is not the app's own 2 m, saying what the
  // numbers on screen are for: never the chosen heights before their files are in.
  const chosenHeights = heightsWords(mission.heights)
  const heightsLine = !chosenHeights
    ? null
    : isCustomSite(site)
      ? 'custom point: worked out at 2 m'
      : lit.failed
        ? `${chosenHeights}: that data did not load, so this is ${heightsWords(lit.applied) ?? 'for 2 m'}`
        : lit.loading
          ? `loading ${chosenHeights}…`
          : chosenHeights
  const landingAt = locateHour(start, scenario.landing)
  const landingMonth = useScenario(plan ? site : null, landingAt.month, held, siteHeights)
  const here = landingMonth.data && landingMonth.data.site.id === site.id && landingMonth.data.month === landingAt.month && forHeights(landingMonth.data) ? landingMonth.data : null
  const now = here ? here.track[Math.min(landingAt.index, here.track.length - 1)] : null
  const error = landingMonth.error
  const { month, index } = locateHour(start, hour)
  const barMonth = useScenario(plan ? site : null, month, held, siteHeights)
  const hereOnBar = barMonth.data && barMonth.data.site.id === site.id && barMonth.data.month === month && forHeights(barMonth.data) ? barMonth.data : null
  const nowOnBar = hereOnBar ? hereOnBar.track[Math.min(index, hereOnBar.track.length - 1)] : null
  const problems = flags ? fitProblems(flags, scenario.landing, mission, facts[active].slopeDeg) : null
  // How much of the Sun's and Earth's discs shows at each scenario's landing. A landing that meets a
  // "in view at landing" limit on a sliver of the Sun, or only the edge of Earth, fits only marginally.
  const shares = useLandingShares(scenarios, facts, start, held, lit.applied)
  const marginalAt = (i: number) => {
    const at = shares[i]
    return at ? marginalReasons(mission.requirements.sunAtLanding ? at.sun : null, mission.requirements.earthAtLanding ? at.earth : null, at.earthUp) : []
  }
  const marginal = problems && problems.length === 0 ? marginalAt(active) : []
  // The next landing that fits, offered only when this one does not: the first later hour that meets
  // the Sun and Earth limits, moved on, in the same sunlit stretch, to where at least half the Sun's
  // disc shows, once that month's track has loaded.
  const firstBetter = flags ? betterDate(flags, scenario.landing, mission) : null
  const betterAt = locateHour(start, firstBetter?.landing ?? scenario.landing)
  const betterMonth = useScenario(plan && firstBetter ? site : null, betterAt.month, held, siteHeights)
  const betterTrack = betterMonth.data && betterMonth.data.site.id === site.id && betterMonth.data.month === betterAt.month && forHeights(betterMonth.data) ? betterMonth.data.track : null
  const better = useMemo(() => {
    if (!flags || !firstBetter) return null
    // Without the track (it failed to load) the first hour that meets the limits is offered as it is.
    if (!betterTrack) return betterMonth.error && firstBetter.waitH > 0 ? firstBetter : null
    const landing = steadierLanding(
      flags,
      firstBetter.landing,
      mission,
      betterTrack.map((point) => point.sun_frac),
      firstBetter.landing - betterAt.index,
    )
    return landing === scenario.landing ? null : { landing, waitH: landing - scenario.landing }
  }, [flags, firstBetter?.landing, firstBetter?.waitH, betterTrack, betterMonth.error, mission, betterAt.index, scenario.landing])
  // A button in one of Scout's replies in Plan: what it proposes is applied as another scenario, never
  // by changing the one on show without a word. A change of limits, which every scenario shares, is
  // applied as the button's own words say.
  const openAsScenario = (hash: string) => {
    const link = readScenarioLink(hash, start, hours)
    if (!link) return
    const target = link.scenarios[link.active]
    if (JSON.stringify(link.mission) !== JSON.stringify(mission)) setMission(link.mission)
    const at = scenarios.findIndex((one) => one.site === target.site && one.landing === target.landing)
    if (at >= 0) {
      setActive(at)
      setHour(target.landing)
    } else if (scenarios.length < MAX_SCENARIOS) addScenario(target)
    else {
      setScenario(() => target)
      setHour(target.landing)
    }
  }
  // "Why?" beside the verdict: Scout's panel opens and is asked, on the visitor's behalf, why this
  // landing does or does not fit and what would change it. The verdict itself is the app's, and does
  // not wait for him. If he cannot answer, the panel shows the reasons as the app wrote them.
  // The question "Why?" last sent, and the view it was sent for.
  const whyAsked = useRef<{ question: string; view: string; pending: boolean } | null>(null)
  const askWhy = () => {
    setDrawer('scout')
    const misses = problems ?? []
    const question =
      misses.length > 0 ? "Why doesn't this landing fit the mission, and what would change that?" : marginal.length > 0 ? 'Why is this landing only a marginal fit, and what would make it better?' : 'Why does this landing fit the mission, and how much margin does it have?'
    const own = misses.length > 0 ? `The app's own reasons: ${misses.join(' ')}` : marginal.length > 0 ? `The app's own reasons: it meets every limit, but ${marginal.join(', and ')}.` : 'The app finds that this landing meets every limit of the mission.'
    // Asked once. A second click while the first is unanswered, or with the same question for the same
    // scenario still the last thing asked, only opens the panel. (The ref catches two clicks in one
    // moment, before the page has drawn the first.)
    const lastAsked = chat.thread.findLast((message) => message.role === 'user')
    const same = whyAsked.current?.question === question && whyAsked.current.view === scoutView
    if (chat.waiting || (same && (whyAsked.current?.pending || lastAsked?.text === question))) return
    const asked = { question, view: scoutView, pending: true }
    whyAsked.current = asked
    void chat.ask(question, scoutView).then((answered) => {
      asked.pending = false
      if (answered) return
      // Not answered: the app's own reasons stand in, and the same question may be asked again.
      if (whyAsked.current === asked) whyAsked.current = null
      chat.say(own)
    })
  }
  // Three questions to tap while Scout has said nothing, written for the scenario on show.
  const ideas = [
    problems && problems.length > 0 ? "Why doesn't this landing fit?" : 'How much margin does this landing have?',
    `When is the best landing here in ${landingAt.month.slice(0, 4)}?`,
    scenarios.length > 1 ? 'Which of my scenarios is best, and why?' : 'What would one more day of battery change?',
  ]

  const { year, hourOfYear } = yearHour(start, clock.hour)
  const ephemeris = useYearPositions(year)
  // The moment on the time bar at the scenario's site: what is up, and how much of Earth's disc shows
  // (Earth's size at that hour comes from the same ephemeris file that lights the Moon).
  const barState = flags ? stateAt(flags, hour) : null
  const earthOnBar =
    nowOnBar && hereOnBar && ephemeris && ephemeris.year === year
      ? earthShareOf(nowOnBar.earth_el - horizonAt(hereOnBar.earthHorizon ?? hereOnBar.horizon, nowOnBar.earth_az), bodyRadiiDeg(ephemeris.positions, Math.floor(hourOfYear), site.lat, site.lon).earth)
      : null
  // Time playing into the last year on hand: fetch the next, so the clock carries on past it.
  useEffect(() => {
    onNeed([year])
  }, [year, onNeed])
  // Crossing New Year, the file on hand is the other year's for a moment: hold the light at that
  // file's nearest end until the right one arrives (sunDirection keeps the hour inside the file).
  const sun = useMemo(() => {
    if (!ephemeris) return null
    const at = ephemeris.year === year ? hourOfYear : ephemeris.year < year ? Number.POSITIVE_INFINITY : 0
    return sunDirection(ephemeris.positions, at)
  }, [ephemeris, year, hourOfYear])
  // Earth's direction for the same moment, from the same file: for the Earth drawn beside the Moon.
  const earth = useMemo(() => {
    if (!ephemeris) return null
    const at = ephemeris.year === year ? hourOfYear : ephemeris.year < year ? Number.POSITIVE_INFINITY : 0
    return earthDirection(ephemeris.positions, at)
  }, [ephemeris, year, hourOfYear])

  // A custom point gets a dot of its own while a scenario is at it.
  const customs = useMemo(() => (plan ? facts.filter((fact, i) => isCustomSite(fact.site) && facts.findIndex((other) => other.site.id === fact.site.id) === i) : []), [plan, facts])
  const dotSites = useMemo(() => (customs.length > 0 ? [...sites, ...customs.map((fact) => fact.site)] : sites), [sites, customs])
  const states = useMemo(() => {
    const map = new Map<string, RiverState>(lit.flagged.map(({ site: listed, flags: listedFlags }) => [listed.id, stateAt(listedFlags, hour)]))
    for (const fact of customs) if (fact.flags) map.set(fact.site.id, stateAt(fact.flags, hour))
    return map
  }, [lit.flagged, hour, customs])

  // The tab's title follows the scenario on show: its site and landing date, not the clock.
  const title = tabTitle(plan ? { siteName: site.name, landingDate: clockDate(start, scenario.landing) } : null)
  useEffect(() => {
    document.title = title
  }, [title])

  // The address always reopens what is on screen: the scenario in Plan, nothing in Watch.
  const view = scenarioLink(scenarios, active, start, mission)
  // In Watch there is no scenario on show: Scout is sent the featured site at the moment on the clock.
  const watchView = scenarioLink([{ site: scenarios[0].site, landing: hour }], 0, start, mission)
  // For Scout the link always says which scenario is on show, so the co-pilot reads it as this screen's.
  const scoutView = active > 0 ? view : `${view}&sc=0`
  useEffect(() => {
    setAddressBar(plan ? view : window.location.pathname)
  }, [plan, view])

  // A date the data covers but in a year not on hand: ask for the years, and go there once they
  // are here. A date far from the years on hand starts the screen again around it, on this link.
  const awaited = useRef<string | null>(null)
  const reach = useCallback(
    (hash: string) => {
      const years = yearsInHash(hash)
      awaited.current = years.length > 0 && onNeed(years, hash) ? hash : null
    },
    [onNeed],
  )
  const openLink = useCallback(
    (hash: string) => {
      const link = readScenarioLink(hash, start, hours)
      if (!link) {
        reach(hash)
        return
      }
      setScenarios(link.scenarios)
      setActive(link.active)
      setMission(link.mission)
      setPlan(true)
      setPlaying(false)
      setHour(link.scenarios[link.active].landing)
    },
    [start, hours, setPlaying, setHour, reach],
  )
  // The years asked for have arrived: open the link that was waiting for them.
  useEffect(() => {
    const hash = awaited.current
    if (!hash) return
    awaited.current = null
    openLink(hash)
  }, [hours, openLink])
  // A link pasted into the open tab: go where it points. The page's own address rewrites don't fire this.
  useEffect(() => {
    const onHashChange = () => openLink(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [openLink])

  /** Open Plan from Watch: at a site if one was chosen, landing at the time on the clock. */
  const openPlan = useCallback(
    (chosen: SiteInfo | null) => {
      setScenario((current) => ({ site: chosen ? siteValue(chosen) : current.site, landing: plan ? current.landing : hour }))
      setPlan(true)
      setPointed(null)
    },
    [plan, hour, setScenario],
  )
  /** Add a scenario and show it, with the time bar on its landing. With four already, nothing is added. */
  const addScenario = useCallback(
    (added: SightlineScenario) => {
      if (scenarios.length >= MAX_SCENARIOS) return
      setScenarios([...scenarios, added])
      setActive(scenarios.length)
      // The list has changed since the removal: its undo no longer means what it said.
      setRemoved(null)
      setHour(added.landing)
    },
    [scenarios, setHour],
  )
  // A removal can be undone for a few seconds, in place of asking "are you sure?".
  const [removed, setRemoved] = useState<RemovedScenario | null>(null)
  useEffect(() => {
    if (!removed) return
    const timer = window.setTimeout(() => setRemoved(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [removed])
  const removeScenario = useCallback(
    (index: number) => {
      const after = removeScenarioAt(scenarios, active, index)
      if (!after) return
      setScenarios(after.scenarios)
      setActive(after.active)
      setRemoved(after.removed)
    },
    [scenarios, active],
  )
  const undoRemove = useCallback(() => {
    const back = removed ? restoreScenario(scenarios, removed) : null
    if (back) {
      setScenarios(back.scenarios)
      setActive(back.active)
    }
    setRemoved(null)
  }, [scenarios, removed])
  const closePlan = useCallback(() => {
    setPlan(false)
    setMode('orbit')
    setDrawer(null)
    setFull(false)
  }, [])

  /** Bringing the controls back always lands on Watch, whatever was open before hiding. */
  const showControls = useCallback(() => {
    setBare(false)
    closePlan()
  }, [setBare, closePlan])

  /**
   * Home: the opening screen as a first visit finds it. Watch, with the controls on show, the Moon
   * at the opening hour with time playing, Scout's card shut and his line offering the tour again.
   * The scenarios are kept: "Plan a landing" opens on the same site, landing at the hour on the clock
   * as it always does from Watch.
   */
  const goHome = useCallback(() => {
    showControls()
    setScoutOpen(false)
    setPillMin(false)
    setTourSeen(false)
    setHour(opening)
    setPlaying(!still)
  }, [showControls, setPillMin, setTourSeen, setHour, setPlaying, opening, still])

  const startTour = () => {
    beforeTour.current = { plan, scenarios, chosen, drawer, full, brief, scoutOpen, mode, sheet, bare, pillMin, riverMin, skyMin, hour: clock.hour, playing }
    tourPlanned.current = false
    setTourSeen(true)
    setTourTaken(true)
    setHow(false)
    setTourAt(0)
  }
  /** Leave the tour at any step: the screen goes back to how the visitor had it. */
  const endTour = useCallback(() => {
    const was = beforeTour.current
    beforeTour.current = null
    setTourAt(null)
    if (!was) return
    setPlan(was.plan)
    setScenarios(was.scenarios)
    setActive(was.chosen)
    setDrawer(was.drawer)
    setFull(was.full)
    setBrief(was.brief)
    setScoutOpen(was.scoutOpen)
    setMode(was.mode)
    setSheet(was.sheet)
    setBare(was.bare)
    setPillMin(was.pillMin)
    setRiverMin(was.riverMin)
    setSkyMin(was.skyMin)
    setHour(was.hour)
    setPlaying(was.playing)
  }, [setBare, setPillMin, setRiverMin, setSkyMin, setHour, setPlaying])
  // Each step puts the real screen in its state before Scout speaks: Watch or Plan, with nothing
  // else open and time held, so what the step rings is there and stays put.
  const tourStep = tourAt === null ? null : TOUR.steps[tourAt]
  useEffect(() => {
    if (!tourStep) return
    const { view, show } = tourStep.state
    setBare(false)
    setDrawer(null)
    setFull(false)
    setBrief(false)
    setHow(false)
    setScoutOpen(false)
    setMode('orbit')
    setPlaying(false)
    if (view === 'watch') {
      setPlan(false)
      setPillMin(false)
      // "Lit as it is right now": Watch shows the hour it is, where the data on hand holds it.
      if (!tourPlanned.current && nowHour >= 0 && nowHour < hours) setHour(nowHour)
      return
    }
    // The tour's own landing, once: one that does not fit the default mission, so the verdict has a reason and a next landing to show.
    const landing = hourOf(start, TOUR.scenario.landing)
    if (!tourPlanned.current && sites.some((listed) => listed.id === TOUR.scenario.site) && Number.isInteger(landing) && landing >= 0 && landing < hours) {
      setScenarios([{ site: TOUR.scenario.site, landing }])
      setActive(0)
      setHour(landing)
    }
    tourPlanned.current = true
    setPlan(true)
    if (show === 'skyline') setSkyMin(false)
    if (show === 'time') setRiverMin(false)
    // On a phone the strips are down the sheet: it opens to its full height for them, to half for the rest.
    setSheet(show ? SHEET_HEIGHTS : 2)
    // The step alone decides when this runs: the setters and the data it reads do not change while a tour is on.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tourStep])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // While Scout's tour is on, the keys are its own (the arrows step it, Escape closes it).
      if (tourAt !== null) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const tag = target?.tagName ?? ''
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (event.key === ' ' && tag !== 'BUTTON' && tag !== 'A' && tag !== 'SUMMARY') {
        event.preventDefault()
        setPlaying(!playing)
      } else if (event.key === 'h' || event.key === 'H') {
        if (bare) showControls()
        else setBare(true)
      }
      else if (event.key === 'p' || event.key === 'P') {
        if (plan) closePlan()
        else openPlan(null)
      }
      // The arrow keys turn the Moon when it has the focus; anywhere else they step time.
      else if (event.key === 'ArrowRight') setHour(Math.floor(clock.hour) + (event.shiftKey ? 24 : 1))
      else if (event.key === 'ArrowLeft') setHour(Math.floor(clock.hour) - (event.shiftKey ? 24 : 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tourAt, playing, bare, plan, clock.hour, setPlaying, setHour, setBare, openPlan, closePlan, showControls])

  // The river's rows are named by what differs between them: the date, the site, or both.
  const labels = rowLabels(
    scenarios,
    facts.map((fact) => fact.site.name),
    start,
  )
  // Escape leaves the How sheet, then the Planner.
  useEffect(() => {
    if (!how && !full && !brief) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (how) setHow(false)
      else if (brief) setBrief(false)
      else setFull(false)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [how, full, brief])

  const toggleMission = () => setDrawer(drawer === 'mission' || drawer === 'advanced' ? null : 'mission')
  const pointedState = pointed ? states.get(pointed.id) : undefined
  const line = pointed && pointedState ? `${pointed.name}: ${STATE_WORDS[pointedState]}.` : 'Pick a site, or just watch.'
  const shown = plan && !bare
  // Close on a site near the pole, the ground is lit from the pipeline's light grid for the hour on
  // the bar: the same grid the Atlas draws. Its months are large, so they are fetched only then.
  // The "Light and shadow" layer, off until asked for: the light grid's months are megabytes, fetched only then.
  const shadeHere = site.lat <= GRID_FROM_LAT_DEG
  // Our own finer photo tiles round the ridge sites: looked up once the photo is switched on, or close on a
  // ridge site with no layer on, where the Moon's own picture gets sharper from the same tiles.
  const finePhoto = useFinePhoto(layer === 'photo' || (shown && mode === 'site' && shadeHere))
  const wantGrid = shown && shade && shadeHere
  const lightGrid = useLightGrid(month, true, wantGrid)
  const gridAtSite = useMemo(() => {
    if (!wantGrid || !lightGrid.meta) return null
    // The fine grid where it reaches the site, the wide one beyond it: the shader's own rule.
    const fine = lightGrid.month ? cellAt(lightGrid.meta, site.lat, site.lon) : null
    const wide = !fine && lightGrid.wide && lightGrid.wideMeta ? cellAt(lightGrid.wideMeta, site.lat, site.lon) : null
    const data = fine ? lightGrid.month : wide ? lightGrid.wide : null
    const cell = fine ?? wide
    if (!data || !cell) return null
    const at = Math.min(Math.floor(index), data.hours - 1)
    return { sun: upSeries(data, 'sun', cell)[at] === 1, earth: upSeries(data, 'earth', cell)[at] === 1 }
  }, [wantGrid, lightGrid.meta, lightGrid.month, lightGrid.wide, lightGrid.wideMeta, site.lat, site.lon, index])
  const planner = shown && full
  const classes = ['scout', 'sightline', shown ? 'is-plan' : 'is-watch', planner ? 'is-full' : '', gliding && !plan ? 'is-gliding' : '', `sheet-${sheet}`, idle ? 'is-idle' : '', bare ? 'is-bare' : ''].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <Tips />
      {tourAt !== null && (
        <Tour
          tour={TOUR}
          at={tourAt}
          onStep={setTourAt}
          onClose={endTour}
          onVideo={
            tutorialVideo
              ? () => {
                  endTour()
                  setHowAtVideo(true)
                  setHow(true)
                }
              : null
          }
          state={now ? riverState(now) : (pointedState ?? null)}
        />
      )}
      {shown && (
        <div className="sl-wrap">
          <button type="button" className="sl-sheet-handle" aria-label="Change the sheet's height" onClick={() => setSheet((sheet % SHEET_HEIGHTS) + 1)}>
            {sheet === SHEET_HEIGHTS ? 'Pull down' : 'Pull up'}
          </button>
          <PlanColumn>
            <div className="sl-col-head">
              {/* The undo notice takes the title's place for a few seconds: nothing moves, and nothing is over the Moon. */}
              <h1 className="sl-title">Sightline</h1>
              <HeaderTools onBrief={() => setBrief(true)} />
            </div>
            {/* The scenarios, on a row of their own; the undo notice sits at the row's end for a few seconds, so nothing moves and nothing is over the Moon. */}
            <div className="sl-tabs-row">
              <ScenarioTabs count={scenarios.length} active={active} onSelect={setActive} onAdd={() => addScenario({ site: scenario.site, landing: hour })} onRemove={removeScenario} />
              {removed && <RemovedNotice letter={SCENARIO_LETTERS[removed.index]} onUndo={undoRemove} />}
            </div>
            <Fields
              sites={sites}
              site={site}
              onSite={(value) => setScenario((current) => ({ ...current, site: value }))}
              landing={clockTime(start, scenario.landing)}
              landingField={fieldAt(start, scenario.landing)}
              firstField={fieldAt(range.start, 0)}
              lastField={fieldAt(range.start, range.hours - 1)}
              onPickDate={(value) => {
                const landing = hourFromField(start, value, hours)
                if (landing === null) {
                  // Any hour the data covers can be picked. One outside the years on hand is reached by its link.
                  const inData = hourFromField(range.start, value, range.hours)
                  if (inData === null) return false
                  const picked = inData + hourOf(start, range.start)
                  reach(scenarioLink(scenarios.map((one, i) => (i === active ? { ...one, landing: picked } : one)), active, start, mission))
                  return true
                }
                // The time bar goes to the landing, so the Moon and the skyline show the date picked.
                setScenario((current) => ({ ...current, landing }))
                setHour(landing)
                return true
              }}
              missionName={presetOf(mission)?.label ?? 'Custom mission'}
              mission={missionWords(mission)}
              missionOpen={drawer === 'mission' || drawer === 'advanced'}
              onMission={toggleMission}
            />
            <Answer
              data={here}
              now={now}
              flags={flags}
              error={here ? null : error}
              maxSlopeDeg={mission.maxSlopeDeg}
              heights={siteHeights}
              heightsLine={heightsLine}
              earthShare={shares[active]?.earth ?? null}
              verdict={
                <Verdict
                  problems={problems}
                  marginal={marginal}
                  next={
                    better && problems && problems.length > 0
                      ? {
                          when: shortWhen(clockTime(start, better.landing), landingAt.month.slice(0, 4)),
                          adds: scenarios.length < MAX_SCENARIOS,
                          onTake: () => {
                            // As another scenario while there is room; with four already, this landing moves there.
                            if (scenarios.length < MAX_SCENARIOS) addScenario({ site: scenario.site, landing: better.landing })
                            else {
                              setScenario((current) => ({ ...current, landing: better.landing }))
                              setHour(better.landing)
                            }
                          },
                        }
                      : null
                  }
                  onWhy={askWhy}
                  onMission={() => setDrawer('mission')}
                />
              }
            />
          </PlanColumn>
          {/* The 3D Surface view shows the horizon better, so the strip is only up for the tour's step about it. */}
          {tourStep?.state.show === 'skyline' && (
            <Skyline horizon={hereOnBar?.horizon ?? null} track={hereOnBar?.track ?? null} index={index} obsHeightM={hereOnBar ? siteHeights.panelM : 0} folded={skyMin} onFold={setSkyMin} />
          )}
          <River
            start={start}
            hours={hours}
            clock={clock}
            hour={hour}
            moment={{
              state: barState,
              words: barState ? chipWords(barState === 'both' || barState === 'sun', barState === 'both' || barState === 'earth', earthOnBar) : null,
              sunAboveDeg: nowOnBar && hereOnBar ? nowOnBar.sun_el - horizonAt(hereOnBar.horizon, nowOnBar.sun_az) : null,
              earthAboveDeg: nowOnBar && hereOnBar ? nowOnBar.earth_el - horizonAt(hereOnBar.earthHorizon ?? hereOnBar.horizon, nowOnBar.earth_az) : null,
            }}
            rows={scenarios.map((one, i) => ({
              key: String(i),
              letter: SCENARIO_LETTERS[i],
              label: labels[i],
              full: `${facts[i].site.name} · ${clockTime(start, one.landing)}`,
              flags: facts[i].flags,
              landing: one.landing,
              active: i === active,
            }))}
            missionHours={mission.requirements.missionDays * 24}
            folded={riverMin}
            onFold={setRiverMin}
            onSelect={(key) => setActive(Number(key))}
          />
        </div>
      )}

      <main className="sl-stage">
        <Stage
          sites={dotSites}
          states={states}
          sun={sun}
          earth={earth}
          bare={bare || planner}
          reserveBottom={!plan && !bare ? Math.max(PLAY_CONTROL_ROOM_PX, scoutOpen && room !== 'wide' && scoutHeight > 0 ? scoutHeight + (room === 'phone' ? SHEET_AIR_PX : SCOUT_FOOT_PX) : 0) : shown && !planner ? NOTE_ROOM_PX : 0}
          selectedId={shown ? site.id : (tourStep?.state.ring ?? ringed)}
          focus={shown && !planner && mode === 'site' ? site : null}
          onChoose={openPlan}
          onPoint={setPointed}
          onRecentre={() => setMode('orbit')}
          overlay={shown ? trek.overlay : null}
          layer={shown ? trekLayer(layer) : null}
          fine={shown ? finePhoto : null}
          grid={{ meta: lightGrid.meta, month: lightGrid.month, wide: lightGrid.wide, hour: wantGrid ? index : null, atSite: gridAtSite }}
          onPick={shown ? (lat, lon) => setScenario((current) => ({ ...current, site: `${Number(lat.toFixed(6))},${Number(lon.toFixed(6))}` })) : undefined}
        />
        {/* The column is about the landing; the Moon follows the time bar. When the two differ, say so,
            in the strip kept clear under the Moon, with the two ways to bring them together. */}
        {shown && !planner && mode !== 'surface' && hour !== scenario.landing && (
          <p className="sl-off-landing sl-fade">
            <span>Showing {clockTime(start, hour)}, not the landing</span>
            <button type="button" className="sl-link" title="Put the time bar back on the landing" onClick={() => setHour(scenario.landing)}>
              Back to landing
            </button>
            <button type="button" className="sl-link" data-tour="land" title="Make this moment the landing" onClick={() => setScenario((current) => ({ ...current, landing: hour }))}>
              Land here
            </button>
          </p>
        )}
        {/* Standing at the site: the app's own surface view, inside the stage, on the scenario's site and landing. */}
        {shown && !planner && mode === 'surface' && <iframe className="sl-surface" title="Standing at the site, looking around" src={`/surface/${view}`} />}
        {/* In the Planner the Moon is a small live view: pressing it comes back. */}
        {planner && (
          <button type="button" className="sl-mini-back" aria-label="Back to the Moon" title="Back to the Moon (Esc)" onClick={() => setFull(false)} />
        )}
        {bare && (
          <button type="button" className="sl-handle" title="Show the controls (H)" onClick={showControls}>
            Show controls
          </button>
        )}
        {!bare && !plan && (
          <>
            <header className="sl-brand sl-fade">
              <h1>Sightline</h1>
              <p>Where to land on the Moon, and when</p>
            </header>
            <div className="sl-top sl-fade">
              <button type="button" className="is-main" data-tour="plan" title="Open the planner (P)" onClick={() => openPlan(null)}>
                Plan a landing
              </button>
              <button type="button" title="Hide everything but the Moon (H)" onClick={() => setBare(true)}>
                Hide all
              </button>
            </div>
            {/* While the tour is on, Scout speaks from its bubble instead. */}
            {tourAt === null && <ScoutLine
              offer={tourSeen ? null : { words: TOUR.offer, onTake: startTour, onGone: () => setTourSeen(true) }}
              line={line}
              state={pointedState ?? null}
              open={scoutOpen}
              onOpen={setScoutOpen}
              chat={chat}
              view={watchView}
              onShow={(hash) => {
                // The time bar goes to the moment the reply names, and holds there.
                const link = readScenarioLink(hash, start, hours)
                if (!link) return
                setPlaying(false)
                setHour(link.scenarios[link.active].landing)
              }}
              onPlan={openLink}
              onHeight={setScoutHeight}
            />}
          </>
        )}
        {/* On a phone Scout's open card is a sheet across the bottom, where the play control would be. */}
        {/* What a dot's shape and colour say: both tell what is in view at that site at this moment. */}
        {!bare && !plan && !(scoutOpen && room === 'phone') && (
          <ul className="sl-watch-key sl-fade" aria-label="What the dots mean">
            <li>
              <i className="is-sun" aria-hidden="true" /> Sun
            </li>
            <li>
              <i className="is-earth" aria-hidden="true" /> Earth
            </li>
            <li>
              <i className="is-both" aria-hidden="true" /> Both
            </li>
            <li>
              <i className="is-none" aria-hidden="true" /> Neither
            </li>
          </ul>
        )}
        {!bare && !plan && !(scoutOpen && room === 'phone') && <PlayControl clock={clock} date={clockDate(start, hour)} span={monthSpan(start, hour)} minimised={pillMin} onMinimise={setPillMin} />}
      </main>

      {planner && (
        <FullPlanner
          start={start}
          hours={hours}
          flagged={lit.flagged}
          scenarios={scenarios}
          facts={facts}
          mission={mission}
          onMission={setMission}
          active={active}
          onSelect={setActive}
          onAdd={addScenario}
          onRemove={removeScenario}
          onBack={() => setFull(false)}
          scoutOpen={drawer === 'scout'}
          onScout={() => setDrawer(drawer === 'scout' ? null : 'scout')}
          site={site}
          month={landingAt.month}
          year={Number(landingAt.month.slice(0, 4))}
          summary={here?.summary ?? null}
          landings={shares}
        />
      )}
      {brief && (
        <Suspense fallback={null}>
          <BriefSheet
            start={start}
            scenario={scenario}
            site={site}
            mission={mission}
            room={scenarios.length < MAX_SCENARIOS}
            onLanding={(landing, siteId) => {
              setScenario((current) => ({ site: siteId ?? current.site, landing }))
              setHour(landing)
            }}
            onKeep={addScenario}
            onClose={() => setBrief(false)}
          />
        </Suspense>
      )}
      {how && (
        <div className="sl-how" role="dialog" aria-modal="true" aria-label="How it works">
          <HowItWorks
            data={here}
            siteCount={sites.length}
            backLabel="Back to the Moon"
            onBack={() => {
              setHow(false)
              setHowAtVideo(false)
            }}
            onTour={startTour}
            tourTaken={tourTaken}
            video={tutorialVideo}
            openAtVideo={howAtVideo}
          />
        </div>
      )}
      {shown && drawer === 'scout' && (
        <ScoutPanel
          chat={chat}
          view={scoutView}
          placeholder={`Ask Scout: when can I land at ${site.name}?`}
          state={now ? riverState(now) : null}
          ideas={ideas}
          idea={{
            label: 'Plan for Canada’s utility rover',
            done: 'Mission set to Long stay. The panel on the right says why that is hard at the pole.',
            onPick: () => {
              setMission(ROVER_PRESET.mission)
              setDrawer('rover')
            },
          }}
          onOpen={openAsScenario}
          onClose={() => setDrawer(null)}
        />
      )}
      {shown && !planner && drawer === 'mission' && <MissionDrawer mission={mission} onMission={setMission} onAdvanced={() => setDrawer('advanced')} onClose={() => setDrawer(null)} />}
      {shown && !planner && drawer === 'advanced' && (
        <AdvancedDrawer mission={mission} onMission={setMission} site={site} month={landingAt.month} year={Number(landingAt.month.slice(0, 4))} summary={here?.summary ?? null} onBack={() => setDrawer('mission')} onClose={() => setDrawer(null)} />
      )}
      {shown && !planner && drawer === 'compare' && (
        <CompareDrawer start={start} scenarios={scenarios} facts={facts} mission={mission} active={active} onSelect={setActive} onAdd={() => addScenario({ site: scenario.site, landing: hour })} onClose={() => setDrawer(null)} marginal={scenarios.map((_, i) => marginalAt(i))} />
      )}
      {shown && !planner && drawer === 'rover' && <RoverDrawer onClose={() => setDrawer(null)} />}
      {shown && !planner && drawer === 'layers' && <LayersDrawer layer={layer} onLayer={setLayer} state={trek.state} fine={finePhoto} shade={{ on: shade, here: shadeHere, cellM: lightGrid.meta?.pixel_m ?? null, wideCellM: lightGrid.meta?.wide?.pixel_m ?? null, state: lightGrid.status }} onShade={setShade} onClose={() => setDrawer(null)} />}
      {shown && !planner && (
        <Rail
          mode={mode}
          onMode={setMode}
          onHow={() => setHow(true)}
          onTour={startTour}
          onPlanner={() => {
            // In the Planner the only panel is Scout's.
            if (drawer !== 'scout') setDrawer(null)
            setFull(true)
          }}
          scoutOpen={drawer === 'scout'}
          scoutState={now ? riverState(now) : null}
          onScout={() => setDrawer(drawer === 'scout' ? null : 'scout')}
          missionOpen={drawer === 'mission' || drawer === 'advanced'}
          onMission={toggleMission}
          compareOpen={drawer === 'compare'}
          onCompare={() => setDrawer(drawer === 'compare' ? null : 'compare')}
          layersOpen={drawer === 'layers'}
          layerOn={layer !== null}
          onLayers={() => setDrawer(drawer === 'layers' ? null : 'layers')}
          onHome={goHome}
        />
      )}
    </div>
  )
}
