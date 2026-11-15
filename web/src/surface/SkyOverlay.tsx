import type { MonthPaths, PathPoint } from '../lib/skyPaths'
import { acrossDeg, diskOutline, elevationMarks, type Lens, project, projector } from '../lib/surfaceView'
import { tagPlace } from '../lib/surfacePitch'
import { skyTagWords } from '../lib/surfaceWords'

export interface Marked {
  azDeg: number
  elDeg: number
  radiusDeg: number
  /** Its centre's height above the skyline in its direction (degrees); negative when under it. */
  aboveDeg: number
  /** The track's answer: is any part of it above the horizon? */
  up: boolean
}

interface Props {
  lens: Lens
  width: number
  height: number
  sun: Marked
  earth: Marked
  /** Each body's path over the whole month, from the track. */
  paths: MonthPaths
  /** The menus and compass cover this much of the top of the picture (px): no marks are drawn under them. */
  clearTopPx: number
  /** The answer's band covers this much of the foot of the picture (px). */
  clearBottomPx: number
}

/** The scale of elevations sits this far in from the left edge of the picture (px). */
const SCALE_INSET_PX = 14
const MIN_MARK_GAP_PX = 52
const EYE_LEVEL_STEPS = 24
/** The month's path is drawn out to this many picture-widths (and heights) from the middle, so it runs off the edges. */
const PATH_REACH = 1.5

/** "+2°", "−0.5°", and "eye level" for zero. */
function markLabel(el: number, stepDeg: number): string {
  if (el === 0) return 'eye level'
  const size = Math.abs(el).toFixed(stepDeg < 1 ? 1 : 0)
  return `${el > 0 ? '+' : '−'}${size}°`
}

/**
 * The lines and names drawn over the picture, placed with the same geometry the picture is drawn
 * with: a scale of true elevation down the left side, eye level, each body's path over the month
 * as a line, a name by each of them, and a dashed outline where one is behind the
 * land. The disks and the land themselves are in the canvas below.
 */
export function SkyOverlay({ lens, width, height, sun, earth, paths, clearTopPx, clearBottomPx }: Props) {
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

  // The month's path as a line, hour to hour: solid where the track has the body up, dashed where
  // it is behind the land. It breaks where the path goes behind the visitor or round the back of the
  // picture, and where it changes from up to hidden.
  const reachX = width * PATH_REACH
  const reachY = height * PATH_REACH
  const toScreen = projector(lens)
  const path = (points: PathPoint[], kind: 'sun' | 'earth') => {
    // Two outlines, one for the hours it is up and one for the hours it is hidden, each made of runs.
    const d = { up: '', hidden: '' }
    let open: 'up' | 'hidden' | null = null
    let last: { x: number; y: number } | null = null
    let lastAt = ''
    for (const hour of points) {
      const point = toScreen(hour.vector)
      const x = px(point.x)
      const y = py(point.y)
      const shown = point.inFront && Math.abs(x - width / 2) < reachX && Math.abs(y - height / 2) < reachY
      const jump = last !== null && Math.abs(x - last.x) + Math.abs(y - last.y) > width / 2
      if (!shown || jump) {
        open = null
        last = shown ? { x, y } : null
        if (!shown) continue
      }
      const at = `${x.toFixed(1)} ${y.toFixed(1)}`
      const state = hour.up ? 'up' : 'hidden'
      if (open !== state) {
        // A change from up to hidden starts the new run where the old one ended, so the line has no gap.
        d[state] += open ? `M${lastAt}L${at}` : `M${at}`
        open = state
      } else d[state] += `L${at}`
      last = { x, y }
      lastAt = at
    }
    return (
      <>
        {d.up && <path className={`sf-path ${kind}`} d={d.up} />}
        {d.hidden && <path className={`sf-path ${kind} hidden`} d={d.hidden} />}
      </>
    )
  }

  const tag = (body: Marked, kind: 'sun' | 'earth', name: string) => {
    const outline = diskOutline(lens, body.azDeg, body.elDeg, body.radiusDeg)
    // A body the view is turned to is named even when it is above or below the picture: at that edge.
    const faced = Math.abs(outline.x) < 0.35
    if (!outline.inFront || Math.abs(outline.x) > 1.1 || (Math.abs(outline.y) > 1.1 && !faced)) return null
    const rx = (outline.rx * width) / 2
    const ry = (outline.ry * height) / 2
    const cx = Math.min(Math.max(px(outline.x), 96), Math.max(width - 96, 96))
    const cy = py(outline.y)
    // Above the disk (name, then its two lines); under it when that would run into the menus and compass.
    // The skyline comes first: it decides whether the body is in view. Eye level is second.
    const { nameY, points } = tagPlace(cy, ry, height, clearTopPx, clearBottomPx)
    const anglesY = nameY + 17
    const arrow = points === 'down' ? '↓ ' : points === 'up' ? '↑ ' : ''
    const words = skyTagWords(body.aboveDeg, body.elDeg, body.radiusDeg, body.up)
    return (
      <g className={`sf-tag ${kind}${body.up ? '' : ' hidden'}`}>
        {!body.up && <ellipse cx={cx} cy={cy} rx={Math.max(rx, 3)} ry={Math.max(ry, 3)} />}
        <text x={cx} y={nameY} textAnchor="middle">
          {arrow}
          {body.up ? name : `${name}, behind the land`}
        </text>
        <text className="sf-tag-angles" x={cx} y={anglesY} textAnchor="middle">
          {words.skyline}
        </text>
        <text className="sf-tag-angles" x={cx} y={anglesY + 16} textAnchor="middle">
          {words.level}
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
      {path(paths.earth, 'earth')}
      {path(paths.sun, 'sun')}
      {tag(earth, 'earth', 'Earth')}
      {tag(sun, 'sun', 'Sun')}
    </svg>
  )
}
