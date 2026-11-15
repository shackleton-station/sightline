import { useEffect, useState } from 'react'
import type { HorizonPoint, SiteInfo } from '../data/contract'
import { loadYearPositions } from '../data/customSite'
import { gapsAt, loadLightMeta, patchGapsAt, slopePartFor, wideGapsAt } from '../data/loadMissionGrid'
import { ACCURACY_RANGE, DEFAULT_SPREAD, readSpreadLink, type Spread } from '../lib/landingOdds'
import { wideGrid } from '../lib/lightGrid'
import type { Requirements } from '../lib/mission'
import { fieldOf, fitMapAround, fitMapInPatch, oddsAlongBearings, oddsAt, oddsColor, oddsField, patchHolding, squareAround } from '../lib/missionGrid'
import { smoothMoonFit, washPixel } from '../lib/moonWash'
import { DEFAULT_MAX_SLOPE_DEG } from '../lib/sightlineMission'
import type { GroundTint } from '../three/SurfaceViewer'
import { EXAMPLE_LIMITS, readAddress } from './address'

/** How far the ground is read around the site (m), as Sightline's own panel reads it. */
const REACH_M = ACCURACY_RANGE.max * 2
/** The ground a point of the skyline stands for: from this far out to this far, along its bearing (m). */
const RIM_FROM_M = 150
const RIM_TO_M = 1500
/** How much of the land's own dark shape the tint replaces. */
const TINT_AMOUNT = 0.5

/** What a link says about the "Mission success probability" layer: whether it is on, and the landing and mission it is for. */
export interface TintLink {
  month: string
  index: number
  requirements: Requirements
  maxSlopeDeg: number
  spread: Spread
}

/** The layer a link asks for (`&odds=1`, as Sightline's Surface view sends it); null if it asks for none. */
export function readTintLink(hash: string): TintLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const address = readAddress(hash)
  if (params.get('odds') !== '1' || !address) return null
  const slope = Number(params.get('slope') ?? DEFAULT_MAX_SLOPE_DEG)
  return {
    month: address.month,
    index: address.index,
    requirements: address.kept.requirements ?? EXAMPLE_LIMITS,
    maxSlopeDeg: Number.isFinite(slope) ? slope : DEFAULT_MAX_SLOPE_DEG,
    spread: readSpreadLink(hash) ?? DEFAULT_SPREAD,
  }
}

/** The odds underfoot and out toward each point of the horizon, each 0 to 1. */
async function oddsAround(link: TintLink, site: SiteInfo, horizon: HorizonPoint[]): Promise<{ under: number; rim: number[] } | null> {
  const { requirements, spread } = link
  const meta = await loadLightMeta()
  const square = meta ? squareAround(meta, site.lat, site.lon, REACH_M) : null
  if (meta && square) {
    // Inside the light grid: the terrain's own light and slope, for a lander this accurate.
    const [gaps, slope] = await Promise.all([gapsAt(meta, link.month, link.index, requirements.missionDays), slopePartFor(meta, square)])
    if (gaps === 'past') return null
    // Round a ridge site the ground is known at the terrain's own 20 m: the patch's pixels, not the grid's cells.
    const held = patchHolding(meta, square)
    const fine = held ? await patchGapsAt(meta, held.site, link.month, link.index, requirements.missionDays) : null
    const map = held && fine && fine !== 'past' ? fitMapInPatch(meta, held.patch, fine, square, site.lat, site.lon, requirements, link.maxSlopeDeg, slope) : fitMapAround(meta, gaps, square, site.lat, site.lon, requirements, link.maxSlopeDeg, slope)
    // Blurred by the lander's own spread and no more, as the picture on the Moon is.
    const odds = oddsField(fieldOf(map), map.size, map.cellM, spread)
    const under = oddsAt(map, odds, 0, 0) ?? 0
    const rim = oddsAlongBearings(map, odds, site.lon, horizon.map((point) => point.az), RIM_FROM_M, RIM_TO_M)
    return { under, rim: rim.map((value) => value ?? under) }
  }
  // Past the fine grid, where the wide one reaches: the terrain's own light on its larger cells. There are no slope images of that ground.
  const wide = meta ? wideGrid(meta) : null
  const wideSquare = wide ? squareAround(wide, site.lat, site.lon, REACH_M) : null
  const wideGaps = meta && wide && wideSquare ? await wideGapsAt(meta, link.month, link.index, requirements.missionDays) : null
  if (wide && wideSquare && wideGaps) {
    if (wideGaps === 'past') return null
    const map = fitMapAround(wide, wideGaps, wideSquare, site.lat, site.lon, requirements, link.maxSlopeDeg, null)
    const odds = oddsField(fieldOf(map), map.size, map.cellM, spread)
    const under = oddsAt(map, odds, 0, 0) ?? 0
    const rim = oddsAlongBearings(map, odds, site.lon, horizon.map((point) => point.az), RIM_FROM_M, RIM_TO_M)
    return { under, rim: rim.map((value) => value ?? under) }
  }
  // Elsewhere: the smooth Moon, which is the same in every direction at this scale.
  const year = Number(link.month.slice(0, 4))
  const hour = (Date.parse(`${link.month}-01T00:00:00Z`) - Date.UTC(year, 0, 1)) / 3_600_000 + link.index
  const fit = smoothMoonFit(await loadYearPositions(year), hour, requirements)
  if (!fit) return null
  const under = fit[washPixel(site.lat, site.lon)]
  return { under, rim: horizon.map(() => under) }
}

/**
 * The land's tint for the "Mission success probability" layer: underfoot, the odds that a landing
 * here fits the mission; along the skyline, the odds out that way. Null while the layer is off or
 * its data is on the way.
 */
export function useGroundTint(link: TintLink | null, site: SiteInfo | null, horizon: HorizonPoint[] | null): GroundTint | null {
  const [tint, setTint] = useState<{ key: string; tint: GroundTint | null } | null>(null)
  const key = link && site ? `${site.id}@${link.month}+${link.index}/${JSON.stringify([link.requirements, link.maxSlopeDeg, link.spread])}` : null
  useEffect(() => {
    if (!link || !site || !horizon || !key) return
    let current = true
    oddsAround(link, site, horizon)
      .then((odds) => {
        if (!current) return
        setTint({ key, tint: odds ? { under: oddsColor(odds.under), rim: odds.rim.map((value) => oddsColor(value)), amount: TINT_AMOUNT } : null })
      })
      // Without it the land keeps its own dark shape.
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
    // The key names the site, the landing, the mission and the spread: the same key is the same tint.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, horizon])
  return key && tint?.key === key ? tint.tint : null
}
