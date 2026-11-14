import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DataRange, OverviewYear, YearSummary } from '../data/contract'
import { decodeRuns } from './flags'
import { hoursByMonth, joinOverviews, joinYears, monthHours, spanFor, spanHours, spanOfHours, spanToReach, yearsInHash, yearsOf } from './span'

const dataFile = <T,>(name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), 'utf8')) as T

const range: DataRange = { start: '2026-01-01T00:00:00Z', end: '2050-01-01T00:00:00Z', hours: 210384, first_year: 2026, last_year: 2049, default_month: '2027-05' }

describe('which years a page loads', () => {
  it('is the year before a date and the two after, four in all', () => {
    expect(spanFor([2040], range)).toEqual({ from: 2039, to: 2042 })
    expect(spanFor([2027], range)).toEqual({ from: 2026, to: 2029 })
  })

  it('stays inside the data and keeps its four years at either end', () => {
    expect(spanFor([2026], range)).toEqual({ from: 2026, to: 2029 })
    expect(spanFor([2049], range)).toEqual({ from: 2046, to: 2049 })
  })

  it('holds every date a link names, with a year after the latest', () => {
    expect(spanFor([2027, 2033], range)).toEqual({ from: 2026, to: 2034 })
  })

  it('falls back to the default month when a link names no year in the data', () => {
    expect(spanFor([], range)).toEqual({ from: 2026, to: 2029 })
    expect(spanFor([1999, 2060], range)).toEqual({ from: 2026, to: 2029 })
  })

  it('reads the years out of a link', () => {
    expect(yearsInHash('#a=connecting-ridge@2027-05&t=133&list=shackleton-rim@2031-05-06T13~slim@2044-06-01T00')).toEqual([2027, 2031, 2044])
    expect(yearsInHash('#a=-88.5,40@2027-05&t=200')).toEqual([2027])
    expect(yearsInHash('')).toEqual([])
  })

  it('counts a span in years and in hours', () => {
    expect(yearsOf({ from: 2027, to: 2030 })).toEqual([2027, 2028, 2029, 2030])
    expect(spanHours({ from: 2027, to: 2030 })).toEqual({ start: '2027-01-01T00:00:00Z', hours: (365 * 3 + 366) * 24 })
    expect(spanOfHours('2027-01-01T00:00:00Z', (365 * 3 + 366) * 24)).toEqual({ from: 2027, to: 2030 })
  })
})

describe('reaching a date outside the loaded years', () => {
  const held = { from: 2026, to: 2029 }

  it('changes nothing when the years are held with a year to spare', () => {
    expect(spanToReach(held, [2027], range)).toEqual({ span: held, grown: true })
    expect(spanToReach({ from: 2046, to: 2049 }, [2049], range)).toEqual({ span: { from: 2046, to: 2049 }, grown: true })
  })

  it('grows forward for a date in its last year or just past it, so nothing held moves', () => {
    expect(spanToReach(held, [2029], range)).toEqual({ span: { from: 2026, to: 2030 }, grown: true })
    expect(spanToReach(held, [2031], range)).toEqual({ span: { from: 2026, to: 2032 }, grown: true })
  })

  it('starts a new span for an earlier date or one far ahead', () => {
    expect(spanToReach({ from: 2039, to: 2042 }, [2027], range)).toEqual({ span: { from: 2026, to: 2029 }, grown: false })
    expect(spanToReach(held, [2049], range)).toEqual({ span: { from: 2046, to: 2049 }, grown: false })
  })

  it('has no answer for a year outside the data', () => {
    expect(spanToReach(held, [2050], range)).toBeNull()
    expect(spanToReach(held, [], range)).toBeNull()
  })
})

describe('months by the calendar', () => {
  it('counts the hours of a month, leap years included', () => {
    expect(monthHours('2027-02')).toBe(672)
    expect(monthHours('2028-02')).toBe(696)
    expect(monthHours('2027-12')).toBe(744)
  })

  it('lists every month between two', () => {
    const hours = hoursByMonth('2027-11', '2028-02')
    expect(Object.keys(hours)).toEqual(['2027-11', '2027-12', '2028-01', '2028-02'])
    expect(hours['2028-02']).toBe(696)
  })
})

describe('joining the pipeline\'s yearly files', () => {
  // Steps: the hours before the first run, then each run's and each gap's length in turn.
  const year = (start: string, hours: number, sun: number[]): OverviewYear => ({ start, hours, obs_height_m: 2, sites: { a: { sun, earth: [], earth_above: { '2': sun } } } })

  it('makes one run of a run cut at New Year', () => {
    const joined = joinOverviews([year('2027-01-01T00:00:00Z', 8760, [10, 10, 7980, 760]), year('2028-01-01T00:00:00Z', 8784, [0, 5, 95, 100])])
    expect(joined.start).toBe('2027-01-01T00:00:00Z')
    expect(joined.hours).toBe(8760 + 8784)
    expect(joined.sites.a.sun).toEqual([10, 20, 8000, 8765, 8860, 8960])
    expect(joined.sites.a.earth_above['2']).toEqual(joined.sites.a.sun)
  })

  it('refuses years that are not consecutive', () => {
    expect(() => joinOverviews([year('2027-01-01T00:00:00Z', 8760, []), year('2029-01-01T00:00:00Z', 8760, [])])).toThrow(/consecutive/)
  })

  it('lists months and years in order', () => {
    const one = (y: number): YearSummary => ({ default_month: '2027-05', months: [{ month: `${y}-01` } as YearSummary['months'][number]], years: [{ year: y } as YearSummary['years'][number]] })
    const joined = joinYears([one(2027), one(2028)])
    expect(joined.months.map((row) => row.month)).toEqual(['2027-01', '2028-01'])
    expect(joined.years.map((row) => row.year)).toEqual([2027, 2028])
  })
})

describe('the pipeline\'s yearly files', () => {
  const described = dataFile<DataRange>('range.json')
  const years = yearsOf({ from: described.first_year, to: described.last_year })

  it('cover the range the data describes, hour for hour', () => {
    const whole = joinOverviews(years.map((y) => dataFile<OverviewYear>(`overview/${y}.json`)))
    expect(whole.start).toBe(described.start)
    expect(whole.hours).toBe(described.hours)
    expect(Date.parse(described.end) - Date.parse(described.start)).toBe(described.hours * 3_600_000)
    expect(described.start).toBe(`${described.first_year}-01-01T00:00:00Z`)
    expect(described.end).toBe(`${described.last_year + 1}-01-01T00:00:00Z`)
  })

  it('hold the same flags joined as each year holds alone', () => {
    const parts = [2027, 2028].map((y) => dataFile<OverviewYear>(`overview/${y}.json`))
    const joined = joinOverviews(parts)
    const alone = parts.flatMap((part) => decodeRuns(joinOverviews([part]).sites['shackleton-rim'].sun, part.hours))
    expect(decodeRuns(joined.sites['shackleton-rim'].sun, joined.hours)).toEqual(alone)
  })

  it('have a year of months and one year of numbers for every site and year', () => {
    for (const y of [described.first_year, described.last_year]) {
      const summary = dataFile<YearSummary>(`apollo-11/year-${y}.json`)
      expect(summary.years.map((row) => row.year)).toEqual([y])
      expect(summary.months.map((row) => row.month)).toEqual(Object.keys(hoursByMonth(`${y}-01`, `${y}-12`)))
    }
  })
})
