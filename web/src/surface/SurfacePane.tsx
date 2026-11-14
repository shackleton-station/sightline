import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import { horizonAt } from '../lib/customModel'
import { acrossDeg, type BodyRadii, type Lens, type Look } from '../lib/surfaceView'
import type { GroundTint, SurfaceFrame } from '../three/SurfaceViewer'
import { CompassStrip } from './CompassStrip'
import { LensControls } from './LensControls'
import { type HourDot, SkyOverlay } from './SkyOverlay'
import { SurfaceCanvas } from './SurfaceCanvas'
import type { SkyPair } from './useGlide'
import { type Aim, type Body, useLook } from './useLook'
import { useLookInput } from './useLookInput'

/** What the stage may ask of a view: turn it by hand, change its lens, or turn it back to its body. */
export interface PaneControls {
  steer: (change: (look: Look) => Look) => void
  setLens: (change: (look: Look) => Look) => void
  face: (body: Body) => void
}

interface Props {
  /** The body this view follows; null for a free look, which follows a link or the visitor. */
  body: Body | null
  /** Where it sits when two views are up: 0 the first (under the menus), 1 the second. Null when alone. */
  place: 0 | 1 | null
  site: SiteInfo
  horizon: HorizonPoint[]
  groundTint: GroundTint | null
  /** This hour of the track, and where the Sun and Earth are drawn (they glide between hours). */
  now: TrackPoint
  sky: SkyPair
  discs: BodyRadii
  hours: { first: number; sun: HourDot[]; earth: HourDot[] }
  aim: Aim
  still: boolean
  /** The lens another view already has, so a view opened beside it matches. */
  opening: { fovDeg: number; stretch: number } | null
  /** Whether the arrow keys steer this view. */
  keys: boolean
  /** Whether this view carries the zoom and stretch controls (one set, for every view up). */
  showLens: boolean
  stretchBy: number
  /** Changes the lens of every view up, so they stay at one scale. */
  setLensAll: (change: (look: Look) => Look) => void
  register: (key: string, controls: PaneControls | null) => void
  onActive: (key: string) => void
  /** Told the lens whenever it changes. */
  onLens: (fovDeg: number, stretch: number) => void
  /** Told which way a free look faces once it stops moving, for the address. */
  onLook?: (look: Look) => void
  onLost: () => void
}

/** The opening field of view, bottom to top: the Sun is then a disk, not a dot, at true scale. */
const OPENING_FOV_DEG = 12
/** Where the layout changes (surface.css): the compass drops a row, then the phone layout; and a short, wide window. */
const MEDIUM_PX = 1100
const NARROW_PX = 700
const SHORT_PX = 520
const SETTLED_MS = 300
const NAMES: Record<Body, string> = { sun: 'the Sun', earth: 'Earth' }

/** How much of the top of the picture the menus and compass cover (px), by layout (surface.css). */
function coveredTopPx(place: 0 | 1 | null, widthPx: number): number {
  const short = window.innerHeight < SHORT_PX
  if (place === null) return widthPx <= NARROW_PX ? 128 : widthPx > MEDIUM_PX || short ? 64 : 150
  if (window.innerWidth <= NARROW_PX) return place === 0 ? 100 : 52
  return short ? 52 : 150
}

/**
 * One view from the site: the picture, the lines and names over it, and its compass. A view for the
 * Sun or Earth keeps that body in the middle as time moves, until the visitor steers it by hand;
 * a button then turns it back.
 */
