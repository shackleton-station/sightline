import { ANTENNA_HEIGHTS_M, BASE_HEIGHT_M, DEFAULT_HEIGHTS, heightFrom, heightsWords, isBaseHeights, type MissionHeights, PANEL_HEIGHTS_M } from './heights'
import { diskShareWords } from './answer'
import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from './flags'
import { EARTH_CLEARANCES_DEG, hourOf, landingProblems, locateHour, missionEarth, NO_GAP_LIMIT_H, type Requirements } from './mission'
import { entryAt, GAP_TIE_H, measureEntry, toIso } from './shortlist'
import { distanceKm, nextViable } from './slip'
import { decodeView, encodeView } from './urlState'

/**
 * Sightline's scenarios and the mission they are judged against. A scenario is a site and a landing
 * date; the mission is shared by all scenarios. Both travel in the app's own link format, with two
 * one more value the other pages ignore (the steepest ground).
 */

/** A scenario: where and when to land. */
export interface SightlineScenario {
  /** A listed site's id, or "lat,lon" for a custom point, as the app's links write it. */
  site: string
  /** The landing time, in whole hours from the start of the data. */
  landing: number
}

/**
 * "No limit" on a gap, as a number the app's links can carry: longer than all the data, so no gap
 * can exceed it.
 */
export const NO_LIMIT_H = NO_GAP_LIMIT_H

/**
 * The limits a first visit is judged against (the build brief's defaults): 14 days, 24 h of dark
 * survived, the Sun and Earth up at landing, no limit on radio silence, any part of Earth counting.
 * With these the answer is plain visibility, which is what the challenge asks.
 */
export const DEFAULT_REQUIREMENTS: Requirements = {
  missionDays: 14,
  maxSunGapH: 24,
  maxEarthGapH: NO_LIMIT_H,
  sunAtLanding: true,
  earthAtLanding: true,
  minEarthClearanceDeg: 0,
}

/** The steepest ground the default mission lands on, in degrees. */
export const DEFAULT_MAX_SLOPE_DEG = 10

/**
 * What the mission can tolerate: the app's limits, plus the ground's slope, and how high its solar
 * panel and antenna stand. Inputs, not results.
 */
export interface SightlineMission {
  requirements: Requirements
  maxSlopeDeg: number
  heights: MissionHeights
}

export const DEFAULT_MISSION: SightlineMission = { requirements: DEFAULT_REQUIREMENTS, maxSlopeDeg: DEFAULT_MAX_SLOPE_DEG, heights: DEFAULT_HEIGHTS }

/**
 * The ranges the mission drawer offers. The mission's length and the darkness it survives stay near
 * the default mission (14 days, 24 h), up to a month and a week, so the values a planner is likely
 * to try take most of each slider's travel. A preset or a link can carry more (the long stay does):
 * the slider then stretches to that value.
 */
export const MISSION_RANGES = {
  missionDays: { min: 1, max: 30, step: 1 },
  maxSunGapH: { min: 0, max: 168, step: 4 },
  maxSlopeDeg: { min: 5, max: 20, step: 1 },
}
/**
 * The longest radio silence is a slider with the longest dark's steps, with one more stop after its
 * last hour: no limit. It runs further than the longest dark, because near the south pole Earth is
 * below the skyline for about two weeks at a time. A link still carries "no limit" as NO_LIMIT_H hours.
 */
export const SILENCE_RANGE = { min: 0, max: 400, step: MISSION_RANGES.maxSunGapH.step }
export const SILENCE_NO_LIMIT_STOP = SILENCE_RANGE.max + SILENCE_RANGE.step

/** Where the radio-silence slider sits for a limit in hours: its last stop for no limit. */
export function silenceStop(maxEarthGapH: number): number {
  return maxEarthGapH >= NO_LIMIT_H ? SILENCE_NO_LIMIT_STOP : Math.min(maxEarthGapH, SILENCE_RANGE.max)
}

/** The limit in hours for a stop of the radio-silence slider. */
export function silenceHours(stop: number): number {
  return stop > SILENCE_RANGE.max ? NO_LIMIT_H : stop
}

/** A scenario taken off the list, with what is needed to put it back. */
export interface RemovedScenario {
  scenario: SightlineScenario
  /** Where it was, and which scenario was on show, before it was removed. */
  index: number
  active: number
}

