import { describe, expect, it } from 'vitest'
import { formatPct } from './format'

describe('formatPct', () => {
  it('rounds a fraction to a whole percentage', () => {
    expect(formatPct(0.734)).toBe('73%')
    expect(formatPct(0)).toBe('0%')
    expect(formatPct(1)).toBe('100%')
  })
})
