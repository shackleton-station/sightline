import { useCallback, useEffect, useRef, useState } from 'react'
import { easeToward, hasAngles, type Pointing, pointingOf } from '../lib/motion'
import { type Look, trueEl } from '../lib/surfaceView'

/**
 * off: not in use. asking: waiting for the visitor's answer, or for the first reading.
 * on: the view follows the phone. refused: the visitor (or the browser) said no.
 * silent: allowed, but the device sends no readings. unavailable: this browser has no such sensor.
 */
export type MotionStatus = 'off' | 'asking' | 'on' | 'refused' | 'silent' | 'unavailable'

/** iOS Safari asks the visitor before a page may read the motion sensor; other browsers don't. */
type AskingEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

/** With no reading this long after starting, the device has no sensor to read (a laptop, a simulator). */
const SILENT_AFTER_MS = 1500
/** The field of view is at least this wide while the phone steers, so a small turn isn't a big jump. */
const MOTION_FOV_DEG = 34
/** How much of the way to each new reading the view moves: enough to take the shake out of a hand. */
const SMOOTHING = 0.35

/** True on a phone or tablet: a touch screen as the main pointer. Laptops don't get the button. */
export function hasTouchPointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

/**
 * Looking around by turning with the phone held up. Turning left or right is relative to where the
 * view faced when it started (the Moon's north isn't the room's north); tipping up and down is
 * absolute, so eye level in the picture is level in the room. Every way this can fail leaves the
 * page as it was, with dragging still working.
 */
export function useMotionLook(steer: (change: (look: Look) => Look) => void, setLens: (change: (look: Look) => Look) => void) {
  const [status, setStatus] = useState<MotionStatus>('off')
  const stopListening = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    stopListening.current?.()
    stopListening.current = null
    setStatus('off')
  }, [])
  useEffect(() => () => stopListening.current?.(), [])

  const listen = useCallback(() => {
    let smoothed: Pointing | null = null
    /** The view's heading minus the phone's, fixed at the first reading. */
    let offset = 0
    const onReading = (event: DeviceOrientationEvent) => {
      if (!hasAngles(event)) return
      const reading = pointingOf(event)
      const first = smoothed === null
      const at: Pointing = smoothed === null ? reading : easeToward(smoothed, reading, SMOOTHING)
      smoothed = at
      if (first) {
        clearTimeout(silence)
        setStatus('on')
        setLens((look) => ({ ...look, fovDeg: Math.max(look.fovDeg, MOTION_FOV_DEG) }))
      }
      steer((look) => {
        if (first) offset = look.headingDeg - at.headingDeg
        // The phone's tilt is an angle on the picture, which is taller than life when heights are stretched.
        return { ...look, headingDeg: at.headingDeg + offset, pitchDeg: trueEl(at.pitchDeg, look.stretch) }
      })
    }
    const silence = setTimeout(() => {
      window.removeEventListener('deviceorientation', onReading)
      stopListening.current = null
      setStatus('silent')
    }, SILENT_AFTER_MS)
    window.addEventListener('deviceorientation', onReading)
    stopListening.current = () => {
      clearTimeout(silence)
      window.removeEventListener('deviceorientation', onReading)
    }
  }, [steer, setLens])

  /** Must be called from a tap: iOS only asks the visitor from inside one. */
  const start = useCallback(async () => {
    stopListening.current?.()
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      setStatus('unavailable')
      return
    }
    setStatus('asking')
    const ask = (window.DeviceOrientationEvent as AskingEvent).requestPermission
    if (typeof ask === 'function') {
      try {
        if ((await ask.call(window.DeviceOrientationEvent)) !== 'granted') {
          setStatus('refused')
          return
        }
      } catch {
        // Thrown when the browser will not even ask (not a tap, or blocked by the page's settings).
        setStatus('refused')
        return
      }
    }
    listen()
  }, [listen])

  return { status, start, stop }
}

/** What to tell the visitor about the motion sensor; null when there is nothing to say. */
export function motionWords(status: MotionStatus): string | null {
  switch (status) {
    case 'asking':
      return 'Waiting for the motion sensor…'
    case 'on':
      return 'Turn with your phone held up to look around. Dragging takes over again.'
    case 'refused':
      return 'Motion access was turned down, so drag to look around. To be asked again, reload the page.'
    case 'silent':
      return 'This device is not reporting its motion, so drag to look around.'
    case 'unavailable':
      return 'This browser has no motion sensor to read, so drag to look around.'
    default:
      return null
  }
}
