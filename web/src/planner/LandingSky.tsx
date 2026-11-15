import { area, line, scaleLinear } from 'd3'
import { useEffect, useMemo, useState } from 'react'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { loadHorizon, loadScenario, loadTrack } from '../data/loadSite'
import { sunHeightWords } from '../lib/answer'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import { hourOf, locateHour, longestDown, missionEarth, type Requirements } from '../lib/mission'
import { hoursUntilChange } from '../lib/nextChange'
import { splitAtWrap } from '../lib/panorama'
import { skylineCentre, skylineDomain, skylineHorizon, skylineX } from '../lib/sightline'
import { skylineFigure } from '../lib/sightlineSky'
import { useWidth } from '../lib/useWidth'

interface Props {
  site: SiteInfo
  flags: SiteFlags
  /** The landing hour, ISO. */
  t: string
  requirements: Requirements
}

/** The Sun's height over the mission, from the pipeline's hourly track. */
interface SunHeights {
  /** Above eye level (the flat horizon) at landing, and above the real skyline. */
  atLanding: { elDeg: number; up: boolean; aboveSkylineDeg: number } | null
  /** Lowest and highest above eye level while the Sun is in view during the mission; null if it never is. */
  whileUp: { lowDeg: number; highDeg: number } | null
}

/** The site's skyline and the mission's hours of the track, once loaded; null if they failed. */
type Loaded = { key: string; sky: { horizon: HorizonPoint[]; during: TrackPoint[]; heights: SunHeights; centre: number } | null }

/** The months ("YYYY-MM") the hours from `from` to `to` fall in, in order. */
function monthsBetween(start: string, from: number, to: number): string[] {
  const months: string[] = []
  for (let h = from; h <= to; h += 24) months.push(locateHour(start, h).month)
  months.push(locateHour(start, to).month)
  return [...new Set(months)]
}

function sunHeights(during: TrackPoint[], horizon: HorizonPoint[], t: string): SunHeights {
  const now = during.find((point) => point.t === t) ?? null
  const up = during.filter((point) => point.sun_up).map((point) => point.sun_el)
  return {
    atLanding: now ? { elDeg: now.sun_el, up: now.sun_up, aboveSkylineDeg: now.sun_el - horizonAt(horizon, now.sun_az) } : null,
    whileUp: up.length > 0 ? { lowDeg: Math.min(...up), highDeg: Math.max(...up) } : null,
  }
}

