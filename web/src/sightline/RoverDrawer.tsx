import { CSA_ROVER, roverMissionDays } from '../lib/csaRover'

/**
 * Scout's idea, "Plan for Canada's utility rover": what the Canadian Space Agency says about the
 * rover, in its own words, and why the mission the idea selects is hard near the pole.
 */
export function RoverDrawer({ onClose }: { onClose: () => void }) {
  const days = roverMissionDays()
  return (
    <aside className="sl-drawer sl-rover" aria-label="Canada’s utility rover">
      <header className="sl-drawer-head">
        <h2>Canada’s utility rover</h2>
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="sl-quiet">From the Canadian Space Agency, in its own words.</p>
      <p>
        Status: “{CSA_ROVER.status}”. Launch: “{CSA_ROVER.launch}”. It is to “{CSA_ROVER.survive}”, and may be used for “{CSA_ROVER.use}”. The agency has published no landing site.
      </p>
      <h3>Why that is hard at the pole</h3>
      <p className="sl-rover-why">
        Near the south pole the Sun never climbs more than a few degrees above the horizon, so the skyline can hide it for days on end, and hide Earth too. So the mission is now Long stay, an
        example and not the rover’s own figures: {days.stay} days, at most {days.dark} days without Sun and {days.silent === null ? 'no limit on time without Earth' : `${days.silent} days without Earth`}, and the verdict on the left says whether this landing gets through.
      </p>
      <p className="sl-layer-credit">
        <a href={CSA_ROVER.url} target="_blank" rel="noreferrer">
          Canadian Space Agency: {CSA_ROVER.pageTitle}
        </a>{' '}
        (page dated {CSA_ROVER.modified}).
      </p>
    </aside>
  )
}
