import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, tabLinks } from '../lib/siteTabs'
import { decodeView } from '../lib/urlState'
import { boundedLimits, defaultAddress, type PlannerAddress, readAddress, writeAddress } from './address'
import { MISSION } from './testSites'

const address: PlannerAddress = {
  site: 'de-gerlache-rim',
  month: '2028-08',
  index: 675,
  requirements: { missionDays: 3, maxSunGapH: 48, maxEarthGapH: 96, sunAtLanding: true, earthAtLanding: false, minEarthClearanceDeg: 2 },
  shortlist: [
    { site: 'de-gerlache-rim', at: '2028-08-29T03' },
    { site: 'shackleton-rim', at: '2028-08-30T22' },
  ],
  kept: { b: null, view3d: false },
}

describe('the planner address', () => {
  it('round-trips the site, month, hour, limits and short list', () => {
    const hash = writeAddress(address)
    expect(hash).toBe('#a=de-gerlache-rim@2028-08&t=675&limits=3_48_96_1_0_2&mode=plan&list=de-gerlache-rim@2028-08-29T03~shackleton-rim@2028-08-30T22')
    expect(readAddress(hash, MISSION)).toEqual(address)
  })

  it('is a link the other tabs open on the same view', () => {
    const view = decodeView(writeAddress(address), MISSION)
    expect(view).toMatchObject({ a: { site: 'de-gerlache-rim', month: '2028-08' }, index: 675, requirements: address.requirements, mode: 'plan', shortlist: address.shortlist })
    const planner = tabLinks(writeAddress(address)).find((tab) => tab.id === 'planner')
    expect(planner?.href).toBe(`/planner/${writeAddress(address)}`)
    expect(planner?.design).toBe(true)
  })

  it('opens a link made on another tab, and keeps the parts it does not show', () => {
    const fromClassic = '#a=apollo-11@2028-03&b=-43.3,-11.2@2028-05&t=5&limits=14_72_72_1_1&view=3d&mode=learn'
    const read = readAddress(fromClassic, MISSION)
    expect(read).toMatchObject({ site: 'apollo-11', month: '2028-03', index: 5, kept: { b: { site: '-43.3,-11.2', month: '2028-05' }, view3d: true } })
    expect(read && writeAddress(read)).toBe('#a=apollo-11@2028-03&b=-43.3,-11.2@2028-05&t=5&limits=14_72_72_1_1&view=3d&mode=plan')
  })

  it('keeps limits inside the bounds of the inputs', () => {
    expect(boundedLimits({ ...MISSION, missionDays: 500, maxSunGapH: 99999, maxEarthGapH: 0 })).toMatchObject({ missionDays: 180, maxSunGapH: 8760, maxEarthGapH: 0 })
    expect(readAddress('#a=slim@2027-01&t=0&limits=999_72_72_1_1', MISSION)?.requirements.missionDays).toBe(180)
  })

  it('falls back to the given limits when a link has none, and never throws on a bad link', () => {
    expect(readAddress('#a=slim@2027-01', MISSION)?.requirements).toEqual(MISSION)
    for (const hash of ['', '#how', '#a=slim', '#a=@2027-01', '#a=slim@2027-13', '#plan=abc']) expect(readAddress(hash, MISSION)).toBeNull()
  })

  it('defaults to the view the other tabs default to', () => {
    const fallback = defaultAddress(MISSION)
    expect(fallback).toMatchObject({ site: 'connecting-ridge', month: '2027-05', index: 0, shortlist: [] })
    // The same limits, inside the bounds of this page's inputs: "no limit" on radio silence is their longest.
    const shared = decodeView(DEFAULT_VIEW, MISSION)?.requirements
    expect(shared && boundedLimits(shared)).toEqual(fallback.requirements)
  })
})
