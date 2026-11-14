import { useEffect, useRef, useState } from 'react'
import type { RiverState } from '../lib/river'
import { Mascot } from '../scout/Mascot'

export type StageMode = 'orbit' | 'site' | 'surface'

interface Props {
  mode: StageMode
  onMode: (mode: StageMode) => void
  scoutOpen: boolean
  /** What is in view at the scenario's landing, for Scout's mark; null while it loads. */
  scoutState: RiverState | null
  onScout: () => void
  missionOpen: boolean
  onMission: () => void
  compareOpen: boolean
  onCompare: () => void
  /** Landing accuracy: the ground around the target, and the odds of coming down where the mission fits. */
  accuracyOpen: boolean
  /** Whether the Moon is shaded by where a landing fits (the button says so). */
  accuracyOn: boolean
  onAccuracy: () => void
  /** Whether the Layers panel is open, and whether a Moon Trek layer is on (the button says so). */
  layersOpen: boolean
  layerOn: boolean
  onLayers: () => void
  /** Open the Planner: the same scenarios with the whole window to work in. */
  onPlanner: () => void
  /** Open How it works, as a sheet over the scene. */
  onHow: () => void
  /** Start Scout's tour of the screen. On a phone it is in "More"; on a laptop it is the first thing in How it works. */
  onTour: () => void
  onWatch: () => void
  onHide: () => void
}

/**
 * The rail down the right of the Plan frame: how close the Moon is seen (one grouped control), the
 * tools, and the two ways out (back to Watch, or hide everything). Nothing here leaves the screen.
 */
export function Rail({ mode, onMode, scoutOpen, scoutState, onScout, missionOpen, onMission, compareOpen, onCompare, accuracyOpen, accuracyOn, onAccuracy, layersOpen, layerOn, onLayers, onPlanner, onHow, onTour, onWatch, onHide }: Props) {
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
      <button type="button" aria-pressed={mode === 'orbit'} title="The whole Moon, from over the south pole" onClick={() => onMode('orbit')}>
        Orbit
      </button>
      <button type="button" aria-pressed={mode === 'site'} title="Close on the site" onClick={() => onMode('site')}>
        Site
      </button>
      <button type="button" aria-pressed={mode === 'surface'} title="Stand at the site and look around" onClick={() => onMode('surface')}>
        Surface
      </button>
    </div>
  )
  const scout = (
    <button type="button" className="sl-rail-scout" data-tour="scout" aria-pressed={scoutOpen} title="Ask Scout about the scenario on show" onClick={onScout}>
      <Mascot state={scoutState} size={16} /> Scout
    </button>
  )
  const layers = (
    <button type="button" aria-pressed={layersOpen} title="NASA's maps of the south pole, from Moon Trek" onClick={onLayers}>
      Layers
      {/* The credit stays on screen for as long as a layer is on the Moon, with the panel open or shut. */}
      {layerOn && <small className="sl-rail-credit">Moon Trek</small>}
    </button>
  )
  const tools = (
    <>
      <button type="button" aria-pressed={missionOpen} title="What the lander can tolerate" onClick={onMission}>
        Mission
      </button>
      <button type="button" data-tour="compare" aria-pressed={compareOpen} title="The scenarios side by side" onClick={onCompare}>
        Compare
      </button>
      <button type="button" aria-pressed={accuracyOpen} title="The ground around the target, and the odds of landing where the mission fits" onClick={onAccuracy}>
        Accuracy
        {/* Says why the Moon is green and red, with the panel open or shut. */}
        {accuracyOn && <small className="sl-rail-credit">Shading on</small>}
      </button>
      <button type="button" data-tour="planner" title="Every scenario, every site and month, with the whole window to work in" onClick={onPlanner}>
        Planner
      </button>
    </>
  )
  const ways = (
    <>
      <button type="button" title="The data, the checks and the tech stack" onClick={onHow}>
        How it works
      </button>
      <button type="button" title="Close the planner (P)" onClick={onWatch}>
        Watch
      </button>
      <button type="button" data-tour="hide" title="Hide everything but the Moon (H)" onClick={onHide}>
        Hide
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
          <button type="button" title="Scout walks you through the screen, in about a minute" onClick={onTour}>
            Tour
          </button>
        </div>
      </nav>
    )
  }
  return (
    <nav className="sl-rail" aria-label="Views and tools">
      {heights}
      {layers}
      <hr />
      {scout}
      {tools}
      <hr />
      {ways}
    </nav>
  )
}

/** Whether the window is a phone's width: the rail is one row there. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth < 761)
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 761)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return compact
}
