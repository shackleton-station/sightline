import { describe, expect, it } from 'vitest'
import { enuBasis, MOON_RADIUS_M } from './customModel'
import { fitMapOf, type LandingField, latticeFor, latticePointM, latticeReachM, marginsOf, pointLight, type PointSky, readField, slopeLatticeFor, verdictAt, verdictPicture } from './landingField'
import { DEFAULT_SPREAD, FITS, missCode } from './landingOdds'
import { DEFAULT_REQUIREMENTS } from './mission'
import { AZIMUTHS } from './pointHorizons'

const REQ = DEFAULT_REQUIREMENTS
const MAX_SLOPE = 10

/** A field over a lattice, filled by a function of where each point is (m from the target). */
function fieldOf(n: number, stepM: number, at: (x: number, y: number) => { sunGapH?: number; sunAtDeg?: number; earthAtDeg?: number; earthGapH?: number }, slopeAt: (x: number, y: number) => number = () => 0): LandingField {
  const lattice = { n, stepM }
  const slope = slopeLatticeFor(lattice, 20)
  const field: LandingField = {
    lattice,
    sunAtDeg: new Float32Array(n * n),
    earthAtDeg: new Float32Array(n * n),
    sunGapH: new Float32Array(n * n),
    earthGapH: new Float32Array(n * n),
    slope,
    slopeDeg: Float32Array.from({ length: slope.n * slope.n }, (_, i) => {
      const { x, y } = latticePointM(slope, i)
      return slopeAt(x, y)
    }),
  }
  for (let i = 0; i < n * n; i += 1) {
    const { x, y } = latticePointM(lattice, i)
    const point = at(x, y)
    field.sunAtDeg[i] = point.sunAtDeg ?? 1
    field.earthAtDeg[i] = point.earthAtDeg ?? 1
    field.sunGapH[i] = point.sunGapH ?? 0
    field.earthGapH[i] = point.earthGapH ?? 0
  }
  return field
}

describe('the lattice of landing points', () => {
  it('is as fine as the terrain for a tight lander and no finer', () => {
    expect(latticeFor({ ...DEFAULT_SPREAD, accuracyM: 50 }).stepM).toBe(20)
    expect(latticeFor({ ...DEFAULT_SPREAD, accuracyM: 100 }).stepM).toBe(30)
  })

  it('reaches twice the accuracy radius each way, along the approach when the miss is stretched', () => {
    for (const spread of [DEFAULT_SPREAD, { ...DEFAULT_SPREAD, accuracyM: 1000 }, { accuracyM: 250, stretch: 3, bearingDeg: 40 }]) {
      const lattice = latticeFor(spread)
      expect(lattice.n % 2).toBe(1)
      expect(latticeReachM(lattice)).toBeGreaterThanOrEqual(2 * spread.accuracyM * spread.stretch)
      // Few enough points to work out while a visitor waits.
      expect(lattice.n * lattice.n).toBeLessThanOrEqual(400)
    }
  })

  it('has the target as its middle point, with row 0 at the top', () => {
    const lattice = { n: 5, stepM: 30 }
    expect(latticePointM(lattice, 12)).toEqual({ x: 0, y: 0 })
    expect(latticePointM(lattice, 0)).toEqual({ x: -60, y: 60 })
    expect(latticePointM(lattice, 24)).toEqual({ x: 60, y: -60 })
  })
})

