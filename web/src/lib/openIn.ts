/**
 * Addresses that open a point on the Moon in NASA's own map tools, for the site on show.
 *
 * Both forms were worked out from the tools themselves on 2026-11-13 and checked by loading them
 * at every listed site:
 * - Quickmap (quickmap.lroc.im-ldi.com) takes a view as `prjExtent=minx,miny,maxx,maxy` in metres of
 *   one of its own projections, named by number in `proj`. Its list (`/maps/lroc`, `projectionsById`)
 *   gives 16 as the flat map (`+proj=eqc`) and 17 as the south pole seen from above (`+proj=ortho`,
 *   `lat_0=-90`), both on a sphere of 1,737,400 m. Loaded at all 13 listed sites, its own cursor
 *   readout at the centre gave each site's latitude and longitude. Its north-pole view (19) was not
 *   loaded, so the far north gets no link.
 * - Moon Trek (trek.nasa.gov/moon) takes `x`, `y` and a zoom in its address: degrees on its flat map,
 *   metres on its south-pole map (IAU2000:30120, polar stereographic). The south-pole map kept the
 *   point out to 158 km from the pole (IM-2) and went back to its whole-map view at 300 km (IM-1), so
 *   it is used only within 160 km. The flat map smears ground near a pole sideways, so past 75° of
 *   latitude, where neither view serves, there is no link.
 */

const MOON_RADIUS_M = 1_737_400
const RAD = Math.PI / 180
/** South of this latitude Quickmap's view from above the south pole is used in place of its flat map. */
const QUICKMAP_POLAR_FROM_DEG = -60
/** Past this latitude a flat map stretches the ground more than about four times sideways. */
const FLAT_MAP_TO_DEG = 75
/** Moon Trek's south-pole map takes a point this far from the pole (checked to 158 km). */
const TREK_POLAR_REACH_M = 160_000
/** Half the width of ground Quickmap opens on: 20 km each way, about 50 m a pixel on a laptop. */
const QUICKMAP_HALF_M = 20_000

/** A point in the metres of one of Quickmap's projections, or null where no checked view shows it well. */
export function quickmapPoint(lat: number, lon: number): { proj: 16 | 17; x: number; y: number } | null {
  if (lat <= QUICKMAP_POLAR_FROM_DEG) {
    // Seen from above the south pole: the distance from the pole is R cos(lat), and longitude 0 points up.
    const r = MOON_RADIUS_M * Math.cos(lat * RAD)
    return { proj: 17, x: r * Math.sin(lon * RAD), y: r * Math.cos(lon * RAD) }
  }
  if (lat > FLAT_MAP_TO_DEG) return null
  return { proj: 16, x: MOON_RADIUS_M * lon * RAD, y: MOON_RADIUS_M * lat * RAD }
}

/** Quickmap, opened on 40 km of ground around the point. `lon` is east-positive, -180 to 180. */
export function quickmapUrl(lat: number, lon: number): string | null {
  const point = quickmapPoint(lat, lon)
  if (!point) return null
  const { proj, x, y } = point
  const extent = [x - QUICKMAP_HALF_M, y - QUICKMAP_HALF_M, x + QUICKMAP_HALF_M, y + QUICKMAP_HALF_M].map((metres) => metres.toFixed(0)).join(',')
  return `https://quickmap.lroc.im-ldi.com/?prjExtent=${encodeURIComponent(extent)}&proj=${proj}`
}

/** Moon Trek, opened on the point: its south-pole map close to that pole, its flat map up to 75° of latitude. */
export function moonTrekUrl(lat: number, lon: number): string | null {
  // South polar stereographic, true at the pole: the distance from the pole is 2R tan(half the angle from it).
  const r = 2 * MOON_RADIUS_M * Math.tan(((90 + lat) / 2) * RAD)
  const view =
    r <= TREK_POLAR_REACH_M
      ? { x: (r * Math.sin(lon * RAD)).toFixed(0), y: (r * Math.cos(lon * RAD)).toFixed(0), z: 6, p: 'urn:ogc:def:crs:IAU2000::30120' }
      : Math.abs(lat) <= FLAT_MAP_TO_DEG
        ? { x: String(lon), y: String(lat), z: 8, p: 'urn:ogc:def:crs:EPSG::104903' }
        : null
  return view && `https://trek.nasa.gov/moon/#v=0.1&x=${view.x}&y=${view.y}&z=${view.z}&p=${encodeURIComponent(view.p)}&d=&locale=&b=moon`
}
