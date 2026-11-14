import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { loadSlopePart } from '../data/loadMissionGrid'
import { isBaseHeights } from '../lib/heights'
import {
  ACCURACY_RANGE,
  ACCURACY_SHARE,
  cellCentreM,
  DEFAULT_ACCURACY_M,
  FIT_COLOR,
  landingOdds,
  loosestAccuracyM,
  MISS_COLOR,
  MISS_WORDS,
  MISSES,
  missOf,
  oddsWords,
  offeredAccuracies,
  reachM,
  rings,
  sigmaM,
} from '../lib/landingOdds'
import { fitMapAround, fitsAtTarget, type SlopePart, squareAround } from '../lib/missionGrid'
import type { SightlineMission } from '../lib/sightlineMission'
import { AccuracyCurve } from './AccuracyCurve'
import { AccuracyMap } from './AccuracyMap'
import type { MissionGrid } from './useMissionGrid'

interface Props {
  site: SiteInfo
  mission: SightlineMission
  /** The light grid read for the landing on show. */
  grid: MissionGrid
  /** Whether the landing fits at the exact point, by the verdict on the left; null while unknown. */
  fits: boolean | null
  /** Whether the same verdicts are shaded on the Moon itself. */
  shade: boolean
  onShade: (on: boolean) => void
  onClose: () => void
}

/** The map reaches far enough for the loosest accuracy offered: 1.25 radii hold nearly every landing. */
const REACH_M = ACCURACY_RANGE.max * 1.25
/** The odds worth keeping, for "how loose can the accuracy be". */
const GOOD_ODDS = 0.9

/**
 * Landing accuracy: a lander aimed at the site comes down somewhere around it. A map of the ground
 * within reach, green where a landing fits the mission and red where it does not, and the odds of
 * coming down on green for the accuracy typed.
 */
export function AccuracyDrawer({ site, mission, grid, fits, shade, onShade, onClose }: Props) {
  const [accuracyM, setAccuracyM] = useState(DEFAULT_ACCURACY_M)
  const [picked, setPicked] = useState<number | null>(null)
  const [slope, setSlope] = useState<{ key: string; part: SlopePart | null } | null>(null)
  const { meta, gaps } = grid
  const { requirements, maxSlopeDeg } = mission
  const square = useMemo(() => (meta ? squareAround(meta, site.lat, site.lon, REACH_M) : null), [meta, site.lat, site.lon])
  const squareKey = square ? `${square.col},${square.row},${square.cells}` : null

  useEffect(() => {
    if (!meta || !square || !squareKey) return
    let current = true
    void loadSlopePart(meta, square).then((part) => current && setSlope({ key: squareKey, part }))
    return () => {
      current = false
    }
    // The key names the square: the same key is the same ground.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, squareKey])

  const slopeHere = slope && slope.key === squareKey ? slope : null
  const map = useMemo(
    () => (meta && gaps && square && slopeHere ? fitMapAround(meta, gaps, square, site.lat, site.lon, requirements, maxSlopeDeg, slopeHere.part) : null),
    [meta, gaps, square, slopeHere, site.lat, site.lon, requirements, maxSlopeDeg],
  )
  const sigma = sigmaM(accuracyM)
  const odds = useMemo(() => (map ? landingOdds(map, sigma) : null), [map, sigma])
  const loosest = useMemo(() => (map ? loosestAccuracyM(map, GOOD_ODDS, offeredAccuracies()) : null), [map])

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
  if (!meta || !map || !odds) return frame(<p className="sl-quiet">Reading the ground around {site.name}…</p>)

  const viewM = Math.min(Math.max(1.5 * accuracyM, 2 * meta.pixel_m), reachM(map))
  const ringM = Math.max(map.cellM, Math.ceil(viewM / 12 / map.cellM) * map.cellM)
  const misses = MISSES.filter((miss) => odds.misses[miss] >= 0.005)
  const gridFits = fitsAtTarget(map)
  const pickedAt = picked === null ? null : cellCentreM(map, picked)
  const pickedMiss = picked === null ? null : missOf(map.verdict[picked])
  const plainLight = isBaseHeights(mission.heights) && requirements.minEarthClearanceDeg === 0
  const { min, max, step } = ACCURACY_RANGE
  const good = Math.round(100 * GOOD_ODDS)

  return frame(
    <>
      <p className="sl-quiet">A lander aimed at {site.name} comes down somewhere around it. This is the ground within reach, and the odds of coming down where the mission still works.</p>

      <div className="sl-param">
        <div className="sl-param-top">
          <label htmlFor="sl-accuracy-m">{Math.round(100 * ACCURACY_SHARE)}% of landings fall within</label>
          <output htmlFor="sl-accuracy-m">{accuracyM} m</output>
        </div>
        <input id="sl-accuracy-m" type="range" min={min} max={max} step={step} value={accuracyM} aria-valuetext={`${accuracyM} meters`} onChange={(event) => setAccuracyM(Number(event.target.value))} />
      </div>

      <p className="sl-accuracy-odds">
        <strong>{oddsWords(odds.fit)}</strong> of landings fit the mission
      </p>
      {misses.length > 0 && (
        <ul className="sl-accuracy-misses">
          {misses.map((miss) => (
            <li key={miss}>
              {oddsWords(odds.misses[miss])}: {MISS_WORDS[miss]}
            </li>
          ))}
        </ul>
      )}

      <AccuracyMap map={map} sigma={sigma} viewM={viewM} picked={picked} onPick={setPicked} label={`The ground within ${Math.round(viewM)} m of ${site.name}: ${oddsWords(odds.fit)} of landings come down where the mission fits`} />
      <p className="sl-accuracy-key">
        <span style={{ background: FIT_COLOR }} /> fits <span style={{ background: MISS_COLOR }} /> does not. Rings hold 50%, 90% and 99% of landings.
      </p>
      <p className="sl-accuracy-picked">
        {pickedAt ? `${Math.round(Math.hypot(pickedAt.x, pickedAt.y))} m from the target: ${pickedMiss ? MISS_WORDS[pickedMiss] : 'a landing here fits'}.` : 'Tap the map to see why a spot fits or not.'}
      </p>
      <label className="sl-check" title="Green where a landing at this hour fits the mission, red where it does not, across the ground near the south pole">
        <input type="checkbox" role="switch" checked={shade} onChange={() => onShade(!shade)} />
        <span>Shade the Moon the same way</span>
      </label>

      <h3>How far off, and how it fares</h3>
      <AccuracyCurve rings={rings(map, sigma, ringM, viewM)} accuracyM={accuracyM} />
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
        <li>A miss is taken as equally likely in every direction and less likely the farther out (a bell curve). That is an assumption, not any lander’s own figures.</li>
        <li>
          Sun and Earth are read on {meta.pixel_m} m cells{slopeHere?.part ? ` and the slope on ${map.cellM} m cells` : ''}. Ground finer than that is not told apart.
        </li>
        {!slopeHere?.part && <li>The slope could not be read, so the map is Sun and Earth only.</li>}
        {!plainLight && <li>The map reads the Sun and Earth {meta.obs_height_m} m above the ground, with any part of Earth counting. Your mission’s heights or Earth clearance are not in it.</li>}
        {fits !== null && gridFits !== null && fits !== gridFits && <li>The verdict on the left is worked out at the exact point; the map’s cell at the target reads differently. Trust the verdict for the point and the map for the ground around it.</li>}
        <li>The odds are of coming down on ground the model says fits. The model’s own error is not in them.</li>
      </ul>
    </>,
  )
}
