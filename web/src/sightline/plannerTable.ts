import type { SiteFlags } from '../lib/flags'
import { missionEarth } from '../lib/mission'
import { isoAt } from '../lib/sightline'
import { bestIn, COMPARE_ROWS, type ScenarioMeasure, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'

/** One row of the Full planner's table: a name, a cell per scenario, and which cells are the best. */
export interface PlannerRow {
  key: string
  label: string
  /** What each scenario's cell says; null while its site is still being worked out. */
  cells: (string | null)[]
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
 * The table's rows with a number in them: Compare's five, and the share of the mission with both the
 * Sun and Earth. Every one is engineering; the app has no science measure (such as the distance to
 * permanent shadow), so there are no science rows.
 */
export function plannerRows(scenarios: SightlineScenario[], measures: (ScenarioMeasure | null)[], flags: (SiteFlags | null)[], mission: SightlineMission): PlannerRow[] {
  const write = (value: number | null, known: boolean, digits: number) => (value === null ? (known ? '?' : null) : value.toFixed(digits))
  const rows: PlannerRow[] = COMPARE_ROWS.map((row) => {
    const values = measures.map((measure) => measure?.[row.key] ?? null)
    return { key: row.key, label: row.label, cells: values.map((value, i) => write(value, measures[i] !== null, row.digits)), best: bestIn(values, row.better, row.tie) }
  })
  const both = scenarios.map((scenario, i) => {
    const site = flags[i]
    return site ? bothPct(site, scenario.landing, mission) : null
  })
  rows.splice(4, 0, { key: 'bothPct', label: 'Sun and Earth together, %', cells: both.map((value, i) => write(value, flags[i] !== null, 0)), best: bestIn(both, 'high', 0.5) })
  return rows
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
