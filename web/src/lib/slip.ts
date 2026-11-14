import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from './flags'
import { hourOf, landingProblems, locateHour, missionEarth, type Requirements, viableHours } from './mission'
import { hoursUntilChange } from './nextChange'

export interface Slip {
  label: string
  days?: number
  months?: number
}

/** Delays offered, from a late-stage hold to a missed launch season. */
export const SLIPS: Slip[] = [
  { label: '+1 week', days: 7 },
  { label: '+1 month', months: 1 },
  { label: '+3 months', months: 3 },
  { label: '+1 year', months: 12 },
]

/** Sun and Earth at the landing hour, with no mission at all: what Learn mode checks. */
export const BOTH_UP: Requirements = {
  missionDays: 0,
  maxSunGapH: 24,
  maxEarthGapH: 24,
  sunAtLanding: true,
  earthAtLanding: true,
  minEarthClearanceDeg: 0,
}

/**
 * A time moved by a slip. Months move by the calendar, keeping the day and hour; the 31st moves to
 * the last day of a shorter month.
 */
export function slipTime(iso: string, slip: Slip): string {
  const time = new Date(iso)
  if (slip.days) time.setUTCDate(time.getUTCDate() + slip.days)
  if (slip.months) {
    const day = time.getUTCDate()
    time.setUTCDate(1)
    time.setUTCMonth(time.getUTCMonth() + slip.months)
    const lastDay = new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + 1, 0)).getUTCDate()
    time.setUTCDate(Math.min(day, lastDay))
  }
  return time.toISOString().replace('.000Z', 'Z')
}

export interface Conditions {
  t: string
  sunUp: boolean
  earthUp: boolean
  /** Hours until each changes; null if it doesn't change in the data. */
  sunChangeH: number | null
  earthChangeH: number | null
  /** Why a landing then doesn't work; empty if it does. */
  problems: string[]
}

/** Conditions for a landing at a time; null if it's outside the data. */
export function conditionsAt(flags: SiteFlags, iso: string, requirements: Requirements): Conditions | null {
  const hour = hourOf(flags.start, iso)
  if (hour < 0 || hour >= flags.sun.length) return null
  return {
    t: iso,
    sunUp: flags.sun[hour],
    earthUp: flags.earth[hour],
    sunChangeH: hoursUntilChange(flags.sun, hour, 1),
    earthChangeH: hoursUntilChange(flags.earth, hour, 1),
    problems: landingProblems(flags.sun, missionEarth(flags, requirements), hour, requirements),
  }
}

/** The month, and hour within it, of the first workable landing at or after a time; null if none. */
export function nextViable(
  flags: SiteFlags,
  iso: string,
  requirements: Requirements,
): { t: string; month: string; index: number; waitH: number } | null {
  const from = Math.max(hourOf(flags.start, iso), 0)
  const viable = viableHours(flags.sun, missionEarth(flags, requirements), requirements)
  for (let t = from; t < viable.length; t += 1) {
    if (viable[t]) {
      const place = locateHour(flags.start, t)
      const time = new Date(Date.parse(flags.start) + t * 3_600_000).toISOString().replace('.000Z', 'Z')
      return { t: time, ...place, waitH: t - from }
    }
  }
  return null
}

const MOON_RADIUS_KM = 1737.4
const RAD = Math.PI / 180

/** Great-circle distance across the Moon between two points (km). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const cosine =
    Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD)
  return MOON_RADIUS_KM * Math.acos(Math.max(-1, Math.min(1, cosine)))
}

export interface Alternative {
  site: SiteInfo
  distanceKm: number
}

/** Other sites where a landing at this time works, nearest first, so same-region options lead. */
export function alternativesAt(
  from: SiteInfo,
  iso: string,
  sites: { site: SiteInfo; flags: SiteFlags }[],
  requirements: Requirements,
  limit: number,
): Alternative[] {
  return sites
    .filter(({ site }) => site.id !== from.id)
    .filter(({ flags }) => conditionsAt(flags, iso, requirements)?.problems.length === 0)
    .map(({ site }) => ({ site, distanceKm: distanceKm(from, site) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
}

export type SlipVerdict = 'still-works' | 'breaks' | 'fixes' | 'still-fails' | 'no-data'

/** What a slip does to a landing. */
export function slipVerdict(before: Conditions | null, after: Conditions | null): SlipVerdict {
  if (!before || !after) return 'no-data'
  const worked = before.problems.length === 0
  const works = after.problems.length === 0
  if (worked) return works ? 'still-works' : 'breaks'
  return works ? 'fixes' : 'still-fails'
}
