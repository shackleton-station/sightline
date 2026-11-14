import { useEffect, useState } from 'react'
import { bytes, gunzip } from '../data/customSite'
import { type LightMeta, type LightMetaFile, type LightMonth, lightMeta, readMonth, wideGrid } from '../lib/lightGrid'

const BASE = import.meta.env.BASE_URL

/** Where the grids' own files are. The month files are large, so they come from the assets bucket. */
export const LIGHT_URLS = {
  meta: `${BASE}data/light/meta.json`,
  month: (month: string) => `${BASE}tiles/light/${month}.bin.gz`,
  wideMonth: (month: string) => `${BASE}tiles/light/wide/${month}.bin.gz`,
  slopes: [`${BASE}tiles/light/slope_x.jpg`, `${BASE}tiles/light/slope_y.jpg`] as [string, string],
}

let metaRequest: Promise<LightMeta | null> | null = null

/** The grids' description, or null when this build has none (the page then shows the plain Moon). */
function loadMeta(): Promise<LightMeta | null> {
  metaRequest ??= fetch(LIGHT_URLS.meta)
    .then(async (response) => (response.ok ? lightMeta((await response.json()) as LightMetaFile) : null))
    .catch(() => null)
  return metaRequest
}

/** The months already unpacked, newest last. A month is 42 MB in memory, so few are kept. */
const kept = new Map<string, Promise<LightMonth>>()
const KEEP = 3

function loadMonth(meta: LightMeta, month: string, url: string): Promise<LightMonth> {
  const cached = kept.get(url)
  if (cached) return cached
  const request = bytes(url)
    .then(gunzip)
    .then((buffer) => readMonth(buffer, meta, month))
  kept.set(url, request)
  request.catch(() => kept.delete(url))
  while (kept.size > KEEP) kept.delete(kept.keys().next().value as string)
  return request
}

export interface LightGridState {
  /** Undefined until it is known whether this build has a grid; null if it has none. */
  meta: LightMeta | null | undefined
  /** The month on screen in the fine grid, once it has arrived. */
  month: LightMonth | null
  /** The wide grid's description and its month, where this build has one and it has arrived. */
  wideMeta: LightMeta | null
  wide: LightMonth | null
  /** 'loading' while the fine month downloads; 'missing' if the grid doesn't have it or it failed. */
  status: 'loading' | 'ready' | 'missing'
}

interface Loaded {
  month: string
  fine: LightMonth | null | undefined
  wide: LightMonth | null | undefined
}

/**
 * The light grids for one month: their description at once, each grid's month when it arrives.
 * `withWide: false` leaves the wide grid out, for a page that shows only the fine square.
 * `withMonths: false` fetches the description only, for a page that may never show the grid: a
 * month is megabytes to fetch and tens of megabytes unpacked.
 */
export function useLightGrid(month: string, withWide = true, withMonths = true): LightGridState {
  const [meta, setMeta] = useState<LightMeta | null | undefined>(undefined)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let current = true
    void loadMeta().then((value) => {
      if (current) setMeta(value)
    })
    return () => {
      current = false
    }
  }, [])

  const has = meta ? meta.hours[month] !== undefined : false
  const wideMeta = meta && withWide ? wideGrid(meta) : null
  useEffect(() => {
    if (!meta || !has || !withMonths) return
    let current = true
    // Each grid is shown as soon as it arrives; neither waits for the other.
    const arrive = (grid: 'fine' | 'wide', data: LightMonth | null) => {
      if (current) setLoaded((last) => ({ ...(last?.month === month ? last : { month, fine: undefined, wide: undefined }), [grid]: data }))
    }
    const fetchGrid = (grid: 'fine' | 'wide', gridMeta: LightMeta, url: string) =>
      loadMonth(gridMeta, month, url)
        .then((data) => arrive(grid, data))
        .catch((reason: unknown) => {
          console.error(reason)
          arrive(grid, null)
        })
    void fetchGrid('fine', meta, LIGHT_URLS.month(month))
    const wider = withWide ? wideGrid(meta) : null
    if (wider) void fetchGrid('wide', wider, LIGHT_URLS.wideMonth(month))
    return () => {
      current = false
    }
  }, [meta, month, has, withWide, withMonths])

  if (meta === null || (meta && !has)) return { meta, month: null, wideMeta: null, wide: null, status: 'missing' }
  const mine = loaded?.month === month ? loaded : null
  const wide = mine?.wide ?? null
  if (!meta || mine?.fine === undefined) return { meta, month: null, wideMeta, wide, status: 'loading' }
  return { meta, month: mine.fine, wideMeta, wide, status: mine.fine ? 'ready' : 'missing' }
}
