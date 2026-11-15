import { useEffect, useState } from 'react'
import type { EarthSunMonth } from '../../data/contract'
import { loadEarthSun } from '../../data/loadSite'
import type { ScenarioData } from '../../data/scenarioData'
import { earthPath, EVERYDAY_LAT_DEG, looseDuration, moonPath, pathStats } from '../../lib/earthSun'
import { monthLabel } from '../../lib/months'
import { degWords } from '../../lib/sightline'

/** "once", "twice", "31 times". */
function times(count: number): string {
  return count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`
}

/**
 * The month on show at this site against the same month at a place most people know on Earth: how
 * often the Sun rises, the longest stretch with it and without it, and how high it gets. The same
 * figures the time bar's "A day on Earth" row is drawn from. Nothing is shown until both are read.
 */
export function GuideEarthDay({ data }: { data: ScenarioData }) {
  const [earthSun, setEarthSun] = useState<{ month: string; value: EarthSunMonth } | null>(null)
  useEffect(() => {
    let current = true
    loadEarthSun(data.month)
      .then((value) => {
        if (current) setEarthSun({ month: data.month, value })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [data.month])
  if (!earthSun || earthSun.month !== data.month) return null
  const here = pathStats(moonPath(data.track))
  const earth = pathStats(earthPath(earthSun.value, EVERYDAY_LAT_DEG))
  const month = monthLabel(data.month)
  const dark = here.longestDownH === 0 ? 'and it never goes dark' : `and the longest without it ${looseDuration(here.longestDownH)}`
  return (
    <section className="how-earth-day" aria-labelledby="how-earth-day-title">
      <h3 id="how-earth-day-title">A day here, and a day on Earth</h3>
      <ul className="how-cards">
        <li className="how-card">
          <h4>Earth, at {EVERYDAY_LAT_DEG}°N</h4>
          <p>
            About Madrid or Denver. In {month} the Sun rises {times(earth.rises)}, climbs as high as {degWords(earth.highestDeg)}, and is never gone for more than{' '}
            {looseDuration(earth.longestDownH)}.
          </p>
        </li>
        <li className="how-card">
          <h4>{data.site.name}, on the Moon</h4>
          <p>
            In {month} the Sun {here.rises === 0 ? (here.longestUpH === 0 ? 'never rises' : 'does not rise: it is already up') : `rises ${times(here.rises)}`} and gets no higher than{' '}
            {degWords(here.highestDeg)} from level. {here.longestUpH === 0 ? 'There is no sunlight at all.' : `The longest stretch of sunlight is ${looseDuration(here.longestUpH)}, ${dark}.`}
          </p>
        </li>
      </ul>
      <p className="how-note">
        Stretches are counted inside the month, from the hourly data. To see the two side by side, open “⋯” on the time bar and tick “A day on Earth” (it is offered while the bar
        shows less than a year).
      </p>
    </section>
  )
}
