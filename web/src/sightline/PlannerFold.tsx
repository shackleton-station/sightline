import { type ReactNode, useState } from 'react'

interface Props {
  /** A short name for the fold, for the checks and for the link between its heading and its body. */
  id: string
  title: string
  /** A few words on what is inside, beside the heading while it is closed. */
  hint?: string
  /** Shown under the heading whether the fold is open or not. */
  lead?: ReactNode
  /** What the fold holds. Drawn, and its data read, only once the fold is opened. */
  children: ReactNode
}

/**
 * A part of the Planner folded behind its own heading until asked for, so the first screen stays as
 * calm as it was. The heading is a button (Tab reaches it, Enter or Space opens it). What is inside
 * is not drawn while the fold is closed, so nothing it needs is downloaded before then.
 */
export function PlannerFold({ id, title, hint, lead, children }: Props) {
  const [open, setOpen] = useState(false)
  const body = `pl-fold-${id}`
  return (
    <section className="pl-fold" data-fold={id} data-open={open ? 'yes' : 'no'}>
      <div className="pl-fold-top">
        <h4 className="pl-fold-head">
          <button type="button" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
            <span className="pl-fold-mark" aria-hidden="true" />
            {title}
          </button>
        </h4>
        {hint && !open && <small className="pl-fold-hint">{hint}</small>}
      </div>
      {lead}
      <div id={body} className="pl-fold-body" hidden={!open}>
        {open && children}
      </div>
    </section>
  )
}
