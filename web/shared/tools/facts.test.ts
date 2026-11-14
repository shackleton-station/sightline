import { describe, expect, it } from 'vitest'
import { NO_GAP_LIMIT_H, type Requirements } from '../../src/lib/mission'
import { gapLabel, limitsLabel, limitWords } from './facts'

const limits: Requirements = { missionDays: 14, maxSunGapH: 24, maxEarthGapH: NO_GAP_LIMIT_H, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

describe('the mission limits as the co-pilot is given them', () => {
  it('says "no limit" for a gap with no limit, never the stand-in or its length in days', () => {
    const line = limitsLabel(limits)
    expect(line).toContain('no limit on time without Earth')
    expect(line).not.toMatch(/99999|99,999|4166|4,166/)
    expect(limitWords(limits).maxEarthGapH).toBe('no limit on time without Earth')
  })
  it('treats anything at or above the stand-in as no limit, for the Sun too', () => {
    expect(limitWords({ ...limits, maxSunGapH: 250_000 }).maxSunGapH).toBe('no limit on time without the Sun')
    expect(gapLabel(NO_GAP_LIMIT_H)).toBe('no limit')
    expect(gapLabel(NO_GAP_LIMIT_H + 1)).toBe('no limit')
  })
  it('still words a real limit in hours or days', () => {
    expect(limitWords({ ...limits, maxEarthGapH: 72 }).maxEarthGapH).toBe('at most 3 days without Earth')
    expect(limitWords(limits).maxSunGapH).toBe('at most 24 h without the Sun')
  })
})
