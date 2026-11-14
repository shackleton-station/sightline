import { describe, expect, it } from 'vitest'
import { clearLabels, groupOverlapping, labelBox, labelBoxAt, labelWidthPx, middleOf, placeLabels, stripLabels, stripLabelWidthPx, zoomForScale } from './sightlineDots'

describe('groupOverlapping', () => {
  it('leaves markers that are apart on their own', () => {
    const marks = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 }]
    expect(groupOverlapping(marks)).toEqual([[marks[0]], [marks[1]], [marks[2]]])
  })
  it('gathers markers that would overlap, chains included', () => {
    // a-b and b-c are close; a-c are not, but all three print over one another in a row.
    const [a, b, c, far] = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 24, y: 0 }, { x: 200, y: 0 }]
    expect(groupOverlapping([a, far, b, c])).toEqual([[a, b, c], [far]])
  })
  it('takes in a dot that would lie under the group\'s bigger marker', () => {
    // c is clear of b as one dot beside another (19 px), but the group's marker, in the middle of a
    // and b, is bigger than a dot and would touch it (21 px between their middles).
    const [a, b, c] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 23, y: 0 }]
    expect(groupOverlapping([b, c])).toEqual([[b], [c]])
    expect(groupOverlapping([a, b, c])).toEqual([[a, b, c]])
    // A little farther off, it stays a dot of its own.
    expect(groupOverlapping([a, b, { x: 25, y: 0 }])).toHaveLength(2)
  })
  it('puts a group\'s one marker in the middle of its members', () => {
    expect(middleOf([{ x: 0, y: 0 }, { x: 12, y: 6 }])).toEqual({ x: 6, y: 3 })
  })
})

describe('clearLabels', () => {
  const mark = (key: string, x: number, y: number, text = 'A site') => ({ key, text, x, y, reach: 12 })
  it('shows names that lie clear of one another', () => {
    expect(clearLabels([mark('a', 100, 100), mark('b', 300, 100)], 500)).toEqual(new Set(['a', 'b']))
  })
  it('keeps the first of two names that would collide', () => {
    // The markers are apart, but the first one's long name reaches under the second.
    expect(clearLabels([mark('selected', 100, 100, 'A much longer site name'), mark('other', 150, 100)], 500)).toEqual(new Set(['selected']))
  })
  it('hides a name that would print over another marker', () => {
    // b's marker sits right where a's name would go, a little below it.
    const kept = clearLabels([mark('a', 100, 100), mark('b', 104, 124)], 500)
    expect(kept.has('a')).toBe(false)
    expect(kept.has('b')).toBe(true)
  })
  it('hides a name that would run past the edge', () => {
    expect(clearLabels([mark('edge', 6, 100, 'A long name at the edge')], 500)).toEqual(new Set())
  })
  it('puts a name centered under its marker', () => {
    const box = labelBox(mark('a', 100, 50, 'Name'))
    expect((box.left + box.right) / 2).toBe(100)
    expect(box.top).toBe(65)
    expect(box.right - box.left).toBeCloseTo(labelWidthPx('Name'), 9)
  })
})

describe('zoomForScale', () => {
  it('keeps the same closeness on a phone and a laptop', () => {
    const laptop = zoomForScale(420, 1000, 1_737_400)
    const phone = zoomForScale(420, 420, 1_737_400)
    // Pixels across the whole Moon are the same either way: the ground is as close.
    expect(laptop * 1000).toBeCloseTo(phone * 420, 6)
    expect(laptop).toBeCloseTo(8.27, 2)
  })
})

