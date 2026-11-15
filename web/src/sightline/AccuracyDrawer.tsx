import type { SiteInfo } from '../data/contract'
import type { MissionHeights } from '../lib/heights'
import { type Miss, MISS_WORDS, type Spread } from '../lib/landingOdds'
import type { SightlineMission } from '../lib/sightlineMission'
import { LandingRain } from './LandingRain'
import './newPlanner.css'
import './accuracy.css'

interface Props {
  site: SiteInfo
  mission: SightlineMission
  /** The heights the landing points are worked out at: those the verdict on the left is for. */
  heights: MissionHeights
  /** The landing: the first hour of the data, and the landing's hours after it. */
  start: string
  landing: number
  /** The verdict on the left for the aim point itself: null where it fits, the reason where it does not, undefined while unknown. */
  verdict: Miss | null | undefined
  /** How the lander's misses are spread, and a change to it. */
  spread: Spread
  onSpread: (spread: Spread) => void
  /** Whether the same verdicts are shaded on the Moon. */
  shade: boolean
  onShade: (on: boolean) => void
  /** Move the scenario's target to a point. */
  onAim: (lat: number, lon: number) => void
  onClose: () => void
}

/**
 * Landing accuracy: a lander aimed at the site comes down somewhere around it. The panel says the
 * verdict on the left again for the aim point, then shows "Where the lander may come down" as the
 * Planner has it (`LandingRain`): the ground's photo tinted by what a landing there does, simulated
 * landers falling on it (played in once as the panel opens), the tally, a better place to aim, and how the map is made. Under it, the
 * switch that shades the same question on the Moon.
 *
 * The ground is judged at landing points round the target, each as the verdict judges a point
 * (`lib/landingField.ts`); the odds are the ones the line under the verdict and Compare show.
 */
export function AccuracyDrawer({ site, mission, heights, start, landing, verdict, spread, onSpread, shade, onShade, onAim, onClose }: Props) {
  return (
    <aside className="sl-drawer sl-accuracy" aria-label="Landing accuracy">
      <header className="sl-drawer-head">
        <h2>Landing accuracy</h2>
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      {verdict !== undefined && (
        <p className={`sl-accuracy-point is-${verdict === null ? 'fit' : 'miss'}`} title="The verdict on the left, for a landing exactly on the aim point. The map under the cross agrees with it.">
          {verdict === null ? 'A landing exactly on the aim point fits your mission.' : `A landing exactly on the aim point does not fit: ${MISS_WORDS[verdict]}.`}
        </p>
      )}
      <div className="sl-np sl-accuracy-rain">
        <LandingRain site={site} mission={mission} heights={heights} start={start} landing={landing} verdict={verdict} spread={spread} onSpread={onSpread} onAim={onAim} compact playOnOpen />
      </div>
      <label className="sl-check sl-accuracy-shade" title="Colors the Moon by how likely a landing aimed there comes down where the mission fits. Green is likely, amber uncertain, red unlikely. A coarser picture than this panel's: Sun and Earth every 120 m, from 2 m up.">
        <input type="checkbox" role="switch" checked={shade} onChange={() => onShade(!shade)} />
        <span>Shade the Moon by landings that fit</span>
      </label>
    </aside>
  )
}
