import { describe, expect, it } from 'vitest'
import type { SiteFlags } from '../lib/flags'
import { DEFAULT_MISSION, type ScenarioMeasure } from '../lib/sightlineMission'
import type { ShadowDistances } from '../data/contract'
import { bothPct, compareGroups, landingRows, plannerCsv, plannerRows, shadowWords } from './plannerTable'
import type { LandingShares } from './useScenarioFacts'

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
    const rows = plannerRows(scenarios, measures, [flags, flags], mission, [412.4, 530])
    expect(rows.map((row) => row.key)).toEqual(['sunPct', 'sunGapH', 'earthPct', 'earthGapH', 'bothPct', 'sunlightWm2', 'slopeDeg'])
    expect(rows[0].cells).toEqual(['61', '79'])
    expect(rows[0].best).toEqual([false, true])
    expect(rows[1].best).toEqual([false, true])
    expect(rows[4].cells).toEqual(['25', '25'])
    expect(rows[5].cells).toEqual(['412', '530'])
    expect(rows[5].best).toEqual([false, true])
  })

  it('leaves the sunlight empty while its months load, and says when it cannot be worked out', () => {
    const rows = plannerRows(scenarios, measures, [flags, flags], mission, [undefined, null])
    expect(rows[5].cells).toEqual([null, '?'])
    expect(rows[5].best).toEqual([false, false])
  })

  it('has no sunlight row for a caller that does not have the sunlight', () => {
    expect(plannerRows(scenarios, measures, [flags, flags], mission).map((row) => row.key)).toEqual(['sunPct', 'sunGapH', 'earthPct', 'earthGapH', 'bothPct', 'slopeDeg'])
  })

  it('says the hours behind each share of the mission, and nothing beside the other rows', () => {
    const rows = plannerRows(scenarios, [measure({}), null], [flags, null], mission, [300, undefined])
    // A four-day mission is 96 hours: half of it sunlit, half with Earth, a quarter with both.
    expect(rows[0].notes).toEqual(['48 of 96 h', null])
    expect(rows[2].notes).toEqual(['48 of 96 h', null])
    expect(rows[4].notes).toEqual(['24 of 96 h', null])
    expect(rows[1].notes).toEqual([null, null])
    expect(rows[5].notes).toEqual([null, null])
  })

  it('leaves a cell empty while its site is being worked out', () => {
    const rows = plannerRows(scenarios, [measures[0], null], [flags, null], mission, [300, undefined])
    expect(rows[0].cells).toEqual(['61', null])
    expect(rows[4].cells).toEqual(['25', null])
  })
})

describe('landingRows', () => {
  const landing: LandingShares = { sun: 1, earth: 1, earthUp: true, sunElDeg: 1.44, earthElDeg: -0.26, sunAboveDeg: 0.81, earthAboveDeg: -1.02 }

  it("gives each body's angle from level and above the skyline, to a tenth of a degree, with no best mark", () => {
    const rows = landingRows([landing, null])
    expect(rows.map((row) => row.label)).toEqual(["Sun's elevation, °", 'Sun above the skyline, °', "Earth's elevation, °", 'Earth above the skyline, °'])
    expect(rows.map((row) => row.cells)).toEqual([
      ['1.4', null],
      ['0.8', null],
      ['−0.3', null],
      ['−1.0', null],
    ])
    expect(rows.every((row) => row.best.every((mark) => !mark))).toBe(true)
  })
})

describe('plannerCsv', () => {
  it('writes a column per scenario, the rows, the verdict with its reasons, and the mission', () => {
    const scenarios = [
      { site: 'a', landing: 0 },
      { site: 'b', landing: 25 },
    ]
    const measures = [measure({}), measure({ problems: ['The Sun is gone for 95 h during the mission; your limit is 24 h.'] })]
    const rows = plannerRows(scenarios, measures, [flags, flags], mission, [300, 300])
    const csv = plannerCsv(START, scenarios, ['Ridge, east', 'Rim'], rows, measures, 'a 4-day mission')
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe(',"A · Ridge, east · 2027-01-01T00:00:00Z",B · Rim · 2027-01-02T01:00:00Z')
    expect(lines[1]).toBe('"Sunlit, %",50,50')
    expect(lines.at(-2)).toBe('Fits the mission,yes,no: The Sun is gone for 95 h during the mission; your limit is 24 h.')
    expect(lines.at(-1)).toBe('Mission,a 4-day mission')
  })
})

