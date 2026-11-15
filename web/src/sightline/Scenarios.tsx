import { formatDuration } from '../lib/nextChange'
import { addScenarioMeans, MAX_SCENARIOS, SCENARIO_LETTERS } from '../lib/sightlineMission'

interface TabsProps {
  count: number
  active: number
  onSelect: (index: number) => void
  /** Add what is on screen as a new scenario; left out once there are four. */
  onAdd: () => void
  /** What that adds, in words: the site on show and the hour on the time bar. Left out where the page adds something else. */
  adds?: string
  /** Remove a scenario; offered on every tab while there is more than one. */
  onRemove: (index: number) => void
}

/**
 * The scenarios, A to D, at the top of the column. Each tab is its letter, which selects it, and a
 * small "−" at its right edge, which removes that one whichever is selected; then "+" adds what is
 * on screen. With one scenario there is nothing to remove.
 */
export function ScenarioTabs({ count, active, onSelect, onAdd, adds, onRemove }: TabsProps) {
  return (
    <div className="sl-tabs" role="group" aria-label="Scenarios">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={i === active ? 'sl-tab is-active' : 'sl-tab'}>
          <button type="button" aria-pressed={i === active} aria-label={`Scenario ${SCENARIO_LETTERS[i]}`} onClick={() => onSelect(i)}>
            {SCENARIO_LETTERS[i]}
          </button>
          {count > 1 && (
            <button type="button" className="sl-tab-remove" aria-label={`Remove scenario ${SCENARIO_LETTERS[i]}`} title={`Removes scenario ${SCENARIO_LETTERS[i]}. “Undo” brings it back.`} onClick={() => onRemove(i)}>
              −
            </button>
          )}
        </span>
      ))}
      {count < MAX_SCENARIOS && (
        <button type="button" data-tour="add" aria-label="Add a scenario" title={adds ? addScenarioMeans(adds) : 'Adds this site, at the hour on the time bar, as another scenario to compare.'} onClick={onAdd}>
          +
        </button>
      )}
    </div>
  )
}

interface BetterDateProps {
  /** "9 May 2027 · 04:00 UTC". */
  when: string
  waitH: number
  /** Whether there is room for another scenario; if not, the landing moves instead. */
  adds: boolean
  onTake: () => void
}

/** A better date nearby, when the landing doesn't meet the Sun and Earth limits and a later one does. */
export function BetterDate({ when, waitH, adds, onTake }: BetterDateProps) {
  return (
    <button type="button" className="sl-suggest" title="The first later landing that meets the mission's Sun and Earth limits." onClick={onTake}>
      <b>Better date nearby:</b> {when}, {formatDuration(waitH)} later. <span>{adds ? 'Add it to compare ›' : 'Move the landing there ›'}</span>
    </button>
  )
}

interface RemovedNoticeProps {
  /** The letter the removed scenario had. */
  letter: string
  onUndo: () => void
}

/** "Removed scenario B · Undo", for a few seconds after a removal, in place of a confirmation dialog. */
export function RemovedNotice({ letter, onUndo }: RemovedNoticeProps) {
  return (
    <p className="sl-removed" role="status">
      Removed scenario {letter} ·{' '}
      <button type="button" className="sl-link" onClick={onUndo}>
        Undo
      </button>
    </p>
  )
}
