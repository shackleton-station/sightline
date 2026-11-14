import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import type { SiteFlags } from './flags'
import { DEFAULT_HEIGHTS, heightFrom, heightsWords, isBaseHeights, mixFlags, mixTracks, PANEL_HEIGHTS_M } from './heights'

const flags = (sun: boolean[], earth: boolean[]): SiteFlags => ({ start: '2027-01-01T00:00:00Z', sun, earth, earthAbove: { '2': earth.map((up) => up && false) } })
const row = (t: string, sunEl: number, earthEl: number, sunUp: boolean, earthUp: boolean): TrackPoint => ({ t, sun_az: 10, sun_el: sunEl, sun_frac: sunUp ? 1 : 0, sun_up: sunUp, earth_az: 20, earth_el: earthEl, earth_up: earthUp, sun_vec_me: [1, 0, 0] })

describe('heights above the ground', () => {
  it('says the heights only when one is not the app\'s own 2 m', () => {
    expect(isBaseHeights(DEFAULT_HEIGHTS)).toBe(true)
    expect(heightsWords(DEFAULT_HEIGHTS)).toBeNull()
    expect(heightsWords({ panelM: 10, antennaM: 4 })).toBe('panel at 10 m, antenna at 4 m')
    expect(heightsWords({ panelM: 2, antennaM: 4 })).toBe('panel at 2 m, antenna at 4 m')
  })

  it('reads a height from a link only if it is one of those offered', () => {
    expect(heightFrom('10', PANEL_HEIGHTS_M)).toBe(10)
    expect(heightFrom('4', PANEL_HEIGHTS_M)).toBe(2)
    expect(heightFrom(null, PANEL_HEIGHTS_M)).toBe(2)
    expect(heightFrom('', PANEL_HEIGHTS_M)).toBe(2)
    expect(heightFrom('ten', PANEL_HEIGHTS_M)).toBe(2)
  })

  it('takes the Sun from one set of flags and Earth from the other', () => {
    const low = flags([true, false, false], [false, false, true])
    const high = flags([true, true, false], [true, false, true])
    const mixed = mixFlags(high, low)
    expect(mixed.sun).toBe(high.sun)
    expect(mixed.earth).toBe(low.earth)
    expect(mixed.earthAbove).toBe(low.earthAbove)
    // The same set for both is that set, untouched: at 2 m nothing changes.
    expect(mixFlags(low, low)).toBe(low)
    expect(() => mixFlags(low, { ...high, start: '2028-01-01T00:00:00Z' })).toThrow()
  })

  it('takes the Sun\'s fields of each hour from one track and Earth\'s from the other', () => {
    const low = [row('2027-05-01T00:00:00Z', -1, -2, false, false), row('2027-05-01T01:00:00Z', 0, -1, true, false)]
    const high = [row('2027-05-01T00:00:00Z', -1, -2, true, true), row('2027-05-01T01:00:00Z', 0, -1, true, true)]
    const mixed = mixTracks(high, low)
    expect(mixed.map((point) => [point.sun_up, point.earth_up])).toEqual([
      [true, false],
      [true, false],
    ])
    expect(mixed[0].sun_frac).toBe(1)
    expect(mixTracks(low, low)).toBe(low)
    expect(() => mixTracks(low, [low[0]])).toThrow()
    expect(() => mixTracks(low, [low[1], low[0]])).toThrow()
  })
})
