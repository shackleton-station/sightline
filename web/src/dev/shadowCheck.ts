/**
 * The page behind `scripts/shadow-check.mjs`: does the 3D view draw sunlight and shadow where the
 * terrain says they are? (docs/VALIDATION.md §8.) It isn't part of the built site.
 *
 * For each site and hour it draws the app's own TerrainViewer looking straight down, then for random
 * ground points it (1) decides lit or shadowed by stepping along the line to the Sun through the
 * LOLA heights, and (2) reads the pixel drawn there. It sends every point back to the script, which
 * does the counting.
 */
import type { SiteInfo, TrackPoint } from '../data/contract'
import { loadDrawingTerrain } from '../data/customSite'
import { toScreen, type Vec3 } from '../lib/camera3d'
import { enuBasis, type Terrain } from '../lib/customModel'
import { toLocalDirection } from '../lib/moon3d'
import { buildSiteLevels, type MeshLevel } from '../lib/terrainMesh'
import { TerrainViewer } from '../three/TerrainViewer'

// The terrain levels the app draws. Copied from components/MoonView3D.tsx; the script stops if they differ.
const LEVELS: MeshLevel[] = [
  { halfM: 8_000, stepM: 20 },
  { halfM: 40_000, stepM: 100 },
  { halfM: 250_000, stepM: 1_000 },
]
const LEVELS_SMALL: MeshLevel[] = [
  { halfM: 4_000, stepM: 40 },
  { halfM: 30_000, stepM: 200 },
  { halfM: 200_000, stepM: 2_000 },
]

const MOON_RADIUS_M = 1_737_400
const RAD = Math.PI / 180
const MONTH = '2027-05'
const POINTS_PER_HOUR = 250
const SAMPLE_RADIUS_M = 7_500
/** High enough that the viewer's 50° lens sees the whole sample circle, with room for hills. */
const CAMERA_HEIGHT_M = 20_000
/** The Sun's angular radius, as the viewer draws it. */
const SUN_RADIUS_DEG = 0.267
/** Slopes are measured over the finest mesh step. */
const SLOPE_BASELINE_M = 20
/** Steps along the line to the Sun: [from, to, step] in meters. Fine tiles reach about 40 km. */
const STEPS_M: [number, number, number][] = [
  [20, 40_000, 20],
  [40_200, 250_000, 200],
]
/** Hours are picked where the Sun's center is above this, so some ground can be lit. */
const MIN_SUN_EL_DEG = -3
const LOW_SUN_DEG = [2, 6]
/** The model's numbers are for a point this far above the ground; it is compared every this many hours. */
const MODEL_HEIGHT_M = 2
const MODEL_EVERY_H = 6

type Truth = 'lit' | 'shadow' | 'cut' | 'away'
type Rgb = [number, number, number]
/** The highest the terrain stands against the line to the Sun's center, and how far along the line. */
interface Rise {
  deg: number
  atM: number
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2])
  return [a[0] / length, a[1] / length, a[2] / length]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** Turn a direction about the local vertical: positive is clockwise seen from above, like azimuth. */
function turned([e, n, u]: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * RAD)
  const s = Math.sin(deg * RAD)
  return [e * c + n * s, n * c - e * s, u]
}

/** A small seeded random generator (mulberry32), so a rerun picks the same points. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The LOLA heights around one site. Points are east, north, up in meters from the site's ground. */
class Ground {
  private readonly terrain: Terrain
  private readonly basis: { east: Vec3; north: Vec3; up: Vec3 }
  private readonly siteRadiusM: number

  constructor(terrain: Terrain, latDeg: number, lonDeg: number) {
    this.terrain = terrain
    this.basis = enuBasis(latDeg, lonDeg)
    this.siteRadiusM = MOON_RADIUS_M + terrain.surfaceHeight(latDeg, lonDeg)
  }

  /** How far the ground stands above a point (m, negative when the point is in the open), and which way is up there. */
  under(point: Vec3): { groundAboveM: number; up: Vec3 } {
    const { east, north, up } = this.basis
    const fromCenter: Vec3 = [point[0], point[1], point[2] + this.siteRadiusM]
    const radiusM = Math.hypot(...fromCenter)
    const x = fromCenter[0] * east[0] + fromCenter[1] * north[0] + fromCenter[2] * up[0]
    const y = fromCenter[0] * east[1] + fromCenter[1] * north[1] + fromCenter[2] * up[1]
    const z = fromCenter[0] * east[2] + fromCenter[1] * north[2] + fromCenter[2] * up[2]
    const heightM = this.terrain.surfaceHeight(Math.asin(z / radiusM) / RAD, Math.atan2(y, x) / RAD)
    return {
      groundAboveM: MOON_RADIUS_M + heightM - radiusM,
      up: [fromCenter[0] / radiusM, fromCenter[1] / radiusM, fromCenter[2] / radiusM],
    }
  }

