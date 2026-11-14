import { scaleUtc, utcFormat } from 'd3'
import type { MouseEvent } from 'react'
import type { Summary, TrackPoint } from '../data/contract'
import { indexAtFraction, intersectWindows } from '../lib/timeline'
import { useWidth } from '../lib/useWidth'

interface Props {
  summary: Summary
  track: TrackPoint[]
  index: number
  onSelect: (index: number) => void
}

const MARGIN = { top: 6, right: 12, bottom: 24, left: 52 }
const ROW_HEIGHT = 24
const ROW_GAP = 6
const formatDay = utcFormat('%b %-d')

export function Timeline({ summary, track, index, onSelect }: Props) {
  const [ref, width] = useWidth()
  const rows = [
    { label: 'Sun', className: 'sun', windows: summary.sun_windows },
    { label: 'Earth', className: 'earth', windows: summary.earth_windows },
    {
      label: 'Both',
      className: 'both',
      windows: intersectWindows(summary.sun_windows, summary.earth_windows),
    },
  ]
  const innerBottom = MARGIN.top + rows.length * (ROW_HEIGHT + ROW_GAP)
  const height = innerBottom + MARGIN.bottom
  const left = MARGIN.left
  const right = Math.max(width - MARGIN.right, left + 1)
  const x = scaleUtc([new Date(summary.range.start), new Date(summary.range.end)], [left, right])
  const cursor = x(new Date(track[index].t))

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onSelect(indexAtFraction((event.clientX - box.left - left) / (right - left), track.length))
  }

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg
          className="timeline"
          width={width}
          height={height}
          role="img"
          aria-label={`When the Sun, Earth and both are up, ${summary.range.start} to ${summary.range.end}. Click to jump to a time.`}
          onClick={handleClick}
        >
          {rows.map((row, i) => {
            const y = MARGIN.top + i * (ROW_HEIGHT + ROW_GAP)
            return (
              <g key={row.label}>
                <text className="tick" x={left - 8} y={y + ROW_HEIGHT / 2 + 4} textAnchor="end">
                  {row.label}
                </text>
                <rect className="band-empty" x={left} y={y} width={right - left} height={ROW_HEIGHT} />
                {row.windows.map((window) => {
                  const start = x(new Date(window.start))
                  return (
                    <rect
                      key={window.start}
                      className={`band ${row.className}`}
                      x={start}
                      y={y}
                      width={x(new Date(window.end)) - start}
                      height={ROW_HEIGHT}
                    />
                  )
                })}
              </g>
            )
          })}
          {x.ticks(width < 500 ? 4 : 8).map((tick) => (
            <text key={tick.getTime()} className="tick" x={x(tick)} y={height - 6} textAnchor="middle">
              {formatDay(tick)}
            </text>
          ))}
          <line className="cursor" x1={cursor} x2={cursor} y1={MARGIN.top - 4} y2={innerBottom} />
        </svg>
      )}
    </div>
  )
}
