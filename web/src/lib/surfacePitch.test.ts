import { describe, expect, it } from 'vitest'
import { levelPitch, towardLevel } from './surfacePitch'

const lens = { fovDeg: 31, stretch: 1 }

describe('levelPitch', () => {
  it('gives both views one pitch when the Sun and Earth are both low over the hills', () => {
    // Connecting Ridge, 6 May 2027 13:00: the Sun 1.2° under eye level, Earth 5.9° over it.
    const level = levelPitch(
      [
        { bodyElDeg: -1.2, skylineElDeg: -1.5 },
        { bodyElDeg: 5.9, skylineElDeg: -2 },
      ],
      lens,
      0.2,
    )
    expect(level.weight).toBe(1)
    // Both bodies within a fifth of the picture's height of the middle, both skylines in view.
    expect(Math.abs(-1.2 - level.pitchDeg)).toBeLessThanOrEqual(6.2)
    expect(Math.abs(5.9 - level.pitchDeg)).toBeLessThanOrEqual(6.2)
    expect(towardLevel(-1.35, level)).toBeCloseTo(level.pitchDeg, 9)
    expect(towardLevel(1.95, level)).toBeCloseTo(level.pitchDeg, 9)
  })

  it('leaves each view its own pitch when the bodies are too far apart to share a picture', () => {
    // A mid-latitude site: the Sun high, Earth higher still.
    const level = levelPitch(
      [
        { bodyElDeg: 20, skylineElDeg: 0.4 },
        { bodyElDeg: 62, skylineElDeg: 0.2 },
      ],
      lens,
      0.2,
    )
    expect(level.weight).toBe(0)
    expect(towardLevel(17, level)).toBe(17)
  })

  it('leaves each view its own pitch when a body is far under the skyline', () => {
    const level = levelPitch(
      [
        { bodyElDeg: -26.5, skylineElDeg: 0.3 },
        { bodyElDeg: 4, skylineElDeg: 0.1 },
      ],
      lens,
      0.2,
    )
    expect(level.weight).toBe(0)
  })

  it('lets go smoothly as the room runs out: the weight falls with it, never jumps', () => {
    const weights = [9, 10, 11, 11.5, 12, 12.3, 12.5].map(
      (earthEl) =>
        levelPitch(
          [
            { bodyElDeg: 0, skylineElDeg: -1 },
            { bodyElDeg: earthEl, skylineElDeg: -1 },
          ],
          lens,
          0.2,
        ).weight,
    )
    expect(weights[0]).toBe(1)
    expect(weights[weights.length - 1]).toBe(0)
    for (let i = 1; i < weights.length; i += 1) expect(weights[i]).toBeLessThanOrEqual(weights[i - 1])
    expect(weights.some((weight) => weight > 0 && weight < 1)).toBe(true)
  })

  it('has nothing to share with one view, and passes a pitch through when there is no shared one', () => {
    expect(levelPitch([{ bodyElDeg: 3, skylineElDeg: 0 }], lens, 0.2).weight).toBe(0)
    expect(towardLevel(4.2, null)).toBe(4.2)
  })
})
