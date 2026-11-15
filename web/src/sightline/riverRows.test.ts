import { describe, expect, it } from 'vitest'
import { axisName, flagPlaces, labelSide, missionLabel, type RiverScenario, siteRows } from './riverRows'

const scenario = (letter: string, site: string, landing: number, active = false): RiverScenario => ({ key: letter, letter, site, siteName: `Site ${site}`, full: `Site ${site} · hour ${landing}`, flags: null, landing, active })

describe('siteRows', () => {
  it('gives four scenarios at one site one row with four flags', () => {
    const rows = siteRows([scenario('A', 'x', 10), scenario('B', 'x', 20), scenario('C', 'x', 30), scenario('D', 'x', 40)])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Site x')
    expect(rows[0].scenarios.map((one) => one.letter)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('gives each site a row, in the order the sites first appear, whatever order the scenarios are in', () => {
    const rows = siteRows([scenario('A', 'x', 10), scenario('B', 'y', 10), scenario('C', 'x', 50), scenario('D', '-88.5,40', 5)])
    expect(rows.map((row) => row.site)).toEqual(['x', 'y', '-88.5,40'])
    expect(rows.map((row) => row.scenarios.map((one) => one.letter).join(''))).toEqual(['AC', 'B', 'D'])
  })
})

describe('flagPlaces', () => {
  it('centres a flag on its landing', () => {
    expect(flagPlaces([100], 400, 16)).toEqual([92])
  })

  it('stands a flag at the edge when its landing is before or after the hours on show', () => {
    expect(flagPlaces([-500, 900], 400, 16)).toEqual([0, 384])
  })

  it('moves flags that would overlap apart, in the order of their landings, whatever order they are given in', () => {
    const places = flagPlaces([104, 100, 101], 400, 16)
    expect(places).toEqual([128, 92, 110])
  })

  it('keeps every flag in the row when they crowd its end', () => {
    const places = flagPlaces([395, 398, 399, 400], 400, 16)
    expect(places).toEqual([330, 348, 366, 384])
  })

  it('leaves flags that are clear of each other where their landings are', () => {
    expect(flagPlaces([50, 300], 400, 16)).toEqual([42, 292])
  })
})

describe('labelSide', () => {
  it('puts the label to the right of its flag when there is room', () => {
    expect(labelSide([92, 300], 0, 400, 16, 110)).toBe('right')
  })

  it('puts it to the left when another flag is close on the right and the left is free', () => {
    expect(labelSide([200, 240], 0, 400, 16, 110)).toBe('left')
  })

  it('puts it to the left at the end of the row', () => {
    expect(labelSide([384], 0, 400, 16, 110)).toBe('left')
  })

  it('keeps to the right when neither side has the room', () => {
    expect(labelSide([40, 80], 0, 150, 16, 110)).toBe('right')
  })
})

describe('missionLabel', () => {
  it('says whose mission it is and how long', () => {
    expect(missionLabel('A', 14 * 24)).toBe('A’s 14-day mission')
    expect(missionLabel('C', 36)).toBe('C’s 1.5-day mission')
  })
})

describe('axisName', () => {
  it('names the month in the Month and Day views and the year in the Year view', () => {
    const start = '2026-01-01T00:00:00Z'
    const june2027 = (Date.UTC(2027, 5, 1) - Date.parse(start)) / 3_600_000
    expect(axisName(start, june2027, 'month')).toBe('June 2027')
    expect(axisName(start, june2027 + 72, 'day')).toBe('June 2027')
    expect(axisName(start, june2027, 'year')).toBe('2027')
  })
})
