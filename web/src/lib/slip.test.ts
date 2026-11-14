import { describe, expect, it } from 'vitest'
import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from './flags'
import type { Requirements } from './mission'
import {
  alternativesAt,
  BOTH_UP,
  conditionsAt,
  distanceKm,
  nextViable,
  SLIPS,
  slipTime,
  slipVerdict,
} from './slip'

const START = '2027-01-01T00:00:00Z'
const hour = (h: number) => new Date(Date.parse(START) + h * 3_600_000).toISOString().replace('.000Z', 'Z')
const pattern = (text: string) => [...text].map((c) => c === '#')
const flagsOf = (sun: string, earth = sun): SiteFlags => ({
  start: START,
  sun: pattern(sun),
  earth: pattern(earth),
  earthAbove: {},
})
const site = (id: string, lat: number, lon: number) => ({ id, name: id, lat, lon, source_url: '', group: 'x' }) as SiteInfo

const shortMission: Requirements = { ...BOTH_UP, missionDays: 1 }

describe('slipTime', () => {
  const by = (label: string) => SLIPS.find((slip) => slip.label === label) ?? SLIPS[0]

  it('adds a week across a month end', () => {
    expect(slipTime('2027-01-28T05:00:00Z', by('+1 week'))).toBe('2027-02-04T05:00:00Z')
  })

  it('keeps the day and hour when adding months', () => {
    expect(slipTime('2027-03-15T05:00:00Z', by('+1 month'))).toBe('2027-04-15T05:00:00Z')
    expect(slipTime('2027-03-15T05:00:00Z', by('+3 months'))).toBe('2027-06-15T05:00:00Z')
    expect(slipTime('2027-03-15T05:00:00Z', by('+1 year'))).toBe('2028-03-15T05:00:00Z')
  })

  it('moves the 31st to the last day of a shorter month', () => {
    expect(slipTime('2027-01-31T05:00:00Z', by('+1 month'))).toBe('2027-02-28T05:00:00Z')
    expect(slipTime('2028-01-31T05:00:00Z', by('+1 month'))).toBe('2028-02-29T05:00:00Z')
  })

  it('crosses a year end', () => {
    expect(slipTime('2027-11-30T05:00:00Z', by('+3 months'))).toBe('2028-02-29T05:00:00Z')
  })
})

describe('conditionsAt', () => {
  const flags = flagsOf('#'.repeat(30) + '.'.repeat(30))

  it('reports state, time left and problems', () => {
    const now = conditionsAt(flags, hour(0), shortMission)
    expect(now).toMatchObject({ sunUp: true, earthUp: true, sunChangeH: 30, problems: [] })
    const later = conditionsAt(flags, hour(31), shortMission)
    expect(later?.sunUp).toBe(false)
    expect(later?.problems).toContain('The Sun is down at landing.')
  })

  it('is null outside the data', () => {
    expect(conditionsAt(flags, hour(60), shortMission)).toBeNull()
    expect(conditionsAt(flags, '2026-12-31T00:00:00Z', shortMission)).toBeNull()
  })
})

describe('nextViable', () => {
  const flags = flagsOf('.'.repeat(40) + '#'.repeat(60))

  it('finds the first workable landing and how long the wait is', () => {
    expect(nextViable(flags, hour(5), shortMission)).toEqual({
      t: hour(40),
      month: '2027-01',
      index: 40,
      waitH: 35,
    })
  })

  it('returns the time itself if it already works', () => {
    expect(nextViable(flags, hour(45), shortMission)?.waitH).toBe(0)
  })

  it('is null when nothing works', () => {
    expect(nextViable(flagsOf('.'.repeat(50)), hour(0), shortMission)).toBeNull()
  })
})

describe('alternativesAt', () => {
  const up = flagsOf('#'.repeat(100))
  const down = flagsOf('.'.repeat(100))
  const here = site('here', -89, 0)

  it('lists working sites, nearest first, without the site itself', () => {
    const near = site('near', -88, 0)
    const far = site('far', 0, 0)
    const dark = site('dark', -89.5, 0)
    const list = alternativesAt(
      here,
      hour(1),
      [
        { site: here, flags: up },
        { site: far, flags: up },
        { site: near, flags: up },
        { site: dark, flags: down },
      ],
      shortMission,
      3,
    )
    expect(list.map((a) => a.site.id)).toEqual(['near', 'far'])
    expect(list[0].distanceKm).toBeCloseTo(30.3, 0)
  })

  it('stops at the limit', () => {
    const list = alternativesAt(
      here,
      hour(1),
      [
        { site: site('a', -88, 0), flags: up },
        { site: site('b', -87, 0), flags: up },
      ],
      shortMission,
      1,
    )
    expect(list.map((a) => a.site.id)).toEqual(['a'])
  })
})

describe('distanceKm', () => {
  it('is a quarter of the way around from the pole to the equator', () => {
    expect(distanceKm({ lat: -90, lon: 0 }, { lat: 0, lon: 50 })).toBeCloseTo((Math.PI / 2) * 1737.4, 1)
  })
})

describe('slipVerdict', () => {
  const works = conditionsAt(flagsOf('#'.repeat(100)), hour(0), shortMission)
  const fails = conditionsAt(flagsOf('.'.repeat(100)), hour(0), shortMission)

  it('says what the slip did', () => {
    expect(slipVerdict(works, works)).toBe('still-works')
    expect(slipVerdict(works, fails)).toBe('breaks')
    expect(slipVerdict(fails, works)).toBe('fixes')
    expect(slipVerdict(fails, fails)).toBe('still-fails')
  })

  it('says when the slip leaves the data', () => {
    expect(slipVerdict(works, null)).toBe('no-data')
  })
})

describe('Learn at the end of the data', () => {
  it('judges only the landing hour, so the last hours of the data still work', () => {
    const flags = flagsOf('#####')
    expect(conditionsAt(flags, hour(4), BOTH_UP)?.problems).toEqual([])
    expect(nextViable(flags, hour(4), BOTH_UP)?.t).toBe(hour(4))
  })
})
