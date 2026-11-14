import { describe, expect, it } from 'vitest'
import {
  ACCURACY_SHARE,
  cellAtM,
  cellCentreM,
  chanceBetween,
  erf,
  type FitMap,
  FITS,
  landingOdds,
  largestAccuracyM,
  loosestAccuracyM,
  missCode,
  oddsWords,
  offeredAccuracies,
  radiusHolding,
  rings,
  sigmaM,
} from './landingOdds'

/** A square map centred on the target, every cell with one code. */
function evenMap(size: number, cellM: number, code = FITS): FitMap {
  return { size, cellM, leftM: (-size * cellM) / 2, topM: (size * cellM) / 2, verdict: new Uint8Array(size * size).fill(code) }
}

describe('the bell curve', () => {
  it('knows the error function', () => {
    expect(erf(0)).toBeCloseTo(0, 6)
    expect(erf(0.5)).toBeCloseTo(0.5204999, 6)
    expect(erf(1)).toBeCloseTo(0.8427008, 6)
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6)
    expect(erf(3)).toBeCloseTo(0.9999779, 6)
  })

  it('puts 99% of landings inside the accuracy radius', () => {
    const sigma = sigmaM(100)
    expect(sigma).toBeCloseTo(100 / Math.sqrt(2 * Math.log(100)), 9)
    expect(chanceBetween(0, 100, sigma)).toBeCloseTo(ACCURACY_SHARE, 9)
    expect(radiusHolding(0.99, sigma)).toBeCloseTo(100, 9)
    // Half of all landings are within 1.1774 sigma of the target.
    expect(radiusHolding(0.5, sigma) / sigma).toBeCloseTo(1.17741, 4)
  })

  it('counts every landing once across rings', () => {
    const sigma = sigmaM(300)
    const total = rings(evenMap(40, 30), sigma, 30, 3000).reduce((sum, ring) => sum + ring.chance, 0)
    expect(total).toBeCloseTo(1, 6)
  })
})

describe('cells of the map', () => {
  it('finds a cell from a point and back', () => {
    const map = evenMap(4, 60)
    expect(cellCentreM(map, 0)).toEqual({ x: -90, y: 90 })
    expect(cellCentreM(map, 15)).toEqual({ x: 90, y: -90 })
    expect(cellAtM(map, -90, 90)).toBe(0)
    expect(cellAtM(map, 119, -119)).toBe(15)
    expect(cellAtM(map, 121, 0)).toBeNull()
  })
})

