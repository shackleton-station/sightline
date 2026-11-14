import { useEffect, useState } from 'react'
import type { MastHeight, SiteInfo, SiteSpread, Summary } from '../data/contract'
import { loadMastHeights, loadSpread } from '../data/loadSite'
import { ANTENNA_HEIGHTS_M, HEIGHT_MEANS, heightsWords, isBaseHeights, type MissionHeights, PANEL_HEIGHTS_M } from '../lib/heights'
import type { Requirements } from '../lib/mission'
import { CLEARANCE_CHOICES_DEG, MISSION_RANGES, NO_LIMIT_H, PRESETS, presetOf, SILENCE_NO_LIMIT_STOP, SILENCE_RANGE, type SightlineMission, silenceHours, silenceStop } from '../lib/sightlineMission'
import { accuracyNote, heightNote } from '../lib/sightlineNotes'

interface Props {
  mission: SightlineMission
  onMission: (mission: SightlineMission) => void
  site: SiteInfo
  /** The month and year on the clock, for what the notes under Advanced say. */
  month: string
  year: number
  /** The month's summary at the site; null while it loads. */
  summary: Summary | null
  /** Why the two heights cannot be chosen here (a custom point is worked out at 2 m only); null when they can. */
  heightsOff: string | null
  onClose: () => void
}

interface SliderProps {
  id: string
  label: string
  value: number
  unit: string
  range: { min: number; max: number; step: number }
  /** What to show for the value when it is not a number with its unit: "No limit" at a slider's last stop. */
  text?: string
  onChange: (value: number) => void
}

