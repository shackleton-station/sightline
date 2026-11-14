import { describe, expect, it } from 'vitest'
import type { SiteFlags } from './flags'
import type { SiteInfo } from '../data/contract'
import { bestIn, betterDate, DEFAULT_MISSION, fitProblems, marginalWords, measureScenario, missionWords, steadierLanding, NO_LIMIT_H, PRESETS, presetOf, readScenarioLink, removeScenarioAt, restoreScenario, rowLabels, scenarioLink, type SightlineMission, surfaceLink, silenceHours, silenceStop } from './sightlineMission'

const START = '2027-01-01T00:00:00Z'

describe('a scenario in the address', () => {
  const hours = 35064
  it('is written in the app\'s own link format, which the other pages read', () => {
    const link = scenarioLink([{ site: 'connecting-ridge', landing: 2880 + 133 }], 0, START, DEFAULT_MISSION)
    expect(link).toBe('#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan')
  })
  it('gives the Surface view the scenario on show as its own site and hour, not scenario A', () => {
    const two = [{ site: 'connecting-ridge', landing: 2880 }, { site: 'shackleton-rim', landing: 3624 + 22 }]
    expect(surfaceLink(two, 0, START, DEFAULT_MISSION)).toBe(scenarioLink([two[0]], 0, START, DEFAULT_MISSION))
    expect(surfaceLink(two, 1, START, DEFAULT_MISSION)).toBe('#a=shackleton-rim@2027-06&t=22&limits=14_24_99999_1_1&mode=plan')
    expect(surfaceLink(two, 7, START, DEFAULT_MISSION)).toBe(surfaceLink(two, 0, START, DEFAULT_MISSION))
  })
  it('reads back what it wrote, custom points included', () => {
    for (const scenario of [{ site: 'shackleton-rim', landing: 9000 }, { site: '-89.5,12.25', landing: 0 }]) {
      const read = readScenarioLink(scenarioLink([scenario], 0, START, DEFAULT_MISSION), START, hours)
      expect(read).toEqual({ scenarios: [scenario], active: 0, mission: DEFAULT_MISSION })
    }
  })
it('carries the solar panel\'s and the antenna\'s heights, only when they are not the app\'s own 2 m', () => {
    const one = [{ site: 'connecting-ridge', landing: 2880 + 133 }]
    const plain = scenarioLink(one, 0, START, DEFAULT_MISSION)
    expect(plain).not.toMatch(/hp=|ha=/)
    expect(readScenarioLink(plain, START, hours)?.mission.heights).toEqual({ panelM: 2, antennaM: 2 })
    const high = scenarioLink(one, 0, START, { ...DEFAULT_MISSION, heights: { panelM: 10, antennaM: 4 } })
    expect(high).toBe(`${plain}&hp=10&ha=4`)
    expect(readScenarioLink(high, START, hours)?.mission.heights).toEqual({ panelM: 10, antennaM: 4 })
    // A height that is not offered for that part is read as 2 m: 4 m is the antenna's, 5 m the panel's.
    expect(readScenarioLink(`${plain}&hp=4&ha=5`, START, hours)?.mission.heights).toEqual({ panelM: 2, antennaM: 2 })
    // The heights are the hardware's, not a limit: a preset stays the preset, and the words say them.
    expect(presetOf({ ...DEFAULT_MISSION, heights: { panelM: 10, antennaM: 4 } })?.id).toBe('short')
    expect(missionWords({ ...DEFAULT_MISSION, heights: { panelM: 10, antennaM: 4 } })).toMatch(/, panel at 10 m, antenna at 4 m$/)
    expect(missionWords(DEFAULT_MISSION)).not.toMatch(/panel at/)
  })

    it('reads a link made on another page, with its limits', () => {
    const read = readScenarioLink('#a=apollo-11@2028-07&t=200&limits=14_72_72_1_1&view=3d&mode=learn', START, hours)
    expect(read?.scenarios).toEqual([{ site: 'apollo-11', landing: (365 + 31 + 29 + 31 + 30 + 31 + 30) * 24 + 200 }])
    expect(read?.mission.requirements.maxSunGapH).toBe(72)
    expect(read?.mission.maxSlopeDeg).toBe(10)
  })
  it('has nothing to say about no link, a bad one, or one outside the data', () => {
    expect(readScenarioLink('', START, hours)).toBeNull()
    expect(readScenarioLink('#plan', START, hours)).toBeNull()
    expect(readScenarioLink('#a=apollo-11@2031-01&t=0', START, hours)).toBeNull()
  })
})

