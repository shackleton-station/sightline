import { useEffect, useMemo, useRef, useState } from 'react'
import { useLightGrid } from '../atlas/useLightGrid'
import type { SiteInfo } from '../data/contract'
import { gapsFor, gapsKey, gapsNow, loadSlopeWhole, slopePartFor, slopePartNow } from '../data/loadMissionGrid'
import { ACCURACY_RANGE, cellChances, landingOdds, type Spread } from '../lib/landingOdds'
import type { LightMeta } from '../lib/lightGrid'
import { locateHour } from '../lib/mission'
import { fitMapAround, type GridGaps, squareAround } from '../lib/missionGrid'
import { hourOfYear } from '../lib/moonWash'
import type { SightlineMission, SightlineScenario } from '../lib/sightlineMission'
import type { GlobeShade } from '../three/GlobeViewer'
import { type Frame, giveSlope, keepFrame, nextWanted, pickFrames, polarPicture, washPicture } from './shadeFrames'
/**
 * How far the ground is read around a target (m): far enough to hold nearly every landing at the
 * loosest accuracy offered, with room left to look for a better place to aim.
 */
export const REACH_M = ACCURACY_RANGE.max * 2

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
 * The shade for "Mission success probability", for a landing at the hour on the time bar: the
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
/**
 * The odds of a landing fitting, for each scenario: its own landing read from the light grid, the
 * ground around its site judged against the mission, and the spread laid on it. Null for a
 * scenario while it is read, outside the grid, or past its last month. Read only while `wanted`.
 */
export function useScenarioOdds(meta: LightMeta | null | undefined, start: string, scenarios: SightlineScenario[], sites: SiteInfo[], mission: SightlineMission, spread: Spread, wanted: boolean): (number | null)[] {
  const [arrived, setArrived] = useState(0)
  const { requirements, maxSlopeDeg } = mission
  const days = requirements.missionDays
  const asked = scenarios.map((scenario, i) => `${sites[i].lat},${sites[i].lon}@${scenario.landing}`).join('|')

  useEffect(() => {
    if (!meta || !wanted) return
    let current = true
    const tell = () => current && setArrived((count) => count + 1)
    const wait = window.setTimeout(() => {
      scenarios.forEach((scenario, i) => {
        const square = squareAround(meta, sites[i].lat, sites[i].lon, REACH_M)
        if (!square) return
        // A failure leaves the scenario without odds; the panel says why when it is opened.
        gapsFor(meta, start, scenario.landing, days).then(tell, () => undefined)
        void slopePartFor(meta, square).then(tell)
      })
    }, 250)
    return () => {
      current = false
      window.clearTimeout(wait)
    }
    // `asked` names every scenario's site and landing: the same string is the same work.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, wanted, asked, start, days])

  return useMemo(
    () =>
      scenarios.map((scenario, i) => {
        if (!meta || !wanted) return null
        const { lat, lon } = sites[i]
        const square = squareAround(meta, lat, lon, REACH_M)
        const gaps = gapsNow(start, scenario.landing, days)
        const slope = square ? slopePartNow(square) : undefined
        if (!square || !gaps || gaps === 'past' || slope === undefined) return null
        const map = fitMapAround(meta, gaps, square, lat, lon, requirements, maxSlopeDeg, slope)
        return landingOdds(map, cellChances(map, spread)).fit
      }),
    // `arrived` counts what has been read since: each arrival is a reason to work the odds out again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [meta, wanted, asked, start, days, requirements, maxSlopeDeg, spread, arrived],
  )
}

