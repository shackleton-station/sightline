import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cellAt, cellCenter, cellsUpAt, cellsWithSunAtLeast, distanceKm, type LightMeta, type LightMetaFile, lightMeta, numbersFor, planeXY, rangeWords, readMonth, spotAt, upSeries, wideGrid } from './lightGrid'

/** A 4 x 4 grid of 120 m cells, laid out like the real one (map y toward 0° E, map x toward 90° E). */
const META: LightMeta = {
  size: 4,
  pixel_m: 120,
  half_width_m: 240,
  radius_m: 1737400,
  x_axis_lon_deg: 90,
  y_axis_lon_deg: 0,
  obs_height_m: 2,
  sun_slots: 8,
  earth_slots: 4,
  hours: { '2027-05': 20 },
}
const CELLS = 16

/** A month where every cell is down all month, then the given cells' flips are set. */
function month(sun: Record<number, number[]>, earth: Record<number, number[]> = {}) {
  const all = new Uint16Array(CELLS * 12).fill(20)
  for (const [cell, flips] of Object.entries(sun)) flips.forEach((flip, slot) => (all[slot * CELLS + Number(cell)] = flip))
  for (const [cell, flips] of Object.entries(earth)) flips.forEach((flip, slot) => (all[(8 + slot) * CELLS + Number(cell)] = flip))
  return readMonth(all.buffer, META, '2027-05')
}

describe('lightGrid', () => {
  it('refuses a file that is not this grid, or a month it does not have', () => {
    expect(() => readMonth(new ArrayBuffer(10), META, '2027-05')).toThrow(/not this grid/)
    expect(() => readMonth(new ArrayBuffer(CELLS * 24), META, '2031-01')).toThrow(/no 2031-01/)
  })

  it('puts 0° east up the map and 90° east to its right, as the terrain file does', () => {
    const towardEarth = planeXY(META, -89.99, 0)
    expect(towardEarth.x).toBeCloseTo(0, 6)
    expect(towardEarth.y).toBeCloseTo(303.2, 0)
    const east = planeXY(META, -89.99, 90)
    expect(east.x).toBeCloseTo(303.2, 0)
    expect(east.y).toBeCloseTo(0, 6)
  })

  it('finds the cell holding a point, and its center back', () => {
    // 100 m from the pole toward 0° E: just above the middle, so row 1 (row 0 is the top), column 2.
    const lat = -90 + (100 / 1737400) * (180 / Math.PI)
    expect(cellAt(META, lat, 0.01)).toEqual({ col: 2, row: 1 })
    expect(cellAt(META, lat, 179.99)).toEqual({ col: 2, row: 2 })
    expect(cellAt(META, -89.9, 0)).toBeNull()
    expect(cellAt(META, 89.9999, 0)).toBeNull()
    const center = cellCenter(META, { col: 2, row: 1 })
    expect(cellAt(META, center.lat, center.lon)).toEqual({ col: 2, row: 1 })
    const xy = planeXY(META, center.lat, center.lon)
    expect(xy.x).toBeCloseTo(60, 3)
    expect(xy.y).toBeCloseTo(60, 3)
  })

  it('reads a cell as up after an odd number of flips', () => {
    const grid = month({ 5: [3, 7, 15] })
    const series = upSeries(grid, 'sun', { col: 1, row: 1 })
    expect([...series].join('')).toBe('00011110000000011111')
    expect([...upSeries(grid, 'sun', { col: 0, row: 0 })].every((up) => up === 0)).toBe(true)
    // Up from the first hour: a flip at hour 0.
    expect([...upSeries(month({ 0: [0] }), 'sun', { col: 0, row: 0 })].every((up) => up === 1)).toBe(true)
  })

  it('counts a month the way a site summary does', () => {
    const sun = Uint8Array.from([1, 1, 0, 0, 0, 1, 1, 1, 0, 0])
    const earth = Uint8Array.from([0, 1, 1, 0, 0, 0, 0, 1, 1, 1])
    expect(numbersFor(sun, earth)).toEqual({ pctSun: 50, pctEarth: 50, pctBoth: 20, sunGapH: 3, earthGapH: 4 })
  })

  it('reports how much the cells around a spot differ', () => {
    const grid = month({ 5: [0, 10], 6: [0, 15], 9: [0, 5] }, { 5: [0] })
    const spot = spotAt(grid, { col: 1, row: 1 })
    expect(spot.numbers.pctSun).toBe(50)
    expect(spot.numbers.pctEarth).toBe(100)
    expect(spot.nearby.pctSun).toEqual([0, 75])
    expect(spot.nearby.pctEarth).toEqual([0, 100])
    expect(spot.nearby.sunGapH).toEqual([5, 20])
    // A corner has only three neighbours, and still answers.
    expect(spotAt(grid, { col: 0, row: 0 }).nearby.pctSun).toEqual([0, 50])
  })

  it('counts how much of the grid is lit, over the month and at one hour', () => {
    // Of 16 cells: one has the Sun for 10 of 20 hours, one for 15, one for 5; two see Earth all month.
    const grid = month({ 5: [0, 10], 6: [0, 15], 9: [0, 5] }, { 5: [0], 0: [0] })
    expect(cellsWithSunAtLeast(grid, 0.5)).toBe(2 / 16)
    expect(cellsWithSunAtLeast(grid, 0.75)).toBe(1 / 16)
    expect(cellsWithSunAtLeast(grid, 0)).toBe(1)
    expect(cellsUpAt(grid, 3)).toEqual({ sun: 3 / 16, earth: 2 / 16, both: 1 / 16 })
    expect(cellsUpAt(grid, 12)).toEqual({ sun: 1 / 16, earth: 2 / 16, both: 0 })
  })

  it('describes the wide grid as a grid of its own, on the same plane and months', () => {
    expect(wideGrid(META)).toBeNull()
    const wide = wideGrid({ ...META, wide: { size: 4, pixel_m: 300, half_width_m: 600 } })
    expect(wide).toMatchObject({ size: 4, pixel_m: 300, half_width_m: 600, radius_m: META.radius_m, hours: META.hours, sun_slots: 8 })
    expect(wide?.wide).toBeUndefined()
    // A point 500 m from the pole is outside the fine grid and inside the wide one.
    const lat = -90 + (500 / 1737400) * (180 / Math.PI)
    expect(cellAt(META, lat, 0)).toBeNull()
    expect(wide && cellAt(wide, lat, 0)).toEqual({ col: 2, row: 0 })
  })

  it('words a range, or one number when the neighbours agree', () => {
    expect(rangeWords([48.2, 70.6])).toBe('48 to 71%')
    expect(rangeWords([61.6, 62.4])).toBe('62%')
    expect(rangeWords([96, 112], ' h')).toBe('96 to 112 h')
  })

  it('measures distance over the ground', () => {
    expect(distanceKm({ lat: -90, lon: 0 }, { lat: -89, lon: 77 }, 1737400)).toBeCloseTo(30.32, 1)
  })
})

