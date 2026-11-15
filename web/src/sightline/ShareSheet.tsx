import { type FormEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyWhenKnown } from '../lib/copyText'
import { planLink } from '../lib/planLink'
import { markSightline } from '../lib/planView'
import { attemptFor, MAX_NOTE, MAX_TITLE, type SaveAttempt, savePlan } from '../lib/plans'
import './shareSheet.css'

interface Props {
  /** Copy the link for what is on screen and close: what Share has always done first. */
  onCopy: () => void
  /** Open the written brief for the scenario on show. */
  onBrief: () => void
  /** Start the short guide to sharing; null while a guide is already on, or where there is none to offer. */
  onShowHow?: (() => void) | null
  /** A guide is showing the sheet, not the visitor: it is open, and the keyboard stays with the guide. */
  held?: boolean
  /** The view to save: the address for what is on screen, with the open side panel. */
  view: () => string
}

/** Under this width the window is a phone's: the sheet spans it. */
const PHONE_UNDER_PX = 761
/** The sheet's width on a laptop, the air it keeps from an edge, and its gap from the icon. */
const WIDTH_PX = 304
const EDGE_PX = 8
const GAP_PX = 5
/** How long the plans service keeps a plan (web/plans/API.md). */
const KEPT_DAYS = 180
/** How long the sheet waits to hear whether the saved link was copied, in milliseconds. */
const COPY_WAIT_MS = 1500

/** What to say when a plan could not be saved, in plain words. `status` is absent when the service could not be reached. */
function saveFailure(status: number | undefined): string {
  if (status === 400) return 'That name or note could not be saved. Shorten it, or take out unusual characters, and try again.'
  if (status === 429) return 'Too many plans are being saved just now. Give it a minute and try again.'
  if (status === 503) return 'Saving plans is switched off here for now. The link above still works.'
  if (status === undefined) return 'The plan could not be sent. Check your connection and try again; the link above still works.'
  return 'The plan could not be saved just now. Try again in a moment; the link above still works.'
}

/**
 * Share's sheet, under its icon: three things, in the order they are wanted.
 *
 * 1. "Copy link", first and already in focus: one press copies the link for what is on screen and
 *    closes the sheet, as Share always did. It needs no service, so it works when saving does not.
 * 2. "Save with a name": a name and an optional note, kept by the plans service for 180 days under
 *    a short link that opens with them on show. No sign-in is needed.
 * 3. "Brief": the written brief for the scenario on show.
 *
 * Once a plan is saved, its short link is the sheet's main thing and takes the first place: the
 * link, and a gold "Copy saved link" that already has the keyboard. The link is copied at the
 * moment of saving where the browser allows it, and the sheet says so ("Saved and copied"); where
 * it does not, the sheet says only "Saved". The plain link's button goes under it, quiet, with
 * words that say how it differs: it carries no name or note.
 *
 * Under them, where there is one to offer, "Show me how" starts the short guide to sharing.
 *
 * The sheet is drawn at the end of the page, not inside the column that holds its icon: the column
 * clips what leaves it, and on a phone it is a sheet of its own at the foot of the screen. It is
 * placed from where the icon is: under it and inside the column on a laptop, so nothing lies over
 * the Moon; across the window on a phone, above the icon when there is no room below. The keyboard
 * stays inside it while it is open, and goes back to the icon when it closes.
 */
