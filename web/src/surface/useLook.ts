import { useCallback, useEffect, useRef, useState } from 'react'
import { boundedLook, faceToward, framingPitch, type Look, turnBetween } from '../lib/surfaceView'
import type { Facing } from './address'
import type { SkyPair } from './useGlide'

export type Body = 'sun' | 'earth'

/**
 * Where a link says to look. `id` changes each time a link is followed; `look` is null when the
 * link doesn't say which way to face; `site` is the site the link names.
 */
export interface Aim {
  id: number
  look: Look | null
  site: string | null
  /** Which views the link opens, when it says. */
  face?: Facing | null
}

interface Options {
  /** Where the Sun and Earth are drawn now. */
  sky: SkyPair
  /** Which of them the track says is up this hour, for choosing what to face on arrival. */
  up: { sun: boolean; earth: boolean }
  aim: Aim
  /** The height of the land's top edge at an azimuth (degrees), for keeping it in view under a body. */
  skylineAt: (azDeg: number) => number
  /** The site on screen. Arriving at another one turns the view to whichever of the Sun and Earth is up. */
  siteId: string
  /** How far from the middle of the picture a faced body may sit, as a share of its height. */
  offCenter: number
  /** The field of view a fresh visit opens with. */
  openingFovDeg: number
  /** How many times taller heights are drawn as it opens (1 unless another view is already stretched). */
  openingStretch?: number
  /** The body this view is for: it turns to that one on arrival, whichever is up. */
  prefer?: Body | null
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
export function useLook({ sky, up, aim, skylineAt, siteId, offCenter, openingFovDeg, openingStretch = 1, prefer = null, still }: Options): LookControls {
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
  const latest = useRef({ shown, sky, up, still, following, toward, prefer })
  useEffect(() => {
    latest.current = { shown, sky, up, still, following, toward, prefer }
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

  // Arriving: a link that says which way to face is obeyed; otherwise a new site opens facing
  // whichever of the Sun and Earth is up (the Sun, if neither is), and keeps it in the middle.
  const arrived = useRef<{ aimId: number; siteId: string | null }>({ aimId: -1, siteId: null })
  useEffect(() => {
    const newAim = arrived.current.aimId !== aim.id
    const newSite = arrived.current.siteId !== siteId
    arrived.current = { aimId: aim.id, siteId }
    if (!newAim && !newSite) return
    if (aim.look && (newAim || aim.site === siteId)) {
      stopTurning()
      setLook(aim.look)
      setFollowing(null)
    } else if (newSite) {
      stopTurning()
      const now = latest.current
      const body: Body = now.prefer ?? (now.up.sun || !now.up.earth ? 'sun' : 'earth')
      setLook((current) => {
        const to = now.toward(body, now.sky, current)
        return faceToward(current, to.headingDeg, to.pitchDeg)
      })
      setFollowing(body)
    }
  }, [aim, siteId, stopTurning])

  return { look: shown, following, steer, setLens, face }
}
