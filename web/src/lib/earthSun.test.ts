import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { earthPath, earthSunElevation, looseDuration, moonPath, pathStats } from './earthSun'

describe('earthSunElevation', () => {
  it('matches the same cases as the Python version', () => {
    expect(earthSunElevation(23.4, 10, 23.4, 10)).toBeCloseTo(90, 5)
    expect(earthSunElevation(23.4, 10, -23.4, -170)).toBeCloseTo(-90, 5)
    expect(earthSunElevation(40, 0, 10, 0)).toBeCloseTo(60, 5)
    expect(earthSunElevation(-90, 0, -20, 0)).toBeCloseTo(20, 5)
    expect(earthSunElevation(-90, 0, -20, 120)).toBeCloseTo(20, 5)
  })
})

describe('earthPath', () => {
  it('rises and sets once a day at mid-latitudes', () => {
    // Two days, with the Sun overhead moving west around the equator.
    const sub_lon = Array.from({ length: 48 }, (_, h) => 180 - h * 15)
    const path = earthPath({ sub_lat: new Array(48).fill(0), sub_lon }, 40)
    const stats = pathStats(path)
    expect(stats.highestDeg).toBeCloseTo(50, 0)
    expect(stats.rises).toBe(2)
    expect(stats.longestUpH).toBeGreaterThanOrEqual(12)
    expect(stats.longestUpH).toBeLessThanOrEqual(13)
  })
})

describe('moonPath', () => {
  it('takes the site’s own numbers, including terrain', () => {
    const track = [
      { sun_el: 1, sun_up: false },
      { sun_el: 2, sun_up: true },
    ] as TrackPoint[]
    expect(moonPath(track)).toEqual({ el: [1, 2], up: [false, true] })
  })
})

describe('pathStats', () => {
  it('finds extremes, runs and rises', () => {
    const stats = pathStats({
      el: [-1, 2, 3, -4, 5],
      up: [false, true, true, false, true],
    })
    expect(stats).toEqual({ highestDeg: 5, lowestDeg: -4, longestUpH: 2, longestDownH: 1, rises: 2 })
  })

  it("doesn't count a Sun already up as a rise", () => {
    expect(pathStats({ el: [1, 1], up: [true, true] }).rises).toBe(0)
  })
})

describe('looseDuration', () => {
  it('uses hours for short stretches and days for long ones', () => {
    expect(looseDuration(13)).toBe('13 h')
    expect(looseDuration(355)).toBe('15 days')
  })
})
