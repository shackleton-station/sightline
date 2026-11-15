import { area, line, scaleLinear } from 'd3'
import { useMemo } from 'react'
import {
  ACCURACY_RANGE,
  BEARING_RANGE,
  cellCentreM,
  FIT_COLOR,
  FITS,
  type FitMap,
  type LandingOdds,
  MISS_COLORS,
  MISS_WORDS,
  MISSES,
  missCode,
  RING_SHARES,
  radiusHolding,
  sigmaM,
  type Spread,
  STRETCH_RANGE,
} from '../lib/landingOdds'
import { useWidth } from '../lib/useWidth'

interface Props {
  map: FitMap
  /** How far round the target the picture reaches (m). */
  viewM: number
  odds: LandingOdds
  spread: Spread
  onSpread: (spread: Spread) => void
  /** The simulated landers so far, and how many fit. */
  simulated: { down: number; fit: number }
  cellM: number
}

/** The share of the ground within `reach` m of the target with each verdict. */
function groundShares(map: FitMap, reach: number): { fit: number; byMiss: Record<string, number>; areaKm2: number } {
  const counts = new Map<number, number>()
  let total = 0
  for (let cell = 0; cell < map.verdict.length; cell += 1) {
    const { x, y } = cellCentreM(map, cell)
    if (Math.hypot(x, y) > reach) continue
    total += 1
    counts.set(map.verdict[cell], (counts.get(map.verdict[cell]) ?? 0) + 1)
  }
  const share = (code: number) => (total > 0 ? (counts.get(code) ?? 0) / total : 0)
  return {
    fit: share(FITS),
    byMiss: Object.fromEntries(MISSES.map((miss) => [miss, share(missCode(miss))])),
    areaKm2: (total * map.cellM * map.cellM) / 1e6,
  }
}

/** The landers' distance from the target, across the approach: a 2D bell curve read by distance (Rayleigh). */
function rayleigh(r: number, sigma: number): number {
  return (r / (sigma * sigma)) * Math.exp(-(r * r) / (2 * sigma * sigma))
}

/**
 * How the map above is made, in three pictures: the ground (NASA data, worked out by the team's
 * pipeline), the lander's scatter (an assumption you set), and the two together (the odds). Every
 * figure is from the same map and model as the simulation.
 */
