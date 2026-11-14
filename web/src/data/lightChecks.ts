import { useEffect, useState } from 'react'

/** What the How it works page quotes about the Atlas's light grid, read from the pipeline's own files. */
export interface LightChecks {
  pixelM: number
  /** The square's full width, in kilometers. */
  widthKm: number
  /** The wider, coarser grid around it, where this build has one: its pixel and its full width. */
  wide: { pixelM: number; widthKm: number } | null
  /** Pixels computed in all, over both grids, in millions. */
  millionsOfPixels: number
  /** Listed sites the grid's code was run at, and the hours compared at each. */
  sites: number
  hours: number
  /** The lowest share of hours, over those sites and both bodies, in which it gave the site's own answer. */
  worstAgreePct: number
  /** Against NASA's long-run map: pixels compared, mean absolute difference (points) and correlation. */
  pixels: number
  meanAbs: number
  r: number
  /** The same correlation with the sky turned half way round, and with no terrain at all. */
  rTurned: number
  rNoTerrain: number
}

interface MetaFile {
  size: number
  pixel_m: number
  wide?: { size: number; pixel_m: number }
}
interface Scores {
  agree_pct: number
  hours: number
}
interface ValidationFile {
  sites: { sun: { same_point: Scores }; earth: { same_point: Scores } }[]
  pgda: Record<'ours' | 'turned_180' | 'no_terrain', { sun_mean_disk: { all: { n: number; mean_abs: number; r: number } } }>
}

const DIR = `${import.meta.env.BASE_URL}data/light/`

async function load(): Promise<LightChecks | null> {
  const [meta, checks] = await Promise.all(
    ['meta.json', 'validation.json'].map(async (name) => {
      const response = await fetch(DIR + name)
      return response.ok ? ((await response.json()) as unknown) : null
    }),
  )
  if (!meta || !checks) return null
  const { size, pixel_m, wide } = meta as MetaFile
  const { sites, pgda } = checks as ValidationFile
  const ours = pgda.ours.sun_mean_disk.all
  return {
    pixelM: pixel_m,
    widthKm: Math.round((size * pixel_m) / 1000),
    wide: wide ? { pixelM: wide.pixel_m, widthKm: Math.round((wide.size * wide.pixel_m) / 1000) } : null,
    millionsOfPixels: (size * size + (wide ? wide.size * wide.size : 0)) / 1e6,
    sites: sites.length,
    hours: sites[0]?.sun.same_point.hours ?? 0,
    worstAgreePct: Math.min(...sites.flatMap((site) => [site.sun.same_point.agree_pct, site.earth.same_point.agree_pct])),
    pixels: ours.n,
    meanAbs: ours.mean_abs,
    r: ours.r,
    rTurned: pgda.turned_180.sun_mean_disk.all.r,
    rNoTerrain: pgda.no_terrain.sun_mean_disk.all.r,
  }
}

/** The light grid's checks, or null while they load or if this build has no grid. */
export function useLightChecks(): LightChecks | null {
  const [checks, setChecks] = useState<LightChecks | null>(null)
  useEffect(() => {
    let current = true
    load()
      .then((found) => {
        if (current) setChecks(found)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [])
  return checks
}
