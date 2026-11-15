import type { SiteFlags } from './flags'
import type { RiverSegment, RiverState } from './river'
import { riverTime } from './river'

/**
 * Sightline keeps one clock for the whole screen: hours counted from the start of the pipeline's
 * data (the same count the hourly flags use), fractional while time plays. These helpers turn that
 * hour into what the screen shows. Nothing here computes light or geometry: it only looks up what
 * the pipeline wrote.
 */

export type Vec3 = [number, number, number]

const HOUR_MS = 3_600_000

/** How fast time can play, in hours of ephemeris a second of watching. */
export const SPEEDS = [
  { hoursPerSecond: 1, label: '1 hour a second' },
  { hoursPerSecond: 6, label: '6 hours a second' },
  { hoursPerSecond: 24, label: '1 day a second' },
  { hoursPerSecond: 72, label: '3 days a second' },
]
export const DEFAULT_SPEED = 24

/** The whole hour a fractional clock hour falls in, kept inside the data. */
export function wholeHour(hour: number, hours: number): number {
  return Math.max(0, Math.min(Math.floor(hour), hours - 1))
}

/** What is up at a site at one hour of the flags: the colour of its dot. */
export function stateAt(flags: SiteFlags, hour: number): RiverState {
  const sun = flags.sun[hour] === true
  const earth = flags.earth[hour] === true
  if (sun && earth) return 'both'
  if (sun) return 'sun'
  return earth ? 'earth' : 'none'
}

/** The state in words, for a dot's label and for Scout. Never colour alone. */
export const STATE_WORDS: Record<RiverState, string> = {
  both: 'sunlit, and Earth is in view',
  sun: 'sunlit, but Earth is out of view',
  earth: 'no sunlight, but Earth is in view',
  none: 'no sunlight, and Earth is out of view',
}

/** An angle to a tenth of a degree, with a true minus sign and no "−0.0°": "1.4°", "−0.2°". */
export function degWords(deg: number): string {
  const tenths = Math.round(deg * 10) / 10
  return `${tenths < 0 ? '−' : ''}${Math.abs(tenths).toFixed(1)}°`
}

/** The conventional figure, for a tile's caption: "elevation −1.0° from level". */
export function elevationWords(elevationDeg: number): string {
  return `elevation ${degWords(elevationDeg)} from level`
}

/**
 * What a row's "above the skyline" figure is, for its tooltip: one idea, then how to read it. The
 * height above the ground is said only when it is not the screen's own 2 m, where it changes the figure.
 */
export function aboveSkylineMeans(body: 'the Sun' | 'Earth', obsHeightM: number): string {
  const from = obsHeightM === 2 ? '' : `, seen from ${obsHeightM} m up`
  return `How far ${body}'s center is above the skyline in its direction, at landing${from}. Above 0° its center clears the terrain.`
}

/** The same for the time bar's readout of both, at the hour on show. */
export const ABOVE_SKYLINE_MEANS = "How far the Sun's and Earth's centers are above the skyline, at the hour on the time bar."

/** The ISO time of a clock hour, to the whole hour. */
export function isoAt(startIso: string, hour: number): string {
  return `${new Date(Date.parse(startIso) + Math.floor(hour) * HOUR_MS).toISOString().slice(0, 19)}Z`
}

/** A clock hour as a date field holds it: "2027-05-13T12:00", read as UTC. */
export function fieldAt(startIso: string, hour: number): string {
  return isoAt(startIso, hour).slice(0, 16)
}

/**
 * The clock hour for a date typed or picked in a date field ("YYYY-MM-DDTHH:MM", read as UTC), to
 * the hour. Null while the field holds something that isn't a date yet (a half-typed year), or a
 * date outside the data.
 */
export function hourFromField(startIso: string, value: string, hours: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}/.exec(value)
  if (!match) return null
  const [year, month, day, hour] = match.slice(1).map(Number)
  const time = Date.UTC(year, month - 1, day, hour)
  // Date.UTC rolls an impossible date (31 February) into the next month: that is not what was typed.
  if (new Date(time).getUTCDate() !== day) return null
  const at = (time - Date.parse(startIso)) / HOUR_MS
  return Number.isInteger(at) && at >= 0 && at < hours ? at : null
}

/** "13 May 2027 · 12:00 UTC" for a clock hour. */
export function clockTime(startIso: string, hour: number): string {
  return riverTime(isoAt(startIso, hour))
}

/** "13 May 2027" for a clock hour. */
export function clockDate(startIso: string, hour: number): string {
  return clockTime(startIso, hour).split(' · ')[0]
}

/** The browser tab's title in Watch: the name first, so it survives a narrow tab. */
export const WATCH_TITLE = 'Sightline · Lunar landing site planner'

/**
 * The browser tab's title. In Plan the scenario comes first ("Shackleton Rim, 6 May 2027 ·
 * Sightline"), so several tabs can be told apart and the history reads well; in Watch it is the
 * page's name.
 */
export function tabTitle(scenario: { siteName: string; landingDate: string } | null): string {
  return scenario ? `${scenario.siteName}, ${scenario.landingDate} · Sightline` : WATCH_TITLE
}

