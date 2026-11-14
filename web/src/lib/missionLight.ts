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

/** The mean of each share over some hours, in percent; zero for no hours. */
export function lightMeans(hours: LightHour[]): LightHour {
  if (hours.length === 0) return { sunPct: 0, earthPct: 0 }
  const sum = hours.reduce((total, hour) => ({ sunPct: total.sunPct + hour.sunPct, earthPct: total.earthPct + hour.earthPct }), { sunPct: 0, earthPct: 0 })
  return { sunPct: sum.sunPct / hours.length, earthPct: sum.earthPct / hours.length }
}

/** The means for each whole or part day of 24 hours, in order from the landing. */
export function lightDays(hours: LightHour[]): LightHour[] {
  const days: LightHour[] = []
  for (let from = 0; from < hours.length; from += 24) days.push(lightMeans(hours.slice(from, from + 24)))
  return days
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
