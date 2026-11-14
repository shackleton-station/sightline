import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_ZOOM, MIN_ZOOM } from '../lib/globe'
import { latLonOf, project, screenUp, unitOf, unproject, type Vec3 } from '../lib/polarCamera'
import { dragPose, flightPose, leveled, type Pose, poseAt, turnBetween, turnPose, twistTo } from '../lib/trackball'

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
   * Leave the picture exactly as the visitor turned it: no easing back the usual way up after a
   * drag, a glide or an arrow key. Flights still arrive the usual way up. Off unless asked for.
   */
  keepTurn?: boolean
}

interface Camera extends Pose {
  zoom: number
}

const CLICK_SLOP_PX = 5
const WHEEL_RATE = 0.0015
const KEY_STEP = 0.12
/** A glide slows steadily: every GLIDE_MS its speed falls to about a third. */
const GLIDE_MS = 320
/** The farthest a glide may carry the view, in disk units at zoom 1 (the box is 2 across). */
const GLIDE_REACH = 0.5
/** Slower than this (radians per millisecond), a release is just a release. */
const GLIDE_MIN_SPEED = 0.00002
/** How long the picture takes to come back the right way up once it is let go. */
const LEVEL_MS = 600
/**
 * The fastest the picture may turn while it rights itself, in radians per millisecond (150° a second).
 * Far round a pole the usual way up can be half a turn from how the picture was left; at this pace
 * that reads as the map turning round, not as a jump.
 */
const LEVEL_MAX_RATE = (150 * Math.PI) / 180 / 1000

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * One camera for every globe on the site. Drag the ground and it follows the pointer, anywhere on
 * the Moon, the poles included; let go while moving and it glides to a stop; wheel or pinch zooms
 * toward where the pointer is; arrow keys and +/- work too; flights between places ease in and out.
 * After a drag the picture eases back the usual way up (see lib/trackball.ts for why it can tilt).
 */
export function useMoonCamera({ initialView, initialZoom = 1, surfaceRef, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM, maxZoomAt, onPick, keepTurn = false }: Options) {
  const [camera, setCameraState] = useState<Camera>(() => ({ ...poseAt(initialView.lat, initialView.lon), zoom: initialZoom }))
  // Pointer events can arrive several to a frame, so the newest camera is also kept outside React.
  const latest = useRef(camera)
  const setCamera = useCallback((next: Camera) => {
    latest.current = next
    setCameraState(next)
  }, [])
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

  // One animation at a time: a flight, a glide, or the picture righting itself.
  const motion = useRef<number | null>(null)
  const stopMotion = useCallback(() => {
    if (motion.current !== null) cancelAnimationFrame(motion.current)
    motion.current = null
  }, [])
  useEffect(() => stopMotion, [stopMotion])

  /** Ease the picture back the usual way up, without moving the view. */
  const level = useCallback(() => {
    stopMotion()
    if (reducedMotion()) {
      setCamera({ ...leveled(latest.current, 1), zoom: latest.current.zoom })
      return
    }
    let last: number | null = null
    const step = (time: number) => {
      const dt = last === null ? 16 : Math.min(time - last, 50)
      last = time
      const from = latest.current
      // Closing a fixed share of what is left each frame: quick at first, gentle at the end,
      // and never faster than LEVEL_MAX_RATE.
      const twist = Math.abs(twistTo(from, screenUp(from.center)))
      const share = Math.min(1 - Math.exp(-dt / (LEVEL_MS / 4)), twist > 0 ? (LEVEL_MAX_RATE * dt) / twist : 1)
      const next = leveled(from, share)
      setCamera({ ...next, zoom: from.zoom })
      const left = Math.abs(turnBetween(next.up, leveled(next, 1).up).angle)
      motion.current = left > 0.0005 ? requestAnimationFrame(step) : null
    }
    motion.current = requestAnimationFrame(step)
  }, [setCamera, stopMotion])

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

  /** The Moon point under a spot on the screen, for a given camera; null off the disk. */
  const pointAt = (clientX: number, clientY: number, at: Camera): Vec3 | null => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box) return null
    const x = (((clientX - box.left) / box.width) * 2 - 1) / at.zoom
    const y = (1 - ((clientY - box.top) / box.height) * 2) / at.zoom
    return unproject(x, y, at.center, at.up)
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
  /** The last turn a drag made and how long it took, for carrying on when the pointer lets go. */
  const spin = useRef<{ axis: Vec3; rate: number; at: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLCanvasElement)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    stopMotion()
    setTouched(true)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pinch.current = null
    spin.current = null
    if (pointers.current.size === 1) {
      moved.current = 0
      held.current = pointAt(event.clientX, event.clientY, latest.current)
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
      spin.current = null
      return
    }
    moved.current += Math.hypot(event.clientX - last.x, event.clientY - last.y)
    const from = latest.current
    const under = pointAt(event.clientX, event.clientY, from)
    if (!held.current || !under || moved.current <= CLICK_SLOP_PX) return
    const { axis, angle } = turnBetween(under, held.current)
    setCamera({ ...turnPose(from, axis, angle), zoom: from.zoom })
    // Remember how fast the globe is turning, smoothed over the last few moves.
    const elapsed = Math.max(event.timeStamp - (spin.current?.at ?? event.timeStamp - 16), 1)
    const rate = angle / elapsed
    spin.current = { axis, rate: spin.current && elapsed < 80 ? spin.current.rate * 0.5 + rate * 0.5 : rate, at: event.timeStamp }
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const wasClick = pointers.current.size === 1 && moved.current <= CLICK_SLOP_PX
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const point = wasClick ? pointAt(event.clientX, event.clientY, latest.current) : null
    held.current = null
    if (point) {
      const { lat, lon } = latLonOf(point)
      options.current.onPick?.(lat, lon)
      return
    }
    if (pointers.current.size > 0) return
    // Let go while moving: carry on the same way and slow to a stop, then come back the right way up.
    const going = spin.current
    spin.current = null
    if (!going || event.timeStamp - going.at > 80 || going.rate < GLIDE_MIN_SPEED || reducedMotion()) {
      if (!options.current.keepTurn) level()
      return
    }
    // However hard the flick, the glide carries the picture a quarter of the box at most, at any zoom.
    let rate = Math.min(going.rate, GLIDE_REACH / (latest.current.zoom * GLIDE_MS))
    let last: number | null = null
    const step = (time: number) => {
      const dt = last === null ? 16 : Math.min(time - last, 50)
      last = time
      rate *= Math.exp(-dt / GLIDE_MS)
      const from = latest.current
      setCamera({ ...turnPose(from, going.axis, rate * dt), zoom: from.zoom })
      if (rate > GLIDE_MIN_SPEED / 2) motion.current = requestAnimationFrame(step)
      else if (options.current.keepTurn) motion.current = null
      else level()
    }
    stopMotion()
    motion.current = requestAnimationFrame(step)
  }

  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId)
    pinch.current = null
    held.current = null
    spin.current = null
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
