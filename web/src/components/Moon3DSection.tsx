import { Component, lazy, type ReactNode, Suspense, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { loadPart } from '../data/staleBuild'
import type { CameraCue } from '../lib/story'

// If the file is gone because a newer version of the site is live, the page reloads into it.
const MoonView3D = lazy(() => loadPart(() => import('./MoonView3D')))

interface Props {
  site: { name: string; lat: number; lon: number }
  now: TrackPoint
  obsHeightM: number
  camera?: CameraCue
  /** When standing, keep the ground in the picture however high the Sun or Earth is. */
  groundInView?: boolean
  onReadyChange?: (ready: boolean) => void
}

class LoadFailure extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? (
      <p className="pending">The 3D view could not be downloaded. Check the connection and reload.</p>
    ) : (
      this.props.children
    )
  }
}

/** The 3D view, downloaded only when someone gets to it, with a way back if it can't start. */
export function Moon3DSection({ site, now, obsHeightM, camera, groundInView, onReadyChange }: Props) {
  const [attempt, setAttempt] = useState(0)

  return (
    <div className="moon-3d-section">
      <LoadFailure>
        <Suspense fallback={<p className="loading" role="status">Loading the 3D view…</p>}>
          <MoonView3D
            key={attempt}
            site={site}
            now={now}
            obsHeightM={obsHeightM}
            camera={camera}
            groundInView={groundInView}
            onReadyChange={onReadyChange}
            onRestart={() => setAttempt((count) => count + 1)}
          />
        </Suspense>
        <details className="how-to-read note">
          <summary>How to read this</summary>
          <p>
            Drawn from the same NASA LOLA terrain and Sun position as the numbers on this page, with
            shadows from the Sun as it is at that hour. Bright grey ground is in sunlight; dim blue
            ground isn't, and is tinted only so you can see its shape. The Sun and Earth are drawn where
            they are in the sky (true size when standing, enlarged from above), with their elevation and
            azimuth written above them, and Earth shows its
            phase (its map is NASA's Blue Marble, for looks only: which side faces the Moon is not
            modelled). The picture shows the ground, so a spot can look dark while the numbers say the Sun
            is up: they're for a point {obsHeightM} m above it, worked out by our model, not by the
            picture.
          </p>
        </details>
      </LoadFailure>
    </div>
  )
}
