import { useEffect, useRef, useState } from 'react'
import { turnBetween, wrap360 } from '../lib/surfaceView'

/** Where the Sun and Earth are drawn (degrees). */
export interface SkyPair {
  sunAz: number
  sunEl: number
  earthAz: number
  earthEl: number
}

/** How quickly the drawn positions catch up with a new hour. */
const GLIDE_MS = 55
/** A move bigger than this (about three hours of the Sun's travel) is a jump, not a step: no glide. */
const MAX_GLIDE_DEG = 1.6
const SETTLED_DEG = 0.002

const far = (from: SkyPair, to: SkyPair) =>
  Math.abs(turnBetween(from.sunAz, to.sunAz)) > MAX_GLIDE_DEG ||
  Math.abs(to.sunEl - from.sunEl) > MAX_GLIDE_DEG ||
  Math.abs(turnBetween(from.earthAz, to.earthAz)) > MAX_GLIDE_DEG ||
  Math.abs(to.earthEl - from.earthEl) > MAX_GLIDE_DEG

/**
 * The Sun's and Earth's positions as drawn. The data is hourly; when time moves on by an hour the
 * disks slide to the new hour's position instead of jumping, and come to rest exactly on it. Bigger
 * moves (a drag along the time river, another month or site) and reduced motion go straight there.
 * `scene` names the site and month, so a new one never glides in from the old.
 */
export function useGlide(target: SkyPair, scene: string, still: boolean): SkyPair {
  const [shown, setShown] = useState({ pair: target, scene })
  const at = useRef({ pair: target, scene })
  const { sunAz, sunEl, earthAz, earthEl } = target

  useEffect(() => {
    const to: SkyPair = { sunAz, sunEl, earthAz, earthEl }
    const from = at.current
    if (still || from.scene !== scene || far(from.pair, to)) {
      at.current = { pair: to, scene }
      setShown(at.current)
      return
    }
    let request = 0
    let last = performance.now()
    const step = (time: number) => {
      const share = 1 - Math.exp(-(time - last) / GLIDE_MS)
      last = time
      const now = at.current.pair
      const sunTurn = turnBetween(now.sunAz, to.sunAz)
      const earthTurn = turnBetween(now.earthAz, to.earthAz)
      const left = Math.max(Math.abs(sunTurn), Math.abs(to.sunEl - now.sunEl), Math.abs(earthTurn), Math.abs(to.earthEl - now.earthEl))
      const next: SkyPair =
        left < SETTLED_DEG
          ? to
          : {
              sunAz: wrap360(now.sunAz + sunTurn * share),
              sunEl: now.sunEl + (to.sunEl - now.sunEl) * share,
              earthAz: wrap360(now.earthAz + earthTurn * share),
              earthEl: now.earthEl + (to.earthEl - now.earthEl) * share,
            }
      at.current = { pair: next, scene }
      setShown(at.current)
      if (next !== to) request = requestAnimationFrame(step)
    }
    request = requestAnimationFrame(step)
    return () => cancelAnimationFrame(request)
  }, [sunAz, sunEl, earthAz, earthEl, scene, still])

  // The first draw of a new site or month is already the new one, not a frame of the old.
  return shown.scene === scene ? shown.pair : target
}
