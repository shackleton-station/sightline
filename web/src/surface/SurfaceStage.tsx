import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import { horizonAt } from '../lib/customModel'
import { acrossDeg, type BodyRadii, type Lens, type Look } from '../lib/surfaceView'
import type { SurfaceFrame } from '../three/SurfaceViewer'
import { CompassStrip } from './CompassStrip'
import { LensControls } from './LensControls'
import { SkyOverlay } from './SkyOverlay'
import { StageActions } from './StageActions'
import { SurfaceCanvas } from './SurfaceCanvas'
import { useGlide } from './useGlide'
import { type Aim, useLook } from './useLook'
import { useLookInput } from './useLookInput'
import { hasTouchPointer, useMotionLook } from './useMotionLook'

interface Props {
  site: SiteInfo
  month: string
  horizon: HorizonPoint[]
  track: TrackPoint[]
  index: number
  /** The Sun's and Earth's angular radii for each hour of the track. */
  radii: BodyRadii[]
  obsHeightM: number
  aim: Aim
  /** Told which way the visitor faces once they stop moving, for the address. */
  onLook: (look: Look) => void
  /** The site and month menus, and the answer in words: placed over the picture. */
  pickers: ReactNode
  answer: ReactNode
}

// The flat chart (and the charting library under it) is fetched only where the picture can't be drawn.
const HorizonPanorama = lazy(() => import('../components/HorizonPanorama').then((module) => ({ default: module.HorizonPanorama })))

/** How many times taller heights are drawn when the visitor asks for the stretch. */
export const STRETCH_BY = 5
/** The opening field of view, bottom to top: the Sun is then a disk, not a dot, at true scale. */
const OPENING_FOV_WIDE_DEG = 12
const OPENING_FOV_TALL_DEG = 12
/** The path dots cover the day before the hour on screen and the two days after. */
const HOURS_BEFORE = 24
const HOURS_AFTER = 48
/** Where the layout changes (surface.css): the compass drops a row, then the phone layout; and a short, wide window. */
const MEDIUM_PX = 1100
const NARROW_PX = 700
const SHORT_PX = 520
const SETTLED_MS = 300

/**
 * The view from the site: the picture, the lines and names over it, the compass, the lens and the
 * buttons that turn it. Which way the visitor looks lives here; the site, month and hour come from above.
 */
