import { describe, expect, it } from 'vitest'
import { cellCentreM, cellChances, erf, type FitMap, FITS, landingOdds, missCode, missOf, sigmaM } from './landingOdds'
import { cellCenter, type LightMeta, type LightMonth, planeXY, readMonth, upSeries } from './lightGrid'
import { landingProblems, type Requirements } from './mission'
import { addMonth, fieldOf, fitField, fitMapAround, fitsAtTarget, type GridGaps, lightVerdict, missionMonths, oddsAlongBearings, oddsAt, oddsColor, oddsField, oddsPixels, oddsStrength, FEW_STRENGTH, slopeDegFrom, squareAround, startGaps } from './missionGrid'

const SIZE = 12
const SUN_SLOTS = 6
const EARTH_SLOTS = 4
/** A small grid on the real grid's plane: 120 m cells, three months. */
const META: LightMeta = {
  size: SIZE,
  pixel_m: 120,
  half_width_m: (SIZE * 120) / 2,
  radius_m: 1_737_400,
  x_axis_lon_deg: 90,
  y_axis_lon_deg: 0,
  obs_height_m: 2,
  sun_slots: SUN_SLOTS,
  earth_slots: EARTH_SLOTS,
  hours: { '2027-05': 744, '2027-06': 720, '2027-07': 744 },
}
const START = '2027-01-01T00:00:00Z'
/** Hours from the start of 2027 to the start of May. */
const MAY = (31 + 28 + 31 + 30) * 24
const REQ: Requirements = { missionDays: 14, maxSunGapH: 24, maxEarthGapH: 99_999, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

/** A repeatable stream of numbers from 0 to 1. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

/** A month whose every cell flips at its own hours, as the pipeline writes them: sorted, unused slots at the month's length. */
function randomMonth(name: string, seed: number): LightMonth {
  const hours = META.hours[name]
  const cells = SIZE * SIZE
  const next = random(seed)
  const all = new Uint16Array(cells * (SUN_SLOTS + EARTH_SLOTS)).fill(hours)
  const fill = (offset: number, slots: number) => {
    for (let cell = 0; cell < cells; cell += 1) {
      const used = Math.floor(next() * (slots + 1))
      const flips = Array.from({ length: used }, () => Math.floor(next() * hours)).sort((a, b) => a - b)
      flips.forEach((flip, slot) => {
        all[offset + slot * cells + cell] = flip
      })
    }
  }
  fill(0, SUN_SLOTS)
  fill(cells * SUN_SLOTS, EARTH_SLOTS)
  return readMonth(all.buffer, META, name)
}

/** The gaps for a landing, counted the way the page does: month by month. */
function gapsFor(months: Record<string, LightMonth>, landing: number, missionDays: number): GridGaps {
  const parts = missionMonths(META, START, landing, missionDays)
  if (!parts) throw new Error('past the grid')
  const run = startGaps(SIZE)
  parts.forEach((part, i) => addMonth(run, months[part.month], part, i === 0))
  return run
}

describe('the months a mission covers', () => {
  it('is one month when the mission ends inside it', () => {
    expect(missionMonths(META, START, MAY + 100, 14)).toEqual([{ month: '2027-05', from: 100, to: 436 }])
  })

  it('carries on into the next months, each from its first hour', () => {
    expect(missionMonths(META, START, MAY + 700, 60)).toEqual([
      { month: '2027-05', from: 700, to: 744 },
      { month: '2027-06', from: 0, to: 720 },
      { month: '2027-07', from: 0, to: 676 },
    ])
  })

  it('is null when the mission runs past the grid', () => {
    expect(missionMonths(META, START, MAY + 744 + 720 + 500, 14)).toBeNull()
  })
})

describe('the gaps at every cell', () => {
  const months = { '2027-05': randomMonth('2027-05', 3), '2027-06': randomMonth('2027-06', 11), '2027-07': randomMonth('2027-07', 29) }

  /** A cell's hours across the three months, end to end. */
  function series(body: 'sun' | 'earth', cell: number): boolean[] {
    const at = { col: cell % SIZE, row: Math.floor(cell / SIZE) }
    return Object.values(months).flatMap((month) => Array.from(upSeries(month, body, at), Boolean))
  }

  it('fits exactly where the app’s own verdict finds no problem, hour by hour', () => {
    const limits: Requirements[] = [REQ, { ...REQ, missionDays: 40, maxSunGapH: 120, maxEarthGapH: 200 }, { ...REQ, sunAtLanding: false, earthAtLanding: false, missionDays: 3, maxSunGapH: 10, maxEarthGapH: 30 }]
    for (const req of limits) {
      for (const hour of [0, 1, 250, 743, 744, 1000]) {
        const gaps = gapsFor(months, MAY + hour, req.missionDays)
        for (let cell = 0; cell < SIZE * SIZE; cell += 1) {
          const problems = landingProblems(series('sun', cell), series('earth', cell), hour, req)
          expect(lightVerdict(gaps, cell, req) === FITS, `cell ${cell}, hour ${hour}, ${req.missionDays} days: ${problems.join(' ')}`).toBe(problems.length === 0)
        }
      }
    }
  })

  it('counts a gap that runs across the end of a month as one', () => {
    const cells = SIZE * SIZE
    // The Sun sets at hour 700 of May and rises at hour 50 of June: 94 hours of dark.
    const may = new Uint16Array(cells * (SUN_SLOTS + EARTH_SLOTS)).fill(744)
    const june = new Uint16Array(cells * (SUN_SLOTS + EARTH_SLOTS)).fill(720)
    for (let cell = 0; cell < cells; cell += 1) {
      may[cell] = 0
      may[cells + cell] = 700
      june[cell] = 50
    }
    const gaps = gapsFor({ '2027-05': readMonth(may.buffer, META, '2027-05'), '2027-06': readMonth(june.buffer, META, '2027-06') }, MAY + 600, 14)
    expect(gaps.sunAt[0]).toBe(1)
    expect(gaps.sunGapH[0]).toBe(94)
    expect(gaps.earthAt[0]).toBe(0)
    expect(gaps.earthGapH[0]).toBe(14 * 24)
    expect(missOf(lightVerdict(gaps, 0, REQ))).toBe('earthAtLanding')
    expect(missOf(lightVerdict(gaps, 0, { ...REQ, earthAtLanding: false }))).toBe('dark')
    expect(lightVerdict(gaps, 0, { ...REQ, earthAtLanding: false, maxSunGapH: 94 })).toBe(FITS)
    expect(missOf(lightVerdict(gaps, 0, { ...REQ, earthAtLanding: false, maxSunGapH: 94, maxEarthGapH: 100 }))).toBe('silence')
  })
})

describe('the map around a target', () => {
  /** Gaps where the Sun is up at landing only in the grid's left half. */
  function halfLit(): GridGaps {
    const gaps = startGaps(SIZE)
    gaps.earthAt.fill(1)
    for (let cell = 0; cell < SIZE * SIZE; cell += 1) gaps.sunAt[cell] = cell % SIZE < 6 ? 1 : 0
    return gaps
  }
  const target = cellCenter(META, { col: 5, row: 6 })

  it('takes in enough cells around the target, or says it cannot', () => {
    // 200 m is under two cells: two each way, and one more since the target may be off-centre.
    expect(squareAround(META, target.lat, target.lon, 200)).toEqual({ col: 2, row: 3, cells: 7 })
    expect(squareAround(META, target.lat, target.lon, 600)).toBeNull()
    expect(squareAround(META, -40, 10, 200)).toBeNull()
  })

  it('is placed from the target, and red where the Sun is down at landing', () => {
    const square = squareAround(META, target.lat, target.lon, 200)
    if (!square) throw new Error('no square')
    const map = fitMapAround(META, halfLit(), square, target.lat, target.lon, REQ, 10, null)
    expect(map.size).toBe(7)
    expect(map.cellM).toBe(120)
    // The target is at its cell's centre, three and a half cells from the map's edges.
    expect(map.leftM).toBeCloseTo(-420, 3)
    expect(map.topM).toBeCloseTo(420, 3)
    // Columns 2 to 5 of the grid are lit, 6 to 8 are not.
    expect(Array.from(map.verdict.slice(0, 7))).toEqual([FITS, FITS, FITS, FITS, ...new Array<number>(3).fill(missCode('sunAtLanding'))])
    expect(fitsAtTarget(map)).toBe(true)
    expect(cellCentreM(map, 24).x).toBeCloseTo(0, 3)
  })

  it('has the slope’s detail where the slope is known', () => {
    const square = squareAround(META, target.lat, target.lon, 200)
    if (!square) throw new Error('no square')
    const deg = new Float32Array((7 * 2) ** 2).fill(4)
    deg[0] = 12 // a lit cell's first quarter
    deg[13] = 12 // an unlit cell's quarter: steep is said first
    const map = fitMapAround(META, halfLit(), square, target.lat, target.lon, REQ, 10, { ...square, sub: 2, deg })
    expect(map.size).toBe(14)
    expect(map.cellM).toBe(60)
    expect(Array.from(map.verdict.slice(0, 3))).toEqual([missCode('slope'), FITS, FITS])
    expect(Array.from(map.verdict.slice(11, 14))).toEqual([missCode('sunAtLanding'), missCode('sunAtLanding'), missCode('slope')])
    // A steeper limit lets that ground in.
    expect(fitMapAround(META, halfLit(), square, target.lat, target.lon, REQ, 15, { ...square, sub: 2, deg }).verdict[0]).toBe(FITS)
  })

  it('leaves out a slope cut for another square', () => {
    const square = squareAround(META, target.lat, target.lon, 200)
    if (!square) throw new Error('no square')
    const map = fitMapAround(META, halfLit(), square, target.lat, target.lon, REQ, 10, { col: 0, row: 0, cells: 7, sub: 2, deg: new Float32Array(196).fill(30) })
    expect(map.size).toBe(7)
    expect(map.verdict[0]).toBe(FITS)
  })
})

describe('slope from the slope images', () => {
  it('reads level, a known slope, and the steepest stored', () => {
    const slope = slopeDegFrom(new Uint8Array([128, 255, 128, 150]), new Uint8Array([128, 128, 1, 128]), 1)
    expect(slope[0]).toBe(0)
    expect(slope[1]).toBeCloseTo(45, 4)
    expect(slope[2]).toBeCloseTo(45, 4)
    // 22 steps of 1/127 rise over run: atan(0.1732) = 9.83 degrees.
    expect(slope[3]).toBeCloseTo(9.83, 2)
  })
})

describe('the odds of fitting, aimed at every pixel', () => {
  const SIDE = 120
  const PIXEL_M = 30
  /** A field where `keep` says a landing fits, by each pixel's middle in meters from the picture's centre (x right, y up). */
  function field(keep: (x: number, y: number) => boolean): Float32Array {
    const out = new Float32Array(SIDE * SIDE)
    for (let row = 0; row < SIDE; row += 1) {
      for (let col = 0; col < SIDE; col += 1) out[row * SIDE + col] = keep((col + 0.5 - SIDE / 2) * PIXEL_M, (SIDE / 2 - row - 0.5) * PIXEL_M) ? 1 : 0
    }
    return out
  }
  const at = (odds: Float32Array, x: number, y: number) => odds[Math.floor(SIDE / 2 - y / PIXEL_M) * SIDE + Math.floor(x / PIXEL_M + SIDE / 2)]
  const round = (accuracyM: number) => ({ accuracyM, stretch: 1, bearingDeg: 0 })

  it('is the field itself where a landing fits everywhere, or nowhere', () => {
    expect(at(oddsField(field(() => true), SIDE, PIXEL_M, round(300)), 15, 15)).toBeCloseTo(1, 5)
    expect(at(oddsField(field(() => false), SIDE, PIXEL_M, round(300)), 15, 15)).toBe(0)
  })

  it('fades across an edge as the bell curve says', () => {
    const odds = oddsField(field((x) => x > 0), SIDE, PIXEL_M, round(300))
    const sigma = sigmaM(300)
    // Aimed at the middle of a pixel whose middle is this far inside the good ground.
    for (const inside of [15, 105, 195, -75]) expect(at(odds, inside, 15)).toBeCloseTo(0.5 * (1 + erf(inside / (sigma * Math.SQRT2))), 3)
    expect(at(odds, 900, 15)).toBeCloseTo(1, 4)
    expect(at(odds, -900, 15)).toBeCloseTo(0, 4)
  })

  it('agrees with the odds the panel works out for one target', () => {
    // Good ground: a disc of 240 m, off to one side of the target.
    const keep = (x: number, y: number) => Math.hypot(x - 150, y + 90) < 240
    const map: FitMap = { size: SIDE, cellM: PIXEL_M, leftM: (-SIDE * PIXEL_M) / 2 - 15, topM: (SIDE * PIXEL_M) / 2 - 15, verdict: new Uint8Array(SIDE * SIDE) }
    const good = field(keep)
    for (let i = 0; i < good.length; i += 1) map.verdict[i] = good[i] ? FITS : missCode('dark')
    for (const spread of [round(200), { accuracyM: 150, stretch: 3, bearingDeg: 0 }, { accuracyM: 150, stretch: 3, bearingDeg: 90 }, { accuracyM: 150, stretch: 2.5, bearingDeg: 40 }]) {
      // The map's target is the middle of the pixel at (15, 15) m.
      const panel = landingOdds(map, cellChances(map, spread)).fit
      expect(at(oddsField(good, SIDE, PIXEL_M, spread), 15, 15), `${spread.stretch}x at ${spread.bearingDeg}°`).toBeCloseTo(panel, 1)
      expect(Math.abs(at(oddsField(good, SIDE, PIXEL_M, spread), 15, 15) - panel)).toBeLessThan(0.02)
    }
  })

  it('reaches farther along the approach than across it', () => {
    // A strip of good ground up the middle; aimed 300 m to its right.
    const strip = field((x) => Math.abs(x) < 90)
    const across = at(oddsField(strip, SIDE, PIXEL_M, { accuracyM: 150, stretch: 4, bearingDeg: 0 }), 315, 15)
    const along = at(oddsField(strip, SIDE, PIXEL_M, { accuracyM: 150, stretch: 4, bearingDeg: 90 }), 315, 15)
    expect(across).toBeLessThan(0.01)
    expect(along).toBeGreaterThan(0.1)
  })

  it('marks where a landing fits from the grid and the slope', () => {
    const gaps = startGaps(2)
    gaps.sunAt.set([1, 0, 1, 1])
    gaps.earthAt.fill(1)
    const slope = new Float32Array(16).fill(3)
    slope[15] = 20
    expect(Array.from(fitField(gaps, REQ, 10, 2, slope))).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0])
    expect(Array.from(fitField(gaps, REQ, 10, 1, null))).toEqual([1, 0, 1, 1])
  })

  it('draws odds from red through amber to green', () => {
    expect(oddsColor(0)).toEqual([194, 69, 45])
    expect(oddsColor(0.5)).toEqual([224, 178, 58])
    expect(oddsColor(1)).toEqual([87, 192, 138])
    expect(oddsColor(0.25)).toEqual([209, 124, 52])
    expect(oddsColor(7)).toEqual([87, 192, 138])
  })

  it('draws the red end faintly and amber and green at full strength, the strength carried in each pixel’s alpha', () => {
    expect(oddsStrength(0)).toBe(FEW_STRENGTH)
    expect(oddsStrength(0.25)).toBeCloseTo((1 + FEW_STRENGTH) / 2)
    expect(oddsStrength(0.5)).toBe(1)
    expect(oddsStrength(1)).toBe(1)
    expect(oddsStrength(-3)).toBe(FEW_STRENGTH)
    // Faint enough that the ground reads through: about 0.15 of the Moon hidden at the shading's 0.38.
    expect(FEW_STRENGTH * 0.38).toBeCloseTo(0.15, 2)
    const pixels = oddsPixels(new Float32Array([0, 1]))
    expect(Array.from(pixels)).toEqual([194, 69, 45, Math.round(255 * FEW_STRENGTH), 87, 192, 138, 255])
    // Alpha only rises with the odds, and is full from half up.
    const alphas = Array.from(oddsPixels(Float32Array.from({ length: 11 }, (_, i) => i / 10))).filter((_, i) => i % 4 === 3)
    expect(alphas.every((alpha, i) => i === 0 || alpha >= alphas[i - 1])).toBe(true)
    expect(alphas.slice(5)).toEqual([255, 255, 255, 255, 255, 255])
  })
})
describe('a picture with no squares', () => {
  it('reads the light verdict between the cells’ middles, and keeps the slope’s own detail', () => {
    // Two light cells side by side: the left fits, the right does not.
    const gaps = startGaps(2)
    gaps.sunAt.set([1, 0, 1, 0])
    gaps.earthAt.fill(1)
    const hard = fitField(gaps, REQ, 10, 4, null)
    const soft = fitField(gaps, REQ, 10, 4, null, true)
    // Cell by cell, a row is four ones and four zeros.
    expect(Array.from(hard.slice(0, 8))).toEqual([1, 1, 1, 1, 0, 0, 0, 0])
    // Between the middles it falls evenly from 1 to 0, and is flat outside them.
    expect(Array.from(soft.slice(0, 8)).map((value) => Number(value.toFixed(3)))).toEqual([1, 1, 0.875, 0.625, 0.375, 0.125, 0, 0])
    // Both say the same about how much of the ground fits.
    const sum = (field: Float32Array) => field.reduce((total, value) => total + value, 0)
    expect(sum(soft)).toBeCloseTo(sum(hard), 5)
    // Steep ground is still left out pixel by pixel.
    const slope = new Float32Array(64).fill(2)
    slope[0] = 30
    expect(fitField(gaps, REQ, 10, 4, slope, true)[0]).toBe(0)
  })

  it('is softened by at least as much as asked, whatever the spread', () => {
    const SIDE = 40
    const edge = new Float32Array(SIDE * SIDE)
    for (let i = 0; i < edge.length; i += 1) edge[i] = i % SIDE < SIDE / 2 ? 1 : 0
    const tight = { accuracyM: 50, stretch: 1, bearingDeg: 0 }
    // A 50 m spread on 60 m pixels leaves the edge nearly as sharp as it was.
    const sharp = oddsField(edge, SIDE, 60, tight)
    expect(sharp[SIDE * 20 + 18]).toBeGreaterThan(0.99)
    // Softened by two pixels, the same edge fades over several.
    const softened = oddsField(edge, SIDE, 60, tight, 2)
    expect(softened[SIDE * 20 + 18]).toBeGreaterThan(0.7)
    expect(softened[SIDE * 20 + 18]).toBeLessThan(0.85)
    expect(softened[SIDE * 20 + 19] + softened[SIDE * 20 + 20]).toBeCloseTo(1, 5)
  })
})

