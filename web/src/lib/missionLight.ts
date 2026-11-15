import type { TrackPoint } from '../data/contract'
import { horizonAt } from './customModel'
import { earthShare } from './sightlineSky'

/** One hour of a mission: how much of the Sun's disc and of Earth's disc is in view, in percent. */
export interface LightHour {
  sunPct: number
  earthPct: number
}

/**
 * The share of the Sun's and of Earth's disc in view at each hour of a mission, in percent. The
 * Sun's is the pipeline's own (`sun_frac`). Earth's is worked out the way the landing's is: from how
 * far its centre is above the skyline and its angular radius at that hour. Where its radius is not
 * to hand (`earthRadiusDeg` gives null) the pipeline's flag stands in: all of it, or none.
 */
export function lightHours(track: TrackPoint[], earthHorizon: { az: number; el: number }[], earthRadiusDeg: (point: TrackPoint) => number | null): LightHour[] {
  return track.map((point) => {
    const radius = earthRadiusDeg(point)
    const earth = radius === null ? (point.earth_up ? 1 : 0) : earthShare(point.earth_el - horizonAt(earthHorizon, point.earth_az), radius)
    return { sunPct: 100 * point.sun_frac, earthPct: 100 * earth }
  })
}

/** The Sun's elevation from level, in degrees, while any of it is in view: its lowest and highest. */
export interface SunWhileUp {
  lowDeg: number
  highDeg: number
}

/** The lowest and highest elevation of the Sun over the hours given in which any of it is in view; null if it is never up. */
export function sunWhileUp(track: Pick<TrackPoint, 'sun_up' | 'sun_el'>[]): SunWhileUp | null {
  const up = track.filter((point) => point.sun_up).map((point) => point.sun_el)
  return up.length > 0 ? { lowDeg: Math.min(...up), highDeg: Math.max(...up) } : null
}

/** A body over a mission, from its hourly up-or-down flags: the hours it is up, the mission's hours, and its longest time down. */
export interface SpanStats {
  upHours: number
  totalHours: number
  /** The longest unbroken time down: the hour it starts, counted from the landing, and how long it lasts. Null when the body is never down. */
  gap: { start: number; hours: number } | null
}

/** The hours up and the longest time down between two hours of the data (the landing, and the mission's end). The earliest of equal gaps. */
export function spanStats(up: ArrayLike<boolean>, from: number, to: number): SpanStats {
  let upHours = 0
  let gap: SpanStats['gap'] = null
  let run = 0
  for (let hour = from; hour < to; hour += 1) {
    if (up[hour]) {
      upHours += 1
      run = 0
    } else {
      run += 1
      if (!gap || run > gap.hours) gap = { start: hour - run + 1 - from, hours: run }
    }
  }
  return { upHours, totalHours: to - from, gap }
}

/**
 * A series of percentages as two SVG paths in a box as many units wide as there are steps between
 * its hours and 100 high (0% at the bottom): the line, and the same line closed down to the baseline.
 */
export function seriesPaths(values: number[]): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' }
  const y = (value: number) => (100 - Math.min(100, Math.max(0, value))).toFixed(1)
  const line = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${i} ${y(value)}`).join('')
  const last = Math.max(values.length - 1, 0)
  return { line, area: `${line}L${last} 100L0 100Z` }
}
