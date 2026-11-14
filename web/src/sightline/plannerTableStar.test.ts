import { describe, expect, it } from 'vitest'
import type { Validation } from '../data/contract'
import type { ScenarioMeasure, SightlineMission, SightlineScenario } from '../lib/sightlineMission'
import { shareTies, type TieSide } from '../lib/starTie'
import { plannerRows } from './plannerTable'

/** A validation file whose error is 4 points for the Sun and 3 for Earth, the model agreeing with the maps. */
const validation = {
  pgda: {
    map: { sun_pct: 60, earth_pct: 50 },
    ours: [{ obs_height_m: 2, sun_any_pct: 60, earth_any_pct: 50 }],
    grid: { stats: [{ quantity: 'sun_any_pct', obs_height_m: 2, sample: 'all', rmse: 4 }, { quantity: 'earth_any_pct', obs_height_m: 2, sample: 'all', rmse: 3 }] },
  },
} as unknown as Validation
const side = (site: string): TieSide => ({ site, siteId: site, validation })
const measure = (sunPct: number, earthPct: number, sunGapH: number): ScenarioMeasure => ({ sunPct, sunGapH, earthPct, earthGapH: 10, slopeDeg: 2, problems: [] }) as unknown as ScenarioMeasure
const mission = { requirements: { missionDays: 14 } } as unknown as SightlineMission
const scenarios = [{ site: 'ridge', landing: 0 }, { site: 'rim', landing: 0 }] as unknown as SightlineScenario[]
const row = (rows: ReturnType<typeof plannerRows>, key: string) => rows.find((one) => one.key === key)

describe('plannerRows with the measured-error tie', () => {
  const measures = [measure(80, 60, 30), measure(78, 52, 40)]
  const flags = [null, null]

  it('withholds the star between two sites inside the tolerance, in the rows that are a share of the mission only', () => {
    const rows = plannerRows(scenarios, measures, flags, mission, undefined, shareTies([side('ridge'), side('rim')]))
    // Sunlit: 2 points apart, inside the Sun's 4.
    expect(row(rows, 'sunPct')).toMatchObject({ best: [false, false], tooClose: true })
    // Earth in view: 8 apart, beyond Earth's 3.
    expect(row(rows, 'earthPct')).toMatchObject({ best: [true, false], tooClose: false })
    // The longest dark spell is not a share: its own tie, as before.
    expect(row(rows, 'sunGapH')).toMatchObject({ best: [true, false], tooClose: false })
    expect(row(rows, 'slopeDeg')?.tooClose).toBe(false)
  })

  it('keeps the star for one site on two dates', () => {
    const rows = plannerRows([scenarios[0], { ...scenarios[0], landing: 240 }], measures, flags, mission, undefined, shareTies([side('ridge'), side('ridge')]))
    expect(row(rows, 'sunPct')).toMatchObject({ best: [true, false], tooClose: false })
  })

  it('is as before when no ties are given', () => {
    const rows = plannerRows(scenarios, measures, flags, mission)
    expect(row(rows, 'sunPct')).toMatchObject({ best: [true, false], tooClose: false })
  })
})
