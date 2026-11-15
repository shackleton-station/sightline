import type { SiteFlags } from './flags'

/** What a mission can tolerate. These are user inputs, not results. */
export interface Requirements {
  missionDays: number
  maxSunGapH: number
  maxEarthGapH: number
  sunAtLanding: boolean
  earthAtLanding: boolean
  /**
   * How far Earth's center must be above the terrain to count, in degrees. 0 means any part of the
   * disk showing, which is optimistic for a radio link.
   */
  minEarthClearanceDeg: number
}

/**
 * "No limit" on a gap, as a number a link can carry: longer than all the data, so no gap can exceed
 * it. Anything at or above it means no limit, and is said that way: never as hours or days.
 */
export const NO_GAP_LIMIT_H = 99_999

/** Whether a gap limit in hours is really "no limit". */
export function isNoGapLimit(hours: number): boolean {
  return hours >= NO_GAP_LIMIT_H
}

/**
 * The mission every page and Scout start from, and the one a link with no limits is read with: 14
 * days, 24 h of dark survived, 24 h of radio silence survived, the Sun and Earth up at landing, any
 * part of Earth counting. The challenge is about sunlight and a direct line to Earth, so the mission
 * a visitor starts from limits both: without a limit on radio silence a landing read "Fits" with
 * Earth out of view for most of the stay. This is the only place the numbers are written, so the
 * same question gets the same answer wherever it is asked.
 */
export const DEFAULT_REQUIREMENTS: Requirements = {
  missionDays: 14,
  maxSunGapH: 24,
  maxEarthGapH: 24,
  sunAtLanding: true,
  earthAtLanding: true,
  minEarthClearanceDeg: 0,
}

/** The clearances the data has hourly flags for, besides any part of the disk. */
export const EARTH_CLEARANCES_DEG = [2, 5]

/** Earth flags for a mission's limits: when Earth counts as up for its radio link. */
export function missionEarth(flags: SiteFlags, req: Requirements): boolean[] {
  if (req.minEarthClearanceDeg === 0) return flags.earth
  const above = flags.earthAbove[String(req.minEarthClearanceDeg)]
  if (!above) throw new Error(`no flags for Earth ${req.minEarthClearanceDeg}° above the terrain`)
  return above
}

/** Longest run of "down" hours in flags[from..to). */
export function longestDown(flags: boolean[], from: number, to: number): number {
  let longest = 0
  let current = 0
  for (let i = from; i < to; i += 1) {
    current = flags[i] ? 0 : current + 1
    if (current > longest) longest = current
  }
  return longest
}

/** Why a landing at hour ``t`` doesn't meet the requirements; empty means it does. */
export function landingProblems(
  sun: boolean[],
  earth: boolean[],
  t: number,
  req: Requirements,
): string[] {
  const end = t + req.missionDays * 24
  const problems: string[] = []
  if (req.sunAtLanding && !sun[t]) problems.push('The Sun is down at landing.')
  const clearance = req.minEarthClearanceDeg
  if (req.earthAtLanding && !earth[t]) {
    problems.push(
      clearance > 0 ? `Earth is less than ${clearance}° above the terrain at landing.` : 'Earth is out of view at landing.',
    )
  }
  if (end > sun.length) {
    problems.push('The mission runs past the end of the data.')
    return problems
  }
  const sunGap = longestDown(sun, t, end)
  if (sunGap > req.maxSunGapH) {
    problems.push(`The Sun is gone for ${sunGap} h during the mission; your limit is ${req.maxSunGapH} h.`)
  }
  const earthGap = longestDown(earth, t, end)
  if (earthGap > req.maxEarthGapH) {
    const lost = clearance > 0 ? `less than ${clearance}° above the terrain` : 'gone'
    problems.push(`Earth is ${lost} for ${earthGap} h during the mission; your limit is ${req.maxEarthGapH} h.`)
  }
  return problems
}

export interface LandingWindow {
  /** First acceptable hour, and the hour after the last one. */
  from: number
  to: number
}

/**
 * For each hour, 1 if a landing then meets the requirements. Gives the same answer as checking
 * ``landingProblems`` at every hour, but fast enough to redo for every site on each keystroke:
 * instead of scanning each mission, it works out which landing hours each long gap rules out.
 */
export function viableHours(sun: boolean[], earth: boolean[], req: Requirements): Uint8Array {
  const n = sun.length
  const missionH = req.missionDays * 24
  // Changes in how many reasons rule out each hour, summed up at the end.
  const reasons = new Int32Array(n + 1)
  const ruleOut = (from: number, to: number) => {
    const first = Math.max(from, 0)
    const end = Math.min(to, n)
    if (first < end) {
      reasons[first] += 1
      reasons[end] -= 1
    }
  }
  ruleOut(n - missionH + 1, n)
  const applyGapLimit = (flags: boolean[], limitH: number) => {
    if (missionH <= limitH) return
    let i = 0
    while (i < n) {
      if (flags[i]) {
        i += 1
        continue
      }
      let end = i
      while (end < n && !flags[end]) end += 1
      // A mission sees more than the limit of this gap if it starts after the gap's first
      // (limit - mission) hours and more than the limit before the gap ends.
      if (end - i > limitH) ruleOut(i + limitH - missionH + 1, end - limitH)
      i = end
    }
  }
  applyGapLimit(sun, req.maxSunGapH)
  applyGapLimit(earth, req.maxEarthGapH)

  const viable = new Uint8Array(n)
  let active = 0
  for (let t = 0; t < n; t += 1) {
    active += reasons[t]
    const landingOk = (!req.sunAtLanding || sun[t]) && (!req.earthAtLanding || earth[t])
    viable[t] = active === 0 && landingOk ? 1 : 0
  }
  return viable
}

/** Every span of landing times that meets the requirements. */
export function landingWindows(
  sun: boolean[],
  earth: boolean[],
  req: Requirements,
): LandingWindow[] {
  const viable = viableHours(sun, earth, req)
  const windows: LandingWindow[] = []
  let from: number | null = null
  for (let t = 0; t <= viable.length; t += 1) {
    const ok = t < viable.length && viable[t] === 1
    if (ok && from === null) from = t
    if (!ok && from !== null) {
      windows.push({ from, to: t })
      from = null
    }
  }
  return windows
}

/** Month ("2027-05") and hour within that month for an hour counted from the period start. */
export function locateHour(startIso: string, hour: number): { month: string; index: number } {
  const time = new Date(Date.parse(startIso) + hour * 3_600_000)
  const monthStart = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), 1)
  return {
    month: time.toISOString().slice(0, 7),
    index: (time.getTime() - monthStart) / 3_600_000,
  }
}

/** Hours from the period start to a time. */
export function hourOf(startIso: string, iso: string): number {
  return (Date.parse(iso) - Date.parse(startIso)) / 3_600_000
}
