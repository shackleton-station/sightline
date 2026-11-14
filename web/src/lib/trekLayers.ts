/**
 * The Moon Trek layers the Sightline screen can lay over the ground around the south pole.
 *
 * Every name, title and extent here was read from Moon Trek's own services on 2026-11-13: the
 * catalogue (`/moon/TrekServices/ws/index/polar/searchItems`), each layer's abstract
 * (`/moon/TrekWS/rest/cat/abstract?label=`) and its WMTS capabilities file. Trek's south-pole tiles
 * are 256 px squares in polar stereographic (IAU2000:30120) with the pole in the middle, 0° E up and
 * 90° E to the right; level 0 is one tile 2,191,860 m wide and each level halves that.
 *
 * Trek publishes no legend with its tiles, so `says` claims only what the layer's abstract supports.
 */

/** Width of the one tile at level 0, in metres: 256 px at 8,561.953125 m (the capabilities file's scale). */
export const TREK_LEVEL0_WIDTH_M = 2_191_860
const TILE_PX = 256

export type TrekLayerId = 'photo' | 'steep' | 'shadow' | 'sunlight' | 'earth' | 'temperature'

export interface TrekLayer {
  id: TrekLayerId
  /** The switch's name. */
  label: string
  /** How to read it, in one line. */
  says: string
  /** Trek's name for the product, as its tile addresses spell it, and its own title. */
  product: string
  title: string
  /** The deepest level Trek serves that is no finer than the stage can show (268 m a pixel at level 5). */
  level: number
  /** Tiles along each side of the square taken from the middle of that level. */
  tiles: 2 | 4
  /**
   * How the picture is put on the Moon: as it is; as one colour wherever the picture has anything;
   * or as one colour, as bright as the picture.
   */
  paint: 'picture' | 'mask' | 'ramp'
  /** That colour, 0 to 1. Gold is the Sun and blue is Earth, as everywhere on the screen. */
  tint?: [number, number, number]
  /** How much of the Moon underneath it hides, 0 to 1. */
  opacity: number
  /**
   * The finest level Moon Trek serves for it (asked of Trek on 2026-11-13, tile by tile), and, where a
   * sharper product takes over close up, that product with its own title and finest level.
   */
  finestLevel: number
  closeUp?: { product: string; title: string; fromLevel: number; finestLevel: number }
}

export const TREK_LAYERS: TrekLayer[] = [
  {
    id: 'photo',
    label: 'Photo',
    says: 'Real photos from the LRO camera, out to 85.5° S.',
    product: 'LRO_NAC_AvgMosaic_SPole855_1mp',
    title: 'LRO LROC NAC Image Mosaic, S Pole, Avg Merge',
    level: 5,
    tiles: 4,
    paint: 'picture',
    opacity: 1,
    finestLevel: 11,
    // Past 4 m a pixel the averaged mosaic stops; the 1 m mosaic goes one level further (2 m a pixel as tiles).
    closeUp: { product: 'LRO_NAC_Mosaic_1mpp_SP', title: 'LRO NAC Mosaic 1mpp, S Pole', fromLevel: 12, finestLevel: 12 },
  },
  {
    id: 'steep',
    label: 'Steep ground',
    says: 'Colored ground slopes less than 15°. Ground left bare is steeper, or beyond 87.5° S.',
    product: 'ColorSlope_15below_LRO_LOLA_DEM_SPole875_5m',
    title: 'LRO LOLA Color Slope < 15 deg, S Pole, 87.5 deg',
    level: 5,
    tiles: 4,
    paint: 'picture',
    opacity: 0.85,
    finestLevel: 10,
  },
  {
    id: 'shadow',
    label: 'Permanent shadow',
    says: 'Violet ground never sees the Sun. Drawn at about 1 km a pixel.',
    product: 'LRO_LOLA_Illumination_SPole65S_240m',
    title: 'LOLA Permanently Shadowed Regions Southpole 240m',
    level: 3,
    tiles: 2,
    paint: 'mask',
    tint: [0.65, 0.59, 1],
    opacity: 0.8,
    finestLevel: 3,
  },
  {
    id: 'sunlight',
    label: 'Long-run sunlight',
    says: 'Brighter gold was sunlit in more of a year of LRO photos. Only within 2° of the pole.',
    product: 'WAC_POLE_ILL_TWI_SOUTH_100M',
    title: 'LRO WAC Time-Weighted Illumination 100mpp, S Pole',
    level: 5,
    tiles: 2,
    paint: 'ramp',
    tint: [1, 0.75, 0.3],
    opacity: 0.95,
    finestLevel: 5,
  },
  {
    id: 'earth',
    label: 'Long-run Earth view',
    says: 'Brighter blue sees Earth more of the time, averaged over 18.6 years. Out to 85° S.',
    product: 'AVGVISIB_85S_060M_201608_EARTH_SP',
    title: 'LRO LOLA Average Earth Visibility, 60 mpp, S Pole',
    level: 5,
    tiles: 4,
    paint: 'ramp',
    tint: [0.35, 0.66, 1],
    opacity: 0.95,
    finestLevel: 6,
  },
  {
    id: 'temperature',
    label: 'Temperature',
    says: 'Average surface temperature, in Moon Trek’s own colors. Trek gives no scale; the permanently shadowed craters, the coldest ground, are purple.',
    product: 'LRO_Diviner_Temp_Avg_Clr_SPole80_135mp',
    title: 'LRO DLRE Surface Temp Avg S Pole, Color',
    level: 4,
    tiles: 2,
    paint: 'picture',
    opacity: 0.85,
    finestLevel: 4,
  },
]

