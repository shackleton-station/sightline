import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { answerAt, clearanceWords, diskShareWords, headlineOf, sunHeightWords } from './answer'
import type { SiteFlags } from './flags'

const START = '2027-01-01T00:00:00Z'
const pattern = (text: string) => [...text].map((c) => c === '#')
const flagsOf = (sun: string, earth: string): SiteFlags => ({
  start: START,
  sun: pattern(sun),
  earth: pattern(earth),
  earthAbove: {},
})
const at = (hour: number, sun_up: boolean, earth_up: boolean, sun_frac = sun_up ? 1 : 0) =>
  ({
    t: new Date(Date.parse(START) + hour * 3_600_000).toISOString(),
    sun_up,
    earth_up,
    sun_frac,
  }) as TrackPoint

describe('answerAt', () => {
  const flags = flagsOf('###...', '#.....')

  it('says plainly when both are up, with time left for each', () => {
    const answer = answerAt(at(0, true, true), flags, 2030)
    expect(answer.headline).toBe('Sunlit, and Earth is in view.')
    expect(answer.sun.label).toBe('Sunset in 3 h')
    expect(answer.earth.label).toBe('Earthset in 1 h')
  })

  it('contrasts them when only one is up', () => {
    expect(answerAt(at(1, true, false), flags, 2030).headline).toBe('Sunlit, but Earth is out of view.')
    expect(answerAt(at(1, false, true), flagsOf('#.#', '###'), 2030).headline).toBe(
      'No sunlight, but Earth is in view.',
    )
  })

  it('says when neither is up', () => {
    expect(answerAt(at(4, false, false), flags, 2030).headline).toBe(
      'No sunlight, and Earth is out of view.',
    )
  })

  it('tells a partly hidden Sun apart', () => {
    expect(answerAt(at(0, true, true, 0.26), flags, 2030).headline).toBe(
      'Partly sunlit, and Earth is in view.',
    )
  })

  it('says when something never changes in the data', () => {
    const answer = answerAt(at(0, true, true), flagsOf('###', '###'), 2030)
    expect(answer.sun.label).toBe('No sunset through 2030')
    expect(answer.earth.hours).toBeNull()
  })

  it('counts past a month end, using the whole run of hours', () => {
    const long = '#'.repeat(800) + '.'
    expect(answerAt(at(10, true, true), flagsOf(long, long), 2030).sun.label).toBe('Sunset in 32 d 22 h')
  })
})

describe('headlineOf', () => {
  it('needs only the moment, so it shows even if data across dates failed to load', () => {
    expect(headlineOf(at(0, true, false))).toBe('Sunlit, but Earth is out of view.')
  })
})

describe('sunHeightWords', () => {
  it('describes height without jargon', () => {
    expect(sunHeightWords(1.23, true)).toBe('1.2° above eye level')
    expect(sunHeightWords(-0.96, false)).toBe('1.0° below eye level')
  })

  it('says why the Sun can be up below eye level, or hidden above it', () => {
    expect(sunHeightWords(-0.96, true)).toBe('1.0° below eye level, visible from this high ground')
    expect(sunHeightWords(1.23, false)).toBe('1.2° above eye level, behind terrain')
  })
})

describe('diskShareWords', () => {
  it('never rounds to fully hidden or fully clear', () => {
    expect(diskShareWords(0.002)).toBe('under 1%')
    expect(diskShareWords(0.26)).toBe('26%')
    expect(diskShareWords(0.998)).toBe('over 99%')
  })
})

describe('clearanceWords', () => {
  it('says which side of the terrain the center is on', () => {
    expect(clearanceWords(0.24)).toBe('center 0.2° above the terrain')
    expect(clearanceWords(-1.26)).toBe('center 1.3° behind the terrain')
  })
})
