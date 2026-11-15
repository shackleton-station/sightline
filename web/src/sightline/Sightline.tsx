import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DataRange, SiteInfo } from '../data/contract'
import { customSiteInfo, isCustomSite } from '../data/customSite'
import type { ScenarioData } from '../data/scenarioData'
import type { FlaggedSite } from '../data/useAllFlags'
import { useScenario } from '../data/useScenario'
import { onHypeTyped } from '../components/listenForHype'
import { setAddressBar } from '../lib/address'
import { HYPE_HASH, isHypeWord } from '../lib/hypeEgg'
import { ringedSites } from '../lib/scoutRing'
import { horizonAt } from '../lib/customModel'
import { BASE_HEIGHT_M, DEFAULT_HEIGHTS, heightsWords } from '../lib/heights'
import { chipWords, earthShare as earthShareOf, shortWhen } from '../lib/sightlineSky'
import { landingVerdict, marginalAtLanding } from '../lib/landingVerdict'
import { bodyRadiiDeg } from '../lib/surfaceView'
import { HowItWorks } from '../shell/HowItWorks'
import { hourOf, locateHour, missionEarth } from '../lib/mission'
import { spanStats } from '../lib/missionLight'
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
  marginalHour,
  steadierLanding,
  DEFAULT_MISSION,
  fitProblems,
  nearestFittingSite,
  MAX_SCENARIOS,
  measureScenario,
  missionWords,
  NO_LIMIT_H,
  presetOf,
  readScenarioLink,
  type RemovedScenario,
  type SightlineMission,
  removeScenarioAt,
  restoreScenario,
  SCENARIO_LETTERS,
  scenarioLink,
  surfaceLink,
  type SightlineScenario,
} from '../lib/sightlineMission'
import { whyHard } from '../lib/explainer'
import { ROVER_PRESET } from '../lib/csaRover'
import { type TrekLayerId, trekLayer } from '../lib/trekLayers'
import { layersReach, lightReachKm } from '../lib/layerReach'
import { Answer } from './Answer'
import { ScoutPanel, useScoutChat } from './AskScout'
import { FullPlanner } from './FullPlanner'
import { NewPlanner } from './NewPlanner'
import { type PlannerTab, plannerTabIn, withPlannerTab } from './plannerFit'
import { HeaderTools } from './HeaderTools'
import { SavedBrief, SavedPlanCard } from './PlanNote'
import { planTabTitle } from '../lib/planLink'
import { usePlanLink } from './usePlanLink'
import { HypeDrawer } from './HypeDrawer'
import { Tips } from './Tips'
import { Tour } from './Tour'
import type { GuidesFile, TourFile } from '../lib/tour'
import guidesFile from './guides.json'
import tourFile from './tour.json'
import { AccuracyDrawer } from './AccuracyDrawer'
import { FitLegend } from './FitLegend'
import { useMissionGrid, useMoonShade, useScenarioOdds } from './useMissionGrid'
import { closenessWords } from '../lib/accuracyWords'
import { DEFAULT_SPREAD, oddsWords, readSpreadLink, type Spread, spreadLink, spreadWords } from '../lib/landingOdds'
import { defaultScenarios } from '../lib/defaultPair'
import { NEARBY_PAIR, nearbyPairKm } from '../lib/nearbyPair'
import { CompareDrawer } from './CompareDrawer'
import { nowIso, useClock, useCompact, useIdle, useStored, useYearPositions } from './hooks'
import { useLightGrid } from '../atlas/useLightGrid'
import { cellAt, upSeries } from '../lib/lightGrid'
import { useFinePhoto } from '../data/finePhoto'
import { LayersDrawer } from './LayersDrawer'
import { usePlaceNames } from './usePlaceNames'
import { RoverDrawer } from './RoverDrawer'
import { MissionInline } from './MissionDrawer'
import { useMissionLight } from './useMissionLight'
import { useTrekOverlay } from './useTrekOverlay'
import { Fields, PlanColumn, Verdict } from './PlanColumn'
import { Rail, type StageMode } from './Rail'
import { saveHourlyCsv } from './hourlyExport'
import { River } from './River'
import {RemovedNotice, ScenarioTabs } from './Scenarios'
import { siteValue } from './site'
import { Skyline } from './Skyline'
import { loadScenarioAt } from '../data/heights'
import { firstFitFrom, goodLandingFrom } from '../lib/openingLanding'
import { Stage } from './Stage'
import { bothPct } from './plannerTable'
import { SurfaceFrame } from './SurfaceFrame'
import { useHeightFlags } from './useHeights'
import { useLandingShares, useMissionSunlight, useScenarioFacts } from './useScenarioFacts'
import { useGuideVideos } from './useGuideVideos'
import { ViewSwitch } from './ViewSwitch'
import { PlayControl, ScoutLine } from './WatchControls'

// The brief brings the old Planner page's own code and styles: loaded only when it is opened.
const BriefSheet = lazy(() => import('./BriefSheet'))
/** While time plays in Watch, the controls fade after this long with nothing moved, touched or pressed. */
const FADE_AFTER_MS = 3000
/** Room kept clear under the Moon in Watch for the play control, so the control is never over the Moon's disc. */
const PLAY_CONTROL_ROOM_PX = 64
/** Under this window width Scout's bubble would reach the Moon's disc, so the Moon is fitted above it. */
const NARROW_UNDER_PX = 1180

/**
 * From this window width a panel of Plan's (Compare, Accuracy, Layers) and Scout's both stand beside the Moon: opening
 * one does not shut Scout. Under 1600 px Scout's panel is drawn narrower while the other is open, so the Moon keeps
 * its room; under this width there is no room for both, and the other panel takes Scout's place while it is open.
 */
const BOTH_PANELS_FROM_PX = 1400
/** Under this window width the page is laid out for a phone: Scout's card and panels are sheets. */
const PHONE_UNDER_PX = 761

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
/** How far the tour's step about the time bar moves the bar from the landing, in hours, so the note with "Land here" is on screen. */
const TOUR_BAR_AWAY_H = 36
/** How long a removed scenario can be brought back. */
const UNDO_MS = 5000
/**
 * The easter egg is found for the visit only: nothing is stored, so a reload starts without its
 * button. Earlier versions kept a mark under this key; what is left of it is cleared.
 */
const OLD_HYPE_KEY = 'sightline.hype'
function forgetOldHype(): void {
  try {
    window.sessionStorage.removeItem(OLD_HYPE_KEY)
    window.localStorage.removeItem(OLD_HYPE_KEY)
  } catch {
    // A private window may refuse storage altogether: then there is nothing to clear.
  }
}

/** No sites ringed: one list for every render, so nothing downstream sees a new one each time. */
const NO_SITES: string[] = []

