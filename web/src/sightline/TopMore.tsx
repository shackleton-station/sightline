import { useEffect, useRef, useState } from 'react'
import { myPlans } from '../lib/myPlans'
import { GoogleSignIn, SignInMeans, useAccount } from './account'

interface Props {
  /** "Present": whether this tab is presenting, and the press that starts it or shows its code again; null for a tab that is following. */
  present: { on: boolean; onPress: () => void } | null
  /** Open the Library at "Your plans". */
  onPlans: () => void
}

/**
 * The opening screen's two ways that are not about the Moon itself, after "Plan a landing" and
 * "Hide all". Both were only inside Share, on the plan, where a visitor who had not opened a plan
 * could not find them.
 *
 * - "Present", where a talk starts: others open a link or scan a code, and their screens follow.
 * - "Your plans", for a visitor with plans to come back to (signed in, or with plans this browser
 *   saved): it opens the Library at them. For a visitor with none yet, where the site has sign-in
 *   on, it reads "Sign in" and opens a small panel under the row with Google's own button and what
 *   signing in is for; it is optional, and nothing else needs it. Where sign-in is off and this
 *   browser saved nothing, there is no button.
 *
 * On a laptop they are two more buttons in the row. A phone's top has no room for four, so there
 * they fold under one "More" button, as a short list. A press elsewhere or Escape closes the list
 * and the panel.
 */
export function TopMore({ present, onPlans }: Props) {
  const account = useAccount()
  // Read as the opening screen is drawn: a plan saved since is counted the next time it is.
  const [kept] = useState(() => myPlans().length > 0)
  const plans = account.signedIn || kept ? 'mine' : account.clientId ? 'sign-in' : null
  const [open, setOpen] = useState(false)
  /** "Sign in" was pressed: the panel with Google's button is on show. */
  const [signing, setSigning] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open && !signing) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key !== 'Escape' : event.target instanceof Node && box.current?.contains(event.target)) return
      setOpen(false)
      setSigning(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open, signing])
  if (!present && !plans) return null
  return (
    <span ref={box} className="sl-top-more" data-open={open || undefined}>
      <button
        type="button"
        className="sl-top-more-toggle"
        aria-label="More"
        aria-haspopup="true"
        aria-expanded={open}
        title="More: present to a room, or open your plans."
        onClick={() => {
          setOpen(!open)
          setSigning(false)
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <span className="sl-top-more-list">
        {present && (
          <button
            type="button"
            data-present
            aria-pressed={present.on}
            title={present.on ? 'Shows the code and the link again. People who open it see their screen follow yours.' : 'Starts presenting: people who scan your code or open your link see their screen follow yours.'}
            onClick={() => {
              setOpen(false)
              setSigning(false)
              present.onPress()
            }}
          >
            {present.on ? 'Presenting' : 'Present'}
          </button>
        )}
        {plans === 'mine' && (
          <button
            type="button"
            data-plans="mine"
            title="Opens the Library at your plans: each can be opened again where it was left."
            onClick={() => {
              setOpen(false)
              onPlans()
            }}
          >
            Your plans
          </button>
        )}
        {plans === 'sign-in' && (
          <button
            type="button"
            data-plans="sign-in"
            aria-haspopup="dialog"
            aria-expanded={signing}
            title="Shows Google’s sign-in button. Signing in is optional: it lets you list the plans you save on any device, and delete them."
            onClick={() => {
              setOpen(false)
              setSigning(!signing)
            }}
          >
            Sign in
          </button>
        )}
      </span>
      {signing && plans === 'sign-in' && account.clientId && (
        <div className="sl-top-account" role="dialog" aria-label="Sign in with Google">
          <p>
            <strong>Optional.</strong> Sign in with Google to list the plans you save on any device, and to delete them. <SignInMeans />
          </p>
          <GoogleSignIn clientId={account.clientId} />
        </div>
      )}
    </span>
  )
}
