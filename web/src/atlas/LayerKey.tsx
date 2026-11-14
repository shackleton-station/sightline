import { RiverKey } from '../shell/TimeRiver'
import type { LightView } from '../three/lightLayer'

/** What the colors on the polar ground mean, for the way it is colored now. */
export function LayerKey({ layer }: { layer: LightView }) {
  if (layer === 'both') return <RiverKey landing={false} />
  if (layer === 'month') {
    return (
      <p className="atlas-key">
        0% <span className="atlas-ramp" aria-hidden="true" /> 100% of the month's hours with the Sun in view
      </p>
    )
  }
  return (
    <p className="atlas-key">
      <span className="key atlas-lit" /> Sun in view <span className="key atlas-dark" /> Sun hidden by terrain
    </p>
  )
}
