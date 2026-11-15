import { useEffect, useRef, useState } from 'react'
import type { RiverState } from '../lib/river'
import { Mascot } from '../scout/Mascot'
import { useCompact } from './hooks'

export type StageMode = 'orbit' | 'site' | 'surface'

interface Props {
  mode: StageMode
  onMode: (mode: StageMode) => void
  /** The pointer or the keyboard is on the Surface button: its view can be made ready before the press. */
  onSurfaceNear?: () => void
  scoutOpen: boolean
  /** What is in view at the scenario's landing, for Scout's mark; null while it loads. */
  scoutState: RiverState | null
  onScout: () => void
  compareOpen: boolean
  onCompare: () => void
  /** Landing accuracy: the ground around the target, and the odds of coming down where the mission fits. */
  accuracyOpen: boolean
  onAccuracy: () => void
  /** Whether the Layers panel is open, and whether a Moon Trek layer is on (the button says so). */
  layersOpen: boolean
  layerOn: boolean
  onLayers: () => void
  /** Open the Planner: the same scenarios with the whole window to work in. */
  onPlanner: () => void
  /** Open the New Planner: the Planner page's look, on the same scenarios. */
  onNewPlanner: () => void
  /** Open the written brief of the scenario on show. */
  onBrief: () => void
  /** Open the Guide (the tour, the videos, how to use the screen and how it works), as a sheet over the scene. */
  onHow: () => void
  /** The easter egg: its button is in the rail only once the word has been typed. Null until then. */
  hype: { open: boolean; onOpen: () => void } | null
  /** Start Scout's tour of the screen. On a phone it is in "More"; on a laptop it is the first thing in the Guide. */
  onTour: () => void
  /** Back to the opening screen: the Moon playing, as a first visit finds it. */
  onHome: () => void
}

/**
 * The rail down the right of the Plan frame, in two named sections: Plan (Scout and the tools) and
 * Help (the Guide, and home, to the opening screen). What the Moon shows (Orbit, Site, Surface and
 * Layers) is on the Moon's own stage (ViewSwitch); on a phone, where the rail is one row over the
 * stage, that row carries the three views and "More" has Layers. Nothing here leaves the screen.
 */
export function Rail({ mode, onMode, onSurfaceNear, scoutOpen, scoutState, onScout, compareOpen, onCompare, accuracyOpen, onAccuracy, layersOpen, layerOn, onLayers, onPlanner, onNewPlanner, onBrief, onHow, onTour, onHome, hype }: Props) {
  // On a phone the rail is one row: the heights, Scout, and "More" for the rest, as a short menu.
  const compact = useCompact()
  const [more, setMore] = useState(false)
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!more) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target instanceof Node && box.current?.contains(event.target))) setMore(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [more])

  const heights = (
    <div className="sl-heights" role="group" aria-label="How close the Moon is seen">
      <button type="button" aria-pressed={mode === 'orbit'} title="Shows the whole Moon, from over its south pole." onClick={() => onMode('orbit')}>
        Orbit
      </button>
      <button type="button" aria-pressed={mode === 'site'} title="Moves in close on the landing site." onClick={() => onMode('site')}>
        Site
      </button>
      <button type="button" aria-pressed={mode === 'surface'} title="Shows the view from the ground at the site: the skyline, the Sun and Earth." onPointerEnter={onSurfaceNear} onFocus={onSurfaceNear} onClick={() => onMode('surface')}>
        Surface
      </button>
    </div>
  )
  const scout = (
    <button type="button" className="sl-rail-scout" data-tour="scout" aria-pressed={scoutOpen} title="Opens Scout, an AI guide, to ask about the scenario on show." onClick={onScout}>
      <Mascot state={scoutState} size={16} /> Scout
    </button>
  )
  const layers = (
    <button type="button" aria-pressed={layersOpen} title="Lays one of NASA's maps of the south pole over the Moon: slope, shadow, sunlight and more." onClick={onLayers}>
      Layers
      {/* The credit stays on screen for as long as a layer is on the Moon, with the panel open or shut. */}
      {layerOn && <small className="sl-rail-credit">Moon Trek</small>}
    </button>
  )
  const tools = (
    <>
      <button type="button" data-tour="compare" aria-pressed={compareOpen} title="Opens the scenarios side by side, row by row." onClick={onCompare}>
        Compare
      </button>
      <button type="button" aria-pressed={accuracyOpen} title="Shows how likely a lander that misses its target still comes down where the mission fits." onClick={onAccuracy}>
        Landing <br />
        accuracy
      </button>
      <button type="button" data-tour="planner" title="Opens the Planner: every site by month, and your scenarios side by side." onClick={onPlanner}>
        Planner
      </button>
      <button type="button" title="Opens the New Planner: choose a place and time, see every site by month, read the written brief." onClick={onNewPlanner}>
        New Planner
      </button>
      <button type="button" data-tour="brief" title="Opens the written brief: the scenario on show, written out in full, to read or print." onClick={onBrief}>
        Brief
      </button>
      {hype && (
        <button type="button" className="sl-rail-hype" aria-pressed={hype.open} title="Opens the team's hype video." onClick={hype.onOpen}>
          Hype
        </button>
      )}
    </>
  )
  const ways = (
    <>
      <button type="button" data-tour="guide" title="Opens the Guide: the tour, the feature guides, and how the numbers are made." onClick={onHow}>
        Guide
      </button>
      {/* A house, with the word beside it only in a phone's menu, where every other row is a word. */}
      <button type="button" className="sl-rail-home" title="Goes back to the opening screen." onClick={onHome}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M2 7.5 8 2.5l6 5M3.5 6.5v7h3.25v-4h2.5v4h3.25v-7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Home</span>
      </button>
    </>
  )

  if (compact) {
    return (
      <nav ref={box} className="sl-rail is-compact" aria-label="Views and tools">
        {heights}
        {scout}
        <button type="button" className="sl-rail-more" data-tour="more" aria-haspopup="true" aria-expanded={more} onClick={() => setMore(!more)}>
          More
        </button>
        {/* The rest, as a short menu: choosing from it closes it. */}
        <div className={more ? 'sl-rail-menu is-open' : 'sl-rail-menu'} role="group" aria-label="More views and tools" hidden={!more} onClick={() => setMore(false)}>
          {layers}
          {tools}
          {ways}
          <button type="button" title="Scout shows you round the screen, one step at a time." onClick={onTour}>
            Tour
          </button>
        </div>
      </nav>
    )
  }
  return (
    <nav className="sl-rail" aria-label="Tools and help">
      <span className="sl-rail-label">Plan</span>
      {scout}
      {tools}
      <span className="sl-rail-label">Help</span>
      {ways}
    </nav>
  )
}