/** What the pipeline wrote for a few real cells (`pipeline/scripts/check_light_grid.py --fixture`). */
interface Fixture {
  month: string
  hours: number
  cells: {
    site: string
    lat: number
    lon: number
    col: number
    row: number
    sun_flips: number[]
    earth_flips: number[]
    sun: string
    earth: string
    pct_sun: number
    pct_earth: number
    pct_both: number
    sun_gap_h: number
    earth_gap_h: number
  }[]
}

describe('lightGrid against the pipeline', () => {
  const fixture = JSON.parse(readFileSync(new URL('./lightGrid.fixture.json', import.meta.url), 'utf8')) as Fixture
  const real = lightMeta(JSON.parse(readFileSync(new URL('../../public/data/light/meta.json', import.meta.url), 'utf8')) as LightMetaFile)

  it('finds the same cell for each listed site as Python does', () => {
    expect(fixture.cells.length).toBeGreaterThanOrEqual(4)
    for (const cell of fixture.cells) expect(cellAt(real, cell.lat, cell.lon)).toEqual({ col: cell.col, row: cell.row })
  })

  it("reads each cell's month exactly as Python counted it, hour for hour", () => {
    // The fixture's cells, laid out as a one-row grid in the month file's own layout.
    const size = fixture.cells.length
    const cells = size * size
    const slots = real.sun_slots + real.earth_slots
    const all = new Uint16Array(cells * slots).fill(fixture.hours)
    fixture.cells.forEach((cell, at) => {
      cell.sun_flips.forEach((flip, slot) => (all[slot * cells + at] = flip))
      cell.earth_flips.forEach((flip, slot) => (all[(real.sun_slots + slot) * cells + at] = flip))
    })
    const grid = readMonth(all.buffer, { ...real, size, hours: { [fixture.month]: fixture.hours } }, fixture.month)
    fixture.cells.forEach((cell, col) => {
      const sun = upSeries(grid, 'sun', { col, row: 0 })
      const earth = upSeries(grid, 'earth', { col, row: 0 })
      expect([...sun].join('')).toBe(cell.sun)
      expect([...earth].join('')).toBe(cell.earth)
      const numbers = numbersFor(sun, earth)
      expect(numbers.pctSun).toBeCloseTo(cell.pct_sun, 5)
      expect(numbers.pctEarth).toBeCloseTo(cell.pct_earth, 5)
      expect(numbers.pctBoth).toBeCloseTo(cell.pct_both, 5)
      expect(numbers.sunGapH).toBe(cell.sun_gap_h)
      expect(numbers.earthGapH).toBe(cell.earth_gap_h)
    })
  })
})
