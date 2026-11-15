import './roverLine.css'

/**
 * Under the mission's examples, where the mission is chosen: one line that names Canada's utility
 * rover and opens its panel, so a visitor who never opens Scout still meets it. It says only that
 * Long stay is the kind of mission such a rover faces; the panel has the Canadian Space Agency's own
 * words and says the example is not the rover's own figures. Choosing Long stay opens nothing: the
 * line does.
 */
export function RoverLine({ onOpen }: { onOpen: () => void }) {
  return (
    <p className="sl-rover-line">
      Long stay is the kind of mission Canada’s utility rover faces.{' '}
      <button type="button" className="sl-link" title="Opens what the Canadian Space Agency says about its rover, in its own words." onClick={onOpen}>
        About the rover <span aria-hidden="true">›</span>
      </button>
    </p>
  )
}