describe('the odds of fitting', () => {
  it('is certain on ground that all fits and nil on ground that never does', () => {
    const sigma = sigmaM(100)
    expect(landingOdds(evenMap(20, 30), sigma).fit).toBeCloseTo(1, 9)
    const none = landingOdds(evenMap(20, 30, missCode('dark')), sigma)
    expect(none.fit).toBe(0)
    expect(none.misses.dark).toBeCloseTo(1, 9)
  })

  it('is one half when half the plane fits, wherever the cell edges fall', () => {
    for (const [size, cellM] of [
      [20, 30],
      [8, 120],
      [2, 600],
    ]) {
      const map = evenMap(size, cellM)
      for (let cell = 0; cell < map.verdict.length; cell += 1) if (cellCentreM(map, cell).x > 0) map.verdict[cell] = missCode('slope')
      const odds = landingOdds(map, sigmaM(150))
      expect(odds.fit).toBeCloseTo(0.5, 6)
      expect(odds.misses.slope).toBeCloseTo(0.5, 6)
    }
  })

  it('weighs ground by how likely a landing there is', () => {
    // Only a 120 m square on the target fits: 60 m each way, which is ±k sigma on each axis.
    const map = evenMap(40, 30, missCode('dark'))
    for (let cell = 0; cell < map.verdict.length; cell += 1) {
      const { x, y } = cellCentreM(map, cell)
      if (Math.abs(x) < 60 && Math.abs(y) < 60) map.verdict[cell] = FITS
    }
    const sigma = 60
    // The chance of both coordinates within one sigma: erf(1/sqrt(2)) squared.
    expect(landingOdds(map, sigma).fit).toBeCloseTo(0.6826895 ** 2, 5)
    // A tighter lander does better on the same ground.
    expect(landingOdds(map, 20).fit).toBeGreaterThan(0.99)
  })

  it('says how much of the bell curve the map holds, and adds up to one', () => {
    const map = evenMap(4, 30, missCode('silence'))
    map.verdict[5] = FITS
    const odds = landingOdds(map, sigmaM(300))
    expect(odds.covered).toBeGreaterThan(0)
    expect(odds.covered).toBeLessThan(0.5)
    const total = odds.fit + Object.values(odds.misses).reduce((sum, chance) => sum + chance, 0)
    expect(total).toBeCloseTo(1, 9)
  })

  it('answers for a map off-centre from the target', () => {
    // The target sits 15 m right of and 45 m below the map's middle; the right half-plane fits.
    const map: FitMap = { size: 30, cellM: 30, leftM: -465, topM: 495, verdict: new Uint8Array(900) }
    for (let cell = 0; cell < 900; cell += 1) if (cellCentreM(map, cell).x < 0) map.verdict[cell] = missCode('dark')
    // Cell edges fall at x = -15 and +15: the split is at -15, so a little more than half fits.
    const sigma = 50
    expect(landingOdds(map, sigma).fit).toBeCloseTo(0.5 * (1 + erf(15 / (sigma * Math.SQRT2))), 5)
  })
})

describe('rings and the loosest accuracy', () => {
  it('reports how much of each ring fits', () => {
    const map = evenMap(40, 30, missCode('dark'))
    for (let cell = 0; cell < map.verdict.length; cell += 1) {
      const { x, y } = cellCentreM(map, cell)
      if (Math.hypot(x, y) < 300) map.verdict[cell] = FITS
    }
    const all = rings(map, sigmaM(200), 150, 900)
    expect(all.slice(0, 4).map((ring) => ring.fitShare)).toEqual([1, 1, 0, 0])
    expect(all[0]).toMatchObject({ fromM: 0, toM: 150 })
    // Past the map's corner there is no ground to judge.
    expect(rings(map, sigmaM(200), 150, 1500).at(-1)?.fitShare).toBeNull()
  })

  it('finds the loosest accuracy that keeps the odds', () => {
    // Ground that fits within 200 m of the target and nowhere else.
    const map = evenMap(100, 30, missCode('dark'))
    for (let cell = 0; cell < map.verdict.length; cell += 1) {
      const { x, y } = cellCentreM(map, cell)
      if (Math.hypot(x, y) < 200) map.verdict[cell] = FITS
    }
    expect(largestAccuracyM(map)).toBeCloseTo(1200, 9)
    const offered = offeredAccuracies()
    expect(offered[0]).toBe(50)
    expect(offered.at(-1)).toBe(1000)
    const loosest = loosestAccuracyM(map, 0.9, offered)
    // 90% of landings within 200 m means sigma = 200 / 2.146 = 93.2 m: an accuracy of 283 m.
    expect(loosest).toBe(275)
    expect(loosestAccuracyM(evenMap(100, 30, missCode('dark')), 0.9, offered)).toBeNull()
    // A map too small to hold a loose lander's landings does not answer for it.
    expect(loosestAccuracyM(evenMap(6, 30), 0.9, offered)).toBe(50)
  })
})

describe('odds in words', () => {
  it('never rounds to certain', () => {
    expect(oddsWords(0.874)).toBe('87%')
    expect(oddsWords(0.9995)).toBe('over 99%')
    expect(oddsWords(0.004)).toBe('under 1%')
    expect(oddsWords(1)).toBe('100%')
    expect(oddsWords(0)).toBe('0%')
  })
})
