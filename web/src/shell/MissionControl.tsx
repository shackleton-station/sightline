import { useCallback, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { CUSTOM_GROUP } from '../data/customSite'
import type { ScenarioData } from '../data/scenarioData'
import { useSiteFlagsState } from '../data/useSiteFlags'
import { HorizonPanorama } from '../components/HorizonPanorama'
import { ModeToggle } from '../components/ModeToggle'
import { Moon3DSection } from '../components/Moon3DSection'
import { ScenarioPicker } from '../components/ScenarioPicker'
import { SharePlan } from '../components/SharePlan'
import { SiteTabs } from '../components/SiteTabs'
import { opens3dFirst, readDeviceHints } from '../lib/device'
import { hourOf, landingProblems, missionEarth, viableHours } from '../lib/mission'
import { monthLabel } from '../lib/months'
import { runsWithin } from '../lib/river'
import { useView, useViewDispatch } from '../state/useView'
import { hashOf } from '../state/viewStore'
import { MissionPanel } from './MissionPanel'
import { StatusLine } from './StatusLine'
import { RiverKey, TimeRiver } from './TimeRiver'
import './shell.css'

interface Props {
  data: ScenarioData
}

/**
 * The site page as mission control: the place fills the window, the answer sits on it in one line,
 * one river at the bottom controls time, and everything else is a panel that can be put away.
 */
export function MissionControl({ data }: Props) {
  const view = useView()
  const { sites, a: scenario, index, requirements, view3d, mode } = view
  const dispatch = useViewDispatch()
  const { flags, failed: flagsFailed } = useSiteFlagsState(data.site)
  const [panelOpen, setPanelOpen] = useState(true)

  const plan = mode === 'plan'
  const shown = Math.min(index, data.track.length - 1)
  const now = data.track[shown]
  const lastYear = data.year.years[data.year.years.length - 1].year
  const setIndex = useCallback((next: number) => dispatch({ type: 'setIndex', index: next }), [dispatch])

  // Where this month sits in the page's years of hourly flags.
  const monthStart = flags ? hourOf(flags.start, data.track[0].t) : 0
  const viable = useMemo(
    () => (flags && plan ? viableHours(flags.sun, missionEarth(flags, requirements), requirements) : null),
    [flags, plan, requirements],
  )
  const landing = useMemo(() => runsWithin(viable, monthStart, data.track.length), [viable, monthStart, data.track.length])
  const problems =
    plan && flags ? landingProblems(flags.sun, missionEarth(flags, requirements), monthStart + shown, requirements) : null

  if (!scenario) return null

  const open = (site: SiteInfo, month: string, target: number) => {
    const custom = site.group === CUSTOM_GROUP ? site : undefined
    dispatch({
      type: 'setScenario',
      side: 'a',
      scenario: site.id === data.site.id ? { ...scenario, month } : { siteId: site.id, month, custom },
    })
    dispatch({ type: 'setIndex', index: target })
  }
  const months = data.year.months.map((row) => row.month)
  const monthStep = (step: number) => {
    const target = months[months.indexOf(scenario.month) + step]
    return {
      label: target ? monthLabel(target).split(' ')[0] : '',
      onClick: target ? () => dispatch({ type: 'setScenario', side: 'a', scenario: { ...scenario, month: target } }) : null,
    }
  }

  return (
    <div className="mc">
      <SiteTabs current="mission" view={hashOf(view)} />
      <header className="mc-top">
        <button type="button" className="mc-home" aria-label="Back to the whole Moon" onClick={() => dispatch({ type: 'openLanding' })}>
          <span aria-hidden="true">◐</span> <span className="mc-wide-only">Whole Moon</span>
        </button>
        <div className="mc-site">
          <ScenarioPicker
            sites={sites}
            scenario={scenario}
            onChange={(next) => dispatch({ type: 'setScenario', side: 'a', scenario: next })}
            brief
          />
        </div>
        <div className="mc-top-actions">
          <ModeToggle mode={mode} onChange={(next) => dispatch({ type: 'setMode', mode: next })} />
          <span className="mc-wide-only">
            <SharePlan view={hashOf(view)} suggestedTitle={`${data.site.name}, ${monthLabel(data.month)}`} />
          </span>
          <button type="button" className="mc-wide-only" onClick={() => dispatch({ type: 'openCompare' })}>
            Compare
          </button>
          <button type="button" className="mc-wide-only" onClick={() => dispatch({ type: 'startTour', open3d: opens3dFirst(readDeviceHints()) })}>
            ▶ Tour
          </button>
          <button type="button" className="mc-wide-only" onClick={() => dispatch({ type: 'setPage', page: 'how' })}>
            How it works
          </button>
          {!panelOpen && (
            <button type="button" className="mc-panel-open" onClick={() => setPanelOpen(true)}>
              Details
            </button>
          )}
        </div>
      </header>

      <div className={panelOpen ? 'mc-body with-panel' : 'mc-body'}>
        <main className="mc-stage">
          {view3d ? (
            <Moon3DSection site={data.site} now={now} obsHeightM={data.summary.obs_height_m} />
          ) : (
            <div className="mc-horizon">
              <HorizonPanorama horizon={data.horizon} track={data.track} index={shown} />
            </div>
          )}
          <StatusLine siteName={data.site.name} month={data.month} now={now} flags={flags} lastYear={lastYear} problems={problems} />
          <div className="mc-views" role="group" aria-label="View">
            <button type="button" aria-pressed={view3d} onClick={() => dispatch({ type: 'setView3d', view3d: true })}>
              3D ground
            </button>
            <button type="button" aria-pressed={!view3d} onClick={() => dispatch({ type: 'setView3d', view3d: false })}>
              Horizon
            </button>
          </div>
        </main>
        {panelOpen && (
          <MissionPanel data={data} index={shown} flags={flags} flagsFailed={flagsFailed} onOpen={open} onClose={() => setPanelOpen(false)} />
        )}
      </div>

      <footer className="mc-river">
        <TimeRiver
          track={data.track}
          index={shown}
          onIndex={setIndex}
          landing={plan && flags ? landing : undefined}
          missionHours={plan ? requirements.missionDays * 24 : undefined}
          previous={monthStep(-1)}
          next={monthStep(1)}
        />
        <RiverKey landing={plan} />
      </footer>
    </div>
  )
}
