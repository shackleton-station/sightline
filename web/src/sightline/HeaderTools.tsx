import { useEffect, useRef, useState } from 'react'
import { withPanel } from '../lib/planView'
import { ShareSheet } from './ShareSheet'

interface Props {
  onBrief: () => void
  /** A guide is talking about the sheet: it is held open while its step is on show. */
  held?: boolean
  /** Start the short guide to sharing; left out, or null while a guide is already on, where there is none to offer. */
  onShowHow?: (() => void) | null
  /** The side panel that is open, so a saved plan can reopen it; none in the Planner. */
  panel?: string | null
}

/**
 * Share, a small icon button beside the name, with a name for readers that cannot see it. It opens a
 * small sheet (ShareSheet): copy the link for what is on screen, save it with a name, or read the
 * written brief for the scenario on show.
 */
export function HeaderTools({ onBrief, held = false, onShowHow = null, panel = null }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  // A press anywhere else, or Escape, closes the list.
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      // The sheet is drawn at the end of the page, so a press inside it is not a press elsewhere.
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target instanceof Element && (box.current?.contains(event.target) || event.target.closest('.sl-share-sheet')))) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const copy = () => {
    // The address bar always holds the link for what is on screen.
    void navigator.clipboard?.writeText(window.location.href).then(
      () => setCopied(true),
      () => setCopied(false),
    )
    setOpen(false)
  }

  return (
    <span ref={box} className="sl-head-tools">
      <button type="button" className="sl-icon" aria-label="Share" aria-haspopup="true" aria-expanded={open} title={copied ? 'Link copied' : 'Share: copy the link, save with a name, or the written brief'} onClick={() => setOpen(!open)}>
        {copied ? (
          <span aria-hidden="true">✓</span>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M8 10V2M8 2 5 5M8 2l3 3M3 8v5h10V8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span className="visually-hidden" role="status">
          {copied ? 'Link copied' : ''}
        </span>
      </button>
      {(open || held) && (
        <ShareSheet
          onCopy={copy}
          onBrief={() => {
            setOpen(false)
            onBrief()
          }}
          onShowHow={
            onShowHow &&
            (() => {
              setOpen(false)
              onShowHow()
            })
          }
          held={held && !open}
          view={() => withPanel(window.location.hash, panel)}
        />
      )}
    </span>
  )
}
