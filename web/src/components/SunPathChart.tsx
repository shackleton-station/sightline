import { line, scaleLinear } from 'd3'
import { type MouseEvent, useState } from 'react'
import type { SunPath } from '../lib/earthSun'
import { formatUtc, indexAtFraction } from '../lib/timeline'
import { useWidth } from '../lib/useWidth'

interface Row {
  title: string
  path: SunPath
}

interface Props {
  rows: Row[]
  times: string[]
  index: number
  onSelect: (index: number) => void
}

const MARGIN = { top: 10, right: 12, bottom: 4, left: 36 }
const ROW_HEIGHT = 96
/** One scale for every row and every site, so the difference in height is plain to see. */
const DOMAIN_DEG: [number, number] = [-30, 90]
const TICKS_DEG = [0, 45, 90]

/** The Sun's height over the month, one row per place, all on the same scale. */
export function SunPathChart({ rows, times, index, onSelect }: Props) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const count = times.length
  const shown = Math.min(hover ?? index, count - 1)
  const x = (i: number) =>
    MARGIN.left + (i / Math.max(count - 1, 1)) * Math.max(width - MARGIN.left - MARGIN.right, 1)
  const y = scaleLinear(DOMAIN_DEG, [ROW_HEIGHT - MARGIN.bottom, MARGIN.top]).clamp(true)

  const pointerIndex = (event: MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return indexAtFraction((event.clientX - box.left) / box.width, count)
  }

  return (
    <div ref={ref} className="chart sun-paths">
      <p className="sun-path-readout" aria-live="off">
        {times[shown] && formatUtc(times[shown])}
      </p>
      {width > 0 &&
        rows.map((row) => {
          const visible = line<number>()
            .defined((_, i) => row.path.up[i])
            .x((_, i) => x(i))
            .y((el) => y(el))(row.path.el)
          const hidden = line<number>()
            .defined((_, i) => !row.path.up[i])
            .x((_, i) => x(i))
            .y((el) => y(el))(row.path.el)
          return (
            <figure key={row.title}>
              <figcaption>
                {row.title}: <strong>{row.path.el[shown]?.toFixed(1)}°</strong>
              </figcaption>
              <svg
                width={width}
                height={ROW_HEIGHT}
                role="img"
                aria-label={`Sun's height through the month at ${row.title}`}
              >
                {TICKS_DEG.map((el) => (
                  <g key={el}>
                    <line className={el === 0 ? 'level-line' : 'grid'} x1={MARGIN.left} x2={x(count - 1)} y1={y(el)} y2={y(el)} />
                    <text className="tick" x={MARGIN.left - 6} y={y(el) + 4} textAnchor="end">
                      {el}°
                    </text>
                  </g>
                ))}
                <path className="sun-path hidden-sun" d={hidden ?? undefined} />
                <path className="sun-path visible-sun" d={visible ?? undefined} />
                <line className="cursor" x1={x(shown)} x2={x(shown)} y1={MARGIN.top} y2={ROW_HEIGHT - MARGIN.bottom} />
                <rect
                  x={MARGIN.left}
                  y={0}
                  width={Math.max(x(count - 1) - MARGIN.left, 1)}
                  height={ROW_HEIGHT}
                  fill="transparent"
                  onMouseMove={(event) => setHover(pointerIndex(event))}
                  onMouseLeave={() => setHover(null)}
                  onClick={(event) => onSelect(pointerIndex(event))}
                />
              </svg>
            </figure>
          )
        })}
      <p className="note sun-path-key">
        <span className="line-key visible" aria-hidden="true" /> Sun visible{' '}
        <span className="line-key hidden" aria-hidden="true" /> Sun not visible. Across the month, day by day.
      </p>
    </div>
  )
}
