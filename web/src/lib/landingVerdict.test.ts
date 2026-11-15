import { describe, expect, it } from 'vitest'
import { NO_GAP_LIMIT_H } from './mission'
import { gapLimitsWords, landingVerdict, limitWords, marginalAtLanding } from './landingVerdict'

const needsBoth = { sunAtLanding: true, earthAtLanding: true }

describe('marginalAtLanding', () => {
  it('is empty for whole discs, and while the discs are not known', () => {
    expect(marginalAtLanding(needsBoth, { sun: 1, earth: 1, earthUp: true })).toEqual([])
    expect(marginalAtLanding(needsBoth, null)).toEqual([])
  })

  it('names a sliver of the Sun and the edge of Earth', () => {
    expect(marginalAtLanding(needsBoth, { sun: 0.05, earth: 1, earthUp: true })).toEqual(["5% of the Sun's disc is in view at landing"])
    expect(marginalAtLanding(needsBoth, { sun: 1, earth: 0.004, earthUp: true })).toEqual(['only the edge of Earth is in view at landing'])
  })

  it('leaves out a disc the mission does not need at landing', () => {
    expect(marginalAtLanding({ sunAtLanding: false, earthAtLanding: false }, { sun: 0.05, earth: 0.004, earthUp: true })).toEqual([])
  })
})

describe('landingVerdict', () => {
  it('gives a clean fit, a marginal fit and a miss their own state, mark and words', () => {
    expect(landingVerdict([], [])).toEqual({ state: 'fits', mark: '✓', words: 'Fits the mission', reasons: [] })
    expect(landingVerdict([], ['only the edge of Earth is in view at landing'])).toEqual({ state: 'marginal', mark: '◇', words: 'Fits, marginal', reasons: ['only the edge of Earth is in view at landing'] })
    expect(landingVerdict(['The Sun is gone for 79 h during the mission; your limit is 24 h.'], [])).toMatchObject({ state: 'miss', mark: '✗', words: 'Does not fit the mission' })
  })

  it('calls a landing that misses a limit a miss, whatever its discs', () => {
    expect(landingVerdict(['x'], ['only the edge of Earth is in view at landing']).state).toBe('miss')
  })
})

describe('limitWords', () => {
  it('writes hours, and "no limit" for the number a link carries', () => {
    expect(limitWords(24)).toBe('24 h')
    expect(limitWords(NO_GAP_LIMIT_H)).toBe('no limit')
    expect(limitWords(NO_GAP_LIMIT_H)).not.toMatch(/9999/)
  })

  it('writes both limits in a sentence, and never the number that stands for none', () => {
    expect(gapLimitsWords(24, 48)).toBe('can go up to 24 h without the Sun and 48 h without Earth')
    expect(gapLimitsWords(24, NO_GAP_LIMIT_H)).toBe('can go up to 24 h without the Sun, with no limit on time without Earth')
    expect(gapLimitsWords(NO_GAP_LIMIT_H, 48, '')).toBe('can go 48 h without Earth, with no limit on time without the Sun')
    expect(gapLimitsWords(NO_GAP_LIMIT_H, NO_GAP_LIMIT_H)).toBe('has no limit on time without the Sun or Earth')
  })
})