export function LandingExplain({ map, viewM, odds, spread, onSpread, simulated, cellM }: Props) {
  const ground = useMemo(() => groundShares(map, viewM), [map, viewM])
  const sigma = sigmaM(spread.accuracyM)
  const [ref, width] = useWidth()
  // The curve draws itself in again whenever the scatter changes (a new key restarts its animation).
  const drawn = `${spread.accuracyM}-${spread.stretch}`

  const H = 120
  const reach = radiusHolding(0.999, sigma) * spread.stretch
  const x = scaleLinear([0, reach], [8, Math.max(width - 8, 9)])
  const peak = rayleigh(sigma, sigma)
  const y = scaleLinear([0, peak * 1.15], [H - 18, 6])
  const samples = useMemo(() => Array.from({ length: 121 }, (_, i) => (i / 120) * reach), [reach])
  // Along the approach the scatter is `stretch` times longer: drawn as a second, flatter curve.
  const curve = (stretch: number) =>
    line<number>()
      .x((r) => x(r))
      .y((r) => y(rayleigh(r / stretch, sigma) / stretch))(samples) ?? ''
  const fill = (from: number, to: number) =>
    area<number>()
      .x((r) => x(r))
      .y0(y(0))
      .y1((r) => y(rayleigh(r, sigma)))(samples.filter((r) => r >= from && r <= to)) ?? ''
  const rings = RING_SHARES.map((share) => ({ share, m: radiusHolding(share, sigma) }))

  const pct = (value: number) => `${Math.round(value * 100)}%`
  const misses = MISSES.filter((miss) => odds.misses[miss] >= 0.005)

  return (
    <section className="np-explain" aria-label="How this works">
      <h5>How this works</h5>
      <div className="np-explain-cards">
        {/* 1. The ground */}
        <article className="np-explain-card">
          <p className="np-explain-step">
            <span>1</span> The ground · <em>NASA data</em>
          </p>
          <p>
            Every {cellM} m square within {Math.round(viewM)} m ({ground.areaKm2.toFixed(2)} km²) is checked against your mission, hour by hour: is the Sun up at landing, is Earth in view, how long the dark and the silence last, how steep it is.
          </p>
          <div className="np-explain-stack" role="img" aria-label={`Of the ground within reach, ${pct(ground.fit)} fits the mission`}>
            <b style={{ width: pct(ground.fit), background: FIT_COLOR }} title={`fits: ${pct(ground.fit)}`} />
            {MISSES.map((miss) => (ground.byMiss[miss] > 0 ? <b key={miss} style={{ width: pct(ground.byMiss[miss]), background: MISS_COLORS[miss] }} title={`${MISS_WORDS[miss]}: ${pct(ground.byMiss[miss])}`} /> : null))}
          </div>
          <p className="np-explain-figure">
            <strong style={{ color: FIT_COLOR }}>{pct(ground.fit)}</strong> of the ground fits
          </p>
          <p className="np-explain-sources">
            <span>LOLA terrain → horizons</span>
            <span>SPICE → Sun &amp; Earth</span>
            <span>LOLA 30 m slopes</span>
            <span>LROC photo</span>
          </p>
        </article>

        {/* 2. The scatter */}
        <article className="np-explain-card" ref={ref}>
          <p className="np-explain-step">
            <span>2</span> The scatter · <em>your assumption</em>
          </p>
          <p>How far from the target landers come down: a bell curve, set by how precise the landing is.</p>
          {width > 0 && (
            <svg key={drawn} width={width} height={H} role="img" aria-label={`Half of landings within ${Math.round(rings[0].m)} m, 90% within ${Math.round(rings[1].m)} m, 99% within ${Math.round(rings[2].m)} m`}>
              <path className="np-explain-band is-99" d={fill(rings[1].m, rings[2].m)} />
              <path className="np-explain-band is-90" d={fill(rings[0].m, rings[1].m)} />
              <path className="np-explain-band is-50" d={fill(0, rings[0].m)} />
              {spread.stretch > 1 && <path className="np-explain-curve is-along" d={curve(spread.stretch)} />}
              <path className="np-explain-curve" d={curve(1)} pathLength={1} />
              {rings.map((ring) => (
                <g key={ring.share}>
                  <line className="np-explain-ring" x1={x(ring.m)} x2={x(ring.m)} y1={y(0)} y2={10} />
                  <text className="np-explain-ring-label" x={x(ring.m)} y={ring.share === 0.9 ? 22 : H - 4} textAnchor="middle">
                    {Math.round(ring.share * 100)}%: {Math.round(ring.m)} m
                  </text>
                </g>
              ))}
            </svg>
          )}
          <div className="np-explain-controls">
            <label>
              <span>
                99% within <b>{spread.accuracyM} m</b>
              </span>
              <input type="range" min={ACCURACY_RANGE.min} max={ACCURACY_RANGE.max} step={ACCURACY_RANGE.step} value={spread.accuracyM} onChange={(event) => onSpread({ ...spread, accuracyM: Number(event.target.value) })} />
            </label>
            <label title="Landers usually miss more along their path than across it">
              <span>
                Longer along the approach <b>×{spread.stretch}</b>
              </span>
              <input type="range" min={STRETCH_RANGE.min} max={STRETCH_RANGE.max} step={STRETCH_RANGE.step} value={spread.stretch} onChange={(event) => onSpread({ ...spread, stretch: Number(event.target.value) })} />
            </label>
            {spread.stretch > 1 && (
              <label>
                <span>
                  Approach from <b>{spread.bearingDeg}°</b> (clockwise from up)
                </span>
                <input type="range" min={BEARING_RANGE.min} max={BEARING_RANGE.max} step={BEARING_RANGE.step} value={spread.bearingDeg} onChange={(event) => onSpread({ ...spread, bearingDeg: Number(event.target.value) })} />
              </label>
            )}
          </div>
        </article>

        {/* 3. Together */}
        <article className="np-explain-card">
          <p className="np-explain-step">
            <span>3</span> Together · <em>the odds</em>
          </p>
          <p>Each square's chance of being where the lander comes down, times whether it fits, added up: the model's exact odds. The dots are a sample of the same thing.</p>
          <div className="np-explain-stack is-tall" role="img" aria-label={`The model's odds: ${pct(odds.fit)} fit`}>
            <b style={{ width: pct(odds.fit), background: FIT_COLOR }} title={`fits: ${pct(odds.fit)}`}>
              <span>{pct(odds.fit)}</span>
            </b>
            {misses.map((miss) => (
              <b key={miss} style={{ width: pct(odds.misses[miss]), background: MISS_COLORS[miss] }} title={`${MISS_WORDS[miss]}: ${pct(odds.misses[miss])}`} />
            ))}
          </div>
          <ul className="np-explain-list">
            {misses.map((miss) => (
              <li key={miss}>
                <i style={{ background: MISS_COLORS[miss] }} /> {MISS_WORDS[miss]} <b>{pct(odds.misses[miss])}</b>
              </li>
            ))}
          </ul>
          <p className="np-explain-vs">
            Model <b>{pct(odds.fit)}</b> · simulated <b>{simulated.down > 0 ? pct(simulated.fit / simulated.down) : '…'}</b> of {simulated.down}
            {odds.covered < 0.999 && <small> · {pct(1 - odds.covered)} of landings fall off the map and are left out</small>}
          </p>
        </article>
      </div>
    </section>
  )
}
