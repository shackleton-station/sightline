import { type PointerEvent, useState } from 'react'
import { type LightHour, lightDays, lightMeans, seriesPaths } from '../lib/missionLight'
import { clockTime } from '../lib/sightline'
import type { MissionLight } from './useMissionLight'

interface Props {
  /** The light over the mission; undefined while it loads, null when the mission runs past the data. */
  light: MissionLight | null | undefined
  /** The start of the data and the landing's hour in it, for the hour under the pointer. */
  start: string
  landing: number
  missionDays: number
}

/** How many days apart the labels under the charts are, so about five fit the column. */
function dayStep(missionDays: number): number {
  return Math.max(1, Math.ceil(missionDays / 5))
}

/** One of the two charts: a share from 0 to 100% against the mission's hours, as a line over its own area. */
function Plot({ kind, name, values, at, onAt }: { kind: 'sun' | 'earth'; name: string; values: number[]; at: number | null; onAt: (index: number | null) => void }) {
  const paths = seriesPaths(values)
  const last = Math.max(values.length - 1, 1)
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onAt(Math.min(last, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * last))))
  }
  return (
    <figure className={`sl-light-chart is-${kind}`}>
      <figcaption>{name}</figcaption>
      <div className="sl-light-plot" onPointerMove={point} onPointerDown={point} onPointerLeave={() => onAt(null)}>
        <svg viewBox={`0 0 ${last} 100`} preserveAspectRatio="none" role="img" aria-label={`${name}, hour by hour over the mission`}>
          <path className="sl-light-area" d={paths.area} />
          <path className="sl-light-line" d={paths.line} vectorEffect="non-scaling-stroke" />
          {at !== null && <line className="sl-light-cross" x1={at} x2={at} y1={0} y2={100} vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="sl-light-y is-top" aria-hidden="true">
          100%
        </span>
        <span className="sl-light-y is-bottom" aria-hidden="true">
          0
        </span>
      </div>
    </figure>
  )
}

const pct = (value: number) => `${Math.round(value)}%`

/**
 * The Sun and Earth over the mission, at the foot of the column: how much of each one's disc is in
 * view at every hour from the landing to the mission's end, as two small charts on one time axis.
 * One line over them gives the averages, or the hour under the pointer. The same numbers by day are
 * in a table behind "By day".
 */
export function LightChart({ light, start, landing, missionDays }: Props) {
  const [at, setAt] = useState<number | null>(null)
  if (light === null) return null
  const hours: LightHour[] = light?.hours ?? []
  const means = lightMeans(hours)
  const step = dayStep(missionDays)
  const here = at !== null && at < hours.length ? hours[at] : null
  return (
    <section className="sl-light" aria-label="The Sun and Earth over the mission">
      <p className="sl-light-head">
        <b>Over the {missionDays}-day mission</b>
        <span role="status">
          {!light
            ? 'Reading the mission’s hours…'
            : here && at !== null
              ? `Day ${Math.floor(at / 24) + 1} · ${clockTime(start, landing + at)} · Sun ${pct(here.sunPct)} · Earth ${pct(here.earthPct)}`
              : `On average: Sun ${pct(means.sunPct)} (${Math.round(light.sunlightWm2)} W/m²) · Earth ${pct(means.earthPct)}`}
        </span>
      </p>
      <Plot kind="sun" name="Sun’s disc in view" values={hours.map((hour) => hour.sunPct)} at={at} onAt={setAt} />
      <Plot kind="earth" name="Earth’s disc in view" values={hours.map((hour) => hour.earthPct)} at={at} onAt={setAt} />
      <div className="sl-light-axis" aria-hidden="true">
        {Array.from({ length: Math.floor(missionDays / step) + 1 }, (_, n) => n * step).map((day) => (
          <span key={day} className={day === missionDays ? 'is-end' : undefined} style={{ left: `${(100 * day) / missionDays}%` }}>
            {day === 0 ? 'landing' : `day ${day}`}
          </span>
        ))}
      </div>
      {light && (
        <details className="sl-light-table">
          <summary>By day</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Sun</th>
                <th scope="col">Earth</th>
              </tr>
            </thead>
            <tbody>
              {lightDays(hours).map((day, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  <td>{pct(day.sunPct)}</td>
                  <td>{pct(day.earthPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  )
}
