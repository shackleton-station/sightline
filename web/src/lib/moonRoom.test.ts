import { describe, expect, it } from 'vitest'
import { tallestBesideMoon, wholeMoonDisc } from './moonRoom'

describe('wholeMoonDisc', () => {
  it('centres the disc in the room above what is kept clear, at nine tenths of the shorter side', () => {
    expect(wholeMoonDisc(1440, 900, 64)).toEqual({ cx: 720, cy: 418, r: 376.2 })
  })

  it('is fitted to the width on a window taller than it is wide', () => {
    expect(wholeMoonDisc(400, 800, 0)).toEqual({ cx: 200, cy: 400, r: 180 })
  })
})

describe('tallestBesideMoon', () => {
  const disc = { cx: 700, cy: 400, r: 300 }

  it('runs from the bottom to the top limit where the disc does not reach over the card', () => {
    expect(tallestBesideMoon(disc, 380, 760, 90, 12)).toBe(670)
  })

  it('stops under the disc where the disc reaches over the card: the corner is never inside it', () => {
    const height = tallestBesideMoon(disc, 500, 760, 90, 0)
    const cornerY = 760 - height
    expect(height).toBeGreaterThan(0)
    expect(height).toBeLessThan(670)
    expect(Math.hypot(disc.cx - 500, cornerY - disc.cy)).toBeCloseTo(disc.r, 6)
  })

  it('has no room for a card whose bottom is level with the disc or above its middle', () => {
    expect(tallestBesideMoon(disc, 500, 400, 90, 0)).toBe(0)
  })

  it('never answers a negative height', () => {
    expect(tallestBesideMoon(disc, 380, 80, 90, 12)).toBe(0)
  })
})
