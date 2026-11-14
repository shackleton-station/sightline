import type { LightMeta, Spot } from '../lib/lightGrid'
import { rangeWords } from '../lib/lightGrid'

/** "89.31° S, 132.5° W", to the precision of one grid cell. */
export function placeWords(lat: number, lon: number): string {
  const ns = lat < 0 ? 'S' : 'N'
  const ew = lon < 0 ? 'W' : 'E'
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(1)}° ${ew}`
}

/** "2.4 km", or "400 m" under a kilometer. */
export function distanceWords(km: number): string {
  return km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`
}

/** What is up at a spot this hour, joining good and bad news the way the site pages do. */
export function nowWords(sunUp: boolean, earthUp: boolean): string {
  const sun = sunUp ? 'Sun in view' : 'Sun hidden'
  const earth = earthUp ? 'Earth in view' : 'Earth out of view'
  return `${sun}${sunUp === earthUp ? ',' : ', but'} ${earth}`
}

/**
 * A tapped spot's month, in words. Every number is counted from the grid's own hours for that
 * cell; where the cells around it differ, the range across them is given beside the number, because
 * a point a pixel away can be a different answer (docs/VALIDATION.md §11).
 */
export function spotWords(spot: Spot, hour: number, monthName: string, meta: LightMeta): string {
  const { numbers, nearby } = spot
  const pct = (value: number) => `${Math.round(value)}%`
  // The first range given says how far away the neighbours are; a second one needn't repeat it.
  let said = false
  const within = (key: 'pctSun' | 'pctEarth') => {
    const range = rangeWords(nearby[key])
    if (range === pct(numbers[key])) return ''
    const where = said ? '' : ` within ${meta.pixel_m} m`
    said = true
    return ` (${range}${where})`
  }
  const shown = Math.min(hour, spot.sun.length - 1)
  return (
    `Now: ${nowWords(spot.sun[shown] === 1, spot.earth[shown] === 1)}. ` +
    `${monthName}: Sun ${pct(numbers.pctSun)} of hours${within('pctSun')}, ` +
    `Earth ${pct(numbers.pctEarth)}${within('pctEarth')}, both ${pct(numbers.pctBoth)}, ` +
    `longest dark ${numbers.sunGapH} h.`
  )
}
