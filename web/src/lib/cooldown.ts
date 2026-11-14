import { useCallback, useEffect, useState } from 'react'

/** Whole seconds until `until` (ms since the epoch), never below 0. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/**
 * Obeys a server's Retry-After. `start(seconds)` begins a wait; `secondsLeft` counts it down once a
 * second, so a button can say "Wait 12 s" and come back by itself. Only the page's own clock is
 * used: the server said "this many seconds", not a time of day.
 */
export function useCooldown(): { secondsLeft: number; start: (seconds: number) => void } {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= until) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [until])
  const start = useCallback((seconds: number) => {
    const at = Date.now()
    setNow(at)
    setUntil(at + seconds * 1000)
  }, [])
  return { secondsLeft: secondsLeft(until, now), start }
}
