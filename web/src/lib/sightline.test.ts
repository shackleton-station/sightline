import { describe, expect, it } from 'vitest'
import type { SiteFlags } from './flags'
import { bandWords, clockDate, clockTime, fieldAt, hourFromField, isoAt, degWords, elevationWords, tabTitle, monthSpan, riverTicks, riverWindow, runAt, skylineCentre, skylineDomain, skylineHorizon, skylineStretch, skylineX, smoothHorizonDeg, stateAt, stateRuns, stretchWords, sunDirection, wholeHour, yearHour } from './sightline'

const START = '2027-01-01T00:00:00Z'

describe('the Sightline clock', () => {
  it('keeps the whole hour inside the data', () => {
    expect(wholeHour(12.9, 100)).toBe(12)
    expect(wholeHour(-3, 100)).toBe(0)
    expect(wholeHour(250, 100)).toBe(99)
  })

  it('names the time of a clock hour', () => {
    expect(isoAt(START, 2880.7)).toBe('2027-05-01T00:00:00Z')
    expect(clockTime(START, 2880 + 12 * 24 + 12)).toBe('13 May 2027 · 12:00 UTC')
    expect(clockDate(START, 2880)).toBe('1 May 2027')
  })

  it('reads a picked date as UTC, to the hour, and writes it back the same way', () => {
    const may13 = 2880 + 12 * 24 + 12
    expect(fieldAt(START, may13)).toBe('2027-05-13T12:00')
    expect(hourFromField(START, '2027-05-13T12:00', 35064)).toBe(may13)
    expect(hourFromField(START, '2027-05-13T12:40', 35064)).toBe(may13)
  })
  it('has no hour for a half-typed date, an impossible one, or one outside the data', () => {
    expect(hourFromField(START, '', 35064)).toBeNull()
    expect(hourFromField(START, '0002-05-13T12:00', 35064)).toBeNull()
    expect(hourFromField(START, '2027-02-31T00:00', 35064)).toBeNull()
    expect(hourFromField(START, '2031-01-01T00:00', 35064)).toBeNull()
    expect(hourFromField(START, '2030-12-31T23:00', 35064)).toBe(35063)
  })

  it('finds the year and the hour within it, across a year boundary', () => {
    expect(yearHour(START, 10.5)).toEqual({ year: 2027, hourOfYear: 10.5 })
    expect(yearHour(START, 8760 + 3)).toEqual({ year: 2028, hourOfYear: 3 })
  })

  it('gives the hours a calendar month covers', () => {
    expect(monthSpan(START, 5)).toEqual({ from: 0, to: 744 })
    // February 2027 has 28 days.
    expect(monthSpan(START, 800)).toEqual({ from: 744, to: 744 + 672 })
  })
})

describe('tabTitle', () => {
  it('is the page\'s name in Watch, and puts the scenario first in Plan', () => {
    expect(tabTitle(null)).toBe('Sightline · Lunar landing site planner')
    expect(tabTitle({ siteName: 'Shackleton Rim', landingDate: clockDate(START, 2880 + 5 * 24 + 13) })).toBe('Shackleton Rim, 6 May 2027 · Sightline')
  })
})

describe('degWords and elevationWords', () => {
  it('writes an angle to a tenth of a degree with a true minus sign, and never a negative zero', () => {
    expect(degWords(5.74)).toBe('5.7°')
    expect(degWords(-0.2)).toBe('−0.2°')
    expect(degWords(-0.04)).toBe('0.0°')
    expect(degWords(0)).toBe('0.0°')
  })

  it('words the conventional figure as an elevation from level', () => {
    expect(elevationWords(-1.04)).toBe('elevation −1.0° from level')
    expect(elevationWords(5.8)).toBe('elevation 5.8° from level')
  })
})

describe('stateAt', () => {
  const flags: SiteFlags = { start: START, sun: [true, true, false, false], earth: [true, false, true, false], earthAbove: {} }
  it('reads the state from the hourly flags', () => {
    expect([0, 1, 2, 3].map((hour) => stateAt(flags, hour))).toEqual(['both', 'sun', 'earth', 'none'])
  })
  it('treats an hour outside the data as neither', () => {
    expect(stateAt(flags, 9)).toBe('none')
  })
})

describe('sunDirection', () => {
  // Two hours: the Sun along +x, then along +y, each with Earth's three numbers after it.
  const positions = [2, 0, 0, 9, 9, 9, 0, 4, 0, 9, 9, 9]
  it('is a unit vector at a whole hour', () => {
    expect(sunDirection(positions, 0)).toEqual([1, 0, 0])
    expect(sunDirection(positions, 1)).toEqual([0, 1, 0])
  })
  it('blends between hours and stays a unit vector', () => {
    const [x, y, z] = sunDirection(positions, 0.5) ?? [0, 0, 0]
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12)
    expect(x).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0)
  })
  it('stops at the last hour, and has nothing to say without data', () => {
    expect(sunDirection(positions, 7)).toEqual([0, 1, 0])
    expect(sunDirection([], 0)).toBeNull()
  })
})