export function trekLayer(id: string | null): TrekLayer | null {
  return TREK_LAYERS.find((layer) => layer.id === id) ?? null
}

/** Half the width of the square of ground a layer's picture covers, in metres from the pole. */
export function trekHalfWidthM(layer: TrekLayer): number {
  return ((layer.tiles / 2) * TREK_LEVEL0_WIDTH_M) / 2 ** layer.level
}

/** Metres of ground in one pixel of a layer's picture. */
export function trekMetresPerPixel(layer: TrekLayer): number {
  return TREK_LEVEL0_WIDTH_M / 2 ** layer.level / TILE_PX
}

/** The tiles of a layer's picture: each one's address and where its top-left corner goes, in pixels. */
export function trekTiles(layer: TrekLayer): { url: string; x: number; y: number }[] {
  // The pole is where the four middle tiles meet.
  const first = 2 ** layer.level / 2 - layer.tiles / 2
  const tiles = []
  for (let row = 0; row < layer.tiles; row += 1) {
    for (let col = 0; col < layer.tiles; col += 1) {
      tiles.push({
        url: tileUrl(layer.product, layer.level, first + row, first + col),
        x: col * TILE_PX,
        y: row * TILE_PX,
      })
    }
  }
  return tiles
}

/** The picture's width and height in pixels. */
export function trekPicturePx(layer: TrekLayer): number {
  return layer.tiles * TILE_PX
}

/**
 * Moon Trek's tiles as the page asks for them: through the site's own CDN (`infra/trek.tf`), which
 * fetches a tile from NASA once and keeps it at the edge, so the next visitor gets it from there.
 */
const TILES_OURS = '/trek/'
/** The same tiles on NASA's own server. */
const TILES_NASA = 'https://trek.nasa.gov/tiles/Moon/'

/** A tile's address. */
function tileUrl(product: string, level: number, row: number, col: number): string {
  return `${TILES_OURS}SP/${product}/1.0.0/default/default028mm/${level}/${row}/${col}.png`
}

/** The same tile on NASA's own server: where the page asks when the site's route does not answer. */
export function trekDirectUrl(url: string): string {
  return url.startsWith(TILES_OURS) ? TILES_NASA + url.slice(TILES_OURS.length) : url
}

/** The Moon's radius Trek's south-pole map is drawn for, in metres. */
export const TREK_RADIUS_M = 1_737_400

/** A point of the Moon on Trek's south-pole map, in metres: x toward 90° E, y toward 0° E. `direction` is a unit vector in the Moon's frame. */
export function trekGround(direction: readonly [number, number, number]): { x: number; y: number } {
  // Polar stereographic from the south pole, true at the pole.
  const k = (2 * TREK_RADIUS_M) / (1 - direction[2])
  return { x: k * direction[1], y: k * direction[0] }
}

/** The most tiles along one side of a close-up picture: 8 makes a 2048 px picture, the largest every graphics card takes. */
const WINDOW_MAX_TILES = 8

