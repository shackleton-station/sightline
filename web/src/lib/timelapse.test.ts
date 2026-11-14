import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { loopHours, sunAt, wrapHour } from './timelapse'

const point = (sun: [number, number, number]) => ({ sun_vec_me: sun }) as TrackPoint

describe('time-lapse Sun', () => {
  const track = [point([1, 0, 0]), point([0, 1, 0]), point([0, 0, 1])]

  it('returns the hourly vector on whole hours', () => {
    expect(sunAt(track, 1)).toEqual([0, 1, 0])
  })

  it('blends between hours and stays a unit vector', () => {
    const [x, y, z] = sunAt(track, 0.5)
    expect(x).toBeCloseTo(Math.SQRT1_2)
    expect(y).toBeCloseTo(Math.SQRT1_2)
    expect(z).toBe(0)
  })

  it('loops from the last hour back to the first', () => {
    expect(wrapHour(3.25, 3)).toBeCloseTo(0.25)
    expect(wrapHour(-0.5, 3)).toBeCloseTo(2.5)
    const [x, y, z] = sunAt(track, 2.5)
    expect(x).toBeCloseTo(Math.SQRT1_2)
    expect(y).toBe(0)
    expect(z).toBeCloseTo(Math.SQRT1_2)
  })
})

describe('time-lapse loop length', () => {
  // The Sun circling the pole once every 709 hours, as seen from the Moon, over a 744-hour month.
  const SYNODIC_H = 709
  const month = Array.from({ length: 744 }, (_, h) => {
    const a = (2 * Math.PI * h) / SYNODIC_H
    return point([Math.cos(a), Math.sin(a), -0.02])
  })

  it('ends where the Sun comes back to its first direction', () => {
    expect(loopHours(month)).toBe(SYNODIC_H)
  })

  it('wraps from the last looped hour to the first by an ordinary hourly step, not a jump', () => {
    const loop = loopHours(month)
    const angle = (a: number[], b: number[]) =>
      (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) / Math.PI
    const step = angle(sunAt(month, 0, loop), sunAt(month, 1, loop))
    const wrap = angle(sunAt(month, loop - 1, loop), sunAt(month, loop, loop))
    expect(wrap).toBeLessThan(step * 1.5)
    // Looping the whole track would jump about 17°.
    expect(angle(sunAt(month, 743), sunAt(month, 744))).toBeGreaterThan(15)
  })

  it('keeps short tracks whole', () => {
    expect(loopHours(month.slice(0, 3))).toBe(3)
  })
})
