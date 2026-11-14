import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadYearPositions } from '../data/loadSite'

/** The longest step one frame may take, so a tab coming back from the background doesn't leap. */
const MAX_FRAME_S = 0.1

export interface Clock {
  /** Hours since the start of the data, fractional while time plays. */
  hour: number
  playing: boolean
  hoursPerSecond: number
  setHour: (hour: number) => void
  setPlaying: (playing: boolean) => void
  setSpeed: (hoursPerSecond: number) => void
}

/**
 * The screen's one clock. While playing it moves a little every frame, at `hoursPerSecond` hours of
 * ephemeris a second, and goes round to the start when the data ends.
 */
export function useClock(hours: number, startHour: number, startPlaying: boolean, startSpeed: number): Clock {
  const [hour, setHourState] = useState(startHour)
  const [playing, setPlaying] = useState(startPlaying)
  const [hoursPerSecond, setSpeed] = useState(startSpeed)

  useEffect(() => {
    if (!playing || hours === 0) return
    let last: number | null = null
    let frame = requestAnimationFrame(function tick(time) {
      const dt = last === null ? 0 : Math.min((time - last) / 1000, MAX_FRAME_S)
      last = time
      setHourState((h) => (h + dt * hoursPerSecond) % hours)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, hours, hoursPerSecond])

  const setHour = useCallback((next: number) => setHourState(hours > 0 ? Math.max(0, Math.min(next, hours - 1)) : next), [hours])
  return { hour, playing, hoursPerSecond, setHour, setPlaying, setSpeed }
}

/** A switch remembered in this browser, under `sightline.<key>`. Works without storage, just not remembered. */
export function useStored(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const name = `sightline.${key}`
  const [value, setValue] = useState(() => {
    try {
      const kept = window.localStorage.getItem(name)
      return kept === null ? initial : kept === '1'
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        window.localStorage.setItem(name, next ? '1' : '0')
      } catch {
        // Private windows may refuse; the switch still works for this visit.
      }
    },
    [name],
  )
  return [value, set]
}

const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const

/**
 * True once nothing has moved, been touched or been pressed for `afterMs`, while `enabled`. Any
 * movement, touch or key ends it at once.
 */
export function useIdle(enabled: boolean, afterMs: number): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    // Whatever switches this off (pause, hide) is itself a touch or a key, which has already ended the idleness.
    if (!enabled) return
    let timer = window.setTimeout(() => setIdle(true), afterMs)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), afterMs)
    }
    for (const name of WAKE_EVENTS) window.addEventListener(name, wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const name of WAKE_EVENTS) window.removeEventListener(name, wake)
    }
  }, [enabled, afterMs])

  return enabled && idle
}

/**
 * A year of the Sun's and Earth's positions from the pipeline's ephemeris file; null until one loads.
 * The year before stays on hand until the next one arrives, so check `year` before reading an hour.
 */
export function useYearPositions(year: number | null): { year: number; positions: Float32Array } | null {
  const [loaded, setLoaded] = useState<{ year: number; positions: Float32Array } | null>(null)

  useEffect(() => {
    if (year === null) return
    let current = true
    loadYearPositions(year)
      .then((positions) => {
        if (current) setLoaded({ year, positions })
      })
      // Without it the Moon is lit evenly; the dots and numbers don't depend on it.
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [year])

  return loaded
}

/**
 * How much of a one-row header fits. The row starts with everything (`most`); while its parts are
 * wider than the row, one level is taken off, and the caller leaves out or moves what that level
 * holds. A new width starts again from everything. The parts must not shrink or wrap, so that a row
 * that is too full measures wider than its box.
 */
export function useFitLevel<T extends HTMLElement>(most: number): { ref: RefObject<T | null>; level: number } {
  const ref = useRef<T>(null)
  const [fit, setFit] = useState({ width: 0, level: most })
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const watcher = new ResizeObserver(() => {
      const width = row.clientWidth
      setFit((current) => (current.width === width ? current : { width, level: most }))
    })
    watcher.observe(row)
    // Text measured before the page's fonts arrive is wider or narrower than it will be: fit again then.
    let current = true
    void document.fonts.ready.then(() => {
      if (current) setFit((fit) => ({ ...fit, level: most }))
    })
    return () => {
      current = false
      watcher.disconnect()
    }
  }, [most])
  // After every render, before the browser paints: too full means one level less.
  useLayoutEffect(() => {
    const row = ref.current
    if (!row || fit.level === 0) return
    // scrollWidth is a whole number; the last part's own edge catches a spill of under a pixel.
    const last = row.lastElementChild
    const spills = row.scrollWidth > row.clientWidth || (last !== null && last.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5)
    if (spills) setFit((current) => ({ ...current, level: current.level - 1 }))
  })
  return { ref, level: fit.level }
}

/** The time now, as an ISO string. A page under test may pin it (the check script does), so its checks hold whatever the day. */
export function nowIso(): string {
  return (window as { __SIGHTLINE_NOW?: string }).__SIGHTLINE_NOW ?? new Date().toISOString()
}
