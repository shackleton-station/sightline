import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../lib/chatClient'
import { listen, type Listening, recognizerClass } from '../lib/listen'
import { createSpeaker, loadSound, saveSound, type Speaker, type VoiceState } from '../lib/voice'

/**
 * Scout's voice. Sound is off until the visitor turns it on (or asks a question out loud), and the
 * choice is remembered. With sound on, each answer is said once, when it comes on show; `answer` going back
 * to null (a new question, the bubble folded, the site left, the answer put away) stops it at once.
 * Nothing is ever said on page load: there is no answer until the visitor asks.
 */
export function useVoice(answer: ChatMessage | null) {
  const [sound, setSoundOn] = useState(() => loadSound() === 'on')
  const [state, setState] = useState<VoiceState>('quiet')
  const speaker = useRef<Speaker | null>(null)
  const said = useRef<ChatMessage | null>(null)
  const theSpeaker = () => (speaker.current ??= createSpeaker(setState))

  const setSound = useCallback((on: boolean) => {
    saveSound(on)
    setSoundOn(on)
    // Turning sound on is a tap, which is what lets the browser play the answers that follow.
    if (on) theSpeaker().prime()
    else speaker.current?.stop()
  }, [])

  /** A tap or key press that will lead to an answer: lets the browser play it when it arrives. */
  const prime = useCallback(() => {
    if (loadSound() === 'on') theSpeaker().prime()
  }, [])

  /** The microphone was pressed: Scout stops talking, so it doesn't hear itself. */
  const micPressed = useCallback(() => {
    speaker.current?.stop()
    // The answer may be said aloud (see `micHeard`), and this press is the tap that allows it.
    if (loadSound() !== 'off') theSpeaker().prime()
  }, [])

  /** A question was asked out loud: Scout answers aloud from now on, unless the visitor chose silence. */
  const micHeard = useCallback(() => {
    if (loadSound() === null) setSound(true)
  }, [setSound])

  useEffect(() => {
    if (!answer) speaker.current?.stop()
    else if (sound && said.current !== answer) {
      said.current = answer
      theSpeaker().speak(answer.text)
    }
  }, [answer, sound])

  // Leaving the page, or putting it in the background for good, ends the sound with it.
  useEffect(() => {
    const stop = () => speaker.current?.stop()
    window.addEventListener('pagehide', stop)
    return () => {
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [])

  return { sound, setSound, prime, micPressed, micHeard, speaking: state === 'speaking', failed: state === 'failed' }
}

/**
 * Asking out loud, with the browser's own speech recognition. `onWords` hears the words as they are
 * recognized; `onDone` gets the question when the visitor stops talking. `supported` is false where
 * the browser has no speech recognition, and the microphone button is then not shown.
 */
export function useMic(onWords: (text: string) => void, onDone: (text: string) => void) {
  const [Recognition] = useState(() => recognizerClass(window))
  const [listening, setListening] = useState(false)
  /** A plain sentence when listening didn't work, for example when the microphone is blocked. */
  const [note, setNote] = useState<string | null>(null)
  const session = useRef<Listening | null>(null)
  // The latest handlers, so a question that ends later is given to the page as it is then.
  const handlers = useRef({ onWords, onDone })
  useEffect(() => {
    handlers.current = { onWords, onDone }
  })
  useEffect(() => () => session.current?.cancel(), [])

  const start = () => {
    if (!Recognition || session.current) return
    setNote(null)
    setListening(true)
    session.current = listen(Recognition, {
      words: (text) => handlers.current.onWords(text),
      end: (text, problem) => {
        session.current = null
        setListening(false)
        setNote(problem)
        handlers.current.onDone(text)
      },
    })
  }

  return {
    supported: Recognition !== null,
    listening,
    note,
    /** Puts the sentence away, once the visitor has moved on. */
    clearNote: () => setNote(null),
    start,
    finish: () => session.current?.finish(),
    cancel: () => session.current?.cancel(),
  }
}
