import { area, line, scaleLinear } from 'd3'
import { useMemo } from 'react'
import type { HorizonPoint, TrackPoint } from '../data/contract'
import { MOON_RADIUS_M } from '../lib/customModel'
import { splitAtWrap } from '../lib/panorama'
import { ABOVE_SKYLINE_MEANS, skylineCentre, skylineDomain, skylineHorizon, skylineReadout, skylineStretch, skylineX, smoothHorizonDeg, stretchWords } from '../lib/sightline'
import { stripLabels } from '../lib/sightlineDots'
import { useWidth } from '../lib/useWidth'
import { useFitLevel, useShortWindow } from './hooks'

interface Props {
  /** The site's horizon from the pipeline: 720 points round the compass. Null while it loads. */
  horizon: HorizonPoint[] | null
  /** The month on the playhead, for the Sun's track and Earth's loop. */
  track: TrackPoint[] | null
  /** The hour on the playhead within the track. */
  index: number
  /** How high above the ground the horizon was worked out for, in metres. */
  obsHeightM: number
  /** How far the Sun's and Earth's centres stand above the skyline at that hour, in degrees; null while it loads. */
  above: { sunDeg: number | null; earthDeg: number | null }
  folded: boolean
  onFold: (folded: boolean) => void
}

/** The picture's height: a little less in a short window (a 1366 by 768 laptop), where the Moon needs the room. */
const HEIGHT_TALL = 120
const HEIGHT_SHORT = 88
/** What the strip is, for the folded bar's hover text. */
const STRIP_MEANS = "Opens the whole horizon at this site, with the Sun and Earth on it at the time bar's hour."
const MARGIN = { top: 8, bottom: 16, left: 30, right: 6 }
const COMPASS = [
  { az: 0, label: 'N' },
  { az: 90, label: 'E' },
  { az: 180, label: 'S' },
  { az: 270, label: 'W' },
]

/** What the two thin lines on the skyline are, in plain words, for their hover text. */
const EARTH_PATH_MEANS = 'Where Earth goes over the month. The Moon rocks slightly, so Earth draws a small loop instead of standing still.'
const SUN_PATH_MEANS = 'Where the Sun goes over the month, seen from the site.'

/**
 * What the lander sees: all 360° of the real horizon at the site as one strip, centred on the
 * compass point nearest Earth, with the Sun and Earth where they are at the hour on the playhead, the Sun's track and Earth's
 * loop through the month, and a dashed line where a smooth Moon's horizon would be. Heights are
 * stretched to be readable, and the strip says by how much.
 *
 * Folded, it does not go away: it is one thin bar in the same place, above the time bar, with its
 * name, how far the Sun and Earth stand above the skyline at the time bar's hour, and "Open". The
 * whole bar is the press, so the way back is where the strip was.
 */