  /** The ground point on the line from the Moon's center through this offset on the plane touching the site. */
  at(eastM: number, northM: number): Vec3 {
    const { groundAboveM } = this.under([eastM, northM, 0])
    const planeRadiusM = Math.hypot(eastM, northM, this.siteRadiusM)
    const scale = (planeRadiusM + groundAboveM) / planeRadiusM
    return [eastM * scale, northM * scale, this.siteRadiusM * (scale - 1)]
  }

  /** The upward normal of the ground at this offset. */
  normal(eastM: number, northM: number): Vec3 {
    const h = SLOPE_BASELINE_M / 2
    const eastward = minus(this.at(eastM + h, northM), this.at(eastM - h, northM))
    const northward = minus(this.at(eastM, northM + h), this.at(eastM, northM - h))
    return unit(cross(eastward, northward))
  }

  /**
   * How far the terrain rises above the line from a point to the Sun's center, as an angle seen from
   * that point (degrees; negative when the terrain stays below the line), and how far along the line
   * that is. It looks as far as the view's terrain reaches (250 km).
   */
  riseAboveSunLine(from: Vec3, toSun: Vec3): Rise {
    const upHere = this.under(from).up
    const along = dot(upHere, toSun)
    // "Up" across the line of sight: the way terrain climbs to cover the Sun.
    const across = unit([upHere[0] - along * toSun[0], upHere[1] - along * toSun[1], upHere[2] - along * toSun[2]])
    const worst: Rise = { deg: -90, atM: 0 }
    for (const [startM, endM, stepM] of STEPS_M) {
      for (let t = startM; t <= endM; t += stepM) {
        const { groundAboveM, up } = this.under([
          from[0] + t * toSun[0],
          from[1] + t * toSun[1],
          from[2] + t * toSun[2],
        ])
        const deg = Math.atan2(groundAboveM * dot(up, across), t + groundAboveM * dot(up, toSun)) / RAD
        if (deg > worst.deg) {
          worst.deg = deg
          worst.atM = t
        }
      }
    }
    return worst
  }
}

/**
 * Which hours of the month to test at a site: four spread through the hours with the Sun near or
 * above level, plus the first and last hours with a low Sun (long shadows), where there are any.
 */
function pickHours(track: TrackPoint[]): number[] {
  const usable = track.flatMap((point, i) => (point.sun_el > MIN_SUN_EL_DEG ? [i] : []))
  const spread = usable.length > 0 ? [1, 3, 5, 7].map((eighths) => usable[Math.floor((usable.length * eighths) / 8)]) : []
  const low = track.flatMap((point, i) => (point.sun_el >= LOW_SUN_DEG[0] && point.sun_el <= LOW_SUN_DEG[1] ? [i] : []))
  return [...new Set([...spread, ...low.slice(0, 1), ...low.slice(-1)])].sort((a, b) => a - b)
}

const status = (text: string) => {
  const line = document.getElementById('status')
  if (line) line.textContent = text
}

