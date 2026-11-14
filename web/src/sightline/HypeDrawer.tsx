import { useEffect, useRef } from 'react'

const MEDIA = `${import.meta.env.BASE_URL}media/`

/**
 * The easter egg's panel: the team's hype video, and nothing else. It is a panel like Scout's or
 * Compare's, on the right, so the Moon moves aside for it and nothing lies over the Moon. It is
 * opened by a key press or a click, so a browser may let the video start with its sound; where it
 * will not, or the visitor has asked for less motion, the poster and the player's own controls are
 * there. The video is AI-generated, and the one line under it says so.
 */
export function HypeDrawer({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    void video.current?.play().catch(() => {})
  }, [])
  return (
    <aside className="sl-drawer sl-hype" aria-label="Hype">
      <header className="sl-drawer-head">
        <h2>Hype</h2>
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      <video ref={video} className="sl-hype-video" controls playsInline loop preload="metadata" poster={`${MEDIA}hype-poster.jpg`} aria-label="A short hype video: a room full of people cheering as one of them raises a glass">
        <source src={`${MEDIA}hype.mp4`} type="video/mp4" />
      </video>
      <p className="sl-quiet sl-hype-note">AI-generated video, just for fun.</p>
    </aside>
  )
}
