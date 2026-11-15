import { FIT_COLOR, MISS_COLORS, MISS_WORDS, MISSES } from '../lib/landingOdds'

interface Props {
  on: boolean
  onToggle: (on: boolean) => void
}

/**
 * The key to "Landings that fit" while it shades the Moon: its switch and what each color means, small
 * enough for the stage's corner, where it lies on none of the Moon's disc and on no site's name. The
 * colors and their words are Landing accuracy's own: the Moon is that panel's map, seen from farther
 * off. What the shading is worked out from, and the landing it is for, are said in Layers.
 */
export function FitLegend({ on, onToggle }: Props) {
  return (
    <div className={on ? 'sl-fit-legend is-on' : 'sl-fit-legend'}>
      <label className="sl-fit-switch" title="Colors the Moon by what a landing at each spot does: green where it fits your mission, and where it does not, the color of what fails first. The colors of Landing accuracy's map.">
        <input type="checkbox" role="switch" checked={on} onChange={() => onToggle(!on)} />
        <span>Landings that fit</span>
      </label>
      {on && (
        <ul className="sl-fit-key">
          <li>
            <i style={{ background: FIT_COLOR }} /> fits
          </li>
          {MISSES.map((miss) => (
            <li key={miss}>
              <i style={{ background: MISS_COLORS[miss] }} /> {MISS_WORDS[miss]}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
