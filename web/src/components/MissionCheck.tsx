import { useMemo } from 'react'
import type { ScenarioData } from '../data/loadSite'
import { useSiteFlags } from '../data/useSiteFlags'
import { hourOf, landingProblems, landingWindows, locateHour, missionEarth, type Requirements } from '../lib/mission'
import { formatDuration } from '../lib/nextChange'
import { formatUtc } from '../lib/timeline'

interface Props {
  data: ScenarioData
  index: number
  requirements: Requirements
  onJump: (month: string, index: number) => void
}

const MAX_LISTED = 6

/** Is a landing at the selected time viable, and if not, when is the next one that is? */
export function MissionCheck({ data, index, requirements, onJump }: Props) {
  const flags = useSiteFlags(data.site)
  const windows = useMemo(
    () => (flags ? landingWindows(flags.sun, missionEarth(flags, requirements), requirements) : []),
    [flags, requirements],
  )
  if (!flags) return <p className="note">Checking landing windows…</p>

  const point = data.track[Math.min(index, data.track.length - 1)]
  const hour = hourOf(flags.start, point.t)
  const problems = landingProblems(flags.sun, missionEarth(flags, requirements), hour, requirements)
  const totalHours = windows.reduce((sum, w) => sum + (w.to - w.from), 0)
  const label = (h: number) => formatUtc(new Date(Date.parse(flags.start) + h * 3_600_000).toISOString().replace('.000Z', 'Z'))
  const upcoming = windows.filter((window) => window.to > hour)
  const firstYear = flags.start.slice(0, 4)
  const lastYear = data.year.years[data.year.years.length - 1].year

  return (
    <section className="mission" aria-labelledby={`mission-${data.site.id}`}>
      <h2 id={`mission-${data.site.id}`}>Can you land here?</h2>
      {problems.length === 0 ? (
        <p className="viable">Landing at {formatUtc(point.t)}: meets your limits.</p>
      ) : (
        <>
          <p className="not-viable">Landing at {formatUtc(point.t)}: doesn't meet your limits.</p>
          <ul className="problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </>
      )}
      {windows.length === 0 ? (
        <p>
          No landing time from {firstYear} to {lastYear} meets these limits at {data.site.name}.
        </p>
      ) : (
        <>
          <p>
            {windows.length} landing {windows.length === 1 ? 'window' : 'windows'} from {firstYear} to{' '}
            {lastYear}, {formatDuration(totalHours)} in total.{' '}
            {upcoming.length > 0 ? 'Jump to the next:' : 'None left after this date.'}
          </p>
          <ul className="windows">
            {upcoming.slice(0, MAX_LISTED).map((window) => {
              const { month, index: target } = locateHour(flags.start, window.from)
              return (
                <li key={window.from}>
                  <button type="button" onClick={() => onJump(month, target)}>
                    {label(window.from)}, open for {formatDuration(window.to - window.from)}
                  </button>
                </li>
              )
            })}
          </ul>
          {upcoming.length > MAX_LISTED && (
            <p className="note">Showing the next {MAX_LISTED} of {upcoming.length}.</p>
          )}
        </>
      )}
      <p className="note">
        Uses this model's hourly data and the terrain above, so treat it as a first pass, not a mission
        design.
      </p>
    </section>
  )
}
