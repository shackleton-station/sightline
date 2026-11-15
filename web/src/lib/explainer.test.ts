import { describe, expect, it } from 'vitest'
import type { ScenarioData } from '../data/loadSite'
import { explainerFacts, explainerTitle, whyHard } from './explainer'

function month(month: string, pct_sun: number) {
  return { month, pct_sun, pct_earth: 50, pct_both: 40, max_sun_gap_h: 1, max_earth_gap_h: 1 }
}

const data = {
  site: { id: 'x', name: 'Test Ridge', lat: -89 },
  month: '2027-05',
  horizon: [{ az: 0, el: -2 }, { az: 180, el: 1 }],
  track: [
    { sun_el: -1, earth_el: -7, sun_frac: 1 },
    { sun_el: 0.5, earth_el: 6, sun_frac: 1 },
  ],
  summary: { obs_height_m: 2 },
  year: {
    months: [month('2027-01', 100), month('2027-05', 52), month('2027-09', 90)],
    years: [{ year: 2027, max_earth_gap_h: 341, pct_sun: 80, max_sun_gap_h: 100, pct_earth: 50 }],
  },
  validation: {
    pgda: {
      map: { sun_nearby_pct: [45.36, 86.42] },
      ours: [
        { obs_height_m: 0, sun_any_pct: 64.79 },
        { obs_height_m: 2, sun_any_pct: 90.28 },
      ],
    },
  },
} as unknown as ScenarioData

const text = explainerFacts(data)
  .map((fact) => fact.text)
  .join(' ')

describe('explainerFacts', () => {
  it('computes the Sun, terrain and Earth swings from the data', () => {
    expect(text).toContain('changes by only 1.5°')
    expect(text).toContain('rises and falls by 3.0°')
    expect(text).toContain('through 13.0° of elevation')
  })

  it('reports the height comparison and neighbouring pixels', () => {
    expect(text).toContain('64.8% of the time from ground level')
    expect(text).toContain('90.3% from 2 m up')
    expect(text).toContain('from 45% to 86%')
  })

  it('compares flat and vertical panels', () => {
    expect(text).toContain('a flat panel gets almost nothing: 6 W/m²')
    expect(text).toContain('1361 W/m² for a vertical one')
  })

  it('finds the months with the least and most Sun', () => {
    expect(text).toContain('52.0% of May')
    expect(text).toContain('100.0% of Jan')
  })

  it('states the longest Earth gap', () => {
    expect(text).toContain('14 d 5 h')
  })

  it('gives no height numbers for a point without them', () => {
    const custom = { ...data, validation: null } as unknown as ScenarioData
    const facts = explainerFacts(custom)
      .map((fact) => fact.text)
      .join(' ')
    expect(facts).toContain('raising a panel a few meters')
    expect(facts).not.toContain('64.8%')
  })
})

describe('explainerTitle', () => {
  it('names the right pole', () => {
    const south = { ...data, site: { ...data.site, lat: -89 } } as unknown as ScenarioData
    const north = { ...data, site: { ...data.site, lat: 89 } } as unknown as ScenarioData
    expect(explainerTitle(south)).toContain('south pole')
    expect(explainerTitle(north)).toContain('north pole')
  })
})

describe('sites away from the pole', () => {
  function site(pctEarth: number): ScenarioData {
    return {
      ...data,
      site: { id: 'y', name: 'Apollo Test' },
      track: [
        { sun_el: -70, earth_el: 60 },
        { sun_el: 68, earth_el: 62 },
      ],
      year: { months: [], years: [{ year: 2027, pct_sun: 48.4, max_sun_gap_h: 357, pct_earth: pctEarth, max_earth_gap_h: 76 }] },
    } as unknown as ScenarioData
  }
  const textOf = (d: ScenarioData) =>
    explainerFacts(d)
      .map((fact) => `${fact.title} ${fact.text}`)
      .join(' ')

  it('titles polar and regular sites differently', () => {
    expect(explainerTitle(data)).toContain('south pole')
    expect(explainerTitle(site(100))).toContain('Apollo Test')
  })

  it('describes long nights and high Sun', () => {
    const text = textOf(site(100))
    expect(text).toContain('14 d 21 h')
    expect(text).toContain('reaches 68°')
  })

  it('only calls the Sun high where it is', () => {
    expect(textOf(site(100))).toContain('The Sun climbs high')
    const low = {
      ...site(100),
      track: [
        { sun_el: -11, earth_el: 5 },
        { sun_el: 11, earth_el: 6 },
      ],
    } as unknown as ScenarioData
    expect(textOf(low)).toContain('The Sun stays low')
    expect(textOf(low)).not.toContain('The Sun climbs high')
  })

  it('says Earth never sets on the near side', () => {
    expect(textOf(site(100))).toContain('Earth never sets')
  })

  it('says Earth never rises on the far side', () => {
    expect(textOf(site(0))).toContain('Earth never rises')
  })

  it('handles a site where Earth comes and goes', () => {
    const text = textOf(site(92.1))
    expect(text).toContain('Earth comes and goes')
    expect(text).toContain('3 d 4 h')
  })
})

