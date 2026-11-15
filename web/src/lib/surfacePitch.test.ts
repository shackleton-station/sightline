import { describe, expect, it } from 'vitest'
import { levelPitch, tagPlace, towardLevel, withSkyline } from './surfacePitch'

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

describe('withSkyline', () => {
  it('leaves a pitch alone while the skyline is in the picture', () => {
    // The Sun 0.4° under the skyline: the view sits between the two.
    expect(withSkyline(-1.6, -1.4, lens, 0.2)).toBe(-1.6)
    expect(withSkyline(2.9, -2, lens, 0.2)).toBe(2.9)
  })

  it('stops tipping down when the skyline would leave the top of the picture', () => {
    // A point in a crater: the Sun 42.7° under a wall that stands 27.7° over eye level.
    const pitch = withSkyline(-8.8, 27.7, lens, 0.2)
    expect(pitch).toBeCloseTo(27.7 - 6.2, 9)
    // The skyline is a fifth of the picture's height above the middle: in its upper part.
    expect((27.7 - pitch) / lens.fovDeg).toBeCloseTo(0.2, 9)
  })
})

describe('tagPlace', () => {
  it('puts the name above the disk, or under it near the menus, as before', () => {
    expect(tagPlace(400, 10, 750, 150, 140)).toEqual({ nameY: 344, points: null })
    expect(tagPlace(190, 10, 750, 150, 140)).toEqual({ nameY: 226, points: null })
  })

  it('pins the name at the lower edge, pointing down, for a body under the foot of the picture', () => {
    expect(tagPlace(900, 10, 750, 150, 140)).toEqual({ nameY: 573, points: 'down' })
    // Under the answer's band but still in the picture: pinned, and it still points down.
    expect(tagPlace(700, 10, 750, 150, 140)).toEqual({ nameY: 573, points: 'down' })
  })

  it('pins the name under the compass, pointing up, for a body above the picture', () => {
    expect(tagPlace(-300, 10, 750, 150, 140)).toEqual({ nameY: 180, points: 'up' })
  })

  it('keeps the name in a picture too short for both edges', () => {
    const place = tagPlace(400, 5, 180, 100, 8)
    expect(place.nameY).toBeGreaterThanOrEqual(130)
    expect(place.nameY).toBeLessThanOrEqual(180)
  })
})
