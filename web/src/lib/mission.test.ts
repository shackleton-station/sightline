import { describe, expect, it } from 'vitest'
import type { SiteFlags } from './flags'
import {
  hourOf,
  landingProblems,
  landingWindows,
  locateHour,
  longestDown,
  missionEarth,
  type Requirements,
  viableHours,
} from './mission'

const START = '2027-01-01T00:00:00Z'
const iso = (hour: number) => new Date(Date.parse(START) + hour * 3_600_000).toISOString()

const req: Requirements = {
  missionDays: 1,
  maxSunGapH: 2,
  maxEarthGapH: 100,
  sunAtLanding: true,
  earthAtLanding: false,
  minEarthClearanceDeg: 0,
}

function pattern(text: string): boolean[] {
  return [...text].map((c) => c === '#')
}

describe('longestDown', () => {
  it('finds the longest gap within the range', () => {
    const flags = pattern('#..#...#')
    expect(longestDown(flags, 0, 8)).toBe(3)
    expect(longestDown(flags, 0, 3)).toBe(2)
    expect(longestDown(pattern('###'), 0, 3)).toBe(0)
  })
})

describe('landingProblems', () => {
  const up = new Array<boolean>(48).fill(true)

  it('accepts a landing that meets everything', () => {
    expect(landingProblems(up, up, 0, req)).toEqual([])
  })

  it('reports the Sun down at landing, only if required', () => {
    const sun = [false, ...up.slice(1)]
    expect(landingProblems(sun, up, 0, req)).toContain('The Sun is down at landing.')
    expect(landingProblems(sun, up, 0, { ...req, sunAtLanding: false })).toEqual([])
  })

  it('reports a gap over the limit', () => {
    const sun = [...up]
    sun.fill(false, 5, 9)
    expect(landingProblems(sun, up, 0, req)).toEqual([
      'The Sun is gone for 4 h during the mission; your limit is 2 h.',
    ])
  })

  it('reports Earth gaps and landing separately', () => {
    const earth = new Array<boolean>(48).fill(false)
    const strict = { ...req, earthAtLanding: true, maxEarthGapH: 3 }
    expect(landingProblems(up, earth, 0, strict)).toEqual([
      'Earth is out of view at landing.',
      'Earth is gone for 24 h during the mission; your limit is 3 h.',
    ])
  })

  it('reports a mission past the end of the data', () => {
    expect(landingProblems(up, up, 40, req)).toEqual(['The mission runs past the end of the data.'])
  })
})

describe('landingWindows', () => {
  it('merges consecutive acceptable hours', () => {
    const up = new Array<boolean>(72).fill(true)
    expect(landingWindows(up, up, req)).toEqual([{ from: 0, to: 49 }])
  })

  it('finds no window when requirements cannot be met', () => {
    const down = new Array<boolean>(72).fill(false)
    expect(landingWindows(down, down, req)).toEqual([])
  })

  it('splits around a gap the mission cannot span', () => {
    const sun = new Array<boolean>(96).fill(true)
    sun.fill(false, 40, 45)
    const windows = landingWindows(sun, sun, { ...req, maxEarthGapH: 100 })
    // A 24 h mission landing at hour 18 ends at hour 42, seeing just the 2 h the limit allows.
    expect(windows).toEqual([
      { from: 0, to: 19 },
      { from: 45, to: 73 },
    ])
  })
})

describe('viableHours', () => {
  /** A small repeatable generator, so a failure here can be replayed. */
  function random(seed: number) {
    let state = seed
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
      return state / 2_147_483_648
    }
  }

  function randomFlags(next: () => number, hours: number): boolean[] {
    const flags: boolean[] = []
    let up = next() < 0.5
    while (flags.length < hours) {
      const run = 1 + Math.floor(next() * 40)
      for (let i = 0; i < run && flags.length < hours; i += 1) flags.push(up)
      up = !up
    }
    return flags
  }

  it('matches checking every hour one at a time', () => {
    const next = random(20_261_103)
    for (let trial = 0; trial < 200; trial += 1) {
      const hours = 24 + Math.floor(next() * 300)
      const sun = randomFlags(next, hours)
      const earth = randomFlags(next, hours)
      const limits: Requirements = {
        missionDays: 1 + Math.floor(next() * 5),
        maxSunGapH: Math.floor(next() * 40),
        maxEarthGapH: Math.floor(next() * 40),
        sunAtLanding: next() < 0.5,
        earthAtLanding: next() < 0.5,
        minEarthClearanceDeg: 0,
      }
      const fast = viableHours(sun, earth, limits)
      for (let t = 0; t < hours; t += 1) {
        expect(fast[t] === 1).toBe(landingProblems(sun, earth, t, limits).length === 0)
      }
    }
  })

  it('handles a mission longer than the data', () => {
    const up = new Array<boolean>(10).fill(true)
    expect([...viableHours(up, up, { ...req, missionDays: 2 })]).toEqual(new Array(10).fill(0))
  })

  it('stays quick over all the data, for every site', () => {
    const next = random(7)
    const hours = 35_064
    const sun = randomFlags(next, hours)
    const earth = randomFlags(next, hours)
    const started = performance.now()
    for (let site = 0; site < 13; site += 1) {
      viableHours(sun, earth, { ...req, missionDays: 14, maxSunGapH: 20, maxEarthGapH: 20 })
    }
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe('hour helpers', () => {
  it('locates an hour in its month', () => {
    expect(locateHour(START, 0)).toEqual({ month: '2027-01', index: 0 })
    expect(locateHour(START, 31 * 24 + 5)).toEqual({ month: '2027-02', index: 5 })
    expect(locateHour(START, 8759)).toEqual({ month: '2027-12', index: 31 * 24 - 1 })
  })

  it('counts hours to a time', () => {
    expect(hourOf(START, iso(100))).toBe(100)
  })
})

describe('Earth clearance', () => {
  const flags: SiteFlags = {
    start: START,
    sun: pattern('####'),
    earth: pattern('####'),
    earthAbove: { '2': pattern('#..#') },
  }
  const limits = { ...req, earthAtLanding: true, maxEarthGapH: 1 }

  it('uses any part of the disk unless a clearance is set', () => {
    expect(missionEarth(flags, limits)).toBe(flags.earth)
    expect(missionEarth(flags, { ...limits, minEarthClearanceDeg: 2 })).toBe(flags.earthAbove['2'])
  })

  it('refuses a clearance the data has no flags for, rather than quietly using another', () => {
    expect(() => missionEarth(flags, { ...limits, minEarthClearanceDeg: 3 })).toThrow('3°')
  })

  it('says what fell short in terms of the clearance', () => {
    const strict = { ...limits, minEarthClearanceDeg: 2 }
    const above = missionEarth(flags, strict)
    expect(landingProblems(flags.sun, above, 1, { ...strict, missionDays: 0 })).toEqual([
      'Earth is less than 2° above the terrain at landing.',
    ])
    const longer = pattern('#' + '.'.repeat(30))
    expect(landingProblems(new Array<boolean>(31).fill(true), longer, 0, strict)).toEqual([
      'Earth is less than 2° above the terrain for 23 h during the mission; your limit is 1 h.',
    ])
  })
})
