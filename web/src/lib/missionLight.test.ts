import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { lightDays, lightHours, lightMeans, seriesPaths } from './missionLight'

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

describe('lightMeans and lightDays', () => {
  const hours = Array.from({ length: 36 }, (_, i) => ({ sunPct: i < 24 ? 100 : 0, earthPct: 50 }))

  it('averages each share over the hours', () => {
    expect(lightMeans(hours)).toEqual({ sunPct: (100 * 24) / 36, earthPct: 50 })
    expect(lightMeans([])).toEqual({ sunPct: 0, earthPct: 0 })
  })

  it('averages by day from the landing, the last day being whatever hours are left', () => {
    expect(lightDays(hours)).toEqual([
      { sunPct: 100, earthPct: 50 },
      { sunPct: 0, earthPct: 50 },
    ])
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
