import { describe, expect, it } from 'vitest'
import type { Summary, TrackPoint, Validation } from '../data/contract'
import type { ScenarioData } from '../data/loadSite'
import { compareRows, dayLabel, meanSunElevationUp, peakSunElevation, tolerance } from './compare'

function stats(quantity: string, rmse: number) {
  return { quantity, obs_height_m: 2, sample: 'all', n: 80, bias: 0, median: 0, mae: 0, rmse, r: 1 }
}

interface Options {
  siteId?: string
  oursSun?: number
  mapSun?: number
}

function scenario(
  overrides: Partial<Summary>,
  sunEls: number[],
  { siteId = 'same', oursSun = 80, mapSun = 80 }: Options = {},
): ScenarioData {
  const summary: Summary = {
    range: { start: '2027-05-01T00:00:00Z', end: '2027-06-01T00:00:00Z', step_h: 1 },
    obs_height_m: 2,
    pct_sun: 60,
    pct_earth: 60,
    pct_both: 40,
    max_sun_gap_h: 100,
    max_earth_gap_h: 200,
    sun_windows: [],
    earth_windows: [],
    ...overrides,
  }
  return {
    site: { id: siteId },
    summary,
    track: sunEls.map((sun_el) => ({ sun_el }) as TrackPoint),
    validation: {
      pgda: {
        map: { sun_pct: mapSun, earth_pct: 50 },
        ours: [{ obs_height_m: 2, sun_any_pct: oursSun, earth_any_pct: 50 }],
        grid: { stats: [stats('sun_any_pct', 4), stats('earth_any_pct', 3)] },
      },
    } as unknown as Validation,
  } as ScenarioData
}

const row = (rows: ReturnType<typeof compareRows>, label: string) =>
  rows.find((r) => r.label === label)

describe('compareRows', () => {
  it('calls a difference within measured error too close', () => {
    const rows = compareRows(scenario({ pct_sun: 60 }, [1]), scenario({ pct_sun: 63 }, [1]))
    expect(row(rows, 'Sun up')?.better).toBe('Too close')
  })

  it('names the better scenario beyond measured error', () => {
    const rows = compareRows(scenario({ pct_sun: 70 }, [1]), scenario({ pct_sun: 60 }, [1]))
    expect(row(rows, 'Sun up')).toEqual({ label: 'Sun up', a: '70.0%', b: '60.0%', better: 'A' })
  })

  it('treats a shorter gap as better', () => {
    const rows = compareRows(
      scenario({ max_sun_gap_h: 200 }, [1]),
      scenario({ max_sun_gap_h: 100 }, [1]),
    )
    expect(row(rows, 'Longest without Sun')?.better).toBe('B')
  })

  it('calls gaps within the data resolution too close', () => {
    const rows = compareRows(
      scenario({ max_earth_gap_h: 289 }, [1]),
      scenario({ max_earth_gap_h: 288 }, [1]),
    )
    expect(row(rows, 'Longest without Earth')?.better).toBe('Too close')
  })

  it('says when values are identical', () => {
    const rows = compareRows(scenario({}, [1]), scenario({}, [1]))
    expect(row(rows, 'Earth up')?.better).toBe('Same')
  })

  it('compares the highest Sun from the track', () => {
    const rows = compareRows(scenario({}, [0.5, 1.5]), scenario({}, [0.2, 1.0]))
    expect(row(rows, 'Highest Sun')).toEqual({
      label: 'Highest Sun',
      a: '1.5°',
      b: '1.0°',
      better: 'A',
    })
  })
})

