import { TIGHT_DAYS } from './plannerModel'
import { plural } from './words'


/** How to read the grid's bars. `mostDays` is the tallest bar on the table, which sets their scale. */
export function GridKey({ mostDays, keptWords = 'on your short list' }: { mostDays: number; keptWords?: string }) {
  return (
    <ul className="pl-key" id="pl-grid-key">
      <li>
        <span className="pl-swatch works" aria-hidden="true" /> Each bar is a month. Taller = more days you could land and get through the whole mission.
        {mostDays > 0 ? ` The tallest bar on this table is ${plural(mostDays, 'day')}.` : ''}
      </li>
      <li>
        <span className="pl-swatch tight" aria-hidden="true" /> Striped orange: tight, only 1 or {TIGHT_DAYS} days to land that month, so little room if the date slips.
      </li>
      <li>
        <span className="pl-swatch none" aria-hidden="true" /> No bar: no landing that month gets through the mission.
      </li>
      <li>
        <span className="pl-swatch listed" aria-hidden="true" /> Line along the top: a landing {keptWords}.
      </li>
    </ul>
  )
}
