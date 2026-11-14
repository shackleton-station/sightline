import { describe, expect, it } from 'vitest'
import { buildGrid, longestMissionThatFits, nearestStop, otherSitesThatMonth, sliderStops, statusOf, whatEachLimitCosts } from './plannerModel'
import { A, B, C, MISSION } from './testSites'

describe('the planner grid', () => {
  it('calls a month tight at one or two landing days', () => {
    expect([0, 1, 2, 3, 20].map(statusOf)).toEqual(['none', 'tight', 'tight', 'works', 'works'])
  })

  it("counts landing days for every site and month, from the app's own landing hours", () => {
    const grid = buildGrid([A, B, C], MISSION)
    expect(grid.months).toEqual(['2027-01', '2027-02'])
    // a: hours [0, 205) are days 1 to 9 of January, and [480, 744) are days 21 to 31.
    expect(grid.rows[0].cells.map((cell) => [cell.days, cell.status])).toEqual([[20, 'works'], [27, 'works']])
    expect(grid.rows[1].cells.map((cell) => cell.status)).toEqual(['none', 'none'])
    // c: hours [0, 25) touch two days.
    expect(grid.rows[2].cells.map((cell) => [cell.days, cell.status])).toEqual([[2, 'tight'], [0, 'none']])
    expect(grid.rows.map((row) => row.monthsWithLanding)).toEqual([2, 0, 1])
    expect(grid.tally).toEqual({ withLanding: 3, tight: 1, total: 6 })
    expect(grid.mostDays).toBe(27)
    expect(grid.largestShare).toBeCloseTo(27 / 28)
  })

  it('redraws when the mission changes', () => {
    // A one-day mission landing at any hour: site a loses fewer hours to the night.
    const short = buildGrid([A], { ...MISSION, missionDays: 1, sunAtLanding: false })
    expect(short.rows[0].cells[0].days).toBeGreaterThan(buildGrid([A], MISSION).rows[0].cells[0].days)
    expect(buildGrid([A], { ...MISSION, missionDays: 30 }).tally.withLanding).toBe(1)
    expect(buildGrid([A], { ...MISSION, missionDays: 40 }).tally.withLanding).toBe(0)
  })

  it('handles no sites', () => {
    expect(buildGrid([], MISSION)).toMatchObject({ months: [], rows: [], mostDays: 0, largestShare: 0 })
  })

  it('lists the other sites with a landing that month, nearest first', () => {
    const grid = buildGrid([C, A, B], MISSION)
    const others = otherSitesThatMonth(grid, B.site, '2027-01', 3)
    expect(others.map((other) => [other.site.id, other.days])).toEqual([['a', 20], ['c', 2]])
    expect(others[0].distanceKm).toBeCloseTo(30.3, 0)
    expect(otherSitesThatMonth(grid, B.site, '2027-02', 3).map((other) => other.site.id)).toEqual(['a'])
    expect(otherSitesThatMonth(grid, B.site, '2031-01', 3)).toEqual([])
  })
})

describe('when nothing works', () => {
  it('says what each limit is costing', () => {
    const costs = whatEachLimitCosts([A, B, C], { ...MISSION, missionDays: 40 })
    // Without the Sun limit, only landing in sunlight and ending inside the data remain.
    expect(costs).toEqual([
      { what: 'sun', withLanding: 2 },
      { what: 'earth', withLanding: 0 },
      { what: 'landing', withLanding: 0 },
    ])
  })

  it('leaves out the landing conditions when there are none to drop', () => {
    const costs = whatEachLimitCosts([A], { ...MISSION, sunAtLanding: false })
    expect(costs.map((cost) => cost.what)).toEqual(['sun', 'earth'])
  })

  it('finds the longest mission that still has a landing somewhere', () => {
    // Site c's 60 hours of Sun plus 12 h of allowed night fit a three-day mission and no longer one.
    expect(longestMissionThatFits([C], { ...MISSION, missionDays: 30 })).toBe(3)
    expect(longestMissionThatFits([B, C], { ...MISSION, missionDays: 4 })).toBe(3)
    expect(longestMissionThatFits([C], MISSION)).toBe(2)
    expect(longestMissionThatFits([B], MISSION)).toBeNull()
  })
})

describe('slider stops', () => {
  it('keep the bounds and drop anything outside them', () => {
    expect(sliderStops([0, 2, 7, 180, 400], [1, 180])).toEqual([1, 2, 7, 180])
  })

  it('put a typed value at the nearest stop', () => {
    const stops = [0, 24, 48, 72, 96]
    expect(nearestStop(72, stops)).toBe(3)
    expect(nearestStop(80, stops)).toBe(3)
    expect(nearestStop(90, stops)).toBe(4)
    expect(nearestStop(5000, stops)).toBe(4)
  })
})