describe('terrain at a site away from the poles', () => {
  const regular = (peakDeg: number, horizonDeg: number) =>
    explainerFacts({
      ...data,
      site: { id: 'r', name: 'Regular', lat: -30 },
      horizon: [{ az: 0, el: 0 }, { az: 180, el: horizonDeg }],
      track: [
        { sun_el: -60, earth_el: 50, sun_frac: 0 },
        { sun_el: peakDeg, earth_el: 50, sun_frac: 1 },
      ],
      validation: null,
    } as unknown as ScenarioData).find((fact) => fact.title.startsWith('Terrain'))

  it('says terrain matters less only when it tops out well under the Sun', () => {
    expect(regular(60, 2)?.title).toBe('Terrain matters less')
    expect(regular(60, 2)?.text).toContain('far below')
  })

  it('never claims "far below" when the horizon is as high as the Sun', () => {
    const fact = regular(3.7, 4.06)
    expect(fact?.title).toBe('Terrain matters here too')
    expect(fact?.text).not.toContain('far below')
    expect(fact?.text).toContain('4.1°')
  })
})

describe('whyHard, the Guide\'s "Why this site is hard"', () => {
  it('says, for a polar site, how low the Sun stays, how long it is gone, how often Earth is hidden and how much the month matters', () => {
    expect(whyHard(data, { days: 14, sunGapH: 95 })).toEqual([
      'At Test Ridge the Sun never climbs: in May its elevation stays between −1.0° and 0.5° from level, so the skyline decides when there is sunlight.',
      'The longest stretch without the Sun here in 2027 is 4 d 4 h; during your 14-day mission from this landing the Sun is down for 95 h.',
      'Earth is hidden 50.0% of 2027 here, for up to 14 d 5 h at a stretch.',
      'The month matters too: the Sun is up 52.0% of May and 100.0% of January.',
    ])
  })

  it('leaves the mission out when there is none to speak of', () => {
    expect(whyHard(data)[1]).toBe('The longest stretch without the Sun here in 2027 is 4 d 4 h.')
    expect(whyHard(data, { days: 14, sunGapH: null })[1]).toBe('The longest stretch without the Sun here in 2027 is 4 d 4 h.')
  })

  it('stays true far from the pole: a Sun that climbs, the long dark, and Earth as it is there', () => {
    const far = {
      ...data,
      site: { id: 'a', name: 'Test Plain', lat: 1 },
      track: [
        { sun_el: -60, earth_el: 60, sun_frac: 0 },
        { sun_el: 62, earth_el: 61, sun_frac: 1 },
      ],
      year: { months: [month('2027-05', 50)], years: [{ year: 2027, max_earth_gap_h: 0, pct_sun: 50, max_sun_gap_h: 354, pct_earth: 100 }] },
    } as unknown as ScenarioData
    expect(whyHard(far, { days: 14, sunGapH: 300 })).toEqual([
      'At Test Plain the Sun climbs to 62° in May, so the trouble here is not a low Sun but how long it is gone.',
      'The longest stretch without the Sun here in 2027 is 14 d 18 h; during your 14-day mission from this landing the Sun is down for 300 h.',
      'Earth is in view all of 2027 here, so the terrain never blocks the radio.',
    ])
    expect(whyHard({ ...far, month: '2031-05' } as ScenarioData, { days: 14, sunGapH: 300 })).toEqual([
      'At Test Plain the Sun climbs to 62° in May, so the trouble here is not a low Sun but how long it is gone.',
      'During your 14-day mission from this landing the Sun is down for 300 h.',
    ])
    const farSide = { ...far, year: { months: far.year.months, years: [{ year: 2027, max_earth_gap_h: 8760, pct_sun: 50, max_sun_gap_h: 354, pct_earth: 0 }] } } as unknown as ScenarioData
    expect(whyHard(farSide)[2]).toBe('Earth never rises here in 2027, so every message needs a relay.')
  })
})

