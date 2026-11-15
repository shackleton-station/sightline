import type { HorizonPoint, TrackPoint } from '../data/contract'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import { landingProblems, locateHour, missionEarth } from '../lib/mission'
import { betterDate, marginalHour, type SightlineMission, steadierLanding } from '../lib/sightlineMission'

/** One month at a site, as far as this needs it: the hourly track and the skylines the Sun and Earth are read against. */
export interface MonthSky {
  track: TrackPoint[]
  horizon: HorizonPoint[]
  earthHorizon?: HorizonPoint[] | null
}

/** Whether a landing at `hour` meets the mission's Sun and Earth limits, by the hourly flags. */
export function fitsAt(flags: SiteFlags, hour: number, mission: SightlineMission): boolean {
  return hour >= 0 && hour < flags.sun.length && landingProblems(flags.sun, missionEarth(flags, mission.requirements), hour, mission.requirements).length === 0
}

/** The first hour at or after `from` that meets the limits by the flags alone: where Plan can open at once, before any month has loaded. Null when the data holds none. */
export function firstFitFrom(flags: SiteFlags, from: number, mission: SightlineMission): number | null {
  if (fitsAt(flags, from, mission)) return from
  return betterDate(flags, from, mission)?.landing ?? null
}

/**
 * The landing Plan opens on: the next one at or after `from` (the real hour) that fits the mission
 * with margin, so the first verdict a visitor reads is a plain fit and not luck. It is found the way
 * the column's "Next landing that fits" is: the first hour the limits allow, moved on in its sunlit
 * stretch to where half the Sun's disc shows and Earth's center clears the skyline. Where a stretch
 * has no such hour, the search goes on to the next stretch, a few times. `marginal` is true only
 * when none was found and the first fit is returned as it is. Null when nothing fits at all.
 */
export async function goodLandingFrom(
  flags: SiteFlags,
  from: number,
  mission: SightlineMission,
  loadMonth: (month: string) => Promise<MonthSky>,
  tries = 8,
): Promise<{ landing: number; marginal: boolean } | null> {
  let at = from
  let fallback: number | null = null
  for (let round = 0; round < tries; round += 1) {
    const first = firstFitFrom(flags, at, mission)
    if (first === null) break
    fallback ??= first
    const { month, index } = locateHour(flags.start, first)
    const sky = await loadMonth(month)
    const shares = sky.track.map((point) => point.sun_frac)
    const earthSkyline = sky.earthHorizon ?? sky.horizon
    const earthCenterAbove = sky.track.map((point) => point.earth_el - horizonAt(earthSkyline, point.earth_az) >= 0)
    const monthStart = first - index
    const landing = steadierLanding(flags, first, mission, shares, monthStart, earthCenterAbove)
    if (!marginalHour(mission.requirements, shares, earthCenterAbove, landing - monthStart)) return { landing, marginal: false }
    // No hour with margin in what this month holds of the stretch: go on from where the stretch leaves
    // the month (it may run into the next one) or from the first hour after it that does not fit.
    const monthEnd = monthStart + sky.track.length
    let next = first + 1
    while (next < monthEnd && fitsAt(flags, next, mission)) next += 1
    at = next
  }
  return fallback === null ? null : { landing: fallback, marginal: true }
}
