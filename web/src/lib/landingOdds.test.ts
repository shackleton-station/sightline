import { describe, expect, it } from 'vitest'
import {
  ACCURACY_SHARE,
  aimOdds,
  bestAim,
  bestCentredAim,
  cellAtM,
  cellCentreM,
  cellChances,
  DEFAULT_SPREAD,
  erf,
  type FitMap,
  FITS,
  landingOdds,
  largestAccuracyM,
  loosestAccuracyM,
  MISS_COLORS,
  missCode,
  oddsWords,
  offeredAccuracies,
  radiusHolding,
  readSpreadLink,
  rings,
  sigmaM,
  type Spread,
  spreadLink,
  spreadWords,
  verdictColor,
} from './landingOdds'

/** A square map centred on the target, every cell with one code. */
function evenMap(size: number, cellM: number, code = FITS): FitMap {
  return { size, cellM, leftM: (-size * cellM) / 2, topM: (size * cellM) / 2, verdict: new Uint8Array(size * size).fill(code) }
}

/** A lander whose misses are the same in every direction. */
function round(accuracyM: number): Spread {
  return { accuracyM, stretch: 1, bearingDeg: 0 }
}

/** The map with only the cells `keep` picks fitting; the rest too dark. */
function only(map: FitMap, keep: (x: number, y: number) => boolean): FitMap {
  for (let cell = 0; cell < map.verdict.length; cell += 1) {
    const { x, y } = cellCentreM(map, cell)
    map.verdict[cell] = keep(x, y) ? FITS : missCode('dark')
  }
  return map
}

const oddsFor = (map: FitMap, spread: Spread) => landingOdds(map, cellChances(map, spread))
const total = (chances: Float64Array) => chances.reduce((sum, chance) => sum + chance, 0)

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
    expect(radiusHolding(0.99, sigma)).toBeCloseTo(100, 9)
    // Half of all landings are within 1.1774 sigma of the target.
    expect(radiusHolding(0.5, sigma) / sigma).toBeCloseTo(1.17741, 4)
    // Counted on a fine map: the cells within 100 m hold 99% of landings.
    const map = only(evenMap(200, 5), (x, y) => Math.hypot(x, y) < 100)
    expect(oddsFor(map, round(100)).fit).toBeCloseTo(ACCURACY_SHARE, 2)
  })

  it('counts every landing once across the map and its rings', () => {
    const map = evenMap(80, 30)
    const chances = cellChances(map, round(300))
    expect(total(chances)).toBeCloseTo(1, 6)
    expect(rings(map, chances, 30, 1200).reduce((sum, ring) => sum + ring.chance, 0)).toBeCloseTo(1, 3)
  })
})

