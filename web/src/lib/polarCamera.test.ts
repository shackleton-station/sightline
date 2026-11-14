import { describe, expect, it } from 'vitest'
import { kmPerPixel, latLonOf, project, screenUp, unitOf, unproject, type Vec3 } from './polarCamera'

const close = (a: Vec3, b: Vec3, digits = 9) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], digits))

describe('polarCamera', () => {
  it('turns latitude and longitude into a vector and back', () => {
    const back = latLonOf(unitOf(-89.45, -137.15))
    expect(back.lat).toBeCloseTo(-89.45, 9)
    expect(back.lon).toBeCloseTo(-137.15, 6)
  })

  it('has north up and east to the right away from the poles', () => {
    const center = unitOf(10, 20)
    const up = screenUp(center)
    expect(project(unitOf(11, 20), center, up).y).toBeGreaterThan(0)
    expect(project(unitOf(10, 21), center, up).x).toBeGreaterThan(0)
    expect(Math.abs(project(unitOf(11, 20), center, up).x)).toBeLessThan(1e-12)
  })

  it('has 0° longitude up at the south pole, the pole itself included', () => {
    // The pole, two ridge sites, and the far corner of the Atlas's wider square.
    for (const center of [unitOf(-90, 0), unitOf(-89.5, 123), unitOf(-88, -68), unitOf(-82.9, 135)]) {
      const up = screenUp(center)
      const towardZero = project(unitOf(-85, 0), center, up)
      const pole = project(unitOf(-90, 0), center, up)
      expect(towardZero.y - pole.y).toBeGreaterThan(0)
      // Straight up from the pole, give or take the little that the sphere's curve adds off-center.
      expect(Math.abs(towardZero.x - pole.x)).toBeLessThan(0.1 * (towardZero.y - pole.y))
      // 90° east is to the right of the pole, as on NASA's south-polar maps.
      expect(project(unitOf(-85, 90), center, up).x - pole.x).toBeGreaterThan(0)
    }
  })

  it('has 0° longitude down at the north pole', () => {
    const center = unitOf(89.5, 40)
    const up = screenUp(center)
    expect(project(unitOf(85, 0), center, up).y).toBeLessThan(project(unitOf(90, 0), center, up).y)
  })

  it('turns smoothly between the two ways up', () => {
    let last = screenUp(unitOf(-70, 60))
    for (let lat = -70; lat >= -88; lat -= 0.05) {
      const up = screenUp(unitOf(lat, 60))
      // Neighbouring views differ by well under a degree of screen rotation.
      expect(Math.hypot(up[0] - last[0], up[1] - last[1], up[2] - last[2])).toBeLessThan(0.02)
      last = up
    }
  })

  it('is smooth across 180° longitude too, except at one point halfway through the turn', () => {
    const turnBetween = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * (180 / Math.PI)
    // Just either side of the far meridian, the picture is the same way up, bar the fifth of a degree between them.
    for (const lat of [-72.5, -74, -76, -78, -80, -81.5]) {
      expect(turnBetween(screenUp(unitOf(lat, 179.9)), screenUp(unitOf(lat, -179.9)))).toBeLessThan(5)
    }
    // And along it, from one side of the turn to the other, apart from the one point where up flips.
    for (const [from, to] of [[-72, -76.8], [-77.2, -82]]) {
      let last = screenUp(unitOf(from, 180))
      for (let lat = from; lat >= to; lat -= 0.05) {
        const up = screenUp(unitOf(lat, 180))
        expect(turnBetween(up, last)).toBeLessThan(1)
        last = up
      }
    }
    // Before the halfway point north is up; after it, the polar map's way up, which there is the opposite.
    const pole = unitOf(-90, 0)
    expect(project(pole, unitOf(-76.8, 180), screenUp(unitOf(-76.8, 180))).y).toBeLessThan(0)
    expect(project(pole, unitOf(-77.2, 180), screenUp(unitOf(-77.2, 180))).y).toBeGreaterThan(0)
  })

  it('keeps up at right angles to the view', () => {
    for (const center of [unitOf(-84, 170), unitOf(-90, 0), unitOf(0, 0), unitOf(86.9, -179)]) {
      const up = screenUp(center)
      expect(up[0] * center[0] + up[1] * center[1] + up[2] * center[2]).toBeCloseTo(0, 9)
      expect(Math.hypot(...up)).toBeCloseTo(1, 9)
    }
  })

  it('finds the point under a spot on the disk, and nothing off the disk', () => {
    const center = unitOf(-89.45, -137.15)
    const up = screenUp(center)
    const point = unitOf(-89.2, -100)
    const at = project(point, center, up)
    close(unproject(at.x, at.y, center, up) as Vec3, point)
    expect(unproject(0.8, 0.8, center, up)).toBeNull()
    close(unproject(0, 0, center, up) as Vec3, center)
  })

  it('knows how much ground a pixel covers', () => {
    expect(kmPerPixel(1, 1000, 1737.4)).toBeCloseTo(3.4748, 4)
    expect(kmPerPixel(96, 1000, 1737.4) * 1000).toBeCloseTo(36.2, 1)
  })
})