/**
 * The scenarios without one of them. The rest keep their order (and so are re-lettered without a
 * gap). If the removed one was on show, the one that takes its place is shown, or the one before it
 * if it was the last; otherwise the same scenario stays on show.
 */
export function removeScenarioAt(scenarios: SightlineScenario[], active: number, index: number): { scenarios: SightlineScenario[]; active: number; removed: RemovedScenario } | null {
  if (scenarios.length < 2 || index < 0 || index >= scenarios.length) return null
  const rest = scenarios.filter((_, i) => i !== index)
  const next = index < active ? active - 1 : Math.min(active, rest.length - 1)
  return { scenarios: rest, active: next, removed: { scenario: scenarios[index], index, active } }
}

/** A removal undone: the scenario back where it was, with the same one on show as before, if there is still room. */
export function restoreScenario(scenarios: SightlineScenario[], removed: RemovedScenario): { scenarios: SightlineScenario[]; active: number } | null {
  if (scenarios.length >= MAX_SCENARIOS) return null
  const index = Math.min(removed.index, scenarios.length)
  return { scenarios: [...scenarios.slice(0, index), removed.scenario, ...scenarios.slice(index)], active: Math.min(removed.active, scenarios.length) }
}
/** How far Earth's center must clear the ridge: any part showing, or a clearance the data has flags for. */
export const CLEARANCE_CHOICES_DEG = [0, ...EARTH_CLEARANCES_DEG]

/**
 * The presets, named by what the mission needs, not by the vehicle. Every value is an example to
 * start from, not a real spacecraft's figure. The short stay is the default mission: 14 Earth
 * days. The long stay is 60 Earth days and lasts through 14 days of darkness. It sets no limit on
 * radio silence: near the south pole Earth is below the skyline for about two weeks at a time, so a
 * two-day limit ruled out almost every site. The page says "darkness", never "lunar night" or "lunar day": near the
 * south pole the terrain decides when a site is lit, so those terms mislead.
 */
export const PRESETS: { id: string; label: string; mission: SightlineMission }[] = [
  { id: 'short', label: 'Short stay', mission: DEFAULT_MISSION },
  {
    id: 'long',
    label: 'Long stay',
    mission: {
      requirements: { missionDays: 60, maxSunGapH: 336, maxEarthGapH: NO_LIMIT_H, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 },
      maxSlopeDeg: 15,
      heights: DEFAULT_HEIGHTS,
    },
  },
]

/** The preset a mission matches exactly, or null when it is a custom one. The heights are the hardware's, not a limit: they do not make a mission custom. */
export function presetOf(mission: SightlineMission): { id: string; label: string } | null {
  const same = (a: SightlineMission, b: SightlineMission) =>
    a.maxSlopeDeg === b.maxSlopeDeg && (Object.keys(a.requirements) as (keyof Requirements)[]).every((key) => a.requirements[key] === b.requirements[key])
  return PRESETS.find((preset) => same(preset.mission, mission)) ?? null
}

/** At most this many scenarios: A, B, C and D. */
export const MAX_SCENARIOS = 4
export const SCENARIO_LETTERS = 'ABCD'

const HOUR_MS = 3_600_000
const hourIso = (startIso: string, hour: number) => `${new Date(Date.parse(startIso) + hour * HOUR_MS).toISOString().slice(0, 19)}Z`

/**
 * The app's own link for the scenarios, so the other pages open on the same site, hour and limits.
 * Scenario A is the link's site and hour; B to D ride in its shortlist, which is what they are: other
 * places and dates being weighed. `sc` says which one is on show, when it isn't A.
 */
export function scenarioLink(scenarios: SightlineScenario[], active: number, startIso: string, mission: SightlineMission): string {
  const [first, ...others] = scenarios
  const { month, index } = locateHour(startIso, first.landing)
  const shortlist = others.map((scenario) => ({ site: scenario.site, at: entryAt(hourIso(startIso, scenario.landing)) }))
  const link = encodeView({ a: { site: first.site, month }, b: null, index, requirements: mission.requirements, view3d: false, mode: 'plan', shortlist })
  // Values the other pages don't know and ignore, written only when they differ from the default.
  const slope = mission.maxSlopeDeg === DEFAULT_MAX_SLOPE_DEG ? '' : `&slope=${mission.maxSlopeDeg}`
  // The panel's and the antenna's heights in metres, each only when it is not the app's own 2 m.
  const panel = mission.heights.panelM === BASE_HEIGHT_M ? '' : `&hp=${mission.heights.panelM}`
  const antenna = mission.heights.antennaM === BASE_HEIGHT_M ? '' : `&ha=${mission.heights.antennaM}`
  return `${link}${slope}${panel}${antenna}${active > 0 ? `&sc=${active}` : ''}`
}

