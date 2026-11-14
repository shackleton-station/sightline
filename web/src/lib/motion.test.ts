import { describe, expect, it } from 'vitest'
import { easeToward, hasAngles, pointingOf } from './motion'

describe('which way the back of the phone points', () => {
  it('points level, at the sensor’s zero, when the phone is held upright', () => {
    const { headingDeg, pitchDeg } = pointingOf({ alpha: 0, beta: 90, gamma: 0 })
    expect(headingDeg).toBeCloseTo(0, 9)
    expect(pitchDeg).toBeCloseTo(0, 9)
  })

  it('points straight down lying flat on a table, and straight up face down', () => {
    expect(pointingOf({ alpha: 40, beta: 0, gamma: 0 }).pitchDeg).toBeCloseTo(-90, 9)
    expect(pointingOf({ alpha: 40, beta: 180, gamma: 0 }).pitchDeg).toBeCloseTo(90, 9)
  })

  it('tips up as the top of the phone leans back toward the visitor', () => {
    // Upright is beta 90; leaning the top away from the visitor (toward the table) lowers the aim.
    expect(pointingOf({ alpha: 0, beta: 110, gamma: 0 }).pitchDeg).toBeCloseTo(20, 9)
    expect(pointingOf({ alpha: 0, beta: 70, gamma: 0 }).pitchDeg).toBeCloseTo(-20, 9)
  })

  it('turns clockwise as the visitor turns to their right (alpha falls)', () => {
    // Alpha counts counter-clockwise seen from above, so turning right by 30° takes it from 0 to 330.
    expect(pointingOf({ alpha: 330, beta: 90, gamma: 0 }).headingDeg).toBeCloseTo(30, 9)
    expect(pointingOf({ alpha: 90, beta: 90, gamma: 0 }).headingDeg).toBeCloseTo(270, 9)
  })

  it('points the same way with the phone on its side', () => {
    // Held sideways (landscape), level: gamma is ±90 and beta is 0. The back still points level.
    const { pitchDeg } = pointingOf({ alpha: 0, beta: 0, gamma: -90 })
    expect(pitchDeg).toBeCloseTo(0, 9)
  })
})

describe('readings', () => {
  it('ignores events with no angles in them, as a laptop or a simulator sends', () => {
    expect(hasAngles({ alpha: null, beta: null, gamma: null })).toBe(false)
    expect(hasAngles({ alpha: 10, beta: Number.NaN, gamma: 0 })).toBe(false)
    expect(hasAngles({ alpha: 10, beta: 90, gamma: 0 })).toBe(true)
  })

  it('smooths toward a new reading, the short way round north', () => {
    const eased = easeToward({ headingDeg: 350, pitchDeg: 0 }, { headingDeg: 10, pitchDeg: 10 }, 0.5)
    expect(eased.headingDeg).toBeCloseTo(0, 9)
    expect(eased.pitchDeg).toBeCloseTo(5, 9)
    expect(easeToward({ headingDeg: 10, pitchDeg: 0 }, { headingDeg: 350, pitchDeg: 0 }, 0.25).headingDeg).toBeCloseTo(5, 9)
  })
})
