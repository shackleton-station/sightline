import { useEffect, useRef } from 'react'
import { loadPart } from '../data/staleBuild'
import type { LightMeta, LightMonth } from '../lib/lightGrid'
import { latLonOf, type Vec3 } from '../lib/polarCamera'
import type { GlobeFrame, GlobeViewer } from '../three/GlobeViewer'
import type { LightView } from '../three/lightLayer'
import { LIGHT_URLS } from './useLightGrid'

const MAPS = `${import.meta.env.BASE_URL}data/maps/`

interface Props {
  /** The point in the middle of the view and the way up the screen, as MOON_ME unit vectors. */
  center: Vec3
  up: Vec3
  zoom: number
  /** Unit vector toward the Sun in MOON_ME, from the pipeline; null lights the globe evenly. */
  sun: [number, number, number] | null
  /** The hour on screen, counted from the start of the month. */
  hour: number
  layer: LightView
  /** The light grid's description, or null when this build has none. */
  meta: LightMeta | null
  /** The month of the fine grid to draw, once it has arrived, and of the wide grid around it. */
  month: LightMonth | null
  wide: LightMonth | null
  /** The part of the canvas inside the stage, as shares of its width and height from the top-left. */
  visible: { left: number; top: number; right: number; bottom: number }
  onSize: (px: number) => void
  onLost: () => void
}

/** What the pipeline wrote about the globe's own slope maps. */
interface SlopesFile {
  slope_max: number
  pole: { half_width_m: number; x_axis_lon_deg: number; y_axis_lon_deg: number; radius_m: number }
}

function frameOf({ center, up, zoom, sun, hour, layer, visible }: Pick<Props, 'center' | 'up' | 'zoom' | 'sun' | 'hour' | 'layer' | 'visible'>): GlobeFrame {
  return { view: latLonOf(center), up, zoom, sun, light: { hour, view: layer }, visible }
}

/**
 * The Atlas's one picture: the globe, with the light grid drawn on the polar ground. Built once;
 * after that a new view, hour or layer only changes numbers, and a new month replaces three textures.
 */
export function AtlasCanvas(props: Props) {
  const { meta, month, wide, onSize, onLost } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<GlobeViewer | null>(null)
  const latest = useRef({ frame: frameOf(props), month, wide, onSize, onLost })
  useEffect(() => {
    latest.current = { frame: frameOf(props), month, wide, onSize, onLost }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const lost = () => latest.current.onLost()
    const slopes = fetch(`${MAPS}slopes.json`)
      .then((response) => (response.ok ? (response.json() as Promise<SlopesFile>) : null))
      .catch(() => null)
    Promise.all([loadPart(() => import('../three/GlobeViewer')), slopes])
      .then(([{ GlobeViewer }, file]) => {
        if (cancelled) return
        if (typeof WebGL2RenderingContext === 'undefined') throw new Error('WebGL2 is not available')
        const viewer = new GlobeViewer({
          canvas,
          reliefUrl: `${MAPS}moon.png`,
          colorUrls: [`${MAPS}moon_color.jpg`, `${MAPS}moon_color_4k.jpg`],
          onLost: lost,
          slopes: file && {
            moon: [`${MAPS}moon_slope_e.jpg`, `${MAPS}moon_slope_n.jpg`],
            pole: [`${MAPS}pole_slope_x.jpg`, `${MAPS}pole_slope_y.jpg`],
            slopeMax: file.slope_max,
            poleHalfWidthM: file.pole.half_width_m,
            radiusM: file.pole.radius_m,
            poleXLonDeg: file.pole.x_axis_lon_deg,
            poleYLonDeg: file.pole.y_axis_lon_deg,
          },
          light: meta && {
            size: meta.size,
            halfWidthM: meta.half_width_m,
            radiusM: meta.radius_m,
            xLonDeg: meta.x_axis_lon_deg,
            yLonDeg: meta.y_axis_lon_deg,
            slopeUrls: LIGHT_URLS.slopes,
            wide: meta.wide ? { size: meta.wide.size, halfWidthM: meta.wide.half_width_m } : null,
          },
        })
        viewerRef.current = viewer
        const { month: ready, wide: readyWide, frame } = latest.current
        if (ready) viewer.setLightMonth(ready)
        if (readyWide) viewer.setLightMonth(readyWide, 'wide')
        viewer.draw(frame)
      })
      .catch(() => {
        if (!cancelled) lost()
      })
    const resize = new ResizeObserver(() => {
      latest.current.onSize(canvas.clientWidth)
      viewerRef.current?.draw(latest.current.frame)
    })
    resize.observe(canvas)
    return () => {
      cancelled = true
      resize.disconnect()
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [meta])

  useEffect(() => {
    viewerRef.current?.setLightMonth(month)
  }, [month])
  useEffect(() => {
    viewerRef.current?.setLightMonth(wide, 'wide')
  }, [wide])

  const { center, up, zoom, sun, hour, layer, visible } = props
  const [centerX, centerY, centerZ] = center
  const [upX, upY, upZ] = up
  const [sunX, sunY, sunZ] = sun ?? [Number.NaN, Number.NaN, Number.NaN]
  useEffect(() => {
    viewerRef.current?.draw(latest.current.frame)
  }, [centerX, centerY, centerZ, upX, upY, upZ, zoom, sunX, sunY, sunZ, hour, layer, month, wide, visible.left, visible.top, visible.right, visible.bottom])

  return <canvas ref={canvasRef} />
}
