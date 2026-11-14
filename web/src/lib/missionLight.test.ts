import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { lightHours, seriesPaths, spanStats } from './missionLight'

/** A level skyline all the way round. */
const LEVEL = Array.from({ length: 720 }, (_, i) => ({ az: i / 2, el: 0 }))
const hour = (over: Partial<TrackPoint>): TrackPoint => ({ t: '2027-05-06T13:00:00Z', sun_az: 0, sun_el: 0, sun_frac: 0, sun_up: false, earth_az: 0, earth_el: 0, earth_up: false, ...over }) as TrackPoint

describe('lightHours', () => {
  it("gives the Sun's share as the pipeline has it, in percent", () => {
    const hours = lightHours([hour({ sun_frac: 0.25 }), hour({ sun_frac: 1 })], LEVEL, () => 1)
    expect(hours.map((one) => one.sunPct)).toEqual([25, 100])
  })

  it("works out Earth's share from its centre's height above the skyline and its radius", () => {
    const [above, half, below] = lightHours([hour({ earth_el: 3 }), hour({ earth_el: 0 }), hour({ earth_el: -3 })], LEVEL, () => 1)
    expect(above.earthPct).toBe(100)
    expect(half.earthPct).toBeCloseTo(50, 5)
    expect(below.earthPct).toBe(0)
  })

  it("falls back to the pipeline's flag where Earth's radius is not to hand", () => {
    const hours = lightHours([hour({ earth_up: true }), hour({ earth_up: false })], LEVEL, () => null)
    expect(hours.map((one) => one.earthPct)).toEqual([100, 0])
  })
})

describe('spanStats', () => {
  // Up for 3 hours, down for 2, up for 1, down for 4, up for 2.
  const up = [true, true, true, false, false, true, false, false, false, false, true, true]

  it('counts the hours up and finds the longest time down, from the landing', () => {
    expect(spanStats(up, 0, 12)).toEqual({ upHours: 6, totalHours: 12, gap: { start: 6, hours: 4 } })
  })

  it('counts from the landing, not from the start of the data', () => {
    expect(spanStats(up, 4, 9)).toEqual({ upHours: 1, totalHours: 5, gap: { start: 2, hours: 3 } })
  })

  it('has no gap when the body is never down', () => {
    expect(spanStats([true, true], 0, 2)).toEqual({ upHours: 2, totalHours: 2, gap: null })
  })
})

describe('seriesPaths', () => {
  it('draws 0% at the bottom and 100% at the top, an hour a unit, and closes the area to the baseline', () => {
    expect(seriesPaths([0, 100, 50])).toEqual({ line: 'M0 100.0L1 0.0L2 50.0', area: 'M0 100.0L1 0.0L2 50.0L2 100L0 100Z' })
  })

  it('is empty for no hours', () => {
    expect(seriesPaths([])).toEqual({ line: '', area: '' })
  })
})
