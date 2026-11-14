import { area, line, scaleLinear } from 'd3'
import { useId, useMemo } from 'react'
import type { HorizonPoint, TrackPoint } from '../data/contract'
import { type AzEl, closeHorizon, panoramaDomain, splitAtWrap } from '../lib/panorama'
import { useWidth } from '../lib/useWidth'

interface Props {
  horizon: HorizonPoint[]
  track: TrackPoint[]
  index: number
  /** Elevation axis to use instead of this site's own, so panoramas can share a scale. */
  domain?: [number, number]
}

const COMPASS = [
  { az: 0, label: 'N' },
  { az: 90, label: 'E' },
  { az: 180, label: 'S' },
  { az: 270, label: 'W' },
  { az: 360, label: 'N' },
]
const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 }

export function HorizonPanorama({ horizon, track, index, domain }: Props) {
  const [ref, width] = useWidth()
  const clipId = useId()
  const height = Math.max(260, Math.min(460, width * 0.42))

  const { sunPath, earthPath, ownDomain } = useMemo(() => {
    const sun: AzEl[] = track.map((p) => ({ az: p.sun_az, el: p.sun_el }))
    const earth: AzEl[] = track.map((p) => ({ az: p.earth_az, el: p.earth_el }))
    return {
      sunPath: splitAtWrap(sun),
      earthPath: splitAtWrap(earth),
      ownDomain: panoramaDomain(horizon, track),
    }
  }, [horizon, track])

  const now = track[index]
  const x = scaleLinear([0, 360], [MARGIN.left, Math.max(width - MARGIN.right, MARGIN.left + 1)])
  const y = scaleLinear(domain ?? ownDomain, [height - MARGIN.bottom, MARGIN.top])
  const bottom = height - MARGIN.bottom
  // A body far below the chart stays on its lower edge, still marked as blocked.
  const markerY = (el: number) => Math.min(y(el), bottom)
  const toLine = line<AzEl>(
    (p) => x(p.az),
    (p) => y(p.el),
  )
  const terrain = area<AzEl>()
    .x((p) => x(p.az))
    .y0(height - MARGIN.bottom)
    .y1((p) => y(p.el))(closeHorizon(horizon))

  const description =
    `Horizon panorama at ${now.t}. Sun at azimuth ${now.sun_az}°, elevation ${now.sun_el}°, ` +
    `${now.sun_up ? 'up' : 'blocked'}. Earth at azimuth ${now.earth_az}°, elevation ${now.earth_el}°, ` +
    `${now.earth_up ? 'up' : 'blocked'}.`

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={description}>
          {y.ticks(6).map((el) => (
            <g key={el}>
              <line className="grid" x1={MARGIN.left} x2={x(360)} y1={y(el)} y2={y(el)} />
              <text className="tick" x={MARGIN.left - 6} y={y(el) + 4} textAnchor="end">
                {el}°
              </text>
            </g>
          ))}
          <clipPath id={clipId}>
            <rect x={MARGIN.left} y={MARGIN.top} width={x(360) - MARGIN.left} height={bottom - MARGIN.top} />
          </clipPath>
          <path className="terrain" d={terrain ?? undefined} />
          <g clipPath={`url(#${clipId})`}>
            {sunPath.map((segment, i) => (
              <path key={i} className="track sun-line" d={toLine(segment) ?? undefined} />
            ))}
            {earthPath.map((segment, i) => (
              <path key={i} className="track earth-line" d={toLine(segment) ?? undefined} />
            ))}
          </g>
          {COMPASS.map(({ az, label }) => (
            <text key={az} className="tick" x={x(az)} y={height - 8} textAnchor="middle">
              {label}
            </text>
          ))}
          <Marker name="Earth" kind="earth" up={now.earth_up} cx={x(now.earth_az)} cy={markerY(now.earth_el)} />
          <Marker name="Sun" kind="sun" up={now.sun_up} cx={x(now.sun_az)} cy={markerY(now.sun_el)} />
        </svg>
      )}
    </div>
  )
}

interface MarkerProps {
  name: string
  kind: 'sun' | 'earth'
  up: boolean
  cx: number
  cy: number
}

/** A filled disk when up, a hollow one when blocked, so the state doesn't rely on color alone. */
function Marker({ name, kind, up, cx, cy }: MarkerProps) {
  return (
    <g className={`marker ${kind} ${up ? 'up' : 'blocked'}`}>
      <circle cx={cx} cy={cy} r={7} />
      <text x={cx} y={cy - 12} textAnchor="middle">
        {name}
      </text>
    </g>
  )
}