/** The calendar year a clock hour falls in, and the (fractional) hour since that year began. */
export function yearHour(startIso: string, hour: number): { year: number; hourOfYear: number } {
  const ms = Date.parse(startIso) + hour * HOUR_MS
  const year = new Date(ms).getUTCFullYear()
  return { year, hourOfYear: (ms - Date.UTC(year, 0, 1)) / HOUR_MS }
}

/** The clock hours a calendar month covers: its first hour, and the first hour of the next month. */
export function monthSpan(startIso: string, hour: number): { from: number; to: number } {
  const start = Date.parse(startIso)
  const at = new Date(start + Math.floor(hour) * HOUR_MS)
  const from = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)
  const to = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)
  return { from: (from - start) / HOUR_MS, to: (to - start) / HOUR_MS }
}

/**
 * The direction of the Sun from the Moon's center at a fractional hour of a year, as a MOON_ME unit
 * vector, from the pipeline's ephemeris file (six numbers an hour: the Sun's position, then
 * Earth's, in km). Blended between the two nearest hours, only for lighting the globe: the Sun
 * moves about 0.5° an hour, so a straight blend is well inside the precision budget.
 */
export function sunDirection(positions: ArrayLike<number>, hourOfYear: number): Vec3 | null {
  return directionAt(positions, hourOfYear, 0)
}

/** The direction of Earth from the Moon's center at a fractional hour of a year, from the same file: blended the same way as `sunDirection`. */
export function earthDirection(positions: ArrayLike<number>, hourOfYear: number): Vec3 | null {
  return directionAt(positions, hourOfYear, 3)
}

/** One of the file's two bodies (the Sun's numbers start at 0, Earth's at 3), blended between the two nearest hours. */
function directionAt(positions: ArrayLike<number>, hourOfYear: number, first: number): Vec3 | null {
  const hours = Math.floor(positions.length / 6)
  if (hours === 0) return null
  const at = Math.max(0, Math.min(hourOfYear, hours - 1))
  const i = Math.floor(at)
  const j = Math.min(i + 1, hours - 1)
  const t = at - i
  const at6 = (hour: number, axis: number) => positions[hour * 6 + first + axis]
  const x = at6(i, 0) + (at6(j, 0) - at6(i, 0)) * t
  const y = at6(i, 1) + (at6(j, 1) - at6(i, 1)) * t
  const z = at6(i, 2) + (at6(j, 2) - at6(i, 2)) * t
  const norm = Math.hypot(x, y, z)
  return norm > 0 ? [x / norm, y / norm, z / norm] : null
}

/** How much time the river shows: three days, a calendar month, or a calendar year. */
export type RiverZoom = 'day' | 'month' | 'year'

/** Hours in the river's closest window: three days, enough to see a sunrise coming. */
export const DAY_WINDOW_H = 72

/** The clock hours the river shows around an hour: `from` is included, `to` is not. Never outside the data. */
export function riverWindow(startIso: string, hour: number, zoom: RiverZoom, hours: number): { from: number; to: number } {
  const at = Math.floor(hour)
  let span: { from: number; to: number }
  if (zoom === 'day') {
    const from = Math.floor(at / DAY_WINDOW_H) * DAY_WINDOW_H
    span = { from, to: from + DAY_WINDOW_H }
  } else if (zoom === 'month') span = monthSpan(startIso, at)
  else {
    const start = Date.parse(startIso)
    const year = new Date(start + at * HOUR_MS).getUTCFullYear()
    span = { from: (Date.UTC(year, 0, 1) - start) / HOUR_MS, to: (Date.UTC(year + 1, 0, 1) - start) / HOUR_MS }
  }
  return { from: Math.max(0, span.from), to: Math.min(hours, span.to) }
}

/** What the keyboard does to time, for the play button's hover text. */
export const TIME_KEYS_MEAN = 'Plays or pauses time (Space). The arrow keys move one hour; with Shift, one day.'

/**
 * The whole stretch around one hour in which the same things are in view, over all the flags on
 * hand, not only the window on screen: its state, its first hour, and the hour it ends (the first
 * hour of the next state).
 */
export function runAt(flags: SiteFlags, hour: number): RiverSegment {
  const state = stateAt(flags, hour)
  let from = hour
  while (from > 0 && stateAt(flags, from - 1) === state) from -= 1
  let to = hour + 1
  while (to < flags.sun.length && stateAt(flags, to) === state) to += 1
  return { from, to, state }
}

/** A band of the time bar in words: "Sun and Earth · 6 May 13:00 to 9 May 02:00 · 61 h". The year is written only when the band crosses one. */
export function bandWords(startIso: string, run: RiverSegment, name: string): string {
  const year = (hour: number) => clockTime(startIso, hour).split(' ')[2]
  const moment = (hour: number) => {
    const words = clockTime(startIso, hour).replace(/ UTC$/, '').replace(' · ', ' ')
    return year(run.from) === year(run.to) ? words.replace(` ${year(hour)}`, '') : words
  }
  return `${name} · ${moment(run.from)} to ${moment(run.to)} · ${run.to - run.from} h`
}

