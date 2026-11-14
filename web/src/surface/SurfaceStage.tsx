import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import type { BodyRadii, Look } from '../lib/surfaceView'
import type { GroundTint } from '../three/SurfaceViewer'
import type { Facing } from './address'
import { StageActions } from './StageActions'
import { type PaneControls, SurfacePane } from './SurfacePane'
import { useGlide } from './useGlide'
import type { Aim, Body } from './useLook'
import { hasTouchPointer, useMotionLook } from './useMotionLook'

/** What the address is told about the views: a free look's direction, or which following views are up. */
export interface Faced {
  look: Look | null
  face: Facing
}

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
  aim: Aim
  /** Told what the views show once they stop moving, for the address. */
  onFaced: (faced: Faced) => void
  /** The site and month menus, and the answer in words: placed over the picture. */
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

/** The views up: one for the Sun, one for Earth, both side by side, or a free look a link asked for. */
type Views = Facing | 'free'
const viewsFor = (aim: Aim, otherwise: Views): Views => (aim.look ? 'free' : (aim.face ?? otherwise))

/**
 * The view from the site. It opens as two views side by side, one that keeps the Sun in the middle
 * and one that keeps Earth there; "Face the Sun" and "Face Earth" close and open them. A link that
 * says which way to look opens one free view instead. The site, month and hour come from above.
 */
export function SurfaceStage({ site, month, horizon, groundTint = null, track, index, radii, obsHeightM, aim, onFaced, pickers, answer }: Props) {
  const [flat, setFlat] = useState(false)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const offerMotion = useMemo(() => hasTouchPointer(), [])
  const [views, setViews] = useState<Views>(() => viewsFor(aim, 'both'))
  // A link followed in the open tab: its free look, or the views it names; one that says neither changes nothing.
  const [aimSeen, setAimSeen] = useState(aim.id)
  if (aimSeen !== aim.id) {
    setAimSeen(aim.id)
    setViews(viewsFor(aim, views))
  }

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

  // The views up, by name. Zoom and stretch go to all of them; the phone's sensor steers the one there is.
  const panes = useRef(new Map<string, PaneControls>())
  const register = useCallback((key: string, controls: PaneControls | null) => {
    if (controls) panes.current.set(key, controls)
    else panes.current.delete(key)
  }, [])
  const setLensAll = useCallback((change: (look: Look) => Look) => panes.current.forEach((pane) => pane.setLens(change)), [])
  const steerFirst = useCallback((change: (look: Look) => Look) => {
    const [first] = panes.current.values()
    first?.steer(change)
  }, [])
  // The lens the views have, so one opened beside another starts at the same scale.
  const [lens, setLens] = useState<{ fovDeg: number; stretch: number } | null>(null)
  const onLens = useCallback((fovDeg: number, stretch: number) => setLens({ fovDeg, stretch }), [])
  // With two views up the arrow keys steer the one last touched.
  const [touched, setTouched] = useState<string>('sun')
  const { status, start, stop } = useMotionLook(steerFirst, setLensAll)
  const toggleMotion = () => (status === 'on' || status === 'asking' ? stop() : void start())

  const onLook = useCallback((look: Look) => onFaced({ look, face: 'both' }), [onFaced])
  useEffect(() => {
    if (views !== 'free') onFaced({ look: null, face: views })
  }, [views, onFaced])
  const onLost = useCallback(() => setFlat(true), [])

  // "Face the Sun" opens the Sun's view, or closes it when Earth's is up too. The last one stays, and turns back to its body.
  const toggle = (body: Body) => {
    const other: Body = body === 'sun' ? 'earth' : 'sun'
    if (views === 'both') setViews(other)
    else if (views === other) {
      stop()
      setViews('both')
    } else if (views === body) panes.current.get(body)?.face(body)
    else setViews(body)
  }

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

  const shown: (Body | null)[] = views === 'free' ? [null] : views === 'both' ? ['sun', 'earth'] : [views]
  const split = shown.length > 1
  const keyed = shown.some((body) => body === touched) ? touched : (shown[0] ?? 'free')
  return (
    <>
      <div className={split ? 'sf-view split' : 'sf-view'}>
        {shown.map((body, at) => (
          <SurfacePane
            key={body ?? 'free'}
            body={body}
            place={split ? (at === 0 ? 0 : 1) : null}
            site={site}
            horizon={horizon}
            groundTint={groundTint}
            now={now}
            sky={sky}
            discs={discs}
            hours={hours}
            aim={aim}
            still={still}
            opening={lens}
            keys={(body ?? 'free') === keyed}
            showLens={at === shown.length - 1}
            stretchBy={STRETCH_BY}
            setLensAll={setLensAll}
            register={register}
            onActive={setTouched}
            onLens={onLens}
            onLook={body ? undefined : onLook}
            onLost={onLost}
          />
        ))}
        {pickers}
      </div>
      {answer}
      <StageActions
        shown={{ sun: shown.includes('sun'), earth: shown.includes('earth') }}
        onFace={toggle}
        offerMotion={offerMotion && !split}
        motion={status}
        onMotion={toggleMotion}
        radii={discs}
        obsHeightM={obsHeightM}
      />
    </>
  )
}
