import { describe, expect, it } from 'vitest'
import type { Summary, Validation } from '../data/contract'
import { customNotes, validationNotes, verdict, wholePct } from './verdict'

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
    ours: [
      { obs_height_m: 0, sun_mean_disk_pct: 57.59, sun_any_pct: 64.79, earth_any_pct: 56.96 },
      { obs_height_m: 2, sun_mean_disk_pct: 85.86, sun_any_pct: 90.28, earth_any_pct: 58.08 },
    ],
    grid: {
      step_h: 6,
      high_sun_pct: 50,
      stats: [
        { quantity: 'sun_any_pct', obs_height_m: 0, sample: 'all', n: 80, bias: -2.84, median: -0.01, mae: 4.24, rmse: 8.66, r: 0.939 },
        { quantity: 'earth_any_pct', obs_height_m: 0, sample: 'all', n: 80, bias: -1.84, median: -0.09, mae: 2.15, rmse: 5.08, r: 0.98 },
        { quantity: 'sun_any_pct', obs_height_m: 2, sample: 'all', n: 80, bias: 2.73, median: 0.8, mae: 2.86, rmse: 5.29, r: 0.985 },
        { quantity: 'earth_any_pct', obs_height_m: 2, sample: 'all', n: 80, bias: 1.15, median: 0.03, mae: 1.21, rmse: 2.69, r: 0.995 },
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

describe('a share as a whole percent', () => {
  it('rounds, and never reads as none or all when it is not', () => {
    expect(wholePct(44.8)).toBe('45%')
    expect(wholePct(0)).toBe('0%')
    expect(wholePct(100)).toBe('100%')
    expect(wholePct(0.2)).toBe('under 1%')
    expect(wholePct(99.96)).toBe('over 99%')
  })
})

describe('validationNotes', () => {
  // Connecting Ridge's own figures (public/data/connecting-ridge/validation.json).
  it('compares the ground with NASA\'s map, and gives the figure 2 m up beside it, not against the map', () => {
    const { sun } = validationNotes(validation, 2)
    expect(sun.warning).toBe(false)
    expect(sun.text).toBe(
      'Sun at the ground agrees with NASA\'s map: 65% in our model, 68% on NASA\'s PGDA map (neighboring pixels 45–86%), ' +
        'inside the 8.7-point error measured across 80 other pixels. ' +
        'At 2 m up, where this app reads it, our model gives 90%: a panel on a mast sees over the near ground.',
    )
    // The figure 2 m up is never the one set against the map: 90% and 68% are 22 points apart.
    expect(sun.text).not.toMatch(/not confirmed|90% here/)
  })

  it('says the same of Earth, with an antenna on the mast', () => {
    const { earth } = validationNotes(validation, 2)
    expect(earth.warning).toBe(false)
    expect(earth.text).toBe(
      'Earth visibility at the ground agrees with NASA\'s map: 57% in our model, 58% on NASA\'s PGDA map (neighboring pixels 51–58%), ' +
        'inside the 5.1-point error measured across 80 other pixels. ' +
        'At 2 m up, where this app reads it, our model gives 58%: an antenna on a mast sees over the near ground.',
    )
  })

  it('states a disagreement at the ground beyond the measured error instead of claiming validation', () => {
    const far: Validation = {
      ...validation,
      pgda: { ...validation.pgda, map: { ...(validation.pgda.map as NonNullable<Validation['pgda']['map']>), sun_pct: 80 } },
    }
    const { sun } = validationNotes(far, 2)
    expect(sun.warning).toBe(true)
    expect(sun.text).toBe(
      'Sun at this site is not confirmed, even at the ground: 65% in our model, 80% on NASA\'s PGDA map (neighboring pixels 45–86%). ' +
        'That\'s about 15 points apart; across 80 other pixels the typical difference is 4.2. ' +
        'At 2 m up, where this app reads it, our model gives 90%: a panel on a mast sees over the near ground.',
    )
  })

  it('applies the threshold to each site, by the error measured at the ground', () => {
    const at = (sunPct: number) =>
      validationNotes({ ...validation, pgda: { ...validation.pgda, map: { ...(validation.pgda.map as NonNullable<Validation['pgda']['map']>), sun_pct: sunPct } } }, 2).sun.warning
    // 64.79 at the ground, error 8.66: the map agrees up to 73.45.
    expect(at(73.4)).toBe(false)
    expect(at(73.5)).toBe(true)
  })

  it('gives no reason for a figure that is not higher 2 m up, and no second figure at the ground itself', () => {
    const level: Validation = { ...validation, pgda: { ...validation.pgda, ours: validation.pgda.ours.map((row) => ({ ...row, earth_any_pct: 56.96 })) } }
    expect(validationNotes(level, 2).earth.text).toMatch(/other pixels\. At 2 m up, where this app reads it, our model gives 57%\.$/)
    expect(validationNotes(validation, 0).sun.text).toMatch(/other pixels\.$/)
  })

  it('refuses a map with no figures at the ground to set against it', () => {
    const noGround: Validation = { ...validation, pgda: { ...validation.pgda, ours: validation.pgda.ours.filter((row) => row.obs_height_m !== 0) } }
    expect(() => validationNotes(noGround, 2)).toThrow('at the ground')
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
