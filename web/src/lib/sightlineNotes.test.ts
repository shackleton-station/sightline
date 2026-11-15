import { describe, expect, it } from 'vitest'
import type { MastHeight } from '../data/contract'
import { heightNote } from './sightlineNotes'

const stats = (year: number, max_sun_gap_h: number) => ({ year, pct_sun: 60, pct_earth: 50, pct_both: 30, max_sun_gap_h, max_earth_gap_h: 300 })
const heights: MastHeight[] = [
  { obs_height_m: 2, years: [stats(2027, 95), stats(2028, 119)] },
  { obs_height_m: 5, years: [stats(2027, 90), stats(2028, 80)] },
  { obs_height_m: 10, years: [stats(2027, 94), stats(2028, 67)] },
]

describe('heightNote', () => {
  it('says what going higher does to the longest dark stretch, for the year on show', () => {
    expect(heightNote(heights, 2028, 2)).toBe('Height above ground: 2 m. Higher helps: at 10 m the longest dark stretch in 2028 drops from 119 h to 67 h.')
  })
  it('says so plainly when it barely helps', () => {
    expect(heightNote(heights, 2027, 2)).toBe('Height above ground: 2 m. Higher barely helps: at 10 m the longest dark stretch in 2027 is 94 h, against 95 h.')
  })
  it('gives the height alone when there is nothing to compare', () => {
    expect(heightNote(null, 2028, 2)).toBe('Height above ground: 2 m.')
    expect(heightNote(heights, 2031, 2)).toBe('Height above ground: 2 m.')
  })
})
