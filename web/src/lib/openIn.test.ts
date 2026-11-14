import { describe, expect, it } from 'vitest'
import { moonTrekUrl, quickmapPoint, quickmapUrl } from './openIn'

describe('quickmapPoint', () => {
  it('uses the flat map away from the poles: metres along the equator and along a meridian', () => {
    const point = quickmapPoint(26.13239, 3.6333)!
    expect(point.proj).toBe(16)
    expect(point.x).toBeCloseTo((1_737_400 * 3.6333 * Math.PI) / 180, 3)
    expect(point.y).toBeCloseTo((1_737_400 * 26.13239 * Math.PI) / 180, 3)
  })

  it('uses the view from above the south pole in the far south, with longitude 0 pointing up', () => {
    expect(quickmapPoint(-89, 0)).toMatchObject({ proj: 17, x: 0 })
    expect(quickmapPoint(-89, 0)!.y).toBeCloseTo(1_737_400 * Math.cos((89 * Math.PI) / 180), 3)
    expect(quickmapPoint(-89, 90)!.x).toBeCloseTo(1_737_400 * Math.cos((89 * Math.PI) / 180), 3)
    expect(quickmapPoint(-89, 90)!.y).toBeCloseTo(0, 3)
  })

  it('gives no view in the far north, where Quickmap\'s north-pole view was never checked', () => {
    expect(quickmapPoint(80, 10)).toBeNull()
    expect(quickmapUrl(80, 10)).toBeNull()
    expect(quickmapPoint(70, 10)?.proj).toBe(16)
  })
})

describe('quickmapUrl', () => {
  it('opens 40 km of ground centred on the point', () => {
    const url = new URL(quickmapUrl(-89.45267, -137.14865)!)
    expect(url.origin).toBe('https://quickmap.lroc.im-ldi.com')
    expect(url.searchParams.get('proj')).toBe('17')
    const [minX, minY, maxX, maxY] = url.searchParams.get('prjExtent')!.split(',').map(Number)
    expect(maxX - minX).toBe(40_000)
    expect(maxY - minY).toBe(40_000)
    const point = quickmapPoint(-89.45267, -137.14865)!
    expect((minX + maxX) / 2).toBeCloseTo(point.x, 0)
    expect((minY + maxY) / 2).toBeCloseTo(point.y, 0)
  })
})

describe('moonTrekUrl', () => {
  it('gives degrees to the flat map', () => {
    expect(moonTrekUrl(0.67416, 23.47314)).toBe('https://trek.nasa.gov/moon/#v=0.1&x=23.47314&y=0.67416&z=8&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&d=&locale=&b=moon')
  })

  it('gives metres to the south-pole map', () => {
    const url = moonTrekUrl(-89.45267, -137.14865)!
    expect(url).toContain('p=urn%3Aogc%3Adef%3Acrs%3AIAU2000%3A%3A30120')
    const hash = new URLSearchParams(url.split('#')[1])
    // About 16.6 km from the pole, toward longitude -137°: both coordinates negative.
    expect(Math.hypot(Number(hash.get('x')), Number(hash.get('y')))).toBeGreaterThan(16_000)
    expect(Math.hypot(Number(hash.get('x')), Number(hash.get('y')))).toBeLessThan(17_000)
    expect(Number(hash.get('x'))).toBeLessThan(0)
    expect(Number(hash.get('y'))).toBeLessThan(0)
  })

  it('uses the south-pole map only as far as it was seen to work, and the flat map only where it does not smear', () => {
    // IM-2 (158 km from the pole) opened on the south-pole map; IM-1 (300 km) did not.
    expect(moonTrekUrl(-84.7906, 29.1957)).toContain('IAU2000')
    expect(moonTrekUrl(-80.13, 1.44)).toBeNull()
    expect(moonTrekUrl(-69.3741, 32.32)).toContain('EPSG%3A%3A104903')
    expect(moonTrekUrl(80, 0)).toBeNull()
  })
})
