import { describe, expect, it } from 'vitest'
import { readAddress } from './follow'
import { type Followed, followedPart, isWatchHash, presenterHash, readFollowed, shouldSetHour } from './followView'

const REST: Followed = { barIso: null, play: null, stage: 'orbit', panel: null, library: false, sheet: null, layer: null, light: false }
const PLAN = '#a=connecting-ridge@2027-05&t=133&limits=14_24_24_1_1&mode=plan&sky=1'

describe('what a presenter adds to the Sightline address', () => {
  it('adds nothing for a screen at rest, and each value only when it is not the resting one', () => {
    expect(followedPart(REST)).toBe('')
    expect(followedPart({ ...REST, barIso: '2027-05-06T13:00:00.000Z' })).toBe('&bar=2027-05-06T13')
    expect(followedPart({ barIso: '2027-05-06T13:00:00Z', play: 24, stage: 'site', panel: 'compare', library: true, sheet: 'brief', layer: 'steep', light: true })).toBe(
      '&bar=2027-05-06T13&play=24&stage=site&fpanel=compare&lib=1&sheet=brief&layer=steep&light=1',
    )
  })

  it('comes back as it was written, after the plan or after the mark for Watch', () => {
    const shown: Followed = { barIso: '2027-05-06T13:00:00Z', play: 24, stage: 'surface', panel: 'accuracy', library: false, sheet: 'guide', layer: 'photo', light: true }
    expect(readFollowed(presenterHash(PLAN, shown))).toEqual(shown)
    expect(readFollowed(presenterHash(null, { ...REST, barIso: '2026-11-17T09:00:00Z', play: 24 }))).toEqual({ ...REST, barIso: '2026-11-17T09:00:00Z', play: 24 })
    expect(readFollowed(PLAN)).toEqual(REST)
  })

  it('says which address is Watch: the mark, alone or with values after it, and never a plan', () => {
    expect(isWatchHash(presenterHash(null, REST))).toBe(true)
    expect(isWatchHash(presenterHash(null, { ...REST, play: 24 }))).toBe(true)
    expect(isWatchHash(presenterHash(PLAN, REST))).toBe(false)
    expect(isWatchHash('')).toBe(false)
    expect(isWatchHash('#watch=10')).toBe(false)
  })

  it('is an address the server lets a presenter publish', () => {
    const hash = presenterHash(PLAN, { barIso: '2027-05-06T13:00:00Z', play: 24, stage: 'site', panel: 'compare', library: true, sheet: 'brief', layer: 'temperature', light: true })
    expect(readAddress({ path: '/', query: '', hash })).toEqual({ path: '/', query: '', hash })
    expect(readAddress({ path: '/', query: '', hash: presenterHash(null, REST) })).not.toBeNull()
  })

  it('reads past anything it does not know, since the values come from a stranger', () => {
    const odd = '#watch=1&bar=2027-13-99T99&play=1e9&stage=space&fpanel=scout&lib=yes&sheet=secrets&layer=<script>&light=2'
    expect(readFollowed(odd)).toEqual(REST)
    expect(readFollowed('#watch=1&bar=tomorrow&play=0').barIso).toBeNull()
    expect(readFollowed('#watch=1&play=0.5').play).toBeNull()
    expect(readFollowed('#watch=1&play=744').play).toBe(744)
  })
})

describe("whether a follower's clock is set to the presenter's hour", () => {
  it('always while the presenter holds time, and when the follower was not playing', () => {
    expect(shouldSetHour(100, 100.4, null, true)).toBe(true)
    expect(shouldSetHour(100, 101, 24, false)).toBe(true)
  })

  it('only after a real drift while both play', () => {
    // At a day a second, three seconds of play is 72 hours.
    expect(shouldSetHour(100, 130, 24, true)).toBe(false)
    expect(shouldSetHour(100, 180, 24, true)).toBe(true)
    expect(shouldSetHour(300, 100, 24, true)).toBe(true)
  })
})
