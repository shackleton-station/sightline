import { MAX_ZOOM, MIN_ZOOM } from '../lib/globe'

interface Props {
  zoom: number
  onZoom: (zoom: number) => void
  /** The limits, when a page's differ from the usual ones. */
  min?: number
  max?: number
}

/** Plus and minus for zooming the globe, for people without a wheel or a second finger. */
export function ZoomButtons({ zoom, onZoom, min = MIN_ZOOM, max = MAX_ZOOM }: Props) {
  return (
    <div className="zoom-buttons">
      <button type="button" aria-label="Zoom in" disabled={zoom >= max} onClick={() => onZoom(zoom * 1.6)}>
        +
      </button>
      <button type="button" aria-label="Zoom out" disabled={zoom <= min} onClick={() => onZoom(zoom / 1.6)}>
        −
      </button>
    </div>
  )
}
