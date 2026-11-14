import { useEffect, useRef, useState } from 'react'
import { SiteTabs } from '../components/SiteTabs'

const MEDIA = `${import.meta.env.BASE_URL}media/`

/**
 * The team's hype video. Opening the page starts it with sound where the browser allows that
 * (Chrome does when you arrive by clicking the tab). Where it doesn't (Safari, phones, a pasted
 * link), the video starts silent and the first tap, click or key anywhere turns the sound on.
 * Nothing here is data: it is for fun, and the video is AI-generated and says so.
 */
export function HypePage() {
  const video = useRef<HTMLVideoElement>(null)
  const [sound, setSound] = useState(false)
  /** The browser refused sound, so the page is waiting for a first tap to turn it on. */
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    const player = video.current
    if (!player) return
    // Someone who asked their device for less motion gets a still picture and a play button instead.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let current = true
    const withSound = () => {
      player.muted = false
      player.currentTime = 0
      void player.play().catch(() => {})
    }
    const onFirstTouch = () => {
      if (!current) return
      setWaiting(false)
      withSound()
    }
    const stopWaiting = () => {
      document.removeEventListener('pointerdown', onFirstTouch)
      document.removeEventListener('keydown', onFirstTouch)
    }

    // If the visitor mutes or unmutes with the player's own controls, the button follows.
    const follow = () => setSound(!player.muted)
    player.addEventListener('volumechange', follow)

    player.muted = false
    follow()
    player.play().catch(() => {
      if (!current) return
      // Sound refused: start silent, and take the first touch of any kind as the go-ahead.
      player.muted = true
      follow()
      void player.play().catch(() => {})
      setWaiting(true)
      document.addEventListener('pointerdown', onFirstTouch, { once: true })
      document.addEventListener('keydown', onFirstTouch, { once: true })
    })

    return () => {
      current = false
      stopWaiting()
      player.removeEventListener('volumechange', follow)
    }
  }, [])

  const toggleSound = () => {
    const player = video.current
    if (!player) return
    setWaiting(false)
    if (player.muted) {
      player.muted = false
      player.currentTime = 0
      void player.play()
    } else {
      player.muted = true
    }
  }

  return (
    <div className="hype">
      <SiteTabs current="hype" view="" />
      <main className="hype-stage">
        <p className="hype-kicker">Team Shackleton Station · Space Apps 2026</p>
        <h1>The landing party</h1>
        <p className="hype-lede">What it feels like when our numbers finally agree with NASA’s.</p>

        <div className="hype-frame">
          <video
            ref={video}
            className="hype-video"
            controls
            playsInline
            loop
            preload="auto"
            poster={`${MEDIA}hype-poster.jpg`}
            aria-label="A short hype video: a room full of people cheering as one of them raises a glass"
          >
            <source src={`${MEDIA}hype.mp4`} type="video/mp4" />
            Your browser can’t play this video. <a href={`${MEDIA}hype.mp4`}>Download it</a> instead.
          </video>
          {waiting && <p className="hype-tap">Tap anywhere for sound</p>}
        </div>

        <div className="hype-actions">
          <button type="button" className="hype-sound" aria-pressed={sound} onClick={toggleSound}>
            {sound ? 'Mute' : 'Turn the sound on'}
          </button>
          <a href="/">Back to the Moon →</a>
        </div>

        <p className="hype-note">
          This video is AI-generated (it carries an “AI” mark in its corner). It is here for fun and is not part of
          the science: no number on this site comes from it.
        </p>
      </main>
    </div>
  )
}
