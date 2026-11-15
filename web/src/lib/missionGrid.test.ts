import { describe, expect, it } from 'vitest'
import { cellCentreM, type FitMap, FITS, missCode, MISSES, missOf, VERDICT_RGB, verdictColor } from './landingOdds'
import { cellCenter, type LightMeta, type LightMonth, planeXY, readMonth, upSeries } from './lightGrid'
import { landingProblems, type Requirements } from './mission'
import { addMonth, codePixels, fitField, flatShare, fitMapAround, fitsAtTarget, type GridGaps, lightVerdict, meanAlongBearings, missionMonths, slopeDegFrom, squareAround, startGaps, valueAt, verdictPixels } from './missionGrid'

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

describe('where a landing fits, a pixel at a time', () => {
  it('marks where a landing fits from the grid and the slope', () => {
    const gaps = startGaps(2)
    gaps.sunAt.set([1, 0, 1, 1])
    gaps.earthAt.fill(1)
    const flat = new Float32Array(16).fill(1)
    flat[15] = 0
    expect(Array.from(fitField(gaps, REQ, 2, flat))).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0])
    expect(Array.from(fitField(gaps, REQ, 1, null))).toEqual([1, 0, 1, 1])
    // A pixel a quarter of whose ground is level fits a quarter as much, where the light fits at all.
    flat[0] = 0.25
    flat[2] = 0.25
    expect(Array.from(fitField(gaps, REQ, 2, flat).slice(0, 4))).toEqual([0.25, 1, 0, 0])
  })

  it('counts the share of each pixel’s slopes under the limit, one by one', () => {
    // A slope image of 4 by 4 values, two along each pixel: 128 is level, 150 is 9.83 degrees, 255 is 45.
    const x = new Uint8Array([128, 255, 128, 128, 128, 128, 128, 128, 150, 150, 255, 255, 150, 150, 255, 255])
    const y = new Uint8Array(16).fill(128)
    expect(Array.from(flatShare(x, y, 1, 2, 10))).toEqual([0.75, 1, 1, 0])
    // A limit under 9.83 degrees takes the third pixel away whole.
    expect(Array.from(flatShare(x, y, 1, 2, 9))).toEqual([0.75, 1, 0, 0])
    // The slope along y counts as the slope along x does: every value is level along x and 45 degrees along y.
    expect(Array.from(flatShare(y, new Uint8Array(16).fill(1), 1, 2, 10))).toEqual([0, 0, 0, 0])
    // One value to a pixel: each is level or it is not, as `slopeDegFrom` says.
    const deg = slopeDegFrom(x, y, 1)
    expect(Array.from(flatShare(x, y, 1, 1, 10))).toEqual(Array.from(deg, (value) => (value > 10 ? 0 : 1)))
  })

  it('reads the light verdict between the cells’ middles, and keeps the slope’s own detail', () => {
    // Two light cells side by side: the left fits, the right does not.
    const gaps = startGaps(2)
    gaps.sunAt.set([1, 0, 1, 0])
    gaps.earthAt.fill(1)
    const hard = fitField(gaps, REQ, 4, null)
    const soft = fitField(gaps, REQ, 4, null, true)
    // Cell by cell, a row is four ones and four zeros.
    expect(Array.from(hard.slice(0, 8))).toEqual([1, 1, 1, 1, 0, 0, 0, 0])
    // Between the middles it falls evenly from 1 to 0, and is flat outside them.
    expect(Array.from(soft.slice(0, 8)).map((value) => Number(value.toFixed(3)))).toEqual([1, 1, 0.875, 0.625, 0.375, 0.125, 0, 0])
    // Both say the same about how much of the ground fits.
    const sum = (field: Float32Array) => field.reduce((total, value) => total + value, 0)
    expect(sum(soft)).toBeCloseTo(sum(hard), 5)
    // Steep ground is still left out pixel by pixel.
    const flat = new Float32Array(64).fill(1)
    flat[0] = 0
    expect(fitField(gaps, REQ, 4, flat, true)[0]).toBe(0)
  })
})

