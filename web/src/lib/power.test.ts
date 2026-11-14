import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { locateDate, panelSunlight, powerBudget, SOLAR_CONSTANT_W_M2 } from './power'

const point = (sun_el: number, sun_frac: number) => ({ sun_el, sun_frac }) as TrackPoint

describe('panelSunlight', () => {
  it('gives a vertical panel full sun at the horizon and a flat panel none', () => {
    const { vertical, flat } = panelSunlight([point(0, 1)])
    expect(vertical).toBeCloseTo(SOLAR_CONSTANT_W_M2)
    expect(flat).toBeCloseTo(0)
  })

  it('gives a flat panel full sun overhead', () => {
    const { vertical, flat } = panelSunlight([point(90, 1)])
    expect(flat).toBeCloseTo(SOLAR_CONSTANT_W_M2)
    expect(vertical).toBeCloseTo(0)
  })

  it('counts only the visible part of the disk', () => {
    expect(panelSunlight([point(0, 0.5)]).vertical).toBeCloseTo(SOLAR_CONSTANT_W_M2 / 2)
  })

  it('averages over all hours, including dark ones', () => {
    expect(panelSunlight([point(0, 1), point(0, 0)]).vertical).toBeCloseTo(SOLAR_CONSTANT_W_M2 / 2)
  })

  it('never gives a flat panel light from below the horizontal', () => {
    expect(panelSunlight([point(-2, 1)]).flat).toBe(0)
  })

  it('handles no data', () => {
    expect(panelSunlight([])).toEqual({ vertical: 0, flat: 0 })
  })
})

describe('locateDate', () => {
  it('finds the month and hour', () => {
    expect(locateDate('2027-03-05T14:30', [2027, 2028])).toEqual({ month: '2027-03', index: 4 * 24 + 14 })
    expect(locateDate('2028-01-01T00:00', [2027, 2028])).toEqual({ month: '2028-01', index: 0 })
  })

  it('rejects other years and bad input', () => {
    expect(locateDate('2029-03-05T14:30', [2027, 2028])).toBeNull()
    expect(locateDate('', [2027])).toBeNull()
    expect(locateDate('soon', [2027])).toBeNull()
  })
})

describe('powerBudget', () => {
  const inputs = { panelAreaM2: 2, efficiency: 0.3, nightLoadW: 100 }

  it('scales sunlight by panel area and efficiency', () => {
    expect(powerBudget(500, 0, inputs).averagePanelW).toBeCloseTo(300)
  })

  it('sizes the battery for the longest time without Sun', () => {
    expect(powerBudget(500, 72, inputs).batteryWh).toBe(7200)
  })

  it('needs no battery when the Sun never sets', () => {
    expect(powerBudget(500, 0, inputs).batteryWh).toBe(0)
  })

  it('ignores impossible inputs instead of going negative or above 100%', () => {
    const odd = powerBudget(500, 10, { panelAreaM2: -1, efficiency: 2, nightLoadW: -5 })
    expect(odd).toEqual({ averagePanelW: 0, batteryWh: 0 })
    expect(powerBudget(500, 0, { ...inputs, efficiency: 2 }).averagePanelW).toBeCloseTo(1000)
  })
})
