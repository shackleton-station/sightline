import { useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { CUSTOM_GROUP, customSiteInfo } from '../data/customSite'
import type { ScenarioData } from '../data/scenarioData'
import { AnswerCard } from '../components/AnswerCard'
import { DownloadCsv } from '../components/DownloadCsv'
import { EarthVsMoon } from '../components/EarthVsMoon'
import { Explainer } from '../components/Explainer'
import { LandingGrid } from '../components/LandingGrid'
import { MastHeights } from '../components/MastHeights'
import { MissionCheck } from '../components/MissionCheck'
import { MissionInputs } from '../components/MissionInputs'
import { NearbyMap } from '../components/NearbyMap'
import { PowerBudget } from '../components/PowerBudget'
import { Shortlist } from '../components/Shortlist'
import { SlipPanel } from '../components/SlipPanel'
import { SpreadNote } from '../components/SpreadNote'
import { SummaryCard } from '../components/SummaryCard'
import { Timeline } from '../components/Timeline'
import { TrustNotes } from '../components/TrustNotes'
import { YearStrip } from '../components/YearStrip'
import { meanSunElevationUp } from '../lib/compare'
import { explainerTitle } from '../lib/explainer'
import type { SiteFlags } from '../lib/flags'
import { locateHour } from '../lib/mission'
import { monthLabel } from '../lib/months'
import { nearbyAnchor } from '../lib/nearby'
import { panelSunlight } from '../lib/power'
import { addEntries, entryAt, type ShortlistEntry } from '../lib/shortlist'
import { BOTH_UP } from '../lib/slip'
import { useView, useViewDispatch } from '../state/useView'

export type PanelTab = 'now' | 'land' | 'learn'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'land', label: 'When to land' },
  { id: 'learn', label: 'Learn' },
]

interface Props {
  data: ScenarioData
  index: number
  flags: SiteFlags | null
  flagsFailed: boolean
  /** Go to a site, month and hour. */
  onOpen: (site: SiteInfo, month: string, index: number) => void
  onClose: () => void
}

/**
 * Everything about the place that isn't the picture, in three tabs. Each thing lives in one tab
 * only: the hour in Now, landing in When to land, and the why in Learn.
 */
export function MissionPanel({ data, index, flags, flagsFailed, onOpen, onClose }: Props) {
  const [tab, setTab] = useState<PanelTab>('now')
  const { sites, a: scenario, requirements, mode, shortlist } = useView()
  const dispatch = useViewDispatch()
  if (!scenario) return null

  const plan = mode === 'plan'
  const now = data.track[index]
  const anchor = nearbyAnchor(data.site, sites)
  const gridSites = scenario.custom ? [...sites, scenario.custom] : sites
  const here: ShortlistEntry = {
    site: data.site.group === CUSTOM_GROUP ? `${data.site.lat},${data.site.lon}` : data.site.id,
    at: entryAt(now.t),
  }
  const setShortlist = (next: ShortlistEntry[]) => dispatch({ type: 'setShortlist', shortlist: next })
  const setMonth = (month: string) => dispatch({ type: 'setScenario', side: 'a', scenario: { ...scenario, month } })
  const sunlight = panelSunlight(data.track)

  return (
    <aside className={tab === 'land' ? 'mc-panel wide' : 'mc-panel'} aria-label="Mission panel">
      <div className="mc-tabs" role="tablist" aria-label="About this place">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <button type="button" className="mc-panel-close" aria-label="Hide the panel" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="mc-panel-body" role="tabpanel">
        {tab === 'now' && (
          <>
            {/* In Learn the line on the picture already says this; Plan adds the angles a planner needs. */}
            {plan && <AnswerCard data={data} index={index} flags={flags} flagsFailed={flagsFailed} requirements={requirements} mode={mode} />}
            <SummaryCard summary={data.summary} meanSunElevationDeg={meanSunElevationUp(data)} sunlight={sunlight} plan={plan} />
            <h2>Pick another month</h2>
            <YearStrip year={data.year} month={scenario.month} onSelect={setMonth} />
          </>
        )}

        {tab === 'land' && (
          <>
            {plan && (
              <>
                <h2>Your mission's limits</h2>
                <MissionInputs value={requirements} onChange={(next) => dispatch({ type: 'setRequirements', requirements: next })} />
                <MissionCheck data={data} index={index} requirements={requirements} onJump={(month, target) => onOpen(data.site, month, target)} />
              </>
            )}
            <SlipPanel
              data={data}
              index={index}
              flags={flags}
              sites={sites}
              requirements={plan ? requirements : BOTH_UP}
              plan={plan}
              onGo={onOpen}
              onShortlist={(iso) => setShortlist(addEntries(shortlist, [{ site: here.site, at: entryAt(iso) }]))}
            />
            <h2>Every site, every month</h2>
            <LandingGrid sites={gridSites} siteId={scenario.siteId} month={data.month} requirements={requirements} mode={mode} onOpen={onOpen} />
            {plan && (
              <>
                <h2>Shortlist</h2>
                <Shortlist
                  sites={sites}
                  list={shortlist}
                  current={here}
                  requirements={requirements}
                  onChange={setShortlist}
                  onAdd={(entries) => setShortlist(addEntries(shortlist, entries))}
                  onOpen={(site, iso) => {
                    const place = locateHour(iso, 0)
                    onOpen(site, place.month, place.index)
                  }}
                />
              </>
            )}
            {anchor && (
              <>
                <h2>The ground around this site</h2>
                <NearbyMap
                  anchor={anchor}
                  point={data.site}
                  month={data.month}
                  mode={mode}
                  onOpen={(lat, lon) => {
                    if (lat === anchor.lat && lon === anchor.lon) {
                      dispatch({ type: 'setScenario', side: 'a', scenario: { siteId: anchor.id, month: scenario.month } })
                    } else {
                      const custom = customSiteInfo(lat, lon)
                      dispatch({ type: 'setScenario', side: 'a', scenario: { siteId: custom.id, month: scenario.month, custom } })
                    }
                  }}
                />
              </>
            )}
          </>
        )}

        {tab === 'learn' && (
          <>
            <h2>{explainerTitle(data)}</h2>
            <Explainer data={data} />
            <h2>When each is up in {monthLabel(data.month)}</h2>
            <Timeline summary={data.summary} track={data.track} index={index} onSelect={(next) => dispatch({ type: 'setIndex', index: next })} />
            <SpreadNote data={data} plan={plan} />
            <h2>A day on Earth, and a day here</h2>
            <EarthVsMoon data={data} index={index} onIndexChange={(next) => dispatch({ type: 'setIndex', index: next })} />
            {plan && (
              <>
                <h2>Power through the dark</h2>
                <PowerBudget verticalSunlightWm2={sunlight.vertical} longestSunGapH={data.summary.max_sun_gap_h} />
                <h2>Would a taller mast help?</h2>
                <MastHeights site={data.site} year={Number(data.month.slice(0, 4))} />
              </>
            )}
            <h2>How far to trust this</h2>
            <TrustNotes data={data} />
            <DownloadCsv siteId={data.site.id} month={data.month} track={data.track} />
          </>
        )}
      </div>
    </aside>
  )
}
