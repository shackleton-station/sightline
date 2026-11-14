import { useState } from 'react'
import type { SiteInfo, Summary } from '../data/contract'
import { ANTENNA_HEIGHTS_M, HEIGHT_MEANS, type MissionHeights, PANEL_HEIGHTS_M } from '../lib/heights'
import { MISSION_RANGES, PRESETS, presetOf, type SightlineMission } from '../lib/sightlineMission'
import { Dial } from '../planner/MissionBar'
import { Assumptions } from './MissionDrawer'

interface Props {
  mission: SightlineMission
  onMission: (mission: SightlineMission) => void
  site: SiteInfo
  month: string
  year: number
  summary: Summary | null
  /** Why the heights can't be chosen here (a custom point is worked out at 2 m only), or null. */
  heightsOff: string | null
}

const { min: SLOPE_MIN, max: SLOPE_MAX, step: SLOPE_STEP } = MISSION_RANGES.maxSlopeDeg
const SLOPE_STOPS = Array.from({ length: Math.floor((SLOPE_MAX - SLOPE_MIN) / SLOPE_STEP) + 1 }, (_, i) => SLOPE_MIN + i * SLOPE_STEP)

/** A few heights as one row of buttons, the chosen one pressed; each says in its hover text what stands that high. */
function Heights({ label, offered, value, disabled, onPick }: { label: string; offered: number[]; value: number; disabled: boolean; onPick: (heightM: number) => void }) {
  return (
    <div className="pl-more-field" role="group" aria-label={label}>
      <span className="pl-label">{label}</span>
      <span className="pl-segments">
        {offered.map((heightM) => (
          <button key={heightM} type="button" aria-pressed={value === heightM} disabled={disabled} title={HEIGHT_MEANS[heightM]} onClick={() => onPick(heightM)}>
            {heightM} m
          </button>
        ))}
      </span>
    </div>
  )
}

/**
 * The rest of the mission, in the Planner page's look and folded under its bar: an example mission
 * to start from, the steepest ground the lander can stand on, and how high its solar panel and
 * antenna stand. What the bar above already holds is not repeated here.
 */
export function PlannerMore({ mission, onMission, site, month, year, summary, heightsOff }: Props) {
  const [open, setOpen] = useState(false)
  const preset = presetOf(mission)
  const setHeights = (change: Partial<MissionHeights>) => onMission({ ...mission, heights: { ...mission.heights, ...change } })
  return (
    <section className="pl-more" aria-label="More mission settings">
      <button type="button" className="pl-more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="pl-label">More settings</span>
        <span className="pl-more-summary">
          {preset ? `${preset.label} example` : 'Your own mission'} · ground up to {mission.maxSlopeDeg}° · panel {mission.heights.panelM} m · antenna {mission.heights.antennaM} m
        </span>
        <span className="pl-more-chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="pl-more-body">
          <div className="pl-more-field" role="group" aria-label="Example missions">
            <span className="pl-label">Start from an example</span>
            <span className="pl-segments">
              {PRESETS.map((option) => (
                <button key={option.id} type="button" aria-pressed={preset?.id === option.id} title="Sets every limit to this example; change any of them after" onClick={() => onMission({ ...option.mission, heights: mission.heights })}>
                  {option.label}
                </button>
              ))}
            </span>
          </div>
          <Dial id="pl-slope" label="Steepest ground" unit="°" value={mission.maxSlopeDeg} bounds={[SLOPE_MIN, SLOPE_MAX]} stops={SLOPE_STOPS} onChange={(maxSlopeDeg) => onMission({ ...mission, maxSlopeDeg })} />
          <Heights label="Solar panel height" offered={PANEL_HEIGHTS_M} value={mission.heights.panelM} disabled={heightsOff !== null} onPick={(panelM) => setHeights({ panelM })} />
          <Heights label="Antenna height" offered={ANTENNA_HEIGHTS_M} value={mission.heights.antennaM} disabled={heightsOff !== null} onPick={(antennaM) => setHeights({ antennaM })} />
          <div className="pl-more-notes">
            {heightsOff && <p>{heightsOff}</p>}
            <Assumptions site={site} month={month} year={year} summary={summary} heights={mission.heights} choice />
          </div>
        </div>
      )}
    </section>
  )
}