describe('looking around from a site', () => {
  // A map 3 km across in 30 m cells, centred on a target at 30° E: good ground only to one side.
  const size = 100
  const map = (keep: (x: number, y: number) => boolean): FitMap => {
    const out: FitMap = { size, cellM: 30, leftM: -1500, topM: 1500, verdict: new Uint8Array(size * size) }
    for (let cell = 0; cell < out.verdict.length; cell += 1) {
      const { x, y } = cellCentreM(out, cell)
      out.verdict[cell] = keep(x, y) ? FITS : missCode('dark')
    }
    return out
  }

  it('finds north straight away from the pole, and east a quarter turn on', () => {
    const lon = 30
    // The site's place on the polar map: north of it is farther from the pole along the same line.
    const site = planeXY(META, -89.5, lon)
    const away = Math.hypot(site.x, site.y)
    const north = { x: site.x / away, y: site.y / away }
    const good = map((x, y) => x * north.x + y * north.y > 200)
    const odds = fieldOf(good)
    const [toNorth, toEast, toSouth, toWest] = oddsAlongBearings(good, odds, lon, [0, 90, 180, 270], 300, 1200)
    expect(toNorth).toBeCloseTo(1, 5)
    expect(toSouth).toBeCloseTo(0, 5)
    expect(toEast).toBeCloseTo(0, 5)
    expect(toWest).toBeCloseTo(0, 5)
    // East is the way longitude grows: good ground lying that way is found at bearing 90.
    const eastward = planeXY(META, -89.5, lon + 1)
    const east = { x: eastward.x - site.x, y: eastward.y - site.y }
    const toTheEast = map((x, y) => x * east.x + y * east.y > 200 * Math.hypot(east.x, east.y))
    const found = oddsAlongBearings(toTheEast, fieldOf(toTheEast), lon, [0, 90, 180, 270], 300, 1200)
    expect(found[1]).toBeCloseTo(1, 5)
    expect(found[3]).toBeCloseTo(0, 5)
  })

  it('reads the odds at a point, and none off the map', () => {
    const all = map(() => true)
    expect(oddsAt(all, fieldOf(all), 100, -100)).toBe(1)
    expect(oddsAt(all, fieldOf(all), 5000, 0)).toBeNull()
    expect(oddsAlongBearings(all, fieldOf(all), 0, [0], 4000, 5000)).toEqual([null])
  })
})