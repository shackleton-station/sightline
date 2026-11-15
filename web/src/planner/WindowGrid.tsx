import { type CSSProperties, type KeyboardEvent, memo, type SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react'
import { shadePct } from '../lib/grid'
import { monthLabel, monthName } from '../lib/months'
import { GridKey } from './GridKey'
import type { PlannerGrid, PlannerRow } from './plannerModel'
import { cellWords } from './words'

interface Props {
  grid: PlannerGrid
  /** The cell the answer is about. */
  siteId: string
  month: string
  /** Cells with an option on the short list, as "site@month". */
  listed: Set<string>
  /** `byPointer` is true for a click or tap, false for Enter or Space. */
  onPick: (siteId: string, month: string, byPointer: boolean) => void
  /** What the violet line on a month means here, for the key. */
  keptWords?: string
  /** Fold away the sites with no landing in any month, behind a "Show" button. */
  hideEmpty?: boolean
}

interface RowProps {
  row: PlannerRow
  r: number
  /** The largest share of a month with a landing, anywhere on the table: a full-height bar. */
  largestShare: number
  /** The chosen month if this is the chosen site's row, otherwise null. */
  chosen: string | null
  /** The chosen month, to mark its column in every row. */
  column: string
  /** This site's months on the short list, joined, so the row only redraws when they change. */
  listedMonths: string
  onPick: (siteId: string, month: string, byPointer: boolean) => void
}

/**
 * One site across every month. A bar's height is the month's landing days, on the scale the Classic
 * grid shades by: up to the most on the table, since landing days never come near a whole month.
 */
const GridRow = memo(function GridRow({ row, r, largestShare, chosen, column, listedMonths, onPick }: RowProps) {
  const listed = listedMonths.split(',')
  return (
    <tr className={chosen ? 'is-row' : undefined}>
      <th scope="row">
        <span className="pl-site">{row.site.name}</span>
        <span className="pl-count" title={`${row.monthsWithLanding} of ${row.cells.length} months have a landing`}>
          <span aria-hidden="true">
            {row.monthsWithLanding}/{row.cells.length}
          </span>
          <span className="visually-hidden">
            {row.monthsWithLanding} of {row.cells.length} months have a landing
          </span>
        </span>
      </th>
      {row.cells.map((cell, c) => {
        const say = cellWords(row.site.name, cell.month, cell.days)
        const isChosen = cell.month === chosen
        const classes = ['pl-cell', cell.status, listed.includes(cell.month) ? 'listed' : ''].join(' ')
        return (
          <td key={cell.month} className={[cell.month === column ? 'is-col' : '', cell.month.endsWith('-01') ? 'jan' : ''].join(' ')}>
            <button
              type="button"
              className={classes}
              style={{ '--fill': shadePct(cell.share, largestShare, 'landing') / 100 } as CSSProperties}
              tabIndex={isChosen ? 0 : -1}
              data-r={r}
              data-c={c}
              data-say={say}
              aria-label={say}
              aria-pressed={isChosen}
              onClick={(event) => onPick(row.site.id, cell.month, event.detail > 0)}
            >
              <span className="pl-bar" aria-hidden="true" />
            </button>
          </td>
        )
      })}
    </tr>
  )
})

/**
 * Every site against every month, as one table: the page's main control. Arrow keys move between
 * cells, Home and End go to a row's ends, Page Up and Page Down move a year; Enter chooses a cell.
 */
export function WindowGrid({ grid, siteId, month, listed, onPick, keptWords, hideEmpty = false }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [pointed, setPointed] = useState<string | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const years = useMemo(() => [...new Set(grid.months.map((m) => m.slice(0, 4)))], [grid.months])
  // A site with no landing all year is folded away, unless it is the one on show or on the short list.
  const isEmpty = (row: PlannerRow) => row.monthsWithLanding === 0 && row.site.id !== siteId && !grid.months.some((m) => listed.has(`${row.site.id}@${m}`))
  const emptyCount = hideEmpty ? grid.rows.filter(isEmpty).length : 0
  const rows = hideEmpty && !showEmpty ? grid.rows.filter((row) => !isEmpty(row)) : grid.rows
  const groups = [...new Set(rows.map((row) => row.site.group))]
  // Rows in the order drawn, so the arrow keys follow what is on screen.
  const ordered = groups.flatMap((group) => rows.filter((row) => row.site.group === group))
  const chosenRow = ordered.find((row) => row.site.id === siteId)
  const chosenCell = chosenRow?.cells.find((cell) => cell.month === month)

  // On a phone the table scrolls sideways inside its box: bring the chosen month into it.
  useEffect(() => {
    const box = scroller.current
    const cell = box?.querySelector<HTMLElement>('td.is-col')
    if (box && cell && box.scrollWidth > box.clientWidth) box.scrollLeft = cell.offsetLeft - box.clientWidth / 2
  }, [month])

  const toYear = (year: string) => {
    const box = scroller.current
    const head = box?.querySelector<HTMLElement>(`th[data-year="${year}"]`)
    const names = box?.querySelector<HTMLElement>('thead th')
    if (box && head && names) box.scrollLeft = head.offsetLeft - names.offsetWidth
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('button[data-r]') : null
    if (!cell) return
    const r = Number(cell.dataset.r)
    const c = Number(cell.dataset.c)
    const last = grid.months.length - 1
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      PageUp: [r, c - 12],
      PageDown: [r, c + 12],
      Home: [r, 0],
      End: [r, last],
    }
    const to = moves[event.key]
    if (!to) return
    event.preventDefault()
    const row = Math.max(0, Math.min(ordered.length - 1, to[0]))
    const col = Math.max(0, Math.min(last, to[1]))
    event.currentTarget.querySelector<HTMLElement>(`button[data-r="${row}"][data-c="${col}"]`)?.focus()
  }

  const point = (event: SyntheticEvent) => {
    const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('button[data-say]') : null
    setPointed(cell?.dataset.say ?? null)
  }

  return (
    <section className="pl-grid" aria-labelledby="pl-grid-title">
      <div className="pl-grid-head">
        <h2 id="pl-grid-title">Every site, every month</h2>
        <div className="pl-years" role="group" aria-label="Jump to a year">
          {years.map((year) => (
            <button key={year} type="button" onClick={() => toYear(year)}>
              {year}
            </button>
          ))}
        </div>
      </div>
      <div className="pl-grid-scroll" ref={scroller}>
        <table role="grid" aria-labelledby="pl-grid-title" aria-describedby="pl-grid-key" onKeyDown={onKeyDown} onMouseOver={point} onMouseLeave={() => setPointed(null)} onFocus={point} onBlur={() => setPointed(null)}>
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                <span className="pl-site">Site</span>
                <span className="pl-count" aria-hidden="true">
                  months
                </span>
              </th>
              {years.map((year) => (
                <th key={year} scope="colgroup" className="pl-year" data-year={year} colSpan={grid.months.filter((m) => m.startsWith(year)).length}>
                  {year}
                </th>
              ))}
            </tr>
            <tr>
              {grid.months.map((m) => (
                <th key={m} scope="col" abbr={monthLabel(m)} className={[m === month ? 'is-col' : '', m.endsWith('-01') ? 'jan' : ''].join(' ')}>
                  <span aria-hidden="true">{monthName(m)[0]}</span>
                  <span className="visually-hidden">{monthLabel(m)}</span>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group}>
              <tr className="pl-group">
                <th scope="rowgroup" colSpan={grid.months.length + 1}>
                  <span>{group}</span>
                </th>
              </tr>
              {ordered.map((row, r) =>
                row.site.group === group ? (
                  <GridRow
                    key={row.site.id}
                    row={row}
                    r={r}
                    largestShare={grid.largestShare}
                    chosen={row.site.id === siteId ? month : null}
                    column={month}
                    listedMonths={grid.months.filter((m) => listed.has(`${row.site.id}@${m}`)).join(',')}
                    onPick={onPick}
                  />
                ) : null,
              )}
            </tbody>
          ))}
        </table>
      </div>
      {emptyCount > 0 && (
        <button type="button" className="sl-small pl-grid-empty" aria-expanded={showEmpty} onClick={() => setShowEmpty((shown) => !shown)}>
          {showEmpty ? `Hide the ${emptyCount} sites with no landing` : `Show ${emptyCount} more sites with no landing this year`}
        </button>
      )}
      <p className="pl-readout" aria-hidden="true">
        {pointed ?? (chosenRow && chosenCell ? cellWords(chosenRow.site.name, chosenCell.month, chosenCell.days) : '')}
      </p>
      {/* How to read the bars, under the table. */}
      <GridKey mostDays={grid.mostDays} keptWords={keptWords} />
      <p className="pl-key-keys">Keyboard: arrow keys move between squares, Page Up and Page Down move a year, Enter chooses.</p>
    </section>
  )
}
