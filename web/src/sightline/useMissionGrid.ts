import { useEffect, useMemo, useRef, useState } from 'react'
import { useLightGrid } from '../atlas/useLightGrid'
import { gapsFor, gapsKey, gapsNow, loadSlopeWhole } from '../data/loadMissionGrid'
import type { Spread } from '../lib/landingOdds'
import type { LightMeta } from '../lib/lightGrid'
import { locateHour } from '../lib/mission'
import type { GridGaps } from '../lib/missionGrid'
import { hourOfYear } from '../lib/moonWash'
import type { SightlineMission } from '../lib/sightlineMission'
import type { GlobeShade } from '../three/GlobeViewer'
import { type Frame, giveSlope, keepFrame, nextWanted, pickFrames, polarPicture, washPicture } from './shadeFrames'
export interface MissionGrid {
  /** The light grid's description: undefined until known, null if this build has none. */
  meta: LightMeta | null | undefined
  /** The mission's gaps at every cell for the landing, once read. */
  gaps: GridGaps | null
  /** 'past': the mission runs past the grid's last month. 'failed': the grid could not be read. */
  state: 'off' | 'loading' | 'ready' | 'past' | 'failed'
}

/**
 * The light grid read for one landing: what is up at landing and the longest gaps during the
 * mission, at every cell. Read only while `wanted`, since it downloads each month the mission
 * covers. Limits other than the mission's length change nothing here.
 */
export function useMissionGrid(start: string, landing: number, missionDays: number, wanted: boolean): MissionGrid {
  const { meta } = useLightGrid(locateHour(start, landing).month, false, false)
  const key = gapsKey(start, landing, missionDays)
  // What became of each landing asked for: only its arriving, or failing, redraws the page.
  const [settled, setSettled] = useState<{ key: string; failed: boolean } | null>(null)

  useEffect(() => {
    if (!meta || !wanted || gapsNow(start, landing, missionDays) !== undefined) return
    let current = true
    gapsFor(meta, start, landing, missionDays)
      .then(() => current && setSettled({ key, failed: false }))
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setSettled({ key, failed: true })
      })
    return () => {
      current = false
    }
  }, [meta, wanted, key, start, landing, missionDays])

  if (!wanted) return { meta, gaps: null, state: 'off' }
  if (meta === null || (settled?.key === key && settled.failed)) return { meta, gaps: null, state: 'failed' }
  const mine = gapsNow(start, landing, missionDays)
  if (mine === undefined || !meta) return { meta, gaps: null, state: 'loading' }
  return mine === 'past' ? { meta, gaps: null, state: 'past' } : { meta, gaps: mine, state: 'ready' }
}

/** How much of the Moon the shading hides: the ground still shows through it. */
const SHADE_OPACITY = 0.38
/** How far apart the pictures blended between are, in hours: the polar one is the costly one. */
const POLAR_EVERY_H = 24
const WASH_EVERY_H = 12
/** The time bar counts as resting once the hour has stood this long: then the hour's own picture is made. */
const RESTED_MS = 350

/** The pictures on hand, for the one Sightline screen there is. */
const polarFrames: Frame[] = []
const washFrames: Frame[] = []
let slopeGiven: Promise<void> | null = null

/**
 * The shade for "Landings that fit", for a landing at the hour on the time bar: the
 * whole Moon from the smooth Moon, and round the south pole the light grid's finer picture.
 *
 * The pictures change slowly and smoothly with the hour, so they are not made for every hour.
 * Key frames some hours apart are worked out off the page's thread, and the globe blends between
 * the two either side of the hour, which costs nothing. Once the bar rests, the hour's own picture
 * is made and shown in their place. Null while off, or before any picture has arrived.
 */
export function useMoonShade(meta: LightMeta | null | undefined, start: string, hour: number, mission: SightlineMission, spread: Spread, on: boolean): GlobeShade | null {
  const [arrived, setArrived] = useState(0)
  const [restedHour, setRestedHour] = useState(hour)
  useEffect(() => {
    const timer = window.setTimeout(() => setRestedHour(hour), RESTED_MS)
    return () => window.clearTimeout(timer)
  }, [hour])
  const rested = restedHour === hour
  // A spread being dragged is drawn once it rests.
  const [restedSpread, setRestedSpread] = useState(spread)
  useEffect(() => {
    const timer = window.setTimeout(() => setRestedSpread(spread), 200)
    return () => window.clearTimeout(timer)
  }, [spread])

  const { requirements, maxSlopeDeg } = mission
  const washSign = JSON.stringify(requirements)
  const polarSign = JSON.stringify([requirements, maxSlopeDeg, restedSpread])
  const busy = useRef({ polar: false, wash: false })

  useEffect(() => {
    if (!on) return
    const tell = () => setArrived((count) => count + 1)
    const washHour = nextWanted(washFrames, washSign, hour, WASH_EVERY_H, rested)
    if (washHour !== null && !busy.current.wash) {
      busy.current.wash = true
      const { year, hour: inYear } = hourOfYear(start, washHour)
      void washPicture({ year, hour: inYear, requirements }).then((picture) => {
        keepFrame(washFrames, { sign: washSign, hour: washHour, picture }, 8)
        busy.current.wash = false
        tell()
      })
    }
    const polarHour = meta ? nextWanted(polarFrames, polarSign, hour, POLAR_EVERY_H, rested) : null
    if (meta && polarHour !== null && !busy.current.polar) {
      busy.current.polar = true
      // The slope goes to the worker once, before its first polar picture.
      slopeGiven ??= loadSlopeWhole(meta).then(giveSlope)
      const { month, index } = locateHour(start, polarHour)
      void slopeGiven
        .then(() => polarPicture({ meta, month, index, requirements, maxSlopeDeg, spread: restedSpread }))
        .then((picture) => {
          keepFrame(polarFrames, { sign: polarSign, hour: polarHour, picture }, 5)
          busy.current.polar = false
          tell()
        })
    }
    // `arrived` counts the pictures that have come: each arrival may leave another to ask for.
  }, [on, meta, start, hour, rested, washSign, polarSign, requirements, maxSlopeDeg, restedSpread, arrived])

  return useMemo(() => {
    if (!on) return null
    const wash = pickFrames(washFrames, washSign, hour, WASH_EVERY_H)
    if (!wash) return null
    const polar = meta ? pickFrames(polarFrames, polarSign, hour, POLAR_EVERY_H) : null
    return { wash, polar: polar && meta ? { ...polar, halfWidthM: meta.half_width_m, radiusM: meta.radius_m } : null, opacity: SHADE_OPACITY }
    // `arrived` counts the pictures that have come: each arrival may change what there is to show.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [on, meta, hour, washSign, polarSign, arrived])
}
