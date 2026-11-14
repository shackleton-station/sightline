import { useEffect, useRef, useState } from 'react'
import { followLink } from '../lib/follow'
import { dismissFollow, type FollowState, startPresenting, stopFollowing, stopPresenting } from '../lib/followClient'
import './follow.css'

const OVER: Record<Extract<FollowState, { role: 'over' }>['why'], string> = {
  ended: 'The presentation has ended. You are still on the page it left you on.',
  full: 'This presentation is full, so this page is not following it.',
  expired: 'Your presentation has ended. Press Present to start another.',
  unavailable: 'Presenting is not available right now. Try again in a moment.',
  busy: 'Too many presentations were started just now. Try again in a few minutes.',
}

const people = (count: number) => (count === 1 ? '1 person is' : `${count} people are`)

/** "Present", at the end of the tab bar. It starts a room, or shows the code again while presenting. */
export function PresentButton({ state, onOpen }: { state: FollowState; onOpen: () => void }) {
  const [starting, setStarting] = useState(false)
  // Someone following has the banner's own button; a second one here would only be in the way.
  if (state.role === 'follower') return null
  const presenting = state.role === 'presenter'
  const press = async () => {
    if (presenting) return onOpen()
    setStarting(true)
    if (await startPresenting()) onOpen()
    setStarting(false)
  }
  return (
    <button
      type="button"
      className="follow-present"
      aria-label={presenting ? 'Presenting: show the code' : 'Present'}
      aria-pressed={presenting}
      disabled={starting}
      title={presenting ? 'Show the code people scan to follow along' : 'Present: people who scan your code see this site follow yours'}
      onClick={() => void press()}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="3" y="4.5" width="18" height="12" rx="2" />
        <path d="M12 16.5v3.5M8 20h8" />
      </svg>
      <span className="follow-present-word">{presenting ? 'Presenting' : 'Present'}</span>
    </button>
  )
}

/** The slim line under the tabs while presenting or following, and for a moment after either ends. */
export function FollowBanner({ state, onOpen }: { state: FollowState; onOpen: () => void }) {
  if (state.role === 'none') return null
  if (state.role === 'over') {
    return (
      <p className="follow-bar" role="status">
        <span className="follow-bar-text">{OVER[state.why]}</span>
        <button type="button" onClick={dismissFollow}>
          Close
        </button>
      </p>
    )
  }
  if (state.role === 'follower') {
    return (
      <p className="follow-bar" role="status">
        <span className={state.connected ? 'follow-dot live' : 'follow-dot'} aria-hidden="true" />
        <span className="follow-bar-text">{state.connected ? 'Following the presenter' : 'Connecting to the presenter…'}</span>
        <button type="button" onClick={stopFollowing}>
          Stop following
        </button>
      </p>
    )
  }
  return (
    <p className="follow-bar" role="status">
      <span className={state.trouble ? 'follow-dot' : 'follow-dot live'} aria-hidden="true" />
      <span className="follow-bar-text">
        {state.trouble ? 'Presenting · reconnecting…' : state.followers === null ? 'Presenting' : `Presenting · ${state.followers} following`}
      </span>
      <button type="button" onClick={onOpen}>
        Show code
      </button>
      <button type="button" onClick={() => void stopPresenting()}>
        Stop<span className="follow-wide-only"> presenting</span>
      </button>
    </p>
  )
}

/** The link as a QR code, drawn here in the browser: dark squares on white, with the quiet border scanners need. */
function QrCode({ text }: { text: string }) {
  const [squares, setSquares] = useState<{ size: number; path: string } | null>(null)
  useEffect(() => {
    let current = true
    // Fetched only when someone presents, so no other visitor downloads it. If it can't be fetched, the link in words is still there.
    import('qrcode-generator')
      .then(({ default: qrcode }) => {
        // The smallest code that holds the text, with medium error correction: a scratched or tilted screen still scans.
        const code = qrcode(0, 'M')
        code.addData(text)
        code.make()
        const size = code.getModuleCount()
        let path = ''
        for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) if (code.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`
        if (current) setSquares({ size, path })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [text])
  const QUIET = 4
  const side = (squares?.size ?? 33) + 2 * QUIET
  return (
    <svg className="follow-qr" viewBox={`${-QUIET} ${-QUIET} ${side} ${side}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect x={-QUIET} y={-QUIET} width={side} height={side} fill="#fff" />
      {squares && <path d={squares.path} fill="#000" />}
    </svg>
  )
}

/** What a presenter shows the room: the code to scan, the link in words, and how many are following. */
export function PresentPanel({ room, followers, onClose }: { room: string; followers: number | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  const link = followLink(window.location.origin, room)
  useEffect(() => {
    const panel = dialog.current
    if (panel && !panel.open) panel.showModal()
  }, [])
  return (
    <dialog ref={dialog} className="follow-panel" aria-labelledby="follow-panel-title" onClose={onClose}>
      <h2 id="follow-panel-title">Follow along on your phone</h2>
      <p>Scan the code or open the link. Your screen goes where this one goes.</p>
      <QrCode text={link} />
      {/* If the link has to wrap, it wraps before the "?", and the room's name stays in one piece. */}
      <code className="follow-link">
        {link.split('?')[0]}
        <wbr />
        <span>?{link.split('?')[1]}</span>
      </code>
      <p className="follow-count" role="status">
        {followers === null ? 'Counting who is following…' : `${people(followers)} following right now`}
      </p>
      <div className="follow-buttons">
        <button type="button" className="primary" onClick={() => dialog.current?.close()}>
          Hide the code
        </button>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(link)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? 'Link copied' : 'Copy the link'}
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            void stopPresenting()
            dialog.current?.close()
          }}
        >
          Stop presenting
        </button>
      </div>
      <p className="follow-note">Only this page’s address is shared: which tab, and the site, month, hour and limits on it. Nothing you type, and nothing about who is following.</p>
    </dialog>
  )
}
