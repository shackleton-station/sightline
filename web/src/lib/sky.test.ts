import { describe, expect, it } from 'vitest'
import type { Vec3 } from './polarCamera'
import { earthLitShare, earthPlace, earthShade, makeStars, starsInView, toScreenFrame } from './sky'

// Looking down on the south pole: the viewer is toward -z, with +x up the screen.
const overThePole = { center: [0, 0, -1] as Vec3, up: [1, 0, 0] as Vec3 }
const box = { width: 900, height: 600 }
const disc = { x: 450, y: 300, r: 270 }

describe('the made-up stars', () => {
  const stars = makeStars()

  it('are the same on every visit, on the unit sphere, mostly faint', () => {
    expect(makeStars()).toEqual(stars)
    expect(stars.every((star) => Math.abs(Math.hypot(...star.dir) - 1) < 1e-9)).toBe(true)
    const faint = stars.filter((star) => star.alpha < 0.3).length
    expect(faint).toBeGreaterThan(stars.length * 0.6)
    expect(Math.max(...stars.map((star) => star.alpha))).toBeLessThanOrEqual(0.66)
  })

  it('are placed inside the stage and never over the Moon’s disc', () => {
    const placed = starsInView(stars, overThePole, box, disc)
    expect(placed.length).toBeGreaterThan(80)
    for (const star of placed) {
      expect(star.x).toBeGreaterThanOrEqual(0)
      expect(star.x).toBeLessThanOrEqual(box.width)
      expect(Math.hypot(star.x - disc.x, star.y - disc.y)).toBeGreaterThan(disc.r)
    }
  })

  it('turn with the view, and do not move when the Moon is zoomed', () => {
    const before = starsInView(stars, overThePole, box, { ...disc, r: 10 })
    const zoomed = starsInView(stars, overThePole, box, { ...disc, r: 10 })
    const turned = starsInView(stars, { center: [0, 0, -1], up: [0, 1, 0] }, box, { ...disc, r: 10 })
    expect(zoomed).toEqual(before)
    expect(turned).not.toEqual(before)
    // A quarter turn about the view's axis keeps the same stars in the sky.
    expect(Math.abs(turned.length - before.length)).toBeLessThan(before.length * 0.5)
  })
})

describe('Earth beside the Moon', () => {
  it('sits just outside the disc on the side Earth lies toward, when Earth is on the viewer’s side', () => {
    // Earth toward +y (to the right of the screen, where the stage has room), leaning well toward the viewer.
    const earth: Vec3 = [0, Math.cos(0.3), -Math.sin(0.3)]
    const place = earthPlace(earth, overThePole, disc, 16, box)
    expect(place.state).toBe('front')
    expect(place.y).toBeCloseTo(disc.y, 6)
    expect(place.x).toBeGreaterThan(disc.x + disc.r)
    expect(place.movedDeg).toBe(0)
    expect(Math.hypot(place.x - disc.x, place.y - disc.y)).toBeGreaterThan(disc.r + 16)
    expect(place.opacity).toBe(1)
  })

  it('slides in behind the edge as it swings to the far side, and is behind the Moon beyond that', () => {
    const level: Vec3 = [1, 0, 0]
    const setting = earthPlace(level, overThePole, disc, 16, box)
    expect(setting.state).toBe('setting')
    expect(Math.hypot(setting.x - disc.x, setting.y - disc.y)).toBeLessThan(disc.r + 16 + 10)
    const far: Vec3 = [Math.cos(0.3), 0, Math.sin(0.3)]
    expect(earthPlace(far, overThePole, disc, 16, box).state).toBe('behind')
  })

  it('goes round the Moon\'s edge to the nearest place with room when its true bearing has none, whole and off the disc', () => {
    // Earth straight up the screen, where the stage has 30 px above a disc of radius 270.
    const up: Vec3 = [Math.cos(0.3), 0, -Math.sin(0.3)]
    const place = earthPlace(up, overThePole, disc, 16, box)
    expect(place.state).toBe('front')
    expect(place.movedDeg).toBeGreaterThan(0)
    expect(place.movedDeg).toBeLessThan(40)
    expect(place.y - 16).toBeGreaterThanOrEqual(8)
    expect(Math.hypot(place.x - disc.x, place.y - disc.y)).toBeGreaterThanOrEqual(disc.r + 16 + 8 - 1e-6)
  })

  it('holds still while its true bearing drifts where there is no room, and never hops across the Moon', () => {
    // Earth swinging 8° either side of straight up the screen, as it does over a month.
    let side: -1 | 0 | 1 = 0
    let last: { x: number; y: number } | null = null
    let farthest = 0
    for (let swing = -8; swing <= 8; swing += 0.05) {
      const angle = (swing * Math.PI) / 180
      const earth: Vec3 = [Math.cos(angle) * Math.cos(0.3), Math.sin(angle) * Math.cos(0.3), -Math.sin(0.3)]
      const place = earthPlace(earth, overThePole, disc, 16, box, [], side)
      side = place.side
      if (last) farthest = Math.max(farthest, Math.hypot(place.x - last.x, place.y - last.y))
      last = { x: place.x, y: place.y }
    }
    expect(farthest).toBeLessThan(0.5)
  })

  it('keeps off a control', () => {
    const right: Vec3 = [0, Math.cos(0.3), -Math.sin(0.3)]
    const free = earthPlace(right, overThePole, disc, 16, box)
    const tools = { left: free.x - 30, top: free.y - 60, right: free.x + 30, bottom: free.y + 60 }
    const moved = earthPlace(right, overThePole, disc, 16, box, [tools])
    expect(moved.movedDeg).toBeGreaterThan(0)
    expect(moved.x + 24 <= tools.left || moved.x - 24 >= tools.right || moved.y + 24 <= tools.top || moved.y - 24 >= tools.bottom).toBe(true)
  })

  it('is not drawn when the Moon fills the stage', () => {
    expect(earthPlace([0, Math.cos(0.3), -Math.sin(0.3)], overThePole, { x: 450, y: 300, r: 4000 }, 16, box).state).toBe('no-room')
  })

  it('fades as it passes straight behind the viewer', () => {
    expect(earthPlace([0.1, 0, -Math.sqrt(0.99)], overThePole, disc, 16, box).opacity).toBeCloseTo(0.4, 6)
  })
})

describe('Earth’s phase', () => {
  it('is full with the Sun behind the viewer, new with the Sun beyond Earth, half from the side', () => {
    expect(earthLitShare(toScreenFrame([0, 0, -1], overThePole))).toBeCloseTo(1, 9)
    expect(earthLitShare(toScreenFrame([0, 0, 1], overThePole))).toBeCloseTo(0, 9)
    expect(earthLitShare(toScreenFrame([0, 1, 0], overThePole))).toBeCloseTo(0.5, 9)
  })

  it('lights the side of the disc toward the Sun and leaves the other side dim, not black', () => {
    const fromTheRight: Vec3 = [1, 0, 0]
    expect(earthShade(0.6, 0, fromTheRight)).toBe(1)
    expect(earthShade(-0.6, 0, fromTheRight)).toBeCloseTo(0.07, 9)
  })
})