/**
 * The link for Sightline's Surface view: the scenario on show as the link's own site and hour. The
 * Surface page reads only the link's first place, so a scenario other than A must be put there, or
 * the view would stay on A's site and date while the side panel shows another.
 */
export function surfaceLink(scenarios: SightlineScenario[], active: number, startIso: string, mission: SightlineMission): string {
  const shown = scenarios[active] ?? scenarios[0]
  return scenarioLink([shown], 0, startIso, mission)
}

/** The scenarios and mission a link carries; null if it carries none or its first points outside the data. */
export function readScenarioLink(hash: string, startIso: string, hours: number): { scenarios: SightlineScenario[]; active: number; mission: SightlineMission } | null {
  const view = decodeView(hash, DEFAULT_REQUIREMENTS)
  if (!view) return null
  const inData = (landing: number) => Number.isInteger(landing) && landing >= 0 && landing < hours
  const landing = hourOf(startIso, `${view.a.month}-01T00:00:00Z`) + view.index
  if (!inData(landing)) return null
  const others = view.shortlist.map((entry) => ({ site: entry.site, landing: hourOf(startIso, toIso(entry.at)) })).filter((scenario) => inData(scenario.landing))
  const scenarios = [{ site: view.a.site, landing }, ...others].slice(0, MAX_SCENARIOS)
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const slope = Number(params.get('slope') ?? DEFAULT_MAX_SLOPE_DEG)
  const { min, max } = MISSION_RANGES.maxSlopeDeg
  const active = Number(params.get('sc') ?? 0)
  return {
    scenarios,
    active: Number.isInteger(active) && active > 0 && active < scenarios.length ? active : 0,
    mission: {
      requirements: view.requirements,
      // An old link may still carry "panel": the choice was removed, so it is read past.
      maxSlopeDeg: Number.isFinite(slope) ? Math.min(Math.max(Math.round(slope), min), max) : DEFAULT_MAX_SLOPE_DEG,
      heights: { panelM: heightFrom(params.get('hp'), PANEL_HEIGHTS_M), antennaM: heightFrom(params.get('ha'), ANTENNA_HEIGHTS_M) },
    },
  }
}

/**
 * Why a landing doesn't fit the mission; empty means it fits. The Sun and Earth reasons are the
 * app's own (`landingProblems`); the ground's slope is checked here against the mission's limit.
 */
export function fitProblems(flags: SiteFlags, landing: number, mission: SightlineMission, slopeDeg: number | null): string[] {
  const problems = landingProblems(flags.sun, missionEarth(flags, mission.requirements), landing, mission.requirements)
  if (slopeDeg !== null && slopeDeg > mission.maxSlopeDeg) problems.push(`The ground slopes ${slopeDeg.toFixed(1)}°; your limit is ${mission.maxSlopeDeg}°.`)
  return problems
}

/** The mission in a few words, for the "For" field. */
export function missionWords({ requirements, maxSlopeDeg, heights }: SightlineMission): string {
  const atLanding = [requirements.sunAtLanding ? 'the Sun' : null, requirements.earthAtLanding ? 'Earth' : null].filter((body) => body !== null)
  return [
    `${requirements.missionDays} days on the surface`,
    `survives ${requirements.maxSunGapH} h of darkness`,
    ...(atLanding.length > 0 ? [`${atLanding.join(' and ')} up at landing`] : []),
    ...(requirements.maxEarthGapH < NO_LIMIT_H ? [`at most ${requirements.maxEarthGapH} h of radio silence`] : []),
    `ground up to ${maxSlopeDeg}°`,
    ...(isBaseHeights(heights) ? [] : [heightsWords(heights) as string]),
  ].join(', ')
}

/** A scenario measured against the mission, from its landing to the mission's end: one column of Compare. */
export interface ScenarioMeasure {
  /** Share of the mission with the Sun up, and with Earth in view, in percent; null if it runs past the data. */
  sunPct: number | null
  earthPct: number | null
  /** Longest time without each during the mission, in hours. */
  sunGapH: number | null
  earthGapH: number | null
  slopeDeg: number | null
  /** Why it doesn't fit the mission; empty if it does. */
  problems: string[]
}

