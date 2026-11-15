import type { SiteInfo } from '../../src/data/contract'
import { sanitizeAsk } from '../../src/lib/ask'
import type { SiteFlags } from '../../src/lib/flags'
import { hourOf, type Requirements } from '../../src/lib/mission'
import type { SiteData } from './data'
import type { HorizonsAsk } from './horizonsTool'

/** What every tool gets: the data, and the mission limits the visitor has set in the app. */
export interface ToolContext {
  data: SiteData
  requirements: Requirements
  /** The ground the visitor tapped on the Atlas map, if any. It comes with the request, never from the model. */
  spot?: { lat: number; lon: number } | null
  /** The hour on the visitor's time bar, as an ISO time: what "now" means to them. It comes with the request, never from the model. */
  hourIso?: string
  /** The way to ask NASA JPL Horizons, where there is one (the co-pilot service). */
  horizons?: HorizonsAsk
}

export type Args = Record<string, unknown>

/** A problem with what the model asked for. Its message goes back to the model, which can try again. */
export class ToolError extends Error {}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const TIME = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}))?/

export async function siteArg(ctx: ToolContext, value: unknown): Promise<SiteInfo> {
  const site = (await ctx.data.sites()).find((candidate) => candidate.id === value)
  if (!site) throw new ToolError(`Unknown site "${String(value)}". Use one of the listed site ids.`)
  return site
}

/** A month the data covers, as YYYY-MM. */
export function monthArg(value: unknown, flags: SiteFlags): string {
  if (typeof value !== 'string' || !MONTH.test(value)) throw new ToolError('Give the month as YYYY-MM.')
  const hour = hourOf(flags.start, `${value}-01T00:00:00Z`)
  if (hour < 0 || hour >= flags.sun.length) throw new ToolError(`No data for ${value}. ${spanWords(flags)}`)
  return value
}

/** An hour the data covers, as an ISO time. Accepts YYYY-MM-DD or YYYY-MM-DDTHH (anything after the hour is dropped). */
export function timeArg(value: unknown, flags: SiteFlags): string {
  const match = typeof value === 'string' ? TIME.exec(value) : null
  if (!match) throw new ToolError('Give the time as YYYY-MM-DDTHH in UTC.')
  const iso = `${match[1]}T${match[2] ?? '00'}:00:00Z`
  const hour = Number.isNaN(Date.parse(iso)) ? -1 : hourOf(flags.start, iso)
  if (hour < 0 || hour >= flags.sun.length) throw new ToolError(`No data for that time. ${spanWords(flags)}`)
  return iso
}

export function spanWords(flags: SiteFlags): string {
  const last = new Date(Date.parse(flags.start) + (flags.sun.length - 1) * 3_600_000)
  return `The data runs from ${flags.start.slice(0, 7)} to ${last.toISOString().slice(0, 7)}.`
}

/** The last calendar year in the data. */
export function lastYear(flags: SiteFlags): number {
  return new Date(Date.parse(flags.start) + (flags.sun.length - 1) * 3_600_000).getUTCFullYear()
}

/**
 * The visitor's limits, with any the model asked to try instead. The same checks as a typed
 * question's settings: out-of-range values are dropped, never clamped into something else.
 */
export function limitsArg(ctx: ToolContext, args: Args): Requirements {
  const tried = sanitizeAsk(
    {
      missionDays: args.mission_days,
      maxSunGapH: args.max_sun_gap_h,
      maxEarthGapH: args.max_earth_gap_h,
      sunAtLanding: args.sun_at_landing,
      earthAtLanding: args.earth_at_landing,
      minEarthClearanceDeg: args.earth_clearance_deg,
    },
    [],
  )
  return { ...ctx.requirements, ...tried?.requirements }
}

/** A whole number from the model, kept inside [low, high]. */
export function countArg(value: unknown, fallback: number, low: number, high: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(Math.max(n, low), high)
}
