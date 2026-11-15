import { heightsWords, isBaseHeights } from '../lib/heights'
import { type ReactNode, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { hourOf, locateHour } from '../lib/mission'
import { SLIPS } from '../lib/slip'
import type { SightlineMission, SightlineScenario } from '../lib/sightlineMission'
import { defaultAddress } from '../planner/address'
import { Brief } from '../planner/Brief'
import { LandingSky } from '../planner/LandingSky'
import { briefWhy } from '../planner/why'
import { SlipCheck } from '../planner/SlipCheck'
import { usePlannerData } from '../planner/usePlannerData'
import { type Plan, usePlannerView } from '../planner/usePlannerView'
import '../planner/planner.css'
import '../planner/planner-brief.css'

interface Props {
  start: string
  /** The scenario on show: the brief is written for its site, its landing's month and its landing. */
  scenario: SightlineScenario
  site: SiteInfo
  mission: SightlineMission
  /** Whether there is room for another scenario ("Keep this option" adds one). */
  room: boolean
  /** Move the scenario on show to another landing, or another site. */
  onLanding: (landing: number, site?: string) => void
  onKeep: (scenario: SightlineScenario) => void
  onClose: () => void
  /** Where closing leads: the screen the brief was opened from. The button says so. */
  backTo?: 'the Moon' | 'the Planner'
  /** A saved plan's own brief, shown first when the screen was opened from its short link. */
  saved?: ReactNode
}

/** The slip first asked about: the app's shortest listed delay, a week. */
const FIRST_SLIP_DAYS = SLIPS[0].days ?? 7

/**
 * The written brief for the scenario on show, as a sheet over the scene: the app's own landing
 * brief (the Planner page's), worked out by the same functions, for this site, month and landing.
 * Its buttons move the scenario on show. It is written for listed sites only.
 */
export default function BriefSheet({ start, scenario, site, mission, room, onLanding, onKeep, onClose, backTo = 'the Moon', saved = null }: Props) {
  const data = usePlannerData()
  const [slipDays, setSlipDays] = useState(FIRST_SLIP_DAYS)
  const [kept, setKept] = useState(false)
  const fallback = useMemo(() => defaultAddress(mission.requirements), [mission.requirements])
  const at = locateHour(start, scenario.landing)
  const plan: Plan = useMemo(
    () => ({ site: site.id, month: at.month, index: at.index, requirements: mission.requirements, shortlist: [], kept: { b: null, view3d: false } }),
    [site.id, at.month, at.index, mission.requirements],
  )
  const sites = data.status === 'ready' ? data.sites : null
  const view = usePlannerView(isCustomSite(site) ? null : sites, plan, fallback, slipDays)
  const link = window.location.href
  const why = useMemo(() => (view ? briefWhy(view.row.flags, view.answer.span, view.viable, view.answer.days, mission.requirements) : null), [view, mission.requirements])

  return (
    <div className="sl-how sl-brief-sheet planner" role="dialog" aria-modal="true" aria-label="Landing brief">
      <div className="sl-brief-bar">
        <button type="button" className="sl-small" onClick={() => window.print()}>
          Print the brief
        </button>
        <button type="button" className="sl-small" onClick={onClose}>
          Back to {backTo}
        </button>
      </div>
      {saved}
      {/* The brief is written from the app's own 2 m numbers: it says so when other heights are chosen. */}
      {!isCustomSite(site) && !isBaseHeights(mission.heights) && (
        <p className="sl-quiet sl-brief-heights">This brief is written for 2 m above the ground. Your heights ({heightsWords(mission.heights)}) are not applied to it.</p>
      )}
      {isCustomSite(site) ? (
        <p className="sl-brief-wait">The brief is written for the listed sites. Choose one under "At", or the nearest listed site, to read its brief.</p>
      ) : !view || data.status !== 'ready' ? (
        <p className="sl-brief-wait">{data.status === 'error' ? 'The brief could not be worked out. Close it and try again.' : 'Writing the brief…'}</p>
      ) : (
        <Brief
          site={view.row.site}
          month={view.month}
          requirements={mission.requirements}
          start={start}
          answer={view.answer}
          landing={view.landing}
          others={view.others}
          obsHeightM={data.obsHeightM}
          link={link}
          kept={kept || !room}
          onKeep={() => {
            onKeep({ site: site.id, landing: view.landing.hour })
            setKept(true)
          }}
          onDay={(day) => {
            // The day's first landing hour that works, or its midnight if none does.
            const first = Array.from({ length: 24 }, (_, h) => view.answer.span.from + day * 24 + h).find((hour) => view.viable[hour] === 1)
            onLanding(first ?? view.answer.span.from + day * 24)
          }}
          onUseBest={() => onLanding(view.answer.best.hour)}
          onPick={(siteId, month) => onLanding(hourOf(start, `${month}-01T00:00:00Z`), siteId)}
          sky={<LandingSky site={view.row.site} flags={view.row.flags} t={view.landing.t} requirements={mission.requirements} />}
          why={why}
        >
          <SlipCheck check={view.check} landing={view.landing} onDays={setSlipDays} late={view.late} onPlan={(siteId, t) => onLanding(hourOf(start, t), siteId ?? undefined)} />
        </Brief>
      )}
    </div>
  )
}
