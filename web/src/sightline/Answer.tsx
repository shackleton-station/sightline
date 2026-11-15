import { type ReactNode, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { useHorizonsCheck } from '../data/horizonsCheck'
import type { ScenarioData } from '../data/loadSite'
import { answerAt } from '../lib/answer'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import type { MissionHeights } from '../lib/heights'
import { panelSunlight } from '../lib/power'
import { aboveSkylineMeans } from '../lib/sightline'
import { earthLine, groundLine, landingSentence, showingWords, skylineFigure, sunLine } from '../lib/sightlineSky'
import { HorizonsClaim } from './HorizonsClaim'
import { HorizonsLive } from './HorizonsLive'
import { type BodyOver, OverChart } from './LightChart'

interface Props {
  /** The site, in the month of the landing; null while it loads. */
  data: ScenarioData | null
  /** The landing's hour, from the pipeline's track; null while it loads. */
  now: TrackPoint | null
  flags: SiteFlags | null
  /** Why the site and month can't be shown, if they can't. */
  error: string | null
  maxSlopeDeg: number
  /** How high the Sun and Earth are seen from at this site: the panel's height and the antenna's. */
  heights: MissionHeights
  /** One small line when a height is not the app's own 2 m, "panel at 10 m, antenna at 4 m"; null at 2 m. */
  heightsLine: string | null
  /** The share of Earth's disc in view at the landing; null until Earth's size at that hour has loaded. */
  earthShare: number | null
  /** The verdict on the landing, with its reasons and the next landing that fits: the column's headline. */
  verdict: ReactNode
  /** The plan's three controls (site, landing, mission): under the verdict, above the Sun, Earth and ground. */
  plan: ReactNode
  /**
   * The Sun and Earth over the whole mission, charted under their rows' figures: null while the
   * mission's limits are open in the column or when the mission runs past the data, and the rows are
   * then their figures alone.
   */
  over: { start: string; landing: number; missionDays: number; sun: BodyOver; earth: BodyOver } | null
  /**
   * The mission's limits are open in the column. Like the charts, the one-line sentence about the
   * landing and the line about Horizons step aside while they are, so the verdict, the limits and the
   * Sun, Earth and ground all stay on a small laptop's screen (1366 by 768) without scrolling.
   */
  limitsOpen?: boolean
}

/** What the W/m² on the Sun's small line is, for that line's own tooltip. */
const SUNLIGHT_MEANS = 'Sunlight on a surface facing the Sun, in watts per square meter. Full sunlight is 1361 W/m²; less means part of the Sun is hidden.'

/**
 * The answer for the landing. The verdict leads, with the plan's three controls under it. Then one line: what is in view at landing
 * (the date is in the control above, and beside the Moon when the time bar is elsewhere); then three rows, the Sun, Earth and the ground, each with one main figure and the rest small
 * under its name; last, how closely the numbers match JPL Horizons, as one line that opens the proof. Everything is read at the
 * landing's hour (the countdowns run from the landing) from the pipeline's track, horizon and flags,
 * through the functions the rest of the app uses. It does not follow the time bar.
 */
export function Answer({ data, now, flags, error, maxSlopeDeg, heights, heightsLine, earthShare, verdict, plan, over, limitsOpen = false }: Props) {
  // The hour under the pointer, on either row's chart: one crosshair runs through both.
  const [at, setAt] = useState<number | null>(null)
  // The hour-for-hour comparison with JPL Horizons for a listed site; a custom point has none.
  const horizons = useHorizonsCheck(data?.site.id ?? null)
  if (error) {
    return (
      <div className="sl-answer">
        {plan}
        <p className="sl-sentence">This point can't be worked out.</p>
        <p className="sl-note is-warn">{error}</p>
      </div>
    )
  }
  // Until the month's track arrives every row is still drawn, with "…" where its value will be.
  const lastYear = data ? data.year.years[data.year.years.length - 1].year : 0
  const next = now && flags ? answerAt(now, flags, lastYear) : null
  const sunAbove = now && data ? skylineFigure(now.sun_el - horizonAt(data.horizon, now.sun_az)) : null
  const earthAbove = now && data ? skylineFigure(now.earth_el - horizonAt(data.earthHorizon ?? data.horizon, now.earth_az)) : null
  const slope = data?.slope ?? null
  const ground = slope ? groundLine(slope.deg, maxSlopeDeg) : null
  // The Sun is seen from the panel's height and Earth from the antenna's: each row's hover text says its own.
  const aboveMeans = data ? aboveSkylineMeans('the Sun', heights.panelM) : undefined
  const earthAboveMeans = data ? aboveSkylineMeans('Earth', heights.antennaM) : undefined
  // A disc the skyline cuts gets a second small line; a whole or hidden one has none.
  const sunShowing = now ? showingWords(now.sun_frac, now.sun_up) : null
  const earthShowing = now ? showingWords(earthShare, now.earth_up) : null

  return (
    <div className="sl-answer">
      {verdict}
      {plan}
      {!limitsOpen && (
        <p className="sl-sentence" role="status">
          {now ? landingSentence(now.sun_frac, earthShare, now.earth_up) : 'Working out the light here…'}
        </p>
      )}
      {heightsLine && <p className="sl-heights-line">{heightsLine}</p>}
      <dl className="sl-facts">
        <div className="sl-fact is-sun" tabIndex={0} title={aboveMeans && now ? aboveMeans : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Sun
          </dt>
          <dd className="sl-fact-main">
            {sunAbove ? sunAbove.figure : '…'}
            <small>{sunAbove ? sunAbove.side : 'above the skyline'}</small>
          </dd>
          {/* The small line has its own explanation, for its W/m²: one idea to a tip. */}
          <dd className="sl-fact-small" title={now && next ? SUNLIGHT_MEANS : undefined}>
            {now && next ? sunLine(now.sun_up, next.sun.hours, panelSunlight([now]).vertical) : '…'}
          </dd>
          {sunShowing && <dd className="sl-fact-small is-showing">{sunShowing}</dd>}
          {over && <OverChart kind="sun" over={over.sun} start={over.start} landing={over.landing} missionDays={over.missionDays} at={at} onAt={setAt} />}
        </div>
        <div className="sl-fact is-earth" tabIndex={0} title={earthAboveMeans && now ? earthAboveMeans : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Earth
          </dt>
          <dd className="sl-fact-main">
            {earthAbove ? earthAbove.figure : '…'}
            <small>{earthAbove ? earthAbove.side : 'above the skyline'}</small>
          </dd>
          <dd className="sl-fact-small">{now && next ? earthLine(now.earth_up, next.earth.hours) : '…'}</dd>
          {earthShowing && <dd className="sl-fact-small is-showing">{earthShowing}</dd>}
          {over && <OverChart kind="earth" over={over.earth} start={over.start} landing={over.landing} missionDays={over.missionDays} at={at} onAt={setAt} />}
        </div>
        <div className="sl-fact is-ground" tabIndex={0} title={slope ? `How steep the ground is, measured across ${slope.baseline_m} m of NASA's LOLA terrain map. Lower is safer for a lander.` : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Ground
          </dt>
          <dd className="sl-fact-main">
            {slope ? `${slope.deg.toFixed(1)}°` : data ? '?' : '…'}
            <small>slope</small>
          </dd>
          <dd className={ground?.fails ? 'sl-fact-small is-warn' : 'sl-fact-small'}>{ground ? ground.text : data ? 'not known for this point' : '…'}</dd>
        </div>
      </dl>
      {/* Always there, so nothing moves when the comparison arrives; out of the way while the mission's limits are open. */}
      {limitsOpen ? null : horizons && data && now ? (
        <HorizonsClaim lat={data.site.lat} lon={data.site.lon} altKm={horizons.alt_km} hour={now.t} hours={horizons.hours} maxDeg={horizons.max_deg} />
      ) : (
        // A custom point was never compared ahead of time: NASA's answer is one click away instead.
        <p className="sl-horizons">{data && now && isCustomSite(data.site) && <HorizonsLive lat={data.site.lat} lon={data.site.lon} hour={now.t} ours={{ sunEl: now.sun_el, earthEl: now.earth_el }} />}</p>
      )}
    </div>
  )
}
