import { type TileCrop, TREK_RADIUS_M } from './trekLayers'

/**
 * The Moon's own picture, sharper as the view closes in on a site: Moon Trek's pictures of the
 * ground, streamed as tiles through the site's /trek/ route (infra/trek.tf).
 *
 * These are whole-Moon and regional pictures on Moon Trek's equirectangular grid: level z is
 * 2^(z+1) tiles round the Moon and 2^z from pole to pole, 256 pixels each, so a tile is 180/2^z
 * degrees a side. Read from each product's own WMTS capabilities file on 2026-11-14, and a real
 * tile fetched at every site:
 *
 *  - the whole Moon, LROC's WAC mosaic, to level 8: 83 m of ground a pixel;
 *  - seven regions round landing sites, LRO NAC mosaics, to level 15 (0.65 m) or 13 (2.6 m).
 *
 * Moon Trek also serves a whole-Moon Kaguya Terrain Camera mosaic to level 10 (21 m). It is not
 * used: measured against the NAC mosaics on 2026-11-14 it sits 100 to 190 m from them, five to
 * nine of its own pixels, and the sites' markers are in the NAC pictures' frame.
 *
 * Round the south pole this grid squeezes to nothing, so the four ridge sites use the polar
 * pictures instead (lib/trekLayers.ts): the same mosaic as the Photo layer, and our own 1 m tiles.
 */
export interface DetailSource {
  /** Moon Trek's name for the product, as its tile addresses spell it, and its own title. */
  product: string
  title: string
  ext: 'jpg' | 'png'
  /** The finest level Moon Trek serves for it. */
  maxLevel: number
  /** Its extent, in degrees: west, south, east, north. None for the whole Moon. */
  box?: readonly [number, number, number, number]
}

export const WAC: DetailSource = { product: 'LRO_WAC_Mosaic_Global_303ppd_v02', title: 'LRO WAC Mosaic v2', ext: 'jpg', maxLevel: 8 }

/** The regional pictures, each with Moon Trek's own title and the extent its capabilities file gives. */
export const REGIONAL: DetailSource[] = [
  { product: 'A11_60x60km.eq', title: 'LRO Narrow Angle Camera, Mosaic Apollo 11', ext: 'png', maxLevel: 15, box: [22.4806, -0.3193, 24.4593, 1.6593] },
  { product: 'A15_60x60km.0_2.eq', title: 'LRO Narrow Angle Camera, Mosaic Apollo 15', ext: 'png', maxLevel: 15, box: [2.6407, 25.1407, 4.6193, 27.1193] },
  { product: 'A17_60x60km.eq', title: 'LRO Narrow Angle Camera, Mosaic Apollo 17', ext: 'png', maxLevel: 15, box: [29.7806, 19.2006, 31.7593, 21.1793] },
  { product: 'LRO_NAC_ortho_horseshoeV2', title: 'LRO NAC Mosaic, Horseshoe in Mare Crisium', ext: 'png', maxLevel: 15, box: [61.392, 16.6078, 62.2275, 20.0913] },
  { product: 'LRO_NAC_Post_Landing_OrthoMosaic_1mpp_IM_1_LandingSite', title: 'LRO NAC Post-Landing Ortho Mosaic 1mpp, IM-1 Landing Site', ext: 'png', maxLevel: 13, box: [0.9387, -80.2164, 1.9392, -80.0428] },
  { product: 'LRO_NAC_Mosaic_0_82mpp_Shioli', title: 'LRO NAC Mosaic 0.82mpp, Shioli', ext: 'png', maxLevel: 15, box: [25.0601, -14.1732, 25.8437, -12.5873] },
  { product: 'LRO_NAC_Mosaic_50cmpp_VonKarman_v2', title: 'LRO NAC Mosaic 0.5mpp, Von Karman', ext: 'png', maxLevel: 15, box: [171.4493, -48.9294, 179.9243, -42.0188] },
]

/**
 * The regional pictures are not tied to the sites' coordinates: they are LRO NAC mosaics placed by
 * the spacecraft's own pointing, where the ridge sites' polar mosaic is tied to LOLA. Measured on
 * 2026-11-14 at the closest zoom, the lunar module is about 12 m from Apollo 11's marker and about
 * 10 m from Apollo 15's, and what looks like it about 45 m from Apollo 17's. So where one of these
 * pictures is under a marker and the view is close enough for that to show, the marker is drawn as
 * an open ring of this much ground, not as a dot claiming a point.
 */
export const UNTIED_GAP_M = 50
/** The view is that close from here: metres of ground a screen pixel. */
export const UNTIED_FROM_M_PER_PX = 5

const TILE_PX = 256
/** The most tiles along a side of one picture: 2,048 pixels. */
const MAX_TILES = 8
/** The coarsest level worth fetching: 666 m a pixel, about twice as sharp as the globe's own maps. */
const FIRST_LEVEL = 5
/** How many levels a missing regional tile may be stood in for by the whole-Moon picture (a square of it enlarged 16 times at most). */
const STAND_IN_LEVELS = 4

const east = (lonDeg: number) => ((((lonDeg + 180) % 360) + 360) % 360) - 180

/** Metres of ground, north to south, in one pixel of a level of the grid. */
export function detailMetresPerPixel(level: number): number {
  return (Math.PI * TREK_RADIUS_M) / (2 ** level * TILE_PX)
}