describe('the picture on the Moon, in Landing accuracy’s colors', () => {
  const rgb = (pixels: Uint8ClampedArray, pixel: number) => Array.from(pixels.slice(4 * pixel, 4 * pixel + 3))
  const colorOf = (code: number) => [...VERDICT_RGB[code]]
  const green = colorOf(FITS)

  it('has the colors the panel’s map is drawn in', () => {
    expect(green).toEqual([0x57, 0xc0, 0x8a])
    for (let code = 0; code <= MISSES.length; code += 1) {
      const hex = `#${colorOf(code).map((value) => value.toString(16).padStart(2, '0')).join('')}`
      expect(hex).toBe(verdictColor(code))
    }
  })

  it('colors each pixel by what a landing there does: the fit’s green, or the first limit broken', () => {
    // Four cells: fits; the Sun down at landing; a dark too long; Earth out of view at landing.
    const gaps = startGaps(2)
    gaps.sunAt.set([1, 0, 1, 1])
    gaps.earthAt.set([1, 1, 1, 0])
    gaps.sunGapH.set([0, 0, 500, 0])
    const pixels = verdictPixels(gaps, REQ, 1, null)
    expect(rgb(pixels, 0)).toEqual(green)
    expect(rgb(pixels, 1)).toEqual(colorOf(missCode('sunAtLanding')))
    expect(rgb(pixels, 2)).toEqual(colorOf(missCode('dark')))
    expect(rgb(pixels, 3)).toEqual(colorOf(missCode('earthAtLanding')))
    // Every color is drawn as strongly as the fit's.
    expect([3, 7, 11, 15].map((at) => pixels[at])).toEqual([255, 255, 255, 255])
  })

  it('is green exactly where a landing fits on the whole of a pixel', () => {
    const gaps = startGaps(4)
    gaps.sunAt.fill(1)
    gaps.earthAt.fill(1)
    for (const cell of [1, 6, 7, 12]) gaps.sunAt[cell] = 0
    const flat = new Float32Array(64).fill(1)
    flat[9] = 0
    flat[40] = 0.5
    for (const soft of [false, true]) {
      const fits = fitField(gaps, REQ, 2, flat, soft)
      const pixels = verdictPixels(gaps, REQ, 2, flat, soft)
      for (let pixel = 0; pixel < fits.length; pixel += 1) {
        const isGreen = rgb(pixels, pixel).every((value, i) => value === green[i])
        expect(isGreen, `pixel ${pixel}, soft ${soft}`).toBe(fits[pixel] === 1)
      }
    }
  })

  it('mixes in the color of ground too steep, by the share of the pixel that is', () => {
    const gaps = startGaps(1)
    gaps.sunAt.fill(1)
    gaps.earthAt.fill(1)
    const steep = colorOf(missCode('slope'))
    expect(rgb(verdictPixels(gaps, REQ, 1, new Float32Array([0])), 0)).toEqual(steep)
    expect(rgb(verdictPixels(gaps, REQ, 1, new Float32Array([0.5])), 0)).toEqual(green.map((value, i) => Math.round((value + steep[i]) / 2)))
  })

  it('reads the color between the cells’ middles when asked, so no square shows', () => {
    // Two light cells side by side: the left fits, the Sun is down at landing on the right.
    const gaps = startGaps(2)
    gaps.sunAt.set([1, 0, 1, 0])
    gaps.earthAt.fill(1)
    const miss = colorOf(missCode('sunAtLanding'))
    const soft = verdictPixels(gaps, REQ, 4, null, true)
    expect(rgb(soft, 0)).toEqual(green)
    expect(rgb(soft, 7)).toEqual(miss)
    // Between the middles the color goes evenly from one to the other: 0.625 of the way at the fourth pixel.
    expect(rgb(soft, 3)).toEqual(green.map((value, i) => Math.round(value * 0.625 + miss[i] * 0.375)))
    // Cell by cell there is nothing between.
    const hard = verdictPixels(gaps, REQ, 4, null)
    expect(rgb(hard, 3)).toEqual(green)
    expect(rgb(hard, 4)).toEqual(miss)
  })

  it('colors codes one for one, as strongly as asked', () => {
    const pixels = codePixels(new Uint8Array([FITS, missCode('silence')]), 0.5)
    expect(Array.from(pixels)).toEqual([...green, 128, ...colorOf(missCode('silence')), 128])
    expect(codePixels(new Uint8Array([FITS]))[3]).toBe(255)
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

  /** 1 where a landing fits and 0 where it does not: a value a cell, to look around with. */
  const fits = (from: FitMap) => Float32Array.from(from.verdict, (code) => (code === FITS ? 1 : 0))

  it('finds north straight away from the pole, and east a quarter turn on', () => {
    const lon = 30
    // The site's place on the polar map: north of it is farther from the pole along the same line.
    const site = planeXY(META, -89.5, lon)
    const away = Math.hypot(site.x, site.y)
    const north = { x: site.x / away, y: site.y / away }
    const good = map((x, y) => x * north.x + y * north.y > 200)
    const [toNorth, toEast, toSouth, toWest] = meanAlongBearings(good, fits(good), lon, [0, 90, 180, 270], 300, 1200)
    expect(toNorth).toBeCloseTo(1, 5)
    expect(toSouth).toBeCloseTo(0, 5)
    expect(toEast).toBeCloseTo(0, 5)
    expect(toWest).toBeCloseTo(0, 5)
    // East is the way longitude grows: good ground lying that way is found at bearing 90.
    const eastward = planeXY(META, -89.5, lon + 1)
    const east = { x: eastward.x - site.x, y: eastward.y - site.y }
    const toTheEast = map((x, y) => x * east.x + y * east.y > 200 * Math.hypot(east.x, east.y))
    const found = meanAlongBearings(toTheEast, fits(toTheEast), lon, [0, 90, 180, 270], 300, 1200)
    expect(found[1]).toBeCloseTo(1, 5)
    expect(found[3]).toBeCloseTo(0, 5)
  })

  it('reads a value at a point, and none off the map', () => {
    const all = map(() => true)
    expect(valueAt(all, fits(all), 100, -100)).toBe(1)
    expect(valueAt(all, fits(all), 5000, 0)).toBeNull()
    expect(meanAlongBearings(all, fits(all), 0, [0], 4000, 5000)).toEqual([null])
  })
})