import { useEffect, useState } from 'react'
import type { FinePhoto } from '../lib/trekLayers'

interface FinePhotoFile {
  level: number
  radius_m: number
  discs: { site: string; x_m: number; y_m: number }[]
  title: string
  credit: string
}

let request: Promise<FinePhoto | null> | null = null

/**
 * Where our own finer photo tiles are (public/data/photo-fine.json, written by
 * pipeline/scripts/make_photo_tiles.py). Asked for once, and only when the photo layer is switched
 * on: the page's first load never fetches it. Null if it cannot be read, and the layer then stops
 * where Moon Trek's tiles do.
 */
export function loadFinePhoto(): Promise<FinePhoto | null> {
  request ??= fetch(`${import.meta.env.BASE_URL}data/photo-fine.json`)
    .then((response) => (response.ok ? (response.json() as Promise<FinePhotoFile>) : null))
    .then((file) =>
      file && file.discs?.length > 0
        ? { level: file.level, radiusM: file.radius_m, discs: file.discs.map((disc) => ({ x: disc.x_m, y: disc.y_m })), title: file.title, credit: file.credit }
        : null,
    )
    .catch(() => null)
  return request
}

/** The finer photo's whereabouts once `wanted` (the photo layer is on); null until then, and if there is none. */
export function useFinePhoto(wanted: boolean): FinePhoto | null {
  const [fine, setFine] = useState<FinePhoto | null>(null)
  useEffect(() => {
    if (!wanted) return
    let current = true
    void loadFinePhoto().then((found) => {
      if (current) setFine(found)
    })
    return () => {
      current = false
    }
  }, [wanted])
  return wanted ? fine : null
}
