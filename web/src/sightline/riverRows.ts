import type { SiteFlags } from '../lib/flags'
import type { RiverZoom } from '../lib/sightline'

/**
 * How the time bar lays its rows out: one row for each scenario, in letter order, with its lettered
 * flag standing on it at its landing. Two scenarios at one site get a row each, with the same bands.
 * Pure arithmetic, so it can be tested without a page.
 */

/** One scenario, as the time bar is given it. */
export interface RiverScenario {
  key: string
  /** The scenario's letter, "A". */
  letter: string
  /** Its site: a listed site's id, or a custom point's "lat,lon". */
  site: string
  siteName: string
  /** The whole of it, "Connecting Ridge · 6 May 2027 · 13:00 UTC", for the flag's hover text and its accessible name. */
  full: string
  /** The site's hourly flags; null while they load (a custom point is worked out in the browser). */
  flags: SiteFlags | null
  /** The landing, in clock hours. */
  landing: number
  active: boolean
}

/** The most rows the time bar draws: one for each scenario a plan can hold. */
export const MOST_ROWS = 4

/** The rows, one for each scenario, in letter order (A to D). */
export function scenarioRows(scenarios: RiverScenario[]): RiverScenario[] {
  return [...scenarios].sort((a, b) => a.letter.localeCompare(b.letter)).slice(0, MOST_ROWS)
}

/**
 * Where each flag's box starts along a row, in pixels from the row's left edge. A flag is centred
 * on its landing; one whose landing is before or after the hours on show stands at that edge. Flags
 * that would overlap are moved apart, keeping their order, and none leaves the row. (A row holds
 * one flag now; the arithmetic still takes several.)
 * `centres` are the landings' positions in pixels (they may be outside 0 to `width`).
 */
export function flagPlaces(centres: number[], width: number, flagWidth: number, gap = 2): number[] {
  const order = centres.map((_, i) => i).sort((a, b) => centres[a] - centres[b] || a - b)
  const last = Math.max(width - flagWidth, 0)
  const left = order.map((i) => Math.min(Math.max(centres[i] - flagWidth / 2, 0), last))
  // Left to right, then back: each flag clears the one before it, and the last one stays in the row.
  for (let n = 1; n < left.length; n += 1) left[n] = Math.max(left[n], left[n - 1] + flagWidth + gap)
  for (let n = left.length - 1; n >= 0; n -= 1) left[n] = Math.min(left[n], n === left.length - 1 ? last : left[n + 1] - flagWidth - gap)
  const places = new Array<number>(centres.length)
  order.forEach((i, n) => {
    places[i] = Math.max(left[n], 0)
  })
  return places
}

/**
 * Which side of its flag the selected mission's label goes: the right, unless another flag (or the
 * row's end) is too close there and the left has the room. Where neither side has the room and
 * another flag stands on the row, there is no label (null): it would lie over that flag's letter,
 * and the flag and the lit mission already say whose it is.
 */
export function labelSide(places: number[], selected: number, width: number, flagWidth: number, labelWidth: number): 'right' | 'left' | null {
  const at = places[selected]
  const others = places.filter((_, i) => i !== selected)
  const nextRight = Math.min(width, ...others.filter((left) => left > at))
  const nextLeft = Math.max(0, ...others.filter((left) => left < at).map((left) => left + flagWidth))
  if (nextRight - (at + flagWidth) >= labelWidth) return 'right'
  if (at - nextLeft >= labelWidth) return 'left'
  return others.length === 0 ? 'right' : null
}

/** The selected mission's label: whose it is and how long. */
export function missionLabel(letter: string, missionHours: number): string {
  const days = missionHours / 24
  return `${letter}’s ${Number.isInteger(days) ? days : days.toFixed(1)}-day mission`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** What the axis is an axis of: the month (and year) in the Month and Day views, the year in the Year view. */
export function axisName(startIso: string, from: number, zoom: RiverZoom): string {
  const date = new Date(Date.parse(startIso) + from * 3_600_000)
  return zoom === 'year' ? String(date.getUTCFullYear()) : `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}
