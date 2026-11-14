import { TIGHT_DAYS } from './plannerModel'
import { plural } from './words'

/** How to read the grid's bars. `mostDays` is the tallest bar on the table, which sets their scale. */
export function GridKey({ mostDays }: { mostDays: number }) {
  return (
    <ul className="pl-key" id="pl-grid-key">
      <li>
        <span className="pl-swatch works" aria-hidden="true" /> Bar height: days in the month with a landing that meets your limits.
        {mostDays > 0 ? ` The tallest bar on this table is ${plural(mostDays, 'day')}.` : ''}
      </li>
      <li>
        <span className="pl-swatch tight" aria-hidden="true" /> Tight: {TIGHT_DAYS} days or fewer.
      </li>
      <li>
        <span className="pl-swatch none" aria-hidden="true" /> No bar: no landing that month survives the mission.
      </li>
      <li className="pl-key-keys">Keyboard: arrow keys move between squares, Page Up and Page Down move a year, Enter chooses.</li>
    </ul>
  )
}
