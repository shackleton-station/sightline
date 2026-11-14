import { useEffect, useRef } from 'react'
import type { HorizonPoint } from '../data/contract'
import { loadPart } from '../data/staleBuild'
import type { GroundTint, SurfaceFrame, SurfaceViewer } from '../three/SurfaceViewer'

interface Props {
  horizon: HorizonPoint[]
  /** A tint for the land from what is known about the ground, or none. */
  groundTint?: GroundTint | null
  /** The site's latitude, for which way up Earth is drawn. */
  latDeg: number
  frame: SurfaceFrame
  /** The graphics could not start, or the browser took them away. */
  onLost: () => void
}

declare global {
  interface Window {
    /** The Surface views' last draw time, all of them together, for scripts/surface-shots.mjs. */
    __surfaceDrawMs?: () => number
  }
}

/** Every view drawing now: two when the Sun's and Earth's are side by side. */
const drawing = new Set<SurfaceViewer>()

/**
 * The picture itself: the Three.js view, built once. After that a new horizon replaces one small
 * mesh, and a new look or hour only changes numbers.
 */
export function SurfaceCanvas({ horizon, groundTint = null, latDeg, frame, onLost }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SurfaceViewer | null>(null)
  const latest = useRef({ horizon, groundTint, latDeg, frame, onLost })
  useEffect(() => {
    latest.current = { horizon, groundTint, latDeg, frame, onLost }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const lost = (isLost: boolean) => {
      if (isLost) latest.current.onLost()
    }
    loadPart(() => import('../three/SurfaceViewer'))
      .then(({ SurfaceViewer }) => {
        if (cancelled) return
        if (typeof WebGL2RenderingContext === 'undefined') throw new Error('WebGL2 is not available')
        const viewer = new SurfaceViewer({ canvas, onLostChange: lost })
        viewerRef.current = viewer
        drawing.add(viewer)
        window.__surfaceDrawMs = () => [...drawing].reduce((total, each) => total + each.lastDrawMs, 0)
        viewer.setHorizon(latest.current.horizon, latest.current.groundTint)
        viewer.setLatitude(latest.current.latDeg)
        viewer.draw(latest.current.frame)
      })
      .catch(() => {
        if (!cancelled) latest.current.onLost()
      })
    const resize = new ResizeObserver(() => viewerRef.current?.draw(latest.current.frame))
    resize.observe(canvas)
    return () => {
      cancelled = true
      resize.disconnect()
      if (viewerRef.current) drawing.delete(viewerRef.current)
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    viewerRef.current?.setHorizon(horizon, groundTint)
  }, [horizon, groundTint])
  useEffect(() => {
    viewerRef.current?.setLatitude(latDeg)
  }, [latDeg])
  useEffect(() => {
    viewerRef.current?.draw(frame)
  }, [frame])

  return <canvas ref={canvasRef} className="sf-canvas" />
}
