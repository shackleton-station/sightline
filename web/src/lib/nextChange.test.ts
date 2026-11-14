import { describe, expect, it } from 'vitest'
import { changeLabel, formatDuration, hoursUntilChange } from './nextChange'

describe('hoursUntilChange', () => {
  const flags = [true, true, true, false, false, true]

  it('counts samples until the value flips', () => {
    expect(hoursUntilChange(flags, 0, 1)).toBe(3)
    expect(hoursUntilChange(flags, 2, 1)).toBe(1)
    expect(hoursUntilChange(flags, 3, 1)).toBe(2)
  })

  it('applies the step size', () => {
    expect(hoursUntilChange(flags, 0, 2)).toBe(6)
  })

  it('returns null when nothing changes before the data ends', () => {
    expect(hoursUntilChange(flags, 5, 1)).toBeNull()
    expect(hoursUntilChange([true, true], 0, 1)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('uses hours under two days and days above', () => {
    expect(formatDuration(47)).toBe('47 h')
    expect(formatDuration(48)).toBe('2 d 0 h')
    expect(formatDuration(123)).toBe('5 d 3 h')
  })
})

describe('changeLabel', () => {
  it('words known and unknown changes', () => {
    expect(changeLabel('Sunset', 22, 2030)).toBe('Sunset in 22 h')
    expect(changeLabel('Earthrise', null, 2030)).toBe('No earthrise through 2030')
  })
})
