import { describe, expect, it } from 'vitest'
import { CHECK_MARK, elevationAtLanding, elevationMeans, gapCheck, landingCheck, landingWords, shareMeans, sharePct, WHILE_UP_MEANS, whileUpWords } from './columnStats'

describe('gapCheck', () => {
  it('marks a gap past the limit as a miss, and one within it as within', () => {
    expect(gapCheck('sun', 95, 24, 14)).toEqual({ check: 'miss', words: 'Longest dark spell', hours: '95 h', limit: 'limit 24 h' })
    expect(gapCheck('sun', 24, 24, 14).check).toBe('ok')
  })

  it('has no mark where the mission sets no limit', () => {
    expect(gapCheck('earth', 169, null, 14)).toEqual({ check: 'none', words: 'Longest radio silence', hours: '169 h', limit: 'no limit' })
  })

  it('says so when the body is never down', () => {
    expect(gapCheck('earth', 0, 12, 1)).toEqual({ check: 'ok', words: 'No radio silence in these 1 day', hours: null, limit: 'limit 12 h' })
    expect(gapCheck('sun', 0, 24, 14).words).toBe('No dark spell in these 14 days')
  })
})

describe('landingCheck', () => {
  it('is a miss only when the mission needs the body in view and it is not', () => {
    expect(landingCheck(true, false, 0)).toBe('miss')
    expect(landingCheck(false, false, 0)).toBe('none')
  })

  it('is marginal under half a disc, needed or not, as the verdict counts it', () => {
    expect(landingCheck(true, true, 0.05)).toBe('marginal')
    expect(landingCheck(false, true, 0.49)).toBe('marginal')
    expect(landingCheck(true, true, 0.5)).toBe('ok')
  })

  it('is within when needed and in view, and unmarked when not needed', () => {
    expect(landingCheck(true, true, 1)).toBe('ok')
    expect(landingCheck(true, true, null)).toBe('ok')
    expect(landingCheck(false, true, 1)).toBe('none')
  })
})

describe('the words', () => {
  it('gives each state its own mark', () => {
    expect(CHECK_MARK).toEqual({ ok: '✓', marginal: '◇', miss: '✗', none: '' })
  })

  it('writes the landing line and the share', () => {
    expect(landingWords('0.3°', 'above the skyline', 'sets in 5 d 11 h', null)).toBe('At landing: 0.3° above the skyline · sets in 5 d 11 h')
    expect(landingWords('0.2°', 'below the skyline', 'sets in 2 d 7 h', '5% of the disc showing')).toBe('At landing: center 0.2° below the skyline, edge showing (5%) · sets in 2 d 7 h')
    expect(landingWords('0.1°', 'above the skyline', 'sets in 2 d 7 h', '62% of the disc showing')).toBe('At landing: center 0.1° above the skyline, 62% of the disc showing · sets in 2 d 7 h')
    expect(sharePct(60.7)).toBe('61%')
  })

  it('names a height in a share\'s hover text only when it is not 2 m', () => {
    expect(shareMeans('sun', 2)).toBe('The share of the mission’s hours with any of the Sun in view from the panel. More means more solar power.')
    expect(shareMeans('sun', 10)).toBe('The share of the mission’s hours with any of the Sun in view from the panel, 10 m up. More means more solar power.')
    expect(shareMeans('earth', 2)).toBe('The share of the mission’s hours with Earth in view from the antenna, by your rule. More means more time with a direct radio link.')
    expect(shareMeans('earth', 4)).toBe('The share of the mission’s hours with Earth in view from the antenna, 4 m up, by your rule. More means more time with a direct radio link.')
  })

  it('says the Sun’s elevation by what it is measured from, at landing and over the sunlit hours', () => {
    expect(elevationAtLanding(-1.24)).toBe('elevation −1.2° from level at landing')
    expect(elevationAtLanding(36.44)).toBe('elevation 36.4° from level at landing')
    // A hair below level is not written "−0.0°".
    expect(elevationAtLanding(-0.04)).toBe('elevation 0.0° from level at landing')
    expect(whileUpWords(-2.04, -1.16)).toBe('at −2.0° to −1.2°')
    expect(whileUpWords(1.02, 1.04)).toBe('at 1.0°')
  })

  it('never leaves "elevation" bare in a hover text: each says a flat horizon', () => {
    expect(elevationMeans(2)).toBe('The Sun’s elevation at landing: its height above a flat horizon, seen from the panel. From high ground the skyline lies below 0°, so a negative figure can still be in view.')
    expect(elevationMeans(10)).toContain('seen from the panel, 10 m up.')
    expect(WHILE_UP_MEANS).toContain('its height above a flat horizon')
  })
})
