import { describe, expect, it } from 'vitest'
import type { SiteInfo } from '../data/contract'
import { decodeRuns, type SiteFlags } from '../lib/flags'
import { monthSpans } from '../lib/grid'
import { DEFAULT_MISSION, fitProblems, PRESETS, type SightlineMission } from '../lib/sightlineMission'
import { checkOverview, dataFile } from '../lib/testData'
import { cellDetail, cellWords, findRow, fitHours, plannerTabIn, runningTotals, withPlannerTab } from './plannerFit'

const overview = checkOverview()
const sites = dataFile<SiteInfo[]>('sites.json')
const flagsOf = (id: string): SiteFlags => {
  const runs = overview.sites[id]
  return {
    start: overview.start,
    sun: decodeRuns(runs.sun, overview.hours),
    earth: decodeRuns(runs.earth, overview.hours),
    earthAbove: Object.fromEntries(Object.entries(runs.earth_above).map(([degrees, above]) => [degrees, decodeRuns(above, overview.hours)])),
  }
}
const spans = monthSpans(overview.start, overview.hours)
const LONG = PRESETS.find((preset) => preset.id === 'long')!.mission
const CLEARANCE: SightlineMission = { ...DEFAULT_MISSION, requirements: { ...DEFAULT_MISSION.requirements, missionDays: 9, maxSunGapH: 60, maxEarthGapH: 48, minEarthClearanceDeg: 2 } }

describe('which landings fit, for the grid', () => {
  // The grid's numbers are counted from fitHours; the verdict is fitProblems, one landing at a time.
  // Every hour of every month of a year, at sites of each kind and three missions: the same answer.
  it.each([
    ['connecting-ridge', DEFAULT_MISSION],
    ['shackleton-rim', LONG],
    ['im-2-athena', CLEARANCE],
    ['apollo-11', DEFAULT_MISSION],
    ['change-4', LONG],
  ] as const)('says at %s what the verdict says, hour by hour', (id, mission) => {
    const flags = flagsOf(id)
    const slope = sites.find((site) => site.id === id)?.slope?.deg ?? null
    const fit = fitHours(flags, mission, slope)
    const year = spans.filter((span) => span.month.startsWith('2028-'))
    let checked = 0
    for (const span of year) {
      for (let hour = span.from; hour < span.to; hour += 1) {
        if ((fit[hour] === 1) !== (fitProblems(flags, hour, mission, slope).length === 0)) throw new Error(`${id} ${span.month} hour ${hour - span.from}: the grid and the verdict differ`)
        checked += 1
      }
    }
    expect(checked).toBe(366 * 24)
  })

  it('agrees with the verdict in the data\'s last days, where a mission runs past its end', () => {
    const flags = flagsOf('connecting-ridge')
    const fit = fitHours(flags, DEFAULT_MISSION, null)
    for (let hour = overview.hours - 20 * 24; hour < overview.hours; hour += 1) expect(fit[hour] === 1).toBe(fitProblems(flags, hour, DEFAULT_MISSION, null).length === 0)
    expect(fit[overview.hours - 1]).toBe(0)
  })

  it('finds no landing at a site steeper than the mission allows, as the verdict does', () => {
    const flags = flagsOf('connecting-ridge')
    const steep = { ...DEFAULT_MISSION, maxSlopeDeg: 5 }
    expect(fitHours(flags, steep, 12).some((hour) => hour === 1)).toBe(false)
    expect(fitProblems(flags, spans[5].from, steep, 12).join(' ')).toMatch(/slopes/)
  })

  it('counts a cell as the days of the month with a landing that fits, and says "none" for none', () => {
    const flags = flagsOf('connecting-ridge')
    const fit = fitHours(flags, DEFAULT_MISSION, null)
    const year = spans.filter((span) => span.month.startsWith('2027-'))
    const row = findRow('fit', flags, fit, year)
    row.forEach((cell, m) => {
      const days = new Set<number>()
      for (let hour = year[m].from; hour < year[m].to; hour += 1) if (fitProblems(flags, hour, DEFAULT_MISSION, null).length === 0) days.add(Math.floor((hour - year[m].from) / 24))
      expect(cell.days).toBe(days.size)
      expect(cellWords('fit', cell)).toBe(days.size === 0 ? 'none' : String(days.size))
    })
    expect(row.some((cell) => cell.days > 0)).toBe(true)
  })

  it('opens a cell on the first landing that fits and the one with the most Sun over its mission', () => {
    const flags = flagsOf('shackleton-rim')
    const fit = fitHours(flags, DEFAULT_MISSION, null)
    const totals = runningTotals(flags.sun)
    const missionH = DEFAULT_MISSION.requirements.missionDays * 24
    const span = spans.find((one) => fit.slice(one.from, one.to).some((hour) => hour === 1))!
    const detail = cellDetail(fit, totals, span, DEFAULT_MISSION.requirements.missionDays)
    const fitting = Array.from({ length: span.to - span.from }, (_, i) => span.from + i).filter((hour) => fit[hour])
    const sunOf = (landing: number) => flags.sun.slice(landing, landing + missionH).filter(Boolean).length
    expect(detail.first).toBe(fitting[0])
    expect(detail.fitHours).toBe(fitting.length)
    expect(detail.runs.reduce((sum, run) => sum + run.to - run.from, 0)).toBe(fitting.length)
    const most = Math.max(...fitting.map(sunOf))
    expect(detail.sunniest).toEqual({ landing: fitting.find((hour) => sunOf(hour) === most), sunPct: (100 * most) / missionH })
  })

  it('names nothing in a month where no landing fits', () => {
    const flags = flagsOf('change-4')
    const fit = fitHours(flags, DEFAULT_MISSION, null)
    const detail = cellDetail(fit, runningTotals(flags.sun), spans[0], DEFAULT_MISSION.requirements.missionDays)
    expect(detail).toEqual({ fitHours: 0, fitDays: 0, runs: [], first: null, sunniest: null })
  })

  it('works out every site, four years of hours, in a few milliseconds', () => {
    const all = sites.map((site) => ({ flags: flagsOf(site.id), slope: site.slope?.deg ?? null }))
    const began = performance.now()
    for (const { flags, slope } of all) fitHours(flags, LONG, slope)
    const took = performance.now() - began
    console.info(`fitHours: ${sites.length} sites x ${overview.hours} hours in ${took.toFixed(1)} ms`)
    expect(took).toBeLessThan(250)
  })
})

describe('the Planner\'s tab in the link', () => {
  it('is read from the link and written back to it', () => {
    expect(plannerTabIn('#a=connecting-ridge@2027-05&t=133&mode=plan')).toBeNull()
    expect(plannerTabIn(withPlannerTab('#a=connecting-ridge@2027-05&t=133&mode=plan', 'compare'))).toBe('compare')
    expect(plannerTabIn('#a=x@2027-05&planner=find&t=1')).toBe('find')
    expect(plannerTabIn('#a=x@2027-05&planner=other')).toBeNull()
  })
})