describe('the river', () => {
  const hours = 35064
  it('shows three days, a calendar month or a calendar year around the hour', () => {
    expect(riverWindow(START, 100, 'day', hours)).toEqual({ from: 72, to: 144 })
    expect(riverWindow(START, 800, 'month', hours)).toEqual({ from: 744, to: 744 + 672 })
    expect(riverWindow(START, 9000, 'year', hours)).toEqual({ from: 8760, to: 8760 + 8784 })
  })
  it('never runs past the end of the data', () => {
    expect(riverWindow(START, 99, 'day', 100)).toEqual({ from: 72, to: 100 })
  })
  it('colours a window by runs of the same state', () => {
    const flags: SiteFlags = { start: START, sun: [true, true, false, false, true], earth: [true, true, true, false, false], earthAbove: {} }
    expect(stateRuns(flags, 1, 5)).toEqual([
      { from: 0, to: 1, state: 'both' },
      { from: 1, to: 2, state: 'earth' },
      { from: 2, to: 3, state: 'none' },
      { from: 3, to: 4, state: 'sun' },
    ])
  })
  it('finds the whole band an hour belongs to, beyond the window on screen', () => {
    const flags: SiteFlags = { start: START, sun: [true, true, false, false, false, true], earth: [true, true, true, true, false, false], earthAbove: {} }
    expect(runAt(flags, 0)).toEqual({ from: 0, to: 2, state: 'both' })
    expect(runAt(flags, 3)).toEqual({ from: 2, to: 4, state: 'earth' })
    expect(runAt(flags, 4)).toEqual({ from: 4, to: 5, state: 'none' })
    // The last band ends where the data does.
    expect(runAt(flags, 5)).toEqual({ from: 5, to: 6, state: 'sun' })
  })
  it('says a band in words: its name, when it starts and ends, and how long it lasts', () => {
    // 6 May 2027 13:00 is hour 3013 of the year; 61 hours on is 9 May 02:00.
    expect(bandWords(START, { from: 3013, to: 3074, state: 'both' }, 'Sun and Earth')).toBe('Sun and Earth · 6 May 13:00 to 9 May 02:00 · 61 h')
    // A band that crosses a new year says both years.
    expect(bandWords(START, { from: 8750, to: 8770, state: 'none' }, 'Neither')).toBe('Neither · 31 December 2027 14:00 to 1 January 2028 10:00 · 20 h')
  })
  it('labels days, round dates and months', () => {
    expect(riverTicks(START, 72, 144, 'day')).toEqual([{ at: 0, label: '4 Jan' }, { at: 24, label: '5 Jan' }, { at: 48, label: '6 Jan' }])
    expect(riverTicks(START, 0, 744, 'month').map((tick) => tick.label)).toEqual(['1', '5', '10', '15', '20', '25', '30'])
    expect(riverTicks(START, 0, 8760, 'year').map((tick) => tick.label)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
  })
})

describe('the skyline strip', () => {
  it('puts north in the middle and south at both edges', () => {
    expect(skylineX(0)).toBe(180)
    expect(skylineX(180)).toBe(0)
    expect(skylineX(90)).toBe(270)
    expect(skylineX(270)).toBe(90)
    expect(skylineX(359.5)).toBe(179.5)
  })
  it('lays the horizon out left to right and closes it at the right edge', () => {
    const horizon = [{ az: 0, el: 1 }, { az: 90, el: 2 }, { az: 180, el: 3 }, { az: 270, el: 4 }]
    expect(skylineHorizon(horizon)).toEqual([{ x: 0, el: 3 }, { x: 90, el: 4 }, { x: 180, el: 1 }, { x: 270, el: 2 }, { x: 360, el: 3 }])
    expect(skylineHorizon([])).toEqual([])
  })
  it('centres on the compass point nearest Earth', () => {
    // Earth wobbling either side of north, across the 0°/360° seam.
    expect(skylineCentre([{ earth_az: 352 }, { earth_az: 4 }, { earth_az: 9 }])).toBe(0)
    expect(skylineCentre([{ earth_az: 170 }, { earth_az: 186 }])).toBe(180)
    expect(skylineCentre([{ earth_az: 262 }, { earth_az: 281 }])).toBe(270)
    expect(skylineX(180, 180)).toBe(180)
    expect(skylineX(0, 180)).toBe(0)
    expect(skylineHorizon([{ az: 0, el: 1 }, { az: 180, el: 3 }], 180)).toEqual([{ x: 0, el: 1 }, { x: 180, el: 3 }, { x: 360, el: 1 }])
  })
  it('puts a smooth sphere\'s horizon a little below eye level', () => {
    // The pipeline's own figure for 2 m up on the Moon.
    expect(smoothHorizonDeg(2, 1_737_400)).toBeCloseTo(-0.087, 3)
    expect(smoothHorizonDeg(0, 1_737_400)).toBeCloseTo(0, 12)
  })
  it('takes its heights from the ridge and the highest thing in the sky', () => {
    const horizon = [{ el: -2.5 }, { el: 1.0 }, { el: -0.5 }]
    // Earth climbs to 6°, the Sun stays low, and Earth dips to -7° behind the land: that dip is not shown.
    const track = [{ sun_el: -1.2, earth_el: 6 }, { sun_el: -0.8, earth_el: -7 }]
    expect(skylineDomain(horizon, track)).toEqual([-3, 6.4])
    // With both bodies under the ridge's top, the ridge sets the top too.
    expect(skylineDomain(horizon, [{ sun_el: -1, earth_el: 0.2 }])).toEqual([-3, 1.4])
    expect(skylineDomain([], track)).toEqual([-1, 1])
  })
  it('says how much taller than true the heights are drawn', () => {
    // 720 px for 360° is 2 px a degree; 100 px for 5° is 20 px a degree.
    expect(skylineStretch(720, 100, [-1, 4])).toBe(10)
    expect(stretchWords(10.2)).toBe('height stretched 10 times')
    expect(stretchWords(3.84)).toBe('height stretched 3.8 times')
    expect(stretchWords(0.25)).toBe('height squeezed to 1/4')
    expect(stretchWords(1.1)).toBe('close to true proportions')
  })
})
