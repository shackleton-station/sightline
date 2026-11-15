import { type ReactNode, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { bearingBetweenDeg, closenessWords, compassWords, oddsTone } from '../lib/accuracyWords'
import { polarLatLon, polarXY } from '../lib/customModel'
import type { MissionHeights } from '../lib/heights'
import type { FieldReading } from '../lib/landingField'
import {
  ACCURACY_RANGE,
  ACCURACY_SHARE,
  BEARING_RANGE,
  bestAim,
  cellCentreM,
  FIT_COLOR,
  type Miss,
  MISS_COLORS,
  MISS_WORDS,
  MISSES,
  missOf,
  oddsWords,
  reachM,
  rings,
  type Spread,
  STRETCH_RANGE,
} from '../lib/landingOdds'
import type { SightlineMission } from '../lib/sightlineMission'
import { AccuracyCurve } from './AccuracyCurve'
import { AccuracyMap } from './AccuracyMap'
import type { FieldState } from './useLandingFields'
import './accuracy.css'

interface Props {
  site: SiteInfo
  mission: SightlineMission
  /** The heights the landing points are worked out at: those the verdict on the left is for. */
  heights: MissionHeights
  /** The landing points around the site, as far as they have been worked out. */
  points: FieldState
  /** Those points read under the mission and the spread: the same reading the verdict's line and Compare show. Null until there are points. */
  reading: FieldReading | null
  /** The verdict on the left for the aim point itself: null where it fits, the reason where it does not, undefined while unknown. */
  verdict: Miss | null | undefined
  /** How the lander's misses are spread, and a change to it. */
  spread: Spread
  onSpread: (spread: Spread) => void
  /** Whether the same verdicts are shaded on the Moon. */
  shade: boolean
  onShade: (on: boolean) => void
  /** Move the scenario's target to a point. */
  onAim: (lat: number, lon: number) => void
  onClose: () => void
}

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
 * Landing accuracy: a lander aimed at the site comes down somewhere around it. The panel reads from
 * the top as a first-time visitor needs it:
 *
 * 1. The verdict on the left, said again for the aim point, and then the answer as one sentence
 *    with its number big and in the verdict's colours: the share of landings that come down where
 *    the mission still fits. Under it, the reasons the others do not, each with its share, and a
 *    better place to aim when there is one.
 * 2. The picture: the ground within reach, green where a landing fits and in its reason's colour
 *    where it does not, with one caption that says how to read it.
 * 3. The one control that matters: how close the lander gets to its aim point.
 * 4. Everything else under "More": a miss longer along the approach, the curve of the miss, the
 *    shading on the Moon, and what this does and does not say.
 *
 * The ground is judged at landing points around the target, each as the verdict judges a point
 * (`lib/landingField.ts`). The odds, the map and the better aim are `landingOdds`' own, and the
 * reading is the one the verdict's line and Compare show; nothing is worked out here.
 */
export function AccuracyDrawer({ site, mission, heights, points, reading, verdict, spread, onSpread, shade, onShade, onAim, onClose }: Props) {
  const [picked, setPicked] = useState<number | null>(null)
  // "More" opens by itself when the link already stretches the miss along the approach: its sliders are in there.
  const [more, setMore] = useState(spread.stretch > 1)
  const { requirements } = mission
  const map = reading?.map ?? null
  const chances = reading?.chances ?? null
  const longM = spread.accuracyM * spread.stretch
  // A better aim is looked for as far as the map still holds the landings of a lander aimed there.
  const searchM = map ? Math.max(0, reachM(map) - 1.25 * longM) : 0
  const aim = useMemo(() => (map && chances && searchM > 0 ? bestAim(map, chances, searchM) : null), [map, chances, searchM])

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
  const answer = points.answer
  if (!answer && points.failed) return frame(<p>The terrain around {site.name} could not be read. Close this panel and open it again to retry.</p>)
  if (answer?.state === 'past') return frame(<p>The mission runs past the years there are Sun and Earth positions for, so the ground around this landing cannot be judged.</p>)
  if (answer?.state === 'outside') return frame(<p>This is worked out from the fine terrain around the south pole, which holds every skyline within about 100 km of it. {site.name} is outside that.</p>)
  if (!answer || !reading || !map || !chances)
    return frame(
      <p className="sl-quiet" role="status">
        Working out the landing points around {site.name}… {points.progress > 0 ? `${Math.round(100 * points.progress)}%` : ''}
      </p>,
    )
  const { field } = answer
  const { odds, margins } = reading

  const viewM = Math.min(Math.max(1.5 * longM, 100), reachM(map))
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
  const pickedAt = picked === null ? null : cellCentreM(map, picked)
  const pickedMiss = picked === null ? null : missOf(map.verdict[picked])
  const target = polarXY(site.lat, site.lon)
  const takeAim = () => {
    if (!aim) return
    const { lat, lon } = polarLatLon(target.x + aim.x, target.y + aim.y)
    setPicked(null)
    onAim(Number(lat.toFixed(6)), Number(lon.toFixed(6)))
  }

  const aimAt = aim ? polarLatLon(target.x + aim.x, target.y + aim.y) : null
  const aimWay = aimAt ? compassWords(bearingBetweenDeg(site, aimAt)) : null
  // The diamond is drawn only when the better aim is on the picture.
  const aimInView = aim !== null && Math.abs(aim.x) <= viewM && Math.abs(aim.y) <= viewM
  const share = Math.round(100 * ACCURACY_SHARE)

  return frame(
    <>
      <p className="sl-quiet sl-accuracy-what">Landing accuracy is how far from its aim point a lander may come down.</p>

      {verdict !== undefined && (
        <p className={`sl-accuracy-point is-${verdict === null ? 'fit' : 'miss'}`} title="The verdict on the left, for a landing exactly on the aim point. The map under the cross agrees with it.">
          {verdict === null ? 'A landing exactly on the aim point fits your mission.' : `A landing exactly on the aim point does not fit: ${MISS_WORDS[verdict]}.`}
        </p>
      )}
      <p className={`sl-accuracy-answer is-${oddsTone(odds.fit)}`} title="The share of landings that come down on ground where the mission still fits.">
        <strong>{oddsWords(odds.fit)}</strong>{' '}
        <span>
          of landings aimed at {site.name} come down where the mission {verdict === null ? 'still fits' : 'fits'}, for a lander that gets {closenessWords(spread)}.
        </span>
      </p>
      {misses.length > 0 && (
        <>
          <p className="sl-accuracy-rest">Where the rest come down:</p>
          <ul className="sl-accuracy-misses">
            {misses.map((miss) => (
              <li key={miss} title="The share of landings that come down where this is the reason the mission does not fit.">
                <span className="sl-accuracy-swatch" style={{ background: MISS_COLORS[miss] }} />
                {oddsWords(odds.misses[miss])}: {MISS_WORDS[miss]}
              </li>
            ))}
          </ul>
        </>
      )}
      {points.stale && (
        <p className="sl-quiet" role="status">
          Working out the landing points for this accuracy… {points.progress > 0 ? `${Math.round(100 * points.progress)}%` : ''}
        </p>
      )}
      {!points.stale && odds.covered < 0.98 && <p className="sl-quiet">The map holds {Math.round(100 * odds.covered)}% of landings at this setting; the odds are among those.</p>}

      {aim && (
        <p className="sl-accuracy-aim" title="The aim point near this one with the best odds of coming down where the mission fits.">
          <span>
            Aim {Math.round(Math.hypot(aim.x, aim.y)).toLocaleString('en-US')} m to the {aimWay}
            {aimInView ? ' (the diamond)' : ''}: <strong>{oddsWords(aim.fit)}</strong> fit.
          </span>
          <button type="button" className="sl-small" title="Moves this scenario’s target to the diamond." onClick={takeAim}>
            Aim there
          </button>
        </p>
      )}

      <AccuracyMap map={map} margins={margins} spread={spread} viewM={viewM} aim={aim} picked={picked} onPick={setPicked} label={`The ground within ${Math.round(viewM)} m of ${site.name}: ${oddsWords(odds.fit)} of landings come down where the mission fits`} />
      <div className="sl-accuracy-caption">
        <p className="sl-accuracy-key">
          <span>
            <span className="sl-accuracy-swatch" style={{ background: FIT_COLOR }} />
            fits
          </span>
          {MISSES.filter((miss) => inView.has(miss)).map((miss) => (
            <span key={miss}>
              <span className="sl-accuracy-swatch" style={{ background: MISS_COLORS[miss] }} />
              {MISS_WORDS[miss]}
            </span>
          ))}
        </p>
        <p className="sl-accuracy-picked" role="status">
          {pickedAt
            ? `${Math.round(Math.hypot(pickedAt.x, pickedAt.y))} m from the aim point: ${pickedMiss ? MISS_WORDS[pickedMiss] : 'a landing here fits'}.`
            : 'The cross is the aim point; the rings hold 50%, 90% and 99% of landings. Tap a spot to see why it fits or not.'}
        </p>
      </div>

      <div className="sl-param sl-accuracy-close">
        <label htmlFor="sl-accuracy-m">How close can the lander get to its aim point?</label>
        <div className="sl-accuracy-close-row">
          <input
            id="sl-accuracy-m"
            type="range"
            min={ACCURACY_RANGE.min}
            max={ACCURACY_RANGE.max}
            step={ACCURACY_RANGE.step}
            value={spread.accuracyM}
            aria-valuetext={`within ${spread.accuracyM} m`}
            onChange={(event) => onSpread({ ...spread, accuracyM: Number(event.target.value) })}
          />
          <output htmlFor="sl-accuracy-m" title={`Nearly all landings, ${share}%, come down within this distance of the aim point.`}>
            within {spread.accuracyM.toLocaleString('en-US')} m
          </output>
        </div>
      </div>

      <details className="sl-accuracy-more" open={more} onToggle={(event) => setMore(event.currentTarget.open)}>
        <summary>More</summary>

        <h3>A longer miss along the approach</h3>
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

        <h3>How far off, and how it fares</h3>
        <AccuracyCurve rings={rings(map, chances, ringM, viewM)} accuracyM={spread.accuracyM} />
        <p className="sl-quiet">Each bar is the chance of missing by that much. Its green part is the share of the ground at that distance where a landing fits.</p>

        <h3>On the Moon</h3>
        <label className="sl-check" title="Colors the Moon by how likely a landing aimed there comes down where the mission fits. Green is likely, amber uncertain, red unlikely.">
          <input type="checkbox" role="switch" checked={shade} onChange={() => onShade(!shade)} />
          <span>Shade the Moon by landings that fit</span>
        </label>

        <h3>What this does and does not say</h3>
        <ul className="sl-accuracy-notes">
          <li>A miss is taken as a bell curve around the target: less likely the farther out, the same in every direction unless you stretch it along the approach. That is an assumption, not any lander’s own figures.</li>
          <li>
            Each landing point is judged as the aim point is: its own skyline from the {field.slope.stepM === 20 ? '20 m terrain' : 'terrain'}, the Sun seen from {heights.panelM} m up and Earth from {heights.antennaM} m
            {requirements.minEarthClearanceDeg > 0 ? `, with Earth at least ${requirements.minEarthClearanceDeg}° above the skyline` : ''}, hour by hour through the mission.
          </li>
          <li>
            The points are {field.lattice.stepM} m apart, and the slope is read every {field.slope.stepM} m. Between points the picture and the odds are filled in smoothly, so ground finer than that is not told apart.
          </li>
          <li>At the aim point itself the verdict on the left is used, so the two never disagree.</li>
          <li>The shading on the Moon is a coarser picture of the same question: Sun and Earth every 120 m, from 2 m up.</li>
          <li>The odds are of coming down on ground the model says fits. The model’s own error is not in them.</li>
        </ul>
      </details>
    </>,
  )
}
