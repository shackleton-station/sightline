import { describe, expect, it } from 'vitest'
import type { MastHeight } from '../data/contract'
import { mastRows, mastSummary } from './mast'

const stats = (year: number, pct_sun: number, max_sun_gap_h: number) => ({
  year,
  pct_sun,
  pct_earth: 50,
  pct_both: 40,
  max_sun_gap_h,
  max_earth_gap_h: 100,
})
const heights: MastHeight[] = [
  { obs_height_m: 2, years: [stats(2027, 85.6, 277), stats(2028, 80, 300)] },
  { obs_height_m: 10, years: [stats(2027, 88.6, 135), stats(2028, 82, 200)] },
]

describe('mastRows', () => {
  it('picks one year at every height', () => {
    expect(mastRows(heights, 2027).map((row) => [row.obs_height_m, row.pct_sun])).toEqual([
      [2, 85.6],
      [10, 88.6],
    ])
  })

  it('is empty for a year outside the data', () => {
    expect(mastRows(heights, 2031)).toEqual([])
  })
})

describe('mastSummary', () => {
  it('states the change in the longest gap and the share of Sun', () => {
    expect(mastSummary(mastRows(heights, 2027))).toBe(
      'From 2 m to 10 m, the longest time without Sun in 2027 goes from 277 h to 135 h, and the Sun is up 3.0 points more of the year.',
    )
  })

  it('says plainly when height barely matters', () => {
    const flat: MastHeight[] = [
      { obs_height_m: 2, years: [stats(2027, 48.4, 357)] },
      { obs_height_m: 10, years: [stats(2027, 48.6, 357)] },
    ]
    expect(mastSummary(mastRows(flat, 2027))).toBe('From 2 m to 10 m, the Sun barely changes here in 2027.')
  })

  it('has nothing to say about one height', () => {
    expect(mastSummary(mastRows(heights.slice(0, 1), 2027))).toBeNull()
  })
})
