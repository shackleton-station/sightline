import { describe, expect, it } from 'vitest'
import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from './flags'
import { bandsOf, cardsOf, filterCards, type LibraryEntry, NO_FILTERS, savedDay, shareOf } from './library'
import { DEFAULT_MISSION } from './sightlineMission'

const START = '2027-01-01T00:00:00Z'
const HOURS = 24 * 90
const site = (id: string, name: string): SiteInfo => ({ id, name, lat: -89, lon: 0, source_url: '', group: 'Test' })
/** A site where the Sun and Earth are both up all the time, or both down all the time. */
const flagged = (id: string, name: string, up: boolean): { site: SiteInfo; flags: SiteFlags } => ({ site: site(id, name), flags: { start: START, sun: Array<boolean>(HOURS).fill(up), earth: Array<boolean>(HOURS).fill(up), earthAbove: {} } })
const SITES = [flagged('bright', 'Bright Ridge', true), flagged('dark', 'Dark Floor', false)]
const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({ saved: '2026-11-15T10:00:00.000Z', site: 'bright', landing: '2027-01-10T06:00:00Z', ...over })
const cards = (entries: LibraryEntry[]) => cardsOf(entries, START, HOURS, SITES, DEFAULT_MISSION, (id) => (id === 'bright' ? 1 : 0))

describe('the mission as stretches of one state', () => {
  it('joins hours of the same state, as shares of the mission', () => {
    const sun = [true, true, false, false]
    const earth = [true, true, true, false]
    expect(bandsOf(sun, earth, 0, 4)).toEqual([
      { state: 'both', from: 0, to: 0.5 },
      { state: 'earth', from: 0.5, to: 0.75 },
      { state: 'none', from: 0.75, to: 1 },
    ])
    expect(shareOf(bandsOf(sun, earth, 0, 4), ['both', 'sun'])).toBe(0.5)
  })

  it('stops at the end of the data', () => {
    expect(bandsOf([true, true], [true, true], 1, 4)).toEqual([{ state: 'both', from: 0, to: 0.25 }])
  })
})

describe('library entries as cards', () => {
  it('judges a landing against the mission on screen, with the reasons when it misses', () => {
    const [fits, misses] = cards([entry(), entry({ site: 'dark' })])
    expect([fits.fits, fits.place, fits.month, fits.sunShare, fits.monthShare]).toEqual([true, 'Bright Ridge', '2027-01', 1, 1])
    expect(fits.scenario).toEqual({ site: 'bright', landing: 9 * 24 + 6 })
    expect(misses.fits).toBe(false)
    expect(misses.problems.length).toBeGreaterThan(0)
  })

  it('keeps a custom point without judging it, and leaves out a site the app does not know', () => {
    const [point, ...rest] = cards([entry({ site: '-89.5,120' }), entry({ site: 'nowhere' })])
    expect(rest).toEqual([])
    expect([point.fits, point.bands, point.place]).toEqual([null, null, 'Custom point, 89.50° S, 120.00° E'])
    expect(point.scenario).not.toBeNull()
  })

  it('cannot pull in a landing outside the data', () => {
    expect(cards([entry({ landing: '2031-01-01T00:00:00Z' })])[0].scenario).toBeNull()
  })

  it('names two scenarios saved at the same moment apart', () => {
    const two = cards([entry(), entry({ landing: '2027-02-01T00:00:00Z' })])
    expect(new Set(two.map((card) => card.key)).size).toBe(2)
  })
})

describe('the filters', () => {
  const all = cards([entry(), entry({ site: 'dark', landing: '2027-03-02T00:00:00Z' }), entry({ site: '-89.5,120' })])
  const RIDGE = 'Bright Ridge'
  const FLOOR = 'Dark Floor'
  const POINT = 'Custom point, 89.50° S, 120.00° E'
  const places = (change: Partial<typeof NO_FILTERS>) => filterCards(all, { ...NO_FILTERS, ...change }).map((card) => card.place)

  it('shows everything when none is set', () => {
    expect(filterCards(all, NO_FILTERS)).toHaveLength(3)
  })

  it('finds every word typed in the place’s name, whatever the case', () => {
    expect(places({ words: 'RIDGE bright' })).toEqual([RIDGE])
    expect(places({ words: 'dark' })).toEqual([FLOOR])
    expect(places({ words: 'ridge floor' })).toEqual([])
  })

  it('filters by place and by the months the landing is between', () => {
    expect(places({ site: 'dark' })).toEqual([FLOOR])
    expect(places({ from: '2027-02' })).toEqual([FLOOR])
    expect(places({ to: '2027-01' })).toEqual([RIDGE, POINT])
  })

  it('keeps only landings that fit, and months with enough days that fit; a card that is not judged passes neither', () => {
    expect(places({ fitsOnly: true })).toEqual([RIDGE])
    expect(places({ minMonthPct: 50 })).toEqual([RIDGE])
  })
})

describe('one card per landing', () => {
  const NEWEST = '2026-11-15T12:00:00.000Z'
  const OLDER = '2026-11-14T08:00:00.000Z'
  const same = cards([entry({ saved: NEWEST }), entry({ saved: OLDER }), entry({ site: 'dark' })])

  it('shows a landing saved in several plans once, from the newest, and says how many hold it', () => {
    const shown = filterCards(same, NO_FILTERS)
    expect(shown.map((card) => [card.place, card.entry.saved, card.copies])).toEqual([
      ['Bright Ridge', NEWEST, 2],
      ['Dark Floor', '2026-11-15T10:00:00.000Z', 1],
    ])
  })

  it('shows every card when switched off, each still with its count', () => {
    expect(filterCards(same, { ...NO_FILTERS, oneEach: false }).map((card) => card.copies)).toEqual([2, 2, 1])
  })

  it('counts over the whole library, not over what the other filters let through', () => {
    expect(filterCards(same, { ...NO_FILTERS, words: 'bright' }).map((card) => [card.entry.saved, card.copies])).toEqual([[NEWEST, 2]])
  })

  it('tells two hours at one place apart', () => {
    const two = cards([entry(), entry({ landing: '2027-01-10T07:00:00Z' })])
    expect(filterCards(two, NO_FILTERS)).toHaveLength(2)
  })
})

describe('the day a plan was saved', () => {
  it('is written as the Library writes a day, in UTC', () => {
    expect(savedDay('2026-11-15T23:59:59.000Z')).toBe('15 Nov 2026')
    expect(savedDay('2027-01-02T00:00:00.000Z')).toBe('2 Jan 2027')
  })
})
