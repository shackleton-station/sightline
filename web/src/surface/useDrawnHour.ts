import { useEffect, useRef, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { type SkyPair, skyAt } from '../lib/skyBetween'

export type { SkyPair }

/** With no recent steps to go by (one step by hand), a step of one hour is drawn over this long. */
const STEP_MS = 60
/** Steps further apart than this are not "time playing": the next one is drawn at the default pace. */
const STEPS_WINDOW_MS = 600
/** The drawn hour never trails the hour on show by more than this: further behind, it goes straight there. */
const MAX_TRAIL_HOURS = 6

/**
 * The hour the Sun and Earth are drawn at, which may have a fraction, and where that puts them.
 *
 * The data is hourly, and the hour on show moves in steps: one hour every 60 ms while this page
 * plays, or whatever Sightline's time bar sends when the page is inside it. Drawing each step as it
 * comes moves the picture in jerks, and easing into each step makes it pulse. Instead the drawn hour
 * follows the hour on show at the pace the steps are arriving, measured over the last few: steadily,
 * the same distance every frame, so the Sun and Earth glide across the sky at an even speed. Between
 * two hours each is placed along the great circle from one hour's position to the next. One step by
 * hand is drawn over 60 ms. A jump (a drag along the time river, going back, another month or site)
 * and reduced motion go straight to the new hour.
 */
export function useDrawnHour(track: TrackPoint[], index: number, scene: string, still: boolean): SkyPair {
  const [drawn, setDrawn] = useState({ hour: index, scene, track })
  const at = useRef({ hour: index, scene, track })
  /** When the hour on show last changed, and to what: the pace the steps come at. */
  const steps = useRef<{ time: number; hour: number }[]>([])
  const lastFrame = useRef(0)

  useEffect(() => {
    const time = performance.now()
    const from = at.current
    const recent = steps.current.filter((step) => time - step.time < STEPS_WINDOW_MS && step.hour < index)
    steps.current = [...recent, { time, hour: index }].slice(-6)
    const behind = index - from.hour
    if (still || from.scene !== scene || from.track !== track || behind <= 0 || behind > MAX_TRAIL_HOURS) {
      steps.current = [{ time, hour: index }]
      at.current = { hour: index, scene, track }
      setDrawn(at.current)
      return
    }
    // Hours per millisecond: over the recent steps if time is playing, else one hour per STEP_MS.
    const first = steps.current[0]
    const pace = steps.current.length > 1 && time > first.time ? (index - first.hour) / (time - first.time) : 1 / STEP_MS
    let request = 0
    // Carried on from the last frame drawn, so the frame after a new step moves a whole frame's worth.
    let last = time - lastFrame.current < 100 ? lastFrame.current : time
    const step = (now: number) => {
      const elapsed = Math.min(now - last, 100)
      last = now
      lastFrame.current = now
      const left = index - at.current.hour
      // Never slower than the pace, and a little faster when further behind, so it keeps up without jumping.
      const move = elapsed * pace * Math.max(1, left)
      const hour = left <= move ? index : at.current.hour + move
      at.current = { hour, scene, track }
      setDrawn(at.current)
      if (hour !== index) request = requestAnimationFrame(step)
    }
    request = requestAnimationFrame(step)
    return () => cancelAnimationFrame(request)
  }, [index, scene, track, still])

  // The first draw of a new site or month is already the new one, not a frame of the old.
  const hour = drawn.scene === scene && drawn.track === track ? drawn.hour : index
  return skyAt(track, hour)
}