/**
 * One scenario against the mission. The Sun share, the two gaps and the reasons are the shortlist's
 * own measure (`measureEntry`); Earth's share is counted the same way, and the slope is the site's.
 */
export function measureScenario(scenario: SightlineScenario, site: SiteInfo, flags: SiteFlags, mission: SightlineMission, slopeDeg: number | null): ScenarioMeasure {
  const entry = { site: scenario.site, at: entryAt(hourIso(flags.start, scenario.landing)) }
  const measured = measureEntry(entry, site, flags, mission.requirements)
  const end = scenario.landing + mission.requirements.missionDays * 24
  let earthPct: number | null = null
  if (measured.sunPct !== null && end > scenario.landing) {
    const earth = missionEarth(flags, mission.requirements)
    let up = 0
    for (let hour = scenario.landing; hour < end; hour += 1) if (earth[hour]) up += 1
    earthPct = (100 * up) / (end - scenario.landing)
  }
  const problems = [...measured.problems]
  if (slopeDeg !== null && slopeDeg > mission.maxSlopeDeg) problems.push(`The ground slopes ${slopeDeg.toFixed(1)}°; your limit is ${mission.maxSlopeDeg}°.`)
  return { sunPct: measured.sunPct, earthPct, sunGapH: measured.sunGapH, earthGapH: measured.earthGapH, slopeDeg, problems }
}

/** The rows of Compare that have a best value, with which way is better and how close counts as a tie. */
export const COMPARE_ROWS: { key: 'sunPct' | 'sunGapH' | 'earthPct' | 'earthGapH' | 'slopeDeg'; label: string; digits: number; better: 'high' | 'low'; tie: number; share?: true }[] = [
  // The unit is in the row's name, so each cell leads with a bare number and four scenarios fit side by side.
  // A row that is a share of the mission also says the hours behind it (`shareHours`).
  { key: 'sunPct', label: 'Sunlit, %', digits: 0, better: 'high', tie: 0.5, share: true },
  // Hourly data can't separate gaps closer than GAP_TIE_H, so those share the mark.
  { key: 'sunGapH', label: 'Longest dark spell, h', digits: 0, better: 'low', tie: GAP_TIE_H },
  { key: 'earthPct', label: 'Earth in view, %', digits: 0, better: 'high', tie: 0.5, share: true },
  { key: 'earthGapH', label: 'Longest radio silence, h', digits: 0, better: 'low', tie: GAP_TIE_H },
  { key: 'slopeDeg', label: 'Slope, °', digits: 1, better: 'low', tie: 0.05 },
]

/**
 * The hours behind a share of the mission, as "12 of 24 h". Each share is a count of whole hours over
 * the mission's length, so rounding gives that count back.
 */
export function shareHours(pct: number, missionDays: number): string {
  const missionH = missionDays * 24
  return `${Math.round((pct / 100) * missionH)} of ${missionH} h`
}

/** Which values in a row are the best: those within a tie of the best one. None when there is nothing to choose between. */
export function bestIn(values: (number | null)[], better: 'high' | 'low', tie: number): boolean[] {
  const known = values.filter((value): value is number => value !== null)
  if (known.length < 2) return values.map(() => false)
  const best = better === 'high' ? Math.max(...known) : Math.min(...known)
  const marks = values.map((value) => value !== null && Math.abs(value - best) <= tie)
  // If every scenario shares the best value, marking them all says nothing.
  return marks.every((mark, i) => mark || values[i] === null) && known.length === values.length ? values.map(() => false) : marks
}

/** Under this share of the Sun's disc in view, the Sun's centre is below the skyline: a landing then is called marginal. */
export const MARGINAL_SUN_SHARE = 0.5

/**
 * What makes a landing that fits only marginal: "5% of the Sun at landing", when less than half the
 * Sun's disc is in view at that hour. Null when at least half is, when the Sun is down, or when the
 * share is not known.
 */
export function marginalWords(sunShare: number | null): string | null {
  return sunShare !== null && sunShare > 0 && sunShare < MARGINAL_SUN_SHARE ? `${diskShareWords(sunShare)} of the Sun at landing` : null
}

