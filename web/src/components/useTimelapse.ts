import { useEffect, useState } from 'react'

/** The longest step one frame may take, so a tab coming back from the background doesn't leap. */
const MAX_FRAME_S = 0.1

/**
 * A fractional hour that advances every screen refresh while `playing`, looping over `length` hours.
 * It runs on requestAnimationFrame rather than a fixed timer, so the light and camera move a little
 * each frame instead of jumping a few hours at a time, and it pauses itself in a hidden tab.
 */
export function useTimelapse(length: number, playing: boolean, hoursPerSecond: number): number {
  const [hour, setHour] = useState(0)

  useEffect(() => {
    if (!playing || length === 0) return
    let last: number | null = null
    let frame = requestAnimationFrame(function tick(time) {
      const dt = last === null ? 0 : Math.min((time - last) / 1000, MAX_FRAME_S)
      last = time
      setHour((h) => (h + dt * hoursPerSecond) % length)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, length, hoursPerSecond])

  return hour
}
