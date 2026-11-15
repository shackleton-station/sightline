import { TOO_CLOSE_NOTE } from '../lib/starTie'
import { type CSSProperties, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { type FutureTarget, useFutureTargets } from '../data/futureTargets'
import type { FlaggedSite } from '../data/useAllFlags'
import { clockTime, fieldAt, hourFromField, stateRuns } from '../lib/sightline'
import { MAX_SCENARIOS, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { LandingPick } from './LandingPick'
import { fitHours, nextFit } from './plannerFit'
import type { PlannerGroup } from './plannerTable'
import { siteValue, targetAt, targetValue } from './site'
import { BAND } from './states'
import type { ScenarioFacts } from './useScenarioFacts'

interface Props {
  start: string
  /** How many hours the data on hand holds. */
  hours: number
  /** Every listed site with its hourly flags, at the mission's heights: the sites a column can be set to. */
  flagged: FlaggedSite[]
  scenarios: SightlineScenario[]
  facts: ScenarioFacts[]
  mission: SightlineMission
  groups: PlannerGroup[]
  active: number
  onSelect: (index: number) => void
  /** Change one scenario's site or landing, in place. */
  onChange: (index: number, scenario: SightlineScenario) => void
  onAdd: (scenario: SightlineScenario) => void
  onRemove: (index: number) => void
  /** The first and last hour of all the data, as a date field holds them; without them the years on hand bound a landing's date. */
  bounds?: { first: string; last: string }
  /** Move a scenario's landing to a date beyond the years on hand; false if the data does not cover it. */
  onFar?: (index: number, value: string) => boolean
}

/** How many days apart the labels under the aligned rows are, so about ten fit. */
function dayStep(missionDays: number): number {
  return Math.max(1, Math.ceil(missionDays / 10))
}

/**
 * The listed sites as a list's options, in their groups, then NASA's future targets, as the plan's
 * own list has them (each an approximate place, worked out in the browser like a custom point). A
 * custom point on show that is not one of them is named above the rest.
 */
function SiteOptions({ sites, custom, targets }: { sites: SiteInfo[]; custom: SiteInfo | null; targets: FutureTarget[] }) {
  const groups = [...new Set(sites.map((site) => site.group))]
  return (
    <>
      {custom && !targetAt(targets, custom) && <option value={siteValue(custom)}>{custom.name}</option>}
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {sites
            .filter((site) => site.group === group)
            .map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
        </optgroup>
      ))}
      {targets.length > 0 && (
        <optgroup label="Future targets (approximate)">
          {targets.map((target) => (
            <option key={target.id} value={targetValue(target)}>
              {target.name} · {target.who}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )
}

/**
 * Compare: "which of my picks is best?" One column per scenario, its site and date changed in
 * place in its header; the rows in groups, the verdict first; a last column that adds a scenario;
 * and under the table each mission from its own landing.
 */
export function PlannerCompare({ start, hours, flagged, scenarios, facts, mission, groups, active, onSelect, onChange, onAdd, onRemove, bounds, onFar }: Props) {
  const missionH = mission.requirements.missionDays * 24
  const step = dayStep(mission.requirements.missionDays)
  const sites = useMemo(() => flagged.map(({ site }) => site), [flagged])
  const targets = useFutureTargets()
  // A landing's date may be any the data covers: one beyond the years on hand loads them.
  const first = bounds?.first ?? fieldAt(start, 0)
  const last = bounds?.last ?? fieldAt(start, hours - 1)
  const room = scenarios.length < MAX_SCENARIOS
  const letter = SCENARIO_LETTERS[scenarios.length]

  // The scenario to add: a site, and a landing. Until one is chosen, the site on show at its next landing that fits.
  const shownSite = facts[active].site
  const [addSite, setAddSite] = useState<string | null>(null)
  const [addLanding, setAddLanding] = useState<number | null>(null)
  const site = sites.find((one) => one.id === addSite) ?? sites.find((one) => one.id === shownSite.id) ?? sites[0]
  const next = useMemo(() => {
    const at = flagged.find((one) => one.site.id === site.id)
    if (!at) return null
    return nextFit(fitHours(at.flags, mission, at.site.slope?.deg ?? null), scenarios[active].landing)
  }, [flagged, site, mission, scenarios, active])
  const landing = addLanding ?? next ?? scenarios[active].landing

  return (
    <div className="pl-compare" role="tabpanel" aria-label="Compare">
      <h3>Which of my picks is best?</h3>
      <div className="sl-full-scroll">
        <table className="sl-full-table pl-table" style={{ '--pl-columns': scenarios.length + (room ? 1 : 0) } as CSSProperties}>
          <thead>
            <tr>
              <td />
              {scenarios.map((scenario, i) => (
                <th key={i} scope="col">
                  {/* The letter at the left; the site, its landing and "remove" stacked beside it: the same shape however narrow the column. */}
                  <div className="sl-full-th">
                    <button type="button" className="sl-small" aria-pressed={i === active} aria-label={`Scenario ${SCENARIO_LETTERS[i]}`} onClick={() => onSelect(i)}>
                      {SCENARIO_LETTERS[i]}
                    </button>
                    <span className="pl-th">
                      <select aria-label={`Scenario ${SCENARIO_LETTERS[i]}: landing site`} value={siteValue(facts[i].site)} onChange={(event) => onChange(i, { ...scenario, site: event.target.value })}>
                        <SiteOptions sites={sites} custom={isCustomSite(facts[i].site) ? facts[i].site : null} targets={targets} />
                      </select>
                      <LandingPick
                        landing={clockTime(start, scenario.landing)}
                        landingField={fieldAt(start, scenario.landing)}
                        firstField={first}
                        lastField={last}
                        onPick={(value) => {
                          const picked = hourFromField(start, value, hours)
                          if (picked === null) return onFar ? onFar(i, value) : false
                          onChange(i, { ...scenario, landing: picked })
                          return true
                        }}
                      />
                    </span>
                    {scenarios.length > 1 && (
                      <button type="button" className="sl-link" aria-label={`Remove scenario ${SCENARIO_LETTERS[i]}`} onClick={() => onRemove(i)}>
                        remove
                      </button>
                    )}
                  </div>
                </th>
              ))}
              {room && (
                <th scope="col" className="pl-add-col">
                  <div className="sl-full-th">
                    <b aria-hidden="true">+</b>
                    <span className="pl-th">
                      <select
                        aria-label="Add scenario: landing site"
                        value={site.id}
                        onChange={(event) => {
                          setAddSite(event.target.value)
                          setAddLanding(null)
                        }}
                      >
                        <SiteOptions sites={sites} custom={null} targets={targets} />
                      </select>
                      <LandingPick
                        landing={clockTime(start, landing)}
                        landingField={fieldAt(start, landing)}
                        firstField={first}
                        lastField={last}
                        onPick={(value) => {
                          const picked = hourFromField(start, value, hours)
                          if (picked === null) return false
                          setAddLanding(picked)
                          return true
                        }}
                      />
                    </span>
                    <button
                      type="button"
                      className="sl-small pl-add-button"
                      title={addLanding === null && next !== null ? 'Adds this site at its next landing that fits the mission.' : undefined}
                      onClick={() => {
                        onAdd({ site: site.id, landing })
                        setAddSite(null)
                        setAddLanding(null)
                      }}
                    >
                      Add as {letter}
                    </button>
                  </div>
                </th>
              )}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.key} data-group={group.key}>
              {group.key !== 'verdict' && (
                <tr className="pl-group-row">
                  <th scope="colgroup" colSpan={scenarios.length + 1 + (room ? 1 : 0)}>
                    {group.name}
                  </th>
                </tr>
              )}
              {group.rows.map((row) => (
                <tr key={row.key} data-row={row.key}>
                  <th scope="row" title={row.title}>
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => {
                    const state = row.states?.[i]
                    // The verdict's cell is drawn in its state's color: green for a plain fit, orange for a marginal one, red for a miss.
                    const verdict = row.verdicts?.[i]
                    return (
                      <td key={i} className={[row.best[i] || verdict === 'fits' ? 'is-best' : '', verdict === 'marginal' ? 'is-marginal' : '', row.fits ? 'sl-full-fit' : ''].filter(Boolean).join(' ') || undefined} data-state={state ?? undefined} data-verdict={verdict ?? undefined}>
                        {state && (
                          <>
                            <i className={`sl-key is-${state}`} aria-hidden="true" />{' '}
                          </>
                        )}
                        {cell ?? '…'}
                        {row.best[i] && (
                          <span className="sl-best" title="The best of the scenarios in this row.">
                            {' '}
                            ★
                          </span>
                        )}
                        {row.notes[i] && <small> {row.notes[i]}</small>}
                      </td>
                    )
                  })}
                  {room && <td className="pl-add-col" />}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="sl-quiet">★ best in its row</p>
      {groups.some((group) => group.rows.some((row) => row.tooClose)) && <p className="sl-quiet sl-too-close">{TOO_CLOSE_NOTE}</p>}

      <h3>Each mission from its own landing</h3>
      <p className="sl-quiet">Days since landing. Every row starts at its own landing, so two landings can be compared band for band.</p>
      <div className="sl-aligned">
        {scenarios.map((scenario, i) => {
          const flags = facts[i].flags
          const end = Math.min(scenario.landing + missionH, hours)
          return (
            <div key={i} className="sl-row sl-aligned-row" data-first-hour={scenario.landing} data-hours={end - scenario.landing}>
              <span className="sl-row-name" title={`Scenario ${SCENARIO_LETTERS[i]} at ${facts[i].site.name}: its mission, from its landing on ${clockTime(start, scenario.landing)}.`}>
                {SCENARIO_LETTERS[i]} · {facts[i].site.name}
              </span>
              <div className="sl-track">
                <svg viewBox={`0 0 ${missionH} 12`} preserveAspectRatio="none" aria-hidden="true">
                  {flags &&
                    stateRuns(flags, scenario.landing, end).map((run) => (
                      <rect key={run.from} className={`sl-run is-${run.state}`} x={run.from} y={BAND[run.state].y} width={run.to - run.from} height={BAND[run.state].height} />
                    ))}
                </svg>
              </div>
            </div>
          )
        })}
        <div className="sl-row sl-axis" aria-hidden="true">
          <span />
          <div className="sl-track">
            {Array.from({ length: Math.floor(mission.requirements.missionDays / step) + 1 }, (_, n) => n * step).map((day) => (
              // The numbers next to "landing" and to the last day are the first to go where the row is narrow.
              <span key={day} className={day === mission.requirements.missionDays ? 'is-end' : day === step || (day > 0 && day + step >= mission.requirements.missionDays) ? 'is-near' : undefined} style={{ left: `${(100 * day) / mission.requirements.missionDays}%` }}>
                {day === 0 ? 'landing' : day === mission.requirements.missionDays ? `day ${day}` : day}
              </span>
            ))}
          </div>
        </div>
        <p className="sl-legend">
          <i className="sl-key is-sun" /> Sun <i className="sl-key is-earth" /> Earth <i className="sl-key is-both" /> Both <i className="sl-key is-none" /> Neither
        </p>
      </div>
    </div>
  )
}
