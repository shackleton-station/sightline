import type { SiteFlags } from '../lib/flags'
import { gridRow, type GridCell, type GridMetric, type MonthSpan } from '../lib/grid'
import { missionEarth, viableHours } from '../lib/mission'
import type { SightlineMission } from '../lib/sightlineMission'

/**
 * Find's arithmetic: for every hour of the data, whether a landing then fits the mission, and what
 * a cell of the grid (a site and a month) says about it.
 *
 * "Fits" is the verdict's own answer, hour by hour: `fitProblems` returns no reason. It is worked
 * out here for every hour at once by `viableHours`, which finds the landing hours each long gap
 * rules out instead of walking every mission: one pass over a site's hours, a few milliseconds for
 * all thirteen sites, so the grid follows the mission's sliders with no wait and nothing is
 * approximated. `plannerFit.test.ts` holds the two to the same answer at every hour of a sample.
 */

/** What a cell of the grid shows. */
export type FindMeasure = 'fit' | 'sun' | 'earth' | 'both'

export const FIND_MEASURES: { id: FindMeasure; label: string; legend: string; title: string }[] = [
  { id: 'fit', label: 'Landings that fit', legend: 'Days with a landing that fits', title: 'Counts the days in each month with at least one hour when a landing fits the mission.' },
  { id: 'sun', label: 'Sun', legend: 'Sun in view, % of the month', title: 'Shows the share of each month’s hours with the Sun in view.' },
  { id: 'earth', label: 'Earth', legend: 'Earth in view, % of the month', title: 'Shows the share of each month’s hours with Earth in view.' },
  { id: 'both', label: 'Sun and Earth', legend: 'Sun and Earth together, % of the month', title: 'Shows the share of each month’s hours with the Sun and Earth in view together.' },
]

/**
 * For each hour of a site's flags, 1 when a landing then fits the mission and 0 when it does not:
 * the Sun and Earth limits, the mission's length inside the data, and the ground's slope.
 */
export function fitHours(flags: SiteFlags, mission: SightlineMission, slopeDeg: number | null): Uint8Array {
  // Too steep for the mission: no hour fits, whatever the sky does.
  if (slopeDeg !== null && slopeDeg > mission.maxSlopeDeg) return new Uint8Array(flags.sun.length)
  return viableHours(flags.sun, missionEarth(flags, mission.requirements), mission.requirements)
}

/** What a measure counts at a site, hour by hour. */
function counted(measure: FindMeasure, flags: SiteFlags, fit: Uint8Array): ArrayLike<number | boolean> {
  if (measure === 'fit') return fit
  if (measure === 'sun') return flags.sun
  if (measure === 'earth') return flags.earth
  return flags.sun.map((up, hour) => up && flags.earth[hour])
}

const GRID_METRIC: Record<FindMeasure, GridMetric> = { fit: 'landing', sun: 'sun', earth: 'earth', both: 'both' }

/** One site's row of the grid for the months given: a cell a month, as the measure counts it. */
export function findRow(measure: FindMeasure, flags: SiteFlags, fit: Uint8Array, spans: MonthSpan[]): GridCell[] {
  return gridRow(counted(measure, flags, fit), spans, GRID_METRIC[measure])
}

/** What a cell prints: the days with a landing that fits (or "none"), or a whole percentage. */
export function cellWords(measure: FindMeasure, cell: GridCell): string {
  if (measure === 'fit') return cell.days === 0 ? 'none' : String(cell.days)
  return cell.text
}

/** A stretch of hours, counted from the month's first: `from` is in it, `to` is not. */
export interface HourRun {
  from: number
  to: number
}

/** A site and month, opened under the grid. */
export interface CellDetail {
  /** How many hours of the month a landing fits, and on how many days. */
  fitHours: number
  fitDays: number
  /** The stretches of the month when a landing fits, for the marks over the bands. */
  runs: HourRun[]
  /** The first hour of the month a landing fits, as a clock hour; null when none does. */
  first: number | null
  /**
   * The fitting landing whose mission has the most hours of Sun, as a clock hour, with that share
   * in percent; the earliest of equals. Null when no landing in the month fits.
   */
  sunniest: { landing: number; sunPct: number } | null
}

/** Running totals of a row of flags: `sums[i]` is how many of the first `i` hours are up. */
export function runningTotals(flags: ArrayLike<number | boolean>): Uint32Array {
  const sums = new Uint32Array(flags.length + 1)
  for (let hour = 0; hour < flags.length; hour += 1) sums[hour + 1] = sums[hour] + (flags[hour] ? 1 : 0)
  return sums
}

/**
 * One site and month in full: when in the month a landing fits, the first such landing, and the
 * one with the most Sun over its mission. `sunTotals` is `runningTotals` of the site's Sun flags.
 */
export function cellDetail(fit: Uint8Array, sunTotals: Uint32Array, span: MonthSpan, missionDays: number): CellDetail {
  const missionH = missionDays * 24
  const runs: HourRun[] = []
  const days = new Set<number>()
  let hours = 0
  let first: number | null = null
  let sunniest: CellDetail['sunniest'] = null
  let mostSun = -1
  for (let hour = span.from; hour < span.to; hour += 1) {
    if (!fit[hour]) continue
    hours += 1
    days.add(Math.floor((hour - span.from) / 24))
    if (first === null) first = hour
    const last = runs[runs.length - 1]
    if (last && last.to === hour - span.from) last.to += 1
    else runs.push({ from: hour - span.from, to: hour - span.from + 1 })
    // A landing that fits has its whole mission inside the data, so the totals reach its end.
    const sunH = sunTotals[hour + missionH] - sunTotals[hour]
    if (sunH > mostSun) {
      mostSun = sunH
      sunniest = { landing: hour, sunPct: (100 * sunH) / missionH }
    }
  }
  return { fitHours: hours, fitDays: days.size, runs, first, sunniest }
}

/**
 * The next landing that fits after one: the first hour that fits once the stretch this landing is
 * in (if it fits) has ended, so "next" is another chance and not the hour after. Null if none is left.
 */
export function nextFit(fit: Uint8Array, landing: number): number | null {
  let hour = Math.max(landing, 0)
  while (hour < fit.length && fit[hour]) hour += 1
  while (hour < fit.length && !fit[hour]) hour += 1
  return hour < fit.length ? hour : null
}

/** The tabs of the Planner, as the link names them. */
export type PlannerTab = 'find' | 'compare'

/** Which tab of the Planner a link opens; null when the link does not open the Planner. */
export function plannerTabIn(hash: string): PlannerTab | null {
  const tab = new URLSearchParams(hash.replace(/^#/, '')).get('planner')
  return tab === 'find' || tab === 'compare' ? tab : null
}

/** A view's link with the Planner's open tab added, so a reload or a shared link opens it there. */
export function withPlannerTab(link: string, tab: PlannerTab): string {
  return `${link}&planner=${tab}`
}
