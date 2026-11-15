import { useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { DEFAULT_SPREAD, type Spread } from '../lib/landingOdds'
import type { SightlineMission } from '../lib/sightlineMission'
import { LandingRain } from './LandingRain'
import { NearbyGround } from './NearbyGround'
import { PlannerFold } from './PlannerFold'
import { PlannerNearby } from './PlannerNearby'
import { useMissionGrid } from './useMissionGrid'

interface Props {
  start: string
  /** The site and month opened under the grid, and the landing chosen there, in clock hours. */
  site: SiteInfo
  /** The site whose map of the ground nearby covers `site`: itself, or for a point of your own the closest one. */
  anchor: SiteInfo
  month: string
  landing: number
  mission: SightlineMission
  /** The next scenario's letter, or null when there are four already. */
  letter: string | null
  /** Add a place (latitude and longitude) as the next scenario, at this landing. */
  onPlace: (lat: number, lon: number) => void
}

/** What a place chosen in a fold does here: the Planner never moves a scenario, it adds one. */
function PlaceNote({ button, letter }: { button: string; letter: string | null }) {
  return <p className="sl-quiet plh-place-note">{letter ? `Here “${button}” adds that place as scenario ${letter}, at this landing.` : `There are four scenarios already, so “${button}” adds nothing: remove one on Compare first.`}</p>
}

/** The landing-accuracy picture, with the light grid it needs. Mounted only while its fold is open: the grid is a download for each month of the mission. */
function Accuracy({ start, site, landing, mission, onPlace }: Pick<Props, 'start' | 'site' | 'landing' | 'mission' | 'onPlace'>) {
  const [spread, setSpread] = useState<Spread>(DEFAULT_SPREAD)
  const grid = useMissionGrid(start, landing, mission.requirements.missionDays, true)
  return <LandingRain site={site} mission={mission} grid={grid} spread={spread} onSpread={setSpread} onAim={onPlace} />
}

/**
 * Find's two pictures of the ground, for a site on the south-pole ridges (or a point of your own
 * near one), each folded behind its heading: whether a place nearby does better this month, and
 * where the lander may come down around its target. Both are the detailed planner's own components,
 * imported as they are and drawn inside the wrapper that gives them this screen's type.
 */
export function PlannerFindVisuals({ start, site, anchor, month, landing, mission, letter, onPlace }: Props) {
  return (
    <>
      <section className="plh-part plh-nearby plh-ground sl-np" aria-label="The ground around the site">
        <PlannerFold
          id="ground"
          title="Is there better ground nearby?"
          hint="A map of the ground within reach, with the best places marked."
          // One sentence on how much the month changes close by, whether the fold is open or not.
          lead={site.nearby_half_m ? <PlannerNearby site={site} month={month} onSpot={onPlace} /> : null}
        >
          <PlaceNote button="Go" letter={letter} />
          <NearbyGround site={site} anchor={anchor} month={month} mission={mission} onSpot={onPlace} />
        </PlannerFold>
      </section>
      <section className="plh-part plh-accuracy sl-np" aria-label="Where the lander may come down">
        <PlannerFold id="accuracy" title="Where the lander may come down" hint="Simulated landings around the target, and how many still fit the mission.">
          <PlaceNote button="Aim" letter={letter} />
          <Accuracy start={start} site={site} landing={landing} mission={mission} onPlace={onPlace} />
        </PlannerFold>
      </section>
    </>
  )
}