/** A square cut from a tile, to be drawn enlarged to a whole tile's place: its corner and side, in the tile's pixels. */
export interface TileCrop {
  sx: number
  sy: number
  size: number
}

/**
 * Where the photo is finer than Moon Trek serves it: our own tiles of LROC's controlled 1 m mosaic,
 * cut for a disc of ground round each ridge site (pipeline/scripts/make_photo_tiles.py, which also
 * writes public/data/photo-fine.json, read here through data/finePhoto.ts). Same grid as Moon
 * Trek's, two levels deeper than Trek goes for this mosaic.
 */
export interface FinePhoto {
  /** The grid level of the tiles (13: 1.045 m a pixel). */
  level: number
  /** The discs: each centre on Moon Trek's south-pole map, in metres, and their radius. */
  discs: { x: number; y: number }[]
  radiusM: number
  /** The mosaic's title and credit line, as LROC gives them. */
  title: string
  credit: string
}

/** Our own tiles, in the bucket beside the terrain tiles, under a folder the load balancer already serves. */
const FINE_TILES = '/tiles/polar/photo/'
/** The most tiles along a side of a close-up made of our own tiles: they are small files, and the level is two below Trek's. */
const FINE_MAX_TILES = 12

/** Whether a point of Moon Trek's map (metres) is inside one of the discs our finer photo covers. */
export function inFinePhoto(fine: FinePhoto, x: number, y: number): boolean {
  return fine.discs.some((disc) => Math.hypot(disc.x - x, disc.y - y) <= fine.radiusM)
}

/** Whether a tile of the fine level has any ground inside a disc: the pipeline cut exactly those (its `touches_disc`). */
function fineTileExists(fine: FinePhoto, row: number, col: number): boolean {
  const tileM = TREK_LEVEL0_WIDTH_M / 2 ** fine.level
  const left = col * tileM - TREK_LEVEL0_WIDTH_M / 2
  const top = TREK_LEVEL0_WIDTH_M / 2 - row * tileM
  return fine.discs.some((disc) => {
    const nearX = Math.min(Math.max(disc.x, left), left + tileM)
    const nearY = Math.min(Math.max(disc.y, top - tileM), top)
    return Math.hypot(nearX - disc.x, nearY - disc.y) <= fine.radiusM
  })
}

export interface TrekWindow {
  /** The product and level the tiles come from, and Trek's title for that product. */
  product: string
  title: string
  level: number
  /**
   * The tiles, each with where its top-left corner goes in the picture, in pixels. A tile with
   * `crop` is a square of a coarser tile drawn enlarged in its place. `or` is what to draw if the
   * tile does not arrive: the same ground from Moon Trek's own tiles of the same mosaic.
   */
  tiles: { url: string; x: number; y: number; crop?: TileCrop; or?: { url: string; crop: TileCrop } }[]
  widthPx: number
  heightPx: number
  /** The picture's middle on Trek's map and its half width and half height, in metres. */
  centreXM: number
  centreYM: number
  halfWidthM: number
  halfHeightM: number
  /** Metres of ground in one of its pixels. */
  metresPerPixel: number
}

/**
 * The close-up picture for a view: the tiles that cover a circle of ground `reachM` around the
 * point in the middle of the screen, at the level whose pixels best match the screen's
 * (`screenMPerPx` metres of ground a screen pixel). Null when the layer's whole-cap picture is
 * already as sharp as the screen, or the view is nowhere near the layer.
 */
