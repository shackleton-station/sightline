import { useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { loadRange } from '../data/loadSite'
import { applyAsk, ASK_MAX_CHARS, askMonths, type AskResult, describeAsk, notUnderstoodMessage } from '../lib/ask'
import { DEFAULT_WAIT_SECONDS, retryAfterSeconds, waitWords } from '../lib/chatClient'
import { useCooldown } from '../lib/cooldown'
import type { Requirements } from '../lib/mission'
import { decodeView, encodeView } from '../lib/urlState'

interface Props {
  sites: SiteInfo[]
  /** Limits to fall back on if the address doesn't hold a view yet. */
  requirements: Requirements
}

const ERRORS: Record<string, string> = {
  busy: 'Too many questions right now. Try again in a minute, or set the limits below by hand.',
  'bad-question': `Questions can be up to ${ASK_MAX_CHARS} characters.`,
  declined: 'The language model declined that question. Ask about a site, a month or your mission limits, or set them below by hand.',
}
const FALLBACK_ERROR = "Typed questions aren't working right now. Everything below still works by hand."

/**
 * Type a question in plain English; a language model only picks which settings it means. The app
 * then applies them like a link, and lists what it set so nothing is taken on trust.
 */
export function AskBox({ sites, requirements }: Props) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [understood, setUnderstood] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cooldown = useCooldown()

  const ask = async () => {
    const text = question.trim()
    if (!text || busy || cooldown.secondsLeft > 0) return
    setBusy(true)
    setError(null)
    setUnderstood(null)
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text }),
      })
      const body = (await response.json().catch(() => ({}))) as { result?: AskResult; error?: string }
      // "Busy" says how long to wait (Retry-After): the button stays off until then, and says so.
      if ((response.status === 429 || response.status === 503) && body.error !== 'not-configured') {
        const wait = retryAfterSeconds(response.headers.get('retry-after'), body) ?? DEFAULT_WAIT_SECONDS
        cooldown.start(wait)
        setError(`Too many questions right now. Try again ${waitWords(wait)}, or set the limits below by hand.`)
        return
      }
      if (!response.ok || !body.result) {
        // The years a question can name are the data's own; if they can't be read, the message does without them.
        const months = body.error === 'not-understood' ? await loadRange().then(askMonths, () => null) : null
        setError(body.error === 'not-understood' ? notUnderstoodMessage(sites.length, months) : (ERRORS[body.error ?? ''] ?? FALLBACK_ERROR))
        return
      }
      const current = decodeView(window.location.hash, requirements)
      if (!current) {
        setError(FALLBACK_ERROR)
        return
      }
      setUnderstood(describeAsk(body.result, sites))
      // Same path as opening a link: the app reads the new address and shows that view.
      window.location.hash = encodeView(applyAsk(current, body.result))
    } catch {
      setError(FALLBACK_ERROR)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="ask-box"
      onSubmit={(event) => {
        event.preventDefault()
        void ask()
      }}
    >
      <label htmlFor="ask-input">Ask in your own words</label>
      <div className="ask-row">
        <input
          id="ask-input"
          type="text"
          value={question}
          maxLength={ASK_MAX_CHARS}
          placeholder="e.g. a two-week mission near Shackleton in spring 2027 that needs Earth contact"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" disabled={busy || cooldown.secondsLeft > 0 || question.trim() === ''}>
          {busy ? 'Reading…' : cooldown.secondsLeft > 0 ? `Wait ${cooldown.secondsLeft} s` : 'Set up'}
        </button>
      </div>
      {understood && (
        <p className="ask-understood" role="status">
          Set: {understood.join(' · ')}. Check these below; every number on the page comes from our data, not the
          language model.
        </p>
      )}
      {error && (
        <p className="ask-error" role="alert">
          {error}
        </p>
      )}
      <p className="ask-note">AI-assisted: a language model (Anthropic's Claude) reads your question. Don't type personal details.</p>
    </form>
  )
}
