import { line, scaleLinear } from 'd3'
import { type MouseEvent, useMemo, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { formatDuration } from '../lib/nextChange'
import { useWidth } from '../lib/useWidth'

interface Row {
  letter: string
  name: string
  /** The mission hour by hour from its landing; undefined while it loads, null if it failed. */
  track: TrackPoint[] | null | undefined
}

interface Props {
  rows: Row[]
  missionDays: number
}

const ROW_HEIGHT = 58
const MARGIN = { top: 6, bottom: 6, left: 34, right: 8 }

/**
 * The Sun's height over each mission, one row per scenario, every row on the same scale and lined
 * up on its own landing, so a low Sun shows at a glance: solar elevation is what a panel's output
 * follows. Heights are from a level horizon (the pipeline's own figure); the line is solid while the
 * Sun can be seen over the real terrain and faint while the terrain hides it. Hover to read every
 * row at the same hour of its mission.
 */
export function PlannerSunChart({ rows, missionDays }: Props) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const hours = missionDays * 24
  // One scale for every row, fitted to the heights on show, always including the level horizon.
  const domain = useMemo((): [number, number] => {
    const els = rows.flatMap((row) => (row.track ?? []).map((point) => point.sun_el))
    if (els.length === 0) return [-1, 2]
    const low = Math.min(0, ...els)
    const high = Math.max(0, ...els)
    const pad = Math.max(0.2, (high - low) * 0.08)
    return [low - pad, high + pad]
  }, [rows])
  const x = scaleLinear([0, Math.max(hours - 1, 1)], [MARGIN.left, Math.max(width - MARGIN.right, MARGIN.left + 1)])
  const y = scaleLinear(domain, [ROW_HEIGHT - MARGIN.bottom, MARGIN.top])
  const ticks = [domain[0] < -0.5 ? Math.ceil(domain[0]) : null, 0, Math.floor(domain[1])].filter((tick, i, all): tick is number => tick !== null && all.indexOf(tick) === i && tick >= domain[0] && tick <= domain[1])

  const atPointer = (event: MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(hours - 1, Math.round(((event.clientX - box.left) / box.width) * (hours - 1))))
  }
  const hourWords = (h: number) => (h === 0 ? 'at landing' : `${formatDuration(h)} after landing`)

  return (
    <section className="pl-sunchart" aria-labelledby="pl-sunchart-title" ref={ref}>
      <h3 id="pl-sunchart-title">The Sun's height over each mission</h3>
      <p className="sl-quiet">
        Solar elevation, what a panel's power follows. Every row on one scale and lined up on its own landing. {hover === null ? 'Hover to read an hour.' : `Reading ${hourWords(hover)}.`}
      </p>
      {width > 0 &&
        rows.map((row) => {
          const track = row.track
          const at = track && hover !== null ? (track[hover] ?? null) : null
          const up = (track ?? []).map((point) => point.sun_up)
          const seen = track
            ? line<TrackPoint>()
                .defined((_, i) => up[i])
                .x((_, i) => x(i))
                .y((point) => y(point.sun_el))(track)
            : null
          const hidden = track
            ? line<TrackPoint>()
                .defined((_, i) => !up[i])
                .x((_, i) => x(i))
                .y((point) => y(point.sun_el))(track)
            : null
          const whileUp = track ? track.filter((point) => point.sun_up).map((point) => point.sun_el) : []
          return (
            <figure key={row.letter} className="pl-sunrow">
              <figcaption>
                <span className="pl-sunrow-letter">{row.letter}</span> {row.name}
                <span className="pl-sunrow-read">
                  {track === undefined
                    ? 'Loading…'
                    : track === null
                      ? 'Didn’t load'
                      : at
                        ? `${at.sun_el.toFixed(1)}°${at.sun_up ? '' : ', hidden'}`
                        : whileUp.length > 0
                          ? `${Math.min(...whileUp).toFixed(1)}° to ${Math.max(...whileUp).toFixed(1)}° while up`
                          : 'never up'}
                </span>
              </figcaption>
              <svg width={width} height={ROW_HEIGHT} role="img" aria-label={`The Sun's height over the mission at ${row.name}${whileUp.length > 0 ? `: ${Math.min(...whileUp).toFixed(1)}° to ${Math.max(...whileUp).toFixed(1)}° while it is up` : ''}.`}>
                {ticks.map((tick) => (
                  <g key={tick}>
                    <line className={tick === 0 ? 'pl-sun-level' : 'pl-sun-grid'} x1={MARGIN.left} x2={x(hours - 1)} y1={y(tick)} y2={y(tick)} />
                    <text className="pl-sun-tick" x={MARGIN.left - 5} y={y(tick) + 3.5} textAnchor="end">
                      {tick}°
                    </text>
                  </g>
                ))}
                <path className="pl-sun-hidden" d={hidden ?? undefined} />
                <path className="pl-sun-seen" d={seen ?? undefined} />
                {hover !== null && <line className="pl-sun-cursor" x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={ROW_HEIGHT - MARGIN.bottom} />}
                <rect x={MARGIN.left} y={0} width={Math.max(x(hours - 1) - MARGIN.left, 1)} height={ROW_HEIGHT} fill="transparent" onMouseMove={(event) => setHover(atPointer(event))} onMouseLeave={() => setHover(null)} />
              </svg>
            </figure>
          )
        })}
      <p className="sl-legend">
        <i className="pl-sun-key is-seen" /> Sun in view <i className="pl-sun-key is-hidden" /> behind the terrain <i className="pl-sun-key is-level" /> level horizon (0°). From landing to day {missionDays}.
      </p>
    </section>
  )
}
