import { describe, expect, it } from 'vitest'
import { formatSkyAngle } from './skyAngle'

describe('formatSkyAngle', () => {
  it('shows elevation to 0.1° and azimuth to 1°', () => {
    expect(formatSkyAngle(1.234, 135.4)).toBe('1.2° elevation · 135° az')
  })
  it('uses a real minus sign below the horizon and never shows -0.0', () => {
    expect(formatSkyAngle(-0.46, 10)).toBe('−0.5° elevation · 10° az')
    expect(formatSkyAngle(-0.01, 10)).toBe('0.0° elevation · 10° az')
  })
  it('wraps azimuth into 0–359', () => {
    expect(formatSkyAngle(2, 359.7)).toBe('2.0° elevation · 0° az')
  })
})
