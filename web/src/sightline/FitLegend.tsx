import { ACCURACY_RANGE, type Spread, spreadWords } from '../lib/landingOdds'
import { ODDS_RAMP } from '../lib/missionGrid'

const RAMP = `linear-gradient(to right, ${ODDS_RAMP.map((color) => `rgb(${color.join(' ')})`).join(', ')})`

interface Props {
  on: boolean
  onToggle: (on: boolean) => void
  spread: Spread
  onSpread: (spread: Spread) => void
  /** Whether the light grid reaches the site on show: only there do the odds take the terrain and the accuracy into account. */
  detailed: boolean
  /** Open the panel with the odds for this landing, the reasons and a better place to aim. */
  onDetails: () => void
}

/**
 * The switch for the mission's chance of success shaded on the Moon, on the stage itself in every
 * view. Switched on, it is also the shading's key: what the colors mean, the landing accuracy they
 * are for, and what they are worked out from.
 */
export function FitLegend({ on, onToggle, spread, onSpread, detailed, onDetails }: Props) {
  return (
    <div className={on ? 'sl-fit-legend is-on' : 'sl-fit-legend'}>
      <label className="sl-fit-switch" title="Colors the Moon by how likely a landing is to fit the mission: green where it is likely, through amber, to red where it is not">
        <input type="checkbox" role="switch" checked={on} onChange={() => onToggle(!on)} />
        <span>Mission success probability</span>
      </label>
      {on && (
        <>
          <span className="sl-fit-ramp" style={{ background: RAMP }} />
          <span className="sl-fit-ends">
            <span>Unlikely</span>
            <span>Likely</span>
          </span>
          <label className="sl-fit-accuracy">
            <span>
              Landing accuracy <output>{spreadWords(spread)}</output>
            </span>
            <input
              type="range"
              min={ACCURACY_RANGE.min}
              max={ACCURACY_RANGE.max}
              step={ACCURACY_RANGE.step}
              value={spread.accuracyM}
              aria-valuetext={`${spread.accuracyM} meters`}
              onChange={(event) => onSpread({ ...spread, accuracyM: Number(event.target.value) })}
            />
          </label>
          <p>For a landing at the time on the time bar.</p>
          <p>
            {detailed ? 'Near the south pole: the hourly light on the terrain, and the slope, for a lander this accurate.' : 'This site is outside the terrain grid near the south pole.'} Elsewhere: a smooth Moon, with no terrain shadows and no slope.
          </p>
          {detailed && (
            <button type="button" className="sl-small" onClick={onDetails}>
              Details for this landing
            </button>
          )}
        </>
      )}
    </div>
  )
}