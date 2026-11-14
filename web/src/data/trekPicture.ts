import { type TileCrop, type TrekLayer, type TrekWindow, trekDirectUrl, trekPicturePx, trekTiles } from '../lib/trekLayers'

const TILE_PX = 256

/** A tile, decoded and ready to draw; null where Moon Trek has none (outside a layer's data). */
type Tile = ImageBitmap | HTMLImageElement | null

/** Tiles already fetched or on their way, newest last: turning back to ground seen a moment ago costs nothing. */
const tiles = new Map<string, Promise<Tile>>()
const KEEP_TILES = 400
/** The close-up tiles still on their way, each with the means to call it off. */
const onTheWay = new Map<string, AbortController>()

/**
 * One tile. It is fetched and decoded off the main thread where the browser can (`createImageBitmap`),
 * so tiles arriving during a turn or a zoom do not make it stutter. `stoppable` marks a close-up
 * tile, which is called off if the view moves on before it arrives.
 */
function loadTile(url: string, stoppable: boolean): Promise<Tile> {
  const known = tiles.get(url)
  if (known) {
    // Used again: move it to the newest end.
    tiles.delete(url)
    tiles.set(url, known)
    return known
  }
  const tile: Promise<Tile> =
    typeof createImageBitmap === 'function'
      ? (() => {
          const stop = new AbortController()
          if (stoppable) onTheWay.set(url, stop)
          const ask = (address: string) => fetch(address, { mode: 'cors', signal: stop.signal })
          // Through the site's CDN first. A 404 there is Moon Trek's own (no tile for that ground); anything
          // else that is not a tile (the route down, the network) is asked of NASA's server itself, once.
          return ask(url)
            .then((response) => (response.ok || response.status === 404 ? response : Promise.reject(new Error(String(response.status)))))
            .catch((error: unknown) => {
              if (stop.signal.aborted || trekDirectUrl(url) === url) throw error
              return ask(trekDirectUrl(url))
            })
            .then((response) => (response.ok ? response.blob() : null))
            .then((blob) => (blob ? createImageBitmap(blob) : null))
            .catch(() => {
              // Called off, or the network failed: not kept, so it is asked for again when next wanted.
              tiles.delete(url)
              return null
            })
            .finally(() => onTheWay.delete(url))
        })()
      : new Promise<Tile>((resolve) => {
          const image = new Image()
          image.crossOrigin = 'anonymous'
          image.decoding = 'async'
          image.onload = () => resolve(image)
          image.onerror = () => {
            // The site's route did not give a picture: NASA's own server, once.
            if (image.src.endsWith(url) && trekDirectUrl(url) !== url) image.src = trekDirectUrl(url)
            else resolve(null)
          }
          image.src = url
        })
  tiles.set(url, tile)
  while (tiles.size > KEEP_TILES) tiles.delete(tiles.keys().next().value as string)
  return tile
}

type Part = TrekWindow['tiles'][number]

/** One part of a picture: its own tile, or, if that does not arrive, the stand-in it names. */
async function loadPart(part: Part, stoppable: boolean): Promise<{ image: Tile; crop?: TileCrop }> {
  const image = await loadTile(part.url, stoppable)
  if (image || !part.or) return { image, crop: part.crop }
  return { image: await loadTile(part.or.url, stoppable), crop: part.or.crop }
}

/** Tiles drawn side by side into one picture; null if not one of them arrived. */
async function stitch(parts: Part[], widthPx: number, heightPx: number, stoppable: boolean): Promise<HTMLCanvasElement | null> {
  const loaded = await Promise.all(parts.map((part) => loadPart(part, stoppable)))
  const images = loaded.map((one) => one.image)
  if (images.every((image) => image === null)) return null
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const context = canvas.getContext('2d')
  if (!context) return null
  loaded.forEach(({ image, crop }, i) => {
    if (!image) return
    // A square of a coarser tile, enlarged to this tile's place; or the tile as it is.
    if (crop) context.drawImage(image, crop.sx, crop.sy, crop.size, crop.size, parts[i].x, parts[i].y, TILE_PX, TILE_PX)
    else context.drawImage(image, parts[i].x, parts[i].y)
  })
  return canvas
}

const pictures = new Map<string, Promise<HTMLCanvasElement | null>>()

/**
 * A layer's picture of the ground around the south pole, stitched from Moon Trek's tiles: north
 * (0° E) up, 90° E to the right, the pole in the middle. Fetched once a layer; null if Trek sent
 * nothing at all.
 */
export function loadTrekPicture(layer: TrekLayer): Promise<HTMLCanvasElement | null> {
  const known = pictures.get(layer.id)
  if (known) return known
  const size = trekPicturePx(layer)
  const picture = stitch(trekTiles(layer), size, size, false)
  pictures.set(layer.id, picture)
  // A failure is not kept: switching the layer on again asks Trek again.
  void picture.then((canvas) => {
    if (!canvas) pictures.delete(layer.id)
  })
  return picture
}

/**
 * The close-up picture for a view (lib/trekLayers `trekWindow`), stitched from its tiles; null if
 * Trek sent none of them, or the view moved on first. Tiles of an earlier close-up that this one
 * does not share are called off, and this one's are asked for from the middle of the view outward.
 */
export function loadTrekWindow(window: Pick<TrekWindow, 'tiles' | 'widthPx' | 'heightPx'>): Promise<HTMLCanvasElement | null> {
  const wanted = new Set(window.tiles.map((tile) => tile.url))
  for (const [url, stop] of onTheWay) if (!wanted.has(url)) stop.abort()
  const midX = window.widthPx / 2
  const midY = window.heightPx / 2
  const fromTheMiddle = [...window.tiles].sort((a, b) => Math.hypot(a.x + 128 - midX, a.y + 128 - midY) - Math.hypot(b.x + 128 - midX, b.y + 128 - midY))
  return stitch(fromTheMiddle, window.widthPx, window.heightPx, true)
}
