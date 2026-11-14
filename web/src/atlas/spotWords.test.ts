import { describe, expect, it } from 'vitest'
import type { LightMeta, Spot } from '../lib/lightGrid'
import { distanceWords, nowWords, placeWords, spotWords } from './spotWords'

const META = { pixel_m: 120 } as LightMeta

describe('spotWords', () => {
  it('names a place and a distance', () => {
    expect(placeWords(-89.3142, -132.46)).toBe('89.31° S, 132.5° W')
    expect(placeWords(12.5, 30)).toBe('12.50° N, 30.0° E')
    expect(distanceWords(0.37)).toBe('370 m')
    expect(distanceWords(2.44)).toBe('2.4 km')
    expect(distanceWords(36.2)).toBe('36 km')
  })

  it('says what is up, joining good and bad news the way the site pages do', () => {
    expect(nowWords(true, true)).toBe('Sun in view, Earth in view')
    expect(nowWords(true, false)).toBe('Sun in view, but Earth out of view')
    expect(nowWords(false, false)).toBe('Sun hidden, Earth out of view')
  })

  it('gives each number from the grid, with the range where the neighbours differ', () => {
    const spot: Spot = {
      cell: { col: 1, row: 1 },
      sun: Uint8Array.from([1, 1, 0, 0]),
      earth: Uint8Array.from([0, 1, 1, 1]),
      numbers: { pctSun: 50, pctEarth: 75, pctBoth: 25, sunGapH: 2, earthGapH: 1 },
      nearby: { pctSun: [25, 75], pctEarth: [75, 75], pctBoth: [0, 50], sunGapH: [1, 3], earthGapH: [1, 1] },
    }
    expect(spotWords(spot, 0, 'May 2027', META)).toBe(
      'Now: Sun in view, but Earth out of view. May 2027: Sun 50% of hours (25 to 75% within 120 m), Earth 75%, both 25%, longest dark 2 h.',
    )
    // Where Earth's neighbours differ too, its range follows without repeating the distance.
    const mixed = { ...spot, nearby: { ...spot.nearby, pctEarth: [60, 80] as [number, number] } }
    expect(spotWords(mixed, 0, 'May 2027', META)).toContain('Earth 75% (60 to 80%), both')
    // Where only Earth's neighbours differ, its range is the one that says how far away they are.
    const earthOnly = { ...mixed, nearby: { ...mixed.nearby, pctSun: [50, 50] as [number, number] } }
    expect(spotWords(earthOnly, 0, 'May 2027', META)).toContain('Sun 50% of hours, Earth 75% (60 to 80% within 120 m), both')
    // An hour past the end of the month reads the last hour instead of nothing.
    expect(spotWords(spot, 99, 'May 2027', META)).toContain('Now: Sun hidden, but Earth in view.')
  })
})