describe('compareGroups', () => {
  const scenarios = [
    { site: 'a', landing: 0 },
    { site: 'b', landing: 24 },
    { site: '-88.5,40', landing: 48 },
  ]
  const measures = [measure({ sunPct: 61, sunGapH: 95, problems: ['The Sun is gone for 95 h during the mission; your limit is 24 h.'] }), measure({ sunPct: 79, sunGapH: 20 }), null]
  const landings = [
    { sun: 1, earth: 1, earthUp: true, sunElDeg: 1.44, earthElDeg: -0.3, sunAboveDeg: 0.9, earthAboveDeg: -1.2 },
    { sun: 0.26, earth: null, earthUp: false, sunElDeg: 0.1, earthElDeg: 2, sunAboveDeg: -0.1, earthAboveDeg: 0.5 },
    null,
  ]
  const shadow = {
    what: 'Permanently shadowed ground is ground that direct sunlight never reaches.',
    unit: 'km',
    measure: 'Great-circle distance.',
    source: { name: 'NASA GSFC PGDA', url: 'https://pgda.gsfc.nasa.gov/products/69', cite: 'Mazarico et al. (2011)' },
    patch: 'The nearest shadowed pixel.',
    region: 'The nearest pixel of a region of at least 10 km².',
    region_min_km2: 10,
    maps: [],
    covered_from_lat: 65,
    sites: {
      a: { patch: { status: 'found', distance_km: 0.13, lat: -89.76, lon: -157.98, region_km2: 0.0072, map: 'm', pixel_m: 60 }, region: { status: 'found', distance_km: 2.6, lat: -89.78, lon: -178.19, region_km2: 233.5, map: 'm', pixel_m: 60 } },
      b: { patch: { status: 'outside_map', map_edge_km: 1951 }, region: { status: 'outside_map', map_edge_km: 1951 } },
    },
  } as ShadowDistances
  const input = { scenarios, siteIds: ['a', 'b', null], measures, flags: [flags, flags, null], mission, landings, sunlightWm2: [612, 840, undefined], shadow }
  const groups = compareGroups(input)
  const row = (key: string) => groups.flatMap((group) => group.rows).find((one) => one.key === key)!

  it('puts the verdict first, then at landing, power, radio, the ground and science', () => {
    expect(groups.map((group) => group.name)).toEqual(['Verdict', 'At landing', 'Power', 'Radio', 'Ground', 'Science'])
    expect(groups.map((group) => group.rows.map((one) => one.label))).toEqual([
      ['Fits the mission'],
      ['In view', "Sun's elevation, °", 'Sun above the skyline, °', "Earth's elevation, °", 'Earth above the skyline, °'],
      ['Sunlit, %', 'Longest dark spell, h', 'Sunlight on a panel, W/m²', 'Sun in view at landing, %'],
      ['Earth in view, %', 'Longest radio silence, h', 'Sun and Earth together, %'],
      ['Slope, °'],
      ['Permanent shadow, nearest', 'Shadow of 10 km² or more, nearest'],
    ])
  })

  it('has no sunlight row for a caller that does not have the sunlight', () => {
    const power = compareGroups({ ...input, sunlightWm2: undefined }).find((group) => group.key === 'power')!
    expect(power.rows.map((one) => one.key)).toEqual(['sunPct', 'sunGapH', 'sunAtLanding'])
  })

  it('says whether each scenario fits, with the reasons in the column\'s short words, and waits for one still being worked out', () => {
    expect(row('fits').cells).toEqual(['✗ No: Sun down for 95 h; your limit is 24 h', '✓ Yes', null])
    expect(row('fits').fits).toEqual([false, true, null])
    expect(row('fits').best).toEqual([false, false, false])
  })

  it('reads what is up at landing from the flags and the share of the Sun\'s disc from the track', () => {
    expect(row('state').cells).toEqual(['Sun and Earth', 'Earth only', null])
    expect(row('sunAtLanding').cells).toEqual(['100', '26', null])
    expect(row('sunAtLanding').best).toEqual([true, false, false])
    expect(row('sunElDeg').cells[0]).toBe('1.4')
    expect(row('earthAboveDeg').cells).toEqual(['−1.2', '0.5', null])
  })

  it('gives the distance to permanent shadow in km, and says when a site is outside NASA\'s maps', () => {
    expect(row('shadow-patch').cells).toEqual(['0.1 km', 'none mapped within 1,951 km', 'not worked out for a custom point'])
    expect(row('shadow-region').cells).toEqual(['2.6 km', 'none mapped within 1,951 km', 'not worked out for a custom point'])
    // One number in the row: nothing for it to be the best of.
    expect(row('shadow-patch').best).toEqual([false, false, false])
    expect(row('shadow-patch').title).toMatch(/never reaches.*From NASA’s map of permanent shadow \(LOLA; Mazarico et al\. 2011\)\.$/)
  })

  it('marks the nearest shadow as the best in its row when two scenarios have one', () => {
    const both = { ...shadow, sites: { ...shadow.sites, b: { ...shadow.sites.a, patch: { ...shadow.sites.a.patch, distance_km: 0.72 } } } } as ShadowDistances
    const patch = compareGroups({ ...input, shadow: both }).flatMap((group) => group.rows).find((one) => one.key === 'shadow-patch')!
    expect(patch.cells.slice(0, 2)).toEqual(['0.1 km', '0.7 km'])
    expect(patch.best).toEqual([true, false, false])
  })

  it('leaves the science cells waiting until the file has loaded', () => {
    const waiting = compareGroups({ ...input, shadow: null }).flatMap((group) => group.rows).find((one) => one.key === 'shadow-patch')!
    expect(waiting.cells).toEqual([null, null, null])
    expect(waiting.title).toBeUndefined()
  })

  it('writes each kind of answer in a few words', () => {
    expect(shadowWords({ status: 'found', distance_km: 39.36, lat: 0, lon: 0, region_km2: 1, map: 'm', pixel_m: 240 })).toBe('39 km')
    expect(shadowWords({ status: 'none_within', within_km: 132, map: 'm' })).toBe('none within 132 km')
    expect(shadowWords(null)).toBeNull()
  })

  it('exports the same rows, with the verdict in the app\'s full sentences', () => {
    const csv = plannerCsv(START, scenarios, ['A site', 'B site', 'Custom'], groups.flatMap((group) => group.rows), measures, 'the mission')
    expect(csv).toContain('"Permanent shadow, nearest",0.1 km,"none mapped within 1,951 km",not worked out for a custom point')
    expect(csv.match(/^Fits the mission/gm)).toHaveLength(1)
    expect(csv).toContain('Fits the mission,no: The Sun is gone for 95 h during the mission; your limit is 24 h.,yes,')
  })
})
