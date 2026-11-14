import { type FormEvent, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { MAX_QUESTION_CHARS } from '../lib/chatClient'
import { monthLabel } from '../lib/months'
import { SharePlan } from '../components/SharePlan'
import { useMic } from './useVoice'

interface ChooseProps {
  sites: SiteInfo[]
  onChoose: (site: SiteInfo) => void
}

const FEATURED = 'connecting-ridge'
const latitude = (site: SiteInfo) => `${Math.abs(site.lat).toFixed(1)}°${site.lat < 0 ? 'S' : 'N'}`

/** The first question: where are we landing? */
export function ChooseSite({ sites, onChoose }: ChooseProps) {
  const [search, setSearch] = useState('')
  const wanted = search.trim().toLowerCase()
  const found = sites.filter((site) => !wanted || `${site.name} ${site.group}`.toLowerCase().includes(wanted))
  const featured = sites.find((site) => site.id === FEATURED)
  const groups = [...new Set(found.map((site) => site.group))]

  return (
    <>
      <h1>Where are we landing?</h1>
      <p className="scout-lede">
        Pick a site. Then ask Scout when the Sun is up for power and Earth is in view for radio.
      </p>
      <label className="scout-search">
        <span className="scout-sr">Search sites</span>
        <input type="search" placeholder="Search sites" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>

      {!wanted && featured && (
        <button type="button" className="scout-tile featured" onClick={() => onChoose(featured)}>
          <strong>{featured.name}</strong>
          <span>
            {latitude(featured)} · <em>Suggested</em>
          </span>
        </button>
      )}

      {groups.map((group) => (
        <section key={group}>
          <h2 className="scout-kicker">{group}</h2>
          <div className="scout-tiles">
            {found
              .filter((site) => site.group === group)
              .map((site) => (
                <button key={site.id} type="button" className="scout-tile" onClick={() => onChoose(site)}>
                  <strong>{site.name}</strong>
                  <span>{latitude(site)}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
      {found.length === 0 && <p className="scout-lede">No site by that name. Try “Apollo” or “Shackleton”.</p>}
    </>
  )
}

interface AskProps {
  sites: SiteInfo[]
  site: SiteInfo
  month: string
  months: string[]
  ideas: string[]
  waiting: boolean
  onAsk: (question: string) => void
  onSite: (site: SiteInfo) => void
  onMonth: (month: string) => void
  onBack: () => void
  /** The view on screen, as the "#a=…" part of a link, for sharing it as a plan. */
  view: string
  /** The microphone was pressed, and then a question was heard through it. */
  onMic: () => void
  onHeard: () => void
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  )
}

/** At a site: one question, "what do you want to know?", with a few ideas to tap. */
export function AskScout({ sites, site, month, months, ideas, waiting, onAsk, onSite, onMonth, onBack, view, onMic, onHeard }: AskProps) {
  const [draft, setDraft] = useState('')
  // Asking out loud: the words appear in the box as they are recognized, and are asked when the visitor stops.
  const mic = useMic(setDraft, (question) => {
    setDraft('')
    if (!question) return
    onHeard()
    onAsk(question)
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (draft.trim() === '' || waiting) return
    // While listening, the button asks what has been heard so far.
    if (mic.listening) return mic.finish()
    onAsk(draft)
    setDraft('')
  }
  const at = months.indexOf(month)

  return (
    <>
      <div className="scout-where">
        <button type="button" onClick={onBack}>
          ‹ All sites
        </button>
        <label>
          <span className="scout-sr">Landing site</span>
          <select value={site.id} onChange={(event) => onSite(sites.find((candidate) => candidate.id === event.target.value) ?? site)}>
            {sites.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form className="scout-ask" onSubmit={submit}>
        {/* While listening, the heading makes way for what the microphone is doing and a way to stop it. */}
        {!mic.listening && <p className="scout-kicker">What do you want to know? Just ask Scout</p>}
        <p className={mic.listening ? 'scout-hearing on' : 'scout-hearing'} role="status">
          {mic.listening ? 'Listening, in English. I’ll ask when you stop talking.' : mic.note}
          {mic.listening && (
            <button type="button" onClick={mic.cancel}>
              Cancel
            </button>
          )}
        </p>
        <div className="scout-ask-row">
          <textarea
            rows={2}
            maxLength={MAX_QUESTION_CHARS}
            placeholder={mic.listening ? 'Listening…' : mic.supported ? 'Type it or say it: when can I land here?' : 'Type it: when can I land here?'}
            aria-label="Your question for Scout"
            value={draft}
            readOnly={mic.listening}
            onChange={(event) => {
              setDraft(event.target.value)
              mic.clearNote()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) submit(event)
            }}
          />
          {mic.supported && (
            <button
              type="button"
              className="scout-mic"
              aria-label="Ask out loud (English)"
              title="Ask out loud (English)"
              aria-pressed={mic.listening}
              disabled={waiting}
              onClick={() => {
                if (mic.listening) return mic.finish()
                onMic()
                mic.start()
              }}
            >
              <MicIcon />
            </button>
          )}
        </div>
        <button type="submit" className="scout-primary" disabled={waiting || draft.trim() === ''}>
          {waiting ? 'Scout is looking…' : 'Ask Scout'}
        </button>
        <p className="scout-kept">
          Questions may be kept to improve Scout, never with who asked. Don’t type or say anything private.
          {mic.supported && ' The microphone uses your browser’s own speech recognition, which may send the sound to the browser’s maker.'}
        </p>
      </form>

      <p className="scout-kicker">Or tap an idea to start</p>
      <ul className="scout-ideas">
        {ideas.map((idea) => (
          <li key={idea}>
            <button type="button" disabled={waiting} onClick={() => onAsk(idea)}>
              <span>{idea}</span>
              <i aria-hidden="true">›</i>
            </button>
          </li>
        ))}
      </ul>

      <p className="scout-kicker">Month</p>
      <div className="scout-month">
        <button type="button" aria-label="Previous month" disabled={at <= 0} onClick={() => onMonth(months[at - 1])}>
          ‹
        </button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" aria-label="Next month" disabled={at < 0 || at >= months.length - 1} onClick={() => onMonth(months[at + 1])}>
          ›
        </button>
      </div>

      <p className="scout-kicker">Send it to someone</p>
      <SharePlan view={view} suggestedTitle={`${site.name}, ${monthLabel(month)}`} />
    </>
  )
}