/** The regional picture that holds a point, or null where only the whole-Moon picture does. */
export function regionalAt(lonDeg: number, latDeg: number): DetailSource | null {
  const lon = east(lonDeg)
  return REGIONAL.find((source) => source.box && lon >= source.box[0] && lon <= source.box[2] && latDeg >= source.box[1] && latDeg <= source.box[3]) ?? null
}

/** The closest the screen may show the ground at a point: the finest pixels there are for it, a little enlarged. */
export function detailClosestMPerPx(lonDeg: number, latDeg: number): number {
  return detailMetresPerPixel((regionalAt(lonDeg, latDeg) ?? WAC).maxLevel) / 1.5
}

const tileUrl = (source: DetailSource, level: number, row: number, col: number) => `/trek/EQ/${source.product}/1.0.0/default/default028mm/${level}/${row}/${col}.${source.ext}`

export interface DetailWindow {
  product: string
  title: string
  level: number
  /** As a Moon Trek close-up's (lib/trekLayers `TrekWindow`): where each tile goes, and what stands in for one that does not arrive. */
  tiles: { url: string; x: number; y: number; crop?: TileCrop; or?: { url: string; crop: TileCrop } }[]
  widthPx: number
  heightPx: number
  /** The picture's middle, and half its width and height, in degrees of longitude and latitude. */
  lonDeg: number
  latDeg: number
  halfLonDeg: number
  halfLatDeg: number
  /** Metres of ground, north to south, in one of its pixels. */
  metresPerPixel: number
}

/**
 * The picture of the ground for a view: the tiles that cover `reachM` round a point, at the level
 * whose pixels best match the screen's (`screenMPerPx` metres of ground a screen pixel). Null while
 * the globe's own maps are as sharp as the screen, and within 3 degrees of a pole, where this grid
 * has no room.
 */
export function detailWindow(lonDeg: number, latDeg: number, reachM: number, screenMPerPx: number): DetailWindow | null {
  if (Math.abs(latDeg) > 87) return null
  const regional = regionalAt(lonDeg, latDeg)
  const finest = (regional ?? WAC).maxLevel
  const wanted = Math.floor(Math.log2((Math.PI * TREK_RADIUS_M) / TILE_PX / screenMPerPx) + 0.4)
  let level = Math.min(finest, wanted)
  const reachLatDeg = (reachM / TREK_RADIUS_M) * (180 / Math.PI)
  const reachLonDeg = reachLatDeg / Math.cos((latDeg * Math.PI) / 180)
  // The picture must cover the ground in view and holds at most MAX_TILES a side: a wide view takes a coarser level.
  while (level > FIRST_LEVEL && (2 * reachLonDeg) / (180 / 2 ** level) > MAX_TILES - 1) level -= 1
  if (level < FIRST_LEVEL) return null
  const source = regional && level > WAC.maxLevel ? regional : WAC
  const tileDeg = 180 / 2 ** level
  const rows = 2 ** level
  const cols = 2 ** (level + 1)
  const lon = east(lonDeg)
  const row0 = Math.max(0, Math.floor((90 - (latDeg + reachLatDeg)) / tileDeg))
  const row1 = Math.min(rows - 1, Math.floor((90 - (latDeg - reachLatDeg)) / tileDeg))
  // Columns are counted without wrapping, so a picture across 180 degrees stays in one piece.
  const col0 = Math.floor((lon - reachLonDeg + 180) / tileDeg)
  const col1 = Math.floor((lon + reachLonDeg + 180) / tileDeg)
  const up = level - WAC.maxLevel
  const tiles: DetailWindow['tiles'] = []
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      const real = ((col % cols) + cols) % cols
      const at = { x: (col - col0) * TILE_PX, y: (row - row0) * TILE_PX }
      // Where a regional tile does not arrive, the whole-Moon picture of the same ground stands in, if it is not too coarse to.
      const size = TILE_PX >> up
      const under =
        source !== WAC && up <= STAND_IN_LEVELS
          ? { url: tileUrl(WAC, WAC.maxLevel, row >> up, real >> up), crop: { sx: (real & ((1 << up) - 1)) * size, sy: (row & ((1 << up) - 1)) * size, size } }
          : undefined
      tiles.push({ url: tileUrl(source, level, row, real), ...at, ...(under ? { or: under } : {}) })
    }
  }
  const across = col1 - col0 + 1
  const down = row1 - row0 + 1
  return {
    product: source.product,
    title: source.title,
    level,
    tiles,
    widthPx: across * TILE_PX,
    heightPx: down * TILE_PX,
    lonDeg: (col0 + across / 2) * tileDeg - 180,
    latDeg: 90 - (row0 + down / 2) * tileDeg,
    halfLonDeg: (across * tileDeg) / 2,
    halfLatDeg: (down * tileDeg) / 2,
    metresPerPixel: detailMetresPerPixel(level),
  }
}

/** A name for a window's picture: two windows with the same name are the same picture. */
export function detailWindowKey(window: DetailWindow): string {
  return `${window.product}/${window.level}/${window.tiles[0].url.split('/').slice(-2).join('/')}/${window.widthPx}x${window.heightPx}`
}
