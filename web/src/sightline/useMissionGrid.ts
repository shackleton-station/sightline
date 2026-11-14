import { useEffect, useMemo, useState } from 'react'
import { useLightGrid } from '../atlas/useLightGrid'
import type { SiteInfo } from '../data/contract'
import { gapsFor, gapsKey, gapsNow, loadSlopeWhole, slopePartFor, slopePartNow, WHOLE_SUB } from '../data/loadMissionGrid'
import { ACCURACY_RANGE, cellChances, landingOdds, type Spread } from '../lib/landingOdds'
import type { LightMeta } from '../lib/lightGrid'
import { locateHour } from '../lib/mission'
import { blurReads, fitField, fitMapAround, type GridGaps, halved, oddsField, oddsPixels, squareAround } from '../lib/missionGrid'
import type { SightlineMission, SightlineScenario } from '../lib/sightlineMission'
import type { GlobeShade } from '../three/GlobeViewer'
import { loadYearPositions } from '../data/customSite'
import type { Requirements } from '../lib/mission'
import { hourOfYear, smoothMoonFit, softened, WASH_SIZE } from '../lib/moonWash'

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

/** How much of the Moon the shading hides: the ground still shows through it. */
export const SHADE_OPACITY = 0.38
/** The least the picture is softened by, in its own pixels (60 m each at full size): the grid's 120 m cells do not show as squares. */
const SOFTEN_PX = 1.25
/** The most pixel reads one picture may cost: past it, the picture is made at half the size. */
const READS_BUDGET = 80e6

/**
 * The odds of a landing fitting, as a picture to lay over the Moon: for a lander aimed at each
 * point of the light grid's square, with the spread given, green where nearly every landing fits
 * the mission, through amber, to red where almost none does. Null while off or not yet read. A
 * spread being dragged is drawn once it rests.
 */
export function useFitOverlay(grid: MissionGrid, mission: SightlineMission, spread: Spread, on: boolean): GlobeShade['polar'] {
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

  const [rested, setRested] = useState(spread)
  useEffect(() => {
    const wait = window.setTimeout(() => setRested(spread), 200)
    return () => window.clearTimeout(wait)
  }, [spread])

  const { requirements, maxSlopeDeg } = mission
  // Where a landing fits changes with the mission, not with the spread laid on it.
  const fits = useMemo(() => {
    // The slope is waited for, so the picture does not arrive twice.
    if (!on || !meta || !gaps || slope === undefined) return null
    return fitField(gaps, requirements, maxSlopeDeg, WHOLE_SUB, slope, true)
  }, [on, meta, gaps, slope, requirements, maxSlopeDeg])

  return useMemo(() => {
    if (!fits || !meta || !gaps) return null
    const full = gaps.size * WHOLE_SUB
    const fullM = meta.pixel_m / WHOLE_SUB
    // A wide spread blurs far: at half the size it reads a quarter of the pixels over half the distance.
    const small = full * full * blurReads(fullM, rested) > READS_BUDGET
    const side = small ? full / 2 : full
    const odds = oddsField(small ? halved(fits, full) : fits, side, small ? 2 * fullM : fullM, rested, small ? SOFTEN_PX / 2 : SOFTEN_PX)
    const image = document.createElement('canvas')
    image.width = side
    image.height = side
    const context = image.getContext('2d')
    if (!context) return null
    context.putImageData(new ImageData(oddsPixels(odds) as Uint8ClampedArray<ArrayBuffer>, side, side), 0, 0)
    return { image, halfWidthM: meta.half_width_m, radiusM: meta.radius_m }
  }, [fits, meta, gaps, rested])
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

/**
 * The whole Moon colored by whether a landing at this hour fits the mission's Sun and Earth limits
 * on a smooth Moon (`moonWash.ts`): the same green and red as the light grid's picture, for the
 * ground the grid does not reach. Null while off, while the year's positions load, or when the
 * mission runs past them.
 */
export function useMoonWash(start: string, landing: number, requirements: Requirements, on: boolean): HTMLCanvasElement | null {
  const { year, hour } = hourOfYear(start, landing)
  // A mission that runs into the next year needs that year's positions too.
  const spills = hourOfYear(start, landing + requirements.missionDays * 24).year > year
  const key = `${year}${spills ? '+' : ''}`
  const [loaded, setLoaded] = useState<{ key: string; positions: Float32Array } | null>(null)
  useEffect(() => {
    if (!on) return
    let current = true
    Promise.all([loadYearPositions(year), spills ? loadYearPositions(year + 1) : null])
      .then(([first, second]) => {
        if (!current) return
        const positions = new Float32Array(first.length + (second?.length ?? 0))
        positions.set(first)
        if (second) positions.set(second, first.length)
        setLoaded({ key, positions })
      })
      // Without the positions the Moon keeps only the light grid's picture.
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [on, year, spills, key])

  const positions = loaded?.key === key ? loaded.positions : null
  return useMemo(() => {
    if (!on || !positions) return null
    const fit = smoothMoonFit(positions, hour, requirements)
    if (!fit) return null
    const image = document.createElement('canvas')
    image.width = WASH_SIZE.width
    image.height = WASH_SIZE.height
    const context = image.getContext('2d')
    if (!context) return null
    context.putImageData(new ImageData(oddsPixels(softened(fit, WASH_SIZE)) as Uint8ClampedArray<ArrayBuffer>, WASH_SIZE.width, WASH_SIZE.height), 0, 0)
    return image
  }, [on, positions, hour, requirements])
}