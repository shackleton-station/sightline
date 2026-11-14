import type { Summary } from '../data/contract'
import type { PanelSunlight } from '../lib/power'
import { formatUtc } from '../lib/timeline'
import { pct, verdict } from '../lib/verdict'

interface Props {
  summary: Summary
  meanSunElevationDeg: number | null
  sunlight: PanelSunlight
  /** Show numbers only a planner weighs. */
  plan: boolean
}

export function SummaryCard({ summary, meanSunElevationDeg, sunlight, plan }: Props) {
  const stats = [
    { label: 'Sun up', value: pct(summary.pct_sun) },
    { label: 'Earth up', value: pct(summary.pct_earth) },
    { label: 'Both up', value: pct(summary.pct_both) },
    { label: 'Longest without Sun', value: `${summary.max_sun_gap_h} h` },
    { label: 'Longest without Earth', value: `${summary.max_earth_gap_h} h` },
    ...(plan
      ? [
          {
            label: 'Average Sun height while up',
            value: meanSunElevationDeg === null ? 'never up' : `${meanSunElevationDeg.toFixed(1)}°`,
          },
          { label: 'Sunlight on a vertical panel', value: `${sunlight.vertical.toFixed(0)} W/m²` },
          { label: 'Sunlight on a flat panel', value: `${sunlight.flat.toFixed(0)} W/m²` },
        ]
      : []),
  ]

  return (
    <div className="summary">
      <h3>This month in numbers</h3>
      <p className="verdict">{verdict(summary)}</p>
      <dl className="stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="note">
        {formatUtc(summary.range.start)} to {formatUtc(summary.range.end)}, observer{' '}
        {summary.obs_height_m} m above the surface. "Up" means any part of the disk is visible. Gaps
        are counted within this period only.
        {plan &&
          ' Panel sunlight is a monthly average before panel efficiency and losses; the vertical panel turns to face the Sun.'}
      </p>
    </div>
  )
}
