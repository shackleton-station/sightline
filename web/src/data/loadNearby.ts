import { decodeNearbyMonth, type NearbyMonth } from '../lib/nearby'
import type { NearbyMeta } from './contract'
import { bytes, gunzip } from './customSite'

const dir = (siteId: string) => `${import.meta.env.BASE_URL}data/nearby/${siteId}`

const requests = new Map<string, Promise<unknown>>()

/** Fetch once; repeat requests share the result, and a failed request can be retried. */
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = requests.get(key)
  if (cached) return cached as Promise<T>
  const request = load()
  request.catch(() => requests.delete(key))
  requests.set(key, request)
  return request
}

function loadMeta(siteId: string): Promise<NearbyMeta> {
  return once(`${siteId}/meta`, async () => {
    const response = await fetch(`${dir(siteId)}/meta.json`)
    if (!response.ok) throw new Error(`nearby meta: HTTP ${response.status}`)
    return response.json() as Promise<NearbyMeta>
  })
}

function loadSlope(siteId: string): Promise<Uint8Array> {
  return once(`${siteId}/slope`, async () => {
    return new Uint8Array(await gunzip(await bytes(`${dir(siteId)}/slope.bin.gz`)))
  })
}

function loadMonth(siteId: string, month: string, size: number): Promise<NearbyMonth> {
  return once(`${siteId}/${month}`, async () => {
    return decodeNearbyMonth(await gunzip(await bytes(`${dir(siteId)}/${month}.bin.gz`)), size)
  })
}

export interface NearbyData {
  siteId: string
  month: string
  meta: NearbyMeta
  slope: Uint8Array
  values: NearbyMonth
}

/** Everything a nearby map needs, fetched only when it's opened: about 30 KB. */
export async function loadNearby(siteId: string, month: string): Promise<NearbyData> {
  const meta = await loadMeta(siteId)
  const [slope, values] = await Promise.all([loadSlope(siteId), loadMonth(siteId, month, meta.size)])
  return { siteId, month, meta, slope, values }
}
