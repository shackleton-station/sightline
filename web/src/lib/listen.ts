/**
 * Asking Scout out loud, without React: the browser's own speech recognition (the Web Speech API).
 * Most current browsers have it, some only under an older name (`webkitSpeechRecognition`); where
 * there is none, the page shows no microphone. Some browsers send the sound to their maker's servers
 * to be recognized, which the page says next to the button.
 */

/** The part of the Web Speech API's SpeechRecognition used here (TypeScript doesn't ship its type). */
export interface Recognizer {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognizerClass = new () => Recognizer

/** The browser's speech recognition, under either of its names, or null where there is none. */
export function recognizerClass(scope: object = globalThis): RecognizerClass | null {
  const found = scope as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass }
  return found.SpeechRecognition ?? found.webkitSpeechRecognition ?? null
}

const NOT_HEARD = "I didn't hear anything. Press the microphone and try again."

/** Why listening stopped, as a plain sentence. Null when it was stopped on purpose. */
export function micProblem(error: string): string | null {
  switch (error) {
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return "The microphone is switched off for this site. You can allow it in your browser's site settings, or type your question."
    case 'audio-capture':
      return "I couldn't find a microphone. You can type your question instead."
    case 'no-speech':
      return NOT_HEARD
    case 'network':
      return "Your browser couldn't reach its speech service. You can type your question instead."
    case 'language-not-supported':
      return "Your browser can't listen in English here. You can type your question instead."
    default:
      return "Listening didn't work this time. You can type your question instead."
  }
}

export interface Listening {
  /** Stop listening and use what was heard so far. */
  finish(): void
  /** Stop listening and throw away what was heard. */
  cancel(): void
}

export interface Listener {
  /** The words so far, each time more are recognized. */
  words(text: string): void
  /** Listening is over: what was said ('' if nothing or cancelled), and a sentence to show if it went wrong. */
  end(text: string, problem: string | null): void
}

/**
 * Listens for one spoken question in English. The browser decides when the visitor has stopped
 * talking, and `end` is then called exactly once.
 */
export function listen(Recognition: RecognizerClass, on: Listener): Listening {
  const recognizer = new Recognition()
  recognizer.lang = 'en-US'
  recognizer.continuous = false
  recognizer.interimResults = true
  recognizer.maxAlternatives = 1
  let heard = ''
  let cancelled = false
  let problem: string | null = null
  let over = false
  const end = () => {
    if (over) return
    over = true
    if (cancelled) on.end('', null)
    else if (heard) on.end(heard, null)
    else on.end('', problem ?? NOT_HEARD)
  }

  recognizer.onresult = (event) => {
    const parts = Array.from(event.results, (result) => result[0]?.transcript ?? '')
    heard = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (!cancelled) on.words(heard)
  }
  recognizer.onerror = (event) => {
    problem = micProblem(event.error)
  }
  recognizer.onend = end
  try {
    recognizer.start()
  } catch {
    // Reported a moment later, so every ending arrives after `listen` has returned.
    problem = micProblem('start-failed')
    queueMicrotask(end)
  }
  return {
    finish: () => recognizer.stop(),
    cancel: () => {
      cancelled = true
      recognizer.abort()
      end()
    },
  }
}
