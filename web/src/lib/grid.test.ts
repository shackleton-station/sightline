import { describe, expect, it } from 'vitest'
import type { SiteFlags } from './flags'
import { gridRow, metricFlags, monthSpans, shadePct } from './grid'
import type { Requirements } from './mission'

const START = '2027-01-01T00:00:00Z'
const JAN = 31 * 24
const FEB = 28 * 24

const req: Requirements = {
  missionDays: 1,
  maxSunGapH: 100,
  maxEarthGapH: 100,
  sunAtLanding: true,
  earthAtLanding: true,
  minEarthClearanceDeg: 0,
}

describe('monthSpans', () => {
  it('splits hours by calendar month, including a leap February', () => {
    const spans = monthSpans(START, (365 + 366) * 24)
    expect(spans).toHaveLength(24)
    expect(spans[0]).toEqual({ month: '2027-01', from: 0, to: JAN })
    expect(spans[1]).toEqual({ month: '2027-02', from: JAN, to: JAN + FEB })
    const leap = spans.find((span) => span.month === '2028-02')
    expect(leap && leap.to - leap.from).toBe(29 * 24)
    expect(spans[23].to).toBe((365 + 366) * 24)
  })
})

describe('gridRow', () => {
  const spans = monthSpans(START, JAN + FEB)
  const none = new Array<boolean>(JAN + FEB).fill(false)

  it('counts hours per month and finds where to open', () => {
    const counted = [...none]
    counted.fill(true, 48, 96)
    const [jan, feb] = gridRow(counted, spans, 'landing')
    expect(jan).toMatchObject({ month: '2027-01', hours: 48, firstHour: 48, text: '2' })
    expect(feb).toMatchObject({ month: '2027-02', hours: 0, firstHour: JAN, text: '0', share: 0 })
  })

  it('shows percentages for the other metrics', () => {
    const counted = [...none]
    counted.fill(true, 0, JAN / 2)
    expect(gridRow(counted, spans, 'sun')[0].text).toBe('50')
  })

  it("doesn't let a small value round away to nothing", () => {
    const counted = [...none]
    counted[5] = true
    expect(gridRow(counted, spans, 'landing')[0].text).toBe('1')
    expect(gridRow(counted, spans, 'sun')[0].text).toBe('<1')
  })
})

describe('landing days', () => {
  it('counts calendar days with a landing time, not hours divided by 24', () => {
    const spans = monthSpans(START, JAN)
    // One hour on each of 7 different days is 7 days with a landing time, not 7/24 of a day.
    const counted = new Array<boolean>(JAN).fill(false)
    for (let day = 0; day < 7; day += 1) counted[day * 24 + 5] = true
    const [cell] = gridRow(counted, spans, 'landing')
    expect(cell).toMatchObject({ hours: 7, days: 7, text: '7' })
    expect(cell.share).toBeCloseTo(7 / 31)
  })

  it('counts one day once, however many hours it has', () => {
    const spans = monthSpans(START, JAN)
    const counted = new Array<boolean>(JAN).fill(false)
    counted.fill(true, 24, 48)
    expect(gridRow(counted, spans, 'landing')[0]).toMatchObject({ hours: 24, days: 1, text: '1' })
  })
})

describe('metricFlags', () => {
  const flags: SiteFlags = {
    start: START,
    sun: [true, true, false, false, ...new Array<boolean>(44).fill(false)],
    earth: [true, false, true, false, ...new Array<boolean>(44).fill(false)],
    earthAbove: {},
  }

  it('reads each body, and both together', () => {
    expect(metricFlags('sun', flags, req)).toBe(flags.sun)
    expect(metricFlags('earth', flags, req)).toBe(flags.earth)
    expect(Array.from(metricFlags('both', flags, req)).slice(0, 4)).toEqual([true, false, false, false])
  })

  it('applies the limits for landing times', () => {
    expect(Array.from(metricFlags('landing', flags, req)).slice(0, 3)).toEqual([1, 0, 0])
  })
})

describe('shadePct', () => {
  it('keeps an empty cell apart from a nearly empty one', () => {
    expect(shadePct(0, 0.5, 'sun')).toBe(0)
    expect(shadePct(0.001, 0.5, 'sun')).toBeGreaterThanOrEqual(12)
  })

  it('reaches full strength only for a whole month, for percentages', () => {
    expect(shadePct(1, 1, 'sun')).toBe(100)
    expect(shadePct(0.66, 0.66, 'both')).toBeLessThan(80)
  })

  it('has no jump between values the model cannot tell apart', () => {
    expect(shadePct(0.51, 1, 'both') - shadePct(0.49, 1, 'both')).toBeLessThan(2)
  })

  it('scales landing days to the best cell, since they never fill a month', () => {
    expect(shadePct(0.3, 0.3, 'landing')).toBe(100)
    expect(shadePct(0.15, 0.3, 'landing')).toBeCloseTo(56, 0)
  })
})
