import { useEffect, useState } from 'react'
import { loadTrekPicture } from '../data/trekPicture'
import { TREK_RADIUS_M, type TrekLayerId, trekHalfWidthM, trekLayer } from '../lib/trekLayers'
import type { GlobeOverlay } from '../three/GlobeViewer'

export interface TrekOverlay {
  /** The picture for the Moon on the stage; null while it loads, with no layer, or if Trek did not answer. */
  overlay: GlobeOverlay | null
  /** 'loading' until the tiles are in; 'failed' if Moon Trek sent none. */
  state: 'off' | 'loading' | 'on' | 'failed'
}

/** The Moon Trek layer that is switched on, fetched from Trek and made ready to lay over the Moon. */
export function useTrekOverlay(id: TrekLayerId | null): TrekOverlay {
  const [loaded, setLoaded] = useState<{ id: TrekLayerId; overlay: GlobeOverlay | null } | null>(null)
  useEffect(() => {
    const layer = trekLayer(id)
    if (!layer) return
    let current = true
    void loadTrekPicture(layer).then((image) => {
      if (!current) return
      setLoaded({
        id: layer.id,
        overlay: image && { image, halfWidthM: trekHalfWidthM(layer), radiusM: TREK_RADIUS_M, paint: layer.paint, tint: layer.tint, opacity: layer.opacity },
      })
    })
    return () => {
      current = false
    }
  }, [id])
  if (!id) return { overlay: null, state: 'off' }
  if (loaded?.id !== id) return { overlay: null, state: 'loading' }
  return { overlay: loaded.overlay, state: loaded.overlay ? 'on' : 'failed' }
}
