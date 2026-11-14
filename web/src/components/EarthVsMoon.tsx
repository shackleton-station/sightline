import { useEffect, useMemo, useState } from 'react'
import type { EarthSunMonth } from '../data/contract'
import { loadEarthSun, type ScenarioData } from '../data/loadSite'
import { earthPath, EVERYDAY_LAT_DEG, looseDuration, moonPath, type PathStats, pathStats, type SunPath } from '../lib/earthSun'
import { SunPathChart } from './SunPathChart'

interface Props {
  data: ScenarioData
  index: number
  onIndexChange: (index: number) => void
}

interface Row {
  title: string
  /** Fits in a table's first column on a phone. */
  short: string
  path: SunPath
  stats: PathStats
}

const latText = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'}`

function takeaway(here: Row, earth: Row, siteName: string): string {
  const days = (hours: number) => looseDuration(hours)
  const sunHigh = `the Sun gets no higher than ${here.stats.highestDeg.toFixed(0)}° at ${siteName}, against ${earth.stats.highestDeg.toFixed(0)}° at ${EVERYDAY_LAT_DEG}°N on Earth`
  const dark =
    here.stats.longestDownH === 0
      ? `it never goes dark here`
      : `the longest time without Sun is ${days(here.stats.longestDownH)} here, against ${days(earth.stats.longestDownH)} there`
  return `This month, ${sunHigh}, and ${dark}.`
}

/** A day on Earth next to a day on the Moon, because the difference is hard to imagine otherwise. */
export function EarthVsMoon({ data, index, onIndexChange }: Props) {
  const [earthSun, setEarthSun] = useState<{ month: string; value: EarthSunMonth } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    loadEarthSun(data.month)
      .then((value) => {
        if (current) setEarthSun({ month: data.month, value })
      })
      .catch(() => {
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [data.month])

  const rows = useMemo<Row[] | null>(() => {
    if (!earthSun || earthSun.month !== data.month) return null
    const make = (title: string, short: string, path: SunPath): Row => ({ title, short, path, stats: pathStats(path) })
    return [
      make(`${data.site.name}, on the Moon`, 'This site', moonPath(data.track)),
      make(`Earth at the same latitude, ${latText(data.site.lat)}`, `Earth, ${latText(data.site.lat)}`, earthPath(earthSun.value, data.site.lat)),
      make(`Earth at ${EVERYDAY_LAT_DEG}°N, about Madrid or Denver`, `Earth, ${EVERYDAY_LAT_DEG}°N`, earthPath(earthSun.value, EVERYDAY_LAT_DEG)),
    ]
  }, [earthSun, data])

  if (failed) return <p className="pending">The Earth comparison could not be loaded.</p>
  if (!rows) return <p className="note">Loading the Sun on Earth…</p>

  return (
    <div className="earth-vs-moon">
      <p className="verdict">{takeaway(rows[0], rows[2], data.site.name)}</p>
      <SunPathChart rows={rows} times={data.track.map((point) => point.t)} index={index} onSelect={onIndexChange} />
      <table className="compare">
        <caption className="visually-hidden">The Sun this month, on the Moon and on Earth</caption>
        <thead>
          <tr>
            <th scope="col">This month</th>
            <th scope="col">Highest Sun</th>
            <th scope="col">Sunrises</th>
            <th scope="col">Most Sun in a row</th>
            <th scope="col">Most dark in a row</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.title}>
              <th scope="row">{row.short}</th>
              <td>{row.stats.highestDeg.toFixed(1)}°</td>
              <td>{row.stats.rises}</td>
              <td>{looseDuration(row.stats.longestUpH)}</td>
              <td>{looseDuration(row.stats.longestDownH)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        Earth's axis tilts 23.4° and it turns once a day. The Moon's tilts only 1.5°, and it turns once a
        month. With no air to hold heat, the surface at the Moon's equator swings from about −178 °C to
        +117 °C (
        <a href="https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html" target="_blank" rel="noreferrer">
          NASA fact sheet
        </a>
        ). On Earth this chart shows the Sun against a level horizon, with no hills and no air, so real
        sunsets there come a few minutes later. On the Moon it includes the terrain. Stretches are counted
        within this month only.
      </p>
    </div>
  )
}
