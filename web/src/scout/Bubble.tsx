import type { ChatMessage } from '../lib/chatClient'

interface Props {
  /** What Scout is saying: its own line about the hour on screen, or the latest answer. */
  text: string
  /** The latest answer, when the bubble is showing one. */
  answer: ChatMessage | null
  thinking: boolean
  /** While thinking: what is being looked up right now, if anything yet. */
  step: string | null
  /** Things to tap when Scout isn't answering: ideas to ask. */
  ideas: string[]
  onAsk: (question: string) => void
  onOpen: (hash: string) => void
  /** Put the answer away and go back to Scout's own line. */
  onDismiss: () => void
  /** Whether Scout says answers aloud, and the switch for it. */
  sound: boolean
  onSound: (on: boolean) => void
  /** Sound is on but this answer couldn't be said, so it is only written. */
  unsaid: boolean
}

/** A loudspeaker, with waves when sound is on and a cross when it is off. */
export function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" fill="currentColor" />
      {on ? <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a7.8 7.8 0 0 1 0 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
    </svg>
  )
}

/**
 * Scout's speech bubble. This is the chat: what Scout says, and under it what you can tap next.
 * An answer brings buttons that move the scene, the lookups it was based on, and follow-up questions.
 *
 * With sound on, Scout says each answer aloud, so a screen reader is not asked to read it as well:
 * the bubble stops announcing itself from the moment a question is asked until the answer is put
 * away (the "looking that up" line is a status of its own and is still announced). If the voice
 * fails, a hidden status line announces the answer instead, so it is never lost.
 */
export function Bubble({ text, answer, thinking, step, ideas, onAsk, onOpen, onDismiss, sound, onSound, unsaid }: Props) {
  // Two follow-ups are enough to keep going; more would crowd the Moon.
  const chips = answer ? (answer.followups ?? []).slice(0, 2) : ideas
  return (
    <div className={answer || thinking ? 'scout-bubble' : 'scout-bubble own'} aria-live={sound && (answer || thinking) ? 'off' : 'polite'}>
      <div className="scout-head">
        <p className="scout-name">Scout</p>
        <button type="button" className="scout-sound" aria-pressed={sound} title={sound ? 'Scout says its answers aloud' : 'Hear Scout say its answers'} onClick={() => onSound(!sound)}>
          <SoundIcon on={sound} />
          Sound <span aria-hidden="true">{sound ? 'on' : 'off'}</span>
        </button>
      </div>
      {thinking ? (
        <p className="scout-says thinking" role="status">
          {step ? `Looking at ${step}` : 'Let me look that up'}
          <span className="scout-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
      ) : (
        <p className={answer?.failed ? 'scout-says failed' : 'scout-says'}>{text}</p>
      )}

      {!thinking && answer && unsaid && <p className="scout-unsaid">I couldn't say that one aloud here, so it is only written.</p>}
      <p className="scout-sr" role="status">
        {!thinking && answer && unsaid ? answer.text : ''}
      </p>

      {!thinking && answer?.actions && answer.actions.length > 0 && (
        <div className="scout-go">
          {answer.actions.map((action) => (
            <button key={action.hash} type="button" onClick={() => onOpen(action.hash)}>
              {action.label} →
            </button>
          ))}
        </div>
      )}

      {!thinking && chips.length > 0 && (
        <div className="scout-chips">
          {chips.map((chip) => (
            <button key={chip} type="button" onClick={() => onAsk(chip)}>
              {chip}
            </button>
          ))}
        </div>
      )}

      {!thinking && answer && (
        <p className="scout-foot">
          {answer.sources && answer.sources.length > 0 && <span>Looked up: {answer.sources.join(' · ')}</span>}
          <button type="button" className="scout-dismiss" onClick={onDismiss}>
            Got it
          </button>
        </p>
      )}
    </div>
  )
}
