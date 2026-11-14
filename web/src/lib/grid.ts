import type { SiteFlags } from './flags'
import { locateHour, missionEarth, type Requirements, viableHours } from './mission'

/** What a cell shows: landing times under the limits, or how often a body is up. */
export type GridMetric = 'landing' | 'both' | 'sun' | 'earth'

export interface MonthSpan {
  month: string
  /** Hours [from, to) after the start of the data. */
  from: number
  to: number
}

export interface GridCell {
  month: string
  /** Share of the month that counts, 0 to 1: of its days for landing times, otherwise of its hours. */
  share: number
  /** Hours in the month that count. */
  hours: number
  /** Calendar days in the month with at least one hour that counts. */
  days: number
  /** Where to open this cell: the first hour in the month that counts, or the month's first. */
  firstHour: number
  /** What to print in the cell. */
  text: string
}

/** Each calendar month in the data. */
export function monthSpans(startIso: string, hours: number): MonthSpan[] {
  const spans: MonthSpan[] = []
  const startMs = Date.parse(startIso)
  const hourMs = 3_600_000
  for (let from = 0; from < hours; ) {
    const { month } = locateHour(startIso, from)
    const [year, m] = month.split('-').map(Number)
    const to = Math.min((Date.UTC(year, m, 1) - startMs) / hourMs, hours)
    spans.push({ month, from, to })
    from = to
  }
  return spans
}

/** Flags for what the metric counts, per hour. */
export function metricFlags(
  metric: GridMetric,
  flags: SiteFlags,
  requirements: Requirements,
): ArrayLike<number | boolean> {
  if (metric === 'landing') return viableHours(flags.sun, missionEarth(flags, requirements), requirements)
  if (metric === 'sun') return flags.sun
  if (metric === 'earth') return flags.earth
  return flags.sun.map((up, i) => up && flags.earth[i])
}

/** Calendar days for landing times, whole percent otherwise; "<1" so a small value isn't lost. */
function cellText(metric: GridMetric, hours: number, days: number, share: number): string {
  if (hours === 0) return '0'
  if (metric === 'landing') return String(days)
  return share * 100 < 1 ? '<1' : String(Math.round(share * 100))
}

/** One site's cells, for the months given. */
export function gridRow(
  counted: ArrayLike<number | boolean>,
  spans: MonthSpan[],
  metric: GridMetric,
): GridCell[] {
  return spans.map(({ month, from, to }) => {
    let hours = 0
    let days = 0
    let lastDay = -1
    let firstHour = -1
    for (let t = from; t < to; t += 1) {
      if (counted[t]) {
        hours += 1
        if (firstHour < 0) firstHour = t
        // Months start at midnight UTC, so every 24 hours from the month's start is a new day.
        const day = Math.floor((t - from) / 24)
        if (day !== lastDay) {
          days += 1
          lastDay = day
        }
      }
    }
    const share = metric === 'landing' ? days / ((to - from) / 24) : hours / (to - from)
    return {
      month,
      share,
      hours,
      days,
      firstHour: firstHour < 0 ? from : firstHour,
      text: cellText(metric, hours, days, share),
    }
  })
}

/** A cell with anything in it starts here, so it can't be mistaken for an empty one. */
const MIN_SHADE_PCT = 12

/**
 * How strongly to shade a cell, 0 to 100, on a smooth scale. Bands would make 49% and 51% look
 * different when the model can't tell them apart. Percentages run from none to all of the month.
 * Landing days never come near a whole month, so they run up to the best cell on show.
 */
export function shadePct(share: number, largestShare: number, metric: GridMetric): number {
  if (share <= 0) return 0
  const full = metric === 'landing' ? largestShare : 1
  return MIN_SHADE_PCT + (100 - MIN_SHADE_PCT) * Math.min(share / full, 1)
}

/** Above these shades, cell text changes color to keep its contrast. See the cell colors in index.css. */
export const INK_FLIP_LIGHT_PCT = 64
export const INK_FLIP_DARK_PCT = 44
