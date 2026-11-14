import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_ZOOM, MIN_ZOOM } from '../lib/globe'
import { latLonOf, project, unitOf, unproject, type Vec3 } from '../lib/polarCamera'
import { dragLevel, dragPose, flightPose, leveled, type Pose, poseAt, softPoint, turnBetween, turnPose } from '../lib/trackball'

interface Options {
  /** Where the view starts, in degrees. */
  initialView: { lat: number; lon: number }
  initialZoom?: number
  /** The element the globe is drawn on: a square, with the Moon's disk filling it at zoom 1. */
  surfaceRef: RefObject<HTMLElement | null>
  /** How far out and in the zoom may go; 1 fits the whole Moon in the box. */
  minZoom?: number
  maxZoom?: number
  /**
   * How far in the view may go when `center` is in the middle of it, where that depends on the place
   * (the Atlas has finer ground near the south pole). Used instead of `maxZoom` when given.
   */
  maxZoomAt?: (center: Vec3) => number
  /** Called with the Moon point under a click (not a drag). */
  onPick?: (lat: number, lon: number) => void
  /**
   * Leave the picture exactly as the visitor turned it: no turning toward the usual way up during a
   * drag or after an arrow key. Flights still arrive the usual way up. Off unless asked for.
   */
  keepTurn?: boolean
}

interface Camera extends Pose {
  zoom: number
}

const CLICK_SLOP_PX = 5
const WHEEL_RATE = 0.0015
const KEY_STEP = 0.12
/**
 * While a drag moves the ground by some angle, the picture may turn toward the usual way up by up to
 * this many times that angle. Fast enough to keep up through the turn near a pole (72° to 82°), and
 * since it is paced by the drag, the picture stops turning the moment the pointer stops.
 */
const LEVEL_PACE = 3

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * One camera for every globe on the site. Drag the ground and it follows the pointer, anywhere on
 * the Moon, the poles included, and stops where the pointer lets go: no glide, no turning afterwards.
 * While it is dragged the picture turns toward the usual way up (north, or the polar map's way up
 * near a pole) at a pace set by the drag (lib/trackball.ts, dragLevel). Wheel or pinch zooms toward
 * where the pointer is; arrow keys and +/- work too; flights between places ease in and out.
 */
