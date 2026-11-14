import { type CSSProperties, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { customSiteInfo } from '../data/customSite'
import { hourOf } from '../lib/mission'
import { isoAt } from '../lib/sightline'
import type { SightlineMission, SightlineScenario } from '../lib/sightlineMission'
import { SLIPS } from '../lib/slip'
import { defaultAddress } from '../planner/address'
import { DayStrip } from '../planner/DayStrip'
import type { PlannerSite } from '../planner/plannerModel'
import { SlipCheck } from '../planner/SlipCheck'
import { type Plan, usePlannerView } from '../planner/usePlannerView'
import { PlannerAlternatives } from './PlannerAlternatives'
import { PlannerNearby } from './PlannerNearby'
import { siteValue } from './site'
import './plannerHost.css'

interface Props {
  start: string
  /** Every site the grid lists, with its hourly flags: the listed ones and the visitor's own points. */
  sites: PlannerSite[]
  /** The site and month opened under the grid, and the landing "Add" would take, in clock hours. */
  site: SiteInfo
  month: string
  landing: number
  mission: SightlineMission
  /** The next scenario's letter, or null when there are four already. */
  letter: string | null
  /** Choose another landing hour in this month: a day of the month was pressed. */
  onLanding: (hour: number) => void
  /** Open another site or month under the grid, at a landing hour: a suggestion, or the next landing after a slip. */
  onOpen: (siteId: string, hour: number) => void
  onAdd: (scenario: SightlineScenario) => void
}

/** How many days of slip are asked about at first: the page's first choice. */
const FIRST_SLIP_DAYS = SLIPS[0].days ?? 7

/**
 * The rest of what Find's strip says about one site and month, with the detail of the detailed
 * planner: each day of the month with its landing hours, what happens if the landing slips, other
 * landings near it in place and time, and, at a site whose surroundings are mapped, how much a few
 * meters change.
 *
 * Every part is the detailed planner's own component, imported and given this strip's site, month
 * and landing (`usePlannerView` works them out as that planner does). They are drawn inside a
 * wrapper that gives them the colors they expect (`plannerHost.css`); none of their files is changed.
 * They do not know the mission's slope limit, so the strip does not show them for a site that is
 * too steep.
 */
export function PlannerFindMore({ start, sites, site, month, landing, mission, letter, onLanding, onOpen, onAdd }: Props) {
  const [slipDays, setSlipDays] = useState(FIRST_SLIP_DAYS)
  const requirements = mission.requirements
  const row = sites.find((one) => one.site.id === site.id)
  const monthStart = useMemo(() => hourOf(start, `${month}-01T00:00:00Z`), [start, month])
  const plan: Plan = useMemo(
    () => ({ site: site.id, month, index: landing - monthStart, requirements, shortlist: [], kept: { b: null, view3d: false } }),
    [site.id, month, landing, monthStart, requirements],
  )
  const fallback = useMemo(() => defaultAddress(requirements), [requirements])
  const view = usePlannerView(row ? sites : null, plan, fallback, slipDays)
  if (!view || view.row.site.id !== site.id || view.month !== month) return <p className="sl-quiet">Reading the month…</p>

  const dayOf = (hour: number) => Math.floor((hour - view.answer.span.from) / 24)
  const add = (at: SiteInfo, iso: string) => onAdd({ site: siteValue(at), landing: hourOf(start, iso) })
  return (
    <div className="plh plh-strip planner" data-days={view.answer.days}>
      <section className="plh-part plh-days" aria-label="The days of the month">
        <h5>Each day’s landing hours</h5>
        <p className="sl-quiet">A taller bar has more hours when a landing fits. Press a day to plan the landing on its first such hour.</p>
        <DayStrip
          month={month}
          answer={view.answer}
          plannedDay={dayOf(view.landing.hour)}
          bestDay={null}
          onDay={(day) => {
            // The day's first hour when a landing fits; a day with none is not a landing to plan.
            const first = Array.from({ length: 24 }, (_, h) => view.answer.span.from + day * 24 + h).find((hour) => view.viable[hour] === 1)
            if (first !== undefined) onLanding(first)
          }}
        />
      </section>

      <section className="plh-part plh-slip" aria-label="If the landing slips">
        <SlipCheck check={view.check} landing={view.landing} onDays={setSlipDays} late={view.late} onPlan={(siteId, t) => onOpen(siteId ?? site.id, hourOf(start, t))} />
      </section>

      {/* The detailed planner's suggestions, without its cards for the scenarios (they are on Compare):
          "Open" shows one here, and its second button adds it as the next scenario. */}
      <section className="plh-part plh-sugs sl-np" aria-label="Other landings near this one" style={{ '--plh-add': letter ? `"Add as ${letter}"` : '"Four at most"' } as CSSProperties}>
        <PlannerAlternatives
          sites={sites}
          requirements={requirements}
          maxSlopeDeg={mission.maxSlopeDeg}
          landing={view.landing.t}
          siteId={site.id}
          kept={[]}
          room={letter !== null}
          onOpen={(siteId, iso) => onOpen(siteId, hourOf(start, iso))}
          onKeep={add}
        />
      </section>

      {/* Only where the ground around the site is mapped; the heading is this Planner's, in its own spelling. */}
      {site.nearby_half_m ? (
      <section className="plh-part plh-nearby" aria-label="The ground around the site">
        <h5>A few meters make a difference</h5>
        <PlannerNearby
          site={site}
          month={month}
          onSpot={(lat, lon) => {
            if (letter === null) return
            const atSite = Math.abs(lat - site.lat) < 1e-6 && Math.abs(lon - site.lon) < 1e-6
            add(atSite ? site : customSiteInfo(lat, lon), isoAt(start, landing))
          }}
        />
      </section>
      ) : null}
    </div>
  )
}
