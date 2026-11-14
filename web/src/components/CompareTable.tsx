import type { ScenarioData } from '../data/loadSite'
import { compareRows } from '../lib/compare'
import { monthLabel } from '../lib/months'

interface Props {
  a: ScenarioData
  b: ScenarioData
}

/** A vs B on the numbers that decide a landing date. */
export function CompareTable({ a, b }: Props) {
  return (
    <section aria-labelledby="compare-title">
      <h2 id="compare-title">Comparison</h2>
      <ul className="compare-key">
        <li>
          <strong>A:</strong> {a.site.name}, {monthLabel(a.month)}
        </li>
        <li>
          <strong>B:</strong> {b.site.name}, {monthLabel(b.month)}
        </li>
      </ul>
      <table className="compare">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col">Better</th>
          </tr>
        </thead>
        <tbody>
          {compareRows(a, b).map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className={row.better === 'A' ? 'better' : undefined}>{row.a}</td>
              <td className={row.better === 'B' ? 'better' : undefined}>{row.b}</td>
              <td>{row.better}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        "Too close" means the difference is within the error we measured against NASA's maps, or
        could come from the model reading differently at these two sites, so it shouldn't decide
        anything. Gaps are counted within each month only; 2 h or less is too close at hourly
        resolution, and larger gaps have no measured error.
      </p>
    </section>
  )
}
