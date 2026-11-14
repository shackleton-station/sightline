import { describe, expect, it } from 'vitest'
import { fromAzEl, lookFrom, multiply, orbitPose, perspective, standPose, toScreen } from './camera3d'

describe('3D camera', () => {
  it('uses the panorama convention for directions', () => {
    expect(fromAzEl(0, 0)[1]).toBeCloseTo(1) // north
    expect(fromAzEl(90, 0)[0]).toBeCloseTo(1) // east
    expect(fromAzEl(0, 90)[2]).toBeCloseTo(1) // up
  })

  it('keeps the site centered when orbiting', () => {
    for (const heading of [0, 73, 200]) {
      const { eye, forward } = orbitPose(heading, 30, 1000)
      const m = multiply(perspective(50, 1, 1, 10_000), lookFrom(eye, forward))
      const at = toScreen(m, [0, 0, 0], 800, 600)
      expect(at?.x).toBeCloseTo(400)
      expect(at?.y).toBeCloseTo(300)
    }
  })

  it('looks from above with north up and east to the right', () => {
    const m = multiply(perspective(50, 1, 1, 10_000), lookFrom([0, 0, 1000], [0, 0, -1]))
    const north = toScreen(m, [0, 100, 0], 800, 800)
    const east = toScreen(m, [100, 0, 0], 800, 800)
    expect(north?.y).toBeLessThan(400)
    expect(north?.x).toBeCloseTo(400)
    expect(east?.x).toBeGreaterThan(400)
    expect(east?.y).toBeCloseTo(400)
  })

  it('puts what you face in the middle when standing, and hides what is behind you', () => {
    const { eye, forward } = standPose(120, 3, 2)
    const m = multiply(perspective(50, 2, 1, 1_000_000), lookFrom(eye, forward))
    const ahead = fromAzEl(120, 3)
    const point = (s: number): [number, number, number] => [ahead[0] * s, ahead[1] * s, 2 + ahead[2] * s]
    const at = toScreen(m, point(5000), 1000, 500)
    expect(at?.x).toBeCloseTo(500)
    expect(at?.y).toBeCloseTo(250)
    expect(toScreen(m, point(-5000), 1000, 500)).toBeNull()
  })
})
