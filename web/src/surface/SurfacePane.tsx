import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import { horizonAt } from '../lib/customModel'
import type { LevelPitch } from '../lib/surfacePitch'
import { acrossDeg, type BodyRadii, fovForAcross, type Lens, type Look } from '../lib/surfaceView'
import type { GroundTint, SurfaceFrame } from '../three/SurfaceViewer'
import { CompassStrip } from './CompassStrip'
import { LensControls } from './LensControls'
import type { MonthPaths } from '../lib/skyPaths'
import { SkyOverlay } from './SkyOverlay'
import { SurfaceCanvas } from './SurfaceCanvas'
import { useCoveredFoot } from './useCoveredFoot'
import type { SkyPair } from './useDrawnHour'
import { type Body, useLook } from './useLook'
import { useLookInput } from './useLookInput'

/** What the stage may ask of a view: turn it by hand, change its lens, or turn it back to its body. */
export interface PaneControls {
  steer: (change: (look: Look) => Look) => void
  setLens: (change: (look: Look) => Look) => void
  face: (body: Body) => void
}

interface Props {
  /** The body this view follows. */
  body: Body
  /** Where it sits: 0 the first (under the menus), 1 the second. */
  place: 0 | 1
  site: SiteInfo
  horizon: HorizonPoint[]
  groundTint: GroundTint | null
  /** This hour of the track, and where the Sun and Earth are drawn (they move steadily between hours). */
  now: TrackPoint
  sky: SkyPair
  discs: BodyRadii
  /** Each body's path over the whole month. */
  paths: MonthPaths
  still: boolean
  /** The pitch both views share while both bodies fit in one picture. */
  level: LevelPitch | null
  /** The lens another view already has, so a view opened beside it matches. */
  opening: { fovDeg: number; stretch: number } | null
  /** Whether the arrow keys steer this view. */
  keys: boolean
  /** Whether this view carries the zoom control (one set, for every view up). */
  showLens: boolean
  /** Changes the lens of every view up, so they stay at one scale. */
  setLensAll: (change: (look: Look) => Look) => void
  register: (body: Body, controls: PaneControls | null) => void
  onActive: (body: Body) => void
  /** Told the lens whenever it changes. */
  onLens: (fovDeg: number, stretch: number) => void
  onLost: () => void
}

/** A fresh view opens this wide, left to right, whatever its shape. */
const OPENING_ACROSS_DEG = 30
/** The field of view, bottom to top, until the picture has been measured. */
const OPENING_FOV_DEG = 12
/** Where the layout changes (surface.css): the phone layout, and a short, wide window. */
const NARROW_PX = 700
const SHORT_PX = 520
const NAMES: Record<Body, string> = { sun: 'the Sun', earth: 'Earth' }

/** How far from the middle of the picture a faced body may sit, as a share of its height: less where the menus and compass cover the top of a short picture (a phone, or half of one). */
export const offCenterNow = () => (window.innerWidth > NARROW_PX && window.innerHeight >= SHORT_PX ? 0.2 : 0.1)

/** How much of the top of the picture the menus and compass cover (px), by layout (surface.css). */
function coveredTopPx(place: 0 | 1): number {
  const short = window.innerHeight < SHORT_PX
  if (window.innerWidth <= NARROW_PX) return place === 0 ? 100 : 52
  return short ? 52 : 150
}

/**
 * One of the two views from the site: the picture, the lines and names over it, and its compass.
 * It keeps its body, the Sun or Earth, in the middle as time moves, until the visitor steers it by
 * hand; a button then turns it back.
 */
export function SurfacePane(props: Props) {
  const { body, place, site, horizon, groundTint, now, sky, discs, paths, still, level, opening, keys, showLens, setLensAll, register, onActive, onLens, onLost } = props
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const coveredFootPx = useCoveredFoot(stage)

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const skylineAt = useCallback((azDeg: number) => horizonAt(horizon, azDeg), [horizon])
  const { look, following, steer, setLens, face } = useLook({
    sky,
    body,
    skylineAt,
    siteId: site.id,
    offCenter: offCenterNow(),
    openingFovDeg: opening?.fovDeg ?? OPENING_FOV_DEG,
    openingStretch: opening?.stretch ?? 1,
    still,
    level,
  })
  const input = useLookInput({ stage, steer, setLens: setLensAll, enabled: true, keys })

  useEffect(() => {
    register(body, { steer, setLens, face })
    return () => register(body, null)
  }, [register, body, steer, setLens, face])

  // The views open 30° wide, once their shape is known.
  const fresh = useRef(opening === null)
  useEffect(() => {
    if (!fresh.current || size.width === 0 || size.height === 0) return
    fresh.current = false
    const aspect = size.width / size.height
    setLens((current) => ({ ...current, fovDeg: fovForAcross(OPENING_ACROSS_DEG, aspect) }))
  }, [size, setLens])

  const { headingDeg, pitchDeg, fovDeg, stretch } = look
  useEffect(() => onLens(fovDeg, stretch), [onLens, fovDeg, stretch])

  const sun = useMemo(() => ({ azDeg: sky.sunAz, elDeg: sky.sunEl, radiusDeg: discs.sun, aboveDeg: sky.sunEl - skylineAt(sky.sunAz), up: now.sun_up }), [sky.sunAz, sky.sunEl, discs.sun, now.sun_up, skylineAt])
  const earth = useMemo(() => ({ azDeg: sky.earthAz, elDeg: sky.earthEl, radiusDeg: discs.earth, aboveDeg: sky.earthEl - skylineAt(sky.earthAz), up: now.earth_up }), [sky.earthAz, sky.earthEl, discs.earth, now.earth_up, skylineAt])
  const frame = useMemo<SurfaceFrame>(
    () => ({ look: { headingDeg, pitchDeg, fovDeg, stretch }, sun: { ...sun, share: now.sun_frac }, earth }),
    [headingDeg, pitchDeg, fovDeg, stretch, sun, earth, now.sun_frac],
  )
  const lens: Lens = { ...look, aspect: size.width / Math.max(size.height, 1) }
  const sees =
    `The view that follows ${NAMES[body]}, from ${site.name}, ` +
    `facing ${Math.round(headingDeg)}°. ` +
    `The Sun is ${now.sun_up ? 'up' : 'behind the land'} at azimuth ${now.sun_az}°; Earth is ${now.earth_up ? 'in view' : 'behind the land'} at azimuth ${now.earth_az}°. ` +
    'Drag or use the arrow keys to look around.'

  return (
    <div className={`sf-pane ${body}`}>
      <div className="sf-stage" ref={stage} role="img" aria-label={sees} {...input} onPointerDownCapture={() => onActive(body)}>
        {size.width > 0 && (
          <>
            <SurfaceCanvas horizon={horizon} groundTint={groundTint} latDeg={site.lat} frame={frame} onLost={onLost} />
            <SkyOverlay lens={lens} width={size.width} height={size.height} sun={sun} earth={earth} paths={paths} clearTopPx={coveredTopPx(place)} clearBottomPx={coveredFootPx} />
          </>
        )}
      </div>
      <CompassStrip headingDeg={headingDeg} acrossDeg={acrossDeg(lens)} sun={sun} earth={earth} follows={body} />
      {following !== body && (
        <button type="button" className={`sf-refollow ${body}`} onClick={() => face(body)}>
          Follow {NAMES[body]} again
        </button>
      )}
      {showLens && <LensControls look={look} acrossDeg={acrossDeg(lens)} setLens={setLensAll} />}
    </div>
  )
}
