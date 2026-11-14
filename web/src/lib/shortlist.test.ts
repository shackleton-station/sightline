import { describe, expect, it } from 'vitest'
import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from './flags'
import type { Requirements } from './mission'
import { addEntries, entryAt, MAX_SHORTLIST, measureEntry, rankOptions, toIso } from './shortlist'

const START = '2027-01-01T00:00:00Z'
const site = (id: string) => ({ id, name: id, lat: 0, lon: 0, source_url: '', group: 'x' }) as SiteInfo
const pattern = (text: string) => [...text].map((c) => c === '#')
const flagsOf = (sun: string, earth: string, above = earth): SiteFlags => ({
  start: START,
  sun: pattern(sun),
  earth: pattern(earth),
  earthAbove: { '2': pattern(above) },
})
const limits: Requirements = {
  missionDays: 1,
  maxSunGapH: 5,
  maxEarthGapH: 5,
  sunAtLanding: true,
  earthAtLanding: true,
  minEarthClearanceDeg: 0,
}
const DAY = '#'.repeat(24)
const atHour = (hour: number) => entryAt(new Date(Date.parse(START) + hour * 3_600_000).toISOString())
const option = (id: string, flags: SiteFlags, requirements = limits, hour = 0) =>
  measureEntry({ site: id, at: atHour(hour) }, site(id), flags, requirements)

describe('entry times', () => {
  it('stores the hour and reads it back', () => {
    expect(entryAt('2027-05-14T12:00:00Z')).toBe('2027-05-14T12')
    expect(toIso('2027-05-14T12')).toBe('2027-05-14T12:00:00Z')
  })
})

describe('addEntries', () => {
  const entry = { site: 'a', at: '2027-01-01T00' }

  it('skips what is already on the list', () => {
    expect(addEntries([entry], [entry, { ...entry, site: 'b' }])).toHaveLength(2)
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: MAX_SHORTLIST + 5 }, (_, i) => ({ site: `s${i}`, at: entry.at }))
    expect(addEntries([], many)).toHaveLength(MAX_SHORTLIST)
  })
})

describe('measureEntry', () => {
  it('measures from landing to the end of the mission only', () => {
    const measured = option('a', flagsOf(`${'#'.repeat(20)}....${'.'.repeat(30)}`, DAY.repeat(3)))
    expect(measured.sunPct).toBeCloseTo((100 * 20) / 24)
    expect(measured.sunGapH).toBe(4)
    expect(measured.earthGapH).toBe(0)
    expect(measured.problems).toEqual([])
  })

  it('uses the Earth clearance when one is set', () => {
    const flags = flagsOf(DAY, DAY, `#${'.'.repeat(23)}`)
    const measured = option('a', flags, { ...limits, minEarthClearanceDeg: 2 })
    expect(measured.earthGapH).toBe(23)
    expect(measured.problems[0]).toContain('less than 2°')
  })

  it('says when a date is outside the data', () => {
    const measured = measureEntry({ site: 'a', at: '2031-01-01T00' }, site('a'), flagsOf(DAY, DAY), limits)
    expect(measured.problems).toEqual(['This date is outside our data.'])
    expect(measured.sunGapH).toBeNull()
  })

  it('reports a mission past the end of the data, with no made-up numbers', () => {
    const measured = option('a', flagsOf('###', '###'))
    expect(measured.problems).toEqual(['The mission runs past the end of the data.'])
    expect(measured.sunPct).toBeNull()
  })
})

describe('rankOptions', () => {
  const gapFlags = (gap: number) => flagsOf(`#${'.'.repeat(gap)}${'#'.repeat(23 - gap)}`, DAY)

  it('puts options that meet the limits first, whatever their gaps', () => {
    const meets = option('meets', gapFlags(4))
    const misses = option('misses', flagsOf(`.${'#'.repeat(23)}`, DAY))
    const rows = rankOptions([misses, meets])
    expect(rows.map((row) => row.site.id)).toEqual(['meets', 'misses'])
    expect(rows[1].reasons).toContain('The Sun is down at landing.')
    expect(rows[0].reasons).toContain('Meets your limits')
  })

  it('orders by the longest time without Sun', () => {
    const rows = rankOptions([option('long', gapFlags(5)), option('short', gapFlags(1))])
    expect(rows.map((row) => [row.site.id, row.rank])).toEqual([
      ['short', 1],
      ['long', 2],
    ])
    expect(rows[0].reasons).toContain('Shortest time without Sun on this list')
  })

  it('shares a place when hourly data cannot separate two options', () => {
    const rows = rankOptions([option('a', gapFlags(3)), option('b', gapFlags(4)), option('c', gapFlags(5))])
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 1])
  })

  it('does not call anything the shortest on a list of one', () => {
    const [row] = rankOptions([option('a', gapFlags(1))])
    expect(row.reasons).toEqual(['Meets your limits'])
  })

  it('leaves out a "shortest" that most of the list shares', () => {
    const rows = rankOptions([option('a', gapFlags(1)), option('b', gapFlags(3)), option('c', gapFlags(3))])
    expect(rows.flatMap((row) => row.reasons)).not.toContain('Shortest time without Earth on this list')
  })

  it('does not let an option with no numbers outrank a measured near-miss', () => {
    const measuredMiss = option('measured', flagsOf(`.${'#'.repeat(23)}`, DAY))
    const noNumbers = option('short', flagsOf('###', '###'))
    expect(noNumbers.problems).toHaveLength(1)
    expect(rankOptions([noNumbers, measuredMiss]).map((row) => row.site.id)).toEqual(['measured', 'short'])
  })

  it('lets Earth decide when hourly data cannot separate the Sun', () => {
    const noEarth = flagsOf(`#.${'#'.repeat(22)}`, `#${'.'.repeat(4)}${'#'.repeat(19)}`)
    const allEarth = flagsOf(`#..${'#'.repeat(21)}`, DAY)
    const rows = rankOptions([option('a-little-less-sun-gap', noEarth), option('z-earth-all-day', allEarth)])
    expect(rows.map((row) => row.site.id)).toEqual(['z-earth-all-day', 'a-little-less-sun-gap'])
    expect(rows.map((row) => row.rank)).toEqual([1, 2])
  })

  it('counts places by position after a tie', () => {
    const rows = rankOptions([option('a', gapFlags(1)), option('b', gapFlags(2)), option('c', gapFlags(5))])
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 3])
  })

  it('puts unknown numbers last', () => {
    const outside = measureEntry({ site: 'x', at: '2031-01-01T00' }, site('x'), flagsOf(DAY, DAY), limits)
    const rows = rankOptions([outside, option('a', gapFlags(1))])
    expect(rows.map((row) => row.site.id)).toEqual(['a', 'x'])
    expect(rows[1].rank).toBe(2)
  })
})
