import type { CalendarYearStats, MastHeight } from '../data/contract'

export interface MastRow extends CalendarYearStats {
  obs_height_m: number
}

/** Each height's numbers for one year, lowest first; empty if the year isn't in the data. */
export function mastRows(heights: MastHeight[], year: number): MastRow[] {
  return heights.flatMap(({ obs_height_m, years }) => {
    const row = years.find((entry) => entry.year === year)
    return row ? [{ ...row, obs_height_m }] : []
  })
}

/** What going taller changes, in one sentence; says so plainly when it barely changes anything. */
export function mastSummary(rows: MastRow[]): string | null {
  if (rows.length < 2) return null
  const low = rows[0]
  const high = rows[rows.length - 1]
  const gapChange = low.max_sun_gap_h - high.max_sun_gap_h
  const pointsGained = high.pct_sun - low.pct_sun
  const from = `From ${low.obs_height_m} m to ${high.obs_height_m} m`
  // One hour is the data's resolution, and half a point is less than any measured error.
  if (gapChange <= 1 && pointsGained < 0.5) return `${from}, the Sun barely changes here in ${low.year}.`
  return (
    `${from}, the longest time without Sun in ${low.year} goes from ${low.max_sun_gap_h} h to ` +
    `${high.max_sun_gap_h} h, and the Sun is up ${pointsGained.toFixed(1)} points more of the year.`
  )
}
