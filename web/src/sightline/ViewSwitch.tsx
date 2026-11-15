import type { RefObject } from 'react'
import type { StageMode } from './Rail'

interface Props {
  /** The switch's box, for the stage to keep Earth's mark clear of it. */
  box: RefObject<HTMLDivElement | null>
  mode: StageMode
  onMode: (mode: StageMode) => void
  /** The pointer or the keyboard is on the Surface button: its view can be made ready before the press. */
  onSurfaceNear?: () => void
  /** Whether the Layers panel is open, and whether a Moon Trek layer is on (the button says so). */
  layersOpen: boolean
  layerOn: boolean
  onLayers: () => void
}

/**
 * What the Moon shows, on the Moon's own stage: how close it is seen (Orbit, Site, Surface), as one
 * control with the current view pressed, and Layers beside it. All four change the picture in the
 * stage, so they stand in its top left corner, clear of the disc at the default zoom, with the zoom
 * buttons in the corner opposite. On a phone the rail's one row carries them instead.
 */
export function ViewSwitch({ box, mode, onMode, onSurfaceNear, layersOpen, layerOn, onLayers }: Props) {
  return (
    <div ref={box} className="sl-view-switch" role="group" aria-label="What the Moon shows">
      <div className="sl-heights" role="group" aria-label="How close the Moon is seen">
        <button type="button" aria-pressed={mode === 'orbit'} title="Shows the whole Moon, from over its south pole." onClick={() => onMode('orbit')}>
          Orbit
        </button>
        <button type="button" aria-pressed={mode === 'site'} title="Moves in close on the landing site." onClick={() => onMode('site')}>
          Site
        </button>
        <button type="button" aria-pressed={mode === 'surface'} title="Shows the view from the ground at the site: the skyline, the Sun and Earth." onPointerEnter={onSurfaceNear} onFocus={onSurfaceNear} onClick={() => onMode('surface')}>
          Surface
        </button>
      </div>
      <button type="button" className="sl-view-layers" aria-pressed={layersOpen} title="Lays one of NASA's maps of the south pole over the Moon: slope, shadow, sunlight and more." onClick={onLayers}>
        Layers
        {/* The credit stays on screen for as long as a layer is on the Moon, with the panel open or shut. */}
        {layerOn && <small className="sl-rail-credit">Moon Trek</small>}
      </button>
    </div>
  )
}
