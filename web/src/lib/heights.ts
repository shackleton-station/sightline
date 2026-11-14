import type { TrackPoint } from '../data/contract'
import type { SiteFlags } from './flags'

/**
 * How high above the ground the Sun and Earth are looked for. Every number the app ships is for a
 * point 2 m up. The pipeline also wrote the same hourly files for 4 m, 5 m and 10 m at the listed
 * sites (docs/VALIDATION.md §15), so the Sun can be read at a solar panel's height and Earth at an
 * antenna's. Each height is from hardware NASA describes (REFERENCES.md).
 */
export interface MissionHeights {
  /** Where the solar panel is: the Sun's hours, share and skyline are read from this height. */
  panelM: number
  /** Where the antenna is: Earth's hours and skyline are read from this height. */
  antennaM: number
}

/** The app's own data: a small lander's deck and panels. */
export const BASE_HEIGHT_M = 2
export const DEFAULT_HEIGHTS: MissionHeights = { panelM: BASE_HEIGHT_M, antennaM: BASE_HEIGHT_M }
export const PANEL_HEIGHTS_M = [2, 5, 10]
export const ANTENNA_HEIGHTS_M = [2, 4, 10]

/** What stands at each height, with where the figure is from, for the choice's hover text. */
export const HEIGHT_MEANS: Record<number, string> = {
  2: "A small lander's deck and panels: NASA describes Blue Ghost Mission 1 as about two metres tall. This is the app's own data.",
  4: 'The top of a Nova-C class lander, where its antennas are: NASA describes the IM-1 lander as about 14 feet (4.3 m) tall.',
  5: "The middle of NASA's vertical solar array, which stands on a mast up to 32 feet (9.8 m) high.",
  10: "The top of NASA's vertical solar array, which deploys up to 32 feet (9.8 m) high.",
}

/** True when both heights are the app's own 2 m: nothing more is loaded and nothing more is said. */
export function isBaseHeights(heights: MissionHeights): boolean {
  return heights.panelM === BASE_HEIGHT_M && heights.antennaM === BASE_HEIGHT_M
}

/** "panel at 10 m, antenna at 4 m", or null when both are the app's own 2 m. */
export function heightsWords(heights: MissionHeights): string | null {
  return isBaseHeights(heights) ? null : `panel at ${heights.panelM} m, antenna at ${heights.antennaM} m`
}

/** A height a link may carry: one of those offered, or the app's own 2 m for anything else. */
export function heightFrom(value: string | null, offered: number[]): number {
  const height = Number(value)
  return value !== null && offered.includes(height) ? height : BASE_HEIGHT_M
}

/**
 * The Sun's hours from the panel's height and Earth's from the antenna's. The two sets cover the
 * same hours, so counts that need both bodies (both up, the gaps, the verdict) are counted from the
 * mixed flags as from any others.
 */
export function mixFlags(sun: SiteFlags, earth: SiteFlags): SiteFlags {
  if (sun === earth) return sun
  if (sun.start !== earth.start || sun.sun.length !== earth.earth.length) throw new Error('the two heights do not cover the same hours')
  return { start: sun.start, sun: sun.sun, earth: earth.earth, earthAbove: earth.earthAbove }
}

/** A month's hourly rows with the Sun's fields from the panel's height and Earth's from the antenna's; they line up hour for hour. */
export function mixTracks(sun: TrackPoint[], earth: TrackPoint[]): TrackPoint[] {
  if (sun === earth) return sun
  if (sun.length !== earth.length) throw new Error('the two heights do not cover the same hours')
  return sun.map((row, i) => {
    const other = earth[i]
    if (other.t !== row.t) throw new Error(`the two heights disagree on the hour at row ${i}`)
    return { ...row, earth_az: other.earth_az, earth_el: other.earth_el, earth_up: other.earth_up }
  })
}
