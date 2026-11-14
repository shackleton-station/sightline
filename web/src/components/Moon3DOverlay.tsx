import type { TrackPoint } from '../data/contract'
import { formatSkyAngle } from '../lib/skyAngle'

interface Point {
  x: number
  y: number
}

/** A body in the sky: where its center is on screen, and its disk's radius in pixels. */
interface SkyPoint extends Point {
  r: number
}

export interface ScreenPoints {
  site: Point | null
  sun: SkyPoint | null
  earth: SkyPoint | null
}

interface Props {
  points: ScreenPoints
  siteName: string
  now: TrackPoint
  showRays: boolean
}

/** Gap (px) between a disk's top edge and its label. */
const LABEL_GAP_PX = 6

/**
 * Labels and sight lines on top of the 3D view. Up or blocked, and the angles, come from the model,
 * as everywhere. Sun and Earth labels sit just above their disks, so the disks stay visible.
 */
export function Moon3DOverlay({ points: { site, sun, earth }, siteName, now, showRays }: Props) {
  const skyLabel = (className: string, at: SkyPoint, name: string, up: boolean, elDeg: number, azDeg: number) => (
    <span className={`moon-3d-label sky ${className}`} style={{ left: at.x, top: at.y - at.r - LABEL_GAP_PX }}>
      <span className="sky-name">{up ? name : `${name} (blocked)`}</span>
      <span className="sky-angle">{formatSkyAngle(elDeg, azDeg)}</span>
    </span>
  )
  return (
    <>
      <svg className="moon-3d-rays" aria-hidden="true">
        {showRays && site && sun && <line x1={site.x} y1={site.y} x2={sun.x} y2={sun.y} className="ray-sun" />}
        {showRays && site && earth && (
          <line x1={site.x} y1={site.y} x2={earth.x} y2={earth.y} className="ray-earth" />
        )}
      </svg>
      {site && (
        <span className="moon-3d-label site" style={{ left: site.x, top: site.y }}>
          {siteName}
        </span>
      )}
      {sun && skyLabel('sun', sun, 'Sun', now.sun_up, now.sun_el, now.sun_az)}
      {earth && skyLabel('earth', earth, 'Earth', now.earth_up, now.earth_el, now.earth_az)}
    </>
  )
}
