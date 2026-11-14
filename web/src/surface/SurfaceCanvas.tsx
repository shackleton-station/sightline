import { useEffect, useRef } from 'react'
import type { HorizonPoint } from '../data/contract'
import { loadPart } from '../data/staleBuild'
import type { SurfaceFrame, SurfaceViewer } from '../three/SurfaceViewer'

interface Props {
  horizon: HorizonPoint[]
  /** The site's latitude, for which way up Earth is drawn. */
  latDeg: number
  frame: SurfaceFrame
  /** The graphics could not start, or the browser took them away. */
  onLost: () => void
}

declare global {
  interface Window {
    /** The Surface view's last draw time, for scripts/surface-shots.mjs. */
    __surfaceDrawMs?: () => number
  }
}

/**
 * The picture itself: the Three.js view, built once. After that a new horizon replaces one small
 * mesh, and a new look or hour only changes numbers.
 */
export function SurfaceCanvas({ horizon, latDeg, frame, onLost }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SurfaceViewer | null>(null)
  const latest = useRef({ horizon, latDeg, frame, onLost })
  useEffect(() => {
    latest.current = { horizon, latDeg, frame, onLost }
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
        window.__surfaceDrawMs = () => viewer.lastDrawMs
        viewer.setHorizon(latest.current.horizon)
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
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    viewerRef.current?.setHorizon(horizon)
  }, [horizon])
  useEffect(() => {
    viewerRef.current?.setLatitude(latDeg)
  }, [latDeg])
  useEffect(() => {
    viewerRef.current?.draw(frame)
  }, [frame])

  return <canvas ref={canvasRef} className="sf-canvas" />
}
