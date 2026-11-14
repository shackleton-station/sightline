import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../lib/polarCamera'
import { frameAt, sunAt } from './script'

const SUNS: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [0, -1, 0],
]
const length = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2])

describe('sunAt', () => {
  it('gives the hourly rows on the hour and a unit vector in between', () => {
    expect(sunAt(1, SUNS)).toEqual([0, 1, 0])
    const half = sunAt(0.5, SUNS)
    expect(length(half)).toBeCloseTo(1)
    expect(half[0]).toBeCloseTo(half[1])
  })

  it('starts the month again at its end', () => {
    expect(sunAt(SUNS.length + 1, SUNS)).toEqual(sunAt(1, SUNS))
  })
})

describe('frameAt', () => {
  it('draws the same thing for the same moment', () => {
    expect(frameAt(12.3, 'moon', SUNS)).toEqual(frameAt(12.3, 'moon', SUNS))
    expect(frameAt(12.3, 'pole', SUNS)).toEqual(frameAt(12.3, 'pole', SUNS))
  })

  it('turns the whole Moon once a minute, north up', () => {
    expect(frameAt(0, 'moon', SUNS).view.lon).toBeCloseTo(frameAt(60, 'moon', SUNS).view.lon)
    expect(frameAt(10, 'moon', SUNS).up?.[2]).toBeGreaterThan(0.9)
  })

  it('looks straight down at the south pole, zoomed in, and turns the picture around it', () => {
    const start = frameAt(0, 'pole', SUNS)
    const later = frameAt(15, 'pole', SUNS)
    expect(start.view.lat).toBe(-90)
    expect(start.zoom).toBeGreaterThan(1)
    expect(start.up?.[2]).toBeCloseTo(0)
    // A quarter of a turn in a quarter of a minute.
    const cos = (start.up?.[0] ?? 0) * (later.up?.[0] ?? 0) + (start.up?.[1] ?? 0) * (later.up?.[1] ?? 0)
    expect(cos).toBeCloseTo(0)
  })
})
