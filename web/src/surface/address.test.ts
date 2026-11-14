import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, tabLinks } from '../lib/siteTabs'
import { decodeView } from '../lib/urlState'
import { atNearestHour, EXAMPLE_LIMITS, readAddress, readLook, type SurfaceAddress, viewLink, writeAddress } from './address'

const LINK = '#a=shackleton-rim@2028-03&t=120&limits=10_48_24_1_0_2&view=3d&mode=plan&list=apollo-11@2028-07-04T05'

describe('the Surface address', () => {
  it('reads the app’s own view link and writes it back unchanged', () => {
    const address = readAddress(LINK) as SurfaceAddress
    expect(address).toMatchObject({ site: 'shackleton-rim', month: '2028-03', index: 120 })
    expect(address.kept.requirements).toEqual({ missionDays: 10, maxSunGapH: 48, maxEarthGapH: 24, sunAtLanding: true, earthAtLanding: false, minEarthClearanceDeg: 2 })
    expect(viewLink(address)).toBe(LINK)
    expect(writeAddress(address, null)).toBe(LINK)
  })

  it('opens the default view, and gives a link with no limits the example ones', () => {
    expect(readAddress(DEFAULT_VIEW)).toMatchObject({ site: 'connecting-ridge', month: '2027-05', index: 0 })
    expect(readAddress('#a=apollo-11@2027-05')?.kept.requirements).toEqual(EXAMPLE_LIMITS)
    expect(readAddress('#how')).toBeNull()
    expect(readAddress('')).toBeNull()
  })

  it('adds which way the visitor faces, and reads it back', () => {
    const address = readAddress(LINK) as SurfaceAddress
    const look = { headingDeg: 226.294, pitchDeg: -1.887, fovDeg: 12, stretch: 1 }
    const link = writeAddress(address, look)
    expect(link).toBe(`${LINK}&look=226.29_-1.89_12`)
    expect(readLook(link)).toEqual({ headingDeg: expect.closeTo(226.29, 9), pitchDeg: -1.89, fovDeg: 12, stretch: 1 })
    expect(readAddress(link)).toEqual(address)

    const stretched = writeAddress(address, { ...look, stretch: 5 })
    expect(stretched).toBe(`${LINK}&look=226.29_-1.89_12&tall=5`)
    expect(readLook(stretched)?.stretch).toBe(5)
  })

  it('leaves the other tabs able to read a link that says which way to face', () => {
    const address = readAddress(LINK) as SurfaceAddress
    const link = writeAddress(address, { headingDeg: 40, pitchDeg: 2, fovDeg: 30, stretch: 5 })
    // The app's own reader takes the same view from it, ignoring the two extra values.
    expect(decodeView(link, EXAMPLE_LIMITS)).toEqual(decodeView(LINK, EXAMPLE_LIMITS))
    // And the tabs are given the plain link, without them.
    expect(tabLinks(viewLink(address)).find((tab) => tab.id === 'planner')?.href).toBe(`/planner/${LINK}`)
  })

  it('ignores a facing it cannot read, and keeps a hand-made one in bounds', () => {
    expect(readLook(LINK)).toBeNull()
    expect(readLook(`${LINK}&look=north`)).toBeNull()
    expect(readLook(`${LINK}&look=10_2`)).toBeNull()
    expect(readLook(`${LINK}&look=-30_500_0.1&tall=900`)).toEqual({ headingDeg: 330, pitchDeg: expect.closeTo(29.7, 1), fovDeg: 2, stretch: 20 })
    expect(readLook(`${LINK}&look=10_2_12&tall=nonsense`)?.stretch).toBe(1)
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
