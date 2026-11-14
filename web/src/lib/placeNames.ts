import type { MoonFeatures } from '../data/contract'
import { DOT_REACH_PX, GROUP_REACH_PX, labelBoxAt, type LabelSide } from './sightlineDots'

/**
 * The "Place names" layer: which of the Moon's named places are printed, and where, so that no
 * name lies on another, on a site's marker or on a site's own name. The names are the IAU's, with
 * the earlier landings the site list does not hold; they are for finding the way round the Moon,
 * and nothing is worked out from them.
 */

/** A rectangle on the globe's square, in pixels. */
export interface NameBox {
  left: number
  right: number
  top: number
  bottom: number
}

/** A name with its place on the globe's square, in pixels: the middle of where it is printed. */
export interface PlacedName {
  key: string
  text: string
  /** What it names, for its colour: a sea, a crater, a valley, mountains or an earlier landing. */
  kind: string
  x: number
  y: number
}

/** A site's marker as the layer needs it: where it is, what is printed by it, and on which side. */
export interface NamedMarker {
  x: number
  y: number
  text: string
  /** Whether its name is printed. */
  label: boolean
  labelSide?: LabelSide
  /** More than one site stands under a group's marker, which is larger. */
  sites: unknown[]
}

/** Names are not printed this near the rim, where the ground turns away and they would crowd. */
export const MIN_FACING = 0.25
/** The size the names are printed at (placeNames.css), for working out the room one takes. */
const CHAR_PX = 5.8
const HEIGHT_PX = 13
const GAP_PX = 3

/** The room a printed name takes, with a little air round it. */
export function nameBox(name: { text: string; x: number; y: number }): NameBox {
  const halfW = (name.text.length * CHAR_PX) / 2 + GAP_PX
  const halfH = HEIGHT_PX / 2 + GAP_PX
  return { left: name.x - halfW, right: name.x + halfW, top: name.y - halfH, bottom: name.y + halfH }
}

/** The room the site markers take: each marker's own shape, and its name where one is printed. */
export function markerBoxes(markers: NamedMarker[]): NameBox[] {
  return markers.flatMap((marker) => {
    const reach = marker.sites.length > 1 ? GROUP_REACH_PX : DOT_REACH_PX
    const own = { left: marker.x - reach, right: marker.x + reach, top: marker.y - reach, bottom: marker.y + reach }
    return marker.label ? [own, labelBoxAt({ key: '', x: marker.x, y: marker.y, text: marker.text, reach }, marker.labelSide ?? 'below')] : [own]
  })
}

const overlap = (a: NameBox, b: NameBox) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/**
 * The names that fit, in the order given: a name is left out when any of it would leave the Moon's
 * disc (`discPx` across, in the middle of the square) or the square itself, or lie on room already
 * taken (the site markers and their names), or on a name printed before it.
 */
export function fitNames(candidates: PlacedName[], sizePx: number, taken: NameBox[], discPx = sizePx * Math.SQRT2): PlacedName[] {
  const used = [...taken]
  const middle = sizePx / 2
  const onDisc = (x: number, y: number) => Math.hypot(x - middle, y - middle) <= discPx / 2
  return candidates.filter((name) => {
    const box = nameBox(name)
    if (box.left < 0 || box.right > sizePx || box.top < 0 || box.bottom > sizePx) return false
    if (!(onDisc(box.left, box.top) && onDisc(box.right, box.top) && onDisc(box.left, box.bottom) && onDisc(box.right, box.bottom))) return false
    if (used.some((other) => overlap(box, other))) return false
    used.push(box)
    return true
  })
}

/**
 * Every place that faces the viewer, as candidates in the order they are given room: the earlier
 * landings first, then the named features, widest first. `place` is the globe's own camera: where
 * a latitude and longitude lies on the disc (-1 to 1 each way, y up) and how squarely it faces us;
 * `zoom` and `sizePx` are the globe's.
 */
export function nameCandidates(features: MoonFeatures, place: (lat: number, lon: number) => { x: number; y: number; facing: number }, zoom: number, sizePx: number): PlacedName[] {
  const at = (key: string, text: string, kind: string, lat: number, lon: number): PlacedName[] => {
    const p = place(lat, lon)
    if (p.facing < MIN_FACING) return []
    return [{ key, text, kind, x: ((p.x * zoom + 1) / 2) * sizePx, y: ((1 - p.y * zoom) / 2) * sizePx }]
  }
  const widest = [...features.names].sort((a, b) => b.diameter_km - a.diameter_km)
  return [...features.landings.flatMap((landing) => at(`l:${landing.name}`, landing.name, 'landing', landing.lat, landing.lon)), ...widest.flatMap((name) => at(`n:${name.name}`, name.name, name.kind, name.lat, name.lon))]
}
