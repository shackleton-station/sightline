import { describe, expect, it } from 'vitest'
import { needleDeg, refitZoom, viewMoved } from './sightlineView'
import { poseAt, turnPose } from './trackball'

const pole = poseAt(-90, 0)
const defaults = { ...pole, zoom: 0.6 }

describe('viewMoved', () => {
  it('is false at the default view, and true once it is turned or zoomed', () => {
    expect(viewMoved({ ...pole, zoom: 0.6 }, defaults)).toBe(false)
    expect(viewMoved({ ...pole, zoom: 0.602 }, defaults)).toBe(false)
    expect(viewMoved({ ...pole, zoom: 0.9 }, defaults)).toBe(true)
    expect(viewMoved({ ...poseAt(-80, 30), zoom: 0.6 }, defaults)).toBe(true)
  })
  it('counts a turn about the middle of the view, with the middle unmoved', () => {
    const twisted = turnPose(pole, pole.center, Math.PI / 6)
    expect(viewMoved({ ...twisted, zoom: 0.6 }, defaults)).toBe(true)
  })
})

describe('needleDeg', () => {
  it('points up at the default view', () => {
    expect(needleDeg(pole, pole.up)).toBeCloseTo(0, 6)
  })
  it('follows the picture as it is turned about its middle, a quarter turn at a time', () => {
    const quarter = turnPose(pole, pole.center, Math.PI / 2)
    expect(Math.abs(needleDeg(quarter, pole.up))).toBeCloseTo(90, 4)
    const half = turnPose(pole, pole.center, Math.PI)
    expect(Math.abs(needleDeg(half, pole.up))).toBeCloseTo(180, 4)
    // The two quarter turns point opposite ways.
    expect(needleDeg(turnPose(pole, pole.center, -Math.PI / 2), pole.up)).toBeCloseTo(-needleDeg(quarter, pole.up), 4)
  })
})

describe('refitZoom', () => {
  const before = { side: 1000, wholeZoom: 0.6 }
  it('keeps a whole-Moon view fitted when the stage changes size', () => {
    expect(refitZoom(0.6, before, { side: 1000, wholeZoom: 0.45 })).toBe(0.45)
    expect(refitZoom(0.6, before, { side: 800, wholeZoom: 0.7 })).toBe(0.7)
  })
  it('keeps a zoomed view the same size on screen', () => {
    // 2.0 on a 1000 px square is 2000 px across the Moon; on an 800 px square that is 2.5.
    expect(refitZoom(2, before, { side: 800, wholeZoom: 0.7 })).toBe(2.5)
  })
  it('never lets a zoomed view fall below the new fit', () => {
    expect(refitZoom(0.7, before, { side: 2000, wholeZoom: 0.5 })).toBe(0.5)
  })
  it('fits the first time the stage is measured', () => {
    expect(refitZoom(0.5, { side: 0, wholeZoom: 1 }, { side: 900, wholeZoom: 0.8 })).toBe(0.8)
  })
})
