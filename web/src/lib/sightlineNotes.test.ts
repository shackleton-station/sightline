import { describe, expect, it } from 'vitest'
import type { MastHeight, SiteSpread, Summary } from '../data/contract'
import { accuracyNote, heightNote, placeInRange } from './sightlineNotes'

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

const spread = { radius_m: 100, months: [{ month: '2027-05', pct_sun: [24, 72], pct_earth: [40, 60], pct_both: [10, 40], max_sun_gap_h: [50, 200], max_earth_gap_h: [100, 300] }] } as unknown as SiteSpread
const summary = (pct_sun: number) => ({ pct_sun }) as Summary

describe('accuracyNote', () => {
  it('gives the range within reach, and says the spot is near the best of it', () => {
    expect(accuracyNote(spread, '2027-05', summary(70))).toBe(
      'Landing accuracy: 100 m. Within 100 m of this point the Sun is up between 24% and 72% of the month. This exact spot is near the best of that range, so a landing that misses it can do much worse.',
    )
  })
  it('says where the spot sits when it is not near the best', () => {
    expect(accuracyNote(spread, '2027-05', summary(48))).toContain('near the middle of that range')
    expect(accuracyNote(spread, '2027-05', summary(26))).toContain('near the worst of that range, so a landing that misses it can do better.')
    expect(placeInRange(60, 24, 72)).toBe('best')
    expect(placeInRange(59, 24, 72)).toBe('middle')
    expect(placeInRange(36, 24, 72)).toBe('worst')
  })
  it('says the Sun barely changes when the range is narrow', () => {
    const narrow = { ...spread, months: [{ ...spread.months[0], pct_sun: [61, 61.4] }] } as SiteSpread
    expect(accuracyNote(narrow, '2027-05', summary(61.2))).toBe('Landing accuracy: 100 m. Within 100 m of this point the Sun is up about 61% of the month, wherever the landing falls.')
  })
  it('says the numbers are for the exact point where no spread was worked out', () => {
    expect(accuracyNote(null, '2027-05', summary(50))).toMatch(/^Landing accuracy: the numbers are for the exact point\./)
    expect(accuracyNote(spread, '2029-01', summary(50))).toMatch(/exact point/)
  })
  it('has none of the old text', () => {
    expect(accuracyNote(spread, '2027-05', summary(70))).not.toMatch(/Earth up|both up|longest without Sun|not typical/)
  })
})
