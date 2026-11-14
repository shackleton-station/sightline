import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { slopePartFor, slopePartNow } from '../data/loadMissionGrid'
import { isBaseHeights } from '../lib/heights'
import {
  ACCURACY_RANGE,
  ACCURACY_SHARE,
  BEARING_RANGE,
  bestAim,
  cellCentreM,
  cellChances,
  FIT_COLOR,
  landingOdds,
  loosestAccuracyM,
  type Miss,
  MISS_COLORS,
  MISS_WORDS,
  MISSES,
  missOf,
  oddsWords,
  offeredAccuracies,
  reachM,
  rings,
  type Spread,
  STRETCH_RANGE,
} from '../lib/landingOdds'
import { planeLatLon, planeXY } from '../lib/lightGrid'
import { fitMapAround, fitsAtTarget, squareAround } from '../lib/missionGrid'
import type { SightlineMission } from '../lib/sightlineMission'
import { AccuracyCurve } from './AccuracyCurve'
import { AccuracyMap } from './AccuracyMap'
import { type MissionGrid, REACH_M } from './useMissionGrid'

interface Props {
  site: SiteInfo
  mission: SightlineMission
  /** The light grid read for the landing on show. */
  grid: MissionGrid
  /** How the lander's misses are spread, and a change to it. */
  spread: Spread
  onSpread: (spread: Spread) => void
  /** Whether the landing fits at the exact point, by the verdict on the left; null while unknown. */
  fits: boolean | null
  /** Whether the same verdicts are shaded on the Moon itself. */
  shade: boolean
  onShade: (on: boolean) => void
  /** Move the scenario's target to a point. */
  onAim: (lat: number, lon: number) => void
  onClose: () => void
}

/** The odds worth keeping, for "how loose can the accuracy be". */
const GOOD_ODDS = 0.9

interface SliderProps {
  id: string
  label: string
  value: number
  text: string
  range: { min: number; max: number; step: number }
  onChange: (value: number) => void
}

