import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef } from 'react'
import { dragLook, type Look } from '../lib/surfaceView'

interface Options {
  /** The element the picture fills: drags and the wheel on it move the view. */
  stage: RefObject<HTMLElement | null>
  steer: (change: (look: Look) => Look) => void
  setLens: (change: (look: Look) => Look) => void
  /** False when there is no picture to steer (no graphics): the keys and wheel are left alone. */
  enabled: boolean
  /** False for a view the keys don't steer: with two views side by side, they steer one. */
  keys?: boolean
}

/** Each press of an arrow key turns this share of the picture's height. */
const KEY_STEP = 0.12
const ZOOM_STEP = 1.25
const WHEEL_RATE = 0.0016

const typing = (target: EventTarget | null) => target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)

/**
 * Looking around by hand: drag with a mouse or a finger, pinch or turn the wheel to zoom, and the
 * arrow keys (with + and - to zoom) from anywhere on the page that isn't a slider or a menu.
 */
export function useLookInput({ stage, steer, setLens, enabled, keys = true }: Options) {
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const height = () => stage.current?.clientHeight ?? 1

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const before = spread()
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 1) {
      const dx = event.clientX - last.x
      const dy = event.clientY - last.y
      if (dx !== 0 || dy !== 0) steer((look) => dragLook(look, dx, dy, height()))
    } else if (before > 0) {
      // Two fingers: spreading them apart narrows the field of view by the same ratio.
      const after = spread()
      if (after > 0) setLens((look) => ({ ...look, fovDeg: (look.fovDeg * before) / after }))
    }
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId)
  }

  // The wheel must be allowed to stop the page from scrolling, which React's own listener can't.
  useEffect(() => {
    const element = stage.current
    if (!element || !enabled) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setLens((look) => ({ ...look, fovDeg: look.fovDeg * Math.exp(event.deltaY * WHEEL_RATE) }))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [stage, setLens, enabled])

  useEffect(() => {
    if (!enabled || !keys) return
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const px = KEY_STEP * (stage.current?.clientHeight ?? 1)
      const turn: Record<string, [number, number]> = { ArrowLeft: [px, 0], ArrowRight: [-px, 0], ArrowUp: [0, px], ArrowDown: [0, -px] }
      const move = turn[event.key]
      if (move) {
        event.preventDefault()
        steer((look) => dragLook(look, move[0], move[1], stage.current?.clientHeight ?? 1))
      } else if (event.key === '+' || event.key === '=') {
        setLens((look) => ({ ...look, fovDeg: look.fovDeg / ZOOM_STEP }))
      } else if (event.key === '-' || event.key === '_') {
        setLens((look) => ({ ...look, fovDeg: look.fovDeg * ZOOM_STEP }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, steer, setLens, enabled, keys])

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }
}