export function SurfacePane(props: Props) {
  const { body, place, site, horizon, groundTint, now, sky, discs, hours, aim, still, opening, keys, showLens, stretchBy, setLensAll, register, onActive, onLens, onLook, onLost } = props
  const key = body ?? 'free'
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Where the menus and compass cover the top of a short picture (a phone, or half of one), a faced body stays nearer its middle.
  const roomy = window.innerWidth > NARROW_PX && window.innerHeight >= SHORT_PX
  const skylineAt = useCallback((azDeg: number) => horizonAt(horizon, azDeg), [horizon])
  // A view for one body doesn't take a link's free look: that opens a view of its own.
  const ownAim = useMemo<Aim>(() => (body ? { ...aim, look: null } : aim), [aim, body])
  const { look, following, steer, setLens, face } = useLook({
    sky,
    up: { sun: now.sun_up, earth: now.earth_up },
    aim: ownAim,
    skylineAt,
    siteId: site.id,
    offCenter: roomy ? (place === null ? 0.25 : 0.2) : 0.1,
    openingFovDeg: opening?.fovDeg ?? OPENING_FOV_DEG,
    openingStretch: opening?.stretch ?? 1,
    prefer: body,
    still,
  })
  const input = useLookInput({ stage, steer, setLens: setLensAll, enabled: true, keys })

  useEffect(() => {
    register(key, { steer, setLens, face })
    return () => register(key, null)
  }, [register, key, steer, setLens, face])

  const { headingDeg, pitchDeg, fovDeg, stretch } = look
  useEffect(() => onLens(fovDeg, stretch), [onLens, fovDeg, stretch])
  // The address follows the look once it has stopped changing, not on every frame of a drag.
  useEffect(() => {
    if (!onLook) return
    const timer = setTimeout(() => onLook({ headingDeg, pitchDeg, fovDeg, stretch }), SETTLED_MS)
    return () => clearTimeout(timer)
  }, [headingDeg, pitchDeg, fovDeg, stretch, onLook])

  const sun = useMemo(() => ({ azDeg: sky.sunAz, elDeg: sky.sunEl, radiusDeg: discs.sun, up: now.sun_up }), [sky.sunAz, sky.sunEl, discs.sun, now.sun_up])
  const earth = useMemo(() => ({ azDeg: sky.earthAz, elDeg: sky.earthEl, radiusDeg: discs.earth, up: now.earth_up }), [sky.earthAz, sky.earthEl, discs.earth, now.earth_up])
  const frame = useMemo<SurfaceFrame>(
    () => ({ look: { headingDeg, pitchDeg, fovDeg, stretch }, sun: { ...sun, share: now.sun_frac }, earth }),
    [headingDeg, pitchDeg, fovDeg, stretch, sun, earth, now.sun_frac],
  )
  const lens: Lens = { ...look, aspect: size.width / Math.max(size.height, 1) }
  const sees =
    (body ? `The view that follows ${NAMES[body]}, from ${site.name}, ` : `The view from ${site.name}, `) +
    `facing ${Math.round(headingDeg)}°. ` +
    `The Sun is ${now.sun_up ? 'up' : 'behind the land'} at azimuth ${now.sun_az}°; Earth is ${now.earth_up ? 'in view' : 'behind the land'} at azimuth ${now.earth_az}°. ` +
    'Drag or use the arrow keys to look around.'

  return (
    <div className={body ? `sf-pane ${body}` : 'sf-pane'}>
      <div className="sf-stage" ref={stage} role="img" aria-label={sees} {...input} onPointerDownCapture={() => onActive(key)}>
        {size.width > 0 && (
          <>
            <SurfaceCanvas horizon={horizon} groundTint={groundTint} latDeg={site.lat} frame={frame} onLost={onLost} />
            <SkyOverlay lens={lens} width={size.width} height={size.height} sun={sun} earth={earth} hours={hours} clearTopPx={coveredTopPx(place, size.width)} />
          </>
        )}
      </div>
      <CompassStrip headingDeg={headingDeg} acrossDeg={acrossDeg(lens)} sun={sun} earth={earth} follows={body} />
      {body && following !== body && (
        <button type="button" className={`sf-refollow ${body}`} onClick={() => face(body)}>
          Follow {NAMES[body]} again
        </button>
      )}
      {showLens && <LensControls look={look} acrossDeg={acrossDeg(lens)} stretchBy={stretchBy} setLens={setLensAll} />}
      {stretch > 1 && place !== 1 && (
        <p className="sf-stretched" role="status">
          Heights drawn {stretch} times taller
          <button type="button" onClick={() => setLensAll((current) => ({ ...current, stretch: 1 }))}>
            Show true scale
          </button>
        </p>
      )}
    </div>
  )
}
