import type { TrackPoint } from '../data/contract'
import type { SiteFlags } from './flags'
import { hourOf } from './mission'
import { changeLabel, hoursUntilChange } from './nextChange'

export interface Countdown {
  /** "Sunset in 5 h", or "No sunset through 2030" when it doesn't happen in the years on hand. */
  label: string
  hours: number | null
}

export interface Answer {
  /** A plain sentence for anyone: is there sunlight, and can you see Earth? */
  headline: string
  sun: Countdown
  earth: Countdown
}

function sunWords(now: TrackPoint): string {
  if (!now.sun_up) return 'No sunlight'
  return now.sun_frac < 1 ? 'Partly sunlit' : 'Sunlit'
}

export function headlineOf(now: TrackPoint): string {
  const sameNews = now.sun_up === now.earth_up
  const earth = now.earth_up ? 'Earth is in view' : 'Earth is out of view'
  return `${sunWords(now)}${sameNews ? ', and' : ', but'} ${earth}.`
}

/** The state at one moment, in words, with time left. Countdowns run across months and years. */
export function answerAt(now: TrackPoint, flags: SiteFlags, lastYear: number): Answer {
  const hour = hourOf(flags.start, now.t)
  const sunHours = hoursUntilChange(flags.sun, hour, 1)
  const earthHours = hoursUntilChange(flags.earth, hour, 1)
  const sunEvent = now.sun_up ? 'Sunset' : 'Sunrise'
  const earthEvent = now.earth_up ? 'Earthset' : 'Earthrise'
  return {
    headline: headlineOf(now),
    sun: { label: changeLabel(sunEvent, sunHours, lastYear), hours: sunHours },
    earth: { label: changeLabel(earthEvent, earthHours, lastYear), hours: earthHours },
  }
}

/**
 * "1.2° above eye level", in words a non-specialist can picture. On high ground the Sun can be up
 * while below eye level, and on low ground it can be hidden while above it, so those say why.
 */
export function sunHeightWords(elDeg: number, up: boolean): string {
  const size = Math.abs(elDeg).toFixed(1)
  if (elDeg < 0) return up ? `${size}° below eye level, visible from this high ground` : `${size}° below eye level`
  return up ? `${size}° above eye level` : `${size}° above eye level, behind terrain`
}

/** The visible share of a partly hidden Sun, never rounded to look fully hidden or fully clear. */
export function diskShareWords(fraction: number): string {
  if (fraction < 0.01) return 'under 1%'
  if (fraction > 0.99) return 'over 99%'
  return `${Math.round(fraction * 100)}%`
}

/** How far a body's center is above or behind the terrain, for planners. */
export function clearanceWords(clearanceDeg: number): string {
  const size = Math.abs(clearanceDeg).toFixed(1)
  return clearanceDeg < 0 ? `center ${size}° behind the terrain` : `center ${size}° above the terrain`
}
