import type { ScenarioData } from '../data/loadSite'
import type { Mode } from '../lib/mode'
import { monthLabel } from '../lib/months'
import type { CameraCue } from '../lib/story'
import { HorizonPanorama } from './HorizonPanorama'
import { Moon3DSection } from './Moon3DSection'

interface Props {
  data: ScenarioData
  index: number
  view3d: boolean
  onView3dChange: (open: boolean) => void
  mode: Mode
  camera?: CameraCue
  onReadyChange?: (ready: boolean) => void
}

/** What the answer looks like: the horizon, or the ground in 3D. */
export function HeroView({ data, index, view3d, onView3dChange, mode, camera, onReadyChange }: Props) {
  const clamped = Math.min(index, data.track.length - 1)
  return (
    <section aria-label={`View from ${data.site.name}, ${monthLabel(data.month)}`}>
      <div className="hero-tabs" role="group" aria-label="View">
        <button type="button" aria-pressed={view3d} onClick={() => onView3dChange(true)}>
          3D ground
        </button>
        <button type="button" aria-pressed={!view3d} onClick={() => onView3dChange(false)}>
          Horizon
        </button>
      </div>
      {view3d ? (
        <Moon3DSection
          site={data.site}
          now={data.track[clamped]}
          obsHeightM={data.summary.obs_height_m}
          camera={camera}
          onReadyChange={onReadyChange}
        />
      ) : (
        <>
          <h2 className="hero-title">
            All around {data.site.name}, {monthLabel(data.month)}
          </h2>
          <HorizonPanorama horizon={data.horizon} track={data.track} index={clamped} />
          <details className="how-to-read note">
            <summary>How to read this</summary>
            {mode === 'learn' ? (
              <p>
                The grey shape is the land on the horizon, all the way around you. The lines show where the
                Sun and Earth travel this month. A filled circle is in view; a hollow one is hidden behind
                the land. On a polar ridge you can see down past eye level, so 0° isn't the horizon.
              </p>
            ) : (
              <p>
                Thin lines: full paths this month. Filled marker: up. Hollow marker: blocked by terrain.
                Sunset and Earthset mean going behind the terrain, not below 0°. At polar ridges, negative
                elevations are normal, because the site overlooks lower ground. N points along the site's
                meridian toward the Moon's north pole.
              </p>
            )}
          </details>
        </>
      )}
    </section>
  )
}
