import { OLD_HOME } from '../lib/siteTabs'
import { type FormEvent, useRef, useState } from 'react'
import { currentAccount } from '../lib/account'
import { attemptFor, KEY_REUSED, MAX_NOTE, MAX_TITLE, planHash, type SaveAttempt, savePlan } from '../lib/plans'
import { AccountBox } from './AccountBox'
import './sharePlan.css'

interface Props {
  /** The view on screen, as the "#a=…" part of a link. */
  view: string
  /** A title to start from, such as the site and date on screen. */
  suggestedTitle: string
}

/**
 * Saves the view on screen as a named plan and gives a short link to it. Whoever opens the link
 * sees the plan's name, the note, and a brief the server worked out from the data when it was saved.
 */
export function SharePlan({ view, suggestedTitle }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  // The attempt the last press of Save belonged to, so a press after a failure retries it under the same key.
  const attempt = useRef<SaveAttempt | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const open = () => {
    setTitle(suggestedTitle.slice(0, MAX_TITLE))
    setNote('')
    setLink(null)
    setProblem(null)
    setCopied(false)
    dialog.current?.showModal()
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setProblem(null)
    const plan = { title, note, view }
    attempt.current = attemptFor(attempt.current, plan, currentAccount() !== null)
    const result = await savePlan(plan, attempt.current.key)
    setSaving(false)
    if (result.ok) {
      // Saved: the next press of Save is a new plan, even an identical one.
      attempt.current = null
      setLink(`${window.location.origin}${OLD_HOME}${planHash(result.value)}`)
    } else {
      // The server knows this key for a different plan, so the key is spent: the next press starts afresh.
      if (result.status === KEY_REUSED) attempt.current = null
      setProblem(result.message)
    }
  }

  return (
    <>
      <button type="button" className="share-plan-open" disabled={!view} onClick={open}>
        Share this plan
      </button>
      <dialog ref={dialog} className="share-plan" aria-labelledby="share-plan-title">
        {link ? (
          <>
            <h2 id="share-plan-title">Your plan is saved</h2>
            <p>Anyone with this link sees the plan and what the data says about it. It is kept for six months.</p>
            <code className="share-plan-link">{link}</code>
            <div className="share-plan-buttons">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))
                }}
              >
                {copied ? 'Link copied' : 'Copy the link'}
              </button>
              <a className="share-plan-go" href={link} onClick={() => dialog.current?.close()}>
                Open it
              </a>
              <button type="button" onClick={() => dialog.current?.close()}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(event) => void save(event)}>
            <h2 id="share-plan-title">Share this plan</h2>
            <p>Saves the site, the hour, your limits and your shortlist under a short link.</p>
            <label>
              Name it
              <input required maxLength={MAX_TITLE} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              A note for whoever opens it (optional)
              <textarea rows={3} maxLength={MAX_NOTE} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {problem && (
              <p className="share-plan-problem" role="alert">
                {problem}
              </p>
            )}
            <p>Don't put personal details in the name or the note: anyone with the link can read them.</p>
            <div className="share-plan-buttons">
              <button type="submit" className="primary" disabled={saving || title.trim() === ''}>
                {saving ? 'Saving…' : 'Save and get a link'}
              </button>
              <button type="button" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <AccountBox refresh={link} />
      </dialog>
    </>
  )
}