export function trekWindow(layer: TrekLayer, middle: { x: number; y: number }, reachM: number, screenMPerPx: number, fine: FinePhoto | null = null): TrekWindow | null {
  // Over a disc of our own finer photo, the photo layer goes on to that level.
  const deeper = fine !== null && layer.id === 'photo' && fine.level > layer.finestLevel && inFinePhoto(fine, middle.x, middle.y) ? fine : null
  const finest = deeper ? deeper.level : (layer.closeUp?.finestLevel ?? layer.finestLevel)
  // The level whose pixels are between about 0.65 and 1.3 screen pixels: sharp, without asking for four times the tiles.
  const wanted = Math.floor(Math.log2(TREK_LEVEL0_WIDTH_M / TILE_PX / screenMPerPx) + 0.4)
  let level = Math.min(finest, wanted)
  // The picture must cover the ground in view, and holds at most so many tiles a side: on a very
  // large screen that means a level coarser, not a picture cut short.
  const most = (at: number) => (deeper && at === deeper.level ? FINE_MAX_TILES : WINDOW_MAX_TILES)
  while (level > layer.level && (2 * reachM) / (TREK_LEVEL0_WIDTH_M / 2 ** level) > most(level) - 1) level -= 1
  // Over a disc, Moon Trek's own close-up product is passed over: it is another mosaic, which sits
  // about 300 m from this one (measured 2026-11-14 at Peak near Shackleton), so the ground would
  // jump under the site's marker on the way in. Ours takes its place as soon as the view is small
  // enough for our tiles to cover it; until then the layer's own mosaic is kept.
  if (deeper && layer.closeUp && level >= layer.closeUp.fromLevel && level < deeper.level) {
    const fits = (2 * reachM) / (TREK_LEVEL0_WIDTH_M / 2 ** deeper.level) <= FINE_MAX_TILES - 1
    level = fits ? deeper.level : layer.closeUp.fromLevel - 1
  }
  if (level <= layer.level) return null
  const tileM = TREK_LEVEL0_WIDTH_M / 2 ** level
  const half = TREK_LEVEL0_WIDTH_M / 2
  const count = 2 ** level
  const clamp = (index: number) => Math.max(0, Math.min(count - 1, index))
  const reach = reachM
  const col0 = clamp(Math.floor((middle.x - reach + half) / tileM))
  const col1 = clamp(Math.floor((middle.x + reach + half) / tileM))
  const row0 = clamp(Math.floor((half - (middle.y + reach)) / tileM))
  const row1 = clamp(Math.floor((half - (middle.y - reach)) / tileM))
  // Outside the layer's own cap there is nothing to fetch.
  const capM = trekHalfWidthM(layer)
  if (Math.abs(middle.x) - reach > capM || Math.abs(middle.y) - reach > capM) return null
  const ours = deeper && level === deeper.level ? deeper : null
  const use = ours ? { product: 'NAC_POLE_SOUTH_CM_AVG', title: ours.title } : layer.closeUp && level >= layer.closeUp.fromLevel ? layer.closeUp : layer
  const tiles: TrekWindow['tiles'] = []
  // Under each of our tiles is the same ground in Moon Trek's finest tile of the same mosaic: a
  // square of it, enlarged, stands in where we have no tile, and for one that does not arrive.
  const up = ours ? ours.level - layer.finestLevel : 0
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      const at = { x: (col - col0) * TILE_PX, y: (row - row0) * TILE_PX }
      if (!ours) {
        tiles.push({ url: tileUrl(use.product, level, row, col), ...at })
        continue
      }
      const size = TILE_PX >> up
      const under = { url: tileUrl(layer.product, layer.finestLevel, row >> up, col >> up), crop: { sx: (col & ((1 << up) - 1)) * size, sy: (row & ((1 << up) - 1)) * size, size } }
      if (fineTileExists(ours, row, col)) tiles.push({ url: `${FINE_TILES}${ours.level}/${row}/${col}.jpg`, ...at, or: under })
      else tiles.push({ ...under, ...at })
    }
  }
  const cols = col1 - col0 + 1
  const rows = row1 - row0 + 1
  return {
    product: use.product,
    title: use.title,
    level,
    tiles,
    widthPx: cols * TILE_PX,
    heightPx: rows * TILE_PX,
    centreXM: (col0 + cols / 2) * tileM - half,
    centreYM: half - (row0 + rows / 2) * tileM,
    halfWidthM: (cols * tileM) / 2,
    halfHeightM: (rows * tileM) / 2,
    metresPerPixel: tileM / TILE_PX,
  }
}

/** A name for a window's picture: two windows with the same name are the same picture. */
export function trekWindowKey(window: TrekWindow): string {
  return `${window.product}/${window.level}/${window.tiles[0].url.split('/').slice(-2).join('/')}/${window.widthPx}x${window.heightPx}`
}

/**
 * The closest the screen may show a layer, in metres of ground a screen pixel: its finest pixels, a
 * little enlarged. `level` is for ground with finer tiles than the layer's own (a `FinePhoto`'s).
 */
export function trekClosestMPerPx(layer: TrekLayer, level: number = layer.closeUp?.finestLevel ?? layer.finestLevel): number {
  return TREK_LEVEL0_WIDTH_M / 2 ** level / TILE_PX / 1.5
}

