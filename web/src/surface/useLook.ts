import { useCallback, useEffect, useRef, useState } from 'react'
import { boundedLook, faceToward, framingPitch, type Look, turnBetween } from '../lib/surfaceView'
import type { SkyPair } from './useGlide'

export type Body = 'sun' | 'earth'

interface Options {
  /** Where the Sun and Earth are drawn now. */
  sky: SkyPair
  /** The body this view is for: it turns to it on arriving at a site, and keeps it in the middle. */
  body: Body
  /** The height of the land's top edge at an azimuth (degrees), for keeping it in view under a body. */
  skylineAt: (azDeg: number) => number
  /** The site on screen. Arriving at another one turns the view back to its body. */
  siteId: string
  /** How far from the middle of the picture a faced body may sit, as a share of its height. */
  offCenter: number
  /** The field of view a fresh visit opens with. */
  openingFovDeg: number
  /** How many times taller heights are drawn as it opens (1 unless another view is already stretched). */
  openingStretch?: number
  /** Reduced motion: turns happen at once. */
  still: boolean
}

export interface LookControls {
  look: Look
  /** The body the view is keeping in the middle as time moves, if any. */
  following: Body | null
  /** A change the visitor makes by hand: it lets go of whatever was being followed. */
  steer: (change: (look: Look) => Look) => void
  /** A change of lens (zoom, stretch): the view keeps following. */
  setLens: (change: (look: Look) => Look) => void
  /** Turn to a body, then keep it in the middle. */
  face: (body: Body) => void
}

const TURN_MS = 650
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const where = (sky: SkyPair, body: Body) => (body === 'sun' ? { az: sky.sunAz, el: sky.sunEl } : { az: sky.earthAz, el: sky.earthEl })

/**
 * Which way the visitor looks. Facing the Sun or Earth latches on: the view keeps that body in the
 * middle while time plays, until the visitor steers by hand.
 */
export function useLook({ sky, body, skylineAt, siteId, offCenter, openingFovDeg, openingStretch = 1, still }: Options): LookControls {
  const [look, setLook] = useState<Look>({ headingDeg: sky.sunAz, pitchDeg: sky.sunEl, fovDeg: openingFovDeg, stretch: openingStretch })
  const [following, setFollowing] = useState<Body | null>(null)
  const turning = useRef(0)

  // Where to point to face a body: at its azimuth, tipped so the land under it is in view too.
  const toward = (body: Body, from: SkyPair, lens: Look) => {
    const { az, el } = where(from, body)
    return { headingDeg: az, pitchDeg: framingPitch(el, skylineAt(az), lens, offCenter) }
  }
  // While following, the view points at the body wherever it has got to.
  const shown = following ? boundedLook({ ...look, ...toward(following, sky, look) }) : look
  const latest = useRef({ shown, sky, still, following, toward })
  useEffect(() => {
    latest.current = { shown, sky, still, following, toward }
  })

  const stopTurning = useCallback(() => {
    cancelAnimationFrame(turning.current)
    turning.current = 0
  }, [])
  useEffect(() => stopTurning, [stopTurning])

  const steer = useCallback(
    (change: (look: Look) => Look) => {
      stopTurning()
      // Letting go of a followed body starts from where it had the view pointing. Noted at once,
      // not at the next draw: several drags can arrive between two draws.
      const { following: followed, shown: held } = latest.current
      latest.current.following = null
      setFollowing(null)
      setLook((current) => boundedLook(change(followed ? { ...current, headingDeg: held.headingDeg, pitchDeg: held.pitchDeg } : current)))
    },
    [stopTurning],
  )

  const setLens = useCallback((change: (look: Look) => Look) => {
    setLook((current) => {
      const next = boundedLook(change(current))
      return boundedLook({ ...current, fovDeg: next.fovDeg, stretch: next.stretch })
    })
  }, [])

  const face = useCallback(
    (body: Body) => {
      stopTurning()
      const from = latest.current.shown
      if (latest.current.still) {
        const now = latest.current
        setLook((current) => {
          const to = now.toward(body, now.sky, current)
          return faceToward(current, to.headingDeg, to.pitchDeg)
        })
        setFollowing(body)
        return
      }
      setFollowing(null)
      const started = performance.now()
      const step = (time: number) => {
        const t = Math.min((time - started) / TURN_MS, 1)
        // Aim at where the body is now: it may be moving as the turn is made.
        const now = latest.current
        setLook((current) => {
          const to = now.toward(body, now.sky, current)
          const headingDeg = from.headingDeg + turnBetween(from.headingDeg, to.headingDeg) * ease(t)
          const pitchDeg = from.pitchDeg + (to.pitchDeg - from.pitchDeg) * ease(t)
          return boundedLook({ ...current, headingDeg, pitchDeg })
        })
        if (t < 1) turning.current = requestAnimationFrame(step)
        else {
          turning.current = 0
          setFollowing(body)
        }
      }
      turning.current = requestAnimationFrame(step)
    },
    [stopTurning],
  )

  // Arriving at a site: the view turns to its body, and keeps it in the middle.
  const arrived = useRef<string | null>(null)
  useEffect(() => {
    if (arrived.current === siteId) return
    arrived.current = siteId
    stopTurning()
    const now = latest.current
    setLook((current) => {
      const to = now.toward(body, now.sky, current)
      return faceToward(current, to.headingDeg, to.pitchDeg)
    })
    setFollowing(body)
  }, [siteId, body, stopTurning])

  return { look: shown, following, steer, setLens, face }
}
