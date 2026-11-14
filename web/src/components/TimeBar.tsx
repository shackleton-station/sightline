import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Month changes, when one scenario is showing. */
  previous?: { label: string; onClick: (() => void) | null }
  next?: { label: string; onClick: (() => void) | null }
}

/** Keeps time in reach on every part of the page. */
export function TimeBar({ children, previous, next }: Props) {
  const month = (choice: Props['next'], direction: string, side: 'before' | 'after') =>
    choice && (
      <button
        type="button"
        className="bar-month"
        disabled={!choice.onClick}
        aria-label={`${direction} month: ${choice.label}`}
        onClick={choice.onClick ?? undefined}
      >
        {side === 'before' && '‹'}
        <span className="bar-month-label"> {choice.label} </span>
        {side === 'after' && '›'}
      </button>
    )
  return (
    <div className="time-bar">
      <div className="time-bar-inner">
        {month(previous, 'Previous', 'before')}
        {children}
        {month(next, 'Next', 'after')}
      </div>
    </div>
  )
}
