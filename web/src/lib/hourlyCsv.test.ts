import { describe, expect, it } from 'vitest'
import type { HorizonPoint, TrackPoint } from '../data/contract'
import { HOURLY_COLUMNS, hourlyCsv, hourlyFileName, hourlyRows } from './hourlyCsv'

/** A skyline at one height all round, sampled every half degree as the pipeline's is. */
const flat = (el: number): HorizonPoint[] => Array.from({ length: 720 }, (_, i) => ({ az: i / 2, el }))

const point = (t: string, over: Partial<TrackPoint> = {}): TrackPoint => ({
  t,
  sun_az: 311.37,
  sun_el: -1.16,
  sun_frac: 1,
  sun_up: true,
  earth_az: 132.51,
  earth_el: 5.9,
  earth_up: true,
  sun_vec_me: [0, 0, 1],
  ...over,
})

const about = {
  site: { name: 'Connecting Ridge', lat: -89.45267, lon: -137.14865 },
  landingIso: '2027-05-06T13:00:00Z',
  missionDays: 14,
  heights: { panelM: 2, antennaM: 2 },
  dataVersion: 'fec83d062f629714',
}

describe('hourlyRows', () => {
  it("keeps the pipeline's numbers and works out each body's height above the skyline in its own direction", () => {
    const [row] = hourlyRows([point('2027-05-06T13:00:00Z')], flat(-1.46))
    expect(row).toMatchObject({ t: '2027-05-06T13:00:00Z', sunAzDeg: 311.37, sunElDeg: -1.16, sunShare: 1, sunUp: true, earthAzDeg: 132.51, earthElDeg: 5.9, earthUp: true })
    expect(row.sunAboveDeg).toBeCloseTo(0.3, 10)
    expect(row.earthAboveDeg).toBeCloseTo(7.36, 10)
  })

  it('reads the skyline between two of its samples', () => {
    const skyline = flat(0)
    skyline[20] = { az: 10, el: 2 }
    skyline[21] = { az: 10.5, el: 4 }
    const [row] = hourlyRows([point('2027-05-06T13:00:00Z', { sun_az: 10.25, sun_el: 5 })], skyline)
    expect(row.sunAboveDeg).toBeCloseTo(2, 10)
  })

  it('measures Earth against its own skyline when it is seen from another height', () => {
    const [row] = hourlyRows([point('2027-05-06T13:00:00Z')], flat(-1.46), flat(-2))
    expect(row.sunAboveDeg).toBeCloseTo(0.3, 10)
    expect(row.earthAboveDeg).toBeCloseTo(7.9, 10)
  })
})

describe('hourlyCsv', () => {
  const rows = hourlyRows([point('2027-05-06T13:00:00Z'), point('2027-05-06T14:00:00Z', { sun_el: -1.5, sun_frac: 0.42, earth_up: false, earth_el: -3.2 })], flat(-1.46))
  const text = hourlyCsv(about, rows)
  const lines = text.trimEnd().split('\n')
  const notes = lines.filter((line) => line.startsWith('#'))
  const table = lines.filter((line) => !line.startsWith('#'))

  it('says in its first lines what the rows are about: site, coordinates, landing, mission, heights, data version', () => {
    expect(notes).toContain('# Site: Connecting Ridge')
    expect(notes).toContain('# Latitude (degrees, north positive): -89.45267')
    expect(notes).toContain('# Longitude (degrees, east positive): -137.14865')
    expect(notes).toContain('# Landing (UTC): 2027-05-06T13:00:00Z')
    expect(notes).toContain('# Mission: 14 days, 2 hours from the landing, one row for each hour')
    expect(notes).toContain('# Sun seen from: 2 m above the ground')
    expect(notes).toContain('# Earth seen from: 2 m above the ground')
    expect(notes).toContain('# Data version: fec83d062f629714')
    // Every note comes before the table.
    expect(lines.slice(0, notes.length)).toEqual(notes)
  })

  it('names every column with its unit, and has one row for each hour', () => {
    expect(table[0]).toBe(HOURLY_COLUMNS.join(','))
    for (const name of HOURLY_COLUMNS) expect(name).toMatch(/\(.+\)/)
    expect(table).toHaveLength(1 + rows.length)
    for (const line of table) expect(line.split(',')).toHaveLength(HOURLY_COLUMNS.length)
  })

  it("writes each hour's numbers as the data has them, with the heights above the skyline to two decimals", () => {
    expect(table[1]).toBe('2027-05-06T13:00:00Z,0,311.37,-1.16,0.30,1,yes,132.51,5.9,7.36,yes')
    expect(table[2]).toBe('2027-05-06T14:00:00Z,1,311.37,-1.5,-0.04,0.42,yes,132.51,-3.2,-1.74,no')
  })

  it('never writes a minus before zero', () => {
    expect(hourlyCsv(about, hourlyRows([point('2027-05-06T13:00:00Z', { sun_el: -1.462 })], flat(-1.46)))).toContain(',-1.462,0.00,')
  })

  it('says so when the data version could not be read, and gives the plan its link when there is one', () => {
    expect(hourlyCsv({ ...about, dataVersion: null }, rows)).toContain('# Data version: not known')
    expect(hourlyCsv({ ...about, link: 'https://example.org/#a=connecting-ridge@2027-05' }, rows)).toContain('# This plan: https://example.org/#a=connecting-ridge@2027-05')
  })

  it('ends with a line break, and one day is "day"', () => {
    expect(text.endsWith('\n')).toBe(true)
    expect(hourlyCsv({ ...about, missionDays: 1 }, rows)).toContain('# Mission: 1 day, ')
  })
})

describe('hourlyFileName', () => {
  it('names the site, the landing hour and the length of the mission', () => {
    expect(hourlyFileName('connecting-ridge', '2027-05-06T13:00:00Z', 14)).toBe('sightline-hourly_connecting-ridge_2027-05-06T13Z_14d.csv')
  })

  it('is safe for a custom point, whose id holds its coordinates', () => {
    expect(hourlyFileName('custom:-89.5,12.25', '2027-05-06T13:00:00Z', 3)).toBe('sightline-hourly_custom_-89.5_12.25_2027-05-06T13Z_3d.csv')
  })
})