export function ShareSheet({ onCopy, onBrief, onShowHow = null, held = false, view }: Props) {
  const sheet = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  // Where the sheet would have been, in the page: its icon is beside it.
  const marker = useRef<HTMLSpanElement>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const savedCopy = useRef<HTMLButtonElement>(null)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; link: string; copied: boolean } | { kind: 'failed'; message: string }>({ kind: 'idle' })
  // The saved link's own button was pressed: it says so.
  const [copied, setCopied] = useState(false)
  // Pressing Save again after a failure, with nothing changed, is the same attempt: the service then saves it once.
  const attempt = useRef<SaveAttempt | null>(null)

  // Whether a guide opened the sheet: asked once, as it opens, so a guide letting go of it later does not move the keyboard.
  const heldAsOpened = useRef(held)
  // Opening gives the keyboard to "Copy link". Closing with the keyboard still inside (Escape, or a
  // press on one of the sheet's own buttons) hands it back to the Share icon; a press elsewhere keeps
  // the keyboard where the visitor pressed.
  useLayoutEffect(() => {
    const el = sheet.current
    const icon = marker.current?.parentElement?.querySelector<HTMLElement>('button')
    if (!heldAsOpened.current) first.current?.focus({ preventScroll: true })
    return () => {
      if (el?.contains(document.activeElement)) icon?.focus({ preventScroll: true })
    }
  }, [])
  // Saved: the keyboard goes to the saved link's own button, which is now the sheet's main one.
  const saved = state.kind === 'saved'
  useLayoutEffect(() => {
    if (saved && !heldAsOpened.current) savedCopy.current?.focus({ preventScroll: true })
  }, [saved])
  useLayoutEffect(() => {
    const place = () => {
      const el = sheet.current
      const icon = marker.current?.parentElement
      if (!el || !icon) return
      const at = icon.getBoundingClientRect()
      const phone = window.innerWidth < PHONE_UNDER_PX
      // On a laptop the sheet stays inside the column its icon is in, so it never lies over the Moon.
      const column = phone ? null : icon.closest('.sl-col')?.getBoundingClientRect()
      const left = column ? column.left + EDGE_PX : EDGE_PX
      const right = column ? column.right - EDGE_PX : window.innerWidth - EDGE_PX
      const width = Math.min(phone ? right - left : WIDTH_PX, right - left)
      el.style.width = `${width}px`
      el.style.left = `${Math.max(left, Math.min(at.left, right - width))}px`
      const height = el.offsetHeight
      const below = at.bottom + GAP_PX
      const above = at.top - GAP_PX - height
      // Under the icon when it fits there; above it when only that fits; otherwise as high as it must be to end at the window's foot.
      el.style.top = `${below + height <= window.innerHeight - EDGE_PX ? below : above >= EDGE_PX ? above : Math.max(EDGE_PX, window.innerHeight - EDGE_PX - height)}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [state.kind])

  /** Tab goes round inside the sheet while it is open. */
  const keepInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const stops = [...(sheet.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea') ?? [])]
    if (stops.length === 0) return
    const last = stops[stops.length - 1]
    if (event.shiftKey && document.activeElement === stops[0]) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      stops[0].focus()
    }
  }

  const name = title.replace(/\s+/g, ' ').trim()
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (name === '' || state.kind === 'saving') return
    // The stored view says it was saved from this screen, so its short link opens here wherever it is opened.
    const plan = { title: name, note: note.replace(/\s+/g, ' ').trim(), view: markSightline(view()) }
    attempt.current = attemptFor(attempt.current, plan, false)
    setState({ kind: 'saving' })
    const saving = savePlan(plan, attempt.current.key)
    // The copy is asked for now, while this press still counts, with the link as a promise: the browser waits for the save.
    const copying = copyWhenKnown(saving.then((result) => (result.ok ? planLink(window.location.origin, result.value) : Promise.reject(new Error('not saved')))))
    const result = await saving
    if (!result.ok) {
      setState({ kind: 'failed', message: saveFailure(result.status) })
      return
    }
    // A browser that neither copies nor refuses is not waited for: the sheet then says only that the plan is saved.
    const copiedNow = await Promise.race([copying, new Promise<boolean>((done) => window.setTimeout(() => done(false), COPY_WAIT_MS))])
    setState({ kind: 'saved', link: planLink(window.location.origin, result.value), copied: copiedNow })
  }
  const copySaved = (link: string) => {
    void navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <>
      <span ref={marker} hidden />
      {createPortal(
        <div ref={sheet} className="sl-share-sheet" role="dialog" aria-label="Share" onKeyDown={keepInside}>
          {state.kind === 'saved' ? (
            <>
              <div className="sl-share-saved">
                <p className="sl-share-head" role="status">
                  {state.copied ? 'Saved and copied' : 'Saved'} <span className="sl-share-name">“{name}”</span>
                </p>
                <input type="text" readOnly value={state.link} aria-label="The saved plan's link" onFocus={(event) => event.currentTarget.select()} />
                <button ref={savedCopy} type="button" className="sl-share-copy" onClick={() => copySaved(state.link)}>
                  {copied ? 'Saved link copied' : 'Copy saved link'}
                </button>
                <p className="sl-share-kept">
                  It opens with the name and note on show. Kept {KEPT_DAYS} days, for anyone with the link.
                </p>
                <p className="sl-share-listed">Its name and landings are in the Planner’s library, for anyone to find.</p>
              </div>
              <button ref={first} type="button" className="sl-share-plain" onClick={onCopy}>
                Copy link without the name or note
              </button>
            </>
          ) : (
            <>
              <button ref={first} type="button" className="sl-share-copy" onClick={onCopy}>
                Copy link
              </button>
              <form className="sl-share-save" onSubmit={save} autoComplete="off">
                <p className="sl-share-head" id="sl-share-save-head">
                  Save with a name
                </p>
                <p className="sl-share-why" id="sl-share-why">
                  The saved link opens with the name and note on show.
                </p>
                <label>
                  <span>Name</span>
                  <input type="text" name="plan-name" value={title} maxLength={MAX_TITLE} required aria-describedby="sl-share-why sl-share-kept" placeholder="Shackleton Rim in June" data-1p-ignore="true" data-lpignore="true" onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label>
                  <span>
                    Note <small>optional</small>
                  </span>
                  <textarea name="plan-note" value={note} maxLength={MAX_NOTE} rows={2} onChange={(event) => setNote(event.target.value)} />
                </label>
                <p className="sl-share-listed" id="sl-share-listed">
(m) => m                <div className="sl-share-row">
                  <p className="sl-share-kept" id="sl-share-kept">
                    Kept {KEPT_DAYS} days, for anyone with the link.
                  </p>
                  <button type="submit" className="sl-small" disabled={name === '' || state.kind === 'saving'}>
                    {state.kind === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {state.kind === 'failed' && (
                  <p className="sl-share-problem" role="alert">
                    {state.message}
                  </p>
                )}
              </form>
            </>
          )}

          <div className="sl-share-foot">
            <button type="button" className="sl-share-brief" onClick={onBrief}>
              Brief
            </button>
            {onShowHow && (
              <button type="button" className="sl-link sl-show-how" onClick={onShowHow}>
                Show me how
              </button>
            )}
          </div>
        </div>,
        // Inside the screen's own element, so the sheet has the screen's colours and type.
        document.querySelector('.sightline') ?? document.body,
      )}
    </>
  )
}
