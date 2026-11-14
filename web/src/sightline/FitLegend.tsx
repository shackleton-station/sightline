import { FIT_COLOR, type Miss, MISS_COLORS, MISS_WORDS, MISSES } from '../lib/landingOdds'

/**
 * The key to the shading on the Moon, kept on screen for as long as the shading is: green where a
 * landing at the scenario's hour fits the mission, and each reason it does not in its own color.
 */
export function FitLegend({ reasons }: { reasons: Miss[] }) {
  return (
    <ul className="sl-fit-legend sl-fade" aria-label="What the shading on the Moon means">
      <li>
        <span style={{ background: FIT_COLOR }} />A landing fits
      </li>
      {MISSES.filter((miss) => reasons.includes(miss)).map((miss) => (
        <li key={miss}>
          <span style={{ background: MISS_COLORS[miss] }} />
          {MISS_WORDS[miss].replace(/^./, (first) => first.toUpperCase())}
        </li>
      ))}
    </ul>
  )
}