import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from './flags'
import { hourOf, landingProblems, longestDown, missionEarth, type Requirements } from './mission'

/** One option a team is weighing: a place and a landing hour, as stored in a link. */
export interface ShortlistEntry {
  /** A curated site id, or "lat,lon" for custom coordinates. */
  site: string
  /** "YYYY-MM-DDTHH", UTC. */
  at: string
}

export interface ShortlistRow {
  entry: ShortlistEntry
  site: SiteInfo
  /** Why this misses the limits; empty if it meets them. */
  problems: string[]
  /** Share of the mission with the Sun up, in percent; null if outside the data. */
  sunPct: number | null
  /** Longest time without each during the mission, in hours; null if outside the data. */
  sunGapH: number | null
  earthGapH: number | null
  /** Place on the list; options that can't be told apart share one. */
  rank: number
  /** Why it sits where it does, in a few words each. */
  reasons: string[]
}

/** Hourly data can't separate gaps closer than this: each end is only known to the nearest hour. */
export const GAP_TIE_H = 2

const MAX_SHARING_A_REASON = 2

/** Keeps a link a sensible length, and a list short enough to read. */
export const MAX_SHORTLIST = 24

export function toIso(at: string): string {
  return `${at}:00:00Z`
}

export function entryAt(iso: string): string {
  return iso.slice(0, 13)
}

export function sameEntry(a: ShortlistEntry, b: ShortlistEntry): boolean {
  return a.site === b.site && a.at === b.at
}

/** Add options to a list, leaving out any already on it, up to the limit. */
export function addEntries(list: ShortlistEntry[], added: ShortlistEntry[]): ShortlistEntry[] {
  const out = [...list]
  for (const entry of added) {
    if (out.length < MAX_SHORTLIST && !out.some((other) => sameEntry(other, entry))) out.push(entry)
  }
  return out
}

interface Measured {
  entry: ShortlistEntry
  site: SiteInfo
  problems: string[]
  sunPct: number | null
  sunGapH: number | null
  earthGapH: number | null
}

/** One option against a mission's limits, from the landing hour to the end of the mission. */
export function measureEntry(
  entry: ShortlistEntry,
  site: SiteInfo,
  flags: SiteFlags,
  requirements: Requirements,
): Measured {
  const earth = missionEarth(flags, requirements)
  const hour = hourOf(flags.start, toIso(entry.at))
  const end = hour + requirements.missionDays * 24
  if (hour < 0 || hour >= flags.sun.length) {
    return { entry, site, problems: ['This date is outside our data.'], sunPct: null, sunGapH: null, earthGapH: null }
  }
  const problems = landingProblems(flags.sun, earth, hour, requirements)
  if (end > flags.sun.length) return { entry, site, problems, sunPct: null, sunGapH: null, earthGapH: null }
  let sunHours = 0
  for (let t = hour; t < end; t += 1) if (flags.sun[t]) sunHours += 1
  return {
    entry,
    site,
    problems,
    sunPct: (100 * sunHours) / (end - hour),
    sunGapH: longestDown(flags.sun, hour, end),
    earthGapH: longestDown(earth, hour, end),
  }
}

/** Where an option falls before comparing numbers: it meets the limits, misses them, or can't be measured. */
function standing(row: Measured): number {
  if (row.sunGapH === null || row.earthGapH === null) return 2
  return row.problems.length === 0 ? 0 : 1
}

/** Split options sorted by a value into runs that hourly data can't separate. */
function tiedRuns(sorted: Measured[], value: (row: Measured) => number): Measured[][] {
  const runs: Measured[][] = []
  for (const row of sorted) {
    const run = runs[runs.length - 1]
    if (run && value(row) - value(run[run.length - 1]) <= GAP_TIE_H) run.push(row)
    else runs.push([row])
  }
  return runs
}

const byValue = (value: (row: Measured) => number) => (a: Measured, b: Measured) =>
  value(a) - value(b) || a.site.name.localeCompare(b.site.name) || a.entry.at.localeCompare(b.entry.at)

const sunGap = (row: Measured) => row.sunGapH ?? 0
const earthGap = (row: Measured) => row.earthGapH ?? 0

/**
 * Order options by what a mission can't work around: meeting the limits, then the longest time
 * without Sun, then without Earth. Sun only decides when hourly data can separate two options, and
 * options it can't separate on either share a place. Options with no numbers come last, since
 * nothing shows they'd do well. There's no blended score: weights would be invented.
 */
export function rankOptions(measured: Measured[]): ShortlistRow[] {
  const groups: Measured[][] = [0, 1, 2].map((group) => measured.filter((row) => standing(row) === group))
  const places: Measured[][] = groups.flatMap((group, i) => {
    if (i === 2) return [...group].sort(byValue(() => 0)).map((row) => [row])
    return tiedRuns([...group].sort(byValue(sunGap)), sunGap).flatMap((sameSun) =>
      tiedRuns([...sameSun].sort(byValue(earthGap)), earthGap),
    )
  })

  const known = measured.filter((row) => standing(row) < 2)
  const shortestSun = Math.min(...known.map(sunGap))
  const shortestEarth = Math.min(...known.map(earthGap))
  // "Shortest on this list" only says something when few options share it.
  const standsOut = (near: (row: Measured) => boolean) =>
    known.length > 1 && known.filter(near).length <= MAX_SHARING_A_REASON
  const nearSun = (row: Measured) => row.sunGapH !== null && row.sunGapH - shortestSun <= GAP_TIE_H
  const nearEarth = (row: Measured) => row.earthGapH !== null && row.earthGapH - shortestEarth <= GAP_TIE_H
  const sunStandsOut = standsOut(nearSun)
  const earthStandsOut = standsOut(nearEarth)

  let position = 0
  return places.flatMap((place) => {
    const rank = position + 1
    position += place.length
    return place.map((row) => {
      const reasons = row.problems.length === 0 ? ['Meets your limits'] : [...row.problems]
      if (sunStandsOut && nearSun(row)) reasons.push('Shortest time without Sun on this list')
      if (earthStandsOut && nearEarth(row)) reasons.push('Shortest time without Earth on this list')
      return { ...row, rank, reasons }
    })
  })
}