const send = (path: string, body: unknown) =>
  fetch(`/__shadow-check/${path}`, { method: 'POST', body: JSON.stringify(body) })

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/data/${path}`)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const small = params.get('small') === '1'
  const only = params.get('sites')?.split(',')
  const canvas = document.getElementById('view') as HTMLCanvasElement
  const copy = document.createElement('canvas')
  const pen = copy.getContext('2d', { willReadFrequently: true })
  if (!pen) throw new Error('no 2D canvas')

  const viewer = new TerrainViewer({ canvas, small, onLostChange: (lost) => lost && status('WebGL context lost') })
  const gl = canvas.getContext('webgl2')
  const info = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown'

  /** Draw one frame with this Sun and read it back in the same screen refresh, while the picture is still there. */
  const drawn = (toSun: Vec3): Promise<ImageData> =>
    new Promise((resolve) => {
      viewer.draw({
        pose: { eye: [0, 0, CAMERA_HEIGHT_M], forward: [0, 0, -1] },
        toSun,
        // Earth's marker is kept under the ground, out of the picture. It doesn't light the terrain.
        toEarth: [0, 0, -1],
        aboveGroundM: CAMERA_HEIGHT_M,
        fromAbove: true,
      })
      // The viewer draws on the next refresh; this runs straight after it.
      requestAnimationFrame(() => {
        copy.width = canvas.width
        copy.height = canvas.height
        pen.drawImage(canvas, 0, 0)
        resolve(pen.getImageData(0, 0, copy.width, copy.height))
      })
    })

  const sites = (await getJson<SiteInfo[]>('sites.json')).filter((site) => !only || only.includes(site.id))
  const levels = small ? LEVELS_SMALL : LEVELS
  const hours: unknown[] = []
  const modelHours: unknown[] = []
  const random = seeded(20261112)

  for (const site of sites) {
    status(`${site.id}: loading terrain`)
    const track = await getJson<TrackPoint[]>(`${site.id}/${MONTH}/track.json`)
    const terrain = await loadDrawingTerrain(site.lat, site.lon, levels[1].halfM)
    const built = buildSiteLevels((lat, lon) => terrain.surfaceHeight(lat, lon), site.lat, site.lon, levels)
    viewer.setTerrain(built.levels)
    // The terrain's own answer always uses the fine tiles the large setting loads, so both settings are judged alike.
    const fineTerrain = small ? await loadDrawingTerrain(site.lat, site.lon, LEVELS[1].halfM) : terrain
    const ground = new Ground(fineTerrain, site.lat, site.lon)

    // The stepping itself against our model: where is the Sun from 2 m above the site, every 6th hour?
    for (const point of track.filter((_, i) => i % MODEL_EVERY_H === 0)) {
      const toSun = unit(toLocalDirection(point.sun_vec_me, site.lat, site.lon))
      const rise = ground.riseAboveSunLine([0, 0, MODEL_HEIGHT_M], toSun)
      modelHours.push({ site: site.id, t: point.t, sun_frac: point.sun_frac, rise_deg: Number(rise.deg.toFixed(3)) })
    }

    for (const hour of pickHours(track)) {
      const now = track[hour]
      status(`${site.id} ${now.t}`)
      const toSun = unit(toLocalDirection(now.sun_vec_me, site.lat, site.lon))
      // With the Sun straight below, no ground gets sunlight: this is every pixel's unlit color.
      const unlit = await drawn([0, 0, -1])
      // The real Sun, and two wrong ones as a control: turned 90° and 180° about the vertical.
      const suns = [toSun, turned(toSun, 90), turned(toSun, 180)]
      const frames = [await drawn(suns[0]), await drawn(suns[1]), await drawn(suns[2])]
      const pixel = (image: ImageData, at: { x: number; y: number }): Rgb => {
        const i = (Math.floor(at.y) * image.width + Math.floor(at.x)) * 4
        return [image.data[i], image.data[i + 1], image.data[i + 2]]
      }

      const points: unknown[] = []
      for (let k = 0; k < POINTS_PER_HOUR; k += 1) {
        // Uniform over the circle.
        const radiusM = SAMPLE_RADIUS_M * Math.sqrt(random())
        const angle = 2 * Math.PI * random()
        const [eastM, northM] = [radiusM * Math.sin(angle), radiusM * Math.cos(angle)]
        const where = ground.at(eastM, northM)
        const normal = ground.normal(eastM, northM)
        const facing = dot(normal, toSun)
        let truth: Truth = 'away'
        let rise: Rise | null = null
        if (facing > 0) {
          rise = ground.riseAboveSunLine(where, toSun)
          truth = rise.deg > SUN_RADIUS_DEG ? 'shadow' : rise.deg < -SUN_RADIUS_DEG ? 'lit' : 'cut'
        }
        const at = toScreen(viewer.viewProjection, where, canvas.width, canvas.height)
        if (!at || at.x < 0 || at.y < 0 || at.x >= canvas.width || at.y >= canvas.height) {
          throw new Error(`${site.id}: a sample point fell outside the picture`)
        }
        points.push({
          east_m: Math.round(eastM),
          north_m: Math.round(northM),
          truth,
          rise_deg: rise && Number(rise.deg.toFixed(3)),
          rise_at_m: rise && rise.atM,
          unlit: pixel(unlit, at),
          // For the real Sun, then turned 90° and 180°: how squarely the ground faces it (the cosine), and the pixel.
          facing: suns.map((sun) => Number(dot(normal, sun).toFixed(4))),
          drawn: frames.map((frame) => pixel(frame, at)),
        })
      }
      hours.push({ site: site.id, t: now.t, sun_az: now.sun_az, sun_el: now.sun_el, points })
      await send('log', `${site.id} ${now.t} Sun ${now.sun_el}° above level`)
    }
  }

  await send('result', {
    small,
    gpu,
    user_agent: navigator.userAgent,
    canvas_px: [canvas.width, canvas.height],
    device_pixel_ratio: window.devicePixelRatio,
    camera_height_m: CAMERA_HEIGHT_M,
    sample_radius_m: SAMPLE_RADIUS_M,
    sun_radius_deg: SUN_RADIUS_DEG,
    month: MONTH,
    hours,
    model_hours: modelHours,
  })
  status('Done')
}

run().catch((reason: unknown) => {
  status(`Failed: ${String(reason)}`)
  void send('error', String(reason))
})
