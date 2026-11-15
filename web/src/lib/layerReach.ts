import { cellAt, type LightMeta, wideGrid } from './lightGrid'
import { TREK_LAYERS, type TrekLayer, type TrekLayerId, trekGround, trekHalfWidthM } from './trekLayers'

/**
 * Which of the Layers panel's layers hold the ground at a place, worked out from what each layer
 * declares about itself: a Moon Trek map is a square round the south pole whose half-width follows
 * from its own tiles and level; "Light and shadow" and the terrain behind "Landings that
 * fit" are the app's light grid, whose description gives its own extent; place names are
 * printed all over the Moon. No latitude is written here.
 */
export interface LayersReach {
  /** Each Moon Trek map: whether its square holds the place. */
  trek: Record<TrekLayerId, boolean>
  /** The app's light grid (its fine square or the wider one round it); null until its description has arrived. */
  light: boolean | null
  /** Place names: all over the Moon. */
  names: true
}

const RAD = Math.PI / 180

/** Whether a Moon Trek map's picture holds a place: inside its square round the south pole. */
export function trekReaches(layer: TrekLayer, latDeg: number, lonDeg: number): boolean {
  // North of the equator the south-pole projection runs away to infinity: nothing there is on the map.
  if (latDeg >= 0) return false
  const lat = latDeg * RAD
  const lon = lonDeg * RAD
  const { x, y } = trekGround([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)])
  const half = trekHalfWidthM(layer)
  return Math.abs(x) <= half && Math.abs(y) <= half
}

/** Whether the app's light grid holds a place, in its fine square or the wider one; null until the grid's description has arrived. */
export function lightReaches(meta: LightMeta | null | undefined, latDeg: number, lonDeg: number): boolean | null {
  if (meta === undefined) return null
  if (meta === null) return false
  const wide = wideGrid(meta)
  return cellAt(meta, latDeg, lonDeg) !== null || (wide !== null && cellAt(wide, latDeg, lonDeg) !== null)
}

/** What reaches a place, layer by layer. */
export function layersReach(place: { lat: number; lon: number }, light: LightMeta | null | undefined): LayersReach {
  const trek = Object.fromEntries(TREK_LAYERS.map((layer) => [layer.id, trekReaches(layer, place.lat, place.lon)])) as Record<TrekLayerId, boolean>
  return { trek, light: lightReaches(light, place.lat, place.lon), names: true }
}

/** How far the app's light grid reaches from the pole (its wider square, where it has one), in whole km; null until its description has arrived. */
export function lightReachKm(meta: LightMeta | null | undefined): number | null {
  if (!meta) return null
  return Math.round((wideGrid(meta) ?? meta).half_width_m / 1000)
}

/** Whether at least one layer does something at the place: where none does, the Layers button has nothing to offer. */
export function anyLayerReaches(reach: LayersReach): boolean {
  return reach.names || reach.light === true || Object.values(reach.trek).some(Boolean)
}

/** How far a Moon Trek map reaches from the pole, in whole km, as its credit line says it. */
export function trekReachKm(layer: TrekLayer): number {
  return Math.round(trekHalfWidthM(layer) / 1000)
}
