import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { dayMarks, riverSegments, riverTime, runsWithin } from './river'

const hour = (i: number, sun: boolean, earth: boolean): TrackPoint => ({
  t: new Date(Date.UTC(2027, 4, 1) + i * 3_600_000).toISOString().replace('.000Z', 'Z'),
  sun_az: 0,
  sun_el: 0,
  sun_frac: sun ? 1 : 0,
  sun_up: sun,
  earth_az: 0,
  earth_el: 0,
  earth_up: earth,
  sun_vec_me: [1, 0, 0],
})

describe('the time river', () => {
  it('joins hours with the same things up into one run, covering the month once', () => {
    const track = [hour(0, true, true), hour(1, true, true), hour(2, true, false), hour(3, false, false), hour(4, false, true), hour(5, false, true)]
    expect(riverSegments(track)).toEqual([
      { from: 0, to: 2, state: 'both' },
      { from: 2, to: 3, state: 'sun' },
      { from: 3, to: 4, state: 'none' },
      { from: 4, to: 6, state: 'earth' },
    ])
    expect(riverSegments([])).toEqual([])
  })

  it('finds the runs of landing hours inside the month shown', () => {
    const viable = Uint8Array.from([1, 1, 0, 0, 1, 1, 1, 0, 1])
    expect(runsWithin(viable, 2, 6)).toEqual([{ from: 2, to: 5 }])
    expect(runsWithin(viable, 0, 9)).toEqual([{ from: 0, to: 2 }, { from: 4, to: 7 }, { from: 8, to: 9 }])
    expect(runsWithin(null, 0, 9)).toEqual([])
  })

  it('words a time for a person, and marks round dates', () => {
    expect(riverTime('2027-05-03T12:00:00Z')).toBe('3 May 2027 · 12:00 UTC')
    const track = Array.from({ length: 24 * 11 }, (_, i) => hour(i, true, true))
    expect(dayMarks(track)).toEqual([
      { index: 0, day: 1 },
      { index: 96, day: 5 },
      { index: 216, day: 10 },
    ])
  })
})
