import { useEffect, useRef, useState } from 'react'

interface Props {
  onBrief: () => void
  /** A guide is talking about the list: it is held open while its step is on show. */
  held?: boolean
  /** Start the short guide to sharing; left out, or null while a guide is already on, where there is none to offer. */
  onShowHow?: (() => void) | null
}

/**
 * Share, a small icon button beside the name, with a name for readers that cannot see it. It opens a
 * short list: copy the link for what is on screen, or read the written brief for the scenario on show.
 */
export function HeaderTools({ onBrief, held = false, onShowHow = null }: Props) {
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
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target instanceof Node && box.current?.contains(event.target))) setOpen(false)
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
      <button type="button" className="sl-icon" aria-label="Share" aria-haspopup="true" aria-expanded={open} title={copied ? 'Link copied' : 'Share: the link, or the written brief'} onClick={() => setOpen(!open)}>
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
        <span className="sl-share-menu" role="group" aria-label="Share">
          <button type="button" title="Copy the link to this view" onClick={copy}>
            Copy link
          </button>
          <button
            type="button"
            title="The written brief for the scenario on show"
            onClick={() => {
              setOpen(false)
              onBrief()
            }}
          >
            Brief
          </button>
          {onShowHow && (
            <button
              type="button"
              className="sl-show-how"
              onClick={() => {
                setOpen(false)
                onShowHow()
              }}
            >
              Show me how
            </button>
          )}
        </span>
      )}
    </span>
  )
}
