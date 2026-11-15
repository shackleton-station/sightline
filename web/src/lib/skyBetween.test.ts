import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { directionBetween, skyAt } from './skyBetween'

const point = (sunAz: number, sunEl: number, earthAz: number, earthEl: number) => ({ sun_az: sunAz, sun_el: sunEl, earth_az: earthAz, earth_el: earthEl }) as TrackPoint

describe('directionBetween', () => {
  it('is the ends at 0 and 1', () => {
    expect(directionBetween(10, 5, 20, 7, 0)).toEqual({ az: 10, el: 5 })
    expect(directionBetween(10, 5, 20, 7, 1)).toEqual({ az: 20, el: 7 })
  })

  it('halfway along the horizon is the middle azimuth', () => {
    const mid = directionBetween(10, 0, 30, 0, 0.5)
    expect(mid.az).toBeCloseTo(20, 6)
    expect(mid.el).toBeCloseTo(0, 6)
  })

  it('crosses north the short way', () => {
    const mid = directionBetween(350, 2, 10, 2, 0.5)
    expect(Math.min(mid.az, 360 - mid.az)).toBeLessThan(1e-6)
    expect(mid.el).toBeGreaterThan(2)
  })

  it('passing near straight up, steps evenly along the arc while the azimuth swings', () => {
    // From 88° up in the east to 88° up in the west: 4° of arc over the top.
    const steps = [0, 0.25, 0.5, 0.75, 1].map((t) => directionBetween(90, 88, 270, 88, t))
    expect(steps[2].el).toBeCloseTo(90, 4)
    const arc = (a: { az: number; el: number }, b: { az: number; el: number }) => {
      const r = Math.PI / 180
      const v = (p: { az: number; el: number }) => [Math.sin(p.az * r) * Math.cos(p.el * r), Math.cos(p.az * r) * Math.cos(p.el * r), Math.sin(p.el * r)]
      const [x, y] = [v(a), v(b)]
      return (Math.acos(Math.min(1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2])) * 180) / Math.PI
    }
    for (let i = 1; i < steps.length; i += 1) expect(arc(steps[i - 1], steps[i])).toBeCloseTo(1, 4)
  })
})

describe('skyAt', () => {
  const track = [point(100, 1, 200, 5), point(102, 2, 201, 5), point(104, 3, 202, 5)]

  it('is the hour itself at a whole hour', () => {
    expect(skyAt(track, 1)).toEqual({ sunAz: 102, sunEl: 2, earthAz: 201, earthEl: 5 })
  })

  it('between hours lies between them', () => {
    const sky = skyAt(track, 0.5)
    expect(sky.sunAz).toBeCloseTo(101, 2)
    expect(sky.sunEl).toBeCloseTo(1.5, 2)
    expect(sky.earthAz).toBeCloseTo(200.5, 2)
  })

  it('holds the ends outside the track', () => {
    expect(skyAt(track, -3)).toEqual({ sunAz: 100, sunEl: 1, earthAz: 200, earthEl: 5 })
    expect(skyAt(track, 9)).toEqual({ sunAz: 104, sunEl: 3, earthAz: 202, earthEl: 5 })
  })
})
