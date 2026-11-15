import { describe, expect, it } from 'vitest'
import type { MoonFeatures } from '../data/contract'
import { fitNames, markerBoxes, nameBox, nameCandidates } from './placeNames'

const features: MoonFeatures = {
  source: 'test',
  names: [
    { name: 'Small Crater', kind: 'crater', lat: -60, lon: 10, diameter_km: 300, source_url: '' },
    { name: 'Wide Sea', kind: 'mare', lat: -50, lon: 20, diameter_km: 900, source_url: '' },
    { name: 'Far Side', kind: 'crater', lat: 40, lon: 180, diameter_km: 500, source_url: '' },
  ],
  landings: [{ name: 'Old Lander', lat: -40, lon: 0, source_url: '' }],
}

/** A camera that puts longitude across and latitude up the disc, and has northern places facing away. */
const place = (lat: number, lon: number) => ({ x: lon / 100, y: (lat + 50) / 100, facing: lat < 0 ? 1 : 0 })

describe('nameCandidates', () => {
  it('gives the earlier landings room first, then the features from the widest down, and leaves out what faces away', () => {
    expect(nameCandidates(features, place, 1, 400).map((name) => name.text)).toEqual(['Old Lander', 'Wide Sea', 'Small Crater'])
  })

  it("puts each name where the globe's camera has its place, on the square in pixels", () => {
    const [lander] = nameCandidates(features, place, 1, 400)
    expect(lander).toMatchObject({ kind: 'landing', x: 200, y: 180 })
    // Zoomed in, a place moves away from the middle by the zoom.
    expect(nameCandidates(features, place, 2, 400)[0]).toMatchObject({ x: 200, y: 160 })
  })
})

describe('the smaller features round the south pole', () => {
  const polar: MoonFeatures = {
    source: 'test',
    names: [
      { name: 'Shackleton', kind: 'crater', lat: -89.67, lon: 129.78, diameter_km: 21, source_url: '' },
      { name: 'Mons Mouton', kind: 'mountains', lat: -84.6, lon: 31, diameter_km: 130, source_url: '' },
      { name: 'Mare Anguis', kind: 'mare', lat: -22.6, lon: 67.7, diameter_km: 146, source_url: '' },
      { name: 'Wide Sea', kind: 'mare', lat: -50, lon: 20, diameter_km: 900, source_url: '' },
    ],
    landings: [],
  }
  const names = (zoom: number) => nameCandidates(polar, place, zoom, 600).map((name) => name.text)

  it('are not named with the whole Moon in view: only its landmarks and its seas are', () => {
    // 600 px across the whole Moon: 21 km is under 4 px, 130 km about 22.
    expect(names(1)).toEqual(['Wide Sea', 'Mare Anguis'])
  })

  it('are named once the view is close enough for each to have room, the wider ones first', () => {
    // At 1.5 times, 130 km spans about 34 px; 21 km still only 5.
    expect(names(1.5)).toEqual(['Wide Sea', 'Mare Anguis', 'Mons Mouton'])
    // Close on a site (about 420 m a pixel): 21 km spans 50 px.
    expect(names(14)).toEqual(['Wide Sea', 'Mare Anguis', 'Mons Mouton', 'Shackleton'])
  })
})

describe('fitNames', () => {
  const name = (key: string, x: number, y: number) => ({ key, text: 'Mare Nubium', kind: 'mare', x, y })

  it('prints the first of two names that would lie on each other', () => {
    expect(fitNames([name('a', 100, 100), name('b', 110, 104), name('c', 100, 140)], 400, []).map((one) => one.key)).toEqual(['a', 'c'])
  })

  it('leaves out a name that would leave the square', () => {
    expect(fitNames([name('edge', 10, 100), name('in', 200, 200)], 400, []).map((one) => one.key)).toEqual(['in'])
  })

  it("leaves out a name any of which would be off the Moon's disc", () => {
    // The disc is 300 across in the middle of a 400 square: its left edge is at 50.
    expect(fitNames([name('rim', 80, 200), name('in', 200, 200)], 400, [], 300).map((one) => one.key)).toEqual(['in'])
    // A corner is enough: this one's middle is well inside, its top left corner is not.
    expect(fitNames([name('corner', 115, 100)], 400, [], 300)).toEqual([])
  })

  it('keeps names off room that is already taken', () => {
    const taken = [{ left: 180, right: 220, top: 190, bottom: 210 }]
    expect(fitNames([name('on', 200, 200), name('clear', 200, 260)], 400, taken).map((one) => one.key)).toEqual(['clear'])
  })
})

describe('markerBoxes', () => {
  it("takes a marker's own shape, larger for a group, and its name where one is printed", () => {
    const [dot] = markerBoxes([{ x: 100, y: 100, text: 'Site', label: false, sites: [1] }])
    const [group] = markerBoxes([{ x: 100, y: 100, text: '3 sites', label: false, sites: [1, 2, 3] }])
    expect(group.right - group.left).toBeGreaterThan(dot.right - dot.left)
    const boxes = markerBoxes([{ x: 100, y: 100, text: 'Shackleton Rim', label: true, labelSide: 'below', sites: [1] }])
    expect(boxes).toHaveLength(2)
    expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom)
    // A name beside the marker takes room there, not under it.
    const beside = markerBoxes([{ x: 100, y: 100, text: 'Shackleton Rim', label: true, labelSide: 'right', sites: [1] }])[1]
    expect(beside.left).toBeGreaterThan(100)
  })

  it('so a place name is never printed on a site or on its name', () => {
    const taken = markerBoxes([{ x: 200, y: 200, text: 'Shackleton Rim', label: true, sites: [1] }])
    const under = { key: 'under', text: 'Bailly', kind: 'crater', x: 200, y: 222 }
    expect(taken.some((box) => box.top < nameBox(under).bottom && box.bottom > nameBox(under).top)).toBe(true)
    expect(fitNames([under], 400, taken)).toEqual([])
  })
})
