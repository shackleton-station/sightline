import { describe, expect, it } from 'vitest'
import { percentile, Recent } from './stats'

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(hundred, 0.5)).toBe(50)
    expect(percentile(hundred, 0.95)).toBe(95)
    expect(percentile([7], 0.95)).toBe(7)
  })
})

describe('Recent', () => {
  it('has nothing to say before the first measurement', () => {
    expect(new Recent().summary()).toBeNull()
  })

  it('keeps only the latest values', () => {
    const recent = new Recent(3)
    for (const value of [100, 1, 2, 3]) recent.add(value)
    expect(recent.summary()).toEqual({ n: 3, median: 2, p95: 3 })
  })
})
