import { describe, expect, it } from 'vitest'
import { bearingBetweenDeg, closenessWords, compassWords, fitsButFewLandWords, oddsTone } from './accuracyWords'
import { type LightMeta, planeLatLon, planeXY } from './lightGrid'

describe('which way a better aim point lies', () => {
  const site = { lat: -89.45, lon: -137.15 }

  it('is north when the point is farther from the south pole on the same meridian, south when nearer', () => {
    expect(bearingBetweenDeg(site, { lat: -89.44, lon: -137.15 })).toBeCloseTo(0, 6)
    expect(bearingBetweenDeg(site, { lat: -89.46, lon: -137.15 })).toBeCloseTo(180, 6)
  })

  it('is east toward greater longitude at the same latitude, west toward lesser', () => {
    expect(bearingBetweenDeg(site, { lat: -89.45, lon: -137.0 })).toBeCloseTo(90, 6)
    expect(bearingBetweenDeg(site, { lat: -89.45, lon: -137.3 })).toBeCloseTo(270, 6)
  })

  it('weighs a step in longitude by how short a degree of it is near the pole', () => {
    // A hundredth of a degree north and a whole degree east are about the same distance at 89.45° S.
    const bearing = bearingBetweenDeg(site, { lat: -89.44, lon: -136.15 })
    expect(bearing).toBeGreaterThan(40)
    expect(bearing).toBeLessThan(50)
  })

  it('takes the short way round across the 180° meridian', () => {
    expect(bearingBetweenDeg({ lat: -85, lon: 179.9 }, { lat: -85, lon: -179.9 })).toBeCloseTo(90, 6)
  })

  it("agrees with the panel's map: a step away from the pole on it is north, a step toward the pole south", () => {
    // Only the plane's own three numbers are used here.
    const meta = { radius_m: 1737400, x_axis_lon_deg: 90, y_axis_lon_deg: 0 } as LightMeta
    const rim = { lat: -89.76197, lon: -157.0672 }
    const at = planeXY(meta, rim.lat, rim.lon)
    const out = Math.hypot(at.x, at.y)
    const step = (x: number, y: number) => compassWords(bearingBetweenDeg(rim, planeLatLon(meta, at.x + x, at.y + y)))
    expect(step((100 * at.x) / out, (100 * at.y) / out)).toBe('north')
    expect(step((-100 * at.x) / out, (-100 * at.y) / out)).toBe('south')
    // A quarter turn from "away from the pole", toward greater longitude, is east.
    expect(step((100 * at.y) / out, (-100 * at.x) / out)).toBe('east')
  })

  it('names the nearest of the eight compass points', () => {
    expect(compassWords(0)).toBe('north')
    expect(compassWords(40)).toBe('north-east')
    expect(compassWords(200)).toBe('south')
    expect(compassWords(292)).toBe('west')
    expect(compassWords(293)).toBe('north-west')
    expect(compassWords(359)).toBe('north')
  })
})

describe('the accuracy in everyday words', () => {
  it('says how close the lander gets to its aim point', () => {
    expect(closenessWords({ accuracyM: 100, stretch: 1, bearingDeg: 0 })).toBe('within 100 m of its aim point')
    expect(closenessWords({ accuracyM: 1000, stretch: 1, bearingDeg: 0 })).toBe('within 1,000 m of its aim point')
  })

  it('adds the longer reach along the approach when the miss is stretched', () => {
    expect(closenessWords({ accuracyM: 100, stretch: 2.5, bearingDeg: 30 })).toBe('within 100 m of its aim point, 250 m along its approach')
  })
})

describe("the odds in the verdict's colours", () => {
  it('is the fit colour at nine in ten or better, the miss colour under half, and the marginal one between', () => {
    expect(oddsTone(1)).toBe('fit')
    expect(oddsTone(0.9)).toBe('fit')
    expect(oddsTone(0.89)).toBe('marginal')
    expect(oddsTone(0.5)).toBe('marginal')
    expect(oddsTone(0.49)).toBe('miss')
    expect(oddsTone(0)).toBe('miss')
  })
})

describe('a scenario that fits at its aim point while few landings aimed there do', () => {
  it('is named in one line, and only when it fits with odds under a half', () => {
    expect(fitsButFewLandWords([{ letter: 'A', fits: true, odds: 0.07 }, { letter: 'B', fits: true, odds: 0.8 }, { letter: 'C', fits: false, odds: 0.02 }])).toBe(
      'A fits at its aim point, but most landings aimed there come down nearby where the mission does not fit.',
    )
    expect(fitsButFewLandWords([{ letter: 'A', fits: true, odds: 0.07 }, { letter: 'B', fits: true, odds: 0.3 }, { letter: 'D', fits: true, odds: 0.49 }])).toBe(
      'A, B and D fit at their aim point, but most landings aimed there come down nearby where the mission does not fit.',
    )
  })

  it('says nothing when no scenario is in that case, or the odds are not known', () => {
    expect(fitsButFewLandWords([{ letter: 'A', fits: true, odds: 0.5 }, { letter: 'B', fits: false, odds: 0.1 }, { letter: 'C', fits: true, odds: null }])).toBeNull()
    expect(fitsButFewLandWords([])).toBeNull()
  })
})