function Slider({ id, label, value, unit, range, text, onChange }: SliderProps) {
  return (
    <div className="sl-param">
      <div className="sl-param-top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{text ?? `${value}${unit}`}</output>
      </div>
      <input id={id} type="range" min={range.min} max={Math.max(range.max, value)} step={range.step} value={value} aria-valuetext={text ?? `${value}${unit}`} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}

/** One height to choose from a few, each a button that says in its hover text what stands that high and where the figure is from. */
function HeightPick({ label, offered, value, disabled, onPick }: { label: string; offered: number[]; value: number; disabled: boolean; onPick: (heightM: number) => void }) {
  return (
    <div className="sl-height-pick" role="group" aria-label={label}>
      <span>{label}</span>
      <span className="sl-height-choices">
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
 * How high the solar panel and the antenna stand: the Sun is read at the first height and Earth at
 * the second. A custom point is worked out at 2 m, so there the choice is off.
 */
function HeightChoice({ mission, onMission, off }: Pick<Props, 'mission' | 'onMission'> & { off: string | null }) {
  const set = (change: Partial<MissionHeights>) => onMission({ ...mission, heights: { ...mission.heights, ...change } })
  return (
    <div className="sl-param sl-height-choice">
      <HeightPick label="Solar panel height" offered={PANEL_HEIGHTS_M} value={mission.heights.panelM} disabled={off !== null} onPick={(panelM) => set({ panelM })} />
      <HeightPick label="Antenna height" offered={ANTENNA_HEIGHTS_M} value={mission.heights.antennaM} disabled={off !== null} onPick={(antennaM) => set({ antennaM })} />
      {off && <p className="sl-quiet">{off}</p>}
    </div>
  )
}

/**
 * What the hourly numbers assume: the height above the ground and how close the landing comes.
 * Where the heights can be chosen the first note is left to the choice itself.
 */
export function Assumptions({ site, month, year, summary, heights, choice }: Pick<Props, 'site' | 'month' | 'year' | 'summary'> & { heights: MissionHeights; choice: boolean }) {
  const [loaded, setLoaded] = useState<{ siteId: string; heights: MastHeight[] | null; spread: SiteSpread | null } | null>(null)
  useEffect(() => {
    let current = true
    Promise.all([loadMastHeights(site).catch(() => null), loadSpread(site).catch(() => null)]).then(([heights, spread]) => {
      if (current) setLoaded({ siteId: site.id, heights, spread })
    })
    return () => {
      current = false
    }
  }, [site])
  const here = loaded?.siteId === site.id ? loaded : null
  // Until the site's files arrive the notes give the figure they are sure of, and nothing more.
  return (
    <div className="sl-assume">
      {!choice && <p>{!isBaseHeights(heights) ? `Height above ground: ${heightsWords(heights)}, chosen in the Planner.` : summary ? heightNote(here?.heights ?? null, year, summary.obs_height_m) : 'Height above ground: …'}</p>}
      <p>
        {here ? accuracyNote(here.spread, month, summary) : 'Landing accuracy: …'}
        {here?.spread && !isBaseHeights(heights) ? ' These figures are for 2 m.' : ''}
      </p>
    </div>
  )
}

/** The presets and the six basic limits: what the Mission panel holds, and the Planner's left side. */
export function MissionControls({ mission, onMission }: Pick<Props, 'mission' | 'onMission'>) {
  const { requirements } = mission
  const preset = presetOf(mission)
  const limit = (change: Partial<Requirements>) => onMission({ ...mission, requirements: { ...requirements, ...change } })
  return (
    <>
      <p className="sl-quiet">What the lander can tolerate.</p>
      <div className="sl-presets" role="group" aria-label="Presets">
        {PRESETS.map((option) => (
          <button key={option.id} type="button" aria-pressed={preset?.id === option.id} onClick={() => onMission({ ...option.mission, heights: mission.heights })}>
            {option.label} <small>example</small>
          </button>
        ))}
        <button type="button" aria-pressed={preset === null} disabled={preset !== null} title="Change any value below to make the mission your own">
          Custom
        </button>
      </div>

      <Slider id="sl-m-days" label="Mission length" value={requirements.missionDays} unit=" days" range={MISSION_RANGES.missionDays} onChange={(missionDays) => limit({ missionDays })} />
      <Slider id="sl-m-dark" label="Longest darkness it survives" value={requirements.maxSunGapH} unit=" h" range={MISSION_RANGES.maxSunGapH} onChange={(maxSunGapH) => limit({ maxSunGapH })} />
      <label className="sl-check sl-param">
        <input type="checkbox" checked={requirements.sunAtLanding} onChange={(event) => limit({ sunAtLanding: event.target.checked })} /> The Sun is up at landing
      </label>
      <label className="sl-check sl-param">
        <input type="checkbox" checked={requirements.earthAtLanding} onChange={(event) => limit({ earthAtLanding: event.target.checked })} /> Earth is in view at landing
      </label>
      <Slider
        id="sl-m-silence"
        label="Longest radio silence"
        value={silenceStop(requirements.maxEarthGapH)}
        unit=" h"
        text={requirements.maxEarthGapH >= NO_LIMIT_H ? 'No limit' : `${requirements.maxEarthGapH} h`}
        range={{ ...SILENCE_RANGE, max: SILENCE_NO_LIMIT_STOP }}
        onChange={(stop) => limit({ maxEarthGapH: silenceHours(stop) })}
      />
      <Slider id="sl-m-slope" label="Steepest ground" value={mission.maxSlopeDeg} unit="°" range={MISSION_RANGES.maxSlopeDeg} onChange={(maxSlopeDeg) => onMission({ ...mission, maxSlopeDeg })} />
    </>
  )
}

/**
 * The mission's limits in the column, under the mission's own control: the presets and the six basic
 * limits, set two abreast so the Sun, Earth and ground under them stay on a laptop's screen. The
 * Advanced controls stay in the Mission panel, which the link here opens.
 */
export function MissionInline({ mission, onMission, onAdvanced }: Pick<Props, 'mission' | 'onMission'> & { onAdvanced: () => void }) {
  return (
    <div className="sl-mission-inline" role="group" aria-label="Mission limits">
      <MissionControls mission={mission} onMission={onMission} />
      <button type="button" className="sl-link sl-advanced-link" onClick={onAdvanced}>
        Advanced <span aria-hidden="true">›</span>
      </button>
    </div>
  )
}

/**
 * The mission's Advanced controls, as a panel: the same ones as the Planner, on the same mission. How
 * far Earth must clear the skyline, and how high the solar panel and the antenna stand. The presets
 * and the six basic limits are in the column, under the mission's own control (`MissionInline`),
 * whose "Advanced" link opens this.
 */
export function MissionDrawer({ mission, onMission, heightsOff, site, month, year, summary, onClose }: Props) {
  return (
    <aside className="sl-drawer sl-mission is-advanced" aria-label="Advanced mission settings">
      <header className="sl-drawer-head">
        <h2>Advanced</h2>
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      <div id="sl-advanced" className="sl-advanced">
        <AdvancedControls mission={mission} onMission={onMission} site={site} month={month} year={year} summary={summary} heightChoice={{ off: heightsOff }} />
      </div>
    </aside>
  )
}

/** The limits beyond the challenge's text, and what the hourly numbers assume: what the Mission panel's Advanced fold holds, and the Planner's left side. */
export function AdvancedControls({ mission, onMission, site, month, year, summary, heightChoice }: Pick<Props, 'mission' | 'onMission' | 'site' | 'month' | 'year' | 'summary'> & { /** In the Planner: offer the two heights; the string says why they are off, if they are. */ heightChoice?: { off: string | null } }) {
  const { requirements } = mission
  const limit = (change: Partial<Requirements>) => onMission({ ...mission, requirements: { ...requirements, ...change } })
  return (
    <>
      <div className="sl-param">
        <label htmlFor="sl-m-clear">Earth must clear the skyline by</label>
        <select id="sl-m-clear" value={requirements.minEarthClearanceDeg} onChange={(event) => limit({ minEarthClearanceDeg: Number(event.target.value) })}>
          {CLEARANCE_CHOICES_DEG.map((degrees) => (
            <option key={degrees} value={degrees}>
              {degrees === 0 ? '0° (any part of Earth showing)' : `${degrees}° (its centre that far above the skyline)`}
            </option>
          ))}
        </select>
      </div>
      {heightChoice && <HeightChoice mission={mission} onMission={onMission} off={heightChoice.off} />}
      <Assumptions site={site} month={month} year={year} summary={summary} heights={mission.heights} choice={heightChoice !== undefined} />
    </>
  )
}