export function useMoonCamera({ initialView, initialZoom = 1, surfaceRef, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM, maxZoomAt, onPick, keepTurn = false }: Options) {
  const [camera, setCameraState] = useState<Camera>(() => ({ ...poseAt(initialView.lat, initialView.lon), zoom: initialZoom }))
  // Pointer events can arrive several to a frame, so the newest camera is also kept outside React.
  const latest = useRef(camera)
  const drawSoon = useRef<number | null>(null)
  const setCamera = useCallback((next: Camera) => {
    latest.current = next
    if (drawSoon.current !== null) cancelAnimationFrame(drawSoon.current)
    drawSoon.current = null
    setCameraState(next)
  }, [])
  /** For a drag: the camera follows every move, but the page redraws once a frame with the newest one. */
  const setCameraSoon = useCallback((next: Camera) => {
    latest.current = next
    drawSoon.current ??= requestAnimationFrame(() => {
      drawSoon.current = null
      setCameraState(latest.current)
    })
  }, [])
  useEffect(
    () => () => {
      if (drawSoon.current !== null) cancelAnimationFrame(drawSoon.current)
    },
    [],
  )
  const options = useRef({ minZoom, maxZoom, maxZoomAt, onPick, keepTurn })
  useEffect(() => {
    options.current = { minZoom, maxZoom, maxZoomAt, onPick, keepTurn }
  })
  /** The zoom kept inside its limits for a view whose middle is `center`. */
  const clampZoom = useCallback((zoom: number, center: Vec3) => {
    const { minZoom: low, maxZoom: high, maxZoomAt: highAt } = options.current
    return Math.max(low, Math.min(highAt ? highAt(center) : high, zoom))
  }, [])
  const [touched, setTouched] = useState(false)

  // One animation at a time: a flight or a zoom step. A drag never leaves one running.
  const motion = useRef<number | null>(null)
  const stopMotion = useCallback(() => {
    if (motion.current !== null) cancelAnimationFrame(motion.current)
    motion.current = null
  }, [])
  useEffect(() => stopMotion, [stopMotion])

  /** Glide to a place and zoom, easing in and out; resolves when it arrives. */
  const flyTo = useCallback(
    (goal: { lat: number; lon: number }, goalZoom?: number, ms = 900) => {
      stopMotion()
      const from = latest.current
      const to = unitOf(goal.lat, goal.lon)
      const logFrom = Math.log(from.zoom)
      const logTo = Math.log(clampZoom(goalZoom ?? from.zoom, to))
      const still = reducedMotion()
      return new Promise<void>((resolve) => {
        let start: number | null = null
        const step = (time: number) => {
          start ??= time
          const t = still ? 1 : Math.min((time - start) / ms, 1)
          const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
          setCamera({ ...flightPose(from, to, eased), zoom: Math.exp(logFrom + (logTo - logFrom) * eased) })
          if (t < 1) motion.current = requestAnimationFrame(step)
          else {
            motion.current = null
            resolve()
          }
        }
        motion.current = requestAnimationFrame(step)
      })
    },
    [setCamera, stopMotion, clampZoom],
  )

  /** A spot on the screen in disk units at zoom 1 (x right, y up, the disk -1 to 1) for a given zoom. */
  const diskAt = (clientX: number, clientY: number, zoom: number): { x: number; y: number } | null => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box) return null
    return { x: (((clientX - box.left) / box.width) * 2 - 1) / zoom, y: (1 - ((clientY - box.top) / box.height) * 2) / zoom }
  }

  /** The Moon point under a spot on the screen, for a given camera; null off the disk. */
  const pointAt = (clientX: number, clientY: number, at: Camera): Vec3 | null => {
    const spot = diskAt(clientX, clientY, at.zoom)
    return spot ? unproject(spot.x, spot.y, at.center, at.up) : null
  }

  /** The direction a drag holds at a spot: the ground itself, softened near the rim and beyond it. */
  const gripAt = (clientX: number, clientY: number, at: Camera): Vec3 | null => {
    const spot = diskAt(clientX, clientY, at.zoom)
    return spot ? softPoint(spot.x, spot.y, at.center, at.up) : null
  }

  /** Change the zoom, keeping the ground under (clientX, clientY) where it is. */
  const zoomAbout = (factor: number, clientX: number, clientY: number) => {
    const from = latest.current
    const zoom = clampZoom(from.zoom * factor, from.center)
    const before = pointAt(clientX, clientY, from)
    const after = pointAt(clientX, clientY, { ...from, zoom })
    setCamera({ ...(before && after ? dragPose(from, before, after) : from), zoom })
  }

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const element = surfaceRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      stopMotion()
      setTouched(true)
      zoomAbout(Math.exp(-event.deltaY * WHEEL_RATE), event.clientX, event.clientY)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
    // zoomAbout reads only refs, so the listener never needs replacing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceRef, stopMotion])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const held = useRef<Vec3 | null>(null)
  const moved = useRef(0)
  const pinch = useRef<number | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLCanvasElement)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    stopMotion()
    setTouched(true)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pinch.current = null
    if (pointers.current.size === 1) {
      moved.current = 0
      held.current = gripAt(event.clientX, event.clientY, latest.current)
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.current) zoomAbout(distance / pinch.current, (a.x + b.x) / 2, (a.y + b.y) / 2)
      pinch.current = distance
      moved.current = Infinity
      held.current = null
      return
    }
    moved.current += Math.hypot(event.clientX - last.x, event.clientY - last.y)
    const from = latest.current
    const spot = diskAt(event.clientX, event.clientY, from.zoom)
    if (!held.current || !spot || moved.current <= CLICK_SLOP_PX) return
    // How far this move turns the ground sets how far the picture may turn toward the usual way up.
    const { angle } = turnBetween(softPoint(spot.x, spot.y, from.center, from.up), held.current)
    const twist = options.current.keepTurn ? 0 : LEVEL_PACE * angle
    setCameraSoon({ ...dragLevel(from, held.current, spot.x, spot.y, twist), zoom: from.zoom })
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const wasClick = pointers.current.size === 1 && moved.current <= CLICK_SLOP_PX
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const point = wasClick ? pointAt(event.clientX, event.clientY, latest.current) : null
    held.current = null
    // Letting go ends the drag where it is: the last move is drawn now, and nothing carries on.
    setCamera(latest.current)
    if (point) {
      const { lat, lon } = latLonOf(point)
      options.current.onPick?.(lat, lon)
    }
  }

  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId)
    pinch.current = null
    held.current = null
    setCamera(latest.current)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    }
    const step = steps[event.key]
    const factor = event.key === '+' || event.key === '=' ? 1.25 : event.key === '-' ? 0.8 : null
    if (!step && !factor) return
    event.preventDefault()
    stopMotion()
    setTouched(true)
    const from = latest.current
    if (step) {
      // The arrow says which way the view moves: right shows the ground to the right.
      const next = unproject(step[0] / from.zoom, step[1] / from.zoom, from.center, from.up)
      if (next) {
        const { axis, angle } = turnBetween(from.center, next)
        const turned = turnPose(from, axis, angle)
        setCamera({ ...(options.current.keepTurn ? turned : leveled(turned, 1)), zoom: clampZoom(from.zoom, next) })
      }
    }
    if (factor) setCamera({ ...from, zoom: clampZoom(from.zoom * factor, from.center) })
  }

  const view = useMemo(() => latLonOf(camera.center), [camera.center])
  const { center, up } = camera
  return {
    /** The latitude and longitude in the middle of the view, in degrees. */
    view,
    center,
    up,
    zoom: camera.zoom,
    touched,
    /** Where a place lands on the disk at zoom 1 (x right, y up, -1 to 1), and whether it faces the viewer. */
    place: useCallback((lat: number, lon: number) => project(unitOf(lat, lon), center, up), [center, up]),
    /** Points the camera somewhere, but only until the first touch: after that, the visitor drives. */
    aim: useCallback(
      (next: { lat: number; lon: number }) => {
        if (!touched) setCamera({ ...poseAt(next.lat, next.lon), zoom: latest.current.zoom })
      },
      [touched, setCamera],
    ),
    setZoom: (zoom: number) => {
      stopMotion()
      setTouched(true)
      setCamera({ ...latest.current, zoom: clampZoom(zoom, latest.current.center) })
    },
    /** The same, eased over `ms` without moving the view: a step of the plus and minus buttons glides instead of jumping. */
    zoomTo: (zoom: number, ms = 220) => {
      stopMotion()
      setTouched(true)
      const logFrom = Math.log(latest.current.zoom)
      const logTo = Math.log(clampZoom(zoom, latest.current.center))
      if (reducedMotion()) {
        setCamera({ ...latest.current, zoom: Math.exp(logTo) })
        return
      }
      let start: number | null = null
      const step = (time: number) => {
        start ??= time
        const t = Math.min((time - start) / ms, 1)
        // Quick at first, settling at the end.
        const eased = 1 - (1 - t) ** 3
        setCamera({ ...latest.current, zoom: Math.exp(logFrom + (logTo - logFrom) * eased) })
        motion.current = t < 1 ? requestAnimationFrame(step) : null
      }
      motion.current = requestAnimationFrame(step)
    },
    flyTo,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown },
  }
}
