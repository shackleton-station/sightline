import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HourlyProblem } from './hourlyExport'
import './exportMenu.css'

interface Props {
  /** Save the Compare table, as Export always did. */
  onTable: () => void
  /** Make and save the hourly file for the scenario on show; rejects when it cannot be made. */
  onHourly: () => Promise<void>
  /** Whose hours the second file holds, in a few words: "Scenario A · 14 days from its landing". */
  hourlyOf: string
}

/** The air the list keeps from the window's edge. */
const EDGE_PX = 8

/**
 * Export, in the Planner's header: a button that opens a short list of the two files there are.
 *
 * - "Comparison table (CSV)": the scenarios side by side, as the Compare tab shows them.
 * - "Hourly Sun and Earth (CSV)": the scenario on show over its mission, one row for each hour.
 *
 * The hourly file may have a month or two to read first: its line says so while it does, and if it
 * cannot be made the reason is said in the list, in plain words. A press elsewhere or Escape closes
 * the list; Escape gives the keyboard back to the button.
 */
export function ExportMenu({ onTable, onHourly, hourlyOf }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string }>({ kind: 'idle' })
  const box = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        // Escape closes the list and nothing else: the Planner behind it stays open.
        event.stopPropagation()
        setOpen(false)
        button.current?.focus()
      } else if (!(event.target instanceof Node && box.current?.contains(event.target))) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close, true)
    }
  }, [open])

  // The list hangs under the button with their right ends in line, moved along only as far as it
  // must be to stay whole inside the window (on a phone the button can be anywhere along its row).
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = list.current
      const at = box.current?.getBoundingClientRect()
      if (!el || !at) return
      const width = el.offsetWidth
      const left = Math.max(EDGE_PX, Math.min(at.right - width, window.innerWidth - EDGE_PX - width))
      el.style.left = `${left - at.left}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  const hourly = () => {
    if (state.kind === 'working') return
    setState({ kind: 'working' })
    onHourly().then(
      () => {
        setState({ kind: 'idle' })
        setOpen(false)
      },
      (reason: unknown) => {
        if (!(reason instanceof HourlyProblem)) console.error(reason)
        setState({ kind: 'failed', message: reason instanceof HourlyProblem ? reason.message : 'The file could not be made just now. Try again in a moment.' })
      },
    )
  }

  return (
    <span ref={box} className="sl-export">
      <button
        ref={button}
        type="button"
        className="sl-small"
        aria-haspopup="true"
        aria-expanded={open}
        title="Save the Compare table, or the hour-by-hour Sun and Earth, as a CSV file"
        onClick={() => {
          setOpen(!open)
          if (state.kind === 'failed') setState({ kind: 'idle' })
        }}
      >
        Export
      </button>
      {open && (
        <span ref={list} className="sl-export-list" role="group" aria-label="Export">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onTable()
            }}
          >
            Comparison table (CSV)
            <small>The scenarios side by side, as on Compare</small>
          </button>
          <button type="button" aria-busy={state.kind === 'working'} onClick={hourly}>
            Hourly Sun and Earth (CSV)
            <small>{state.kind === 'working' ? 'Reading the hours…' : `${hourlyOf}, one row an hour`}</small>
          </button>
          {state.kind === 'failed' && (
            <span className="sl-export-problem" role="alert">
              {state.message}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