describe('a landing point over a mission', () => {
  // A point near the pole with a level skyline at 0°, and bodies placed by their height above it.
  const lat = -89
  const lon = 30
  const { north, up } = enuBasis(lat, lon)
  const flat = new Float32Array(AZIMUTHS)
  const sky: PointSky = { lat, lon, heightM: 0, panelM: 2, antennaM: 2, sunMask: flat, earthMask: flat }
  const SUN_KM = 149_600_000
  const EARTH_KM = 384_400
  /** A body's position from the Moon's center, `elDeg` above the level due north of the point. */
  const body = (distKm: number, elDeg: number) => {
    const el = (elDeg * Math.PI) / 180
    const siteKm = (MOON_RADIUS_M + 2) / 1000
    return [0, 1, 2].map((k) => up[k] * siteKm + distKm * (Math.cos(el) * north[k] + Math.sin(el) * up[k]))
  }
  const hoursOf = (sunEl: number[], earthEl: number[]) => Float32Array.from(sunEl.flatMap((el, hour) => [...body(SUN_KM, el), ...body(EARTH_KM, earthEl[hour])]))

  it('counts the Sun as up while any of its disk shows, and the longest run without it', () => {
    // The Sun's radius is about 0.27°: at -0.2° its upper edge still shows; at -0.4° it does not.
    const light = pointLight(sky, hoursOf([1, -0.2, -0.4, -1, -0.4, 2, -1, 3], [5, 5, 5, 5, 5, 5, 5, 5]), 0)
    expect(light.sunAtDeg).toBeCloseTo(1.27, 1)
    expect(light.sunGapH).toBe(3)
    expect(light.earthGapH).toBe(0)
  })

  it('says how far below the skyline the Sun is at landing', () => {
    const light = pointLight(sky, hoursOf([-1, 1], [5, 5]), 0)
    expect(light.sunAtDeg).toBeCloseTo(-0.73, 1)
    expect(light.sunGapH).toBe(1)
  })

  it('asks Earth for its clearance when the mission asks for one', () => {
    // Earth's radius is about 0.95° from the Moon: at 1° all of it shows, yet its center is under 2°.
    const earth = [1, 3, 1, 1]
    const any = pointLight(sky, hoursOf([1, 1, 1, 1], earth), 0)
    expect(any.earthGapH).toBe(0)
    expect(any.earthAtDeg).toBeGreaterThan(1.5)
    const clear = pointLight(sky, hoursOf([1, 1, 1, 1], earth), 2)
    expect(clear.earthAtDeg).toBeCloseTo(-1, 1)
    expect(clear.earthGapH).toBe(2)
  })

  it('looks from the height it is given: a skyline that hides the Sun at one height may not at another', () => {
    const hidden = new Float32Array(AZIMUTHS).fill(2)
    const low = pointLight({ ...sky, sunMask: hidden }, hoursOf([1], [5]), 0)
    const high = pointLight({ ...sky, sunMask: flat }, hoursOf([1], [5]), 0)
    expect(low.sunAtDeg).toBeLessThan(0)
    expect(high.sunAtDeg).toBeGreaterThan(0)
  })
})

describe('reading the ground between the points', () => {
  // Dark for too long to the right of x = 0, fine to the left.
  const half = fieldOf(9, 30, (x) => ({ sunGapH: x > 0 ? 200 : 0 }))

  it('gives each point its own verdict', () => {
    const margins = marginsOf(half, REQ, MAX_SLOPE)
    expect(verdictAt(margins, -60, 30)).toBe(FITS)
    expect(verdictAt(margins, 60, 30)).toBe(missCode('dark'))
  })

  it('puts the line midway between a point that fits and one that does not, however far past its limit', () => {
    const margins = marginsOf(half, REQ, MAX_SLOPE)
    // The last point that fits is at x = 0 and the first that does not at 30: the line is at 15.
    expect(verdictAt(margins, 14, 0)).toBe(FITS)
    expect(verdictAt(margins, 16, 0)).toBe(missCode('dark'))
  })

  it('keeps a limit exactly met, and breaks it an hour later', () => {
    const at = (hours: number) => verdictAt(marginsOf(fieldOf(9, 30, () => ({ sunGapH: hours })), REQ, MAX_SLOPE), 0, 0)
    expect(at(REQ.maxSunGapH)).toBe(FITS)
    expect(at(REQ.maxSunGapH + 1)).toBe(missCode('dark'))
  })

  it('names the limits in the map’s order: the slope, the Sun and Earth at landing, the dark, the silence', () => {
    const all = fieldOf(9, 30, () => ({ sunAtDeg: -1, earthAtDeg: -1, sunGapH: 500, earthGapH: 500 }), () => 30)
    const silent = { ...REQ, maxEarthGapH: 48 }
    expect(verdictAt(marginsOf(all, silent, MAX_SLOPE), 0, 0)).toBe(missCode('slope'))
    expect(verdictAt(marginsOf(all, silent, 45), 0, 0)).toBe(missCode('sunAtLanding'))
    expect(verdictAt(marginsOf(all, { ...silent, sunAtLanding: false }, 45), 0, 0)).toBe(missCode('earthAtLanding'))
    expect(verdictAt(marginsOf(all, { ...silent, sunAtLanding: false, earthAtLanding: false }, 45), 0, 0)).toBe(missCode('dark'))
    expect(verdictAt(marginsOf(all, { ...silent, sunAtLanding: false, earthAtLanding: false, maxSunGapH: 900 }, 45), 0, 0)).toBe(missCode('silence'))
    // With no limit on radio silence, no silence is too long.
    expect(verdictAt(marginsOf(all, { ...REQ, sunAtLanding: false, earthAtLanding: false, maxSunGapH: 900 }, 45), 0, 0)).toBe(FITS)
  })

  it('reads the slope on its own finer lattice', () => {
    const steep = fieldOf(9, 60, () => ({}), (x, y) => (Math.hypot(x - 100, y) < 30 ? 25 : 2))
    const margins = marginsOf(steep, REQ, MAX_SLOPE)
    expect(steep.slope.stepM).toBe(20)
    expect(verdictAt(margins, 100, 0)).toBe(missCode('slope'))
    expect(verdictAt(margins, 40, 0)).toBe(FITS)
  })
})

