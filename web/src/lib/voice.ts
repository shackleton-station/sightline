import { forSpeech } from './speech'

/**
 * Scout speaking, without React: the sound preference, and a speaker that says an answer aloud.
 * Asking out loud is in `listen.ts`; `scout/useVoice.ts` wraps both for the page.
 */

// ---------- The sound preference ----------

const SOUND_KEY = 'scout-sound'
type Keeps = Pick<Storage, 'getItem' | 'setItem'>

const browserStorage = (): Keeps | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** What the visitor chose on an earlier visit: sound on, sound off, or null if they never chose. */
export function loadSound(storage: Keeps | null = browserStorage()): 'on' | 'off' | null {
  try {
    const saved = storage?.getItem(SOUND_KEY)
    return saved === 'on' || saved === 'off' ? saved : null
  } catch {
    return null
  }
}

export function saveSound(on: boolean, storage: Keeps | null = browserStorage()): void {
  try {
    storage?.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // Private windows and full storage: sound still works, it just isn't remembered.
  }
}

// ---------- Voice out: Scout says an answer ----------

/** quiet: nothing to say. loading: fetching the voice. speaking: sound is playing. failed: this answer couldn't be said. */
export type VoiceState = 'quiet' | 'loading' | 'speaking' | 'failed'

export interface Speaker {
  /** Call from a tap or a key press: browsers only let a page make sound that a person started. */
  prime(): void
  /** Says the text, replacing anything being said. */
  speak(text: string): void
  /**
   * Fetches the voice for a text that will be said next, so that it starts at once when asked for.
   * Only the latest prepared text is kept. Optional: `speak` works the same without it.
   */
  prepare(text: string): void
  /** Stops at once. */
  stop(): void
}

/** A moment of silence as a WAV file: playing it during a tap lets later answers play on their own. */
function silence(): string {
  const samples = 400
  const wav = new Uint8Array(44 + samples).fill(128)
  const view = new DataView(wav.buffer)
  const ascii = (at: number, text: string) => [...text].forEach((letter, i) => view.setUint8(at + i, letter.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // one channel
  view.setUint32(24, 8000, true) // samples a second
  view.setUint32(28, 8000, true) // bytes a second
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true) // bits a sample
  ascii(36, 'data')
  view.setUint32(40, samples, true)
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
}

/** How long the browser's own voice may take to start before the answer counts as not said. */
const BROWSER_VOICE_START_MS = 4000

/**
 * Says answers aloud. It asks the server for Scout's voice (POST /api/speak) and plays the audio; if
 * the server says no for any reason, or the audio won't play, the browser's own voice says it instead.
 * `onState` hears what is happening, so the page can show that Scout is speaking.
 */
export function createSpeaker(onState: (state: VoiceState) => void): Speaker {
  // One player for the whole visit: once a tap has let it play, it may play again without one.
  const audio = new Audio()
  const synth: SpeechSynthesis | undefined = window.speechSynthesis
  let primed = false
  /** Counts what has been asked of the speaker, so a slow step can tell it has been overtaken. */
  let turn = 0
  let request: AbortController | null = null
  let clip: string | null = null
  /** True while the player holds an answer, not the silence it was primed with. */
  let answering = false
  /** Set once the server says its voice is switched off, so it isn't asked again this visit. */
  let serverOff = false
  /** Kept so the browser doesn't discard the utterance, and its events, half way through. */
  let utterance: SpeechSynthesisUtterance | null = null
  let slowStart: ReturnType<typeof setTimeout> | undefined

  const release = () => {
    if (clip) URL.revokeObjectURL(clip)
    clip = null
  }
  audio.addEventListener('playing', () => {
    if (answering) onState('speaking')
  })
  audio.addEventListener('ended', () => {
    if (!answering) return
    answering = false
    release()
    onState('quiet')
  })

  const stop = () => {
    turn += 1
    request?.abort()
    request = null
    clearTimeout(slowStart)
    answering = false
    audio.pause()
    release()
    utterance = null
    synth?.cancel()
    onState('quiet')
  }

  /** A text fetched ahead of being said (see `prepare`). Stopping what is being said leaves it alone. */
  let ahead: { words: string; sound: Promise<Blob | null>; cancel: AbortController } | null = null

  const fetchVoice = async (words: string, signal: AbortSignal): Promise<Blob | null> => {
    try {
      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: words }),
        signal,
      })
      if (response.status === 503) serverOff = true
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) return null
      return await response.blob()
    } catch {
      return null
    }
  }

  /** Scout's voice from the server, or null if it can't be had. */
  const fromServer = (words: string): Promise<Blob | null> => {
    if (ahead?.words === words) {
      const ready = ahead.sound
      ahead = null
      return ready
    }
    if (serverOff) return Promise.resolve(null)
    request = new AbortController()
    return fetchVoice(words, request.signal)
  }

  /** The browser's own voice: less natural, but it needs nothing from us. */
  const withBrowserVoice = (words: string, mine: number) => {
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return onState('failed')
    const settle = (state: VoiceState) => {
      clearTimeout(slowStart)
      if (mine === turn) onState(state)
    }
    utterance = new SpeechSynthesisUtterance(words)
    utterance.lang = 'en-US'
    utterance.onstart = () => settle('speaking')
    utterance.onend = () => settle('quiet')
    utterance.onerror = () => settle('failed')
    // A browser with no voice installed accepts the request and then says nothing.
    slowStart = setTimeout(() => {
      if (mine !== turn) return
      synth.cancel()
      onState('failed')
    }, BROWSER_VOICE_START_MS)
    synth.speak(utterance)
  }

  const speak = async (text: string) => {
    stop()
    const mine = turn
    const words = forSpeech(text)
    if (!words) return
    onState('loading')
    const sound = await fromServer(words)
    if (mine !== turn) return
    if (sound) {
      clip = URL.createObjectURL(sound)
      audio.src = clip
      answering = true
      try {
        await audio.play()
        return
      } catch {
        // Stopped while starting, or the browser refused to play it.
        if (mine !== turn) return
        answering = false
        release()
      }
    }
    withBrowserVoice(words, mine)
  }

  return {
    prime() {
      if (primed) return
      primed = true
      const quiet = silence()
      audio.src = quiet
      audio.play().catch(() => {}).finally(() => URL.revokeObjectURL(quiet))
      // The same for the browser's voice: its first words must come from a tap.
      if (synth && typeof SpeechSynthesisUtterance !== 'undefined') synth.speak(new SpeechSynthesisUtterance(''))
    },
    speak: (text) => void speak(text),
    prepare(text) {
      const words = forSpeech(text)
      if (!words || serverOff || ahead?.words === words) return
      ahead?.cancel.abort()
      const cancel = new AbortController()
      ahead = { words, sound: fetchVoice(words, cancel.signal), cancel }
    },
    stop,
  }
}
