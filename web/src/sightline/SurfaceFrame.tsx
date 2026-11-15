import { useEffect, useRef, useState } from 'react'
import { isSurfaceReady, SURFACE_SHOW, type SurfaceShow } from '../surface/address'

interface Props {
  /** Surface is the view on show. Otherwise the frame is kept out of sight, ready for the press. */
  visible: boolean
  /** The pointer or the keyboard is on the Surface button: load the frame now, not when the screen is next idle. */
  warm: boolean
  /** The app's own link for what to stand on: the site on show, at the hour on the time bar. */
  view: string
  /** The link of the landing the "Mission success probability" layer is for, or null while it is off. */
  tint: string | null
}

/** The frame is loaded once the screen has been idle, or this long after Plan opens at the latest. */
const LOAD_WITHIN_MS = 2500
/** Out of sight, the frame is told a new site or hour only once it has stopped changing: a month played in Orbit draws nothing here. */
const SETTLED_MS = 400

/**
 * Standing at the site: the app's own Surface page, in a frame over the stage. It is loaded ahead of
 * the press (when the screen is idle, or as soon as the Surface button is pointed at) and kept when
 * the view goes back to Orbit or Site, so pressing Surface only uncovers a picture that is already
 * drawn. The frame has no time bar of its own: this screen's bar says the hour, in a message, so a
 * played month never reloads it. Out of sight it draws nothing unless the site or hour settles on a
 * new one.
 */
export function SurfaceFrame({ visible, warm, view, tint }: Props) {
  // The address the frame is loaded with, once: after that it is told what to show.
  const [src, setSrc] = useState<string | null>(null)
  if ((visible || warm) && src === null) setSrc(view)
  const latest = useRef(view)
  useEffect(() => {
    latest.current = view
  })
  useEffect(() => {
    if (src !== null) return
    const load = () => setSrc((current) => current ?? latest.current)
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(load, { timeout: LOAD_WITHIN_MS })
      return () => window.cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(load, LOAD_WITHIN_MS)
    return () => window.clearTimeout(timer)
  }, [src])

  const frame = useRef<HTMLIFrameElement>(null)
  // Counts each time the page inside says it is listening (again after a reload of its own).
  const [listening, setListening] = useState(0)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      if (isSurfaceReady(event.data)) setListening((count) => count + 1)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  useEffect(() => {
    if (listening === 0) return
    const send = () => frame.current?.contentWindow?.postMessage({ type: SURFACE_SHOW, view, tint } satisfies SurfaceShow, window.location.origin)
    if (visible) {
      send()
      return
    }
    const timer = window.setTimeout(send, SETTLED_MS)
    return () => window.clearTimeout(timer)
  }, [listening, visible, view, tint])

  if (src === null) return null
  return <iframe ref={frame} className={visible ? 'sl-surface' : 'sl-surface is-away'} title="Standing at the site, looking around" aria-hidden={!visible} tabIndex={visible ? undefined : -1} src={`/surface/${src}`} />
}
