import { describe, expect, it } from 'vitest'
import type { Summary, Validation } from '../data/contract'
import { customNotes, validationNotes, verdict } from './verdict'

const summary: Summary = {
  range: { start: '2027-05-01T00:00:00Z', end: '2027-06-01T00:00:00Z', step_h: 1 },
  obs_height_m: 2,
  pct_sun: 59.5,
  pct_earth: 61.3,
  pct_both: 39,
  max_sun_gap_h: 118,
  max_earth_gap_h: 288,
  sun_windows: [],
  earth_windows: [],
}

const validation: Validation = {
  terrain_resolution_m: 20,
  horizons: { checks: [], max_sep_deg: 0 },
  pgda: {
    span: { start: '2020-01-01T00:00:00Z', end: '2038-08-01T00:00:00Z', step_h: 2 },
    map: {
      resolution_m: 60,
      sun_pct: 68.48,
      earth_pct: 57.5,
      sun_nearby_pct: [45.36, 86.42],
      earth_nearby_pct: [51.12, 58.17],
    },
    ours: [{ obs_height_m: 2, sun_mean_disk_pct: 85.86, sun_any_pct: 90.28, earth_any_pct: 58.08 }],
    grid: {
      step_h: 6,
      high_sun_pct: 50,
      stats: [
        {
          quantity: 'sun_mean_disk_pct',
          obs_height_m: 2,
          sample: 'all',
          n: 80,
          bias: 0.36,
          median: -0.42,
          mae: 2.51,
          rmse: 4.15,
          r: 0.985,
        },
        {
          quantity: 'earth_any_pct',
          obs_height_m: 2,
          sample: 'all',
          n: 80,
          bias: 1.15,
          median: 0.03,
          mae: 1.21,
          rmse: 2.69,
          r: 0.995,
        },
      ],
    },
  },
  horizon_range: [],
}

describe('verdict', () => {
  it('states the headline numbers', () => {
    expect(verdict(summary)).toBe('Sun 59.5% · Earth 61.3% · longest Sun gap 118 h')
  })
})

describe('validationNotes', () => {
  it('states a disagreement beyond the measured error instead of claiming validation', () => {
    const { sun } = validationNotes(validation, 2)
    expect(sun.warning).toBe(true)
    expect(sun.text).toContain('not confirmed')
    expect(sun.text).toContain('85.9%')
    expect(sun.text).toContain('68.5%')
    expect(sun.text).toContain('45–86%')
    expect(sun.text).toContain('17.4 points')
    expect(sun.text).toContain('typical difference is 2.5')
  })

  it('says a site agrees when it is within the measured error', () => {
    const { earth } = validationNotes(validation, 2)
    expect(earth.warning).toBe(false)
    expect(earth.text).toContain('agrees')
  })

  it('applies the threshold to each site, not just one', () => {
    const close: Validation = {
      ...validation,
      pgda: {
        ...validation.pgda,
        map: { ...(validation.pgda.map as NonNullable<Validation['pgda']['map']>), sun_pct: 84 },
      },
    }
    expect(validationNotes(close, 2).sun.warning).toBe(false)
  })

  it('says plainly when no NASA map covers a site', () => {
    const noMap: Validation = { ...validation, pgda: { ...validation.pgda, map: null } }
    const notes = validationNotes(noMap, 2)
    expect(notes.sun.text).toContain('no independent check')
    expect(notes.sun.warning).toBe(false)
    expect(notes.earth.text).toContain('no independent check')
  })

  it('states the terrain resolution', () => {
    expect(validationNotes(validation, 2).terrain).toContain('20 m per pixel')
  })

  it('reports Horizons agreement', () => {
    expect(validationNotes(validation, 2).horizons).toContain('under 0.001°')
  })

  it('refuses to report an observer height it has no results for', () => {
    expect(() => validationNotes(validation, 10)).toThrow('10 m')
  })
})

describe('customNotes', () => {
  const band = (low: number, high: number) => ({
    min_abs_lat: low,
    max_abs_lat: high,
    n: 30,
    sun_median_error: 0.08,
    sun_p90_error: 0.36,
    earth_median_error: 0,
    earth_p90_error: 0.12,
    hours_agree_median_pct: 99.9,
    hours_agree_p10_pct: 99.3,
  })
  const modelError = { sun_rmse: 4, sun_any_rmse: 4, earth_rmse: 3 }

  it('warns about ridges only near the poles', () => {
    const polar = customNotes({ accuracy: band(85, 90), ridges: null, resolutionM: 237, modelError })
    const mid = customNotes({ accuracy: band(30, 60), ridges: null, resolutionM: 237, modelError })
    expect(polar.join(' ')).toContain('ridge tops')
    expect(mid.join(' ')).not.toContain('ridge tops')
    expect(mid.join(' ')).toContain('no independent check')
  })

  it('reports the ridge test near the south pole', () => {
    const notes = customNotes({
      accuracy: band(85, 90),
      ridges: { ...band(85, 90), sun_p90_error: 0.16 },
      resolutionM: 20,
      modelError,
    })
    expect(notes[0]).toContain('20 m per pixel')
    expect(notes[1]).toContain('well-lit points')
    expect(notes[1]).toContain('0.16')
  })
})
