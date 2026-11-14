import { useEffect, useMemo, useState } from 'react'
import { useLightGrid } from '../atlas/useLightGrid'
import { loadGaps, loadSlopeWhole, WHOLE_SUB } from '../data/loadMissionGrid'
import { FIT_COLOR, MISS_COLOR } from '../lib/landingOdds'
import type { LightMeta } from '../lib/lightGrid'
import { locateHour } from '../lib/mission'
import { fitPixels, type GridGaps } from '../lib/missionGrid'
import type { SightlineMission } from '../lib/sightlineMission'
import type { GlobeOverlay } from '../three/GlobeViewer'

export interface MissionGrid {
  /** The light grid's description: undefined until known, null if this build has none. */
  meta: LightMeta | null | undefined
  /** The mission's gaps at every cell for the landing, once read. */
  gaps: GridGaps | null
  /** 'past': the mission runs past the grid's last month. 'failed': the grid could not be read. */
  state: 'off' | 'loading' | 'ready' | 'past' | 'failed'
}

/** The last landing read, kept so closing and opening the panel reads nothing again. */
let kept: { key: string; gaps: GridGaps | 'past' } | null = null

/**
 * The light grid read for one landing: what is up at landing and the longest gaps during the
 * mission, at every cell. Read only while `wanted`, since it downloads each month the mission
 * covers. Limits other than the mission's length change nothing here.
 */
export function useMissionGrid(start: string, landing: number, missionDays: number, wanted: boolean): MissionGrid {
  const { meta } = useLightGrid(locateHour(start, landing).month, false, false)
  const key = `${start}@${landing}+${missionDays}`
  const [loaded, setLoaded] = useState<{ key: string; gaps: GridGaps | 'past' | 'failed' } | null>(kept)

  useEffect(() => {
    if (!meta || !wanted || kept?.key === key) return
    let current = true
    // A landing being dragged along the time bar asks once it rests.
    const wait = window.setTimeout(() => {
      loadGaps(meta, start, landing, missionDays)
        .then((gaps) => {
          kept = { key, gaps }
          if (current) setLoaded(kept)
        })
        .catch((reason: unknown) => {
          console.error(reason)
          if (current) setLoaded({ key, gaps: 'failed' })
        })
    }, 250)
    return () => {
      current = false
      window.clearTimeout(wait)
    }
  }, [meta, wanted, key, start, landing, missionDays])

  if (!wanted) return { meta, gaps: null, state: 'off' }
  const mine = loaded?.key === key ? loaded.gaps : kept?.key === key ? kept.gaps : null
  if (mine === null || !meta) return { meta, gaps: null, state: meta === null ? 'failed' : 'loading' }
  if (typeof mine === 'string') return { meta, gaps: null, state: mine }
  return { meta, gaps: mine, state: 'ready' }
}

function rgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]
}

/** How much of the Moon the shading hides: the ground still shows through it. */
const SHADE_OPACITY = 0.45

/**
 * The grid's verdicts as a picture to lay over the Moon: green where a landing at this hour fits
 * the mission, red where it does not, across the whole of the light grid's square. Null while off
 * or not yet read.
 */
export function useFitOverlay(grid: MissionGrid, mission: SightlineMission, on: boolean): GlobeOverlay | null {
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
    if (!on || !meta || !gaps || slope === undefined) return null
    const side = gaps.size * WHOLE_SUB
    const image = document.createElement('canvas')
    image.width = side
    image.height = side
    const context = image.getContext('2d')
    if (!context) return null
    const pixels = fitPixels(gaps, requirements, maxSlopeDeg, WHOLE_SUB, slope, rgb(FIT_COLOR), rgb(MISS_COLOR))
    context.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, side, side), 0, 0)
    return { image, halfWidthM: meta.half_width_m, radiusM: meta.radius_m, paint: 'picture', opacity: SHADE_OPACITY }
  }, [on, meta, gaps, slope, requirements, maxSlopeDeg])
}