/** Scout's tour: its steps, words and what each rings, from the one file the video's recorder reads too. */
const TOUR = tourFile as TourFile
/** The feature guides: short tours of one feature each, in the main tour's format, run by the same engine. */
const GUIDES = (guidesFile as GuidesFile).guides

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
  // Watch opens on the whole hour nearest now, so the Moon on screen is the Moon now. If the clock is
  // outside the hours on hand, it opens on the data's default month instead.
  const nowHour = Math.round(hourOf(start, nowIso()))
  const opening = nowHour >= 0 && nowHour < hours ? nowHour : Math.min(Math.max(hourOf(start, `${range.default_month}-01T00:00:00Z`), 0), hours - 1)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  // A link that carries a scenario opens Plan on it, paused at its landing, so it shows what was shared.
  const [linked] = useState(() => readScenarioLink(window.location.hash, start, hours))
  const clock = useClock(hours, linked?.scenarios[linked.active].landing ?? opening, !still && !linked, DEFAULT_SPEED)
  const hour = wholeHour(clock.hour, hours)
  const { setPlaying, setHour, playing } = clock

  // The easter egg: the word typed here, or on another page (which opens this one at "#hype"),
  // or sent to Scout as a message of its own, puts a Hype button in the rail and opens its panel.
  // The button stays until the page is reloaded or left: nothing is stored.
  const [arrivedForHype] = useState(() => window.location.hash === HYPE_HASH)
  const [hypeFound, setHypeFound] = useState(arrivedForHype)
  useEffect(forgetOldHype, [])
  const [plan, setPlan] = useState(linked !== null || arrivedForHype)
  // Up to four scenarios, A to D; the column, the skyline and the answer are about the active one.
  // With none in the address, Plan starts with two: the two prospective sites at the same hour, so
  // Compare has something to compare from the first press.
  const [scenarios, setScenarios] = useState<SightlineScenario[]>(() => linked?.scenarios ?? defaultScenarios(sites.map((site) => site.id), opening))
  /** Whether the scenarios are the visitor's own yet: a link's, or Plan has been opened once, or one was added or removed. Until then Plan opens on the default two. */
  const ownPlan = useRef(linked !== null)
  // The landing Plan opened on by itself ("the next landing that fits from today"): said in one quiet
  // line while scenario A is still on it. The refs let the search, which ends a moment after Plan
  // opens, see whether the plan is still the one it was started for.
  const [openedFrom, setOpenedFrom] = useState<number | null>(null)
  const openedAt = useRef<number | null>(null)
  const latestScenarios = useRef<SightlineScenario[]>([])
  const [chosen, setActive] = useState(linked?.active ?? 0)
  const active = Math.min(chosen, scenarios.length - 1)
  const scenario = scenarios[active]
  useEffect(() => {
    latestScenarios.current = scenarios
  }, [scenarios])
  const setScenario = useCallback((change: (current: SightlineScenario) => SightlineScenario) => setScenarios((all) => all.map((one, i) => (i === active ? change(one) : one))), [active])
  const [mission, setMission] = useState(linked?.mission ?? DEFAULT_MISSION)
  // One panel on the right at a time. Scout's conversation lives here, so closing his panel keeps it.
  const [drawer, setDrawer] = useState<'scout' | 'mission' | 'advanced' | 'compare' | 'layers' | 'rover' | 'accuracy' | 'hype' | null>(arrivedForHype ? 'hype' : null)
  // The word sent to Scout as a message of its own (any case, spaces or not) is the easter egg: it is
  // not a question, so it is not sent to the co-pilot or added to the conversation. The only way to
  // it on a phone, which has no keyboard outside a text box.
  const hypeFromScout = useRef<() => void>(() => {})
  const takenByScreen = useCallback((message: string) => {
    if (!isHypeWord(message)) return false
    hypeFromScout.current()
    return true
  }, [])
  const chat = useScoutChat(takenByScreen)
  // The Planner takes the whole window, with the Moon kept small in a corner; How it works opens as a sheet over the scene.
  // A link that names a Planner tab opens the Planner on it.
  const [full, setFull] = useState(() => linked !== null && plannerTabIn(window.location.hash) !== null)
  const [plannerTab, setPlannerTab] = useState<PlannerTab>(() => plannerTabIn(window.location.hash) ?? 'find')
  // Which Planner the whole window shows: the Find and Compare one, or the New Planner (the Planner page's look on this screen's data).
  const [newPlanner, setNewPlanner] = useState(false)
  const [how, setHow] = useState(openHow)
  // The written brief for the scenario on show, as a sheet too.
  const [brief, setBrief] = useState(false)
  // Scout's chat card in Watch: whether it is open, how tall it is, and how wide the window is. On a
  // window too narrow for the card to sit beside the Moon, the Moon moves aside (up) for it.
  // Scout is open unless the visitor shuts him, and always in one place: down the far right edge of
  // the window, right of the rail, as his card in Watch and his panel in Plan. Shutting either is
  // kept for the visit (until the tab is closed), and opening either undoes it. A phone is the
  // exception: there his card and his panel are sheets over the Moon, so they open only when asked for.
  const [scoutShut, setScoutShut] = useStored('scoutShut', false, 'visit')
  const [scoutOpen, setScoutOpen] = useState(() => !scoutShut && window.innerWidth >= PHONE_UNDER_PX)
  const openScout = useCallback(
    (open: boolean) => {
      setScoutOpen(open)
      setScoutShut(!open)
    },
    [setScoutShut],
  )
  const [scoutHeight, setScoutHeight] = useState(0)
  // The Moon glides only while it makes room for the card or takes it back: any other change of size is at once.
  const [gliding, setGliding] = useState(false)
  useEffect(() => {
    setGliding(true)
    const timer = window.setTimeout(() => setGliding(false), GLIDE_MS + 100)
    return () => window.clearTimeout(timer)
  }, [scoutOpen])
  const room = useRoom()
  // The sites a reply of Scout's leads with are ringed on the Moon while that reply is the latest and
  // his card is open: the ones its first sentence names, so the Moon shows what the answer says first.
  const lastSaid = chat.thread.at(-1)
  const ringed = useMemo(() => {
    if (plan || !scoutOpen || !lastSaid || lastSaid.role !== 'assistant' || lastSaid.failed) return NO_SITES
    return ringedSites(lastSaid, sites, (hash) => {
      const link = readScenarioLink(hash, start, hours)
      return link ? link.scenarios[link.active].site : null
    })
  }, [plan, scoutOpen, lastSaid, sites, start, hours])
  // An answer never moves the view. When none of the sites it leads with can be seen where the Moon is
  // turned, the reply offers one button that turns it to the first; after that press the compass
  // carries words, so the way back to the south pole is in plain sight.
  const [ringedHidden, setRingedHidden] = useState(false)
  const [turnTo, setTurnTo] = useState<{ id: string; n: number } | null>(null)
  const [scoutTurned, setScoutTurned] = useState(false)
  const firstRinged = ringed.length > 0 ? sites.find((one) => one.id === ringed[0]) : undefined
  // The Moon Trek layer laid over the south pole, if one is switched on.
  const [layer, setLayer] = useState<TrekLayerId | null>(null)
  // The app's own computed light, as a layer: off by default, so Site view opens on the Moon's own picture.
  const [shade, setShade] = useState(false)
  // Where a landing fits the mission, shaded on the Moon: on from the first time Landing accuracy is opened.
  const [fitShade, setFitShade] = useState(false)
  // The "Place names" layer: off until switched on in Layers; its names are fetched then.
  const [namesOn, setNamesOn] = useState(false)
  const placeNames = usePlaceNames(namesOn)
  // How the lander's misses are spread. Once Landing accuracy has been used, or a link carries it,
  // its odds show under the verdict and in Compare, and the spread rides in the link.
  const [spread, setSpread] = useState<Spread>(() => readSpreadLink(window.location.hash) ?? DEFAULT_SPREAD)
  const [accuracyUsed, setAccuracyUsed] = useState(() => readSpreadLink(window.location.hash) !== null)
  const trek = useTrekOverlay(layer)
  const [mode, setMode] = useState<StageMode>('orbit')
  const [sheet, setSheet] = useState(1)

  const [bare, setBare] = useStored('clear', false)
  const [pillMin, setPillMin] = useStored('pillMin', false)
  const [riverMin, setRiverMin] = useStored('riverMin', false)
  // The skyline strip ("What the lander sees") is open when Plan opens on a laptop (Rodrigo's word of
  // 2026-11-15); on a phone it starts as its bar. Folded, it is one thin bar in the same place, which
  // opens it again. A visitor's own fold is kept for the visit. A link says how the strip stands when
  // that is not how this screen opens it (`sky=0` folded, `sky=1` open), and either word is obeyed.
  // The name is new with that default: a fold stored under the old name, from before the strip opened
  // by itself (the tour and "Hide all" stored one without the visitor folding anything), is not read.
  const [skyStartsFolded] = useState(() => window.innerWidth < 761)
  const [skyMin, setSkyMin] = useStored('skylineFolded', skyStartsFolded, 'visit')
  // In Surface the stage already shows this skyline, twice: there the strip rests as its bar, and
  // opening it there lasts until the view changes. Leaving Surface brings the visitor's own state back.
  const [skyInSurface, setSkyInSurface] = useState(false)
  if (mode !== 'surface' && skyInSurface) setSkyInSurface(false)
  const skyFolded = mode === 'surface' ? !skyInSurface : skyMin
  useEffect(() => {
    const said = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('sky')
    if (said === '1') setSkyMin(false)
    if (said === '0') setSkyMin(true)
    // Read once, as the page opens: after that the fold is the visitor's.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const idle = useIdle(clock.playing && !bare && !plan, FADE_AFTER_MS)
  const [pointed, setPointed] = useState<SiteInfo | null>(null)

  // Scout's tour: which step is on show (null when it is not running), and the screen as the
  // visitor had it, to put back when the tour is closed at any step. It never starts by itself.
  const [tourAt, setTourAt] = useState<number | null>(null)
  /** Which steps are on show: a feature guide's, by its id, or the main tour's (null). */
  const [tourGuide, setTourGuide] = useState<string | null>(null)
  const beforeTour = useRef<{ mission: SightlineMission; plan: boolean; scenarios: SightlineScenario[]; chosen: number; drawer: typeof drawer; full: boolean; plannerTab: PlannerTab; brief: boolean; scoutOpen: boolean; mode: StageMode; sheet: number; bare: boolean; pillMin: boolean; riverMin: boolean; skyMin: boolean; hour: number; playing: boolean } | null>(null)
  /** Whether the tour has put its own landing in Plan yet: once, so what the visitor tries on the way is kept. */
  const tourPlanned = useRef(false)
  /** Whether the visitor has taken the tour: How it works then offers it "again". */
  const [tourTaken, setTourTaken] = useStored('tourTaken', false)
  const guideVideos = useGuideVideos(TOUR, tourAt !== null || how)
  /** How it works opens at its video when the tour's last step asks for it. */
  const [howAtVideo, setHowAtVideo] = useState(false)
  // The Guide opened at "Why this site is hard": Scout's ready idea leads there.
  const [howAtWhy, setHowAtWhy] = useState(false)

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
  // The average sunlight on a panel over each mission: read only while one of the two Compare tables is open.
  const sunlightWm2 = useMissionSunlight(scenarios, facts, start, held, lit.applied, mission.requirements.missionDays, full || drawer === 'compare')
  const marginalAt = (i: number) => marginalAtLanding(mission.requirements, shares[i])
  const marginal = problems && problems.length === 0 ? marginalAt(active) : []
  // The next landing that fits, offered only when this one does not: the first later hour that meets
  // the Sun and Earth limits, moved on, in the same sunlit stretch, to where at least half the Sun's
  // disc shows (and half of Earth's, where the mission needs Earth at landing), once that month's
  // track has loaded. If that month has no such hour, the first is offered and called marginal.
  const firstBetter = flags ? betterDate(flags, scenario.landing, mission) : null
  const betterAt = locateHour(start, firstBetter?.landing ?? scenario.landing)
  const betterMonth = useScenario(plan && firstBetter ? site : null, betterAt.month, held, siteHeights)
  const betterData = betterMonth.data && betterMonth.data.site.id === site.id && betterMonth.data.month === betterAt.month && forHeights(betterMonth.data) ? betterMonth.data : null
  const betterTrack = betterData ? betterData.track : null
  const better = useMemo(() => {
    if (!flags || !firstBetter) return null
    // Without the track (it failed to load) the first hour that meets the limits is offered as it is.
    if (!betterTrack || !betterData) return betterMonth.error && firstBetter.waitH > 0 ? { ...firstBetter, marginal: false } : null
    const sunShares = betterTrack.map((point) => point.sun_frac)
    // Half of Earth's disc shows when its center is above the skyline in its own direction.
    const earthSkyline = betterData.earthHorizon ?? betterData.horizon
    const earthCenterAbove = betterTrack.map((point) => point.earth_el - horizonAt(earthSkyline, point.earth_az) >= 0)
    const monthStart = firstBetter.landing - betterAt.index
    const landing = steadierLanding(flags, firstBetter.landing, mission, sunShares, monthStart, earthCenterAbove)
    return landing === scenario.landing ? null : { landing, waitH: landing - scenario.landing, marginal: marginalHour(mission.requirements, sunShares, earthCenterAbove, landing - monthStart) }
  }, [flags, firstBetter?.landing, firstBetter?.waitH, betterTrack, betterData, betterMonth.error, mission, betterAt.index, scenario.landing])
  // A landing that fits only marginally is offered a steadier hour: the first one after it, in the
  // same sunlit stretch of the same month, where at least half the Sun's disc shows and Earth's
  // center is above the skyline (where the mission needs Earth at landing). The search is the one
  // behind "Next landing that fits" (`steadierLanding`), so the two offers cannot disagree.
  const steadier = useMemo(() => {
    if (!flags || !here || marginal.length === 0) return null
    const sunShares = here.track.map((point) => point.sun_frac)
    const earthSkyline = here.earthHorizon ?? here.horizon
    const earthCenterAbove = here.track.map((point) => point.earth_el - horizonAt(earthSkyline, point.earth_az) >= 0)
    const landing = steadierLanding(flags, scenario.landing, mission, sunShares, scenario.landing - landingAt.index, earthCenterAbove)
    return landing === scenario.landing ? null : { landing }
    // `marginal` is a new list each time the page draws: its words say all that matters here.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [flags, here, marginal.join('|'), mission, scenario.landing, landingAt.index])
  // Another site for the same date, offered with the next landing when this one does not fit: the
  // nearest listed site of the same group where the verdict's own rules pass on this date.
  const misses = problems !== null && problems.length > 0
  const elsewhere = useMemo(() => (misses ? nearestFittingSite(site, scenario.landing, mission, lit.flagged) : null), [misses, site, scenario.landing, mission, lit.flagged])
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
    showScoutPanel()
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
  // Why the site on show is hard, for the Guide: the site's own figures for the landing's month and
  // year, and the mission's longest dark spell from this landing, the hours the verdict judges.
  const why = useMemo(() => {
    if (!here) return null
    const onMission = flags ? { days: mission.requirements.missionDays, sunGapH: measureScenario(scenario, site, flags, mission, facts[active].slopeDeg).sunGapH } : null
    return whyHard(here, onMission)
  }, [here, flags, mission, scenario, site, facts, active])
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
  const view = `${scenarioLink(scenarios, active, start, mission)}${accuracyUsed ? spreadLink(spread) : ''}`
  // In Watch there is no scenario on show: Scout is sent the featured site at the moment on the clock.
  // The link says so (`watch=1`): no site is on the visitor's screen, and "now" is the hour on the time bar.
  const watchView = `${scenarioLink([{ site: scenarios[0].site, landing: hour }], 0, start, mission)}&watch=1`
  // The Surface view stands at the site on show, at the hour on the time bar: the one bar on the screen
  // moves it, as it moves the Moon. Its "Landings that fit" layer stays with the landing.
  const surfaceView = surfaceLink([{ site: scenario.site, landing: hour }], 0, start, mission)
  const surfaceTint = fitShade ? `${surfaceLink(scenarios, active, start, mission)}${accuracyUsed ? spreadLink(spread) : ''}&odds=1` : null
  // The pointer or the keyboard has been on the Surface button: its frame is loaded at once.
  const [surfaceNear, setSurfaceNear] = useState(false)
  // What "add a scenario" adds, said wherever it is offered: the site on show at the hour on the time bar.
  const addWords = `${site.name} · ${clockTime(start, hour)}`
  // The view switch's box on the stage, which Earth's mark keeps clear of.
  const viewSwitchBox = useRef<HTMLDivElement>(null)
  // On a phone the rail's one row carries the three views instead.
  const compact = useCompact()
  // For Scout the link always says which scenario is on show, so the co-pilot reads it as this screen's.
  const scoutView = active > 0 ? view : `${view}&sc=0`
  useEffect(() => {
    // With the Planner open the address also says which of its tabs is on show.
    // The link says when the skyline strip is open, so a shared link opens as its sender saw it.
    const withSky = (link: string) => (skyMin === skyStartsFolded ? link : `${link}&sky=${skyMin ? 0 : 1}`)
    setAddressBar(plan ? withSky(full ? withPlannerTab(view, plannerTab) : view) : window.location.pathname)
  }, [plan, view, full, plannerTab, skyMin, skyStartsFolded])

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
  /** Scout's panel in Plan, opened or shut by the visitor: which is how he is found again in Watch. */
  const toggleScoutPanel = () => {
    if (room === 'phone') {
      setDrawer(drawer === 'scout' ? null : 'scout')
      return
    }
    setScoutOpen(scoutShut)
    setScoutShut(!scoutShut)
  }
  /** Bring Scout's panel up in Plan, for a question asked on the visitor's behalf. */
  const showScoutPanel = () => {
    if (room === 'phone') setDrawer('scout')
    else {
      setScoutOpen(true)
      setScoutShut(false)
    }
  }
  const openLink = useCallback(
    (hash: string) => {
      const link = readScenarioLink(hash, start, hours)
      if (!link) {
        reach(hash)
        return
      }
      // A link's scenarios are the visitor's own: exactly what it carries, nothing added.
      ownPlan.current = true
      setScenarios(link.scenarios)
      setActive(link.active)
      setMission(link.mission)
      const carried = readSpreadLink(hash)
      if (carried) {
        setSpread(carried)
        setAccuracyUsed(true)
      }
      setPlan(true)
      setPlaying(false)
      setHour(link.scenarios[link.active].landing)
    },
    [start, hours, setPlaying, setHour, reach],
  )
  // A saved plan's short link (#plan=<id>): fetched, then opened as a link is, with its panel, skyline and Planner tab.
  const savedPlan = usePlanLink({
    open: openLink,
    panel: setDrawer,
    skyline: (open) => setSkyMin(!open),
    planner: (tab) => {
      setNewPlanner(false)
      setPlannerTab(tab)
      setFull(true)
    },
  })
  // While a saved plan's card is up the tab carries the plan's name; put away, the tab is the scenario's again.
  const savedName = savedPlan.plan?.title ?? null
  useEffect(() => {
    document.title = savedName === null ? title : planTabTitle(savedName)
  }, [savedName, title])
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

  /**
   * Open Plan from Watch, at a site if one was chosen. The first time, the landing is not whatever
   * hour the opening screen had played to (the first verdict was then luck): it is the next landing
   * from the real hour that fits the mission with margin, at the first site; the other prospective
   * site lands at the same hour. Plan opens at once on the first hour the hourly flags allow, and
   * moves to the one with margin as soon as that month has loaded, unless the visitor has changed
   * the plan meanwhile. Coming back to a plan already made keeps it as it was.
   */
  const openPlan = useCallback(
    (chosen: SiteInfo | null) => {
      if (!plan && !ownPlan.current) {
        const first = chosen ? siteValue(chosen) : scenarios[0].site
        const listed = lit.flagged.find((one) => one.site.id === first)
        // The real hour, or the data's default month where the real date is outside it.
        const real = opening
        const opens = listed ? (firstFitFrom(listed.flags, real, mission) ?? real) : hour
        setScenarios(defaultScenarios(sites.map((site) => site.id), opens, first))
        setActive(0)
        setPlaying(false)
        setHour(opens)
        setOpenedFrom(listed ? opens : null)
        openedAt.current = opens
        if (listed) {
          void goodLandingFrom(listed.flags, real, mission, (month) => loadScenarioAt(listed.site, month, held, lit.applied))
            .then((good) => {
              // Only while the plan is still the one just opened: both scenarios on that hour.
              if (!good || good.landing === opens || openedAt.current !== opens) return
              if (!latestScenarios.current.every((one) => one.landing === opens)) return
              openedAt.current = good.landing
              setScenarios(latestScenarios.current.map((one) => ({ ...one, landing: good.landing })))
              setHour(good.landing)
              setOpenedFrom(good.landing)
            })
            // Without that month the plan stays on the first hour the flags allow.
            .catch((reason: unknown) => console.error(reason))
        }
      } else {
        setScenario((current) => ({ site: chosen ? siteValue(chosen) : current.site, landing: current.landing }))
        // Plan opens resting on its landing: time stops there, with play one press away.
        if (!plan) {
          setPlaying(false)
          setHour(scenario.landing)
        }
      }
      ownPlan.current = true
      setPlan(true)
      setPointed(null)
    },
    [plan, hour, opening, setScenario, scenario.landing, sites, scenarios, setPlaying, setHour, lit.flagged, lit.applied, mission, held],
  )
  /** Add a scenario and show it, with the time bar on its landing. With four already, nothing is added. */
  /** The New Planner moved the scenario on show: the Moon, the time bar and the column follow. */
  const moveScenario = useCallback(
    (moved: SightlineScenario) => {
      setScenario(() => moved)
      setHour(moved.landing)
    },
    [setScenario, setHour],
  )
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

  // Why a small change of place matters, ready to look at: two ridge sites a few kilometres apart on
  // one date, as two scenarios with Compare open. Offered by Scout in Watch and by the tour's step on
  // scenarios. Null when the data on hand does not hold both sites and the date.
  const pairKm = useMemo(() => nearbyPairKm(sites), [sites])
  const pairLanding = hourOf(start, NEARBY_PAIR.landing)
  const pairWords = pairKm !== null && Number.isInteger(pairLanding) && pairLanding >= 0 && pairLanding < hours ? `two sites ${pairKm} km apart, same date` : null
  const openPair = useCallback(() => {
    ownPlan.current = true
    setScenarios([
      { site: NEARBY_PAIR.a, landing: pairLanding },
      { site: NEARBY_PAIR.b, landing: pairLanding },
    ])
    setActive(0)
    setRemoved(null)
    setPlan(true)
    setFull(false)
    setScoutOpen(false)
    setPlaying(false)
    setHour(pairLanding)
    setDrawer('compare')
  }, [pairLanding, setPlaying, setHour])

  /** Bringing the controls back always lands on Watch, whatever was open before hiding. */
  const showControls = useCallback(() => {
    setBare(false)
    closePlan()
  }, [setBare, closePlan])

  /**
   * Home: the opening screen as a first visit finds it. Watch, with the controls on show, the Moon
   * at the opening hour with time playing, and Scout's card open as the page opens (not on a phone).
   * The scenarios are kept: "Plan a landing" opens on the same site, landing at the hour on the clock
   * as it always does from Watch.
   */
  const goHome = useCallback(() => {
    showControls()
    setScoutShut(false)
    setScoutOpen(window.innerWidth >= PHONE_UNDER_PX)
    setPillMin(false)
    setHour(opening)
    setPlaying(!still)
  }, [showControls, setScoutShut, setPillMin, setHour, setPlaying, opening, still])
  // The word, typed at this screen outside a text box: the button appears and its panel opens, in
  // Plan (where the rail is), whatever was open. Its letters are also keys of the screen (H hides,
  // P opens Plan), so those have fired on the way: this puts the screen where the word leads.
  const revealHype = useCallback(() => {
    if (tourAt !== null) return
    setHypeFound(true)
    setBare(false)
    setFull(false)
    setHow(false)
    setBrief(false)
    setPlan(true)
    setDrawer('hype')
  }, [tourAt, setBare])
  useEffect(() => onHypeTyped(revealHype), [revealHype])
  useEffect(() => {
    hypeFromScout.current = revealHype
  }, [revealHype])
  useEffect(() => {
    if (arrivedForHype) revealHype()
    // Once, on arriving at "#hype".
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Escape shuts the panel on the right, as Close does (after How it works, the brief and the Planner, which take it first).
  useEffect(() => {
    if (!drawer || how || full || brief || tourAt !== null) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [drawer, how, full, brief, tourAt])

  /** Start the main tour, or a feature guide by its id. Either way the screen as it is now is kept, to put back at the end. */
  const startTour = (guide: string | null = null) => {
    beforeTour.current = { mission, plan, scenarios, chosen, drawer, full, plannerTab, brief, scoutOpen, mode, sheet, bare, pillMin, riverMin, skyMin, hour: clock.hour, playing }
    tourPlanned.current = false
    if (guide === null) setTourTaken(true)
    setHow(false)
    setTourGuide(guide)
    setTourAt(0)
  }
  /** Leave the tour at any step: the screen goes back to how the visitor had it. */
  const endTour = useCallback(() => {
    const was = beforeTour.current
    beforeTour.current = null
    setTourAt(null)
    if (!was) return
    setMission(was.mission)
    setPlan(was.plan)
    setScenarios(was.scenarios)
    setActive(was.chosen)
    setDrawer(was.drawer)
    setFull(was.full)
    setPlannerTab(was.plannerTab)
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
  /**
   * "Done" on the main tour's last step. The visitor stays on the planning screen with the tour's
   * plan, ready to try what they were just shown: nothing is put back but what the tour folded or
   * opened for itself. A feature guide's "Done" puts the screen back, as leaving it does.
   */
  const finishTour = () => {
    if (tourGuide !== null) return endTour()
    const was = beforeTour.current
    beforeTour.current = null
    setTourAt(null)
    ownPlan.current = true
    setOpenedFrom(null)
    setPlan(true)
    setDrawer(null)
    setPlaying(false)
    setHour(scenario.landing)
    if (was) {
      setSkyMin(was.skyMin)
      setRiverMin(was.riverMin)
    }
    setSheet(2)
  }
  // Each step puts the real screen in its state before Scout speaks: Watch or Plan, with nothing
  // else open and time held, so what the step rings is there and stays put.
  // A step about a control only a wide window has is left out on a phone.
  const tourSteps = useMemo(() => (tourGuide === null ? TOUR.steps : (GUIDES.find((guide) => guide.id === tourGuide)?.steps ?? TOUR.steps)).filter((step) => !step.wide || room !== 'phone'), [tourGuide, room])
  const tourStep = tourAt === null ? null : (tourSteps[tourAt] ?? null)
  useEffect(() => {
    if (!tourStep) return
    const { view, show, open, pair } = tourStep.state
    // The rover's guide is about the Long stay example: it is the mission while its steps are on.
    if (tourStep.state.mission === 'long') setMission((current) => ({ ...ROVER_PRESET.mission, heights: current.heights }))
    setBare(false)
    // A step may open the panel it is about; every other panel is shut.
    setDrawer(open === 'compare' || open === 'layers' ? open : null)
    // Or the Planner, on the tab it is about.
    setFull(open === 'planner-find' || open === 'planner-compare')
    if (open === 'planner-find' || open === 'planner-compare') setPlannerTab(open === 'planner-find' ? 'find' : 'compare')
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
    // The main tour's own landing, once: one that does not fit the default mission, so the verdict has a reason and a next landing to show.
    // A feature guide keeps the visitor's own plan, except for a step about several scenarios, which
    // gets the app's two nearby sites on one date, once.
    const landing = hourOf(start, TOUR.scenario.landing)
    // The step about the time bar names "land here", which shows only while the bar is off the landing:
    // the step moves the bar on a day and a half itself, and every other Plan step rests it on the landing.
    if (tourGuide === null && tourPlanned.current) setHour(show === 'time' ? Math.min(scenario.landing + TOUR_BAR_AWAY_H, hours - 1) : scenario.landing)
    if (tourGuide === null) {
      if (!tourPlanned.current && sites.some((listed) => listed.id === TOUR.scenario.site) && Number.isInteger(landing) && landing >= 0 && landing < hours) {
        // Two scenarios, as Plan opens for anyone: the tour's site at A, the other prospective site at B.
        setScenarios(defaultScenarios(sites.map((listed) => listed.id), landing, TOUR.scenario.site))
        setActive(0)
        setHour(landing)
      }
      tourPlanned.current = true
    } else if (pair && !tourPlanned.current && pairWords) {
      setScenarios([
        { site: NEARBY_PAIR.a, landing: pairLanding },
        { site: NEARBY_PAIR.b, landing: pairLanding },
      ])
      setActive(0)
      setHour(pairLanding)
      tourPlanned.current = true
    }
    setPlan(true)
    // The step about the skyline opens it; on every other step it rests as its bar, so each step has
    // the Moon's full room. Leaving the tour puts it back as the visitor had it.
    setSkyMin(show !== 'skyline')
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

  // The mission's limits open in the column, under the mission's own control; the Mission panel is kept for its Advanced controls.
  const [missionHere, setMissionHere] = useState(false)
  const toggleMission = () => setMissionHere((open) => !open)
  // The Sun and Earth over the mission, charted at the column's foot: read while Plan is on show and the mission's limits are shut (open, they take its room).
  const missionLight = useMissionLight(site, scenario.landing, start, held, lit.applied, mission.requirements.missionDays, plan && !full && !missionHere)
  // The Sun and Earth over the whole mission, charted under their rows in the column: the longest time down is from
  // the hourly flags the verdict is worked out from; the charts' lines arrive with the mission's hours.
  const over = useMemo(() => {
    const { missionDays, maxSunGapH, maxEarthGapH } = mission.requirements
    const end = scenario.landing + missionDays * 24
    if (!flags || missionHere || end > flags.sun.length) return null
    return {
      start,
      landing: scenario.landing,
      missionDays,
      sun: {
        ...spanStats(flags.sun, scenario.landing, end),
        limitH: maxSunGapH,
        values: missionLight?.hours.map((one) => one.sunPct) ?? null,
      },
      earth: { ...spanStats(missionEarth(flags, mission.requirements), scenario.landing, end), limitH: maxEarthGapH >= NO_LIMIT_H ? null : maxEarthGapH, values: missionLight?.hours.map((one) => one.earthPct) ?? null },
    }
  }, [flags, missionHere, mission.requirements, scenario.landing, start, missionLight])
  // The landing on show measured over its mission, by Compare's own functions: the column's shares and longest times.
  const columnStats = useMemo(
    () => (flags ? { measure: measureScenario(scenario, site, flags, mission, facts[active].slopeDeg), bothPct: bothPct(flags, scenario.landing, mission) } : null),
    [flags, scenario, site, mission, facts, active],
  )
  const pointedState = pointed ? states.get(pointed.id) : undefined
  const line = pointed && pointedState ? `${pointed.name}: ${STATE_WORDS[pointedState]}.` : 'Pick a site, or just watch.'
  const shown = plan && !bare
  // Close on a site near the pole, the ground is lit from the pipeline's light grid for the hour on
  // the bar: the same grid the Atlas draws. Its months are large, so they are fetched only then.
  // The "Light and shadow" layer, off until asked for: the light grid's months are megabytes, fetched only then.
  // Which layers hold the ground at the site on show, each from what it declares about itself: the
  // Moon Trek maps from their own tiles, the light grid from its own description (a small file, read
  // once; its months are not). Until that description has arrived the grid counts as not reaching.
  const gridMeta = useLightGrid(month, true, false).meta
  const layerReach = useMemo(() => layersReach(site, gridMeta), [site, gridMeta])
  const shadeHere = layerReach.light === true
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
  const savedCard = (inHeader: boolean) => <SavedPlanCard plan={savedPlan.plan} problem={savedPlan.problem} onDismiss={savedPlan.dismiss} inHeader={inHeader} layout={shown ? 'plan' : 'watch'} />
  // Landing accuracy: the light grid read for the landing, for the panel's map and odds, and (when
  // asked for) the same verdicts shaded on the Moon. Its months are megabytes, read only then.
  const missionGrid = useMissionGrid(start, scenario.landing, mission.requirements.missionDays, shown && !planner && drawer === 'accuracy')
  // The shade on the Moon follows the time bar, as the Moon does: it is for a landing at the hour on show.
  const moonShade = useMoonShade(missionGrid.meta, start, hour, mission, spread, shown && !planner && fitShade)
  // Whether the light grid reaches the site on show: only there do the odds know the terrain.
  const fitHere = missionGrid.meta ? cellAt(missionGrid.meta, site.lat, site.lon) !== null : shadeHere
  // Each scenario's odds of landing where the mission fits: read only once Landing accuracy is in use.
  const odds = useScenarioOdds(
    missionGrid.meta,
    start,
    scenarios,
    facts.map((fact) => fact.site),
    mission,
    spread,
    shown && accuracyUsed,
  )
  // A layer of the ground near the south pole is seen close: switching one on from Orbit or Surface
  // goes to Site in the same move. Place names, which cover the whole Moon, change no view. While a
  // tour or guide is on, the view stays where its step put it.
  const closeUp = () => {
    if (mode !== 'site' && tourAt === null) setMode('site')
  }
  // "Landings that fit" as a layer on the Moon, in every view.
  const showFitShade = (on: boolean) => {
    setFitShade(on)
    if (!on) return
    setAccuracyUsed(true)
    // It colors the same ground as NASA's maps, so it takes the place of the one that is on.
    setLayer(null)
  }
  const openAccuracy = () => {
    // Opening it shades the Moon too, in the view the visitor is in; the panel's switch and the key
    // on the Moon take the shading off. Closing the panel leaves it as the visitor set it.
    showFitShade(true)
    setDrawer('accuracy')
  }
  // From Layers the shading is switched on close up, as NASA's maps are.
  const shadeCloseUp = (on: boolean) => {
    if (on) closeUp()
    showFitShade(on)
  }
  // Scout's place down the far right edge, on anything wider than a phone. In Watch it is his open
  // card; in Plan his panel, there unless he was shut, the tour is on, or another panel is open on a
  // window with no room for both beside the Moon.
  const scoutPanel = room === 'phone' ? drawer === 'scout' : !scoutShut && tourAt === null && (planner || drawer === null || drawer === 'scout' || window.innerWidth >= BOTH_PANELS_FROM_PX)
  const docked = room !== 'phone' && !bare && (plan ? false : scoutOpen && tourAt === null)
  const classes = ['scout', 'sightline', shown ? 'is-plan' : 'is-watch', scoutPanel && drawer !== null && drawer !== 'scout' && !planner ? 'has-both-panels' : '', planner ? 'is-full' : '', planner && newPlanner ? 'is-new-planner' : '', gliding && !plan ? 'is-gliding' : '', docked ? 'has-dock' : '', `sheet-${sheet}`, idle ? 'is-idle' : '', bare ? 'is-bare' : ''].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <Tips />
      {tourAt !== null && (
        <Tour
          name={tourGuide === null ? "Scout's tour" : (GUIDES.find((guide) => guide.id === tourGuide)?.name ?? "Scout's tour")}
          steps={tourSteps}
          voice={tourGuide === null ? TOUR : null}
          at={tourAt}
          onStep={setTourAt}
          onClose={endTour}
          onDone={finishTour}
          onVideo={
            guideVideos.walkthrough && tourGuide === null
              ? () => {
                  endTour()
                  setHowAtVideo(true)
                  setHow(true)
                }
              : null
          }
          tryIt={tourStep?.offers === 'nearby-pair' && pairWords ? { label: `Try it: ${pairWords}`, onPick: openPair } : null}
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
              <HeaderTools onBrief={() => setBrief(true)} held={tourStep?.state.open === 'share'} onShowHow={tourAt === null ? () => startTour('share') : null} panel={drawer} />
            </div>
            {/* The scenarios, on a row of their own; the undo notice sits at the row's end for a few seconds, so nothing moves and nothing is over the Moon. */}
            <div className="sl-tabs-row">
              <ScenarioTabs count={scenarios.length} active={active} onSelect={setActive} onAdd={() => addScenario({ site: scenario.site, landing: hour })} adds={addWords} onRemove={removeScenario} />
              {removed && <RemovedNotice letter={SCENARIO_LETTERS[removed.index]} onUndo={undoRemove} />}
            </div>
            <Answer
              data={here}
              now={now}
              flags={flags}
              error={here ? null : error}
              maxSlopeDeg={mission.maxSlopeDeg}
              requirements={mission.requirements}
              stats={columnStats}
              heights={siteHeights}
              heightsLine={heightsLine}
              earthShare={shares[active]?.earth ?? null}
              over={over}
              limitsOpen={missionHere}
              plan={
                <Fields
                  held={tourStep?.state.open === 'custom'}
                  onShowHow={tourAt === null ? () => startTour('custom') : null}
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
                  missionName={`${presetOf(mission)?.label ?? 'Custom mission'} · ${mission.requirements.missionDays} ${mission.requirements.missionDays === 1 ? 'day' : 'days'}`}
                  mission={missionWords(mission)}
                  missionOpen={missionHere}
                  onMission={toggleMission}
                  missionPanel={<MissionInline mission={mission} onMission={setMission} onRover={() => setDrawer('rover')} heightsOff={isCustomSite(site) ? 'A custom point is worked out at 2 m only.' : null} site={site} month={landingAt.month} year={Number(landingAt.month.slice(0, 4))} summary={here?.summary ?? null} />}
                />
              }
              verdict={
                <>
                <Verdict
                  problems={problems}
                  marginal={marginal}
                  next={
                    better && problems && problems.length > 0
                      ? {
                          when: shortWhen(clockTime(start, better.landing), landingAt.month.slice(0, 4)),
                          marginal: better.marginal,
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
                      : steadier
                        ? {
                            when: shortWhen(clockTime(start, steadier.landing), landingAt.month.slice(0, 4)),
                            margin: true,
                            adds: scenarios.length < MAX_SCENARIOS,
                            onTake: () => {
                              // As the next landing that fits: another scenario while there is room; with four already, this landing moves there.
                              if (scenarios.length < MAX_SCENARIOS) addScenario({ site: scenario.site, landing: steadier.landing })
                              else {
                                setScenario((current) => ({ ...current, landing: steadier.landing }))
                                setHour(steadier.landing)
                              }
                            },
                          }
                        : null
                  }
                  elsewhere={
                    elsewhere
                      ? {
                          name: elsewhere.site.name,
                          km: elsewhere.km,
                          adds: scenarios.length < MAX_SCENARIOS,
                          onTake: () => {
                            // As the date line does: another scenario while there is room; with four already, this one moves there.
                            if (scenarios.length < MAX_SCENARIOS) addScenario({ site: elsewhere.site.id, landing: scenario.landing })
                            else {
                              setScenario((current) => ({ ...current, site: elsewhere.site.id }))
                              setHour(scenario.landing)
                            }
                          },
                        }
                      : null
                  }
                  onWhy={askWhy}
                  onMission={() => setMissionHere(true)}
                />
                {/* What a planner asks next when a date or a site slips: the New Planner's own list of
                    other landings, here and nearby, within two weeks of this one. One line that opens it,
                    shown only when the verdict offers no other landing or site itself, so the column keeps its height. */}
                {problems && !steadier && !elsewhere && !(better && problems.length > 0) && (
                  <p className="sl-odds-line">
                    <button
                      type="button"
                      className="sl-link"
                      title="Opens the New Planner at this landing: other landings here and at nearby sites, within two weeks either side, that meet your limits."
                      onClick={() => {
                        if (drawer !== 'scout') setDrawer(null)
                        setNewPlanner(true)
                        setFull(true)
                      }}
                    >
                      If the plan has to move <span aria-hidden="true">›</span>
                    </button>
                  </p>
                )}
                {accuracyUsed && odds[active] !== null && (
                  <p className="sl-odds-line">
                    <button type="button" className="sl-link" title="Opens Landing accuracy: where a lander that misses its target could come down." onClick={openAccuracy}>
                      {oddsWords(odds[active])} of landings fit
                    </button>{' '}
                    at {spreadWords(spread)} accuracy
                  </p>
                )}
                </>
              }
            />
          </PlanColumn>
          {/* The skyline in 2D, with the Sun's and Earth's paths: above the time bar, open when Plan first opens.
              Folded it is one thin bar in the same place, which opens it again. In Surface it rests as that bar. */}
          <Skyline
            horizon={hereOnBar?.horizon ?? null}
            track={hereOnBar?.track ?? null}
            index={index}
            obsHeightM={hereOnBar ? siteHeights.panelM : 0}
            above={{
              sunDeg: nowOnBar && hereOnBar ? nowOnBar.sun_el - horizonAt(hereOnBar.horizon, nowOnBar.sun_az) : null,
              earthDeg: nowOnBar && hereOnBar ? nowOnBar.earth_el - horizonAt(hereOnBar.earthHorizon ?? hereOnBar.horizon, nowOnBar.earth_az) : null,
            }}
            folded={skyFolded}
            onFold={(folded) => (mode === 'surface' ? setSkyInSurface(!folded) : setSkyMin(folded))}
          />
          {/* One time bar, in Orbit, Site and Surface alike: in Surface its hour is the hour stood in. */}
          <River
            start={start}
            hours={hours}
            clock={clock}
            hour={hour}
            moment={{
              state: barState,
              words: barState ? chipWords(barState === 'both' || barState === 'sun', barState === 'both' || barState === 'earth', earthOnBar) : null,
            }}
            rows={scenarios.map((one, i) => ({
              key: String(i),
              letter: SCENARIO_LETTERS[i],
              site: one.site,
              siteName: facts[i].site.name,
              full: `${facts[i].site.name} · ${clockTime(start, one.landing)}`,
              flags: facts[i].flags,
              landing: one.landing,
              active: i === active,
            }))}
            missionHours={mission.requirements.missionDays * 24}
            onHourly={() => saveHourlyCsv({ site, start, landing: scenario.landing, missionDays: mission.requirements.missionDays, years: held, heights: mission.heights })}
            folded={riverMin}
            onFold={setRiverMin}
            onSelect={(key) => setActive(Number(key))}
          />
        </div>
      )}

      <main className="sl-stage">
        {/* What the Moon shows, on its own stage: Orbit, Site, Surface and Layers, in the corner opposite the zoom buttons. */}
        {shown && !planner && !compact && (
          <ViewSwitch
            box={viewSwitchBox}
            mode={mode}
            onMode={setMode}
            onSurfaceNear={() => setSurfaceNear(true)}
            layersOpen={drawer === 'layers'}
            layerOn={layer !== null}
            onLayers={() => setDrawer(drawer === 'layers' ? null : 'layers')}
          />
        )}
        <Stage
          corner={viewSwitchBox}
          sites={dotSites}
          states={states}
          sun={sun}
          earth={earth}
          bare={bare || planner}
          reserveBottom={!plan && !bare ? Math.max(PLAY_CONTROL_ROOM_PX, scoutOpen && room === 'phone' && scoutHeight > 0 ? scoutHeight + SHEET_AIR_PX : 0) : shown && !planner ? NOTE_ROOM_PX : 0}
          selectedId={shown ? site.id : (tourStep?.state.ring ?? null)}
          ringIds={shown || tourStep ? NO_SITES : ringed}
          onRingedHidden={setRingedHidden}
          turnTo={turnTo}
          recentreWords={scoutTurned ? 'Back to the south pole' : null}
          focus={shown && !planner && mode === 'site' ? site : null}
          onChoose={openPlan}
          onPoint={setPointed}
          onRecentre={() => {
            setMode('orbit')
            setScoutTurned(false)
          }}
          overlay={shown ? trek.overlay : null}
          shade={shown ? moonShade : null}
          layer={shown ? trekLayer(layer) : null}
          fine={shown ? finePhoto : null}
          names={shown ? placeNames.features : null}
          grid={{ meta: lightGrid.meta, month: lightGrid.month, wide: lightGrid.wide, hour: wantGrid ? index : null, atSite: gridAtSite }}
          // A click on the Moon away from any dot is a custom point. In Plan it moves the scenario on show
          // there. In Watch it opens Plan at that point, as a dot opens Plan at its site. Nothing with the
          // controls hidden, where the Moon is only looked at, or in Watch while a tour holds the screen.
          onPick={
            shown
              ? (lat, lon) => setScenario((current) => ({ ...current, site: `${Number(lat.toFixed(6))},${Number(lon.toFixed(6))}` }))
              : !plan && !bare && tourAt === null
                ? (lat, lon) => openPlan(customSiteInfo(lat, lon))
                : undefined
          }
        />
        {/* The column is about the landing; the Moon follows the time bar. When the two differ, say so,
            in the strip kept clear under the Moon, with the two ways to bring them together. */}
        {shown && !planner && fitShade && <FitLegend on={fitShade} onToggle={showFitShade} />}
        {/* Where the date came from, while Plan is still on the landing it opened with: one quiet line in the same strip. */}
        {shown && !planner && tourAt === null && openedFrom !== null && hour === scenario.landing && scenarios[0].landing === openedFrom && active === 0 && (
          <p className="sl-off-landing sl-opened-from">The next landing that fits from today</p>
        )}
        {shown && !planner && hour !== scenario.landing && (
          <p className="sl-off-landing sl-fade">
            <span>Not the landing</span>
            <button type="button" className="sl-link" title="Moves the time bar back to the landing hour." onClick={() => setHour(scenario.landing)}>
              Back to landing
            </button>
            <button type="button" className="sl-link" data-tour="land" title="Makes the hour on the time bar the landing." onClick={() => setScenario((current) => ({ ...current, landing: hour }))}>
              Land here
            </button>
          </p>
        )}
        {/* Standing at the site: the app's own surface view, over the stage, at the site on show and the time bar's hour.
            Loaded ahead of the press and kept afterwards, out of sight, so the press only uncovers it. */}
        {shown && <SurfaceFrame visible={!planner && mode === 'surface'} warm={surfaceNear} view={surfaceView} tint={surfaceTint} />}
        {/* In the Planner the Moon is a small live view: pressing it comes back. */}
        {planner && (
          <button type="button" className="sl-mini-back" aria-label="Back to the Moon" title="Closes the Planner and shows the Moon again (Esc)." onClick={() => setFull(false)} />
        )}
        {bare && (
          <button type="button" className="sl-handle" title="Brings the controls back (H)." onClick={showControls}>
            Show controls
          </button>
        )}
        {!bare && !plan && (
          <>
            {/* The title, what the picture is, and the way in never fade by themselves: "Hide all" is the way to a bare Moon. */}
            <header className="sl-brand">
              <h1>Sightline</h1>
              <p>Where to land on the Moon, and when</p>
              <p className="sl-brand-view">Seen from above the south pole</p>
            </header>
            <div className="sl-top">
              <button type="button" className="is-main" data-tour="plan" title="Opens the plan: a site, a landing and a mission to check (P)." onClick={() => openPlan(null)}>
                Plan a landing
              </button>
              <button type="button" title="Hides everything but the Moon (H)." onClick={() => setBare(true)}>
                Hide all
              </button>
            </div>
            {/* While the tour is on, Scout speaks from its bubble instead. */}
            {tourAt === null && <ScoutLine
              idea={pairWords ? { label: `T${pairWords.slice(1)}`, onPick: openPair } : null}
              line={line}
              state={pointedState ?? null}
              open={scoutOpen}
              onOpen={openScout}
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
              turn={
                firstRinged && ringedHidden
                  ? {
                      label: `Show ${firstRinged.name} on the Moon`,
                      onPress: () => {
                        setTurnTo((before) => ({ id: firstRinged.id, n: (before?.n ?? 0) + 1 }))
                        setScoutTurned(true)
                      },
                    }
                  : null
              }
            />}
          </>
        )}
        {/* On a phone Scout's open card is a sheet across the bottom, where the play control would be. */}
        {/* What a dot's shape and colour say: both tell what is in view at that site at this moment. */}
        {!bare && !plan && !(scoutOpen && room === 'phone') && (
          <ul className="sl-watch-key" aria-label="What the dots mean">
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
        {/* The tour, one press away on every visit: a chip under Scout's mark, level with the play control (under the page's name on a narrow window). */}
        {!bare && !plan && tourAt === null && !(scoutOpen && room === 'phone') && (
          <button type="button" className={tourTaken ? 'sl-tour-chip' : 'sl-tour-chip is-new'} title="Scout shows you round the screen, one step at a time." onClick={() => startTour()}>
            <span aria-hidden="true">▶</span> One-minute tour
          </button>
        )}
        {!bare && !plan && !(scoutOpen && room === 'phone') && <PlayControl clock={clock} date={clockDate(start, hour)} span={monthSpan(start, hour)} minimised={pillMin} onMinimise={setPillMin} />}
      </main>

      {planner && newPlanner && (
        <NewPlanner
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
          onScenario={moveScenario}
          onBack={() => setFull(false)}
          scoutOpen={scoutPanel}
          onScout={toggleScoutPanel}
          site={site}
          month={landingAt.month}
          year={Number(landingAt.month.slice(0, 4))}
          summary={here?.summary ?? null}
          landings={shares}
          banner={savedCard(true)}
        />
      )}
      {planner && !newPlanner && (
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
          onChange={(index, next) => setScenarios((all) => all.map((one, i) => (i === index ? next : one)))}
          onAddShown={() => addScenario({ site: scenario.site, landing: hour })}
          onRemove={removeScenario}
          onBack={() => setFull(false)}
          tab={plannerTab}
          onTab={setPlannerTab}
          onBrief={() => setBrief(true)}
          scoutOpen={scoutPanel}
          onScout={toggleScoutPanel}
          site={site}
          month={landingAt.month}
          year={Number(landingAt.month.slice(0, 4))}
          summary={here?.summary ?? null}
          landings={shares}
          sunlightWm2={sunlightWm2}
          dataYears={{ first: range.first_year, last: range.last_year }}
          onYear={(wanted) => onNeed([wanted])}
          landingBounds={{ first: fieldAt(range.start, 0), last: fieldAt(range.start, range.hours - 1) }}
          onFarLanding={(index, value) => {
            // A date the data covers beyond the years on hand is reached by its link, as on the plan; the Planner opens again on Compare.
            const inData = hourFromField(range.start, value, range.hours)
            if (inData === null) return false
            const picked = inData + hourOf(start, range.start)
            reach(withPlannerTab(scenarioLink(scenarios.map((one, i) => (i === index ? { ...one, landing: picked } : one)), active, start, mission), 'compare'))
            return true
          }}
          banner={savedCard(true)}
        />
      )}
      {/* A saved plan's name and note, in sight wherever its link opened: here over the screen, in the Planner as a row of its header. */}
      {!planner && savedCard(false)}
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
            backTo={full ? 'the Planner' : 'the Moon'}
            saved={savedPlan.plan ? <SavedBrief plan={savedPlan.plan} /> : null}
          />
        </Suspense>
      )}
      {how && (
        <div className="sl-how" role="dialog" aria-modal="true" aria-label="Guide">
          <HowItWorks
            data={here}
            siteCount={sites.length}
            backLabel="Back to the Moon"
            onBack={() => {
              setHow(false)
              setHowAtVideo(false)
              setHowAtWhy(false)
            }}
            onTour={() => startTour()}
            tourTaken={tourTaken}
            guides={GUIDES}
            onGuide={startTour}
            videos={guideVideos}
            openAtVideo={howAtVideo}
            why={why}
            openAtWhy={howAtWhy}
            verdict={problems ? landingVerdict(problems, marginal) : null}
          />
        </div>
      )}
      {shown && scoutPanel && (
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
          why={
            why
              ? {
                  label: 'Why is landing here hard?',
                  done: `The Guide is open at “Why this site is hard”, with ${site.name}’s own figures.`,
                  onPick: () => {
                    setHowAtWhy(true)
                    setHow(true)
                  },
                }
              : undefined
          }
          onOpen={openAsScenario}
          onClose={toggleScoutPanel}
          onTour={() => startTour()}
          tourTaken={tourTaken}
        />
      )}
      {shown && !planner && drawer === 'compare' && (
        <CompareDrawer start={start} scenarios={scenarios} facts={facts} mission={mission} active={active} onSelect={setActive} onAdd={() => addScenario({ site: scenario.site, landing: hour })} adds={addWords} odds={accuracyUsed ? odds : undefined} oddsFor={spreadWords(spread)} onClose={() => setDrawer(null)} marginal={scenarios.map((_, i) => marginalAt(i))} landings={shares} sunlightWm2={sunlightWm2} onFull={() => {
          // The full comparison is the Planner's Compare tab; in the Planner the only panel is Scout's.
          setDrawer(null)
          setNewPlanner(false)
          setPlannerTab('compare')
          setFull(true)
        }} />
      )}
      {shown && !planner && drawer === 'rover' && <RoverDrawer long={presetOf(mission)?.id === 'long'} onClose={() => setDrawer(null)} />}
      {shown && !planner && drawer === 'accuracy' && <AccuracyDrawer site={site} mission={mission} grid={missionGrid} spread={spread} onSpread={setSpread} fits={problems ? problems.length === 0 : null} shade={fitShade} onShade={showFitShade} onAim={(lat, lon) => setScenario((current) => ({ ...current, site: `${lat},${lon}` }))} onClose={() => setDrawer(null)} />}
      {shown && !planner && drawer === 'hype' && <HypeDrawer onClose={() => setDrawer(null)} />}
      {shown && !planner && drawer === 'layers' && <LayersDrawer reach={layerReach.trek} lightKm={lightReachKm(gridMeta)} place={site.name} onShowHow={tourAt === null ? () => startTour('views') : null} odds={{ on: fitShade, here: fitHere, lander: closenessWords(spread) }} onOddsDetails={() => setDrawer('accuracy')} onOdds={shadeCloseUp} names={{ on: namesOn, state: placeNames.state }} onNames={setNamesOn} layer={layer} onLayer={(next) => {
            if (next !== null) closeUp()
            // One coloring of the ground at a time: a map takes the place of "Landings that fit".
            if (next !== null) setFitShade(false)
            setLayer(next)
          }} state={trek.state} fine={finePhoto} shade={{ on: shade, here: shadeHere, cellM: lightGrid.meta?.pixel_m ?? null, wideCellM: lightGrid.meta?.wide?.pixel_m ?? null, state: lightGrid.status }} onShade={(on) => {
            if (on) closeUp()
            setShade(on)
          }} onClose={() => setDrawer(null)} />}
      {shown && !planner && (
        <Rail
          mode={mode}
          onMode={setMode}
          onSurfaceNear={() => setSurfaceNear(true)}
          onBrief={() => setBrief(true)}
          onHow={() => setHow(true)}
          hype={hypeFound ? { open: drawer === 'hype', onOpen: () => setDrawer(drawer === 'hype' ? null : 'hype') } : null}
          onTour={() => startTour()}
          onPlanner={() => {
            // In the Planner the only panel is Scout's.
            if (drawer !== 'scout') setDrawer(null)
            setNewPlanner(false)
            setFull(true)
          }}
          onNewPlanner={() => {
            if (drawer !== 'scout') setDrawer(null)
            setNewPlanner(true)
            setFull(true)
          }}
          scoutOpen={scoutPanel}
          scoutState={now ? riverState(now) : null}
          onScout={toggleScoutPanel}
          compareOpen={drawer === 'compare'}
          onCompare={() => setDrawer(drawer === 'compare' ? null : 'compare')}
          accuracyOpen={drawer === 'accuracy'}
          onAccuracy={() => (drawer === 'accuracy' ? setDrawer(null) : openAccuracy())}
          layersOpen={drawer === 'layers'}
          layerOn={layer !== null}
          onLayers={() => setDrawer(drawer === 'layers' ? null : 'layers')}
          onHome={goHome}
        />
      )}
    </div>
  )
}
