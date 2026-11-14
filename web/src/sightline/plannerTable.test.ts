import { describe, expect, it } from 'vitest'
import type { SiteFlags } from '../lib/flags'
import { DEFAULT_MISSION, type ScenarioMeasure } from '../lib/sightlineMission'
import { bothPct, plannerCsv, plannerRows } from './plannerTable'

const START = '2027-01-01T00:00:00Z'
/** Two years of hours. The Sun is up on even days, Earth in the first half of each day. */
const HOURS = 2 * 365 * 24
const flags: SiteFlags = {
  start: START,
  sun: Array.from({ length: HOURS }, (_, hour) => Math.floor(hour / 24) % 2 === 0),
  earth: Array.from({ length: HOURS }, (_, hour) => hour % 24 < 12),
  earthAbove: {},
} as unknown as SiteFlags
const mission = { ...DEFAULT_MISSION, requirements: { ...DEFAULT_MISSION.requirements, missionDays: 4 } }
const measure = (over: Partial<ScenarioMeasure>): ScenarioMeasure => ({ sunPct: 50, earthPct: 50, sunGapH: 24, earthGapH: 12, slopeDeg: 2, problems: [], ...over })

describe('bothPct', () => {
  it('counts the hours of the mission with the Sun and Earth up together', () => {
    // Four days from a landing at hour 0: days 0 and 2 are sunlit, and Earth is up for half of each.
    expect(bothPct(flags, 0, mission)).toBe(25)
  })

  it('is unknown when the mission runs past the data', () => {
    expect(bothPct(flags, HOURS - 24, mission)).toBeNull()
  })
})

describe('plannerRows', () => {
  const scenarios = [
    { site: 'a', landing: 0 },
    { site: 'b', landing: 24 },
  ]
  const measures = [measure({ sunPct: 61, sunGapH: 95 }), measure({ sunPct: 79, sunGapH: 56 })]

  it("has Compare's rows and the share with both, each cell written as the page shows it", () => {
    const rows = plannerRows(scenarios, measures, [flags, flags], mission)
    expect(rows.map((row) => row.key)).toEqual(['sunPct', 'sunGapH', 'earthPct', 'earthGapH', 'bothPct', 'slopeDeg'])
    expect(rows[0].cells).toEqual(['61', '79'])
    expect(rows[0].best).toEqual([false, true])
    expect(rows[1].best).toEqual([false, true])
    expect(rows[4].cells).toEqual(['25', '25'])
  })

  it('leaves a cell empty while its site is being worked out', () => {
    const rows = plannerRows(scenarios, [measures[0], null], [flags, null], mission)
    expect(rows[0].cells).toEqual(['61', null])
    expect(rows[4].cells).toEqual(['25', null])
  })
})

describe('plannerCsv', () => {
  it('writes a column per scenario, the rows, the verdict with its reasons, and the mission', () => {
    const scenarios = [
      { site: 'a', landing: 0 },
      { site: 'b', landing: 25 },
    ]
    const measures = [measure({}), measure({ problems: ['The Sun is gone for 95 h during the mission; your limit is 24 h.'] })]
    const rows = plannerRows(scenarios, measures, [flags, flags], mission)
    const csv = plannerCsv(START, scenarios, ['Ridge, east', 'Rim'], rows, measures, 'a 4-day mission')
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe(',"A · Ridge, east · 2027-01-01T00:00:00Z",B · Rim · 2027-01-02T01:00:00Z')
    expect(lines[1]).toBe('"Sunlit, %",50,50')
    expect(lines.at(-2)).toBe('Fits the mission,yes,no: The Sun is gone for 95 h during the mission; your limit is 24 h.')
    expect(lines.at(-1)).toBe('Mission,a 4-day mission')
  })
})
