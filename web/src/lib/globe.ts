/**
 * Geometry for the whole-Moon globe: an orthographic view, as if seen from far away.
 * Screen coordinates run -1..1 across the globe's disk, x to the right and y up.
 * Longitudes are degrees east (-180..180), as in MOON_ME: x toward 0°, y toward 90° E, z north.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** The point on the Moon at the center of the view. */
export interface GlobeView {
  lat: number
  lon: number
}

/** How far the view's center may tilt toward a pole, so north stays up. */
export const MAX_VIEW_LAT = 80

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/** Where a point lands on the disk, and whether it faces the viewer. */
export function project(
  latDeg: number,
  lonDeg: number,
  view: GlobeView,
): { x: number; y: number; facing: number } {
  const lat = latDeg * RAD
  const dLon = (lonDeg - view.lon) * RAD
  const lat0 = view.lat * RAD
  return {
    x: Math.cos(lat) * Math.sin(dLon),
    y: Math.cos(lat0) * Math.sin(lat) - Math.sin(lat0) * Math.cos(lat) * Math.cos(dLon),
    // Cosine of the angle from the view's center: above 0 on the near side.
    facing: Math.sin(lat0) * Math.sin(lat) + Math.cos(lat0) * Math.cos(lat) * Math.cos(dLon),
  }
}

/** The Moon point under a spot on the disk, or null outside it. */
export function unproject(x: number, y: number, view: GlobeView): { lat: number; lon: number } | null {
  const rho = Math.hypot(x, y)
  if (rho > 1) return null
  if (rho === 0) return { lat: view.lat, lon: wrapLon(view.lon) }
  const c = Math.asin(rho)
  const lat0 = view.lat * RAD
  const lat = Math.asin(Math.cos(c) * Math.sin(lat0) + (y * Math.sin(c) * Math.cos(lat0)) / rho)
  const lon =
    view.lon * RAD +
    Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(lat0) - y * Math.sin(c) * Math.sin(lat0))
  return { lat: lat * DEG, lon: wrapLon(lon * DEG) }
}

/** Turn the globe by a drag measured in disk units: dragging right brings western ground into view. */
export function dragView(view: GlobeView, dx: number, dy: number, maxLat = MAX_VIEW_LAT): GlobeView {
  const lat = Math.max(-maxLat, Math.min(maxLat, view.lat - dy * 90))
  return { lat, lon: wrapLon(view.lon - dx * 90) }
}

/** A good view of a site: polar sites are seen from a little toward the equator, so the pole shows. */
export function viewFor(latDeg: number, lonDeg: number): GlobeView {
  return { lat: Math.max(-MAX_VIEW_LAT, Math.min(MAX_VIEW_LAT, latDeg)), lon: wrapLon(lonDeg) }
}

/** Part of the way from one view to another, along the shorter way around in longitude. */
export function blendView(from: GlobeView, to: GlobeView, t: number): GlobeView {
  const dLon = wrapLon(to.lon - from.lon)
  return { lat: from.lat + (to.lat - from.lat) * t, lon: wrapLon(from.lon + dLon * t) }
}

/** CSS position for a disk point, as percentages of the globe's box. */
export function diskStyle(x: number, y: number): { left: string; top: string } {
  return { left: `${((x + 1) / 2) * 100}%`, top: `${((1 - y) / 2) * 100}%` }
}

export interface LabelCandidate {
  key: string
  text: string
  /** Disk position, -1..1. */
  x: number
  y: number
}

/** Rough label size in pixels, for a 10–11 px system font. */
const CHAR_PX = 5.6
const LABEL_H_PX = 13
const LABEL_GAP_PX = 2

/**
 * Which labels fit: earlier candidates win, a label that would overlap one already placed is
 * skipped, and so is one that would spill past the globe's box.
 */
export function fitLabels(candidates: LabelCandidate[], sizePx: number): Set<string> {
  const placed: { left: number; right: number; top: number; bottom: number }[] = []
  const kept = new Set<string>()
  for (const label of candidates) {
    const cx = ((label.x + 1) / 2) * sizePx
    const cy = ((1 - label.y) / 2) * sizePx
    const halfW = (label.text.length * CHAR_PX) / 2 + LABEL_GAP_PX
    const halfH = LABEL_H_PX / 2 + LABEL_GAP_PX
    const box = { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH }
    if (box.left < 0 || box.right > sizePx || box.top < 0 || box.bottom > sizePx) continue
    const hits = placed.some(
      (p) => box.left < p.right && box.right > p.left && box.top < p.bottom && box.bottom > p.top,
    )
    if (hits) continue
    placed.push(box)
    kept.add(label.key)
  }
  return kept
}

/** How far in the globe can zoom: 1 fits the whole Moon in the box. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return Math.min(max, Math.max(min, zoom))
}

/** A disk point on the canvas at a zoom: -1..1 across the box, and whether it's inside the box. */
export function toCanvas(p: { x: number; y: number }, zoom: number): { x: number; y: number; inside: boolean } {
  const x = p.x * zoom
  const y = p.y * zoom
  return { x, y, inside: Math.abs(x) <= 1 && Math.abs(y) <= 1 }
}

/** Angle between two points on the Moon, in degrees. */
export function angularDistanceDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const la = a.lat * RAD
  const lb = b.lat * RAD
  const cos =
    Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos((b.lon - a.lon) * RAD)
  return Math.acos(Math.min(1, Math.max(-1, cos))) * DEG
}

/** The site nearest the view's center, if one is within `maxDeg`. */
export function siteAtCenter<T extends { lat: number; lon: number }>(
  sites: T[],
  view: GlobeView,
  maxDeg: number,
): T | null {
  let best: T | null = null
  let bestDeg = maxDeg
  for (const site of sites) {
    const deg = angularDistanceDeg(view, site)
    if (deg <= bestDeg) {
      best = site
      bestDeg = deg
    }
  }
  return best
}