/** The river's colours for a window of the flags: runs of hours in the same state, numbered from the window's start. */
export function stateRuns(flags: SiteFlags, from: number, to: number): RiverSegment[] {
  const runs: RiverSegment[] = []
  for (let hour = from; hour < to; hour += 1) {
    const state = stateAt(flags, hour)
    const last = runs[runs.length - 1]
    if (last && last.state === state) last.to = hour - from + 1
    else runs.push({ from: hour - from, to: hour - from + 1, state })
  }
  return runs
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Labels under the river: each day (three days), round dates (a month) or each month (a year). `at` counts hours from the window's start. */
export function riverTicks(startIso: string, from: number, to: number, zoom: RiverZoom): { at: number; label: string }[] {
  const start = Date.parse(startIso)
  const ticks: { at: number; label: string }[] = []
  // Midnights only: every tick is the start of a day.
  for (let hour = Math.ceil(from / 24) * 24; hour < to; hour += 24) {
    const date = new Date(start + hour * HOUR_MS)
    const day = date.getUTCDate()
    const month = SHORT_MONTHS[date.getUTCMonth()]
    if (zoom === 'day') ticks.push({ at: hour - from, label: `${day} ${month}` })
    else if (zoom === 'month' && (day === 1 || day % 5 === 0) && day < 31) ticks.push({ at: hour - from, label: String(day) })
    else if (zoom === 'year' && day === 1) ticks.push({ at: hour - from, label: month })
  }
  return ticks
}

/**
 * The compass direction the skyline strip is centred on: whichever of north, east, south and west
 * is nearest to where Earth sits through the month. From the near side of the pole Earth is to the
 * north, from the far side it is to the south; centring on it keeps Earth off the strip's edges.
 */
export function skylineCentre(track: { earth_az: number }[]): number {
  let east = 0
  let north = 0
  for (const point of track) {
    east += Math.sin((point.earth_az * Math.PI) / 180)
    north += Math.cos((point.earth_az * Math.PI) / 180)
  }
  const mean = (Math.atan2(east, north) * 180) / Math.PI
  return (((Math.round(mean / 90) * 90) % 360) + 360) % 360
}

/** Where an azimuth sits across the skyline strip, in degrees from its left edge, with `centreAz` in the middle. */
export function skylineX(azDeg: number, centreAz = 0): number {
  return (((azDeg - centreAz + 180) % 360) + 360) % 360
}

/**
 * The horizon laid out for the skyline strip: all 360° with `centreAz` in the middle, in order from
 * the left edge to the right edge (the same direction again). `x` is degrees from the left edge.
 */
export function skylineHorizon(horizon: { az: number; el: number }[], centreAz = 0): { x: number; el: number }[] {
  if (horizon.length === 0) return []
  const placed = horizon.map((point) => ({ x: skylineX(point.az, centreAz), el: point.el })).sort((a, b) => a.x - b.x)
  // Repeat the leftmost point at the right edge to close the strip.
  return [...placed, { x: placed[0].x + 360, el: placed[0].el }]
}

/**
 * Where the horizon would be on a smooth sphere the size of the Moon, seen from `heightM` above the
 * ground: a little below eye level, by the angle whose cosine is R / (R + h). About −0.087° at 2 m
 * (the pipeline's own check of its horizon code, CLAUDE.md §3.4).
 */
export function smoothHorizonDeg(heightM: number, radiusM: number): number {
  return (-Math.acos(radiusM / (radiusM + Math.max(heightM, 0))) * 180) / Math.PI
}

/**
 * The heights the skyline strip shows, in degrees: from a little below the lowest point of the
 * ridge to a little above the highest thing in the sky over the period (the Sun's or Earth's
 * highest point, or the ridge's own if it stands above both). Chosen from what matters, so the
 * ridge's shape fills the strip instead of lying flat under empty sky; a body that dips below the
 * ridge's lowest point is behind the land there anyway.
 */
export function skylineDomain(horizon: { el: number }[], track: { sun_el: number; earth_el: number }[], belowDeg = 0.5, aboveDeg = 0.4): [number, number] {
  if (horizon.length === 0) return [-1, 1]
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const point of horizon) {
    if (point.el < low) low = point.el
    if (point.el > high) high = point.el
  }
  for (const point of track) high = Math.max(high, point.sun_el, point.earth_el)
  return [low - belowDeg, high + aboveDeg]
}

/** How many times taller than true the skyline strip draws heights: vertical pixels a degree over horizontal ones. */
export function skylineStretch(widthPx: number, heightPx: number, [low, high]: [number, number]): number {
  if (widthPx <= 0 || high <= low) return 1
  return heightPx / (high - low) / (widthPx / 360)
}

/** "height stretched 12 times" (to one decimal under 10: "3.8 times"), "height squeezed to 1/4", or "close to true proportions". */
export function stretchWords(stretch: number): string {
  if (stretch >= 9.95) return `height stretched ${Math.round(stretch)} times`
  if (stretch >= 1.5) return `height stretched ${stretch.toFixed(1)} times`
  if (stretch <= 0.67) return `height squeezed to 1/${Math.round(1 / stretch)}`
  return 'close to true proportions'
}
