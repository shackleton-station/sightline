import type { SiteInfo } from '../data/contract'
import { LIMIT_BOUNDS } from '../lib/ask'
import type { SiteFlags } from '../lib/flags'
import { type GridCell, gridRow, metricFlags, type MonthSpan, monthSpans } from '../lib/grid'
import type { Requirements } from '../lib/mission'
import { distanceKm } from '../lib/slip'

/** A site with its hourly Sun and Earth flags, as the grid needs them. */
export interface PlannerSite {
  site: SiteInfo
  flags: SiteFlags
}

/** Whether a month has landing days: enough to choose from, only one or two, or none. */
export type CellStatus = 'works' | 'tight' | 'none'

/**
 * A month with this many landing days or fewer is called tight. It is a reading aid, not a result:
 * the cell still shows its real count, and the legend says where the line is.
 */
export const TIGHT_DAYS = 2

export interface PlannerCell extends GridCell {
  status: CellStatus
}

export interface PlannerRow {
  site: SiteInfo
  flags: SiteFlags
  spans: MonthSpan[]
  cells: PlannerCell[]
  /** Months with at least one landing day. */
  monthsWithLanding: number
}

export interface Tally {
  /** Site-and-month cells with at least one landing day. */
  withLanding: number
  /** Of those, the ones with only one or two. */
  tight: number
  total: number
}

export interface PlannerGrid {
  months: string[]
  rows: PlannerRow[]
  tally: Tally
  /** The most landing days in any cell, and that cell's share of its month: the top of the bars' scale. */
  mostDays: number
  largestShare: number
}

export function statusOf(days: number): CellStatus {
  if (days === 0) return 'none'
  return days <= TIGHT_DAYS ? 'tight' : 'works'
}

/** Every site against every month in the data, for one mission: the days with a landing that meets the limits. */
export function buildGrid(sites: PlannerSite[], requirements: Requirements): PlannerGrid {
  const rows = sites.map(({ site, flags }) => {
    const spans = monthSpans(flags.start, flags.sun.length)
    const cells = gridRow(metricFlags('landing', flags, requirements), spans, 'landing').map((cell) => ({
      ...cell,
      status: statusOf(cell.days),
    }))
    return { site, flags, spans, cells, monthsWithLanding: cells.filter((cell) => cell.days > 0).length }
  })
  const cells = rows.flatMap((row) => row.cells)
  return {
    months: rows[0]?.cells.map((cell) => cell.month) ?? [],
    rows,
    tally: {
      withLanding: cells.filter((cell) => cell.status !== 'none').length,
      tight: cells.filter((cell) => cell.status === 'tight').length,
      total: cells.length,
    },
    mostDays: Math.max(0, ...cells.map((cell) => cell.days)),
    largestShare: Math.max(0, ...cells.map((cell) => cell.share)),
  }
}

export interface OtherSite {
  site: SiteInfo
  days: number
  distanceKm: number
}

/** Other sites with a landing in a month, nearest first, so options in the same region lead. */
export function otherSitesThatMonth(grid: PlannerGrid, from: SiteInfo, month: string, limit: number): OtherSite[] {
  const column = grid.months.indexOf(month)
  if (column < 0) return []
  return grid.rows
    .filter((row) => row.site.id !== from.id && row.cells[column].days > 0)
    .map((row) => ({ site: row.site, days: row.cells[column].days, distanceKm: distanceKm(from, row.site) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
}

export interface Loosening {
  /** Which limit was taken away, to say in a sentence. */
  what: 'sun' | 'earth' | 'landing'
  /** Cells with a landing once it is. */
  withLanding: number
}

/**
 * When nothing works anywhere: what each limit is costing. Takes one limit away at a time and counts
 * the cells that would then have a landing, so the page can say which limit to look at first.
 */
export function whatEachLimitCosts(sites: PlannerSite[], requirements: Requirements): Loosening[] {
  const count = (changed: Requirements) => buildGrid(sites, changed).tally.withLanding
  const tries: Loosening[] = [
    { what: 'sun', withLanding: count({ ...requirements, maxSunGapH: LIMIT_BOUNDS.maxSunGapH[1] }) },
    { what: 'earth', withLanding: count({ ...requirements, maxEarthGapH: LIMIT_BOUNDS.maxEarthGapH[1] }) },
  ]
  if (requirements.sunAtLanding || requirements.earthAtLanding) {
    tries.push({ what: 'landing', withLanding: count({ ...requirements, sunAtLanding: false, earthAtLanding: false }) })
  }
  return tries
}

/**
 * The longest mission, in whole days, that has a landing somewhere with the other limits unchanged;
 * null if not even the shortest does. A shorter mission never loses a landing a longer one has, so a
 * search by halves finds it.
 */
export function longestMissionThatFits(sites: PlannerSite[], requirements: Requirements): number | null {
  const fits = (missionDays: number) => buildGrid(sites, { ...requirements, missionDays }).tally.withLanding > 0
  let low: number = LIMIT_BOUNDS.missionDays[0]
  if (!fits(low)) return null
  let high = requirements.missionDays
  if (fits(high)) return high
  // fits(low) is true and fits(high) is false throughout.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (fits(middle)) low = middle
    else high = middle
  }
  return low
}

/** Positions for a slider over a wide range: fine steps where missions differ, coarse ones beyond. */
export function sliderStops(candidates: number[], [min, max]: readonly [number, number]): number[] {
  const inside = candidates.filter((value) => value > min && value < max)
  return [min, ...inside, max]
}

/** The stop nearest a value, so a typed number puts the slider's handle in a sensible place. */
export function nearestStop(value: number, stops: number[]): number {
  let best = 0
  for (let i = 1; i < stops.length; i += 1) {
    if (Math.abs(stops[i] - value) < Math.abs(stops[best] - value)) best = i
  }
  return best
}
