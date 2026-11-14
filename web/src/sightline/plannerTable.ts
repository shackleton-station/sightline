import type { SiteFlags } from '../lib/flags'
import type { LandingShares } from './useScenarioFacts'
import { missionEarth } from '../lib/mission'
import { degWords, isoAt } from '../lib/sightline'
import { bestIn, COMPARE_ROWS, type ScenarioMeasure, SCENARIO_LETTERS, shareHours, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'

/** One row of the Full planner's table: a name, a cell per scenario, and which cells are the best. */
export interface PlannerRow {
  key: string
  label: string
  /** What the row measures, for its name's hover text, where the name alone does not say. */
  title?: string
  /** What each scenario's cell says; null while its site is still being worked out. */
  cells: (string | null)[]
  /** The hours behind each cell that is a share of the mission ("12 of 24 h"); null for any other cell. */
  notes: (string | null)[]
  best: boolean[]
}

/**
 * Share of the mission with the Sun up and Earth in view at the same hour, in percent, counted the
 * way Compare counts Earth alone. Null when the mission runs past the end of the data.
 */
export function bothPct(flags: SiteFlags, landing: number, mission: SightlineMission): number | null {
  const end = landing + mission.requirements.missionDays * 24
  if (end > flags.sun.length || end <= landing) return null
  const earth = missionEarth(flags, mission.requirements)
  let up = 0
  for (let hour = landing; hour < end; hour += 1) if (flags.sun[hour] && earth[hour]) up += 1
  return (100 * up) / (end - landing)
}

/**
 * The table's rows with a number in them: Compare's five, the share of the mission with both the
 * Sun and Earth, and, where the caller has it, the average sunlight on a panel (each scenario's is
 * undefined while its months load, null if it cannot be worked out). Every one is engineering; the app has no science measure
 * (such as the distance to permanent shadow), so there are no science rows.
 */
export function plannerRows(scenarios: SightlineScenario[], measures: (ScenarioMeasure | null)[], flags: (SiteFlags | null)[], mission: SightlineMission, sunlightWm2?: (number | null | undefined)[]): PlannerRow[] {
  const write = (value: number | null, known: boolean, digits: number) => (value === null ? (known ? '?' : null) : value.toFixed(digits))
  const hours = (value: number | null) => (value === null ? null : shareHours(value, mission.requirements.missionDays))
  const rows: PlannerRow[] = COMPARE_ROWS.map((row) => {
    const values = measures.map((measure) => measure?.[row.key] ?? null)
    return {
      key: row.key,
      label: row.label,
      cells: values.map((value, i) => write(value, measures[i] !== null, row.digits)),
      notes: values.map((value) => (row.share ? hours(value) : null)),
      best: bestIn(values, row.better, row.tie),
    }
  })
  const both = scenarios.map((scenario, i) => {
    const site = flags[i]
    return site ? bothPct(site, scenario.landing, mission) : null
  })
  rows.splice(4, 0, { key: 'bothPct', label: 'Sun and Earth together, %', cells: both.map((value, i) => write(value, flags[i] !== null, 0)), notes: both.map(hours), best: bestIn(both, 'high', 0.5) })
  if (sunlightWm2) {
    const sunlight = sunlightWm2.map((value) => value ?? null)
    rows.splice(5, 0, {
      key: 'sunlightWm2',
      label: 'Sunlight on a panel, W/m²',
      title: SUNLIGHT_MEANS,
      cells: sunlight.map((value, i) => write(value, sunlightWm2[i] !== undefined, 0)),
      notes: sunlight.map(() => null),
      best: bestIn(sunlight, 'high', SUNLIGHT_TIE_W_M2),
    })
  }
  return rows
}

/** What the sunlight row is, in its name's hover text: the app has no panel of its own, so it gives sunlight, not electrical power. */
const SUNLIGHT_MEANS =
  'Average over the mission on a vertical panel that turns to face the Sun, counting how much of the Sun is in view each hour. Before any panel losses: multiply by the panel\'s area and efficiency for electrical power.'
/** Sunlight this close shares the best mark: about the half point the Sun's share of the mission ties at, of the Sun's full 1361 W/m². */
const SUNLIGHT_TIE_W_M2 = 7

/** How the two angles at landing are measured, for their names' hover text. */
const FROM_LEVEL = 'At landing, measured from a level horizon.'
const ABOVE_SKYLINE = 'At landing: how far its centre is above the ridge line in its own direction. Negative when the ridge hides its centre.'

/**
 * The Sun's and Earth's angles at each landing: from level, and above the skyline. Units in the
 * row's name, as in the rows above; no best mark, because neither angle is a limit of the mission.
 */
export function landingRows(landings: (LandingShares | null)[]): PlannerRow[] {
  const row = (key: string, label: string, title: string, pick: (landing: LandingShares) => number): PlannerRow => ({
    key,
    label,
    title,
    cells: landings.map((landing) => (landing ? degWords(pick(landing)).replace('°', '') : null)),
    notes: landings.map(() => null),
    best: landings.map(() => false),
  })
  return [
    row('sunElDeg', "Sun's elevation, °", FROM_LEVEL, (landing) => landing.sunElDeg),
    row('sunAboveDeg', 'Sun above the skyline, °', ABOVE_SKYLINE, (landing) => landing.sunAboveDeg),
    row('earthElDeg', "Earth's elevation, °", FROM_LEVEL, (landing) => landing.earthElDeg),
    row('earthAboveDeg', 'Earth above the skyline, °', ABOVE_SKYLINE, (landing) => landing.earthAboveDeg),
  ]
}

/** One field of a CSV line: quoted when it holds a comma, a quote or a line break. */
function field(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The table as CSV: a column per scenario, headed by its letter, site and landing time (UTC), then
 * the rows as the page shows them, whether each fits the mission (with the reasons if not), and the
 * mission's limits in words.
 */
export function plannerCsv(start: string, scenarios: SightlineScenario[], siteNames: string[], rows: PlannerRow[], measures: (ScenarioMeasure | null)[], missionWords: string): string {
  const lines = [
    ['', ...scenarios.map((scenario, i) => `${SCENARIO_LETTERS[i]} · ${siteNames[i]} · ${isoAt(start, scenario.landing)}`)],
    ...rows.map((row) => [row.label, ...row.cells.map((cell) => cell ?? '')]),
    ['Fits the mission', ...measures.map((measure) => (!measure ? '' : measure.problems.length === 0 ? 'yes' : `no: ${measure.problems.join(' ')}`))],
    ['Mission', missionWords],
  ]
  return `${lines.map((line) => line.map(field).join(',')).join('\n')}\n`
}