describe('tolerance', () => {
  it('is the measured error within one site', () => {
    const a = scenario({}, [1], { oursSun: 90, mapSun: 60 })
    expect(tolerance(a, a, 'sun_any_pct')).toBe(4)
  })

  it('widens when the model reads differently at two sites', () => {
    const a = scenario({}, [1], { siteId: 'a', oursSun: 85, mapSun: 68 })
    const b = scenario({}, [1], { siteId: 'b', oursSun: 83, mapSun: 79 })
    expect(tolerance(a, b, 'sun_any_pct')).toBeCloseTo(13)
  })

  it('never drops below the measured error', () => {
    const a = scenario({}, [1], { siteId: 'a', oursSun: 85, mapSun: 80 })
    const b = scenario({}, [1], { siteId: 'b', oursSun: 85, mapSun: 81 })
    expect(tolerance(a, b, 'sun_any_pct')).toBe(4)
  })

  it('stops a difference between sites from naming a winner if the model could explain it', () => {
    const a = scenario({ pct_sun: 70 }, [1], { siteId: 'a', oursSun: 85, mapSun: 68 })
    const b = scenario({ pct_sun: 60 }, [1], { siteId: 'b', oursSun: 83, mapSun: 79 })
    expect(compareRows(a, b).find((r) => r.label === 'Sun up')?.better).toBe('Too close')
  })
})

describe('panel rows', () => {
  it('compare sunlight, and call small differences too close', () => {
    const lit = (fraction: number) => {
      const data = scenario({}, [0])
      return { ...data, track: [{ sun_el: 0, sun_frac: fraction }] } as unknown as ScenarioData
    }
    const far = compareRows(lit(1), lit(0.5)).find((r) => r.label === 'Sunlight on a vertical panel')
    expect(far?.better).toBe('A')
    expect(far?.a).toBe('1361 W/m²')
    const near = compareRows(lit(1), lit(0.99)).find((r) => r.label === 'Sunlight on a vertical panel')
    expect(near?.better).toBe('Too close')
  })

  it('scale the margin to the panel, so a low-Sun flat panel can still name a winner', () => {
    const flatLit = (elDeg: number) => {
      const data = scenario({ pct_sun: 90 }, [0])
      return { ...data, track: [{ sun_el: elDeg, sun_frac: 1 }] } as unknown as ScenarioData
    }
    const row = compareRows(flatLit(0), flatLit(1.5)).find((r) => r.label === 'Sunlight on a flat panel')
    expect(row?.a).toBe('0 W/m²')
    expect(row?.b).toBe('36 W/m²')
    expect(row?.better).toBe('B')
  })
})

describe('tolerance with custom points', () => {
  const custom = {
    ...scenario({}, [1], { siteId: 'custom:1,2' }),
    validation: null,
    custom: {
      accuracy: { sun_p90_error: 6.5, earth_p90_error: 2.1 },
      ridges: null,
      resolutionM: 237,
      modelError: { sun_rmse: 3, sun_any_rmse: 4, earth_rmse: 3 },
    },
  } as unknown as ScenarioData

  it('uses the larger measured error', () => {
    const curated = scenario({}, [1], { siteId: 'a' })
    expect(tolerance(custom, curated, 'sun_any_pct')).toBe(6.5)
    expect(tolerance(custom, curated, 'earth_any_pct')).toBe(3)
  })

  it('includes a curated site offset against the custom point', () => {
    const ridge = scenario({}, [1], { siteId: 'a', oursSun: 90, mapSun: 70 })
    expect(tolerance(custom, ridge, 'sun_any_pct')).toBe(20)
  })
})

describe('peakSunElevation', () => {
  it('finds the maximum', () => {
    expect(peakSunElevation(scenario({}, [-1, 2.5, 0]))).toBe(2.5)
  })
})

describe('meanSunElevationUp', () => {
  it('averages only the hours the Sun is up', () => {
    const data = {
      track: [
        { sun_el: 10, sun_up: true },
        { sun_el: 20, sun_up: true },
        { sun_el: -30, sun_up: false },
      ],
    } as unknown as ScenarioData
    expect(meanSunElevationUp(data)).toBe(15)
  })

  it('is null if the Sun is never up', () => {
    const data = { track: [{ sun_el: -1, sun_up: false }] } as unknown as ScenarioData
    expect(meanSunElevationUp(data)).toBeNull()
  })
})

describe('dayLabel', () => {
  it('describes a position in the month', () => {
    expect(dayLabel('2027-05-03T12:00:00Z')).toBe('Day 3, 12:00 UTC')
  })
})
