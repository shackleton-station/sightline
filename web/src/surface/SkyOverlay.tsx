import { acrossDeg, diskOutline, elevationMarks, type Lens, project } from '../lib/surfaceView'

export interface Marked {
  azDeg: number
  elDeg: number
  radiusDeg: number
  /** The track's answer: is any part of it above the horizon? */
  up: boolean
}

/** Where a body is at one hour near the one on screen. */
export interface HourDot {
  azDeg: number
  elDeg: number
  up: boolean
}

interface Props {
  lens: Lens
  width: number
  height: number
  sun: Marked
  earth: Marked
  /** The Sun's and Earth's positions for the hours just before and after this one, from the track; `first` is the first one's hour of the month. */
  hours: { first: number; sun: HourDot[]; earth: HourDot[] }
  /** The menus and compass cover this much of the top of the picture (px): no marks are drawn under them. */
  clearTopPx: number
}

/** The scale of elevations sits this far in from the left edge of the picture (px). */
const SCALE_INSET_PX = 14
const MIN_MARK_GAP_PX = 52
const EYE_LEVEL_STEPS = 24
/** Hour dots are kept at least this far apart, by showing one hour in every 1, 2, 3, 6, 12 or 24. */
const MIN_DOT_GAP_PX = 9
const HOUR_STRIDES = [1, 2, 3, 6, 12, 24]

/** "+2°", "−0.5°", and "eye level" for zero. */
function markLabel(el: number, stepDeg: number): string {
  if (el === 0) return 'eye level'
  const size = Math.abs(el).toFixed(stepDeg < 1 ? 1 : 0)
  return `${el > 0 ? '+' : '−'}${size}°`
}

/**
 * The lines and names drawn over the picture, placed with the same geometry the picture is drawn
 * with: a scale of true elevation down the left side, eye level, a dot for each hour of the Sun's
 * and Earth's path around now, a name by each of them, and a dashed outline where one is behind the
 * land. The disks and the land themselves are in the canvas below.
 */
export function SkyOverlay({ lens, width, height, sun, earth, hours, clearTopPx }: Props) {
  const px = (x: number) => ((x + 1) / 2) * width
  const py = (y: number) => ((1 - y) / 2) * height
  const scaleX = -1 + (2 * SCALE_INSET_PX) / width
  const marks = elevationMarks(lens, scaleX, height, MIN_MARK_GAP_PX).filter((mark) => py(mark.y) > clearTopPx)

  // Eye level is a straight line only when looking level, so it is drawn point by point: the
  // horizontal circle round the visitor, a little wider than the picture.
  const span = Math.min(acrossDeg(lens) * 1.3, 170)
  const eyeLevel = Array.from({ length: EYE_LEVEL_STEPS + 1 }, (_, i) => project(lens, lens.headingDeg + (i / EYE_LEVEL_STEPS - 0.5) * span, 0))
    .filter((point) => point.inFront)
    .map((point) => `${px(point.x).toFixed(1)},${py(point.y).toFixed(1)}`)

  // A dot for each hour of a body's path; every few hours where hourly dots would run together.
  // Which hours get one depends on the hour's own number, so they stay put as time moves.
  const dots = (path: HourDot[], kind: 'sun' | 'earth', body: Marked) => {
    const at = path.map((hour) => {
      const point = project(lens, hour.azDeg, hour.elDeg)
      return { x: px(point.x), y: py(point.y), inFront: point.inFront, up: hour.up }
    })
    const steps = at.slice(1).map((point, i) => Math.hypot(point.x - at[i].x, point.y - at[i].y)).sort((a, b) => a - b)
    const perHourPx = steps[Math.floor(steps.length / 2)] ?? 0
    const every = HOUR_STRIDES.find((stride) => stride * perHourPx >= MIN_DOT_GAP_PX) ?? 24
    const disk = diskOutline(lens, body.azDeg, body.elDeg, body.radiusDeg)
    const clearX = (disk.rx * width) / 2 + 5
    const clearY = (disk.ry * height) / 2 + 5
    return at.map((point, i) => {
      if ((hours.first + i) % every !== 0 || !point.inFront || point.x < 0 || point.x > width || point.y < 0 || point.y > height) return null
      // Not on top of the disk itself.
      if (((point.x - px(disk.x)) / clearX) ** 2 + ((point.y - py(disk.y)) / clearY) ** 2 < 1) return null
      return <circle key={i} className={`sf-hour ${kind}${point.up ? '' : ' hidden'}`} cx={point.x} cy={point.y} r={1.7} />
    })
  }

  const tag = (body: Marked, kind: 'sun' | 'earth', name: string) => {
    const outline = diskOutline(lens, body.azDeg, body.elDeg, body.radiusDeg)
    if (!outline.inFront || Math.abs(outline.x) > 1.1 || Math.abs(outline.y) > 1.1) return null
    const rx = (outline.rx * width) / 2
    const ry = (outline.ry * height) / 2
    const cx = px(outline.x)
    const cy = py(outline.y)
    // Above the disk; under it when that would run into the menus and compass.
    const above = cy - ry - 14 > clearTopPx + 18
    return (
      <g className={`sf-tag ${kind}${body.up ? '' : ' hidden'}`}>
        {!body.up && <ellipse cx={cx} cy={cy} rx={Math.max(rx, 3)} ry={Math.max(ry, 3)} />}
        <text x={cx} y={above ? cy - ry - 14 : cy + ry + 26} textAnchor="middle">
          {body.up ? name : `${name}, behind the land`}
        </text>
      </g>
    )
  }

  return (
    <svg className="sf-overlay" width={width} height={height} aria-hidden="true">
      {eyeLevel.length > 1 && <polyline className="sf-eye-level" points={eyeLevel.join(' ')} />}
      {marks.map((mark) => (
        <g key={mark.el} className={mark.el === 0 ? 'sf-scale zero' : 'sf-scale'}>
          <line x1={0} x2={mark.el === 0 ? 14 : 8} y1={py(mark.y)} y2={py(mark.y)} />
          <text x={mark.el === 0 ? 20 : 14} y={py(mark.y) + 4}>
            {markLabel(mark.el, mark.stepDeg)}
          </text>
        </g>
      ))}
      {dots(hours.earth, 'earth', earth)}
      {dots(hours.sun, 'sun', sun)}
      {tag(earth, 'earth', 'Earth')}
      {tag(sun, 'sun', 'Sun')}
    </svg>
  )
}
