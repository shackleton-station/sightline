/**
 * Where Sightline's site markers and their names go on the Moon. Sites that would print over one
 * another at the zoom on show become one group marker; a name shows only where it lies clear of
 * every other name and marker. All positions are pixels on the globe's square.
 */

/** A marker's place on the globe's square, in pixels from its top left corner. */
export interface Placed {
  x: number
  y: number
}

/** How far a marker's own shape reaches from its center, in pixels: a dot is 14 px across plus its edge, a group marker 26 px. */
export const DOT_SHAPE_PX = 9
export const GROUP_SHAPE_PX = 13
/** How far a marker reaches from its center, with its ring or outline: a single dot, and a group. */
export const DOT_REACH_PX = 12
export const GROUP_REACH_PX = 18
/** A name sits this far under its marker's reach, and is this tall. */
export const LABEL_GAP_PX = 3
export const LABEL_HEIGHT_PX = 16
/** A name's width for its text, generous for an 11 px system font so real names never run wider. */
export function labelWidthPx(text: string): number {
  return text.length * 6.6 + 10
}

/**
 * Markers gathered into groups that would overlap as they are drawn. Two dots closer than their two
 * shapes share a group; a group's marker is bigger than a dot and sits in the middle of its members,
 * so anything that would then lie under that bigger marker joins it too, and so on until nothing
 * drawn touches anything else. Groups come in the order of their first member, and members keep
 * their order.
 */
export function groupOverlapping<T extends Placed>(marks: T[], dotShapePx = DOT_SHAPE_PX, groupShapePx = GROUP_SHAPE_PX): T[][] {
  let groups = marks.map((_, i) => [i])
  const shape = (group: number[]) => (group.length === 1 ? dotShapePx : groupShapePx)
  const middle = (group: number[]) => middleOf(group.map((i) => marks[i]))
  for (let merged = true; merged; ) {
    merged = false
    search: for (let a = 0; a < groups.length; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        const [p, q] = [middle(groups[a]), middle(groups[b])]
        if (Math.hypot(p.x - q.x, p.y - q.y) >= shape(groups[a]) + shape(groups[b])) continue
        groups = [...groups.slice(0, a), [...groups[a], ...groups[b]].sort((i, j) => i - j), ...groups.slice(a + 1, b), ...groups.slice(b + 1)]
        merged = true
        break search
      }
    }
  }
  return groups.sort((a, b) => a[0] - b[0]).map((group) => group.map((i) => marks[i]))
}

/** The middle of a group: where its one marker goes. */
export function middleOf(marks: Placed[]): Placed {
  return { x: marks.reduce((sum, mark) => sum + mark.x, 0) / marks.length, y: marks.reduce((sum, mark) => sum + mark.y, 0) / marks.length }
}

