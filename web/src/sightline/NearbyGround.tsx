import { useEffect, useMemo, useRef, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { CUSTOM_GROUP } from '../data/customSite'
import { loadNearby, type NearbyData } from '../data/loadNearby'
import { monthLabel } from '../lib/months'
import { bestSpots, cellAt, cellLatLon, cellOffsetM, cellValue, centerCell, type NearbyMetric, slopeDeg, withinSlope } from '../lib/nearby'
import type { SightlineMission } from '../lib/sightlineMission'
import { useWidth } from '../lib/useWidth'
import { clock } from './clockFace'
import { drawPolarPhoto, usePolarPhoto } from './usePolarPhoto'

interface Props {
  site: SiteInfo
  /** The ridge site whose nearby map covers `site`: the site itself, or for a point of your own the closest one. */
  anchor: SiteInfo
  month: string
  mission: SightlineMission
  /** Move the landing on show to a spot. */
  onSpot: (lat: number, lon: number) => void
}

const MEASURES: { metric: NearbyMetric; label: string; words: string; lowerIsBetter?: boolean }[] = [
  { metric: 'both', label: 'Sun and Earth', words: 'Sun and Earth together (power and radio)' },
  { metric: 'sun', label: 'Sun', words: 'Sun (power)' },
  { metric: 'earth', label: 'Earth', words: 'Earth in view (radio)' },
  { metric: 'sunGap', label: 'Longest dark', words: 'longest time without Sun', lowerIsBetter: true },
]
const SPOTS = 4

/** Dark violet (poor) to gold (good), for tinting the photo by how good each square is. */
function ramp(good: number): string {
  const t = Math.max(0, Math.min(1, good))
  const stops = [
    [70, 40, 140],
    [40, 140, 170],
    [90, 200, 120],
    [242, 193, 78],
  ]
  const at = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(at))
  const f = at - i
  const [r, g, b] = stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f))
  return `rgb(${r} ${g} ${b})`
}

function valueWords(metric: NearbyMetric, value: number): string {
  return metric === 'sunGap' ? `${value} h` : `${value}%`
}

/**
 * Is there better ground nearby? The ground within 5 km of a ridge site, this month: the real photo,
 * tinted by how much Sun, Earth or darkness each 100 m square gets (the pipeline's own month for
 * that spot), ground steeper than the mission's limit greyed, and arrows to the best places that
 * beat the site. One plain sentence says how much better, how far and which way.
 */
