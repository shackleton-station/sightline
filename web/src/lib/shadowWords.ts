import type { ShadowAnswer, ShadowDistances } from '../data/contract'

/**
 * How Compare writes a site's distance to permanently shadowed ground: a bare number in the cell
 * (the row's name carries the unit), or "none" where NASA's maps hold none to measure to, with the
 * sentence that says how far that is known.
 */
export interface ShadowCell {
  /** What the table's cell holds: "0.1", "39", or "none". */
  cell: string
  /** The same in a sentence part, for under the table and for the cell's hover text: "0.1 km", "none mapped within 1,951 km". */
  words: string
  /** Whether the cell needs its sentence shown under the table (it holds no number). */
  explain: boolean
}

/** A distance to one decimal under ten kilometres, whole above: the maps' pixels are 60 to 240 m. */
function km(distance: number): string {
  return distance < 10 ? distance.toFixed(1) : Math.round(distance).toLocaleString('en-US')
}

/** One answer of `shadow.json` as Compare writes it. */
export function shadowCell(answer: ShadowAnswer): ShadowCell {
  if (answer.status === 'found') return { cell: km(answer.distance_km), words: `${km(answer.distance_km)} km`, explain: false }
  const within = answer.status === 'none_within' ? answer.within_km : answer.map_edge_km
  return { cell: 'none', words: `none mapped within ${km(within)} km`, explain: true }
}

/** The row's hover text: what the ground is, how the distance is measured, and whose map it is. */
export function shadowMeans(shadow: ShadowDistances): string {
  return `${shadow.what} ${shadow.measure} Source: ${shadow.source.name} (${shadow.source.cite}).`
}