export function Skyline({ horizon, track, index, obsHeightM, above, folded, onFold }: Props) {
  const HEIGHT = useShortWindow() ? HEIGHT_SHORT : HEIGHT_TALL
  // The header is one row: 3 is everything; each level down drops a note.
  const head = useFitLevel<HTMLDivElement>(3)
  const [ref, width] = useWidth()
  const drawn = useMemo(() => {
    if (!horizon || !track || track.length === 0) return null
    const centre = skylineCentre(track)
    return {
      centre,
      land: skylineHorizon(horizon, centre),
      sun: splitAtWrap(track.map((point) => ({ az: skylineX(point.sun_az, centre), el: point.sun_el }))),
      earth: splitAtWrap(track.map((point) => ({ az: skylineX(point.earth_az, centre), el: point.earth_el }))),
      domain: skylineDomain(horizon, track),
    }
  }, [horizon, track])

  const now = track ? track[Math.min(index, track.length - 1)] : null
  const bottom = HEIGHT - MARGIN.bottom
  const x = scaleLinear([0, 360], [MARGIN.left, Math.max(width - MARGIN.right, MARGIN.left + 1)])
  const y = scaleLinear(drawn?.domain ?? [-1, 1], [bottom, MARGIN.top])
  const stretch = drawn ? skylineStretch(x(360) - x(0), bottom - MARGIN.top, drawn.domain) : 1
  const smooth = smoothHorizonDeg(obsHeightM, MOON_RADIUS_M)
  const toLine = line<{ az: number; el: number }>(
    (point) => x(point.az),
    (point) => y(point.el),
  )
  const land = drawn
    ? area<{ x: number; el: number }>()
        .x((point) => x(point.x))
        .y0(bottom)
        .y1((point) => y(point.el))(drawn.land)
    : null
  // A body far below the strip stays on its lower edge, still marked as hidden.
  const markY = (el: number) => Math.min(Math.max(y(el), MARGIN.top), bottom)
  // The names keep clear of each other and of the strip's edges: above their bodies, under them when
  // there is no room above, and side by side when the Sun and Earth are close.
  const sunName = now ? `Sun${now.sun_up ? '' : ' (hidden)'}` : ''
  const earthName = now ? `Earth${now.earth_up ? '' : ' (hidden)'}` : ''
  const names =
    now && drawn
      ? stripLabels(
          { x: x(skylineX(now.sun_az, drawn.centre)), y: markY(now.sun_el), text: sunName, reach: 6 },
          { x: x(skylineX(now.earth_az, drawn.centre)), y: markY(now.earth_el), text: earthName, reach: 8 },
          { left: x(0), right: x(360), top: 0, bottom: bottom },
        )
      : null
  const description = now
    ? `The horizon all the way round. The Sun's elevation is ${now.sun_el.toFixed(1)}° and it is ${now.sun_up ? 'in view' : 'hidden'}; Earth's elevation is ${now.earth_el.toFixed(1)}° and it is ${now.earth_up ? 'in view' : 'hidden'}.`
    : 'The horizon all the way round.'

  const readout = (
    <span className="sl-sky-readout" title={folded ? undefined : ABOVE_SKYLINE_MEANS}>
      {skylineReadout(above.sunDeg, above.earthDeg)}
    </span>
  )
  if (folded) {
    return (
      <section id="sl-sky" className="sl-sky is-folded" aria-label="What the lander sees">
        <button type="button" className="sl-sky-bar" aria-expanded={false} title={STRIP_MEANS} onClick={() => onFold(false)}>
          <span className="sl-strip-title">What the lander sees</span> {readout}{' '}
          {/* The same word, in the same place and dress, as the time bar's own "Open" when it is folded. */}
          <span className="sl-small sl-sky-open">Open</span>
        </button>
      </section>
    )
  }

  return (
    <section id="sl-sky" className="sl-sky" aria-label="What the lander sees">
      {/* One row: the notes give way, the least needed first, when the strip is narrow. */}
      <div ref={head.ref} className="sl-strip-head sl-sky-head">
        <span className="sl-strip-title">What the lander sees</span>
        {readout}
        {head.level >= 1 && (
          <span className="sl-legend">
            {head.level >= 3 && 'all 360° of the horizon'}
            {head.level >= 3 && drawn && width > 0 && ', '}
            {drawn && width > 0 && stretchWords(stretch)}
          </span>
        )}
        {head.level >= 2 && (
          <span className="sl-legend">
            <i className="sl-dash" aria-hidden="true" /> a smooth Moon's horizon
          </span>
        )}
        <button type="button" className="sl-small sl-fold" aria-expanded={true} title="Folds the skyline to one line, here, above the time bar." onClick={() => onFold(true)}>
          Fold
        </button>
      </div>
      <div ref={ref} className="sl-sky-body">
          {width > 0 && drawn && now && (
            <svg width={width} height={HEIGHT} role="img" aria-label={description}>
              {y.ticks(3).map((el) => (
                <text key={el} className="sl-sky-tick" x={MARGIN.left - 5} y={y(el) + 3.5} textAnchor="end">
                  {el}°
                </text>
              ))}
              <clipPath id="sl-sky-clip">
                <rect x={MARGIN.left} y={MARGIN.top} width={x(360) - MARGIN.left} height={bottom - MARGIN.top} />
              </clipPath>
              <g clipPath="url(#sl-sky-clip)">
                {drawn.sun.map((segment, i) => (
                  <path key={`sun-${i}`} className="sl-sky-path is-sun" d={toLine(segment) ?? undefined} />
                ))}
                {drawn.earth.map((segment, i) => (
                  <path key={`earth-${i}`} className="sl-sky-path is-earth" d={toLine(segment) ?? undefined} />
                ))}
                {/* The thin lines say what they are on hover: a wide unseen stroke over each, easy to point at. */}
                {drawn.sun.map((segment, i) => (
                  <path key={`sun-hit-${i}`} className="sl-sky-hit" d={toLine(segment) ?? undefined} data-tip={SUN_PATH_MEANS} />
                ))}
                {drawn.earth.map((segment, i) => (
                  <path key={`earth-hit-${i}`} className="sl-sky-hit" d={toLine(segment) ?? undefined} data-tip={EARTH_PATH_MEANS} />
                ))}
              </g>
              {/* A body in view goes behind the land, so the ridge cuts a disc it partly hides. */}
              {now.earth_up && <circle className="sl-sky-body-mark is-earth" cx={x(skylineX(now.earth_az, drawn.centre))} cy={markY(now.earth_el)} r={7} />}
              {now.sun_up && <circle className="sl-sky-body-mark is-sun" cx={x(skylineX(now.sun_az, drawn.centre))} cy={markY(now.sun_el)} r={5} />}
              <path className="sl-sky-land" d={land ?? undefined} />
              {/* A hidden one is a hollow ring drawn on the land, where it sits behind it. */}
              {!now.earth_up && <circle className="sl-sky-body-mark is-earth is-hidden" cx={x(skylineX(now.earth_az, drawn.centre))} cy={markY(now.earth_el)} r={7} />}
              {!now.sun_up && <circle className="sl-sky-body-mark is-sun is-hidden" cx={x(skylineX(now.sun_az, drawn.centre))} cy={markY(now.sun_el)} r={5} />}
              <line className="sl-sky-smooth" x1={x(0)} x2={x(360)} y1={y(smooth)} y2={y(smooth)} />
              {/* Names above the bodies, so neither relies on colour. */}
              {names && (
                <>
                  <text className="sl-sky-name" x={names.earth.x} y={names.earth.y} textAnchor="middle">
                    {earthName}
                  </text>
                  <text className="sl-sky-name" x={names.sun.x} y={names.sun.y} textAnchor="middle">
                    {sunName}
                  </text>
                </>
              )}
              {COMPASS.map((point) => (
                <text key={point.label} className="sl-sky-tick" x={x(skylineX(point.az, drawn.centre)) + 4} y={HEIGHT - 4}>
                  {point.label}
                </text>
              ))}
            </svg>
          )}
          {(!drawn || !now) && <p className="sl-quiet">Reading the horizon…</p>}
        </div>
    </section>
  )
}
