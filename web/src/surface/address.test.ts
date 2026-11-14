import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, tabLinks } from '../lib/siteTabs'
import { atNearestHour, EXAMPLE_LIMITS, readAddress, readSurfaceMoved, SURFACE_MOVED, type SurfaceAddress, viewLink } from './address'

const LINK = '#a=shackleton-rim@2028-03&t=120&limits=10_48_24_1_0_2&view=3d&mode=plan&list=apollo-11@2028-07-04T05'

describe('the Surface address', () => {
  it('reads the app’s own view link and writes it back unchanged', () => {
    const address = readAddress(LINK) as SurfaceAddress
    expect(address).toMatchObject({ site: 'shackleton-rim', month: '2028-03', index: 120 })
    expect(address.kept.requirements).toEqual({ missionDays: 10, maxSunGapH: 48, maxEarthGapH: 24, sunAtLanding: true, earthAtLanding: false, minEarthClearanceDeg: 2 })
    expect(viewLink(address)).toBe(LINK)
  })

  it('opens the default view, and gives a link with no limits the example ones', () => {
    expect(readAddress(DEFAULT_VIEW)).toMatchObject({ site: 'connecting-ridge', month: '2027-05', index: 0 })
    expect(readAddress('#a=apollo-11@2027-05')?.kept.requirements).toEqual(EXAMPLE_LIMITS)
    expect(readAddress('#how')).toBeNull()
    expect(readAddress('')).toBeNull()
  })

  it('reads an old link that says which way to face as the same view, and gives the tabs the plain link', () => {
    const address = readAddress(`${LINK}&look=40_2_30&tall=5&face=sun`) as SurfaceAddress
    expect(address).toEqual(readAddress(LINK))
    expect(tabLinks(viewLink(address)).find((tab) => tab.id === 'planner')?.href).toBe(`/planner/${LINK}`)
  })
})

describe('opening on the nearest hour', () => {
  const base = readAddress(DEFAULT_VIEW) as SurfaceAddress

  it('rounds to the nearest whole hour of the month, in UTC', () => {
    expect(atNearestHour(base, '2026-11-14T10:29:59Z')).toMatchObject({ site: 'connecting-ridge', month: '2026-11', index: 13 * 24 + 10 })
    expect(atNearestHour(base, '2026-11-14T10:30:00Z')).toMatchObject({ month: '2026-11', index: 13 * 24 + 11 })
    expect(atNearestHour(base, '2026-11-01T00:10:00Z')).toMatchObject({ month: '2026-11', index: 0 })
  })

  it('rolls into the next month when the nearest hour is there', () => {
    expect(atNearestHour(base, '2026-11-30T23:45:00Z')).toMatchObject({ month: '2026-12', index: 0 })
  })
})

describe('the message Sightline is sent when the hour settles', () => {
  it('is read when it is one, and anything else a page may be sent is not', () => {
    const moved = { type: SURFACE_MOVED, site: 'connecting-ridge', month: '2027-05', index: 133 }
    expect(readSurfaceMoved(moved)).toEqual(moved)
    for (const other of [null, 'text', 42, { ...moved, type: 'other' }, { ...moved, month: 'May' }, { ...moved, index: -1 }, { ...moved, index: 1.5 }, { ...moved, site: 3 }]) {
      expect(readSurfaceMoved(other)).toBeNull()
    }
  })
})
