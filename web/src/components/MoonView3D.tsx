import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { loadDrawingTerrain } from '../data/customSite'
import { fromAzEl, orbitPose, standPose, toScreen, type Vec3 } from '../lib/camera3d'
import { toLocalDirection } from '../lib/moon3d'
import type { CameraCue } from '../lib/story'
import { buildSiteLevels, type MeshLevel } from '../lib/terrainMesh'
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, skyDiskRadiusPx, TerrainViewer } from '../three/TerrainViewer'
import { Moon3DOverlay, type ScreenPoints } from './Moon3DOverlay'

interface Props {
  site: { name: string; lat: number; lon: number }
  now: TrackPoint
  obsHeightM: number
  /** Where a guided tour wants the camera. People can still drag it from there. */
  camera?: CameraCue
  /** When standing, look up no further than leaves the ground in the picture, however high the body is. */
  groundInView?: boolean
  onReadyChange?: (ready: boolean) => void
  /** Start again on a new canvas, for when the browser won't give the old one back. */
  onRestart: () => void
}

type CameraMode = CameraCue

const CAMERAS: { mode: CameraMode; label: string }[] = [
  { mode: 'above', label: 'From above' },
  { mode: 'sun', label: 'Stand here, face the Sun' },
  { mode: 'earth', label: 'Stand here, face Earth' },
]

const SMALL_SCREEN_PX = 700
const LEVELS: MeshLevel[] = [
  { halfM: 8_000, stepM: 20 },
  { halfM: 40_000, stepM: 100 },
  { halfM: 250_000, stepM: 1_000 },
]
const LEVELS_SMALL: MeshLevel[] = [
  { halfM: 4_000, stepM: 40 },
  { halfM: 30_000, stepM: 200 },
  { halfM: 200_000, stepM: 2_000 },
]
const RAY_LENGTH_M = 15_000
const SKY_DISTANCE_M = 1_000_000
const START_RANGE_M = 30_000
const START_PITCH_DEG = 30
const MIN_RANGE_M = 500
const MAX_RANGE_M = 300_000
const ARROW_STEP_DEG = 5
const ZOOM_STEP = 1.3
const LOOK_SIDE_ON_DEG = 40
/** With `groundInView`, a standing view looks up at most this far: the ground keeps the bottom fifth of the picture. */
const GROUND_IN_VIEW_MAX_DEG = 15

interface View {
  headingDeg: number
  pitchDeg: number
  rangeM: number
}

const NO_POINTS: ScreenPoints = { site: null, sun: null, earth: null }

/**
 * Our own view of the Moon in Three.js: LOLA terrain lit and shadowed by the pipeline's Sun, with the Sun
 * and Earth drawn where the ephemeris puts them. Loaded only when opened.
 */
