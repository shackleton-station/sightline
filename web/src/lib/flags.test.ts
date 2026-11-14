/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import type { Summary } from '../data/contract'
import { decodeRuns } from './flags'
import { checkOverview, checkYears, dataFile } from './testData'

describe('decodeRuns', () => {
  it('marks hours inside runs, end exclusive', () => {
    expect(decodeRuns([1, 3], 5)).toEqual([false, true, true, false, false])
  })

  it('handles runs at both ends and no runs at all', () => {
    expect(decodeRuns([0, 1, 4, 5], 5)).toEqual([true, false, false, false, true])
    expect(decodeRuns([], 2)).toEqual([false, false])
  })
})

describe('the yearly overview files, 2027 to 2030 joined', () => {
  const overview = checkOverview()
  const hourOf = (iso: string) => (Date.parse(iso) - Date.parse(overview.start)) / 3_600_000

  it('runs through 2030, hour by hour, including the leap year', () => {
    expect(overview.start).toBe('2027-01-01T00:00:00Z')
    expect(overview.hours).toBe((365 * 3 + 366) * 24)
  })

  // The grid and the slip check read this file; the rest of the app reads the monthly ones.
  it.each(['connecting-ridge', 'apollo-11', 'change-4'])('agrees with the monthly files at %s', (id) => {
    const flags = decodeRuns(overview.sites[id].sun, overview.hours)
    const earth = decodeRuns(overview.sites[id].earth, overview.hours)
    for (const month of ['2027-05', '2028-02', '2030-12']) {
      const summary = dataFile<Summary>(`${id}/${month}/summary.json`)
      const from = hourOf(summary.range.start)
      const to = hourOf(summary.range.end)
      const share = (values: boolean[]) =>
        Number(((100 * values.slice(from, to).filter(Boolean).length) / (to - from)).toFixed(1))
      expect(share(flags)).toBeCloseTo(summary.pct_sun, 1)
      expect(share(earth)).toBeCloseTo(summary.pct_earth, 1)
    }
  })

  it('has yearly numbers that cover each year in the data', () => {
    const year = checkYears('apollo-11')
    expect(year.years.map((row) => row.year)).toEqual([2027, 2028, 2029, 2030])
    expect(year.months).toHaveLength(48)
  })
})