describe('the aim point agrees with the verdict', () => {
  const fits = fieldOf(9, 30, () => ({}))
  const dark = fieldOf(9, 30, () => ({ sunGapH: 300 }))

  it('is left alone when the points already say what the verdict says', () => {
    expect(marginsOf(fits, REQ, MAX_SLOPE, null)).toEqual(marginsOf(fits, REQ, MAX_SLOPE))
    expect(marginsOf(dark, REQ, MAX_SLOPE, 'dark')).toEqual(marginsOf(dark, REQ, MAX_SLOPE))
    // Another reason than the points' own is still "does not fit": the points keep theirs.
    expect(verdictAt(marginsOf(dark, REQ, MAX_SLOPE, 'silence'), 0, 0)).toBe(missCode('dark'))
  })

  it('fits under the cross when the verdict fits, whatever the points around say', () => {
    const margins = marginsOf(dark, REQ, MAX_SLOPE, null)
    expect(verdictAt(margins, 0, 0)).toBe(FITS)
    expect(verdictAt(margins, 30, 0)).toBe(missCode('dark'))
  })

  it('takes the verdict’s reason under the cross when the verdict does not fit', () => {
    for (const reason of ['slope', 'sunAtLanding', 'earthAtLanding', 'dark', 'silence'] as const) {
      const margins = marginsOf(fits, REQ, MAX_SLOPE, reason)
      expect(verdictAt(margins, 0, 0)).toBe(missCode(reason))
      expect(verdictAt(margins, 30, 30)).toBe(FITS)
    }
  })
})

describe('the odds from the points', () => {
  it('are all or nothing on ground that is all one verdict', () => {
    expect(readField(fieldOf(15, 30, () => ({})), REQ, MAX_SLOPE, DEFAULT_SPREAD).odds.fit).toBeCloseTo(1, 6)
    const none = readField(fieldOf(15, 30, () => ({ earthAtDeg: -2 })), REQ, MAX_SLOPE, DEFAULT_SPREAD).odds
    expect(none.fit).toBe(0)
    expect(none.misses.earthAtLanding).toBeCloseTo(1, 6)
  })

  it('are a half where the line between fits and not runs through the target', () => {
    // Points fit at x <= -30 and not at x >= 30; the target's own is on the line.
    const field = fieldOf(15, 30, (x) => ({ sunAtDeg: x / 60 }))
    const { odds, map } = readField(field, REQ, MAX_SLOPE, DEFAULT_SPREAD)
    expect(odds.fit).toBeCloseTo(0.5, 2)
    expect(odds.covered).toBeGreaterThan(0.9999)
    expect(map.leftM).toBe(-latticeReachM(field.lattice))
  })

  it('draw the picture the map counts: the same verdict at the same place', () => {
    const field = fieldOf(15, 30, (x, y) => ({ sunGapH: x + y > 40 ? 100 : 0 }))
    const margins = marginsOf(field, REQ, MAX_SLOPE)
    const map = fitMapOf(margins)
    const reach = latticeReachM(field.lattice)
    const picture = verdictPicture(margins, reach, map.size)
    expect(Array.from(picture)).toEqual(Array.from(map.verdict))
  })
})
