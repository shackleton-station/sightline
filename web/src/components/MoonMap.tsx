import { type MouseEvent, useCallback, useEffect, useState } from 'react'
import type { CustomMeta, MapMeta, SiteInfo, TrackPoint } from '../data/contract'
import { customSiteInfo, loadCustomMeta } from '../data/customSite'
import { loadMapMeta } from '../data/loadSite'
import {
  moonMapLatLon,
  moonMapPosition,
  nightStrips,
  poleMapLatLon,
  poleMapPosition,
  subPoint,
} from '../lib/mapGeometry'
import type { Scenario } from '../lib/scenario'
import { MoonGlobe } from './MoonGlobe'

interface Props {
  sites: SiteInfo[]
  scenario: Scenario
  onChange: (scenario: Scenario) => void
  now: TrackPoint | null
}

const base = `${import.meta.env.BASE_URL}data/maps`
/** Sites this close to the pole appear only on the close-up, where they can be told apart. */
const CLOSE_UP_ABS_LAT = 85

function Dot({
  site,
  selected,
  x,
  y,
  label,
  onSelect,
}: {
  site: SiteInfo
  selected: boolean
  x: number
  y: number
  label: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={selected ? 'map-dot selected' : 'map-dot'}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      aria-label={`Select ${site.name}`}
      aria-pressed={selected}
      title={site.name}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      {label && <span>{site.name}</span>}
    </button>
  )
}

/** The whole Moon with live day and night, plus a close-up of the south pole. Click to choose. */
export function MoonMap({ sites, scenario, onChange, now }: Props) {
  const [meta, setMeta] = useState<MapMeta | null>(null)
  const [customMeta, setCustomMeta] = useState<CustomMeta | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [globe, setGlobe] = useState(() => typeof WebGL2RenderingContext !== 'undefined')
  const showFlat = useCallback(() => setGlobe(false), [])

  useEffect(() => {
    loadMapMeta().then(setMeta).catch((reason: unknown) => setMessage(String(reason)))
    loadCustomMeta().then(setCustomMeta).catch((reason: unknown) => setMessage(String(reason)))
  }, [])
  if (!meta) return null

  const selectedSite = scenario.custom ?? sites.find((s) => s.id === scenario.siteId)
  const select = (site: SiteInfo) => {
    setMessage(null)
    onChange({ month: scenario.month, siteId: site.id })
  }
  const choosePoint = (lat: number, lon: number) => {
    if (!customMeta) return
    if (Math.abs(lat) > customMeta.max_abs_lat) {
      setMessage("A point exactly at a pole has no local north. Choose a point just beside it.")
      return
    }
    setMessage(null)
    const custom = customSiteInfo(Number(lat.toFixed(4)), Number(lon.toFixed(4)))
    onChange({ month: scenario.month, siteId: custom.id, custom })
  }
  const fractions = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }
  const pickMoon = (event: MouseEvent<HTMLDivElement>) => {
    const { x, y } = fractions(event)
    const { lat, lon } = moonMapLatLon(x, y)
    choosePoint(lat, lon)
  }
  const pickPole = (event: MouseEvent<HTMLDivElement>) => {
    const { x, y } = fractions(event)
    const { lat, lon } = poleMapLatLon(x, y, meta.pole.half_width_m)
    choosePoint(lat, lon)
  }

  const sub = now ? subPoint(now.sun_vec_me) : null
  const moonSites = sites.filter((s) => Math.abs(s.lat) < CLOSE_UP_ABS_LAT)
  const poleSites = sites.flatMap((site) => {
    const position = poleMapPosition(site.lat, site.lon, meta.pole.half_width_m)
    return position ? [{ site, position }] : []
  })

  const customPole = scenario.custom
    ? poleMapPosition(scenario.custom.lat, scenario.custom.lon, meta.pole.half_width_m)
    : null

  return (
    <div className="maps">
      <figure>
        <figcaption>
          <span>
            The whole Moon, with day and night at the selected time.{' '}
            {globe
              ? 'Drag to turn it.'
              : 'Near side in the middle, far side at the edges.'}{' '}
            Click a dot, or anywhere for a custom point.
          </span>
          <span className="map-kind" role="group" aria-label="Map style">
            <button type="button" aria-pressed={globe} onClick={() => setGlobe(true)}>
              Globe
            </button>
            <button type="button" aria-pressed={!globe} onClick={() => setGlobe(false)}>
              Flat
            </button>
          </span>
        </figcaption>
        {globe ? (
          <MoonGlobe
            sites={moonSites}
            selected={selectedSite}
            now={now}
            onSelect={select}
            onPick={choosePoint}
            onLost={showFlat}
          />
        ) : (
          <div className="map" onClick={pickMoon} role="presentation">
            <img
              src={`${base}/moon.png`}
              width={meta.moon.width}
              height={meta.moon.height}
              alt="Shaded relief map of the whole Moon"
            />
            {sub && (
              <svg
                viewBox="-180 -90 360 180"
                preserveAspectRatio="none"
                shapeRendering="crispEdges"
                aria-hidden="true"
              >
                {nightStrips(sub).flatMap((strip) =>
                  strip.ranges.map(([west, east]) => (
                    <rect
                      key={`${strip.lat}:${west}`}
                      x={west}
                      y={-strip.lat - 1}
                      width={east - west}
                      height={2}
                    />
                  )),
                )}
              </svg>
            )}
            {moonSites.map((site) => {
              const { x, y } = moonMapPosition(site.lat, site.lon)
              return (
                <Dot
                  key={site.id}
                  site={site}
                  selected={site.id === selectedSite?.id}
                  x={x}
                  y={y}
                  label={false}
                  onSelect={() => select(site)}
                />
              )
            })}
            {scenario.custom && (
              <span
                className="map-dot selected custom"
                style={{
                  left: `${moonMapPosition(scenario.custom.lat, scenario.custom.lon).x * 100}%`,
                  top: `${moonMapPosition(scenario.custom.lat, scenario.custom.lon).y * 100}%`,
                }}
              />
            )}
          </div>
        )}
      </figure>
      <figure>
        <figcaption>
          South pole close-up, {(meta.pole.half_width_m * 2) / 1000} km across, centered on the pole. Click
          a dot, or anywhere for a custom point.
        </figcaption>
        <div className="map" onClick={pickPole} role="presentation">
          <img
            src={`${base}/pole.png`}
            width={meta.pole.width}
            height={meta.pole.height}
            alt="Shaded relief map of the lunar south pole"
          />
          {poleSites.map(({ site, position }) => (
            <Dot
              key={site.id}
              site={site}
              selected={site.id === selectedSite?.id}
              x={position.x}
              y={position.y}
              label
              onSelect={() => select(site)}
            />
          ))}
          {customPole && (
            <span
              className="map-dot selected custom"
              style={{ left: `${customPole.x * 100}%`, top: `${customPole.y * 100}%` }}
            />
          )}
        </div>
      </figure>
      {message && (
        <p className="form-problem" role="alert">
          {message}
        </p>
      )}
      <p className="note maps-note">
        Shaded relief computed from NASA LOLA terrain, with artificial lighting. Day and night ignore
        terrain. Place names from the IAU Gazetteer of Planetary Nomenclature.
      </p>
    </div>
  )
}