describe('a miss longer along the approach', () => {
  it('holds 99% inside the stretched outline, whichever way it points', () => {
    const map = evenMap(160, 10)
    for (const bearingDeg of [0, 90, 35, 120]) {
      const spread = { accuracyM: 100, stretch: 3, bearingDeg }
      const turn = (bearingDeg * Math.PI) / 180
      const inside = only(evenMap(160, 10), (x, y) => {
        const along = x * Math.sin(turn) + y * Math.cos(turn)
        const across = x * Math.cos(turn) - y * Math.sin(turn)
        return (along / 300) ** 2 + (across / 100) ** 2 < 1
      })
      expect(total(cellChances(map, spread)), `whole map at ${bearingDeg}°`).toBeCloseTo(1, 2)
      expect(oddsFor(inside, spread).fit, `inside the outline at ${bearingDeg}°`).toBeCloseTo(0.99, 2)
    }
  })

  it('agrees with the exact count when it is lined up with the map', () => {
    // A strip up the middle fits. Straight up (0°) is counted exactly; 0.001° off it is sampled.
    const strip = () => only(evenMap(60, 30), (x) => Math.abs(x) < 90)
    const exact = oddsFor(strip(), { accuracyM: 200, stretch: 2, bearingDeg: 0 }).fit
    const sampled = oddsFor(strip(), { accuracyM: 200, stretch: 2, bearingDeg: 0.001 }).fit
    // Sampling is good to a tenth of a point, and the odds are shown in whole points.
    expect(Math.abs(sampled - exact)).toBeLessThan(0.002)
    // The strip is 90 m each way across the path: 1.366 sigma at a sigma of 65.9 m.
    expect(exact).toBeCloseTo(erf(90 / (sigmaM(200) * Math.SQRT2)), 3)
  })

  it('does better along a strip of good ground than across it', () => {
    const strip = () => only(evenMap(80, 30), (x) => Math.abs(x) < 90)
    const along = oddsFor(strip(), { accuracyM: 150, stretch: 4, bearingDeg: 0 }).fit
    const across = oddsFor(strip(), { accuracyM: 150, stretch: 4, bearingDeg: 90 }).fit
    const slanted = oddsFor(strip(), { accuracyM: 150, stretch: 4, bearingDeg: 45 }).fit
    expect(along).toBeGreaterThan(slanted)
    expect(slanted).toBeGreaterThan(across)
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

  it('has a color for a cell that fits and for each reason it does not', () => {
    expect(verdictColor(FITS)).toBe('#57c08a')
    expect(verdictColor(missCode('slope'))).toBe(MISS_COLORS.slope)
    expect(new Set([verdictColor(FITS), ...Object.values(MISS_COLORS)]).size).toBe(6)
  })
})

describe('the odds of fitting', () => {
  it('is certain on ground that all fits and nil on ground that never does', () => {
    expect(oddsFor(evenMap(20, 30), round(100)).fit).toBeCloseTo(1, 9)
    const none = oddsFor(evenMap(20, 30, missCode('dark')), round(100))
    expect(none.fit).toBe(0)
    expect(none.misses.dark).toBeCloseTo(1, 9)
  })

  it('is one half when half the plane fits, wherever the cell edges fall', () => {
    for (const [size, cellM] of [
      [20, 30],
      [8, 120],
      [2, 600],
    ]) {
      const odds = oddsFor(only(evenMap(size, cellM), (x) => x < 0), round(150))
      expect(odds.fit).toBeCloseTo(0.5, 6)
      expect(odds.misses.dark).toBeCloseTo(0.5, 6)
    }
  })

  it('weighs ground by how likely a landing there is', () => {
    // Only a 120 m square on the target fits: 60 m each way.
    const square = () => only(evenMap(40, 30), (x, y) => Math.abs(x) < 60 && Math.abs(y) < 60)
    // At a sigma of 60 m that is one sigma each way: erf(1/sqrt(2)) squared.
    const accuracyFor = (sigma: number) => sigma * Math.sqrt(2 * Math.log(100))
    expect(oddsFor(square(), round(accuracyFor(60))).fit).toBeCloseTo(0.6826895 ** 2, 5)
    // A tighter lander does better on the same ground.
    expect(oddsFor(square(), round(accuracyFor(20))).fit).toBeGreaterThan(0.99)
  })

  it('says how much of the bell curve the map holds, and adds up to one', () => {
    const map = evenMap(4, 30, missCode('silence'))
    map.verdict[5] = FITS
    const odds = oddsFor(map, round(300))
    expect(odds.covered).toBeGreaterThan(0)
    expect(odds.covered).toBeLessThan(0.5)
    expect(odds.fit + Object.values(odds.misses).reduce((sum, chance) => sum + chance, 0)).toBeCloseTo(1, 9)
  })

  it('answers for a map off-centre from the target', () => {
    // The target sits 15 m right of and 45 m below the map's middle; cell edges fall at x = -15 and +15.
    const map = only({ size: 30, cellM: 30, leftM: -465, topM: 495, verdict: new Uint8Array(900) }, (x) => x >= 0)
    // The split is at -15 m, so a little more than half fits.
    const sigma = sigmaM(150)
    expect(oddsFor(map, round(150)).fit).toBeCloseTo(0.5 * (1 + erf(15 / (sigma * Math.SQRT2))), 5)
  })
})

describe('rings and the loosest accuracy', () => {
  it('reports how much of each ring fits', () => {
    const map = only(evenMap(40, 30), (x, y) => Math.hypot(x, y) < 300)
    const chances = cellChances(map, round(200))
    const all = rings(map, chances, 150, 900)
    expect(all.slice(0, 4).map((ring) => ring.fitShare)).toEqual([1, 1, 0, 0])
    expect(all[0]).toMatchObject({ fromM: 0, toM: 150 })
    // The first ring holds the landings within 150 m: 1 - exp(-150² / 2 sigma²), to the cells' coarseness.
    expect(all[0].chance).toBeCloseTo(1 - Math.exp(-(150 ** 2) / (2 * sigmaM(200) ** 2)), 1)
    // Past the map's corner there is no ground to judge.
    expect(rings(map, chances, 150, 1500).at(-1)?.fitShare).toBeNull()
  })

  it('finds the loosest accuracy that keeps the odds', () => {
    // Ground that fits within 200 m of the target and nowhere else.
    const map = only(evenMap(100, 30), (x, y) => Math.hypot(x, y) < 200)
    expect(largestAccuracyM(map)).toBeCloseTo(1200, 9)
    expect(largestAccuracyM(map, 3)).toBeCloseTo(400, 9)
    const offered = offeredAccuracies()
    expect(offered[0]).toBe(50)
    expect(offered.at(-1)).toBe(1000)
    // 90% of landings within 200 m means sigma = 200 / 2.146 = 93.2 m: an accuracy of 283 m.
    expect(loosestAccuracyM(map, 0.9, offered)).toBe(275)
    // Longer along the approach, the same accuracy spills farther: the loosest is tighter.
    expect(loosestAccuracyM(map, 0.9, offered, { ...DEFAULT_SPREAD, stretch: 3 })).toBeLessThan(275)
    expect(loosestAccuracyM(evenMap(100, 30, missCode('dark')), 0.9, offered)).toBeNull()
    // A map too small to hold a loose lander's landings does not answer for it.
    expect(loosestAccuracyM(evenMap(6, 30), 0.9, offered)).toBe(50)
  })
})

describe('a better place to aim', () => {
  it('is the middle of the good ground, when the target is at its edge', () => {
    // Good ground is a disc of 150 m centred 180 m to the right of the target and 60 m above it.
    const map = only(evenMap(120, 30), (x, y) => Math.hypot(x - 180, y - 60) < 150)
    const chances = cellChances(map, round(150))
    const here = landingOdds(map, chances).fit
    const aim = bestAim(map, chances, 600)
    if (!aim) throw new Error('no better aim')
    expect(aim.x).toBeCloseTo(180, 9)
    expect(aim.y).toBeCloseTo(60, 9)
    expect(aim.fit).toBeGreaterThan(here + 0.3)
    // The odds it promises are the odds of aiming there: the same map seen from that point.
    const moved: FitMap = { ...map, leftM: map.leftM - aim.x, topM: map.topM - aim.y }
    expect(aim.fit).toBeCloseTo(oddsFor(moved, round(150)).fit, 3)
  })

  it('stays within the distance allowed', () => {
    const map = only(evenMap(120, 30), (x, y) => Math.hypot(x - 180, y - 60) < 150)
    const aim = bestAim(map, cellChances(map, round(150)), 120)
    if (!aim) throw new Error('no better aim')
    expect(Math.hypot(aim.x, aim.y)).toBeLessThanOrEqual(120)
  })

  it('is none when the target is already as good as anywhere', () => {
    const all = evenMap(60, 30)
    expect(bestAim(all, cellChances(all, round(150)), 400)).toBeNull()
    const none = evenMap(60, 30, missCode('dark'))
    expect(bestAim(none, cellChances(none, round(150)), 400)).toBeNull()
    const centred = only(evenMap(120, 30), (x, y) => Math.hypot(x, y) < 150)
    expect(bestAim(centred, cellChances(centred, round(150)), 600)).toBeNull()
  })

  it('does not aim where landings would fall off the map', () => {
    // Good ground only in the map's far corner: a lander aimed there would land partly off the map.
    const map = only(evenMap(40, 30), (x, y) => x > 500 && y > 500)
    expect(bestAim(map, cellChances(map, round(300)), 2000)).toBeNull()
  })
})

describe('odds and spreads in words and links', () => {
  it('never rounds odds to certain', () => {
    expect(oddsWords(0.874)).toBe('87%')
    expect(oddsWords(0.9995)).toBe('over 99%')
    expect(oddsWords(0.004)).toBe('under 1%')
    expect(oddsWords(1)).toBe('100%')
    expect(oddsWords(0)).toBe('0%')
  })

  it('says a spread as one length, or two when it is stretched', () => {
    expect(spreadWords(round(250))).toBe('250 m')
    expect(spreadWords({ accuracyM: 250, stretch: 2.5, bearingDeg: 40 })).toBe('250 m by 625 m')
  })

  it('carries a spread in a link and reads it back', () => {
    expect(spreadLink(round(250))).toBe('&acc=250')
    const stretched = { accuracyM: 400, stretch: 2.5, bearingDeg: 45 }
    expect(spreadLink(stretched)).toBe('&acc=400&accs=2.5&accd=45')
    expect(readSpreadLink(`#a=connecting-ridge@2026-11&t=5${spreadLink(stretched)}`)).toEqual(stretched)
    expect(readSpreadLink('#a=connecting-ridge@2026-11&t=5&acc=250')).toEqual(round(250))
    expect(readSpreadLink('#a=connecting-ridge@2026-11&t=5')).toBeNull()
  })

  it('brings a link’s values onto the sliders’ stops', () => {
    expect(readSpreadLink('#acc=9999&accs=17&accd=400')).toEqual({ accuracyM: 1000, stretch: 4, bearingDeg: 175 })
    expect(readSpreadLink('#acc=113&accs=1.2')).toEqual({ accuracyM: 125, stretch: 1, bearingDeg: 0 })
    expect(readSpreadLink('#acc=abc')).toBeNull()
    // With no stretch the direction means nothing and is dropped.
    expect(readSpreadLink('#acc=200&accd=90')).toEqual(round(200))
  })
})

describe('the odds, checked by throwing landings', () => {
  /**
   * A repeatable stream of numbers from 0 to 1 (mulberry32). A simpler generator will not do here:
   * landings are drawn two numbers at a time, and one whose neighbouring numbers are related puts
   * them in a pattern, not a bell curve.
   */
  function random(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let mixed = Math.imul(state ^ (state >>> 15), state | 1)
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
      return (((mixed ^ (mixed >>> 14)) >>> 0) + 0.5) / 4294967296
    }
  }

  /**
   * The share of landings that come down on a cell that fits, by drawing them one at a time from
   * the bell curve itself (Box and Muller's way) and looking up where each falls: nothing shared
   * with `cellChances` but the map.
   */
  function thrown(map: FitMap, spread: Spread, count: number, seed: number): number {
    const next = random(seed)
    const across = sigmaM(spread.accuracyM)
    const along = across * spread.stretch
    const turn = (spread.bearingDeg * Math.PI) / 180
    let fits = 0
    let landed = 0
    for (let i = 0; i < count; i += 1) {
      const far = Math.sqrt(-2 * Math.log(next()))
      const round = 2 * Math.PI * next()
      const u = along * far * Math.cos(round)
      const v = across * far * Math.sin(round)
      // Along the approach is `turn` clockwise from up; across it is a quarter turn on.
      const cell = cellAtM(map, u * Math.sin(turn) + v * Math.cos(turn), u * Math.cos(turn) - v * Math.sin(turn))
      if (cell === null) continue
      landed += 1
      if (map.verdict[cell] === FITS) fits += 1
    }
    return fits / landed
  }

  /** Ground in patches: each cell fits or not by a fixed pattern of blobs, with the target off the cells' middles. */
  function patchy(seed: number): FitMap {
    const next = random(seed)
    const blobs = Array.from({ length: 14 }, () => ({ x: 2400 * next() - 1200, y: 2400 * next() - 1200, r: 80 + 420 * next() }))
    const map: FitMap = { size: 90, cellM: 30, leftM: -1350 + 30 * next(), topM: 1350 - 30 * next(), verdict: new Uint8Array(8100) }
    return only(map, (x, y) => blobs.some((blob) => Math.hypot(x - blob.x, y - blob.y) < blob.r))
  }

  it('agrees for round and stretched spreads, lined up with the map and turned on it', () => {
    const spreads: Spread[] = [round(100), round(400), { accuracyM: 150, stretch: 3, bearingDeg: 0 }, { accuracyM: 150, stretch: 3, bearingDeg: 90 }, { accuracyM: 200, stretch: 2.5, bearingDeg: 35 }, { accuracyM: 100, stretch: 4, bearingDeg: 140 }]
    for (const seed of [11, 29, 47]) {
      const map = patchy(seed)
      for (const spread of spreads) {
        const worked = oddsFor(map, spread).fit
        const drawn = thrown(map, spread, 200_000, seed + 1)
        // 200,000 landings pin the share to about a quarter of a point; the odds are shown in whole points.
        expect(Math.abs(worked - drawn), `${JSON.stringify(spread)} on ground ${seed}: worked ${worked.toFixed(4)}, thrown ${drawn.toFixed(4)}`).toBeLessThan(0.006)
      }
    }
  })
})

describe('a better place to aim, at a light cell centre', () => {
  // 30 m slope cells, four to a 120 m light cell; the target 50 m right of and 20 m below a light
  // cell's corner, so the light cells' centres are not on the target's own grid of offsets.
  const shifted = (keep: (x: number, y: number) => boolean) => only({ size: 48, cellM: 30, leftM: -770, topM: 700, verdict: new Uint8Array(48 * 48) }, keep)

  it('lands on a light cell centre, with the odds of aiming there', () => {
    const map = shifted((x, y) => Math.hypot(x - 180, y - 60) < 150)
    const here = oddsFor(map, round(150))
    const aim = bestCentredAim(map, round(150), 120, 600, here)
    if (!aim) throw new Error('no better aim')
    // Centres sit at leftM + 60 + 120k across and topM - 60 - 120k down.
    expect((((aim.x - map.leftM - 60) % 120) + 120) % 120).toBeCloseTo(0, 9)
    expect((((map.topM - 60 - aim.y) % 120) + 120) % 120).toBeCloseTo(0, 9)
    expect(Math.hypot(aim.x - 180, aim.y - 60)).toBeLessThanOrEqual(85)
    expect(aim.fit).toBeGreaterThan(here.fit + 0.3)
    expect(aim.fit).toBeCloseTo(aimOdds(map, round(150), aim.x, aim.y).fit, 9)
  })

  it('is none when nothing nearby is better, or the good ground is off the map', () => {
    const centred = shifted((x, y) => Math.hypot(x, y) < 200)
    expect(bestCentredAim(centred, round(150), 120, 600, oddsFor(centred, round(150)))).toBeNull()
    const corner = shifted((x, y) => x > 550 && y > 550)
    expect(bestCentredAim(corner, round(300), 120, 2000, oddsFor(corner, round(300)))).toBeNull()
  })
})
