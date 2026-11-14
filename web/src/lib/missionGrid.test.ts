import { describe, expect, it } from 'vitest'
import { cellCentreM, FITS, missCode, missOf } from './landingOdds'
import { cellCenter, type LightMeta, type LightMonth, readMonth, upSeries } from './lightGrid'
import { landingProblems, type Requirements } from './mission'
import { addMonth, fitMapAround, fitPixels, fitsAtTarget, type GridGaps, lightVerdict, missionMonths, slopeDegFrom, squareAround, startGaps } from './missionGrid'

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

describe('the whole grid as a picture', () => {
  it('is one color where a landing fits and another where it does not', () => {
    const gaps = startGaps(2)
    gaps.sunAt.set([1, 0, 1, 1])
    gaps.earthAt.fill(1)
    const slope = new Float32Array(16).fill(3)
    slope[15] = 20 // the last pixel of the last cell
    const pixels = fitPixels(gaps, REQ, 10, 2, slope, [10, 200, 30], [200, 40, 20])
    const at = (pixel: number) => Array.from(pixels.slice(4 * pixel, 4 * pixel + 4))
    expect(pixels.length).toBe(4 * 16)
    expect(at(0)).toEqual([10, 200, 30, 255])
    expect(at(2)).toEqual([200, 40, 20, 255])
    expect(at(10)).toEqual([10, 200, 30, 255])
    expect(at(15)).toEqual([200, 40, 20, 255])
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
