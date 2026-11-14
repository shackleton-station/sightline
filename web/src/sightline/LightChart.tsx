import type { PointerEvent } from 'react'
import { seriesPaths, type SpanStats } from '../lib/missionLight'
import { clockTime } from '../lib/sightline'

/** One body over the mission: its longest time down against the mission's limit, and its share in view at each hour. */
export interface BodyOver extends SpanStats {
  /** The longest the mission allows the body to be down, in hours; null when the mission sets no limit. */
  limitH: number | null
  /** The share of its disc in view at each hour from the landing, in percent; null while the mission's hours load. */
  values: number[] | null
}

interface Props {
  kind: 'sun' | 'earth'
  over: BodyOver
  /** The start of the data, the landing's hour in it and the mission's length, for the days under the chart and the hour under the pointer. */
  start: string
  landing: number
  missionDays: number
  /** The hour under the pointer, shared by both rows so one crosshair runs through both charts. */
  at: number | null
  onAt: (hour: number | null) => void
}

const WORDS = { sun: { whose: "the Sun's", down: 'dark', gap: 'longest dark spell' }, earth: { whose: "Earth's", down: 'radio silence', gap: 'longest radio silence' } }

/** How many days apart the labels under a chart are, so about five fit the column. */
function dayStep(missionDays: number): number {
  return Math.max(1, Math.ceil(missionDays / 5))
}

/**
 * The Sun or Earth over the whole mission, drawn under its row's figures: the share of its disc in
 * view at every hour from the landing to the mission's end, with its longest time down shaded and
 * named against the mission's limit, in the warning colour when it breaks it. The row's own figures
 * (the body at the landing's hour) are untouched above it. The longest time down is from the same
 * hourly flags as the verdict. The pointer over the chart gives that hour where the days are.
 */
export function OverChart({ kind, over, start, landing, missionDays, at, onAt }: Props) {
  const words = WORDS[kind]
  const hours = over.totalHours
  const last = Math.max(hours - 1, 1)
  const paths = over.values ? seriesPaths(over.values) : null
  const gap = over.gap
  const breaks = gap !== null && over.limitH !== null && gap.hours > over.limitH
  const here = at !== null && over.values && at < over.values.length ? over.values[at] : null
  const step = dayStep(missionDays)
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onAt(Math.min(last, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * last))))
  }
  return (
    <>
      <dd className="sl-over-plot" onPointerMove={point} onPointerDown={point} onPointerLeave={() => onAt(null)}>
        <svg viewBox={`0 0 ${last} 100`} preserveAspectRatio="none" role="img" aria-label={`The share of ${words.whose} disc in view at each hour of the ${missionDays}-day mission${gap ? `. The ${words.gap}, ${gap.hours} hours, is shaded` : ''}`}>
          {gap && <rect className={breaks ? 'sl-over-gap is-miss' : 'sl-over-gap'} x={gap.start} y={0} width={Math.min(gap.hours, last - gap.start)} height={100} />}
          {paths && <path className="sl-over-area" d={paths.area} />}
          {paths && <path className="sl-over-line" d={paths.line} vectorEffect="non-scaling-stroke" />}
          {at !== null && <line className="sl-over-cross" x1={at} x2={at} y1={0} y2={100} vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* The longest time down, named on its own side of the chart, where the line is at the bottom. */}
        {gap && (
          <span className={`sl-over-note${breaks ? ' is-miss' : ''}${gap.start + gap.hours / 2 < hours / 2 ? ' is-left' : ''}`}>
            {breaks && <span aria-hidden="true">✗ </span>}
            {gap.hours} h {words.down} · {over.limitH === null ? 'no limit set' : `limit ${over.limitH} h`}
          </span>
        )}
      </dd>
      {here !== null && at !== null ? (
        <dd className="sl-over-axis is-at" role="status">
          Day {Math.floor(at / 24) + 1} · {clockTime(start, landing + at)} · {Math.round(here)}% of its disc in view
        </dd>
      ) : (
        <dd className="sl-over-axis" aria-hidden="true">
          {Array.from({ length: Math.floor(missionDays / step) + 1 }, (_, n) => n * step).map((day) => (
            <span key={day} className={day === missionDays ? 'is-end' : undefined} style={{ left: `${(100 * day) / missionDays}%` }}>
              {day === 0 ? 'landing' : `day ${day}`}
            </span>
          ))}
        </dd>
      )}
    </>
  )
}
