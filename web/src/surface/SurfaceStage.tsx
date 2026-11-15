import { lazy, type ReactNode, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import { horizonAt } from '../lib/customModel'
import { levelPitch } from '../lib/surfacePitch'
import type { BodyRadii, Look } from '../lib/surfaceView'
import type { GroundTint } from '../three/SurfaceViewer'
import { StageActions } from './StageActions'
import { offCenterNow, type PaneControls, SurfacePane } from './SurfacePane'
import { useGlide } from './useGlide'
import type { Body } from './useLook'
import { hasTouchPointer, useMotionLook } from './useMotionLook'

interface Props {
  site: SiteInfo
  month: string
  horizon: HorizonPoint[]
  /** A tint for the land from what is known about the ground, or none. */
  groundTint?: GroundTint | null
  track: TrackPoint[]
  index: number
  /** The Sun's and Earth's angular radii for each hour of the track. */
  radii: BodyRadii[]
  obsHeightM: number
  /** The site and month menus, when the page shows them, and the answer in words: placed over the picture. */
  pickers: ReactNode
  answer: ReactNode
}

// The flat chart (and the charting library under it) is fetched only where the picture can't be drawn.
const HorizonPanorama = lazy(() => import('../components/HorizonPanorama').then((module) => ({ default: module.HorizonPanorama })))

/** How many times taller heights are drawn when the visitor asks for the stretch. */
export const STRETCH_BY = 5
/** The path dots cover the day before the hour on screen and the two days after. */
const HOURS_BEFORE = 24
const HOURS_AFTER = 48
/** The two views, in the order they sit: side by side, or one above the other on a phone. */
const VIEWS: Body[] = ['sun', 'earth']

/**
 * The view from the site: always two views, one that keeps the Sun in the middle and one that keeps
 * Earth there, each steered by itself. The site, month and hour come from above.
 */
export function SurfaceStage({ site, month, horizon, groundTint = null, track, index, radii, obsHeightM, pickers, answer }: Props) {
  const [flat, setFlat] = useState(false)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const offerMotion = useMemo(() => hasTouchPointer(), [])

  const now = track[Math.min(index, track.length - 1)]
  const discs = radii[Math.min(index, radii.length - 1)]
  const sky = useGlide({ sunAz: now.sun_az, sunEl: now.sun_el, earthAz: now.earth_az, earthEl: now.earth_el }, `${site.id}@${month}`, still)
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

  // Zoom and stretch go to both views, so they stay at one scale. The arrow keys and the phone's
  // sensor steer one: the view last touched, the Sun's to begin with.
  const panes = useRef(new Map<Body, PaneControls>())
  const register = useCallback((body: Body, controls: PaneControls | null) => {
    if (controls) panes.current.set(body, controls)
    else panes.current.delete(body)
  }, [])
  const setLensAll = useCallback((change: (look: Look) => Look) => panes.current.forEach((pane) => pane.setLens(change)), [])
  const [touched, setTouched] = useState<Body>('sun')
  const touchedNow = useRef(touched)
  const onActive = useCallback((body: Body) => {
    touchedNow.current = body
    setTouched(body)
  }, [])
  const steerTouched = useCallback((change: (look: Look) => Look) => panes.current.get(touchedNow.current)?.steer(change), [])
  // The lens the views have, so one drawn again (after the graphics come back) starts at the same scale.
  const [lens, setLens] = useState<{ fovDeg: number; stretch: number } | null>(null)
  const onLens = useCallback((fovDeg: number, stretch: number) => setLens({ fovDeg, stretch }), [])
  // One pitch for both views while the Sun, Earth and the skyline under each fit in one picture:
  // eye level then sits at the same height left and right. Where they cannot, each keeps its own.
  const level = useMemo(
    () =>
      lens
        ? levelPitch(
            [
              { bodyElDeg: sky.sunEl, skylineElDeg: horizonAt(horizon, sky.sunAz) },
              { bodyElDeg: sky.earthEl, skylineElDeg: horizonAt(horizon, sky.earthAz) },
            ],
            lens,
            offCenterNow(),
          )
        : null,
    [lens, sky.sunEl, sky.sunAz, sky.earthEl, sky.earthAz, horizon],
  )
  const { status, start, stop } = useMotionLook(steerTouched, setLensAll)
  const toggleMotion = () => (status === 'on' || status === 'asking' ? stop() : void start())
  const onLost = useCallback(() => setFlat(true), [])

  if (flat) {
    return (
      <>
        <div className="sf-view sf-flat">
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
      <div className="sf-view split">
        {VIEWS.map((body, at) => (
          <SurfacePane
            key={body}
            body={body}
            place={at === 0 ? 0 : 1}
            site={site}
            horizon={horizon}
            groundTint={groundTint}
            now={now}
            sky={sky}
            discs={discs}
            hours={hours}
            still={still}
            level={level}
            opening={lens}
            keys={body === touched}
            showLens={at === VIEWS.length - 1}
            stretchBy={STRETCH_BY}
            setLensAll={setLensAll}
            register={register}
            onActive={onActive}
            onLens={onLens}
            onLost={onLost}
          />
        ))}
        {pickers}
      </div>
      {answer}
      <StageActions offerMotion={offerMotion} motion={status} onMotion={toggleMotion} radii={discs} obsHeightM={obsHeightM} />
    </>
  )
}
