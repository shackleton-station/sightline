import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from '../lib/flags'
import type { MonthSpan } from '../lib/grid'
import { hourOf, missionEarth, type Requirements, viableHours } from '../lib/mission'
import { entryAt, GAP_TIE_H, measureEntry } from '../lib/shortlist'
import { nextViable } from '../lib/slip'

/** The time of an hour counted from the start of the data, as "2027-05-13T06:00:00Z". */
export function isoAt(start: string, hour: number): string {
  return new Date(Date.parse(start) + hour * 3_600_000).toISOString().replace('.000Z', 'Z')
}

/** A span of landing hours that meet the limits, cut to one month. Hours count from the start of the data. */
export interface MonthWindow {
  from: number
  /** The hour after the last one. */
  to: number
  /** It was already open when the month began, or is still open when it ends. */
  opensBefore: boolean
  staysOpenAfter: boolean
}

/** One landing hour and the mission that follows it. */
export interface Landing {
  hour: number
  t: string
  /** Why it misses the limits; empty if it meets them. */
  problems: string[]
  /** Share of the mission with the Sun up, in percent; null if the mission runs past the data. */
  sunPct: number | null
  /** Longest time without each during the mission, in hours; null if the mission runs past the data. */
  sunGapH: number | null
  earthGapH: number | null
  /** How many hours later a landing still works with no break; 0 if this one doesn't work. */
  roomH: number
}

export interface MonthAnswer {
  span: MonthSpan
  /** Calendar days (UTC) with at least one landing hour that works. */
  days: number
  /** For each day of the month, how many of its hours work. */
  dayHours: number[]
  windows: MonthWindow[]
  /** The best landing that works. If none does, the one that comes closest. */
  best: Landing
}

/** Landing hours that meet the limits, for every hour of the data. */
export function viableFor(flags: SiteFlags, requirements: Requirements): Uint8Array {
  return viableHours(flags.sun, missionEarth(flags, requirements), requirements)
}

/** A landing at one hour, measured the way the shortlist measures an option. */
export function landingAt(
  site: SiteInfo,
  flags: SiteFlags,
  requirements: Requirements,
  viable: Uint8Array,
  hour: number,
): Landing {
  const t = isoAt(flags.start, hour)
  const measured = measureEntry({ site: site.id, at: entryAt(t) }, site, flags, requirements)
  let roomH = 0
  if (viable[hour]) while (viable[hour + roomH + 1]) roomH += 1
  return {
    hour,
    t,
    problems: measured.problems,
    sunPct: measured.sunPct,
    sunGapH: measured.sunGapH,
    earthGapH: measured.earthGapH,
    roomH,
  }
}

/** Keeps the landings whose value is within what hourly data can separate of the smallest. */
function nearSmallest(landings: Landing[], value: (landing: Landing) => number): Landing[] {
  const smallest = Math.min(...landings.map(value))
  return landings.filter((landing) => value(landing) - smallest <= GAP_TIE_H)
}

/**
 * The pick among landings, by the shortlist's own order: those that miss the fewest limits (none,
 * when any landing works), then the shortest longest time without Sun, then without Earth, each
 * only as far as hourly data can tell landings apart. Among those left, the one with the most room
 * to slip, then the earliest. No blended score.
 */
export function pickBest(landings: Landing[]): Landing {
  const fewest = Math.min(...landings.map((landing) => landing.problems.length))
  const closest = landings.filter((landing) => landing.problems.length === fewest)
  const measurable = closest.filter((landing) => landing.sunGapH !== null && landing.earthGapH !== null)
  if (measurable.length === 0) return closest[0]
  const leastDark = nearSmallest(measurable, (landing) => landing.sunGapH ?? 0)
  const leastSilent = nearSmallest(leastDark, (landing) => landing.earthGapH ?? 0)
  return leastSilent.reduce((best, landing) => (landing.roomH > best.roomH ? landing : best))
}

/** One site in one month, for one mission: its landing days and windows, and the landing to plan on. */
export function monthAnswer(
  site: SiteInfo,
  flags: SiteFlags,
  requirements: Requirements,
  span: MonthSpan,
  viable: Uint8Array = viableFor(flags, requirements),
): MonthAnswer {
  const dayHours = new Array<number>(Math.ceil((span.to - span.from) / 24)).fill(0)
  const windows: MonthWindow[] = []
  const working: number[] = []
  for (let t = span.from; t < span.to; t += 1) {
    if (!viable[t]) continue
    working.push(t)
    dayHours[Math.floor((t - span.from) / 24)] += 1
    const open = windows[windows.length - 1]
    if (open && open.to === t) open.to = t + 1
    else windows.push({ from: t, to: t + 1, opensBefore: t === span.from && viable[t - 1] === 1, staysOpenAfter: false })
  }
  const last = windows[windows.length - 1]
  if (last && last.to === span.to && viable[span.to] === 1) last.staysOpenAfter = true

  // With no landing that works, every hour of the month is a candidate for the closest miss.
  const candidates = working.length > 0 ? working : Array.from({ length: span.to - span.from }, (_, i) => span.from + i)
  const best = pickBest(candidates.map((hour) => landingAt(site, flags, requirements, viable, hour)))
  return { span, days: dayHours.filter((hours) => hours > 0).length, dayHours, windows, best }
}

/** How many days of slip can be asked about. A control's range, not a result. */
export const SLIP_BOUNDS = [1, 90] as const

export interface SlipCheck {
  days: number
  landingWorks: boolean
  /** For each whole day of slip, 1 to `days`: whether a landing that much later works; null past the data. */
  byDay: (boolean | null)[]
  /** Every hour of slip up to `days` still works. */
  holds: boolean
  /** The last landing hour of the window this landing is in; null if the landing doesn't work. */
  lastGood: string | null
  /** The first landing that works after this window closes (after this hour, if it doesn't work); null if none in the data. */
  next: { t: string; month: string; index: number; waitH: number } | null
}

/** What happens to a landing if it moves later by up to a number of days. */
export function slipCheck(flags: SiteFlags, requirements: Requirements, landing: Landing, days: number): SlipCheck {
  const viable = viableFor(flags, requirements)
  const landingWorks = viable[landing.hour] === 1
  const byDay = Array.from({ length: days }, (_, i) => {
    const hour = landing.hour + (i + 1) * 24
    return hour < viable.length ? viable[hour] === 1 : null
  })
  const afterWindow = landing.hour + landing.roomH + 1
  const found = afterWindow < viable.length ? nextViable(flags, isoAt(flags.start, afterWindow), requirements) : null
  return {
    days,
    landingWorks,
    byDay,
    holds: landingWorks && landing.roomH >= days * 24,
    lastGood: landingWorks ? isoAt(flags.start, landing.hour + landing.roomH) : null,
    // nextViable counts the wait from where it started looking; a planner wants it from the landing.
    next: found ? { ...found, waitH: hourOf(flags.start, found.t) - landing.hour } : null,
  }
}