export function SurfaceStage({ site, month, horizon, track, index, radii, obsHeightM, aim, onLook, pickers, answer }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [flat, setFlat] = useState(false)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const offerMotion = useMemo(() => hasTouchPointer(), [])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const now = track[Math.min(index, track.length - 1)]
  const discs = radii[Math.min(index, radii.length - 1)]
  const sky = useGlide({ sunAz: now.sun_az, sunEl: now.sun_el, earthAz: now.earth_az, earthEl: now.earth_el }, `${site.id}@${month}`, still)
  const openingFovDeg = window.innerWidth >= window.innerHeight ? OPENING_FOV_WIDE_DEG : OPENING_FOV_TALL_DEG
  // How much of the top of the picture the menus and compass cover, by layout (surface.css).
  const short = window.innerHeight < SHORT_PX
  const clearTopPx = size.width <= NARROW_PX ? 128 : size.width > MEDIUM_PX || short ? 64 : 150
  // Where they cover the top of a short picture (a phone, either way up), a faced body stays nearer its middle.
  const offCenter = window.innerWidth > NARROW_PX && !short ? 0.25 : 0.1
  const skylineAt = useCallback((azDeg: number) => horizonAt(horizon, azDeg), [horizon])
  const { look, following, steer, setLens, face } = useLook({ sky, up: { sun: now.sun_up, earth: now.earth_up }, aim, skylineAt, siteId: site.id, offCenter, openingFovDeg, still })
  const input = useLookInput({ stage, steer, setLens, enabled: !flat })
  const motion = useMotionLook(steer, setLens)

  // The address follows the look once it has stopped changing, not on every frame of a drag.
  const { headingDeg, pitchDeg, fovDeg, stretch } = look
  useEffect(() => {
    const timer = setTimeout(() => onLook({ headingDeg, pitchDeg, fovDeg, stretch }), SETTLED_MS)
    return () => clearTimeout(timer)
  }, [headingDeg, pitchDeg, fovDeg, stretch, onLook])

  const sun = useMemo(() => ({ azDeg: sky.sunAz, elDeg: sky.sunEl, radiusDeg: discs.sun, up: now.sun_up }), [sky.sunAz, sky.sunEl, discs.sun, now.sun_up])
  const earth = useMemo(() => ({ azDeg: sky.earthAz, elDeg: sky.earthEl, radiusDeg: discs.earth, up: now.earth_up }), [sky.earthAz, sky.earthEl, discs.earth, now.earth_up])
  const frame = useMemo<SurfaceFrame>(
    () => ({ look: { headingDeg, pitchDeg, fovDeg, stretch }, sun: { ...sun, share: now.sun_frac }, earth }),
    [headingDeg, pitchDeg, fovDeg, stretch, sun, earth, now.sun_frac],
  )
  // The hours either side of this one, as dots along each body's path.
  const hours = useMemo(() => {
    const from = Math.max(index - HOURS_BEFORE, 0)
    const near = track.slice(from, index + HOURS_AFTER + 1)
    return {
      first: from,
      sun: near.map((point) => ({ azDeg: point.sun_az, elDeg: point.sun_el, up: point.sun_up })),
      earth: near.map((point) => ({ azDeg: point.earth_az, elDeg: point.earth_el, up: point.earth_up })),
    }
  }, [track, index])
  const lens: Lens = { ...look, aspect: size.width / Math.max(size.height, 1) }
  const onLost = useCallback(() => setFlat(true), [])
  const { status, start, stop } = motion
  const toggleMotion = () => (status === 'on' || status === 'asking' ? stop() : void start())
  const sees =
    `The view from ${site.name}, facing ${Math.round(headingDeg)}°. ` +
    `The Sun is ${now.sun_up ? 'up' : 'behind the land'} at azimuth ${now.sun_az}°; Earth is ${now.earth_up ? 'in view' : 'behind the land'} at azimuth ${now.earth_az}°. ` +
    'Drag or use the arrow keys to look around.'

  if (flat) {
    return (
      <>
        <div className="sf-view sf-flat" ref={stage}>
          {pickers}
          <p>This browser can’t draw the view from the ground, so here is the same horizon unrolled flat: every direction at once, north at both ends.</p>
          <Suspense fallback={<p role="status">Loading the flat horizon…</p>}>
            <HorizonPanorama horizon={horizon} track={track} index={index} />
          </Suspense>
        </div>
        {answer}
      </>
    )
  }

  return (
    <>
      <div className="sf-view">
        <div className="sf-stage" ref={stage} role="img" aria-label={sees} {...input}>
          {size.width > 0 && (
            <>
              <SurfaceCanvas horizon={horizon} latDeg={site.lat} frame={frame} onLost={onLost} />
              <SkyOverlay lens={lens} width={size.width} height={size.height} sun={sun} earth={earth} hours={hours} clearTopPx={clearTopPx} />
            </>
          )}
        </div>
        {pickers}
        <CompassStrip headingDeg={headingDeg} acrossDeg={acrossDeg(lens)} sun={sun} earth={earth} />
        <LensControls look={look} acrossDeg={acrossDeg(lens)} stretchBy={STRETCH_BY} setLens={setLens} />
        {stretch > 1 && (
          <p className="sf-stretched" role="status">
            Heights drawn {stretch} times taller
            <button type="button" onClick={() => setLens((current) => ({ ...current, stretch: 1 }))}>
              Show true scale
            </button>
          </p>
        )}
      </div>
      {answer}
      <StageActions following={following} onFace={face} offerMotion={offerMotion} motion={status} onMotion={toggleMotion} radii={discs} obsHeightM={obsHeightM} />
    </>
  )
}
