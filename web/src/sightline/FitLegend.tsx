import { ODDS_RAMP } from '../lib/missionGrid'

const RAMP = `linear-gradient(to right, ${ODDS_RAMP.map((color) => `rgb(${color.join(' ')})`).join(', ')})`

interface Props {
  on: boolean
  onToggle: (on: boolean) => void
}

/**
 * The key to "Landings that fit" while it shades the Moon: its switch and what the colors mean, small
 * enough for the stage's corner, where it lies on none of the Moon's disc and on no site's name. What
 * the shading is worked out from, and the landing it is for, are said in Layers and in Landing accuracy.
 */
export function FitLegend({ on, onToggle }: Props) {
  return (
    <div className={on ? 'sl-fit-legend is-on' : 'sl-fit-legend'}>
      <label className="sl-fit-switch" title="Colors the Moon by how likely a landing aimed there comes down where the mission fits. Green is likely, amber uncertain, red unlikely.">
        <input type="checkbox" role="switch" checked={on} onChange={() => onToggle(!on)} />
        <span>Landings that fit</span>
      </label>
      {on && (
        <span className="sl-fit-key">
          <span>Few</span>
          <span className="sl-fit-ramp" style={{ background: RAMP }} />
          <span>Most</span>
        </span>
      )}
    </div>
  )
}