/**
 * A steadier hour for a landing: the first hour at or after it, in the same unbroken sunlit stretch,
 * with at least half the Sun's disc in view and still meeting the Sun and Earth limits. `shares` holds
 * the Sun's share for each hour of one month, the first at clock hour `monthStart`. Returns the
 * landing itself when the stretch has no such hour inside that month.
 */
export function steadierLanding(flags: SiteFlags, landing: number, mission: SightlineMission, shares: number[], monthStart: number): number {
  const earth = missionEarth(flags, mission.requirements)
  for (let hour = landing; hour < flags.sun.length && flags.sun[hour]; hour += 1) {
    const share = shares[hour - monthStart]
    if (share === undefined) break
    if (share >= MARGINAL_SUN_SHARE && landingProblems(flags.sun, earth, hour, mission.requirements).length === 0) return hour
  }
  return landing
}

/**
 * A better date nearby: the first landing at or after this one that the Sun and Earth limits allow,
 * from the app's date-slip search (`nextViable`). Null when this landing already meets them, or
 * when no later one in the data does.
 */
export function betterDate(flags: SiteFlags, landing: number, mission: SightlineMission): { landing: number; waitH: number } | null {
  const problems = landingProblems(flags.sun, missionEarth(flags, mission.requirements), landing, mission.requirements)
  if (problems.length === 0) return null
  const next = nextViable(flags, hourIso(flags.start, landing), mission.requirements)
  return next && next.waitH > 0 ? { landing: landing + next.waitH, waitH: next.waitH } : null
}

/**
 * Another site for the same landing, offered when this one does not fit: the nearest listed site of
 * the same group (the south pole ridges, say) where the same hour does fit the same mission, judged
 * by the verdict's own function (`fitProblems`) on that site's flags and slope. Null when the site
 * has no group of listed sites (a custom point), or when the landing fits at none of them.
 */
export function nearestFittingSite(site: SiteInfo, landing: number, mission: SightlineMission, listed: { site: SiteInfo; flags: SiteFlags }[]): { site: SiteInfo; km: number } | null {
  return (
    listed
      .filter((other) => other.site.id !== site.id && other.site.group === site.group && fitProblems(other.flags, landing, mission, other.site.slope?.deg ?? null).length === 0)
      .map((other) => ({ site: other.site, km: distanceKm(site, other.site) }))
      .sort((a, b) => a.km - b.km)[0] ?? null
  )
}

const ROW_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ROW_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** What a river row is called beside its letter: its landing's date, its site, or both. */
export interface RowLabel {
  /** The landing's date as the row writes it, or null when every scenario lands on the same day and the site tells them apart. */
  date: string | null
  /** The site's name, or null when every scenario is at the same site and the date tells them apart. */
  site: string | null
}

/**
 * The river's row labels say only what differs between the rows. All at one site: the landing's
 * date, in full with its year. All on one day at different sites: the site. Both differ: the date
 * with a short month (and its year only if the landings are in different years), then the site.
 * Two landings at one site on one day also give their hour.
 */
export function rowLabels(scenarios: SightlineScenario[], siteNames: string[], startIso: string): RowLabel[] {
  const at = scenarios.map((scenario) => new Date(Date.parse(startIso) + scenario.landing * HOUR_MS))
  const day = (date: Date) => date.toISOString().slice(0, 10)
  const oneSite = scenarios.every((scenario) => scenario.site === scenarios[0].site)
  const oneDay = at.every((date) => day(date) === day(at[0]))
  const oneYear = at.every((date) => date.getUTCFullYear() === at[0].getUTCFullYear())
  return scenarios.map((scenario, i) => {
    const date = at[i]
    // Two landings at one site on one day are told apart by the hour.
    const twin = scenarios.some((other, k) => k !== i && other.site === scenario.site && day(at[k]) === day(date))
    const hour = twin ? ` ${String(date.getUTCHours()).padStart(2, '0')}:00` : ''
    if (oneSite) return { date: `${date.getUTCDate()} ${ROW_MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}${hour}`, site: null }
    if (oneDay) return { date: null, site: siteNames[i] }
    return { date: `${date.getUTCDate()} ${ROW_MONTHS[date.getUTCMonth()]}${oneYear ? '' : ` ${date.getUTCFullYear()}`}${hour}`, site: siteNames[i] }
  })
}
