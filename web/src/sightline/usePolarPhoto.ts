import { useEffect, useState } from 'react'
import { useFinePhoto } from '../data/finePhoto'
import { type TrekWindow, trekLayer, trekWindow } from '../lib/trekLayers'

export interface PolarPhoto {
  win: TrekWindow
  image: HTMLCanvasElement
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

/**
 * LROC's south-pole photo mosaic for a square of ground: our 1 m tiles round the ridge sites, Moon
 * Trek's elsewhere. `centre` is in polar stereographic metres (x toward 90° E, y toward 0° E, the
 * Moon's 1737.4 km radius), the frame the light grid, the nearby maps and Moon Trek's map all share.
 * Null until it has loaded, or if there is no photo for the place.
 */
export function usePolarPhoto(centre: { x: number; y: number } | null, reachM: number, sidePx: number): PolarPhoto | null {
  const fine = useFinePhoto(true)
  const [photo, setPhoto] = useState<{ key: string; photo: PolarPhoto } | null>(null)
  const key = centre && reachM > 0 && sidePx > 0 ? `${Math.round(centre.x)},${Math.round(centre.y)}|${Math.round(reachM)}|${Math.round(sidePx)}|${fine ? 'fine' : 'trek'}` : null
  useEffect(() => {
    if (!centre || !key) return
    const layer = trekLayer('photo')
    if (!layer) return
    const ratio = window.devicePixelRatio || 1
    const win = trekWindow(layer, centre, reachM * 1.05, (2 * reachM) / (sidePx * ratio), fine)
    if (!win) return
    let current = true
    const out = document.createElement('canvas')
    out.width = win.widthPx
    out.height = win.heightPx
    const g = out.getContext('2d')
    if (!g) return
    Promise.all(
      win.tiles.map(async (tile) => {
        try {
          const image = await loadImage(tile.url)
          if (tile.crop) g.drawImage(image, tile.crop.sx, tile.crop.sy, tile.crop.size, tile.crop.size, tile.x, tile.y, 256, 256)
          else g.drawImage(image, tile.x, tile.y, 256, 256)
        } catch {
          if (!tile.or) return
          try {
            const image = await loadImage(tile.or.url)
            g.drawImage(image, tile.or.crop.sx, tile.or.crop.sy, tile.or.crop.size, tile.or.crop.size, tile.x, tile.y, 256, 256)
          } catch {
            // A missing tile stays dark.
          }
        }
      }),
    ).then(() => current && setPhoto({ key, photo: { win, image: out } }))
    return () => {
      current = false
    }
    // The key names the place, the reach and the size.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return photo?.key === key ? photo.photo : null
}

/** Draws a photo onto a canvas whose middle is `centre` and which shows `reachM` each way. */
export function drawPolarPhoto(context: CanvasRenderingContext2D, photo: PolarPhoto, centre: { x: number; y: number }, reachM: number, side: number): void {
  const perM = side / (2 * reachM)
  const { win, image } = photo
  const left = win.centreXM - win.halfWidthM - centre.x
  const top = win.centreYM + win.halfHeightM - centre.y
  context.drawImage(image, (left + reachM) * perM, (reachM - top) * perM, win.widthPx * win.metresPerPixel * perM, win.heightPx * win.metresPerPixel * perM)
}
