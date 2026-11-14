import { type CSSProperties, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { useAllFlags } from '../data/useAllFlags'
import {
  type GridMetric,
  gridRow,
  INK_FLIP_DARK_PCT,
  INK_FLIP_LIGHT_PCT,
  metricFlags,
  monthSpans,
  shadePct,
} from '../lib/grid'
import { locateHour, type Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import { monthLabel, monthName } from '../lib/months'

interface Props {
  sites: SiteInfo[]
  /** The site and month on show, outlined in the grid. */
  siteId: string
  month: string
  requirements: Requirements
  mode: Mode
  onOpen: (site: SiteInfo, month: string, index: number) => void
}

interface MetricChoice {
  metric: GridMetric
  label: string
  /** How the number in a cell reads, for its label and for the key. */
  unit: string
  reads: (text: string) => string
}

const METRICS: MetricChoice[] = [
  {
    metric: 'landing',
    label: 'Can land',
    unit: 'Days in the month with a landing time that meets your limits',
    reads: (text) => `${text} days of landing times that meet your limits`,
  },
  {
    metric: 'both',
    label: 'Sun and Earth',
    unit: 'Percent of the month with the Sun and Earth both up',
    reads: (text) => `Sun and Earth both up ${text}% of the month`,
  },
  {
    metric: 'sun',
    label: 'Sun',
    unit: 'Percent of the month with the Sun up',
    reads: (text) => `Sun up ${text}% of the month`,
  },
  {
    metric: 'earth',
    label: 'Earth',
    unit: 'Percent of the month with Earth in view',
    reads: (text) => `Earth in view ${text}% of the month`,
  },
]

/** Every site across every month of a year, readable at a glance. Choosing a cell opens it. */
export function LandingGrid({ sites, siteId, month, requirements, mode, onOpen }: Props) {
  const all = useAllFlags(sites)
  const [picked, setPicked] = useState<GridMetric | null>(null)
  const [year, setYear] = useState(month.slice(0, 4))
  const choices = mode === 'plan' ? METRICS : METRICS.filter((choice) => choice.metric !== 'landing')
  // Limits are hidden in Learn, so a metric that depends on them can't stay selected there.
  const metric = choices.find((choice) => choice.metric === picked) ?? choices[0]

  const rows = useMemo(() => {
    if (!all) return null
    return all.map(({ site, flags }) => {
      const spans = monthSpans(flags.start, flags.sun.length)
      return {
        site,
        start: flags.start,
        cells: gridRow(metricFlags(metric.metric, flags, requirements), spans, metric.metric),
      }
    })
  }, [all, metric.metric, requirements])

  if (!rows) return <p className="note">Working out every site and month…</p>

  const years = [...new Set(rows[0].cells.map((cell) => cell.month.slice(0, 4)))]
  const months = rows[0].cells.filter((cell) => cell.month.startsWith(year)).map((cell) => cell.month)
  const groups = [...new Set(rows.map((row) => row.site.group))]
  const largestShare = Math.max(
    ...rows.flatMap((row) => row.cells.filter((cell) => cell.month.startsWith(year)).map((cell) => cell.share)),
  )

  return (
    <div className="landing-grid">
      <div className="grid-controls">
        <div className="choice" role="group" aria-label="What to show">
          {choices.map((choice) => (
            <button
              key={choice.metric}
              type="button"
              aria-pressed={choice.metric === metric.metric}
              onClick={() => setPicked(choice.metric)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <div className="choice" role="group" aria-label="Year">
          {years.map((y) => (
            <button key={y} type="button" aria-pressed={y === year} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        {metric.unit}. Choose any square to open it.
        {metric.metric === 'landing' && ' Change your limits under "Can you land here?".'}
      </p>
      <table>
        <caption className="visually-hidden">
          {metric.unit}, by site and month, {year}
        </caption>
        <thead>
          <tr>
            <th scope="col">Site</th>
            {months.map((m) => (
              <th key={m} scope="col" title={monthLabel(m)}>
                <span className="month-long">{monthName(m)}</span>
                <span className="month-short" aria-hidden="true">
                  {monthName(m)[0]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group}>
            <tr className="grid-group">
              <th scope="colgroup" colSpan={months.length + 1}>
                {group}
              </th>
            </tr>
            {rows
              .filter((row) => row.site.group === group)
              .map((row) => (
                <tr key={row.site.id}>
                  <th scope="row">{row.site.name}</th>
                  {row.cells
                    .filter((cell) => cell.month.startsWith(year))
                    .map((cell) => {
                      const description = `${row.site.name}, ${monthLabel(cell.month)}: ${metric.reads(cell.text)}`
                      const shade = shadePct(cell.share, largestShare, metric.metric)
                      const ink = [
                        shade >= INK_FLIP_LIGHT_PCT ? 'ink-light' : '',
                        shade >= INK_FLIP_DARK_PCT ? 'ink-dark' : '',
                      ].join(' ')
                      return (
                        <td key={cell.month}>
                          <button
                            type="button"
                            className={`cell ${shade === 0 ? 'empty' : ink}`}
                            style={{ '--shade': shade } as CSSProperties}
                            aria-label={`${description}. Open.`}
                            aria-current={row.site.id === siteId && cell.month === month ? 'true' : undefined}
                            title={description}
                            onClick={() =>
                              onOpen(row.site, cell.month, locateHour(row.start, cell.firstHour).index)
                            }
                          >
                            {cell.text}
                          </button>
                        </td>
                      )
                    })}
                </tr>
              ))}
          </tbody>
        ))}
      </table>
      <p className="grid-key note" aria-hidden="true">
        None <span className="cell-swatch empty" /> <span className="cell-scale" />{' '}
        {metric.metric === 'landing' ? 'The most on this table' : 'All of the month'}
      </p>
      <p className="note">
        From hourly model data with an observer 2 m up. It's a first pass for narrowing down dates and
        sites, not a mission design.
      </p>
    </div>
  )
}
