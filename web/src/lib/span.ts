import type { DataRange, Overview, OverviewYear, YearSummary } from '../data/contract'

/**
 * The pipeline writes a year's flags and a year's headline numbers as files of their own, so a
 * page loads the years it shows and not the whole range: opening it costs the same however many
 * years the data covers. This is which years a page loads, and how the files join back into the
 * shapes the rest of the app works with.
 */

/** Whole calendar years, first and last, both included. */
export interface YearSpan {
  from: number
  to: number
}

/** How many years a page loads to begin with: what the whole range was when the app was built. */
export const SPAN_YEARS = 4
/** A span grows a year at a time as far as this; a date farther off starts a new span around it. */
export const MAX_SPAN_YEARS = 8

const HOUR_MS = 3_600_000

export function yearsOf(span: YearSpan): number[] {
  return Array.from({ length: span.to - span.from + 1 }, (_, i) => span.from + i)
}

export function inRange(year: number, range: DataRange): boolean {
  return Number.isInteger(year) && year >= range.first_year && year <= range.last_year
}

/**
 * The years to load for these years of interest: from the year before the earliest (what led up to
 * a date) to the year after the latest (a mission that runs past New Year), and `SPAN_YEARS` at
 * least, moved to stay inside the data. Years outside the data are ignored; with none left, the
 * span is the one around the data's default month.
 */
export function spanFor(years: number[], range: DataRange): YearSpan {
  const known = years.filter((year) => inRange(year, range))
  const wanted = known.length > 0 ? known : [Number(range.default_month.slice(0, 4))]
  const earliest = Math.min(...wanted)
  const latest = Math.max(...wanted)
  const from = Math.max(range.first_year, earliest - 1)
  const to = Math.min(range.last_year, Math.max(latest + 1, from + SPAN_YEARS - 1))
  return { from: Math.max(range.first_year, Math.min(from, to - SPAN_YEARS + 1)), to }
}

/**
 * What to load when a page that holds `span` needs these years too. The same span if it has them
 * with a year to spare after the latest (or the data ends there); the span grown forward if they
 * lie at or just past its end (nothing held moves, so a page can carry on where it is); otherwise
 * a new span around them, which a page must start again on. Null if any year is outside the data.
 */
export function spanToReach(span: YearSpan, years: number[], range: DataRange): { span: YearSpan; grown: boolean } | null {
  if (years.length === 0 || years.some((year) => !inRange(year, range))) return null
  const earliest = Math.min(...years)
  const to = Math.max(span.to, Math.min(range.last_year, Math.max(...years) + 1))
  if (earliest >= span.from && to - span.from < MAX_SPAN_YEARS) return { span: { from: span.from, to }, grown: true }
  if (earliest >= span.from && Math.max(...years) <= span.to) return { span, grown: true }
  return { span: spanFor(years, range), grown: false }
}

/** Every year a link names: the month after each "@", as in `#a=apollo-11@2028-07&list=slim@2031-02-03T04`. */
export function yearsInHash(hash: string): number[] {
  let text = hash
  try {
    text = decodeURIComponent(hash)
  } catch {
    // A stray "%" in a hand-edited link: read it as it stands.
  }
  return [...text.matchAll(/@(\d{4})-\d{2}/g)].map((match) => Number(match[1]))
}

/** The first hour of a span and how many hours it holds. */
export function spanHours(span: YearSpan): { start: string; hours: number } {
  const from = Date.UTC(span.from, 0, 1)
  return { start: new Date(from).toISOString().replace('.000Z', 'Z'), hours: (Date.UTC(span.to + 1, 0, 1) - from) / HOUR_MS }
}

/** The years a run of hourly flags covers, from its first hour and its length. */
export function spanOfHours(start: string, hours: number): YearSpan {
  return { from: new Date(start).getUTCFullYear(), to: new Date(Date.parse(start) + (hours - 1) * HOUR_MS).getUTCFullYear() }
}

/** How many hours a calendar month has, "2028-02" giving 696. */
export function monthHours(month: string): number {
  const [year, m] = month.split('-').map(Number)
  return (Date.UTC(year, m, 1) - Date.UTC(year, m - 1, 1)) / HOUR_MS
}

/** Every month from the first to the last, both included, with its hours. */
export function hoursByMonth(firstMonth: string, lastMonth: string): Record<string, number> {
  const hours: Record<string, number> = {}
  let [year, m] = firstMonth.split('-').map(Number)
  for (;;) {
    const month = `${year}-${String(m).padStart(2, '0')}`
    if (month > lastMonth) return hours
    hours[month] = monthHours(month)
    m += 1
    if (m > 12) {
      m = 1
      year += 1
    }
  }
}

/**
 * A year's steps (the hours before its first run, then each run's and each gap's length in turn)
 * added to `runs` as [from, to, ...] counted from `offset` hours on, joining a run that carries on
 * across the seam.
 */
function appendSteps(runs: number[], steps: number[], offset: number): void {
  let at = offset
  for (let i = 0; i + 1 < steps.length; i += 2) {
    const from = at + steps[i]
    at = from + steps[i + 1]
    if (runs.length > 0 && runs[runs.length - 1] === from) runs[runs.length - 1] = at
    else runs.push(from, at)
  }
}

/**
 * Consecutive years of `overview/<year>.json` as one overview from the first year's first hour,
 * with the files' steps turned into runs of [from, to, ...]. A run the pipeline cut at New Year
 * is one run again, so the result is what one file for the whole span would hold.
 */
export function joinOverviews(parts: OverviewYear[]): Overview {
  const [first] = parts
  const joined: Overview = { start: first.start, hours: 0, obs_height_m: first.obs_height_m, sites: {} }
  for (const part of parts) {
    if (Date.parse(part.start) !== Date.parse(first.start) + joined.hours * HOUR_MS) throw new Error(`overview years are not consecutive at ${part.start}`)
    for (const [id, runs] of Object.entries(part.sites)) {
      const site = (joined.sites[id] ??= { sun: [], earth: [], earth_above: {} })
      appendSteps(site.sun, runs.sun, joined.hours)
      appendSteps(site.earth, runs.earth, joined.hours)
      for (const [degrees, above] of Object.entries(runs.earth_above)) appendSteps((site.earth_above[degrees] ??= []), above, joined.hours)
    }
    joined.hours += part.hours
  }
  return joined
}

/** Consecutive years of `<site>/year-<year>.json` as one summary: every month and every year, in order. */
export function joinYears(parts: YearSummary[]): YearSummary {
  return {
    default_month: parts[0].default_month,
    months: parts.flatMap((part) => part.months),
    years: parts.flatMap((part) => part.years),
  }
}
