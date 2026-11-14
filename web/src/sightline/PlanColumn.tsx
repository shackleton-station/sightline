import { type FormEvent, type ReactNode, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { customSiteInfo, isCustomSite, loadCustomMeta } from '../data/customSite'
import { useFutureTargets } from '../data/futureTargets'
import { useHorizonsCheck } from '../data/horizonsCheck'
import { parseCoordinate } from '../lib/customModel'
import { horizonsQueryUrl } from '../lib/horizonsLink'
import { moonTrekUrl, quickmapUrl } from '../lib/openIn'
import { shortReason } from '../lib/sightlineSky'
import { NOT_A_LOGIN } from './inputs'
import { LandingPick } from './LandingPick'
import { siteValue, targetAt, targetValue } from './site'

interface FieldsProps {
  sites: SiteInfo[]
  site: SiteInfo | null
  /** Choose a site by what a scenario calls it: a listed id, or "lat,lon". */
  onSite: (value: string) => void
  /** "13 May 2027 · 12:00 UTC": the landing. */
  landing: string
  /** The landing as a date field holds it ("2027-05-13T12:00", UTC), and the first and last dates in the data. */
  landingField: string
  firstField: string
  lastField: string
  /** A date was picked or typed; returns false if it isn't a date in the data. */
  onPickDate: (value: string) => boolean
  /** The mission's short name ("Short stay", "Custom mission"), and what it asks in a few words, for the tooltip. Its details are in the Mission panel. */
  missionName: string
  mission: string
  missionOpen: boolean
  onMission: () => void
}

/**
 * The site on show, opened in NASA's own tools: Quickmap and Moon Trek on the place, Horizons on the
 * Sun's position there at the landing hour. A tool is left out where its link was not seen to land
 * on the place (lib/openIn.ts), and Horizons for a custom point, whose height was never worked out.
 */
function OpenIn({ site, landingField }: { site: SiteInfo; landingField: string }) {
  const horizons = useHorizonsCheck(site.id)
  const links = [
    { name: 'Quickmap', href: quickmapUrl(site.lat, site.lon), title: 'Open in Quickmap: the LRO camera team’s map, on this place' },
    { name: 'Moon Trek', href: moonTrekUrl(site.lat, site.lon), title: 'Open in Moon Trek: NASA’s map of the Moon, on this place' },
    { name: 'Horizons', href: horizons ? horizonsQueryUrl('sun', site.lat, site.lon, horizons.alt_km, `${landingField}:00Z`) : null, title: 'Open in Horizons: NASA JPL’s answer for the Sun at this place and the landing hour' },
  ].filter((link): link is { name: string; href: string; title: string } => link.href !== null)
  if (links.length === 0) return null
  return (
    <p className="sl-open-in">
      Open in{' '}
      {links.map((link, i) => (
        <span key={link.name}>
          {i > 0 && ' · '}
          <a href={link.href} target="_blank" rel="noreferrer" title={link.title}>
            {link.name}
          </a>
        </span>
      ))}
    </p>
  )
}

/** Typed coordinates for a custom point: checked the way the rest of the app checks them. */
function Coordinates({ onSite }: { onSite: (value: string) => void }) {
  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const go = async (event: FormEvent) => {
    event.preventDefault()
    const lat = parseCoordinate(latText, -90, 90)
    const lon = parseCoordinate(lonText, -180, 360)
    if (lat === null || lon === null) {
      setProblem('Latitude is −90 to 90 (south is negative); longitude is −180 to 360, east positive.')
      return
    }
    const meta = await loadCustomMeta().catch(() => null)
    if (meta && Math.abs(lat) > meta.max_abs_lat) {
      setProblem(`A point exactly at a pole has no local north. Use a latitude within ${meta.max_abs_lat}°.`)
      return
    }
    setProblem(null)
    onSite(siteValue(customSiteInfo(lat, lon > 180 ? lon - 360 : lon)))
  }

  return (
    <div className="sl-coords">
      <form onSubmit={(event) => void go(event)}>
        <input type="text" id="sl-latitude" name="latitude" {...NOT_A_LOGIN} inputMode="decimal" value={latText} placeholder="Latitude" aria-label="Latitude in degrees, south negative" onChange={(event) => setLatText(event.target.value)} />
        <input type="text" id="sl-longitude" name="longitude" {...NOT_A_LOGIN} inputMode="decimal" value={lonText} placeholder="Longitude" aria-label="Longitude in degrees, east positive" onChange={(event) => setLonText(event.target.value)} />
        <button type="submit" className="sl-small">
          Go
        </button>
      </form>
      <p className="sl-quiet">Or click the Moon.</p>
      {problem && <p className="sl-note is-warn">{problem}</p>}
    </div>
  )
}

/** The three small pictures that lead the plan's controls: a pin, a calendar, a rocket. */
const ICONS = {
  site: 'M8 14.5S3.5 9.9 3.5 6.5a4.5 4.5 0 0 1 9 0c0 3.4-4.5 8-4.5 8ZM8 8.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z',
  landing: 'M3 4.5h10v9H3zM3 7h10M5.5 2.5v3M10.5 2.5v3',
  mission: 'M8 1.5c2.2 1.8 3 4.2 3 6.5l1.5 2.5-2.2.5-.8 1.5h-3l-.8-1.5-2.2-.5L5 8c0-2.3.8-4.7 3-6.5ZM8 7.2a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2ZM7 13.5 8 15l1-1.5',
}

function PlanIcon({ kind }: { kind: keyof typeof ICONS }) {
  return (
    <svg className="sl-plan-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={ICONS[kind]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** What the site control's list offers under the sites: a custom point, and NASA's tools on this place. */
const CUSTOM = '__custom'
const TOOLS = '__tools'

/**
 * The plan: three compact controls, each one control with a small picture before it and no label
 * above it. The site (a custom point and NASA's tools are at the foot of its own list), the landing's
 * date and hour, and the mission (its preset's name, opening the Mission panel).
 */
export function Fields({ sites, site, onSite, landing, landingField, firstField, lastField, onPickDate, missionName, mission, missionOpen, onMission }: FieldsProps) {
  const groups = [...new Set(sites.map((listed) => listed.group))]
  // Places NASA names for landings still to come: in the list, but worked out like any custom point.
  const targets = useFutureTargets()
  const target = site ? targetAt(targets, site) : null
  // What the site's list opened under it: the form for a custom point, or NASA's tools on this place.
  const [more, setMore] = useState<typeof CUSTOM | typeof TOOLS | null>(null)
  return (
    <div className="sl-plan">
      <div className="sl-plan-row">
        <PlanIcon kind="site" />
        <select
          id="sl-site"
          aria-label="Landing site"
          value={site ? siteValue(site) : ''}
          title={target ? `Approximate region: the centre of ${target.feature} in the IAU Gazetteer. NASA names the place and gives no coordinates: “${target.says}” (NASA, ${target.source_date})` : undefined}
          onChange={(event) => {
            const value = event.target.value
            if (value === CUSTOM || value === TOOLS) setMore(more === value ? null : value)
            else {
              // NASA's tools stay open on the new place; the form for a custom point closes.
              setMore(more === TOOLS ? TOOLS : null)
              onSite(value)
            }
          }}
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {sites
                .filter((listed) => listed.group === group)
                .map((listed) => (
                  <option key={listed.id} value={listed.id}>
                    {listed.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {targets.length > 0 && (
            <optgroup label="Future targets (approximate region: the IAU centre of the place NASA names)">
              {targets.map((listed) => (
                <option key={listed.id} value={targetValue(listed)}>
                  {listed.name} · {listed.who}
                </option>
              ))}
            </optgroup>
          )}
          {site && isCustomSite(site) && !target && <option value={siteValue(site)}>{site.name}</option>}
          <optgroup label="More">
            <option value={CUSTOM}>Custom point…</option>
            <option value={TOOLS}>Open in NASA tools…</option>
          </optgroup>
        </select>
      </div>
      {more && (
        <div className="sl-plan-more">
          {more === CUSTOM ? (
            <Coordinates
              onSite={(value) => {
                setMore(null)
                onSite(value)
              }}
            />
          ) : (
            site && <OpenIn site={site} landingField={landingField} />
          )}
          <button type="button" className="sl-small" aria-label="Close" onClick={() => setMore(null)}>
            ×
          </button>
        </div>
      )}
      <div className="sl-plan-row">
        <PlanIcon kind="landing" />
        <LandingPick landing={landing} landingField={landingField} firstField={firstField} lastField={lastField} onPick={onPickDate} />
      </div>
      <div className="sl-plan-row">
        <PlanIcon kind="mission" />
        <button type="button" className="sl-mission-open" aria-expanded={missionOpen} aria-label={`Mission: ${missionName}`} title={mission} onClick={onMission}>
          <b>{missionName}</b> <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  )
}

/** A distance across the Moon in a few characters: "11 km", or "0.8 km" under ten. */
function kmWords(km: number): string {
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

interface VerdictProps {
  /** Why the landing doesn't fit, one line each; empty if it fits; null while it is being checked. */
  problems: string[] | null
  /** Why a landing that fits is only marginal, one line each; empty when it is not. */
  marginal: string[]
  /** The next landing that fits, when this one does not: how it reads ("1 June · 18:00"), and what choosing it does. */
  next: { when: string; adds: boolean; onTake: () => void } | null
  /** Another site of the same group where this date fits, when this one does not: its name, how far it is, and what choosing it does. */
  elsewhere: { name: string; km: number; adds: boolean; onTake: () => void } | null
  /** Ask Scout why, in his panel. */
  onWhy: () => void
  /** Open the Mission panel, where the limits behind the reasons are. */
  onMission: () => void
}

/** How many reasons the verdict lists before "and N more". */
const REASONS_SHOWN = 3

/**
 * The verdict on the landing, the column's headline and its largest text. It is worked out by the
 * app's rules: instant, the same for the same link, never the model's. "Fits the mission" (green,
 * with a tick), "Fits, marginal" (the Sun's gold), or "Does not fit the mission" (the warning
 * colour, with a cross). Under it, up to three reasons, one line each; then, only when it does not
 * fit, the next landing that does and the nearest site of the same group where this date does.
 * "Why?" asks Scout to explain it.
 */
export function Verdict({ problems, marginal, next, elsewhere, onWhy, onMission }: VerdictProps) {
  if (!problems) {
    return (
      <div className="sl-verdict is-checking">
        <p className="sl-verdict-line">Checking the landing…</p>
      </div>
    )
  }
  const fits = problems.length === 0
  const kind = !fits ? 'is-miss' : marginal.length > 0 ? 'is-marginal' : 'is-fit'
  const reasons = fits ? marginal : problems
  const more = reasons.length - REASONS_SHOWN
  return (
    <div className={`sl-verdict ${kind}`}>
      <p className="sl-verdict-line">
        <span className="sl-verdict-words">
          <span aria-hidden="true">{fits ? '✓' : '✗'}</span> {!fits ? 'Does not fit the mission' : marginal.length > 0 ? 'Fits, marginal' : 'Fits the mission'}
        </span>
        <button type="button" className="sl-link sl-why" title="Ask Scout why, and what would change it" onClick={onWhy}>
          Why?
        </button>
      </p>
      {reasons.length > 0 && (
        <ul className="sl-reasons">
          {reasons.slice(0, REASONS_SHOWN).map((reason) => (
            <li key={reason} title={reason}>
              {fits ? reason : shortReason(reason)}
            </li>
          ))}
          {more > 0 && (
            <li>
              <button type="button" className="sl-link" onClick={onMission}>
                and {more} more
              </button>
            </li>
          )}
        </ul>
      )}
      {next && (
        <button type="button" className="sl-next" title={next.adds ? 'Adds that landing as another scenario' : 'Four scenarios already: moves this landing there'} onClick={next.onTake}>
          Next landing that fits: {next.when} <span aria-hidden="true">›</span>
        </button>
      )}
      {elsewhere && (
        <button
          type="button"
          className="sl-next sl-elsewhere"
          title={`${elsewhere.name} is ${kmWords(elsewhere.km)} away. ${elsewhere.adds ? 'Adds it, on this date, as another scenario' : 'Four scenarios already: moves this landing there'}`}
          onClick={elsewhere.onTake}
        >
          Fits at {elsewhere.name} on this date <span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  )
}

/** The left column of the Plan frame: the question, then the answer. */
export function PlanColumn({ children }: { children: ReactNode }) {
  return (
    <aside className="sl-col" aria-label="Question and answer">
      {children}
    </aside>
  )
}
