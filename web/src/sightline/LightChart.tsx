import type { PointerEvent } from 'react'
import { seriesPaths, type SpanStats } from '../lib/missionLight'
import { clockTime } from '../lib/sightline'

/** One body over the mission: its longest time down against the mission's limit, and its share in view at each hour. */
export interface BodyOver extends SpanStats {
  /** The longest the mission allows the body to be down, in hours; null when the mission sets no limit. */
  limitH: number | null
  /** The share of its disc in view at each hour from the landing, in percent; null while the mission's hours load. */
  values: number[] | null
  /** The Sun's row only: its elevation from level while it is up during the mission; null if it never is, undefined while the hours load. */
  whileUp?: { lowDeg: number; highDeg: number } | null
}

interface Props {
  kind: 'sun' | 'earth'
  over: BodyOver
  missionDays: number
  /** The hour under the pointer, shared by both rows so one crosshair runs through both charts. */
  at: number | null
  onAt: (hour: number | null) => void
}

const WHOSE = { sun: "the Sun's", earth: "Earth's" }

/** How many days apart the labels under the charts are, so about five fit the column. */
function dayStep(missionDays: number): number {
  return Math.max(1, Math.ceil(missionDays / 5))
}

/**
 * The Sun or Earth over the whole mission, drawn under its row's figures: the share of its disc in
 * view at every hour from the landing to the mission's end, with its longest time down shaded, in
 * red when it breaks the mission's limit. The row's own line above it names that time against the
 * limit; nothing is written over the chart. The shading is from the same hourly flags as the verdict.
 * The two rows' charts share one line of days under the second (`OverAxis`).
 */
export function OverChart({ kind, over, missionDays, at, onAt }: Props) {
  const hours = over.totalHours
  const last = Math.max(hours - 1, 1)
  const paths = over.values ? seriesPaths(over.values) : null
  const gap = over.gap
  const breaks = gap !== null && over.limitH !== null && gap.hours > over.limitH
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onAt(Math.min(last, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * last))))
  }
  return (
    <dd className="sl-over-plot" onPointerMove={point} onPointerDown={point} onPointerLeave={() => onAt(null)}>
      <svg viewBox={`0 0 ${last} 100`} preserveAspectRatio="none" role="img" aria-label={`The share of ${WHOSE[kind]} disc in view at each hour of the ${missionDays}-day mission${gap ? `. Its longest time out of view, ${gap.hours} hours, is shaded` : ''}`}>
        {gap && <rect className={breaks ? 'sl-over-gap is-miss' : 'sl-over-gap'} x={gap.start} y={0} width={Math.min(gap.hours, last - gap.start)} height={100} />}
        {paths && <path className="sl-over-area" d={paths.area} />}
        {paths && <path className="sl-over-line" d={paths.line} vectorEffect="non-scaling-stroke" />}
        {at !== null && <line className="sl-over-cross" x1={at} x2={at} y1={0} y2={100} vectorEffect="non-scaling-stroke" />}
      </svg>
    </dd>
  )
}

interface AxisProps {
  /** The start of the data and the landing's hour in it, for the hour under the pointer. */
  start: string
  landing: number
  missionDays: number
  at: number | null
  sun: BodyOver
  earth: BodyOver
}

/**
 * The days since landing, once, under the second of the two charts. With the pointer over either
 * chart it gives that hour instead, and how much of each disc is in view then.
 */
export function OverAxis({ start, landing, missionDays, at, sun, earth }: AxisProps) {
  const step = dayStep(missionDays)
  const sunHere = at !== null && sun.values && at < sun.values.length ? sun.values[at] : null
  const earthHere = at !== null && earth.values && at < earth.values.length ? earth.values[at] : null
  if (at !== null && sunHere !== null && earthHere !== null) {
    return (
      <dd className="sl-over-axis is-at" role="status">
        Day {Math.floor(at / 24) + 1} · {clockTime(start, landing + at)} · Sun {Math.round(sunHere)}% · Earth {Math.round(earthHere)}%
      </dd>
    )
  }
  return (
    <dd className="sl-over-axis" aria-hidden="true">
      {Array.from({ length: Math.floor(missionDays / step) + 1 }, (_, n) => n * step).map((day) => (
        <span key={day} className={day === missionDays ? 'is-end' : undefined} style={{ left: `${(100 * day) / missionDays}%` }}>
          {day === 0 ? 'landing' : `day ${day}`}
        </span>
      ))}
    </dd>
  )
}