describe('fitProblems', () => {
  // Two days of data: the Sun up throughout, Earth down for the second day.
  const day = (up: boolean) => new Array<boolean>(24).fill(up)
  const flags: SiteFlags = { start: START, sun: [...day(true), ...day(true)], earth: [...day(true), ...day(false)], earthAbove: {} }
  const mission: SightlineMission = { ...DEFAULT_MISSION, requirements: { ...DEFAULT_MISSION.requirements, missionDays: 2 } }
  it('fits when the Sun and Earth are up at landing and the ground is within the limit', () => {
    expect(fitProblems(flags, 0, mission, 4.2)).toEqual([])
    expect(fitProblems(flags, 0, mission, null)).toEqual([])
  })
  it('says why not: the app\'s own reasons, then the slope', () => {
    const problems = fitProblems(flags, 0, { ...mission, requirements: { ...mission.requirements, maxEarthGapH: 12 } }, 13.04)
    expect(problems).toEqual(['Earth is gone for 24 h during the mission; your limit is 12 h.', 'The ground slopes 13.0°; your limit is 10°.'])
  })
})

describe('the mission', () => {
  const rover = PRESETS[1].mission
  it('travels in the link: the app\'s limits, then the slope when it differs from the default', () => {
    const link = scenarioLink([{ site: 'connecting-ridge', landing: 0 }], 0, START, rover)
    expect(link).toBe('#a=connecting-ridge@2027-01&t=0&limits=60_336_99999_1_1&mode=plan&slope=15')
    expect(readScenarioLink(link, START, 35064)?.mission).toEqual(rover)
    // The panel choice was removed: an old link that still carries it is read, and the panel ignored.
    expect(readScenarioLink(`${link}&panel=flat`, START, 35064)?.mission).toEqual(rover)
  })
  it('keeps a slope from a link inside the drawer\'s range', () => {
    expect(readScenarioLink('#a=apollo-11@2027-01&t=0&slope=900', START, 35064)?.mission.maxSlopeDeg).toBe(20)
    expect(readScenarioLink('#a=apollo-11@2027-01&t=0&slope=abc', START, 35064)?.mission.maxSlopeDeg).toBe(10)
  })
  it('knows a preset from a custom mission', () => {
    expect(presetOf(DEFAULT_MISSION)?.id).toBe('short')
    expect(presetOf(rover)?.id).toBe('long')
    expect(presetOf({ ...rover, maxSlopeDeg: 14 })).toBeNull()
  })
  it('is said in a few words', () => {
    expect(missionWords(DEFAULT_MISSION)).toBe('14 days on the surface, survives 24 h of darkness, the Sun and Earth in view at landing, ground up to 10°')
    // The Long stay sets no limit on radio silence, so it has nothing to say about it.
    expect(missionWords(rover)).toBe('60 days on the surface, survives 336 h of darkness, the Sun and Earth in view at landing, ground up to 15°')
    expect(missionWords({ ...rover, requirements: { ...rover.requirements, maxEarthGapH: 48 } })).toContain('at most 48 h of radio silence')
    expect(PRESETS.find((preset) => preset.id === 'long')?.mission.requirements.maxEarthGapH).toBe(NO_LIMIT_H)
  })
})

describe('scenarios A to D', () => {
  const hours = 35064
  const four = [
    { site: 'connecting-ridge', landing: 2880 + 133 },
    { site: 'shackleton-rim', landing: 2880 + 133 },
    { site: '-88.5,40', landing: 9000 },
    { site: 'de-gerlache-rim', landing: 12 },
  ]
  it('travel in one link: A as the link\'s own site and hour, B to D in its shortlist', () => {
    const link = scenarioLink(four, 2, START, DEFAULT_MISSION)
    expect(link).toBe('#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~-88.5,40@2028-01-11T00~de-gerlache-rim@2027-01-01T12&sc=2')
    expect(readScenarioLink(link, START, hours)).toEqual({ scenarios: four, active: 2, mission: DEFAULT_MISSION })
  })
  it('are four at most, and an active one that isn\'t there falls back to A', () => {
    const link = `${scenarioLink(four, 0, START, DEFAULT_MISSION)}~apollo-11@2027-02-01T00&sc=7`
    const read = readScenarioLink(link, START, hours)
    expect(read?.scenarios).toHaveLength(4)
    expect(read?.active).toBe(0)
  })
})

