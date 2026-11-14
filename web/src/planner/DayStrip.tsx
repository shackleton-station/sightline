import type { CSSProperties, KeyboardEvent } from 'react'
import { monthLabel } from '../lib/months'
import type { MonthAnswer } from './monthAnswer'

interface Props {
  month: string
  answer: MonthAnswer
  /** The day of the month the planned landing is on, from 0, and the best landing's day. */
  plannedDay: number
  bestDay: number | null
  onDay: (day: number) => void
}

/**
 * The month, one square per UTC day. A square's fill is how many of the day's 24 hours have a
 * landing that works. Choosing a day plans the landing then. Left and right arrows move between days.
 */
export function DayStrip({ month, answer, plannedDay, bestDay, onDay }: Props) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 || !(event.target instanceof HTMLElement)) return
    const to = Number(event.target.dataset.day) + step
    const next = event.currentTarget.querySelector<HTMLElement>(`button[data-day="${to}"]`)
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }
  return (
    <div className="pl-days" role="group" aria-label={`Days of ${monthLabel(month)}. Choose one to plan the landing then.`} onKeyDown={onKeyDown}>
      {answer.dayHours.map((hours, day) => {
        const date = `${day + 1} ${monthLabel(month)}`
        const works = hours === 0 ? 'no hour fits a landing' : `a landing fits in ${hours} of its 24 hours`
        const classes = ['pl-day', hours > 0 ? 'works' : 'none', day === bestDay ? 'best' : ''].join(' ')
        return (
          <button
            key={date}
            type="button"
            className={classes}
            style={{ '--fill': hours / 24 } as CSSProperties}
            tabIndex={day === plannedDay ? 0 : -1}
            data-day={day}
            aria-pressed={day === plannedDay}
            aria-label={`${date}: ${works}${day === bestDay ? '. The best landing is on this day' : ''}.`}
            title={`${date}: ${works}`}
            onClick={() => onDay(day)}
          >
            <span className="pl-day-fill" aria-hidden="true" />
            <span className="pl-day-number" aria-hidden="true">
              {day + 1}
            </span>
          </button>
        )
      })}
    </div>
  )
}
