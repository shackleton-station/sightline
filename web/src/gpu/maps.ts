import type { TrackPoint } from '../data/contract'
import type { Vec3 } from '../lib/polarCamera'
import type { GlobeMaps } from './compare'

const DATA = `${import.meta.env.BASE_URL}data/`
const MAPS = `${DATA}maps/`
/** The month of hourly Sun directions the globes are lit by, from the pipeline. */
const SUN_TRACK = `${DATA}shackleton-rim/2027-01/track.json`

/** What the pipeline wrote about its slope maps (`pipeline/scripts/make_slope_maps.py`). */
interface SlopesFile {
  slope_max: number
  pole: { half_width_m: number; x_axis_lon_deg: number; y_axis_lon_deg: number; radius_m: number }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/** Everything the front page's globe is drawn from: relief, both color maps and the terrain slopes. */
export async function loadMaps(): Promise<GlobeMaps> {
  const file = await getJson<SlopesFile>(`${MAPS}slopes.json`)
  return {
    reliefUrl: `${MAPS}moon.png`,
    colorUrls: [`${MAPS}moon_color.jpg`, `${MAPS}moon_color_4k.jpg`],
    slopes: {
      moon: [`${MAPS}moon_slope_e.jpg`, `${MAPS}moon_slope_n.jpg`],
      pole: [`${MAPS}pole_slope_x.jpg`, `${MAPS}pole_slope_y.jpg`],
      slopeMax: file.slope_max,
      poleHalfWidthM: file.pole.half_width_m,
      radiusM: file.pole.radius_m,
      poleXLonDeg: file.pole.x_axis_lon_deg,
      poleYLonDeg: file.pole.y_axis_lon_deg,
    },
  }
}

/** The Sun's direction in MOON_ME for every hour of the month. */
export async function loadSuns(): Promise<Vec3[]> {
  const track = await getJson<TrackPoint[]>(SUN_TRACK)
  return track.map((hour) => hour.sun_vec_me)
}
