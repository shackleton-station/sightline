import type { MastHeight } from '../data/contract'
import { mastRows } from './mast'

/**
 * The short note on what the hourly numbers assume: the height above the ground they are worked out
 * for. It is a figure from the site's own files, said in a sentence or two.
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
