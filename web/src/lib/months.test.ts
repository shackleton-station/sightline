import { describe, expect, it } from 'vitest'
import { monthLabel, monthName } from './months'

describe('month labels', () => {
  it('names months', () => {
    expect(monthName('2027-01')).toBe('Jan')
    expect(monthName('2027-12')).toBe('Dec')
    expect(monthLabel('2027-05')).toBe('May 2027')
  })
})