export function NearbyGround({ site, anchor, month, mission, onSpot }: Props) {
  const [data, setData] = useState<NearbyData | null>(null)
  const [failed, setFailed] = useState(false)
  const [metric, setMetric] = useState<NearbyMetric>('both')
  const [gentle, setGentle] = useState(true)
  useEffect(() => {
    if (!anchor.nearby_half_m) return
    let current = true
    loadNearby(anchor.id, month)
      .then((loaded) => current && setData(loaded))
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [anchor, month])
  const shown = data?.siteId === anchor.id && data.month === month ? data : null
  const limit = gentle ? mission.maxSlopeDeg : null
  const measure = MEASURES.find((one) => one.metric === metric) ?? MEASURES[0]
  // Your landing's own square: the map's centre for a ridge site, wherever it falls for a point of your own.
  const from = shown ? (cellAt(shown.meta, site.lat, site.lon) ?? centerCell(shown.meta)) : 0
  const spots = useMemo(() => (shown ? bestSpots(shown.meta, shown.values, metric, shown.slope, limit, SPOTS, from) : []), [shown, metric, limit, from])

  const [box, width] = useWidth()
  const side = Math.min(width, 600)
  const reachM = shown?.meta.half_width_m ?? 0
  const centre = useMemo(() => (shown ? { x: shown.meta.center_x_m, y: shown.meta.center_y_m } : null), [shown])
  const photo = usePolarPhoto(centre, reachM, side)

  // The tint: one pixel a square, coloured by how good it is; too steep is grey.
  const tint = useMemo(() => {
    if (!shown) return null
    const { meta, values, slope } = shown
    const worst = metric === 'sunGap' ? Math.max(1, ...Array.from(values.sunGapH)) : 100
    const out = document.createElement('canvas')
    out.width = meta.size
    out.height = meta.size
    const g = out.getContext('2d')
    if (!g) return null
    for (let cell = 0; cell < meta.size * meta.size; cell += 1) {
      const value = cellValue(values, metric, cell)
      const good = metric === 'sunGap' ? 1 - value / worst : value / 100
      g.fillStyle = withinSlope(slope, meta.slope_quant_deg, cell, limit) ? ramp(good) : 'rgb(128 128 128)'
      g.fillRect(cell % meta.size, Math.floor(cell / meta.size), 1, 1)
    }
    return out
  }, [shown, metric, limit])
  // Ground steeper than the limit, darkened so the usable ground stands out.
  const steepMask = useMemo(() => {
    if (!shown || limit === null) return null
    const { meta, slope } = shown
    const out = document.createElement('canvas')
    out.width = meta.size
    out.height = meta.size
    const g = out.getContext('2d')
    if (!g) return null
    g.fillStyle = '#000'
    for (let cell = 0; cell < meta.size * meta.size; cell += 1) {
      if (!withinSlope(slope, meta.slope_quant_deg, cell, limit)) g.fillRect(cell % meta.size, Math.floor(cell / meta.size), 1, 1)
    }
    return out
  }, [shown, limit])

  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || !shown || !tint || !centre || side === 0) return
    const ratio = window.devicePixelRatio || 1
    element.style.width = `${side}px`
    element.style.height = `${side}px`
    element.width = Math.round(side * ratio)
    element.height = Math.round(side * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = '#000'
    context.fillRect(0, 0, side, side)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    const cell = side / shown.meta.size
    if (photo) {
      drawPolarPhoto(context, photo, centre, reachM, side)
      context.globalCompositeOperation = 'color'
      context.globalAlpha = 0.9
      context.drawImage(tint, -cell / 2, -cell / 2, side + cell, side + cell)
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 0.18
      context.drawImage(tint, -cell / 2, -cell / 2, side + cell, side + cell)
      context.globalAlpha = 1
    } else {
      context.globalAlpha = 0.85
      context.drawImage(tint, -cell / 2, -cell / 2, side + cell, side + cell)
      context.globalAlpha = 1
    }
    if (steepMask) {
      context.globalAlpha = 0.55
      context.drawImage(steepMask, -cell / 2, -cell / 2, side + cell, side + cell)
      context.globalAlpha = 1
    }
    // A scale bar: 1 km.
    const perM = side / (2 * reachM)
    context.fillStyle = 'rgb(0 0 0 / 55%)'
    context.fillRect(6, side - 28, 1000 * perM + 10, 22)
    context.fillStyle = '#fff'
    context.fillRect(11, side - 12, 1000 * perM, 2)
    context.font = '11px system-ui, sans-serif'
    context.fillText('1 km', 11, side - 16)
  }, [shown, tint, steepMask, photo, side, reachM, centre])

  if (!anchor.nearby_half_m) return null
  if (failed) return <p className="sl-quiet">The ground around {site.name} couldn't be loaded.</p>
  if (!shown) return <p className="sl-quiet">Reading the ground around {site.name}…</p>

  const { meta, values, slope } = shown
  const center = from
  const own = site.group === CUSTOM_GROUP
  const place = own ? 'your point' : site.name
  const here = cellValue(values, metric, center)
  // Offsets on the map are from its centre; distances and directions are from your landing.
  const origin = cellOffsetM(meta, center)
  const offsetOf = (cell: number) => {
    const at = cellOffsetM(meta, cell)
    return { x: at.x - origin.x, y: at.y - origin.y }
  }
  const lower = measure.lowerIsBetter === true
  const best = spots[0]
  const bestValue = best !== undefined ? cellValue(values, metric, best) : null
  const bestAt = best !== undefined ? offsetOf(best) : null
  const perM = side / (2 * reachM)
  const toPx = (offset: { x: number; y: number }) => ({ x: side / 2 + offset.x * perM, y: side / 2 - offset.y * perM })
  const hereSteep = !withinSlope(slope, meta.slope_quant_deg, center, limit)
  const change = (value: number) => (lower ? here - value : value - here)

  return (
    <section className="np-near" aria-labelledby="np-near-title">
      <h5 id="np-near-title">Is there better ground nearby?</h5>
      <p className="np-lead">
        <b>Is {place} the best spot around, or just the one on the list?</b> Sun (power) and Earth (radio) change square by square along a ridge. Every {meta.step_m} m square within {meta.half_width_m / 1000} km of {own ? anchor.name : site.name} is checked for {monthLabel(month)} the same way as {place}: gold does better, violet worse. <b>Go</b> moves your landing to the best one.
      </p>
      {bestValue !== null && bestAt && best !== undefined ? (
        <p className="np-act">
          <button
            type="button"
            className="np-act-go"
            onClick={() => {
              const { lat, lon } = cellLatLon(meta, best)
              onSpot(lat, lon)
            }}
          >
            Go {(Math.hypot(bestAt.x, bestAt.y) / 1000).toFixed(1)} km at {clock(bestAt.x, bestAt.y)}
          </button>
          <span>
            <b className="is-better">{valueWords(metric, bestValue)}</b> instead of <b>{valueWords(metric, here)}</b> {metric === 'sunGap' ? 'at most without Sun' : measure.words} in {monthLabel(month)}
            {hereSteep ? `; ${place} is also steeper than your limit` : ''}
          </span>
        </p>
      ) : (
        <p className="np-act is-done">
          <span>
            ✓ Nowhere on this map beats {place} this month: <b>{valueWords(metric, here)}</b> {metric === 'sunGap' ? 'at most without Sun' : measure.words}.
          </span>
        </p>
      )}
      <div className="np-near-controls">
        <span className="np-near-pills" role="group" aria-label="What to compare">
          {MEASURES.map((one) => (
            <button key={one.metric} type="button" aria-pressed={one.metric === metric} onClick={() => setMetric(one.metric)}>
              {one.label}
            </button>
          ))}
        </span>
        <label className="np-near-gentle">
          <input type="checkbox" checked={gentle} onChange={(event) => setGentle(event.target.checked)} /> Only ground under {mission.maxSlopeDeg}° (your limit)
        </label>
      </div>
      <div className="np-near-stage" ref={box}>
        <canvas ref={canvas} role="img" aria-label={`The ground within ${meta.half_width_m / 1000} km of ${site.name}, tinted by ${measure.words}, with the best spots marked`} />
        {side > 0 && (
          <svg className="np-near-overlay" width={side} height={side} aria-hidden="true">
            {spots.map((cell, i) => {
              const to = toPx(cellOffsetM(meta, cell))
              return <line key={`l${cell}`} className="np-near-arrow" x1={toPx(origin).x} y1={toPx(origin).y} x2={to.x} y2={to.y} style={{ animationDelay: `${i * 0.15}s` }} />
            })}
            <circle className="np-near-site" cx={toPx(origin).x} cy={toPx(origin).y} r={9} />
            <circle className="np-near-site-dot" cx={toPx(origin).x} cy={toPx(origin).y} r={3} />
            {spots.map((cell, i) => {
              const to = toPx(cellOffsetM(meta, cell))
              return (
                <g key={cell} className="np-near-spot" style={{ animationDelay: `${0.3 + i * 0.15}s` }}>
                  <circle cx={to.x} cy={to.y} r={11} />
                  <text x={to.x} y={to.y + 4} textAnchor="middle">
                    {i + 1}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <div className="np-near-scale">
        <span>{metric === 'sunGap' ? 'longest dark' : 'none'}</span>
        <i />
        <span>{metric === 'sunGap' ? 'no dark' : 'all of the month'}</span>
        {gentle && (
          <>
            <b className="np-near-steep" /> <span>steeper than {mission.maxSlopeDeg}°</span>
          </>
        )}
        <b className="np-near-ring" /> <span>{own ? 'Your point' : site.name}</span>
      </div>
      {spots.length > 0 && (
        <ol className="np-near-spots">
          {spots.map((cell, i) => {
            const offset = offsetOf(cell)
            const value = cellValue(values, metric, cell)
            const gain = change(value)
            return (
              <li key={cell}>
                <span className="np-near-num">{i + 1}</span>
                <span className="np-near-where">
                  <b>{(Math.hypot(offset.x, offset.y) / 1000).toFixed(1)} km</b> at {clock(offset.x, offset.y)}
                  <small>slope {slopeDeg(slope, meta.slope_quant_deg, cell).toFixed(1)}°</small>
                </span>
                <span className="np-near-val">
                  {valueWords(metric, value)} <em>{metric === 'sunGap' ? `${gain} h less dark` : `+${gain} pts`}</em>
                </span>
                <button
                  type="button"
                  className="sl-small"
                  onClick={() => {
                    const { lat, lon } = cellLatLon(meta, cell)
                    onSpot(lat, lon)
                  }}
                >
                  Go there
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <p className="np-near-how">
        <b>How this works:</b> every {meta.step_m} m square within {meta.half_width_m / 1000} km is worked out like the site itself, from NASA's LOLA terrain and the Sun's and Earth's positions, for {monthLabel(month)}, {meta.obs_height_m} m above the ground; slope over {meta.slope_baseline_m} m. Against NASA's 18.6-year maps here, Sun differs by about {meta.check.uniform.sun.rmse} points typically. The photo is LROC's south-pole mosaic, tinted by the measure.
      </p>
    </section>
  )
}