function Slider({ id, label, value, text, range, onChange }: SliderProps) {
  return (
    <div className="sl-param">
      <div className="sl-param-top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{text}</output>
      </div>
      <input id={id} type="range" min={range.min} max={range.max} step={range.step} value={value} aria-valuetext={text} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}

/**
 * Landing accuracy: a lander aimed at the site comes down somewhere around it. A map of the ground
 * within reach, green where a landing fits the mission and in its reason's color where it does not,
 * the odds of coming down on green for the accuracy typed, and a better place to aim if there is one.
 */
export function AccuracyDrawer({ site, mission, grid, spread, onSpread, fits, shade, onShade, onAim, onClose }: Props) {
  const [picked, setPicked] = useState<number | null>(null)
  const [, setArrived] = useState(0)
  const { meta, gaps } = grid
  const { requirements, maxSlopeDeg } = mission
  const square = useMemo(() => (meta ? squareAround(meta, site.lat, site.lon, REACH_M) : null), [meta, site.lat, site.lon])
  const squareKey = square ? `${square.col},${square.row},${square.cells}` : null

  useEffect(() => {
    if (!meta || !square) return
    let current = true
    void slopePartFor(meta, square).then(() => current && setArrived((count) => count + 1))
    return () => {
      current = false
    }
    // The key names the square: the same key is the same ground.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, squareKey])

  // Null when the slope could not be read; undefined while it has not arrived.
  const slope = square ? slopePartNow(square) : undefined
  const map = useMemo(
    () => (meta && gaps && square && slope !== undefined ? fitMapAround(meta, gaps, square, site.lat, site.lon, requirements, maxSlopeDeg, slope) : null),
    [meta, gaps, square, slope, site.lat, site.lon, requirements, maxSlopeDeg],
  )
  const chances = useMemo(() => (map ? cellChances(map, spread) : null), [map, spread])
  const odds = useMemo(() => (map && chances ? landingOdds(map, chances) : null), [map, chances])
  // A better aim is looked for as far as the map still holds the landings of a lander aimed there.
  const searchM = map ? Math.max(0, reachM(map) - 1.25 * spread.accuracyM * spread.stretch) : 0
  const aim = useMemo(() => (map && chances && searchM > 0 ? bestAim(map, chances, searchM) : null), [map, chances, searchM])
  const loosest = useMemo(() => (map ? loosestAccuracyM(map, GOOD_ODDS, offeredAccuracies(), spread) : null), [map, spread])

  const frame = (body: ReactNode) => (
    <aside className="sl-drawer sl-accuracy" aria-label="Landing accuracy">
      <header className="sl-drawer-head">
        <h2>Landing accuracy</h2>
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      {body}
    </aside>
  )
  if (meta === null || grid.state === 'failed') return frame(<p>The light grid could not be read. Close this panel and open it again to retry.</p>)
  if (grid.state === 'past') return frame(<p>The mission runs past the last month of the light grid, so the ground around this landing cannot be judged.</p>)
  if (meta && !square) return frame(<p>This is worked out from the hourly light grid, which covers the ground within about {Math.round(meta.half_width_m / 1000)} km of the south pole. {site.name} is outside it, or too close to its edge.</p>)
  if (!meta || !map || !odds || !chances) return frame(<p className="sl-quiet">Reading the ground around {site.name}…</p>)

  const longM = spread.accuracyM * spread.stretch
  const viewM = Math.min(Math.max(1.5 * longM, 2 * meta.pixel_m), reachM(map))
  const ringM = Math.max(map.cellM, Math.ceil(viewM / 12 / map.cellM) * map.cellM)
  const misses = MISSES.filter((miss) => odds.misses[miss] >= 0.005)
  // The key names the reasons on the picture, not every reason there is.
  const inView = new Set<Miss>()
  for (let cell = 0; cell < map.verdict.length; cell += 1) {
    const miss = missOf(map.verdict[cell])
    if (!miss || inView.has(miss)) continue
    const { x, y } = cellCentreM(map, cell)
    if (Math.abs(x) <= viewM && Math.abs(y) <= viewM) inView.add(miss)
  }
  const gridFits = fitsAtTarget(map)
  const pickedAt = picked === null ? null : cellCentreM(map, picked)
  const pickedMiss = picked === null ? null : missOf(map.verdict[picked])
  const plainLight = isBaseHeights(mission.heights) && requirements.minEarthClearanceDeg === 0
  const { min, max } = ACCURACY_RANGE
  const good = Math.round(100 * GOOD_ODDS)
  const takeAim = () => {
    if (!aim) return
    const target = planeXY(meta, site.lat, site.lon)
    const { lat, lon } = planeLatLon(meta, target.x + aim.x, target.y + aim.y)
    setPicked(null)
    onAim(Number(lat.toFixed(6)), Number(lon.toFixed(6)))
  }

  return frame(
    <>
      <p className="sl-quiet">A lander aimed at {site.name} comes down somewhere around it. This is the ground within reach, and the odds of coming down where the mission still works.</p>

      <Slider id="sl-accuracy-m" label={`${Math.round(100 * ACCURACY_SHARE)}% of landings fall within`} value={spread.accuracyM} text={`${spread.accuracyM} m`} range={ACCURACY_RANGE} onChange={(accuracyM) => onSpread({ ...spread, accuracyM })} />
      <details className="sl-accuracy-approach" open={spread.stretch > 1}>
        <summary>Longer along the approach</summary>
        <Slider
          id="sl-accuracy-stretch"
          label="Along the approach path"
          value={spread.stretch}
          text={spread.stretch === 1 ? 'the same' : `${spread.stretch} times: ${Math.round(longM)} m`}
          range={STRETCH_RANGE}
          onChange={(stretch) => onSpread({ ...spread, stretch, bearingDeg: stretch === 1 ? 0 : spread.bearingDeg })}
        />
        {spread.stretch > 1 && <Slider id="sl-accuracy-bearing" label="Path’s direction on the map" value={spread.bearingDeg} text={`${spread.bearingDeg}° from up`} range={BEARING_RANGE} onChange={(bearingDeg) => onSpread({ ...spread, bearingDeg })} />}
        <p className="sl-quiet">A lander scatters more along the way it flies in than across it. Up on the map is toward 0° E longitude.</p>
      </details>

      <p className="sl-accuracy-odds">
        <strong>{oddsWords(odds.fit)}</strong> of landings fit the mission
      </p>
      {misses.length > 0 && (
        <ul className="sl-accuracy-misses">
          {misses.map((miss) => (
            <li key={miss}>
              <span className="sl-accuracy-swatch" style={{ background: MISS_COLORS[miss] }} />
              {oddsWords(odds.misses[miss])}: {MISS_WORDS[miss]}
            </li>
          ))}
        </ul>
      )}
      {odds.covered < 0.98 && <p className="sl-quiet">The map holds {Math.round(100 * odds.covered)}% of landings at this setting; the odds are among those.</p>}

      {aim && (
        <p className="sl-accuracy-aim">
          Aim {Math.round(Math.hypot(aim.x, aim.y))} m away (the diamond) and {oddsWords(aim.fit)} fit.{' '}
          <button type="button" className="sl-small" onClick={takeAim}>
            Aim there
          </button>
        </p>
      )}

      <AccuracyMap map={map} spread={spread} viewM={viewM} aim={aim} picked={picked} onPick={setPicked} label={`The ground within ${Math.round(viewM)} m of ${site.name}: ${oddsWords(odds.fit)} of landings come down where the mission fits`} />
      <p className="sl-accuracy-key">
        <span className="sl-accuracy-swatch" style={{ background: FIT_COLOR }} />
        fits
        {MISSES.filter((miss) => inView.has(miss)).map((miss) => (
          <span key={miss}>
            <span className="sl-accuracy-swatch" style={{ background: MISS_COLORS[miss] }} />
            {MISS_WORDS[miss]}
          </span>
        ))}
      </p>
      <p className="sl-quiet">Outlines hold 50%, 90% and 99% of landings.</p>
      <p className="sl-accuracy-picked">
        {pickedAt ? `${Math.round(Math.hypot(pickedAt.x, pickedAt.y))} m from the target: ${pickedMiss ? MISS_WORDS[pickedMiss] : 'a landing here fits'}.` : 'Tap the map to see why a spot fits or not.'}
      </p>
      <label className="sl-check" title="Green where a landing at this hour fits the mission, and each reason it does not in its own color, across the ground near the south pole">
        <input type="checkbox" role="switch" checked={shade} onChange={() => onShade(!shade)} />
        <span>Shade the Moon the same way</span>
      </label>

      <h3>How far off, and how it fares</h3>
      <AccuracyCurve rings={rings(map, chances, ringM, viewM)} accuracyM={spread.accuracyM} />
      <p className="sl-quiet">Each bar is the chance of missing by that much. Its green part is the share of the ground at that distance where a landing fits.</p>
      <p>
        {loosest === null
          ? `Even at ${min} m accuracy the odds are under ${good}%.`
          : loosest >= max
            ? `The odds stay at ${good}% or better at every accuracy up to ${max.toLocaleString('en-US')} m.`
            : `The odds stay at ${good}% or better up to an accuracy of ${loosest} m.`}
      </p>

      <h3>What this does and does not say</h3>
      <ul className="sl-accuracy-notes">
        <li>A miss is taken as a bell curve around the target: less likely the farther out, the same in every direction unless you stretch it along the approach. That is an assumption, not any lander’s own figures.</li>
        <li>
          Sun and Earth are read on {meta.pixel_m} m cells{slope ? ` and the slope on ${map.cellM} m cells` : ''}. Ground finer than that is not told apart.
        </li>
        {!slope && <li>The slope could not be read, so the map is Sun and Earth only.</li>}
        {!plainLight && <li>The map reads the Sun and Earth {meta.obs_height_m} m above the ground, with any part of Earth counting. Your mission’s heights or Earth clearance are not in it.</li>}
        {fits !== null && gridFits !== null && fits !== gridFits && <li>The verdict on the left is worked out at the exact point; the map’s cell at the target reads differently. Trust the verdict for the point and the map for the ground around it.</li>}
        <li>The odds are of coming down on ground the model says fits. The model’s own error is not in them.</li>
      </ul>
    </>,
  )
}
