import type { ReactNode } from 'react'
import { Moon3DSection } from '../components/Moon3DSection'
import type { SiteInfo, TrackPoint } from '../data/contract'

interface Props {
  site: SiteInfo
  now: TrackPoint
  obsHeightM: number
  /** The site and month menus, when the page shows them. */
  pickers: ReactNode
  onBack: () => void
}

/**
 * "Stand here in 3D terrain": the same site and hour on Classic's 3D view, which draws the ground
 * itself from NASA's LOLA terrain with the Sun's shadows, standing at the site and facing the Sun's
 * direction, with the ground kept in the picture however high the Sun is. It takes the place of the
 * two skyline views, which have no ground to show; the hour still moves with the time bar. A separate
 * picture from the skyline views: the answer in words is the model's.
 */
export function TerrainStand({ site, now, obsHeightM, pickers, onBack }: Props) {
  return (
    <div className="sf-view sf-flat sf-terrain">
      {pickers}
      <div className="sf-terrain-bar">
        <button type="button" className="sf-motion" autoFocus onClick={onBack}>
          Back to the skyline views
        </button>
        <p>
          The ground at {site.name}, drawn from NASA’s LOLA terrain, with the Sun’s shadows for this hour. You stand {obsHeightM} m up, facing the
          Sun’s direction; drag to look around.
        </p>
      </div>
      <Moon3DSection site={site} now={now} obsHeightM={obsHeightM} camera="sun" groundInView />
    </div>
  )
}