export default function MoonView3D({ site, now, obsHeightM, camera, groundInView = false, onReadyChange, onRestart }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<TerrainViewer | null>(null)
  const sunAz = useRef(now.sun_az)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [lost, setLost] = useState(false)
  const [resizes, setResizes] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<CameraMode>('above')
  const [view, setView] = useState<View>({
    headingDeg: now.sun_az + LOOK_SIDE_ON_DEG,
    pitchDeg: START_PITCH_DEG,
    rangeM: START_RANGE_M,
  })
  const [points, setPoints] = useState<ScreenPoints>(NO_POINTS)

  useEffect(() => {
    sunAz.current = now.sun_az
  }, [now.sun_az])

  useEffect(() => {
    if (!canvas.current) return
    try {
      const created = new TerrainViewer({
        canvas: canvas.current,
        small: window.innerWidth < SMALL_SCREEN_PX,
        onLostChange: setLost,
      })
      renderer.current = created
      const watcher = new ResizeObserver(() => setResizes((count) => count + 1))
      watcher.observe(canvas.current)
      return () => {
        watcher.disconnect()
        created.dispose()
        renderer.current = null
      }
    } catch {
      setError('This browser could not start the 3D view (it needs WebGL2).')
    }
  }, [])

  useEffect(() => {
    let stale = false
    setReady(false)
    const levels = window.innerWidth < SMALL_SCREEN_PX ? LEVELS_SMALL : LEVELS
    loadDrawingTerrain(site.lat, site.lon, levels[1].halfM)
      .then((terrain) => {
        if (stale || !renderer.current) return
        const built = buildSiteLevels(
          (lat, lon) => terrain.surfaceHeight(lat, lon),
          site.lat,
          site.lon,
          levels,
        )
        renderer.current.setTerrain(built.levels)
        setMode('above')
        setView({
          headingDeg: sunAz.current + LOOK_SIDE_ON_DEG,
          pitchDeg: START_PITCH_DEG,
          rangeM: START_RANGE_M,
        })
        setReady(true)
      })
      .catch(() => setError('The terrain for this site could not be loaded.'))
    return () => {
      stale = true
    }
  }, [site.lat, site.lon])

  useEffect(() => {
    const active = renderer.current
    if (!ready || !active || lost || !canvas.current) return
    // A canvas with no size (mid-layout, or a hidden tab) has no view to draw; its math would be NaN.
    if (canvas.current.clientWidth === 0 || canvas.current.clientHeight === 0) return
    const toSun = toLocalDirection(now.sun_vec_me, site.lat, site.lon)
    const above = mode === 'above'
    const pose = above
      ? orbitPose(view.headingDeg, view.pitchDeg, view.rangeM)
      : standPose(view.headingDeg, -view.pitchDeg, obsHeightM)
    const toEarth = fromAzEl(now.earth_az, now.earth_el)
    active.draw({
      pose,
      toSun,
      toEarth,
      aboveGroundM: above ? Math.max(100, Math.hypot(...pose.eye)) : obsHeightM,
      fromAbove: above,
    })
    const { clientWidth: width, clientHeight: height } = canvas.current
    const inSky = (direction: Vec3, radiusDeg: number): ScreenPoints['sun'] => {
      const reach = above ? RAY_LENGTH_M : SKY_DISTANCE_M
      const point: Vec3 = [direction[0] * reach, direction[1] * reach, direction[2] * reach]
      const at = toScreen(active.viewProjection, point, width, height)
      return at && { ...at, r: skyDiskRadiusPx(radiusDeg, above, height) }
    }
    setPoints({
      site: above ? toScreen(active.viewProjection, [0, 0, 0], width, height) : null,
      sun: inSky(toSun, SUN_RADIUS_DEG),
      earth: inSky(toEarth, EARTH_RADIUS_DEG),
    })
  }, [ready, lost, resizes, view, mode, now, obsHeightM, site.lat, site.lon])

  const nowRef = useRef(now)
  useEffect(() => {
    nowRef.current = now
  }, [now])

  const aimAt = useCallback((next: CameraMode) => {
    const point = nowRef.current
    setMode(next)
    if (next === 'above') {
      setView({ headingDeg: point.sun_az + LOOK_SIDE_ON_DEG, pitchDeg: START_PITCH_DEG, rangeM: START_RANGE_M })
      return
    }
    const sun = next === 'sun'
    const elDeg = sun ? point.sun_el : point.earth_el
    setView({
      headingDeg: sun ? point.sun_az : point.earth_az,
      pitchDeg: -(groundInView ? Math.min(elDeg, GROUND_IN_VIEW_MAX_DEG) : elDeg),
      rangeM: START_RANGE_M,
    })
  }, [groundInView])

  useEffect(() => {
    // A view that can't draw shouldn't hold up a tour, which still has the numbers to show.
    onReadyChange?.((ready && !lost) || error !== null)
  }, [ready, lost, error, onReadyChange])

  // Terrain loading resets the camera, so a tour's choice applies again once a site is ready.
  useEffect(() => {
    if (ready && camera) aimAt(camera)
  }, [ready, camera, aimAt])

  /** `dLookUpDeg` is toward the sky when standing, and toward overhead when looking from above. */
  const turn = (dHeadingDeg: number, dLookUpDeg: number) => {
    const above = mode === 'above'
    setView((current) => ({
      ...current,
      headingDeg: (current.headingDeg + dHeadingDeg + 360) % 360,
      pitchDeg: Math.max(above ? 3 : -60, Math.min(89.5, current.pitchDeg + (above ? dLookUpDeg : -dLookUpDeg))),
    }))
  }

  const zoom = (factor: number) => {
    setView((current) => ({
      ...current,
      rangeM: Math.max(MIN_RANGE_M, Math.min(MAX_RANGE_M, current.rangeM * factor)),
    }))
  }

  if (error) return <p className="pending">{error}</p>

  return (
    <>
      <div className="camera-choices" role="group" aria-label="Camera">
        {CAMERAS.map((camera) => (
          <button key={camera.mode} type="button" aria-pressed={mode === camera.mode} onClick={() => aimAt(camera.mode)}>
            {camera.label}
          </button>
        ))}
      </div>
      <div className="moon-3d">
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label={`3D view of the terrain at ${site.name}. Drag or use the arrow keys to look around; plus and minus zoom.`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerMove={(event) => {
            if (!drag.current) return
            const scale = mode === 'above' ? 0.3 : 0.08
            const lookUp = (event.clientY - drag.current.y) * scale
            turn((drag.current.x - event.clientX) * scale, mode === 'above' ? lookUp : -lookUp)
            drag.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onWheel={(event) => {
            if (mode === 'above') zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15)
          }}
          onKeyDown={(event) => {
            const moves: Record<string, () => void> = {
              ArrowLeft: () => turn(-ARROW_STEP_DEG, 0),
              ArrowRight: () => turn(ARROW_STEP_DEG, 0),
              ArrowUp: () => turn(0, ARROW_STEP_DEG),
              ArrowDown: () => turn(0, -ARROW_STEP_DEG),
              '+': () => zoom(1 / ZOOM_STEP),
              '=': () => zoom(1 / ZOOM_STEP),
              '-': () => zoom(ZOOM_STEP),
            }
            const move = moves[event.key]
            if (!move) return
            event.preventDefault()
            move()
          }}
        />
        <Moon3DOverlay points={points} siteName={site.name} now={now} showRays={mode === 'above'} />
        {mode === 'above' && (
          <div className="moon-3d-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1 / ZOOM_STEP)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => zoom(ZOOM_STEP)}>−</button>
          </div>
        )}
        {!ready && <p className="moon-3d-status" role="status">Loading terrain…</p>}
        {lost && (
          <div className="moon-3d-status" role="alert">
            <p>Your device paused the 3D view, usually to save memory.</p>
            <button type="button" onClick={onRestart}>
              Restart the 3D view
            </button>
          </div>
        )}
      </div>
    </>
  )
}
