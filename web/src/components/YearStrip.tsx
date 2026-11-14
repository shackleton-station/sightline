import type { YearSummary } from '../data/contract'
import { monthLabel, monthName } from '../lib/months'
import { pct } from '../lib/verdict'

interface Props {
  year: YearSummary
  month: string
  onSelect: (month: string) => void
}

/** Sun and Earth by month: shows the seasons at a glance, and picks the year and month. */
export function YearStrip({ year, month, onSelect }: Props) {
  const shownYear = month.slice(0, 4)
  return (
    <>
      <div className="year-picker" role="group" aria-label="Choose a year">
        {year.years.map(({ year: y }) => (
          <button
            key={y}
            type="button"
            aria-pressed={String(y) === shownYear}
            onClick={() => onSelect(`${y}${month.slice(4)}`)}
          >
            {y}
          </button>
        ))}
      </div>
      <p className="note year-key">
        <span className="swatch sun" aria-hidden="true" /> Sun up{' '}
        <span className="swatch earth" aria-hidden="true" /> Earth up, share of each month's hours.
        Choose a month:
      </p>
      <div className="year" role="group" aria-label={`Choose a month in ${shownYear}`}>
        {year.months
          .filter((m) => m.month.startsWith(shownYear))
          .map((m) => (
            <button
              key={m.month}
              type="button"
              className="year-month"
              aria-pressed={m.month === month}
              aria-label={`${monthLabel(m.month)}: Sun ${pct(m.pct_sun)}, Earth ${pct(m.pct_earth)}`}
              title={`Sun ${pct(m.pct_sun)}, Earth ${pct(m.pct_earth)}`}
              onClick={() => onSelect(m.month)}
            >
              <span className="year-bars" aria-hidden="true">
                <span className="year-bar sun" style={{ height: `${m.pct_sun}%` }} />
                <span className="year-bar earth" style={{ height: `${m.pct_earth}%` }} />
              </span>
              <span>{monthName(m.month)}</span>
            </button>
          ))}
      </div>
    </>
  )
}
