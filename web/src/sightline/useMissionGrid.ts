import { useEffect, useMemo, useState } from 'react'
import { useLightGrid } from '../atlas/useLightGrid'
import type { SiteInfo } from '../data/contract'
import { gapsFor, gapsKey, gapsNow, loadSlopeWhole, slopePartFor, slopePartNow, WHOLE_SUB } from '../data/loadMissionGrid'
import { ACCURACY_RANGE, cellChances, FIT_COLOR, landingOdds, type Miss, MISS_COLORS, MISSES, type Spread } from '../lib/landingOdds'
import type { LightMeta } from '../lib/lightGrid'
import { locateHour } from '../lib/mission'
import { fitMapAround, fitPixels, type GridGaps, squareAround } from '../lib/missionGrid'
import type { SightlineMission, SightlineScenario } from '../lib/sightlineMission'
import type { GlobeOverlay } from '../three/GlobeViewer'

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
    // A landing being dragged along the time bar asks once it rests.
    const wait = window.setTimeout(() => {
      gapsFor(meta, start, landing, missionDays)
        .then(() => current && setSettled({ key, failed: false }))
        .catch((reason: unknown) => {
          console.error(reason)
          if (current) setSettled({ key, failed: true })
        })
    }, 250)
    return () => {
      current = false
      window.clearTimeout(wait)
    }
  }, [meta, wanted, key, start, landing, missionDays])

  if (!wanted) return { meta, gaps: null, state: 'off' }
  if (meta === null || (settled?.key === key && settled.failed)) return { meta, gaps: null, state: 'failed' }
  const mine = gapsNow(start, landing, missionDays)
  if (mine === undefined || !meta) return { meta, gaps: null, state: 'loading' }
  return mine === 'past' ? { meta, gaps: null, state: 'past' } : { meta, gaps: mine, state: 'ready' }
}

function rgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]
}

/** Each verdict's color as the picture's pixels: the one that fits first, then each reason in `MISSES`' order. */
const COLORS = [rgb(FIT_COLOR), ...MISSES.map((miss) => rgb(MISS_COLORS[miss]))]

/** How much of the Moon the shading hides: the ground still shows through it. */
const SHADE_OPACITY = 0.45

export interface FitShade {
  /** The picture to lay over the Moon; null while off or not yet read. */
  overlay: GlobeOverlay | null
  /** The reasons that appear in it, for its key. */
  reasons: Miss[]
}

/**
 * The grid's verdicts as a picture to lay over the Moon: green where a landing at this hour fits
 * the mission, and each reason it does not in its own color, across the light grid's square.
 */
export function useFitOverlay(grid: MissionGrid, mission: SightlineMission, on: boolean): FitShade {
  const { meta, gaps } = grid
  const [slope, setSlope] = useState<Float32Array | null | undefined>(undefined)
  useEffect(() => {
    if (!on || !meta) return
    let current = true
    void loadSlopeWhole(meta).then((value) => current && setSlope(value))
    return () => {
      current = false
    }
  }, [on, meta])

  const { requirements, maxSlopeDeg } = mission
  return useMemo(() => {
    // The slope is waited for, so the picture does not arrive twice.
    if (!on || !meta || !gaps || slope === undefined) return { overlay: null, reasons: [] }
    const side = gaps.size * WHOLE_SUB
    const image = document.createElement('canvas')
    image.width = side
    image.height = side
    const context = image.getContext('2d')
    if (!context) return { overlay: null, reasons: [] }
    const { pixels, seen } = fitPixels(gaps, requirements, maxSlopeDeg, WHOLE_SUB, slope, COLORS)
    context.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, side, side), 0, 0)
    return {
      overlay: { image, halfWidthM: meta.half_width_m, radiusM: meta.radius_m, paint: 'picture', opacity: SHADE_OPACITY },
      reasons: MISSES.filter((_, i) => seen[i + 1]),
    }
  }, [on, meta, gaps, slope, requirements, maxSlopeDeg])
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