/** A span in the brief's own short form: "12d 7h", "36h". */
function compact(hours: number): string {
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

/** When a body next sets or rises, from the landing: "in 12d 7h", or that it doesn't in our data. */
function nextIn(up: boolean, hours: number | null, body: 'Sun' | 'Earth'): string {
  if (hours !== null) return `in ${compact(hours)}`
  if (body === 'Sun') return up ? 'stays up' : 'stays down'
  return up ? 'stays in view' : 'stays hidden'
}

/** "during the mission" or "after it ends", so a planner sees at once whether the change matters. */
function whenWords(hours: number | null, missionHours: number): string {
  if (hours === null) return 'for as long as our data runs'
  return hours < missionHours ? 'during the mission' : 'after the mission ends'
}

function share(flags: boolean[], from: number, to: number): number {
  let on = 0
  for (let i = from; i < to; i += 1) if (flags[i]) on += 1
  return to > from ? on / (to - from) : 0
}

type Band = 'both' | 'sun' | 'earth' | 'none'
/** Where each state sits in the bar, so it reads without colour: both fills it, the Sun the top, Earth the bottom, neither a thin line. */
const BAND: Record<Band, { y: number; height: number }> = { both: { y: 0, height: 12 }, sun: { y: 0, height: 7 }, earth: { y: 5, height: 7 }, none: { y: 5.25, height: 1.5 } }

/** The mission hour by hour, from the landing: Sun, Earth (by the mission's rule), both or neither. */
function MissionTimeline({ sun, earth, from, hours, days }: { sun: boolean[]; earth: boolean[]; from: number; hours: number; days: number }) {
  const runs = useMemo(() => {
    const out: { from: number; to: number; band: Band }[] = []
    for (let h = 0; h < hours; h += 1) {
      const s = sun[from + h] === true
      const e = earth[from + h] === true
      const band: Band = s && e ? 'both' : s ? 'sun' : e ? 'earth' : 'none'
      const last = out[out.length - 1]
      if (last && last.band === band) last.to = h + 1
      else out.push({ from: h, to: h + 1, band })
    }
    return out
  }, [sun, earth, from, hours])
  // About four labels across the brief's narrow column: the landing, a few days, and always the last day.
  const step = Math.max(1, Math.ceil(days / 4))
  const inner = Array.from({ length: Math.floor(days / step) + 1 }, (_, n) => n * step).filter((day) => day === 0 || days - day > step / 2)
  const ticks = inner[inner.length - 1] === days ? inner : [...inner, days]
  return (
    <figure className="pl-timeline">
      <svg viewBox={`0 0 ${Math.max(hours, 1)} 12`} preserveAspectRatio="none" role="img" aria-label="The mission hour by hour from the landing: when the Sun, Earth, both or neither are in view.">
        {runs.map((run) => (
          <rect key={run.from} className={`pl-run is-${run.band}`} x={run.from} y={BAND[run.band].y} width={run.to - run.from} height={BAND[run.band].height} />
        ))}
      </svg>
      <div className="pl-timeline-axis" aria-hidden="true">
        {ticks.map((day) => (
          <span key={day} style={{ left: `${(100 * day * 24) / Math.max(hours, 1)}%` }}>
            {day === 0 ? 'landing' : `day ${day}`}
          </span>
        ))}
      </div>
      <figcaption className="pl-legend">
        <i className="pl-run-key is-sun" /> Sun <i className="pl-run-key is-earth" /> Earth <i className="pl-run-key is-both" /> Both <i className="pl-run-key is-none" /> Neither
      </figcaption>
    </figure>
  )
}

const SKY_HEIGHT = 110
const SKY_MARGIN = { top: 8, bottom: 16, left: 4, right: 4 }
const COMPASS = [
  { az: 0, label: 'N' },
  { az: 90, label: 'E' },
  { az: 180, label: 'S' },
  { az: 270, label: 'W' },
]

/**
 * The real skyline all the way round, with the paths the Sun and Earth take over the mission and
 * where each is at landing: the same drawing as the Moon screen's "What the lander sees", sized
 * for the brief. Heights are stretched so the terrain and the low Sun can be told apart.
 */
function SkylinePicture({ horizon, during, t, centre }: { horizon: HorizonPoint[]; during: TrackPoint[]; t: string; centre: number }) {
  const [ref, width] = useWidth()
  const drawn = useMemo(() => {
    return {
      centre,
      land: skylineHorizon(horizon, centre),
      sun: splitAtWrap(during.map((point) => ({ az: skylineX(point.sun_az, centre), el: point.sun_el }))),
      earth: splitAtWrap(during.map((point) => ({ az: skylineX(point.earth_az, centre), el: point.earth_el }))),
      domain: skylineDomain(horizon, during),
    }
  }, [horizon, during, centre])
  const now = during.find((point) => point.t === t) ?? null
  const bottom = SKY_HEIGHT - SKY_MARGIN.bottom
  const x = scaleLinear([0, 360], [SKY_MARGIN.left, Math.max(width - SKY_MARGIN.right, SKY_MARGIN.left + 1)])
  const y = scaleLinear(drawn.domain, [bottom, SKY_MARGIN.top])
  const ground = area<{ x: number; el: number }>()
    .x((point) => x(point.x))
    .y0(bottom)
    .y1((point) => y(point.el))(drawn.land)
  const path = line<{ az: number; el: number }>()
    .x((point) => x(point.az))
    .y((point) => y(point.el))
  return (
    <figure className="pl-skyline" ref={ref}>
      {width > 0 && (
        <svg width={width} height={SKY_HEIGHT} role="img" aria-label={`The skyline all the way round the site, with the Sun's and Earth's paths over the mission${now ? `; at landing the Sun is ${now.sun_up ? 'in view' : 'hidden'} and Earth is ${now.earth_up ? 'in view' : 'hidden'}` : ''}.`}>
          {drawn.sun.map((segment, i) => (
            <path key={`s${i}`} className="pl-sky-path is-sun" d={path(segment) ?? ''} />
          ))}
          {drawn.earth.map((segment, i) => (
            <path key={`e${i}`} className="pl-sky-path is-earth" d={path(segment) ?? ''} />
          ))}
          <path className="pl-sky-ground" d={ground ?? ''} />
          {now && (
            <>
              <circle className={`pl-sky-mark is-earth ${now.earth_up ? '' : 'is-hidden'}`} cx={x(skylineX(now.earth_az, drawn.centre))} cy={y(now.earth_el)} r={5} />
              <circle className={`pl-sky-mark is-sun ${now.sun_up ? '' : 'is-hidden'}`} cx={x(skylineX(now.sun_az, drawn.centre))} cy={y(now.sun_el)} r={5} />
            </>
          )}
          {COMPASS.map((point) => (
            <text key={point.label} className="pl-sky-compass" x={x(skylineX(point.az, drawn.centre))} y={SKY_HEIGHT - 3} textAnchor="middle">
              {point.label}
            </text>
          ))}
        </svg>
      )}
      <figcaption className="pl-legend">
        <i className="pl-sky-key is-sun" /> Sun at landing, and its path <i className="pl-sky-key is-earth" /> Earth at landing, and its path. Grey is the real terrain all the way round; heights are stretched to be readable.
      </figcaption>
    </figure>
  )
}

/**
 * What the sky does from the landing on: how long until sunset and Earthset, how much of the mission
 * has the Sun and Earth, the mission hour by hour, how high the Sun stands, and the skyline with the
 * Sun's and Earth's paths. Times and shares count the hourly flags; heights and the skyline come from
 * the same hourly track and horizon the other tabs draw. Nothing here is new data.
 */
export function LandingSky({ site, flags, t, requirements }: Props) {
  const hour = hourOf(flags.start, t)
  const missionHours = requirements.missionDays * 24
  const end = Math.min(hour + missionHours, flags.sun.length)
  const lastHour = Math.max(hour, end - 1)
  const earth = missionEarth(flags, requirements)
  const sunUp = flags.sun[hour] ?? false
  const earthUp = earth[hour] ?? false
  const sunHours = hoursUntilChange(flags.sun, hour, 1)
  const earthHours = hoursUntilChange(earth, hour, 1)
  const figures = {
    sunlit: share(flags.sun, hour, end),
    dark: longestDown(flags.sun, hour, end),
    earthIn: share(earth, hour, end),
    silence: longestDown(earth, hour, end),
  }
  const cut = end < hour + missionHours

  const key = `${site.id}@${t}@${lastHour}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    let current = true
    const fromMs = Date.parse(t)
    const endMs = fromMs + (lastHour - hour) * 3_600_000
    const months = monthsBetween(flags.start, hour, lastHour)
    // A listed site's files directly; a custom point's months are worked out by the app's own model.
    const request: Promise<[HorizonPoint[], TrackPoint[][]]> = isCustomSite(site)
      ? Promise.all(months.map((month) => loadScenario(site, month))).then((parts) => [parts[0].horizon, parts.map((part) => part.track)])
      : Promise.all([loadHorizon(site), Promise.all(months.map((month) => loadTrack(site, month)))])
    request
      .then(([horizon, tracks]) => {
        const during = tracks.flat().filter((point) => {
          const ms = Date.parse(point.t)
          return ms >= fromMs && ms <= endMs
        })
        // The strip's middle is chosen as the plan's skyline chooses it, from Earth over the landing's whole month, so both read in one order.
        if (current) setLoaded({ key, sky: { horizon, during, heights: sunHeights(during, horizon, t), centre: skylineCentre(tracks[0] ?? during) } })
      })
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setLoaded({ key, sky: null })
      })
    return () => {
      current = false
    }
  }, [key, site, flags.start, t, hour, lastHour])

  const sky = loaded?.key === key ? loaded.sky : undefined
  const heights = sky?.heights
  const at = heights?.atLanding ?? null
  const skyline = at ? skylineFigure(at.aboveSkylineDeg) : null
  const pct = (value: number) => `${Math.round(value * 100)}%`

  return (
    <section className="pl-sky" aria-labelledby="pl-sky-title">
      <h3 className="pl-label" id="pl-sky-title">
        From the landing on
      </h3>
      <dl className="pl-sky-facts">
        <div className={`pl-sky-fact is-sun ${sunUp ? '' : 'is-down'}`}>
          <dt>{sunUp ? 'Sunset' : 'Sunrise'}</dt>
          <dd className="pl-sky-main">{nextIn(sunUp, sunHours, 'Sun')}</dd>
          <dd className="pl-sky-small">{whenWords(sunHours, missionHours)}</dd>
        </div>
        <div className={`pl-sky-fact is-earth ${earthUp ? '' : 'is-down'}`}>
          <dt>{earthUp ? 'Earthset' : 'Earthrise'}</dt>
          <dd className="pl-sky-main">{nextIn(earthUp, earthHours, 'Earth')}</dd>
          <dd className="pl-sky-small">{whenWords(earthHours, missionHours)}</dd>
        </div>
      </dl>

      {/* Power and radio over the whole mission: the figures a planner checks a landing against. */}
      <h4 className="pl-sky-sub">Power and radio over the mission{cut ? ' (to the end of our data)' : ''}</h4>
      <dl className="pl-sky-figures">
        <div title="Share of the mission's hours with the Sun in view: solar power.">
          <dt>Sunlit</dt>
          <dd>{pct(figures.sunlit)}</dd>
        </div>
        <div title={`Longest stretch with no Sun, which batteries must carry. Your limit is ${requirements.maxSunGapH} h.`} className={figures.dark > requirements.maxSunGapH ? 'is-over' : undefined}>
          <dt>Longest dark</dt>
          <dd>{compact(figures.dark)}</dd>
        </div>
        <div title="Share of the mission's hours with Earth in view, by your rule for Earth: a direct radio link.">
          <dt>Earth in view</dt>
          <dd>{pct(figures.earthIn)}</dd>
        </div>
        <div title={`Longest stretch with no Earth: no direct radio link. Your limit is ${requirements.maxEarthGapH} h.`} className={figures.silence > requirements.maxEarthGapH ? 'is-over' : undefined}>
          <dt>Longest silence</dt>
          <dd>{compact(figures.silence)}</dd>
        </div>
      </dl>

      <h4 className="pl-sky-sub">The mission hour by hour</h4>
      <MissionTimeline sun={flags.sun} earth={earth} from={hour} hours={end - hour} days={requirements.missionDays} />

      <h4 className="pl-sky-sub">The Sun's height, for power</h4>
      <div className="pl-sky-height" title="How high the Sun stands decides how much a solar panel can collect. Eye level is the flat horizon; the skyline is the real terrain around the site.">
        <p className="pl-sky-main">{sky === undefined ? '…' : at ? `${Math.abs(at.elDeg).toFixed(1)}° at landing` : '–'}</p>
        <p className="pl-sky-small">
          {sky === undefined
            ? 'Reading the Sun’s path…'
            : sky === null
              ? 'The Sun’s path didn’t load.'
              : at && skyline
                ? `${sunHeightWords(at.elDeg, at.up).replace(/^[\d.]+° /, '')}; ${skyline.figure} ${skyline.side}`
                : 'Outside our data.'}
          {heights?.whileUp && (
            <>
              <br />
              While up during the mission: {heights.whileUp.lowDeg.toFixed(1)}° to {heights.whileUp.highDeg.toFixed(1)}°
            </>
          )}
        </p>
      </div>

      <h4 className="pl-sky-sub">What the lander sees</h4>
      {sky ? <SkylinePicture horizon={sky.horizon} during={sky.during} t={t} centre={sky.centre} /> : <p className="pl-sky-small">{sky === null ? 'The skyline didn’t load.' : 'Drawing the skyline…'}</p>}
    </section>
  )
}
