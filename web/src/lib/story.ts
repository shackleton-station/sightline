import type { TrackPoint } from '../data/contract'
import { looseDuration } from './earthSun'
import type { SiteFlags } from './flags'
import { hourOf } from './mission'
import { monthName } from './months'
import { distanceKm } from './slip'

export type CameraCue = 'above' | 'sun' | 'earth'

/** What a story step can read: the month on show, and when things are up everywhere. */
export interface StoryContext {
  track: TrackPoint[]
  horizon: { az: number; el: number }[]
  /** Hourly flags by site id, and where each site is. */
  flags: Record<string, SiteFlags>
  places: Record<string, { name: string; lat: number; lon: number }>
}

export interface StoryStep {
  id: string
  siteId: string
  month: string
  camera: CameraCue
  /** Hours within the month to move the time through while this step shows. */
  sweep: (context: StoryContext) => [number, number]
  /** Every number comes from the data on show, never from this file. */
  caption: (context: StoryContext) => string
}

const extent = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)]

const peakIndex = (track: TrackPoint[]) =>
  track.reduce((best, point, i) => (point.sun_el > track[best].sun_el ? i : best), 0)

/** Length of the unbroken run of equal flags around an hour. */
export function runLength(flags: boolean[], hour: number): number {
  let from = hour
  let to = hour
  while (from > 0 && flags[from - 1] === flags[hour]) from -= 1
  while (to + 1 < flags.length && flags[to + 1] === flags[hour]) to += 1
  return to - from + 1
}

/** Index of the last sunrise before an index in the month, or the month's start. */
function sunriseBefore(track: TrackPoint[], index: number): number {
  for (let i = index; i > 0; i -= 1) if (!track[i - 1].sun_up && track[i].sun_up) return i
  return 0
}

/** Index of the first sunset after an index in the month, or the month's last hour. */
function sunsetAfter(track: TrackPoint[], index: number): number {
  for (let i = index; i + 1 < track.length; i += 1) if (track[i].sun_up && !track[i + 1].sun_up) return i
  return track.length - 1
}

/** A month's share of hours with a flag set, as a whole percent. */
export function monthShare(flags: SiteFlags, month: string, body: 'sun' | 'earth'): number {
  const [year, m] = month.split('-').map(Number)
  const from = hourOf(flags.start, new Date(Date.UTC(year, m - 1, 1)).toISOString())
  const to = hourOf(flags.start, new Date(Date.UTC(year, m, 1)).toISOString())
  let up = 0
  for (let t = from; t < to; t += 1) if (flags[body][t]) up += 1
  return Math.round((100 * up) / (to - from))
}

/** Months of a year with the least and most Sun at a site. */
export function sunExtremes(flags: SiteFlags, year: number): { low: string; high: string } {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const share = (month: string) => monthShare(flags, month, 'sun')
  return {
    low: months.reduce((best, month) => (share(month) < share(best) ? month : best)),
    high: months.reduce((best, month) => (share(month) > share(best) ? month : best)),
  }
}

const APOLLO = 'apollo-11'
const SHACKLETON = 'shackleton-rim'
const RIDGE = 'connecting-ridge'
const MONTH = '2027-05'
const STORY_YEAR = 2027

/** About a minute, from a site with Earth-like days to the ridge tops where dates decide everything. */
export const STORY: StoryStep[] = [
  {
    id: 'equator-day',
    siteId: APOLLO,
    month: MONTH,
    camera: 'above',
    sweep: ({ track }) => {
      const peak = peakIndex(track)
      return [sunriseBefore(track, peak), peak]
    },
    caption: ({ track }) =>
      `Apollo 11 landed near the Moon's equator. Here the Sun climbs to ${track[peakIndex(track)].sun_el.toFixed(0)}°, almost overhead.`,
  },
  {
    id: 'equator-night',
    siteId: APOLLO,
    month: MONTH,
    camera: 'above',
    sweep: ({ track }) => {
      const peak = peakIndex(track)
      return [peak, Math.min(sunsetAfter(track, peak) + 24, track.length - 1)]
    },
    caption: ({ track, flags }) => {
      const site = flags[APOLLO]
      const hour = hourOf(site.start, track[peakIndex(track)].t)
      const dayH = runLength(site.sun, hour)
      return `But daylight here lasts ${looseDuration(dayH)}. Then comes a night of ${looseDuration(runLength(site.sun, hour + dayH))}.`
    },
  },
  {
    id: 'earth-hangs',
    siteId: APOLLO,
    month: MONTH,
    // From above, Earth's line holds still while the Sun's sweeps past. Standing here and looking
    // up at Earth would be a dot on a black sky, which doesn't show that.
    camera: 'above',
    sweep: ({ track }) => [0, track.length - 1],
    caption: ({ track }) => {
      const [low, high] = extent(track.map((point) => point.earth_el))
      return `Earth never sets here. All month it hangs high in the sky, between ${low.toFixed(0)}° and ${high.toFixed(0)}°.`
    },
  },
  {
    id: 'pole-circles',
    siteId: SHACKLETON,
    month: MONTH,
    camera: 'above',
    sweep: ({ track }) => [0, track.length - 1],
    caption: ({ track }) => {
      const [low, high] = extent(track.map((point) => point.sun_el))
      return `At the south pole, the Sun never climbs. It circles the horizon, rising and falling by only ${(high - low).toFixed(1)}° all month.`
    },
  },
  {
    id: 'ridges-decide',
    siteId: SHACKLETON,
    month: MONTH,
    camera: 'sun',
    sweep: ({ track }) => {
      const sunset = sunsetAfter(track, 0)
      return [Math.max(sunset - 18, 0), Math.min(sunset + 6, track.length - 1)]
    },
    caption: () =>
      `So low hills decide everything. With no air to soften it, the light goes out when the Sun slips behind a ridge.`,
  },
  {
    id: 'places-differ',
    siteId: RIDGE,
    month: MONTH,
    camera: 'above',
    sweep: ({ track }) => [0, track.length - 1],
    caption: ({ flags, places }) => {
      const km = distanceKm(places[RIDGE], places[SHACKLETON])
      return `Connecting Ridge is only ${km.toFixed(0)} km from Shackleton's rim. In May, our model has the Sun up ${monthShare(flags[RIDGE], MONTH, 'sun')}% of the time here, and ${monthShare(flags[SHACKLETON], MONTH, 'sun')}% there.`
    },
  },
  {
    id: 'dates-differ',
    siteId: RIDGE,
    month: MONTH,
    camera: 'above',
    sweep: ({ track }) => [0, track.length - 1],
    caption: ({ flags }) => {
      const { low, high } = sunExtremes(flags[RIDGE], STORY_YEAR)
      return `Dates matter just as much. On this same ridge, the Sun is up ${monthShare(flags[RIDGE], low, 'sun')}% of ${monthName(low)} and ${monthShare(flags[RIDGE], high, 'sun')}% of ${monthName(high)}, so a delay can change everything.`
    },
  },
  {
    id: 'your-turn',
    siteId: RIDGE,
    month: MONTH,
    camera: 'above',
    sweep: ({ track }) => [0, Math.min(48, track.length - 1)],
    caption: () => `Your turn. Pick any site and date, or see every site and month at once.`,
  },
]

const MS_PER_WORD = 330
const MIN_STEP_MS = 6000

/** How long a caption stays up, by how long it takes to read. */
export function stepDurationMs(caption: string): number {
  return Math.max(MIN_STEP_MS, caption.split(/\s+/).length * MS_PER_WORD)
}