describe('stripLabels', () => {
  const bounds = { left: 30, right: 600, top: 8, bottom: 104 }
  const sun = (x: number, y: number, text = 'Sun') => ({ x, y, text, reach: 5 })
  const earth = (x: number, y: number, text = 'Earth') => ({ x, y, text, reach: 7 })
  const box = (label: { x: number; y: number }, text: string) => ({ left: label.x - stripLabelWidthPx(text) / 2, right: label.x + stripLabelWidthPx(text) / 2, top: label.y - 11, bottom: label.y })
  const apart = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top

  it('puts each name above its body when there is room', () => {
    const labels = stripLabels(sun(100, 60), earth(400, 50), bounds)
    expect(labels.sun).toEqual({ x: 100, y: 51 })
    expect(labels.earth).toEqual({ x: 400, y: 39 })
  })
  it('goes under a body that is at the top of the strip', () => {
    expect(stripLabels(sun(100, 60), earth(400, 12), bounds).earth.y).toBeGreaterThan(12)
  })
  it('keeps names inside the strip\'s edges', () => {
    const labels = stripLabels(sun(32, 60, 'Sun (hidden)'), earth(598, 50, 'Earth (hidden)'), bounds)
    expect(box(labels.sun, 'Sun (hidden)').left).toBeGreaterThanOrEqual(bounds.left)
    expect(box(labels.earth, 'Earth (hidden)').right).toBeLessThanOrEqual(bounds.right)
  })
  it('puts the names side by side when the bodies are close, in the bodies\' order', () => {
    for (const [sunX, earthX] of [[300, 310], [310, 300], [300, 300], [34, 40], [596, 590]]) {
      const labels = stripLabels(sun(sunX, 60, 'Sun (hidden)'), earth(earthX, 58, 'Earth (hidden)'), bounds)
      const a = box(labels.sun, 'Sun (hidden)')
      const b = box(labels.earth, 'Earth (hidden)')
      expect(apart(a, b)).toBe(true)
      expect(Math.min(a.left, b.left)).toBeGreaterThanOrEqual(bounds.left)
      expect(Math.max(a.right, b.right)).toBeLessThanOrEqual(bounds.right)
      if (sunX < earthX) expect(labels.sun.x).toBeLessThan(labels.earth.x)
      if (sunX > earthX) expect(labels.sun.x).toBeGreaterThan(labels.earth.x)
    }
  })
})

describe('placeLabels', () => {
  const at = (key: string, x: number, y: number, text = key) => ({ key, x, y, text, reach: 12 })

  it('prints a name under its marker where there is room', () => {
    expect(placeLabels([at('a', 100, 100), at('b', 300, 100)], 500)).toEqual(new Map([['a', 'below'], ['b', 'below']]))
  })

  it('moves the selected site\'s name to another side when another site\'s dot is under it, and always shows it', () => {
    // Close on the pole: the selected site, with a neighbour 20 px to the left and 13 px down.
    const placed = placeLabels([{ ...at('selected', 300, 285, 'Shackleton Rim'), must: true }, at('neighbour', 280, 298, 'Connecting Ridge')], 600)
    expect(placed.get('selected')).toBe('above')
    // The neighbour's own name still goes under the neighbour, clear of the selected site's.
    expect(placed.get('neighbour')).toBe('below')
    const mine = labelBoxAt({ ...at('selected', 300, 285, 'Shackleton Rim') }, 'above')
    expect(mine.bottom).toBeLessThanOrEqual(285 - 12)
  })

  it('shows the selected site\'s name even when every side is crowded', () => {
    const crowd = [at('n', 300, 262), at('s', 300, 318), at('e', 345, 290), at('w', 255, 290)]
    expect(placeLabels([{ ...at('selected', 300, 290, 'A site'), must: true }, ...crowd], 600).has('selected')).toBe(true)
  })

  it('keeps a group\'s name under it, or hides it', () => {
    const placed = placeLabels([{ ...at('group', 100, 100, '4 sites'), reach: 18, sides: ['below'] }, at('dot', 100, 132)], 500)
    expect(placed.has('group')).toBe(false)
  })

  it('never prints one name over another', () => {
    const marks = [at('a', 100, 100, 'A long name here'), at('b', 130, 100, 'Another long name')]
    const placed = placeLabels(marks, 500)
    const boxes = marks.filter((mark) => placed.has(mark.key)).map((mark) => labelBoxAt(mark, placed.get(mark.key)!))
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) expect(boxes[i].left >= boxes[j].right || boxes[j].left >= boxes[i].right || boxes[i].top >= boxes[j].bottom || boxes[j].top >= boxes[i].bottom).toBe(true)
  })
})

