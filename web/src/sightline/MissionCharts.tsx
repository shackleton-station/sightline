import { area, line, scaleLinear } from 'd3'
import { type PointerEvent, useMemo, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import type { SiteFlags } from '../lib/flags'
import { hourOf, missionEarth, type Requirements } from '../lib/mission'
import { SOLAR_CONSTANT_W_M2 } from '../lib/power'
import { useWidth } from '../lib/useWidth'

export interface ChartPick {
  letter: string
  name: string
  flags: SiteFlags | null
  /** The landing hour, ISO. */
  t: string
  /** The mission hour by hour from the landing; undefined while it loads, null if it failed. */
  track: TrackPoint[] | null | undefined
}

interface Props {
  picks: ChartPick[]
  requirements: Requirements
  /** Set when the mission's heights aren't 2 m: the track is read at 2 m. */
  heightsNote: string | null
}

/** Each pick's own colour, the same in every chart here. */
const PICK_COLORS = ['#f2c14e', '#5aa9ff', '#3fd99a', '#c792ff']

const MARGIN = { left: 58, right: 12 }

function compact(hours: number): string {
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

function dayTicks(days: number): number[] {
  const step = Math.max(1, Math.ceil(days / 7))
  const ticks = Array.from({ length: Math.floor(days / step) + 1 }, (_, n) => n * step)
  return ticks[ticks.length - 1] === days ? ticks : [...ticks, days]
}

/** Example panel and battery, clearly marked as such: people replace them with their own design. */
const EXAMPLE = { panelM2: 2, efficiencyPct: 30, loadW: 100, batteryKWh: 5 }

interface Battery {
  /** State of charge (0 to 1) at the end of each mission hour. */
  charge: number[]
  /** Hours with the battery empty, and the first such hour. */
  emptyHours: number
  firstEmpty: number | null
  lowest: number
}

/**
 * A battery through the mission, hour by hour: what a vertical panel turned to face the Sun makes from
 * the share of the Sun's disc in view (the pipeline's own sunlight, as `lib/power.ts` counts it), less
 * the load, kept between empty and full. It starts full. A first estimate, with example equipment.
 */
function simulate(track: TrackPoint[], panelM2: number, efficiency: number, loadW: number, batteryWh: number): Battery {
  let stored = batteryWh
  let emptyHours = 0
  let firstEmpty: number | null = null
  let lowest = 1
  const charge: number[] = []
  track.forEach((point, hour) => {
    const el = (point.sun_el * Math.PI) / 180
    const madeWh = SOLAR_CONSTANT_W_M2 * point.sun_frac * Math.max(Math.cos(el), 0) * panelM2 * efficiency
    stored = Math.min(batteryWh, stored + madeWh - loadW)
    if (stored <= 0) {
      stored = 0
      emptyHours += 1
      if (firstEmpty === null) firstEmpty = hour
    }
    const share = batteryWh > 0 ? stored / batteryWh : 0
    lowest = Math.min(lowest, share)
    charge.push(share)
  })
  return { charge, emptyHours, firstEmpty, lowest }
}

/** Runs of `true` in flags[from, from + hours), as [start, end) in mission hours. */
function runs(flags: boolean[], from: number, hours: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let open: number | null = null
  for (let h = 0; h < hours; h += 1) {
    const on = flags[from + h] === true
    if (on && open === null) open = h
    if (!on && open !== null) {
      out.push({ from: open, to: h })
      open = null
    }
  }
  if (open !== null) out.push({ from: open, to: hours })
  return out
}

/** The longest gap between runs (or before the first, or after the last), as [start, end). */
function longestGap(on: { from: number; to: number }[], hours: number): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null
  let at = 0
  for (const run of [...on, { from: hours, to: hours }]) {
    if (run.from > at && (!best || run.from - at > best.to - best.from)) best = { from: at, to: run.from }
    at = Math.max(at, run.to)
  }
  return best
}

/**
 * The picks over their missions, three ways on one time axis, with one cursor for all: the Sun's
 * height (what a solar panel follows), a battery hour by hour (does the lander run out, and when),
 * and the windows of Sun and Earth with the longest dark spell and radio silence named. Each pick
 * keeps its colour throughout.
 */
export function MissionCharts({ picks, requirements, heightsNote }: Props) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const [kit, setKit] = useState(EXAMPLE)
  const hours = requirements.missionDays * 24
  const x = scaleLinear([0, Math.max(hours - 1, 1)], [MARGIN.left, Math.max(width - MARGIN.right, MARGIN.left + 1)])
  const ticks = dayTicks(requirements.missionDays)
  const example = kit.panelM2 === EXAMPLE.panelM2 && kit.efficiencyPct === EXAMPLE.efficiencyPct && kit.loadW === EXAMPLE.loadW && kit.batteryKWh === EXAMPLE.batteryKWh

  const batteries = useMemo(
    () => picks.map((pick) => (pick.track ? simulate(pick.track, kit.panelM2, kit.efficiencyPct / 100, kit.loadW, kit.batteryKWh * 1000) : null)),
    [picks, kit],
  )
  const windows = useMemo(
    () =>
      picks.map((pick) => {
        if (!pick.flags) return null
        const from = hourOf(pick.flags.start, pick.t)
        const span = Math.min(hours, pick.flags.sun.length - from)
        const sun = runs(pick.flags.sun, from, span)
        const earth = runs(missionEarth(pick.flags, requirements), from, span)
        return { sun, earth, dark: longestGap(sun, span), silence: longestGap(earth, span), span }
      }),
    [picks, hours, requirements],
  )
  const domain = useMemo((): [number, number] => {
    const els = picks.flatMap((pick) => (pick.track ?? []).map((point) => point.sun_el))
    if (els.length === 0) return [-1, 2]
    const low = Math.min(0, ...els)
    const high = Math.max(0, ...els)
    const pad = Math.max(0.2, (high - low) * 0.1)
    return [low - pad, high + pad]
  }, [picks])

  const track = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setHover(Math.max(0, Math.min(hours - 1, Math.round(((event.clientX - box.left) / box.width) * (hours - 1)))))
  }
  const cursor = (height: number) => (hover === null ? null : <line className="np-mc-cursor" x1={x(hover)} x2={x(hover)} y1={0} y2={height} />)
  const catcher = (height: number) => <rect x={MARGIN.left} y={0} width={Math.max(x(hours - 1) - MARGIN.left, 1)} height={height} fill="transparent" onPointerMove={track} onPointerLeave={() => setHover(null)} />
  const axis = (
    <div className="np-mc-axis" aria-hidden="true">
      {width > 0 &&
        ticks.map((day) => (
          <span key={day} style={{ left: `${x(Math.min(day * 24, hours - 1))}px` }}>
            {day === 0 ? 'landing' : `day ${day}`}
          </span>
        ))}
    </div>
  )
  const atHover = hover === null ? 'Hover a chart to read every pick at one hour.' : `${compact(hover)} after landing`

  // The Sun's height, every pick on one scale.
  const SUN_H = 150
  const ySun = scaleLinear(domain, [SUN_H - 8, 8])
  // The battery, from empty to full.
  const BAT_H = 130
  const yBat = scaleLinear([0, 1], [BAT_H - 8, 8])
  const ROW_H = 22

  return (
    <section className="np-mc" aria-labelledby="np-mc-title" ref={ref}>
      <header className="np-mc-head">
        <h3 id="np-mc-title">Over the mission, side by side</h3>
        <p className="np-mc-hover">{atHover}</p>
      </header>
      <p className="np-mc-legend">
        {picks.map((pick, i) => (
          <span key={pick.letter}>
            <i style={{ background: PICK_COLORS[i] }} /> {pick.letter} · {pick.name}
          </span>
        ))}
      </p>

      {/* 1. The Sun's height */}
      <figure className="np-mc-chart">
        <figcaption>
          <b>The Sun's height</b> — solar elevation over a level horizon; solid while it is in view, faint while the terrain hides it.
        </figcaption>
        {width > 0 && (
          <svg width={width} height={SUN_H} role="img" aria-label="The Sun's height over each mission, every pick on one scale">
            {[Math.ceil(domain[0]), 0, Math.floor(domain[1])]
              .filter((tick, i, all) => all.indexOf(tick) === i && tick >= domain[0] && tick <= domain[1])
              .map((tick) => (
                <g key={tick}>
                  <line className={tick === 0 ? 'np-mc-level' : 'np-mc-grid'} x1={MARGIN.left} x2={x(hours - 1)} y1={ySun(tick)} y2={ySun(tick)} />
                  <text className="np-mc-tick" x={MARGIN.left - 6} y={ySun(tick) + 3.5} textAnchor="end">
                    {tick}°
                  </text>
                </g>
              ))}
            {picks.map((pick, i) => {
              if (!pick.track) return null
              const up = pick.track.map((point) => point.sun_up)
              const seen = line<TrackPoint>()
                .defined((_, h) => up[h])
                .x((_, h) => x(h))
                .y((point) => ySun(point.sun_el))(pick.track)
              const all = line<TrackPoint>()
                .x((_, h) => x(h))
                .y((point) => ySun(point.sun_el))(pick.track)
              return (
                <g key={pick.letter} style={{ color: PICK_COLORS[i] }}>
                  <path className="np-mc-faint" d={all ?? ''} />
                  <path className="np-mc-line" d={seen ?? ''} />
                  {hover !== null && pick.track[hover] && <circle className="np-mc-dot" cx={x(hover)} cy={ySun(pick.track[hover].sun_el)} r={3.5} />}
                </g>
              )
            })}
            {cursor(SUN_H)}
            {catcher(SUN_H)}
          </svg>
        )}
        {axis}
        <p className="np-mc-read">
          {picks.map((pick, i) => {
            const point = hover !== null ? pick.track?.[hover] : null
            const up = (pick.track ?? []).filter((one) => one.sun_up).map((one) => one.sun_el)
            return (
              <span key={pick.letter} style={{ color: PICK_COLORS[i] }}>
                {pick.letter}{' '}
                <b>{point ? `${point.sun_el.toFixed(1)}°${point.sun_up ? '' : ' hidden'}` : up.length > 0 ? `${Math.min(...up).toFixed(1)}–${Math.max(...up).toFixed(1)}°` : '–'}</b>
              </span>
            )
          })}
        </p>
      </figure>

      {/* 2. The battery */}
      <figure className="np-mc-chart">
        <figcaption>
          <b>Battery through the mission</b> — a panel turned to face the Sun charges it, the load drains it; it starts full.{' '}
          <span className="np-mc-kit">
            {(
              [
                ['Panel', 'panelM2', 'm²', 0.5, 50, 0.5],
                ['Efficiency', 'efficiencyPct', '%', 5, 50, 1],
                ['Load', 'loadW', 'W', 10, 2000, 10],
                ['Battery', 'batteryKWh', 'kWh', 0.5, 100, 0.5],
              ] as const
            ).map(([label, key, unit, min, max, step]) => (
              <label key={key}>
                {label}
                <input type="number" min={min} max={max} step={step} value={kit[key]} onChange={(event) => Number.isFinite(Number(event.target.value)) && Number(event.target.value) >= min && setKit({ ...kit, [key]: Number(event.target.value) })} />
                <small>{unit}</small>
              </label>
            ))}
            {example ? (
              <em>example values: set your own</em>
            ) : (
              <button type="button" className="sl-link" onClick={() => setKit(EXAMPLE)}>
                back to the example
              </button>
            )}
          </span>
        </figcaption>
        {width > 0 && (
          <svg width={width} height={BAT_H} role="img" aria-label="Each pick's battery charge over the mission">
            <rect className="np-mc-empty" x={MARGIN.left} y={yBat(0.1)} width={Math.max(x(hours - 1) - MARGIN.left, 1)} height={yBat(0) - yBat(0.1)} />
            {[0, 0.5, 1].map((tick) => (
              <g key={tick}>
                <line className="np-mc-grid" x1={MARGIN.left} x2={x(hours - 1)} y1={yBat(tick)} y2={yBat(tick)} />
                <text className="np-mc-tick" x={MARGIN.left - 6} y={yBat(tick) + 3.5} textAnchor="end">
                  {Math.round(tick * 100)}%
                </text>
              </g>
            ))}
            {picks.map((pick, i) => {
              const battery = batteries[i]
              if (!battery) return null
              const fill = area<number>()
                .x((_, h) => x(h))
                .y0(yBat(0))
                .y1((share) => yBat(share))(battery.charge)
              const edge = line<number>()
                .x((_, h) => x(h))
                .y((share) => yBat(share))(battery.charge)
              return (
                <g key={pick.letter} style={{ color: PICK_COLORS[i] }}>
                  <path className="np-mc-area" d={fill ?? ''} />
                  <path className="np-mc-line" d={edge ?? ''} />
                  {battery.firstEmpty !== null && <circle className="np-mc-empty-dot" cx={x(battery.firstEmpty)} cy={yBat(0)} r={4} />}
                  {hover !== null && battery.charge[hover] !== undefined && <circle className="np-mc-dot" cx={x(hover)} cy={yBat(battery.charge[hover])} r={3.5} />}
                </g>
              )
            })}
            {cursor(BAT_H)}
            {catcher(BAT_H)}
          </svg>
        )}
        {axis}
        <p className="np-mc-read">
          {picks.map((pick, i) => {
            const battery = batteries[i]
            return (
              <span key={pick.letter} style={{ color: PICK_COLORS[i] }}>
                {pick.letter}{' '}
                <b>
                  {!battery
                    ? '…'
                    : hover !== null && battery.charge[hover] !== undefined
                      ? `${Math.round(battery.charge[hover] * 100)}%`
                      : battery.firstEmpty === null
                        ? `never runs out (lowest ${Math.round(battery.lowest * 100)}%)`
                        : `empty on day ${Math.floor(battery.firstEmpty / 24) + 1}, for ${compact(battery.emptyHours)}`}
                </b>
              </span>
            )
          })}
        </p>
      </figure>

      {/* 3. Sun and Earth windows */}
      <figure className="np-mc-chart">
        <figcaption>
          <b>Sun and Earth windows</b> — when each pick has sunlight and a direct radio link, with its longest dark spell and longest silence named.
        </figcaption>
        {width > 0 && (
          <svg width={width} height={picks.length * (2 * ROW_H + 10)} role="img" aria-label="Each pick's sunlit and Earth-in-view stretches over the mission">
            {picks.map((pick, i) => {
              const w = windows[i]
              const top = i * (2 * ROW_H + 10)
              return (
                <g key={pick.letter} transform={`translate(0 ${top})`}>
                  <text className="np-mc-row-name" x={MARGIN.left - 6} y={ROW_H - 6} textAnchor="end" style={{ fill: PICK_COLORS[i] }}>
                    {pick.letter} Sun
                  </text>
                  <text className="np-mc-row-name" x={MARGIN.left - 6} y={2 * ROW_H - 6} textAnchor="end" style={{ fill: PICK_COLORS[i] }}>
                    Earth
                  </text>
                  <rect className="np-mc-lane" x={MARGIN.left} y={4} width={Math.max(x(hours - 1) - MARGIN.left, 1)} height={ROW_H - 8} />
                  <rect className="np-mc-lane" x={MARGIN.left} y={ROW_H + 4} width={Math.max(x(hours - 1) - MARGIN.left, 1)} height={ROW_H - 8} />
                  {w?.sun.map((run) => <rect key={`s${run.from}`} className="np-mc-sun" x={x(run.from)} y={4} width={Math.max(1, x(run.to) - x(run.from))} height={ROW_H - 8} />)}
                  {w?.earth.map((run) => <rect key={`e${run.from}`} className="np-mc-earth" x={x(run.from)} y={ROW_H + 4} width={Math.max(1, x(run.to) - x(run.from))} height={ROW_H - 8} />)}
                  {w?.dark && w.dark.to - w.dark.from >= 2 && (
                    <text className={`np-mc-gap ${w.dark.to - w.dark.from > requirements.maxSunGapH ? 'is-over' : ''}`} x={(x(w.dark.from) + x(w.dark.to)) / 2} y={ROW_H - 7} textAnchor="middle">
                      dark {compact(w.dark.to - w.dark.from)}
                    </text>
                  )}
                  {w?.silence && w.silence.to - w.silence.from >= 2 && (
                    <text className={`np-mc-gap ${w.silence.to - w.silence.from > requirements.maxEarthGapH ? 'is-over' : ''}`} x={(x(w.silence.from) + x(w.silence.to)) / 2} y={2 * ROW_H - 7} textAnchor="middle">
                      silent {compact(w.silence.to - w.silence.from)}
                    </text>
                  )}
                </g>
              )
            })}
            {cursor(picks.length * (2 * ROW_H + 10))}
            {catcher(picks.length * (2 * ROW_H + 10))}
          </svg>
        )}
        {axis}
        <p className="np-mc-note">
          <i className="np-mc-swatch is-sun" /> Sun in view <i className="np-mc-swatch is-earth" /> Earth in view (by your rule). Named gaps in orange run past your limit.{heightsNote ? ` ${heightsNote}` : ''}
        </p>
      </figure>
    </section>
  )
}