describe('Compare', () => {
  const site = { id: 'x', name: 'X', lat: -89, lon: 0, source_url: '', group: 'Test' } satisfies SiteInfo
  const day = (up: boolean) => new Array<boolean>(24).fill(up)
  // Four days: the Sun up for the first three, Earth up for the first one.
  const flags: SiteFlags = { start: START, sun: [...day(true), ...day(true), ...day(true), ...day(false)], earth: [...day(true), ...day(false), ...day(false), ...day(false)], earthAbove: {} }
  const mission: SightlineMission = { ...DEFAULT_MISSION, requirements: { ...DEFAULT_MISSION.requirements, missionDays: 2 } }
  it('measures a scenario over its mission', () => {
    expect(measureScenario({ site: 'x', landing: 0 }, site, flags, mission, 4)).toEqual({ sunPct: 100, earthPct: 50, sunGapH: 0, earthGapH: 24, slopeDeg: 4, problems: [] })
  })
  it('gives the reasons a scenario doesn\'t fit, the slope last', () => {
    const measure = measureScenario({ site: 'x', landing: 48 }, site, flags, mission, 12)
    expect(measure.sunPct).toBe(50)
    expect(measure.problems).toEqual(['Earth is out of view at landing.', 'The ground slopes 12.0°; your limit is 10°.'])
  })
  it('has no numbers for a mission that runs past the data', () => {
    expect(measureScenario({ site: 'x', landing: 72 }, site, flags, mission, null).sunPct).toBeNull()
  })
  it('marks the best value in a row, ties included, and nothing when all are the same', () => {
    expect(bestIn([40, 62, 61.8], 'high', 0.5)).toEqual([false, true, true])
    expect(bestIn([30, 12, 13, null], 'low', 2)).toEqual([false, true, true, false])
    expect(bestIn([5, 5, 5], 'low', 0)).toEqual([false, false, false])
    expect(bestIn([5], 'low', 0)).toEqual([false])
  })
  it('finds a better date nearby: the next landing the Sun and Earth limits allow', () => {
    const late: SiteFlags = { start: START, sun: [...day(false), ...day(true), ...day(true), ...day(true)], earth: [...day(true), ...day(true), ...day(true), ...day(true)], earthAbove: {} }
    expect(betterDate(late, 0, mission)).toEqual({ landing: 24, waitH: 24 })
    // Already fine: nothing to suggest.
    expect(betterDate(late, 24, mission)).toBeNull()
    // Nothing later works: the mission would run past the data.
    expect(betterDate(late, 60, mission)).toBeNull()
  })
})

describe('the radio-silence slider', () => {
  it('has one stop after its last hour, for no limit, which a link carries as it always did', () => {
    expect(silenceStop(NO_LIMIT_H)).toBe(404)
    expect(silenceHours(404)).toBe(NO_LIMIT_H)
    expect(scenarioLink([{ site: 'connecting-ridge', landing: 0 }], 0, START, DEFAULT_MISSION)).toContain('limits=14_24_99999_1_1')
  })
  it('is hours everywhere else', () => {
    expect(silenceStop(48)).toBe(48)
    expect(silenceHours(48)).toBe(48)
    expect(silenceHours(400)).toBe(400)
    // A limit from a link that is longer than the slider sits at its last hour.
    expect(silenceStop(900)).toBe(400)
  })
})

describe('removing a scenario', () => {
  const [a, b, c] = [{ site: 'a', landing: 1 }, { site: 'b', landing: 2 }, { site: 'c', landing: 3 }]
  it('keeps the others in order, and the selection where it was', () => {
    // B removed while A is on show: A and the old C remain, A still on show.
    expect(removeScenarioAt([a, b, c], 0, 1)).toEqual({ scenarios: [a, c], active: 0, removed: { scenario: b, index: 1, active: 0 } })
    // A removed while C is on show: C is still the one on show, now second.
    expect(removeScenarioAt([a, b, c], 2, 0)?.active).toBe(1)
  })
  it('shows the one that takes its place when the one on show is removed', () => {
    expect(removeScenarioAt([a, b, c], 1, 1)).toMatchObject({ scenarios: [a, c], active: 1 })
    // The last one removed: the one before it is shown.
    expect(removeScenarioAt([a, b, c], 2, 2)).toMatchObject({ scenarios: [a, b], active: 1 })
  })
  it('never removes the only scenario', () => {
    expect(removeScenarioAt([a], 0, 0)).toBeNull()
  })
  it('can be undone: all of them back in order, with the same one on show', () => {
    const gone = removeScenarioAt([a, b, c], 0, 1)
    expect(gone && restoreScenario(gone.scenarios, gone.removed)).toEqual({ scenarios: [a, b, c], active: 0 })
    const shown = removeScenarioAt([a, b, c], 2, 2)
    expect(shown && restoreScenario(shown.scenarios, shown.removed)).toEqual({ scenarios: [a, b, c], active: 2 })
  })
  it('cannot be undone into a full list', () => {
    expect(restoreScenario([a, b, c, a], { scenario: b, index: 1, active: 0 })).toBeNull()
  })
})

describe('a marginal landing', () => {
  it('is one with less than half the Sun\'s disc in view', () => {
    expect(marginalWords(0.05)).toBe('5% of the Sun at landing')
    expect(marginalWords(0.004)).toBe('under 1% of the Sun at landing')
    expect(marginalWords(0.5)).toBeNull()
    expect(marginalWords(1)).toBeNull()
    // The Sun down at landing is not marginal, and neither is a share not yet known.
    expect(marginalWords(0)).toBeNull()
    expect(marginalWords(null)).toBeNull()
  })
})

