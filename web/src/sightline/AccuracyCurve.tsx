import { FIT_COLOR, MISS_COLOR, type Ring } from '../lib/landingOdds'

interface Props {
  rings: Ring[]
  /** The accuracy radius (m): a line marks it on the curve. */
  accuracyM: number
}

const WIDTH = 272
const HEIGHT = 96
const FLOOR = HEIGHT - 16

/**
 * How far off a landing is likely to be, and how it fares there: one bar for each ring around the
 * target. A bar's height is the chance of missing by that much, so together the bars are the
 * distribution of the miss; its green part is the share of that ring's ground where a landing fits.
 */
export function AccuracyCurve({ rings, accuracyM }: Props) {
  const most = Math.max(...rings.map((ring) => ring.chance))
  const reach = rings.at(-1)?.toM ?? 1
  const bar = WIDTH / rings.length
  const at = (m: number) => (m / reach) * WIDTH
  return (
    <svg className="sl-accuracy-curve" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="How likely each miss distance is, and how much of the ground at that distance fits the mission">
      {rings.map((ring, i) => {
        const height = most > 0 ? (ring.chance / most) * (FLOOR - 4) : 0
        const fit = ring.fitShare === null ? 0 : height * ring.fitShare
        return (
          <g key={ring.fromM}>
            <title>{`${Math.round(ring.fromM)} to ${Math.round(ring.toM)} m off: ${(100 * ring.chance).toFixed(ring.chance < 0.1 ? 1 : 0)}% of landings${ring.fitShare === null ? '' : `, ${Math.round(100 * ring.fitShare)}% of that ground fits`}`}</title>
            <rect x={i * bar + 0.5} y={FLOOR - height} width={bar - 1} height={height - fit} fill={ring.fitShare === null ? 'var(--sl-none)' : MISS_COLOR} />
            <rect x={i * bar + 0.5} y={FLOOR - fit} width={bar - 1} height={fit} fill={FIT_COLOR} />
          </g>
        )
      })}
      <line x1={0} x2={WIDTH} y1={FLOOR + 0.5} y2={FLOOR + 0.5} stroke="currentColor" strokeOpacity={0.4} />
      {accuracyM <= reach && <line x1={at(accuracyM)} x2={at(accuracyM)} y1={2} y2={FLOOR} stroke="currentColor" strokeDasharray="3 3" />}
      <text x={0} y={HEIGHT - 3} fontSize={11} fill="currentColor">
        0 m off target
      </text>
      <text x={WIDTH} y={HEIGHT - 3} fontSize={11} fill="currentColor" textAnchor="end">
        {Math.round(reach)} m
      </text>
    </svg>
  )
}
