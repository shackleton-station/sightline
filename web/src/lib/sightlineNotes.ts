import type { MastHeight, SiteSpread, Summary } from '../data/contract'
import { mastRows } from './mast'

/**
 * The two short notes on what the hourly numbers assume: the height above the ground they are
 * worked out for, and how much they change within reach of a landing. Each is a figure from the
 * site's own files, said in a sentence or two.
 */

/**
 * "Height above ground: 2 m. Higher helps: at 10 m the longest dark stretch in 2028 drops from
 * 119 h to 67 h." From the site's yearly numbers at each height; says so plainly when going higher
 * barely changes anything.
 */
export function heightNote(heights: MastHeight[] | null, year: number, obsHeightM: number): string {
  const start = `Height above ground: ${obsHeightM} m.`
  const rows = heights ? mastRows(heights, year) : []
  const here = rows.find((row) => row.obs_height_m === obsHeightM) ?? rows[0]
  const top = rows[rows.length - 1]
  if (!here || !top || top.obs_height_m <= here.obs_height_m) return start
  // One hour is the data's step: a change that small is no change.
  if (here.max_sun_gap_h - top.max_sun_gap_h <= 1) {
    return `${start} Higher barely helps: at ${top.obs_height_m} m the longest dark stretch in ${year} is ${top.max_sun_gap_h} h, against ${here.max_sun_gap_h} h.`
  }
  return `${start} Higher helps: at ${top.obs_height_m} m the longest dark stretch in ${year} drops from ${here.max_sun_gap_h} h to ${top.max_sun_gap_h} h.`
}

/** Where a value sits in a range: near the best (the top quarter), near the worst (the bottom quarter), or near the middle. */
export function placeInRange(value: number, low: number, high: number): 'best' | 'middle' | 'worst' {
  if (high <= low) return 'middle'
  const share = (value - low) / (high - low)
  return share >= 0.75 ? 'best' : share <= 0.25 ? 'worst' : 'middle'
}

const AFTER = {
  best: 'This exact spot is near the best of that range, so a landing that misses it can do much worse.',
  middle: 'This exact spot is near the middle of that range, so a landing that misses it can do better or worse.',
  worst: 'This exact spot is near the worst of that range, so a landing that misses it can do better.',
}

/**
 * "Landing accuracy: 100 m. Within 100 m of this point the Sun is up between 24% and 72% of the
 * month. This exact spot is near the best of that range, so a landing that misses it can do much
 * worse." From the site's spread file, which only the south pole ridge sites have, and the month's
 * own figure for the exact point.
 */
export function accuracyNote(spread: SiteSpread | null, month: string, summary: Summary | null): string {
  const row = spread?.months.find((entry) => entry.month === month)
  if (!spread || !row || !summary) return 'Landing accuracy: the numbers are for the exact point. How they change nearby is worked out only for the south pole ridge sites.'
  const start = `Landing accuracy: ${spread.radius_m} m.`
  // The exact point is one of the places within reach, so the range always holds its figure.
  const low = Math.min(row.pct_sun[0], summary.pct_sun)
  const high = Math.max(row.pct_sun[1], summary.pct_sun)
  if (Math.round(high) - Math.round(low) < 2) return `${start} Within ${spread.radius_m} m of this point the Sun is up about ${Math.round(high)}% of the month, wherever the landing falls.`
  return `${start} Within ${spread.radius_m} m of this point the Sun is up between ${Math.round(low)}% and ${Math.round(high)}% of the month. ${AFTER[placeInRange(summary.pct_sun, low, high)]}`
}