describe('steadierLanding', () => {
  // Ten days of hours; the Sun rises at hour 10 and stays up, Earth is always in view.
  const flags = { start: START, sun: Array.from({ length: 240 }, (_, hour) => hour >= 10), earth: Array.from({ length: 240 }, () => true), earthAbove: {} }
  const mission = { ...DEFAULT_MISSION, requirements: { ...DEFAULT_MISSION.requirements, missionDays: 2 } }
  // The Sun's disc clears the skyline slowly: 5% at hour 10, half of it by hour 14.
  const shares = Array.from({ length: 240 }, (_, hour) => (hour < 10 ? 0 : Math.min(1, 0.05 + (hour - 10) * 0.12)))

  it('moves a landing on to the first hour of the same sunlit stretch with at least half the Sun in view', () => {
    expect(steadierLanding(flags, 10, mission, shares, 0)).toBe(14)
    // The shares may start at another clock hour: the month's first.
    expect(steadierLanding(flags, 10, mission, shares.slice(8), 8)).toBe(14)
  })

  it('leaves a landing that already has half the Sun where it is', () => {
    expect(steadierLanding(flags, 20, mission, shares, 0)).toBe(20)
  })

  it('keeps the landing when the stretch ends, or the month\'s shares run out, before the Sun is half up', () => {
    const brief = { ...flags, sun: flags.sun.map((up, hour) => up && hour < 13) }
    expect(steadierLanding(brief, 10, mission, shares, 0)).toBe(10)
    expect(steadierLanding(flags, 10, mission, shares.slice(0, 13), 0)).toBe(10)
  })

  it('does not move to an hour that no longer meets the limits', () => {
    // The mission would run past the data from hour 14 on, so nothing later is offered.
    const short = { ...flags, sun: flags.sun.slice(0, 60), earth: flags.earth.slice(0, 60) }
    expect(steadierLanding(short, 10, mission, shares, 0)).toBe(10)
  })
})

describe("the river's row labels", () => {
  const hourOf = (iso: string) => (Date.parse(iso) - Date.parse(START)) / 3_600_000
  it('at one site give each landing\'s full date and leave the site out', () => {
    const scenarios = ['2027-05-26T13:00:00Z', '2027-06-21T17:00:00Z', '2028-10-17T09:00:00Z'].map((iso) => ({ site: 'connecting-ridge', landing: hourOf(iso) }))
    expect(rowLabels(scenarios, ['Connecting Ridge', 'Connecting Ridge', 'Connecting Ridge'], START)).toEqual([
      { date: '26 May 2027', site: null },
      { date: '21 June 2027', site: null },
      { date: '17 October 2028', site: null },
    ])
  })

  it('on one day at different sites give the site and leave the date out', () => {
    const scenarios = [
      { site: 'connecting-ridge', landing: hourOf('2027-05-06T13:00:00Z') },
      { site: 'shackleton-rim', landing: hourOf('2027-05-06T13:00:00Z') },
    ]
    expect(rowLabels(scenarios, ['Connecting Ridge', 'Shackleton Rim'], START)).toEqual([
      { date: null, site: 'Connecting Ridge' },
      { date: null, site: 'Shackleton Rim' },
    ])
  })

  it('when both differ give a short date, with the year only across years, then the site', () => {
    const scenarios = [
      { site: 'connecting-ridge', landing: hourOf('2027-05-06T13:00:00Z') },
      { site: 'peak-near-shackleton', landing: hourOf('2027-09-17T12:00:00Z') },
    ]
    expect(rowLabels(scenarios, ['Connecting Ridge', 'Peak near Shackleton'], START)).toEqual([
      { date: '6 May', site: 'Connecting Ridge' },
      { date: '17 Sep', site: 'Peak near Shackleton' },
    ])
    const later = [...scenarios, { site: 'shackleton-rim', landing: hourOf('2028-01-03T00:00:00Z') }]
    expect(rowLabels(later, ['Connecting Ridge', 'Peak near Shackleton', 'Shackleton Rim'], START).map((label) => label.date)).toEqual(['6 May 2027', '17 Sep 2027', '3 Jan 2028'])
  })

  it('give the hour to two landings at one site on one day', () => {
    const same = [
      { site: 'shackleton-rim', landing: hourOf('2027-06-01T18:00:00Z') },
      { site: 'shackleton-rim', landing: hourOf('2027-06-01T22:00:00Z') },
    ]
    expect(rowLabels(same, ['Shackleton Rim', 'Shackleton Rim'], START).map((label) => label.date)).toEqual(['1 June 2027 18:00', '1 June 2027 22:00'])
    expect(rowLabels([same[0]], ['Shackleton Rim'], START)).toEqual([{ date: '1 June 2027', site: null }])
  })
})
