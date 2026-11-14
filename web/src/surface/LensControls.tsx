import { FOV_MAX_DEG, FOV_MIN_DEG, type Look } from '../lib/surfaceView'

interface Props {
  look: Look
  /** How many degrees the picture spans from its left edge to its right. */
  acrossDeg: number
  /** How many times taller heights are drawn when the stretch is on. */
  stretchBy: number
  setLens: (change: (look: Look) => Look) => void
}

const ZOOM_STEP = 1.25
const SLIDER_STEPS = 100
/** The slider runs evenly in zoom ratio: each step narrows the view by the same share. */
const fovAt = (step: number) => FOV_MAX_DEG * (FOV_MIN_DEG / FOV_MAX_DEG) ** (step / SLIDER_STEPS)
const stepAt = (fovDeg: number) => Math.round((SLIDER_STEPS * Math.log(fovDeg / FOV_MAX_DEG)) / Math.log(FOV_MIN_DEG / FOV_MAX_DEG))

/** "27°", or "3.4°" when the view is narrow enough for the tenths to matter. */
function widthWords(deg: number): string {
  return `${deg < 10 ? deg.toFixed(1) : Math.round(deg)}°`
}

/**
 * The lens: how much of the scene the picture takes in, and whether heights are stretched. Zooming
 * is true to scale, like binoculars; stretching is not, and is always said on the picture.
 */
export function LensControls({ look, acrossDeg, stretchBy, setLens }: Props) {
  const wide = `View ${widthWords(acrossDeg)} wide`
  const zoom = (factor: number) => setLens((current) => ({ ...current, fovDeg: current.fovDeg / factor }))
  return (
    <div className="sf-lens" role="group" aria-label="Zoom and scale">
      <div className="sf-zoom">
        <button type="button" aria-label="Zoom out" disabled={look.fovDeg >= FOV_MAX_DEG} onClick={() => zoom(1 / ZOOM_STEP)}>
          −
        </button>
        <input
          type="range"
          aria-label="Zoom"
          aria-valuetext={wide}
          min={0}
          max={SLIDER_STEPS}
          value={stepAt(look.fovDeg)}
          onChange={(event) => setLens((current) => ({ ...current, fovDeg: fovAt(Number(event.target.value)) }))}
        />
        <button type="button" aria-label="Zoom in" disabled={look.fovDeg <= FOV_MIN_DEG} onClick={() => zoom(ZOOM_STEP)}>
          +
        </button>
      </div>
      <p className="sf-lens-says">
        {wide} · {look.stretch > 1 ? <strong>heights ×{look.stretch}</strong> : 'true scale'}
      </p>
      <button
        type="button"
        className="sf-stretch"
        aria-pressed={look.stretch > 1}
        title={`Draws every height ${stretchBy} times taller, so low hills are easier to see. Not true to scale.`}
        onClick={() => setLens((current) => ({ ...current, stretch: current.stretch > 1 ? 1 : stretchBy }))}
      >
        Stretch heights ×{stretchBy}
      </button>
    </div>
  )
}
