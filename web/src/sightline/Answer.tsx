import type { ReactNode } from 'react'
import type { TrackPoint } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { useHorizonsCheck } from '../data/horizonsCheck'
import type { ScenarioData } from '../data/loadSite'
import { answerAt } from '../lib/answer'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import type { MissionHeights } from '../lib/heights'
import { horizonsQueryUrl, withinWords } from '../lib/horizonsLink'
import { panelSunlight } from '../lib/power'
import { aboveSkylineMeans, elevationWords } from '../lib/sightline'
import { earthLine, groundLine, landingSentence, showingWords, skylineFigure, sunLine } from '../lib/sightlineSky'
import { HorizonsLive } from './HorizonsLive'

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
}

/** What the Sun's small line means, for its tooltip. */
const SUNLIGHT_MEANS = 'W/m² is the sunlight reaching a surface that faces the Sun, from the share of its disc in view: what is available, not a power figure.'

/** "Elevation −1.0° from level.", to lead a row's hover text: the conventional figure, kept out of the row itself. */
function elevationLead(elevationDeg: number): string {
  const words = elevationWords(elevationDeg)
  return `${words[0].toUpperCase()}${words.slice(1)}. `
}

/**
 * The answer for the landing. The verdict leads. Under it, one line: what is in view at landing
 * (the date is in the control above, and beside the Moon when the time bar is elsewhere); then three rows, the Sun, Earth and the ground, each with one main figure and the rest small
 * under its name; last, how closely the numbers match JPL Horizons. Everything is read at the
 * landing's hour (the countdowns run from the landing) from the pipeline's track, horizon and flags,
 * through the functions the rest of the app uses. It does not follow the time bar.
 */
export function Answer({ data, now, flags, error, maxSlopeDeg, heights, heightsLine, earthShare, verdict }: Props) {
  // The hour-for-hour comparison with JPL Horizons for a listed site; a custom point has none.
  const horizons = useHorizonsCheck(data?.site.id ?? null)
  if (error) {
    return (
      <div className="sl-answer">
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
  const aboveMeans = data ? aboveSkylineMeans(heights.panelM) : undefined
  const earthAboveMeans = data ? aboveSkylineMeans(heights.antennaM) : undefined
  // A disc the skyline cuts gets a second small line; a whole or hidden one has none.
  const sunShowing = now ? showingWords(now.sun_frac, now.sun_up) : null
  const earthShowing = now ? showingWords(earthShare, now.earth_up) : null

  return (
    <div className="sl-answer">
      {verdict}
      <p className="sl-sentence" role="status">
        {now ? landingSentence(now.sun_frac, earthShare, now.earth_up) : 'Working out the light here…'}
      </p>
      {heightsLine && <p className="sl-heights-line">{heightsLine}</p>}
      <dl className="sl-facts">
        <div className="sl-fact is-sun" tabIndex={0} title={aboveMeans && now ? `${elevationLead(now.sun_el)}${aboveMeans} ${SUNLIGHT_MEANS}` : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Sun
          </dt>
          <dd className="sl-fact-main">
            {sunAbove ? sunAbove.figure : '…'}
            <small>{sunAbove ? sunAbove.side : 'above the skyline'}</small>
          </dd>
          <dd className="sl-fact-small">{now && next ? sunLine(now.sun_up, next.sun.hours, panelSunlight([now]).vertical) : '…'}</dd>
          {sunShowing && <dd className="sl-fact-small is-showing">{sunShowing}</dd>}
        </div>
        <div className="sl-fact is-earth" tabIndex={0} title={earthAboveMeans && now ? `${elevationLead(now.earth_el)}${earthAboveMeans}` : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Earth
          </dt>
          <dd className="sl-fact-main">
            {earthAbove ? earthAbove.figure : '…'}
            <small>{earthAbove ? earthAbove.side : 'above the skyline'}</small>
          </dd>
          <dd className="sl-fact-small">{now && next ? earthLine(now.earth_up, next.earth.hours) : '…'}</dd>
          {earthShowing && <dd className="sl-fact-small is-showing">{earthShowing}</dd>}
        </div>
        <div className="sl-fact is-ground" tabIndex={0} title={slope ? `The ground's slope over ${slope.baseline_m} m, from the LOLA terrain, against the steepest ground your mission allows.` : undefined}>
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
      {/* Always there, so nothing moves when the comparison arrives. */}
      {horizons && data && now ? (
        <p className="sl-horizons" title={`The Sun's and Earth's directions at every hour of the data at this site (${horizons.hours.toLocaleString('en-US')} hours each), compared with NASA JPL's Horizons service. The largest gap is the rounding of the numbers shown here.`}>
          <span aria-hidden="true">✓</span> Matches Horizons within {withinWords(horizons.max_deg)} · Reproduce:{' '}
          <a href={horizonsQueryUrl('sun', data.site.lat, data.site.lon, horizons.alt_km, now.t)} target="_blank" rel="noreferrer" title="Reproduce in Horizons: opens NASA's own answer for the Sun at this site and hour. The last two numbers are its azimuth and its height">
            Sun
          </a>
          ,{' '}
          <a href={horizonsQueryUrl('earth', data.site.lat, data.site.lon, horizons.alt_km, now.t)} target="_blank" rel="noreferrer" title="Reproduce in Horizons: opens NASA's own answer for Earth at this site and hour. The last two numbers are its azimuth and its height">
            Earth
          </a>
        </p>
      ) : (
        // A custom point was never compared ahead of time: NASA's answer is one click away instead.
        <p className="sl-horizons">{data && now && isCustomSite(data.site) && <HorizonsLive lat={data.site.lat} lon={data.site.lon} hour={now.t} ours={{ sunEl: now.sun_el, earthEl: now.earth_el }} />}</p>
      )}
    </div>
  )
}
