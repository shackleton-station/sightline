import { describe, expect, it } from 'vitest'
import { formatUtc, indexAtFraction, intersectWindows } from './timeline'

const w = (start: string, end: string) => ({
  start: `2027-05-${start}:00:00Z`,
  end: `2027-05-${end}:00:00Z`,
})

describe('intersectWindows', () => {
  it('finds partial overlaps across several windows', () => {
    const sun = [w('01T00', '01T05'), w('06T03', '12T00')]
    const earth = [w('01T02', '10T00')]
    expect(intersectWindows(sun, earth)).toEqual([w('01T02', '01T05'), w('06T03', '10T00')])
  })

  it('treats touching windows as no overlap', () => {
    expect(intersectWindows([w('01T00', '02T00')], [w('02T00', '03T00')])).toEqual([])
  })

  it('handles empty lists', () => {
    expect(intersectWindows([], [w('01T00', '02T00')])).toEqual([])
  })
})

describe('indexAtFraction', () => {
  it('maps the ends and clamps clicks past them', () => {
    expect(indexAtFraction(0, 744)).toBe(0)
    expect(indexAtFraction(1, 744)).toBe(743)
    expect(indexAtFraction(-0.2, 744)).toBe(0)
    expect(indexAtFraction(1.2, 744)).toBe(743)
  })
})

describe('formatUtc', () => {
  it('labels the time as UTC', () => {
    expect(formatUtc('2027-05-14T06:00:00Z')).toBe('2027-05-14 06:00 UTC')
  })
})