export interface Labelled extends Placed {
  key: string
  /** The name as it will be printed. */
  text: string
  /** How far the marker reaches from its center, in pixels. */
  reach: number
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/** Where a marker's name is printed: centered under it. */
export function labelBox(mark: Labelled): Box {
  const half = labelWidthPx(mark.text) / 2
  const top = mark.y + mark.reach + LABEL_GAP_PX
  return { left: mark.x - half, right: mark.x + half, top, bottom: top + LABEL_HEIGHT_PX }
}

/**
 * Which names show. They are tried in the order given (so put the selected site first, then
 * groups), and one shows only if it lies clear of every name already showing, of every other
 * marker, and of the edges of the square. The rest stay hidden until hover or focus.
 */
export function clearLabels(marks: Labelled[], sizePx: number): Set<string> {
  const markers = marks.map((mark) => ({ key: mark.key, box: { left: mark.x - mark.reach, right: mark.x + mark.reach, top: mark.y - mark.reach, bottom: mark.y + mark.reach } }))
  const showing: Box[] = []
  const kept = new Set<string>()
  for (const mark of marks) {
    const box = labelBox(mark)
    if (box.left < 0 || box.right > sizePx || box.top < 0 || box.bottom > sizePx) continue
    if (showing.some((other) => overlaps(box, other))) continue
    if (markers.some((marker) => marker.key !== mark.key && overlaps(box, marker.box))) continue
    showing.push(box)
    kept.add(mark.key)
  }
  return kept
}

/** Which side of its marker a name is printed on. */
export type LabelSide = 'below' | 'above' | 'right' | 'left'
const SIDES: LabelSide[] = ['below', 'above', 'right', 'left']

/** Where a marker's name is printed on a given side of it. */
export function labelBoxAt(mark: Labelled, side: LabelSide): Box {
  const width = labelWidthPx(mark.text)
  const out = mark.reach + LABEL_GAP_PX
  if (side === 'below') return labelBox(mark)
  if (side === 'above') return { left: mark.x - width / 2, right: mark.x + width / 2, top: mark.y - out - LABEL_HEIGHT_PX, bottom: mark.y - out }
  const top = mark.y - LABEL_HEIGHT_PX / 2
  return side === 'right' ? { left: mark.x + out, right: mark.x + out + width, top, bottom: top + LABEL_HEIGHT_PX } : { left: mark.x - out - width, right: mark.x - out, top, bottom: top + LABEL_HEIGHT_PX }
}

/**
 * Which names show, and on which side of their markers. They are tried in the order given (the
 * selected site first, then groups). A name takes the first side, of those it may use, where it
 * lies clear of every name already showing, of every other marker and of the edges of the square;
 * with no such side it stays hidden until hover or focus. A mark that `must` show always does: on
 * the first side clear of the other markers, so its name is never under another site's dot and
 * cannot be read as another site's.
 */
export function placeLabels(marks: (Labelled & { must?: boolean; sides?: LabelSide[] })[], sizePx: number): Map<string, LabelSide> {
  const markers = marks.map((mark) => ({ key: mark.key, box: { left: mark.x - mark.reach, right: mark.x + mark.reach, top: mark.y - mark.reach, bottom: mark.y + mark.reach } }))
  const showing: Box[] = []
  const placed = new Map<string, LabelSide>()
  for (const mark of marks) {
    const sides = mark.sides ?? SIDES
    const inside = (box: Box) => box.left >= 0 && box.right <= sizePx && box.top >= 0 && box.bottom <= sizePx
    const offMarkers = (box: Box) => !markers.some((marker) => marker.key !== mark.key && overlaps(box, marker.box))
    const offNames = (box: Box) => !showing.some((other) => overlaps(box, other))
    const side =
      sides.find((candidate) => { const box = labelBoxAt(mark, candidate); return inside(box) && offMarkers(box) && offNames(box) }) ??
      (mark.must ? (sides.find((candidate) => { const box = labelBoxAt(mark, candidate); return inside(box) && offMarkers(box) }) ?? sides.find((candidate) => offMarkers(labelBoxAt(mark, candidate))) ?? sides[0]) : undefined)
    if (!side) continue
    showing.push(labelBoxAt(mark, side))
    placed.set(mark.key, side)
  }
  return placed
}

/**
 * The camera zoom at which the ground is drawn at `metresPerPx`, on a globe square `sidePx` across
 * (zoom 1 fits the whole Moon in the square). Keeps "close on a site" the same closeness on a phone
 * and a laptop, so sites that separate on one separate on the other.
 */
export function zoomForScale(metresPerPx: number, sidePx: number, moonRadiusM: number): number {
  return sidePx > 0 ? (2 * moonRadiusM) / (metresPerPx * sidePx) : 1
}

interface TextMark extends Placed {
  /** The words, for their width. */
  text: string
}

/** A label's place in the skyline strip: the middle of its text, and its baseline. */
export interface StripLabel {
  x: number
  y: number
}

/** A strip label's width for its text, generous for a 10 px font. */
export function stripLabelWidthPx(text: string): number {
  return text.length * 6 + 6
}

/**
 * Where the Sun's and Earth's names go in the skyline strip. Each sits above its body, or under it
 * when there is no room above, and is kept inside the strip's edges. If the two would then overlap
 * they are put side by side instead, in the bodies' own left-to-right order.
 */
export function stripLabels(
  sun: TextMark & { reach: number },
  earth: TextMark & { reach: number },
  bounds: { left: number; right: number; top: number; bottom: number },
): { sun: StripLabel; earth: StripLabel } {
  const HEIGHT = 11
  const place = (mark: TextMark & { reach: number }): StripLabel => {
    const half = stripLabelWidthPx(mark.text) / 2
    const above = mark.y - mark.reach - 4
    // A baseline this high would put the text over the strip's top edge: go under the body.
    const y = above - HEIGHT < bounds.top ? Math.min(mark.y + mark.reach + HEIGHT + 1, bounds.bottom) : above
    return { x: Math.min(Math.max(mark.x, bounds.left + half), bounds.right - half), y }
  }
  const a = place(sun)
  const b = place(earth)
  const halfA = stripLabelWidthPx(sun.text) / 2
  const halfB = stripLabelWidthPx(earth.text) / 2
  const clash = Math.abs(a.x - b.x) < halfA + halfB + 4 && Math.abs(a.y - b.y) < HEIGHT + 2
  if (!clash) return { sun: a, earth: b }
  // Side by side on one line, meeting at the point between the bodies, moved in from an edge if need be.
  const sunFirst = sun.x <= earth.x
  const [halfLeft, halfRight] = sunFirst ? [halfA, halfB] : [halfB, halfA]
  const gap = 3
  const meet = Math.min(Math.max((sun.x + earth.x) / 2, bounds.left + 2 * halfLeft + gap), bounds.right - 2 * halfRight - gap)
  const y = Math.min(a.y, b.y)
  const left = { x: meet - gap - halfLeft, y }
  const right = { x: meet + gap + halfRight, y }
  return sunFirst ? { sun: left, earth: right } : { sun: right, earth: left }
}
