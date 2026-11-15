import { type ReactNode, useEffect, useState } from 'react'
import type { MastHeight, SiteInfo, Summary } from '../data/contract'
import { loadMastHeights } from '../data/loadSite'
import { ANTENNA_HEIGHTS_M, HEIGHT_MEANS, heightsWords, isBaseHeights, type MissionHeights, PANEL_HEIGHTS_M } from '../lib/heights'
import { advancedMeanings, LIMIT_NAMES, limitMeanings, MEANING_LABELS, meaningOf, type SlopeFrom } from '../lib/limitMeanings'
import type { Requirements } from '../lib/mission'
import { CLEARANCE_CHOICES_DEG, MISSION_RANGES, NO_LIMIT_H, PRESETS, presetOf, SILENCE_NO_LIMIT_STOP, SILENCE_RANGE, type SightlineMission, silenceHours, silenceStop } from '../lib/sightlineMission'
import { heightNote } from '../lib/sightlineNotes'
import { MeaningList } from './LimitMeanings'
import { RoverLine } from './RoverLine'

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
  /** What the limit means, as hover text; the written line is in "What each limit means". */
  means: string
  onChange: (value: number) => void
}

/** A limit in hours, as a reader says it: two or more whole days read as days ("14 days", not "336 h"). */
function spanWords(hours: number): string {
  return hours >= 48 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} h`
}

function Slider({ id, label, value, unit, range, text, means, onChange }: SliderProps) {
  return (
    <div className="sl-param" title={means}>
      <div className="sl-param-top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{text ?? `${value}${unit}`}</output>
      </div>
      <input id={id} type="range" min={range.min} max={Math.max(range.max, value)} step={range.step} value={value} aria-valuetext={text ?? `${value}${unit}`} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}

/** One height to choose from a few, each a button that says in its hover text what stands that high and where the figure is from. */
function HeightPick({ label, means, offered, value, disabled, onPick }: { label: string; means: string; offered: number[]; value: number; disabled: boolean; onPick: (heightM: number) => void }) {
  return (
    <div className="sl-height-pick" role="group" aria-label={label}>
      <span title={means}>{label}</span>
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
      <HeightPick label={LIMIT_NAMES.panelM} means={meaningOf('panelM')} offered={PANEL_HEIGHTS_M} value={mission.heights.panelM} disabled={off !== null} onPick={(panelM) => set({ panelM })} />
      <HeightPick label={LIMIT_NAMES.antennaM} means={meaningOf('antennaM')} offered={ANTENNA_HEIGHTS_M} value={mission.heights.antennaM} disabled={off !== null} onPick={(antennaM) => set({ antennaM })} />
      {off && <p className="sl-quiet">{off}</p>}
    </div>
  )
}

/**
 * What the hourly numbers assume about height, where the heights cannot be chosen: the height above
 * the ground they are worked out for, and what going higher does. Where the heights can be chosen
 * the choice itself says it, so there is nothing to add. How close the landing comes is the Accuracy
 * panel's subject, and is said there only.
 */
export function Assumptions({ site, year, summary, heights, choice }: Pick<Props, 'site' | 'month' | 'year' | 'summary'> & { heights: MissionHeights; choice: boolean }) {
  const [loaded, setLoaded] = useState<{ siteId: string; heights: MastHeight[] | null } | null>(null)
  useEffect(() => {
    if (choice) return
    let current = true
    loadMastHeights(site)
      .catch(() => null)
      .then((heights) => {
        if (current) setLoaded({ siteId: site.id, heights })
      })
    return () => {
      current = false
    }
  }, [site, choice])
  if (choice) return null
  const here = loaded?.siteId === site.id ? loaded : null
  // Until the site's file arrives the note gives the figure it is sure of, and nothing more.
  return (
    <div className="sl-assume">
      <p>{!isBaseHeights(heights) ? `Height above ground: ${heightsWords(heights)}, chosen in the Planner.` : summary ? heightNote(here?.heights ?? null, year, summary.obs_height_m) : 'Height above ground: …'}</p>
    </div>
  )
}

/** The presets and the six basic limits: what the Mission panel holds, and the Planner's left side. */
export function MissionControls({ mission, onMission, note }: Pick<Props, 'mission' | 'onMission'> & { /** A line under the examples: in the column, the way to Canada's utility rover. */ note?: ReactNode }) {
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
        <button type="button" aria-pressed={preset === null} disabled={preset !== null} title="Lit when the mission is your own. Change any limit below to make it so.">
          Custom
        </button>
      </div>
      {note}

      <Slider id="sl-m-days" label={LIMIT_NAMES.missionDays} means={meaningOf('missionDays')} value={requirements.missionDays} unit=" days" range={MISSION_RANGES.missionDays} onChange={(missionDays) => limit({ missionDays })} />
      <Slider id="sl-m-dark" label={LIMIT_NAMES.maxSunGapH} means={meaningOf('maxSunGapH')} value={requirements.maxSunGapH} unit=" h" text={spanWords(requirements.maxSunGapH)} range={MISSION_RANGES.maxSunGapH} onChange={(maxSunGapH) => limit({ maxSunGapH })} />
      <label className="sl-check sl-param" title={meaningOf('sunAtLanding')}>
        <input type="checkbox" checked={requirements.sunAtLanding} onChange={(event) => limit({ sunAtLanding: event.target.checked })} /> {LIMIT_NAMES.sunAtLanding}
      </label>
      <label className="sl-check sl-param" title={meaningOf('earthAtLanding')}>
        <input type="checkbox" checked={requirements.earthAtLanding} onChange={(event) => limit({ earthAtLanding: event.target.checked })} /> {LIMIT_NAMES.earthAtLanding}
      </label>
      <Slider
        id="sl-m-silence"
        label={LIMIT_NAMES.maxEarthGapH}
        means={meaningOf('maxEarthGapH')}
        value={silenceStop(requirements.maxEarthGapH)}
        unit=" h"
        text={requirements.maxEarthGapH >= NO_LIMIT_H ? 'No limit' : spanWords(requirements.maxEarthGapH)}
        range={{ ...SILENCE_RANGE, max: SILENCE_NO_LIMIT_STOP }}
        onChange={(stop) => limit({ maxEarthGapH: silenceHours(stop) })}
      />
      <Slider id="sl-m-slope" label={LIMIT_NAMES.maxSlopeDeg} means={meaningOf('maxSlopeDeg')} value={mission.maxSlopeDeg} unit="°" range={MISSION_RANGES.maxSlopeDeg} onChange={(maxSlopeDeg) => onMission({ ...mission, maxSlopeDeg })} />
    </>
  )
}

/** Where the slope under a listed site was measured, for the line on the steepest ground; null where the site has none (a custom point). */
function slopeFrom(site: SiteInfo): SlopeFrom | null {
  return site.slope ? { overM: site.slope.baseline_m, siteName: site.name } : null
}

/**
 * The mission's limits in the column, under the mission's own control. It holds one thing at a
 * time, so the Sun, Earth and ground under it stay on a laptop's screen: the presets and the six
 * basic limits, set two abreast; or, behind "Advanced", the Advanced controls (how far Earth must
 * clear the skyline, how high the solar panel and the antenna stand, and what the hourly numbers
 * assume), with "Limits" leading back; or, behind "What each limit means", one plain line on each
 * of the controls it came from, with the way back to them. Nothing opens anywhere else. (In the
 * Planner, whose column is full at a small laptop's height, each control says the same in its hover
 * text, and the Guide lists them all.)
 */
export function MissionInline({ mission, onMission, heightsOff, site, month, year, summary, onRover }: Omit<Props, 'onClose'> & { /** Opens the rover's panel, from the line under the examples. */ onRover?: () => void }) {
  const [advanced, setAdvanced] = useState(false)
  const [meanings, setMeanings] = useState(false)
  if (meanings) {
    return (
      <div className="sl-mission-inline is-means" role="group" aria-label={advanced ? 'What the Advanced settings mean' : MEANING_LABELS.limits}>
        <button type="button" className="sl-link sl-means-link" onClick={() => setMeanings(false)}>
          <span aria-hidden="true">‹</span> {advanced ? 'Advanced' : 'Limits'}
        </button>
        <MeaningList list={advanced ? advancedMeanings() : limitMeanings(slopeFrom(site))} />
      </div>
    )
  }
  const meansLink = (
    <button type="button" className="sl-link sl-means-link" onClick={() => setMeanings(true)}>
      {advanced ? MEANING_LABELS.advanced : MEANING_LABELS.limits} <span aria-hidden="true">›</span>
    </button>
  )
  if (advanced) {
    return (
      <div className="sl-mission-inline is-advanced" role="group" aria-label="Advanced mission settings">
        <button type="button" className="sl-link sl-advanced-link" onClick={() => setAdvanced(false)}>
          <span aria-hidden="true">‹</span> Limits
        </button>
        {meansLink}
        <div id="sl-advanced" className="sl-advanced">
          <AdvancedControls mission={mission} onMission={onMission} site={site} month={month} year={year} summary={summary} heightChoice={{ off: heightsOff }} />
        </div>
      </div>
    )
  }
  return (
    <div className="sl-mission-inline" role="group" aria-label="Mission limits">
      <MissionControls mission={mission} onMission={onMission} note={onRover && <RoverLine onOpen={onRover} />} />
      <div className="sl-inline-links">
        <button type="button" className="sl-link sl-advanced-link" aria-controls="sl-advanced" onClick={() => setAdvanced(true)}>
          Advanced <span aria-hidden="true">›</span>
        </button>
        {meansLink}
      </div>
    </div>
  )
}

/** The limits beyond the challenge's text, and what the hourly numbers assume: what the Mission panel's Advanced fold holds, and the Planner's left side. */
export function AdvancedControls({ mission, onMission, site, month, year, summary, heightChoice }: Pick<Props, 'mission' | 'onMission' | 'site' | 'month' | 'year' | 'summary'> & { /** In the Planner: offer the two heights; the string says why they are off, if they are. */ heightChoice?: { off: string | null } }) {
  const { requirements } = mission
  const limit = (change: Partial<Requirements>) => onMission({ ...mission, requirements: { ...requirements, ...change } })
  return (
    <>
      <div className="sl-param" title={meaningOf('minEarthClearanceDeg')}>
        <label htmlFor="sl-m-clear">{LIMIT_NAMES.minEarthClearanceDeg}</label>
        <select id="sl-m-clear" value={requirements.minEarthClearanceDeg} onChange={(event) => limit({ minEarthClearanceDeg: Number(event.target.value) })}>
          {CLEARANCE_CHOICES_DEG.map((degrees) => (
            <option key={degrees} value={degrees}>
              {degrees === 0 ? '0° (any part of Earth showing)' : `${degrees}° (its center that far above the skyline)`}
            </option>
          ))}
        </select>
      </div>
      {heightChoice && <HeightChoice mission={mission} onMission={onMission} off={heightChoice.off} />}
      <Assumptions site={site} month={month} year={year} summary={summary} heights={mission.heights} choice={heightChoice !== undefined} />
    </>
  )
}
