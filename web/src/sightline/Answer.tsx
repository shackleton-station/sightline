import { type ReactNode, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { useHorizonsCheck } from '../data/horizonsCheck'
import type { ScenarioData } from '../data/loadSite'
import { answerAt } from '../lib/answer'
import { type Check, CHECK_MARK, gapCheck, landingCheck, landingWords, sharePct } from '../lib/columnStats'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import type { MissionHeights } from '../lib/heights'
import type { Requirements } from '../lib/mission'
import { aboveSkylineMeans } from '../lib/sightline'
import { NO_LIMIT_H, type ScenarioMeasure, shareHours } from '../lib/sightlineMission'
import { groundLine, landingSentence, nextWords, showingWords, skylineFigure } from '../lib/sightlineSky'
import { HorizonsClaim } from './HorizonsClaim'
import { HorizonsLive } from './HorizonsLive'
import { type BodyOver, OverAxis, OverChart } from './LightChart'

interface Props {
  /** The site, in the month of the landing; null while it loads. */
  data: ScenarioData | null
  /** The landing's hour, from the pipeline's track; null while it loads. */
  now: TrackPoint | null
  flags: SiteFlags | null
  /** Why the site and month can't be shown, if they can't. */
  error: string | null
  maxSlopeDeg: number
  /** The mission's limits, which each row is held to. */
  requirements: Requirements
  /**
   * The landing measured over the mission, by the functions Compare uses (`measureScenario`,
   * `bothPct`), so a figure here and the same figure there are one number. Null until the site's hours are in.
   */
  stats: { measure: ScenarioMeasure; bothPct: number | null } | null
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
   * The mission's limits are open in the column. Like the charts, the lines about the landing's hour
   * and the line about Horizons step aside while they are, so the verdict, the limits and the Sun,
   * Earth and ground all stay on a small laptop's screen (1366 by 768) without scrolling.
   */
  limitsOpen?: boolean
}

const SUN_MEANS = 'The share of the mission’s hours with any of the Sun in view from the panel. More means more solar power.'
const EARTH_MEANS = 'The share of the mission’s hours with Earth in view from the antenna, by your rule. More means more time with a direct radio link.'
const BOTH_MEANS = 'The share of the mission’s hours with the Sun and Earth in view at once: power and a direct radio link together.'
const DARK_MEANS = 'The longest unbroken time without the Sun during the mission. It must not be longer than the limit you set.'
const SILENCE_MEANS = 'The longest unbroken time without Earth in view during the mission. It must not be longer than your limit, if you set one.'

/** A line of a row that is held to a limit of the mission: its mark (✓, ◇ or ✗) in its state's colour, then its words. No mark where there is no limit. */
function CheckLine({ check, title, swatch = false, at = false, children }: { check: Check; title?: string; swatch?: boolean; at?: boolean; children: ReactNode }) {
  return (
    <dd className={`sl-fact-check is-${check}${at ? ' sl-fact-at' : ''}`} data-check={check} title={title}>
      {/* The shading of the chart's band under this line. */}
      {swatch && <i aria-hidden="true" />}
      <span>
        {check !== 'none' && (
          <span className="sl-check-mark" aria-hidden="true">
            {CHECK_MARK[check]}{' '}
          </span>
        )}
        {children}
      </span>
    </dd>
  )
}

/**
 * The answer for the landing. The verdict leads, with the plan's three controls under it. Then four
 * rows, each led by the figure a planner decides on. The Sun and Earth: the share of the mission
 * each is in view, then its longest time out of view against the mission's limit, charted over the
 * mission, then where it stands at the landing's hour. The Sun and Earth together: the share of the
 * mission with power and a radio link at once. The ground: its slope against the limit. Every line
 * that a limit of the mission holds carries its own mark, in the verdict's colours. Last, how closely
 * the numbers match JPL Horizons, as one line that opens the proof.
 *
 * The shares and the longest times are the ones Compare shows, from the same functions. What is said
 * of the landing's hour is read from the pipeline's track and horizon. It does not follow the time bar.
 */
export function Answer({ data, now, flags, error, maxSlopeDeg, requirements, stats, heights, heightsLine, earthShare, verdict, plan, over, limitsOpen = false }: Props) {
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
  // A disc the skyline cuts is said so, with its share, in the line about the landing's hour.
  const sunShowing = now ? showingWords(now.sun_frac, now.sun_up) : null
  const earthShowing = now ? showingWords(earthShare, now.earth_up) : null
  // Each row against the mission's limits: the longest time out of view, and the landing's own hour.
  const days = requirements.missionDays
  const measure = stats?.measure ?? null
  const sunGap = measure && measure.sunGapH !== null ? gapCheck('sun', measure.sunGapH, requirements.maxSunGapH, days) : null
  const earthGap = measure && measure.earthGapH !== null ? gapCheck('earth', measure.earthGapH, requirements.maxEarthGapH >= NO_LIMIT_H ? null : requirements.maxEarthGapH, days) : null
  const sunAt = now ? landingCheck(requirements.sunAtLanding, now.sun_up, now.sun_frac) : 'none'
  const earthAt = now ? landingCheck(requirements.earthAtLanding, now.earth_up, earthShare) : 'none'
  // A share of the mission: the main figure, and the hours behind it.
  const share = (pct: number | null | undefined, what: string) => ({
    main: pct === undefined ? '…' : pct === null ? '–' : sharePct(pct),
    small: pct === undefined ? '…' : pct === null ? 'the mission runs past our data' : `${what} ${shareHours(pct, days)}`,
  })
  const sun = share(measure ? measure.sunPct : undefined, 'sunlit')
  const earth = share(measure ? measure.earthPct : undefined, 'in view')
  const both = share(stats ? stats.bothPct : undefined, 'power and radio at once,')

  return (
    <div className="sl-answer">
      {verdict}
      {plan}
      {/* What is in view at landing, in one sentence, for a screen reader: on the screen the rows say it. */}
      <p className="sl-sentence visually-hidden" role="status">
        {now ? landingSentence(now.sun_frac, earthShare, now.earth_up) : 'Working out the light here…'}
      </p>
      {heightsLine && <p className="sl-heights-line">{heightsLine}</p>}
      {/* With the mission's limits open the rows are at their shortest: the share, and the limit's own line beside it. */}
      <dl className={limitsOpen ? 'sl-facts is-tight' : 'sl-facts'} aria-busy={now ? undefined : true}>
        <div className="sl-fact is-sun" tabIndex={0} title={measure ? SUN_MEANS : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Sun
          </dt>
          <dd className="sl-fact-main">
            {sun.main}
            <small>of the mission</small>
          </dd>
          {!limitsOpen && <dd className="sl-fact-small">{sun.small}</dd>}
          {sunGap && (
            <CheckLine check={sunGap.check} title={DARK_MEANS} swatch={over !== null && sunGap.hours !== null}>
              {sunGap.words} {sunGap.hours && <b>{sunGap.hours}</b>} · {sunGap.limit}
            </CheckLine>
          )}
          {over && <OverChart kind="sun" over={over.sun} missionDays={over.missionDays} at={at} onAt={setAt} />}
          {!limitsOpen && (
            <CheckLine check={sunAt} title={aboveMeans && now ? aboveMeans : undefined} at>
              {now && next && sunAbove ? landingWords(sunAbove.figure, sunAbove.side, nextWords('Sun', now.sun_up, next.sun.hours), sunShowing) : 'At landing: …'}
            </CheckLine>
          )}
        </div>
        <div className="sl-fact is-earth" tabIndex={0} title={measure ? EARTH_MEANS : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Earth
          </dt>
          <dd className="sl-fact-main">
            {earth.main}
            <small>of the mission</small>
          </dd>
          {!limitsOpen && <dd className="sl-fact-small">{earth.small}</dd>}
          {earthGap && (
            <CheckLine check={earthGap.check} title={SILENCE_MEANS} swatch={over !== null && earthGap.hours !== null}>
              {earthGap.words} {earthGap.hours && <b>{earthGap.hours}</b>} · {earthGap.limit}
            </CheckLine>
          )}
          {over && <OverChart kind="earth" over={over.earth} missionDays={over.missionDays} at={at} onAt={setAt} />}
          {/* One line of days for both charts, which run over the same hours. */}
          {over && <OverAxis start={over.start} landing={over.landing} missionDays={over.missionDays} at={at} sun={over.sun} earth={over.earth} />}
          {!limitsOpen && (
            <CheckLine check={earthAt} title={earthAboveMeans && now ? earthAboveMeans : undefined} at>
              {now && next && earthAbove ? landingWords(earthAbove.figure, earthAbove.side, nextWords('Earth', now.earth_up, next.earth.hours), earthShowing) : 'At landing: …'}
            </CheckLine>
          )}
        </div>
        {/* No limit holds this one, so it steps aside with the charts while the limits are open. */}
        {!limitsOpen && (
          <div className="sl-fact is-both" tabIndex={0} title={stats ? BOTH_MEANS : undefined}>
            <dt>
              <i className="sl-fact-mark" aria-hidden="true" /> Sun and Earth together
            </dt>
            <dd className="sl-fact-main">
              {both.main}
              <small>of the mission</small>
            </dd>
            <dd className="sl-fact-small">{both.small}</dd>
          </div>
        )}
        <div className="sl-fact is-ground" tabIndex={0} title={slope ? `How steep the ground is, measured across ${slope.baseline_m} m of NASA's LOLA terrain map. Lower is safer for a lander.` : undefined}>
          <dt>
            <i className="sl-fact-mark" aria-hidden="true" /> Ground
          </dt>
          <dd className="sl-fact-main">
            {slope ? `${slope.deg.toFixed(1)}°` : data ? '?' : '…'}
            <small>slope</small>
          </dd>
          {ground ? <CheckLine check={ground.fails ? 'miss' : 'ok'}>{ground.text}</CheckLine> : <dd className="sl-fact-small">{data ? 'not known for this point' : '…'}</dd>}
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
