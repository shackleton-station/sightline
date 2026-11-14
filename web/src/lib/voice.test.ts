import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpeaker, loadSound, saveSound, type VoiceState } from './voice'

describe('the sound preference', () => {
  const storage = () => {
    const kept = new Map<string, string>()
    return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) }
  }

  it('is unset until the visitor chooses, then remembered either way', () => {
    const kept = storage()
    expect(loadSound(kept)).toBeNull()
    saveSound(true, kept)
    expect(loadSound(kept)).toBe('on')
    saveSound(false, kept)
    expect(loadSound(kept)).toBe('off')
  })

  it('reads anything else as unset, and survives a browser that refuses storage', () => {
    const kept = storage()
    kept.setItem('scout-sound', 'loud')
    expect(loadSound(kept)).toBeNull()
    const refusing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(loadSound(refusing)).toBeNull()
    expect(() => saveSound(true, refusing)).not.toThrow()
    expect(loadSound(null)).toBeNull()
  })
})

describe('Scout speaking', () => {
  /** Stands in for the page's audio player. */
  class FakeAudio {
    static last: FakeAudio
    static refuses = false
    src = ''
    paused = true
    private readonly heard = new Map<string, () => void>()
    constructor() {
      FakeAudio.last = this
    }
    addEventListener(name: string, listener: () => void) {
      this.heard.set(name, listener)
    }
    play() {
      if (FakeAudio.refuses) return Promise.reject(new Error('NotAllowedError'))
      this.paused = false
      this.heard.get('playing')?.()
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
    finish() {
      this.heard.get('ended')?.()
    }
  }
  class FakeUtterance {
    lang = ''
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    readonly text: string
    constructor(text: string) {
      this.text = text
    }
  }
  const mp3 = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })
  const refusal = (status: number) => new Response('{"error":"x"}', { status, headers: { 'content-type': 'application/json' } })
  /** Lets the speaker's awaits run. */
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  function page(answer: () => Response | Promise<Response>, browserVoice = true) {
    const fetched = vi.fn(async (_url: string, _init: RequestInit) => answer())
    const synth = { speak: vi.fn(), cancel: vi.fn() }
    FakeAudio.refuses = false
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('fetch', fetched)
    vi.stubGlobal('window', browserVoice ? { speechSynthesis: synth } : {})
    if (browserVoice) vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    const states: VoiceState[] = []
    const speaker = createSpeaker((state) => states.push(state))
    const utterance = () => synth.speak.mock.lastCall?.[0] as FakeUtterance
    return { speaker, states, fetched, synth, audio: FakeAudio.last, utterance }
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("asks the server for Scout's voice, plays it, and follows the sound from start to end", async () => {
    const { speaker, states, fetched, synth, audio } = page(mp3)
    speaker.speak('At most 4 d 22 h of <b>darkness</b>.')
    await settle()
    expect(fetched).toHaveBeenCalledTimes(1)
    expect(fetched.mock.calls[0][0]).toBe('/api/speak')
    expect(fetched.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ text: 'At most 4 days 22 hours of darkness.' }) })
    expect(audio.src).toMatch(/^blob:/)
    expect(states.slice(-2)).toEqual(['loading', 'speaking'])
    audio.finish()
    expect(states.at(-1)).toBe('quiet')
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it("uses the browser's own voice when the server says no, and stops asking a server that is switched off", async () => {
    const { speaker, states, fetched, utterance } = page(() => refusal(503))
    speaker.speak('The Sun is up.')
    await settle()
    expect(utterance()).toMatchObject({ text: 'The Sun is up.', lang: 'en-US' })
    expect(states.at(-1)).toBe('loading')
    utterance().onstart?.()
    expect(states.at(-1)).toBe('speaking')
    utterance().onend?.()
    expect(states.at(-1)).toBe('quiet')

    speaker.speak('Earth is in view.')
    await settle()
    expect(fetched).toHaveBeenCalledTimes(1)
    expect(utterance().text).toBe('Earth is in view.')

    // Busy, or over the daily limit, is not "switched off": the next answer asks again.
    const busy = page(() => refusal(429))
    busy.speaker.speak('One.')
    await settle()
    busy.speaker.speak('Two.')
    await settle()
    expect(busy.fetched).toHaveBeenCalledTimes(2)
    expect(busy.synth.speak).toHaveBeenCalledTimes(2)
  })

  it("falls back to the browser's voice when the audio will not play or the server cannot be reached", async () => {
    const blocked = page(mp3)
    FakeAudio.refuses = true
    blocked.speaker.speak('Hello.')
    await settle()
    expect(blocked.utterance().text).toBe('Hello.')

    const offline = page(() => Promise.reject(new TypeError('Failed to fetch')))
    offline.speaker.speak('Hello.')
    await settle()
    expect(offline.utterance().text).toBe('Hello.')
  })

  it('stops at once: while fetching, while playing, and while the browser voice talks', async () => {
    let signal: AbortSignal | null | undefined
    const slow = page(() => new Promise<Response>(() => {}))
    slow.fetched.mockImplementation((_url, init) => {
      signal = init.signal
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    slow.speaker.speak('Hello.')
    await settle()
    slow.speaker.stop()
    await settle()
    expect(signal?.aborted).toBe(true)
    expect(slow.states.at(-1)).toBe('quiet')
    expect(slow.audio.src).toBe('')
    expect(slow.synth.speak).not.toHaveBeenCalled()

    const playing = page(mp3)
    playing.speaker.speak('Hello.')
    await settle()
    expect(playing.audio.paused).toBe(false)
    playing.speaker.stop()
    expect(playing.audio.paused).toBe(true)
    expect(playing.states.at(-1)).toBe('quiet')
    // The end of a clip that was stopped changes nothing.
    playing.audio.finish()
    expect(playing.states.at(-1)).toBe('quiet')

    const talking = page(() => refusal(502))
    talking.speaker.speak('Hello.')
    await settle()
    const first = talking.utterance()
    first.onstart?.()
    talking.speaker.stop()
    expect(talking.synth.cancel).toHaveBeenCalled()
    first.onerror?.()
    expect(talking.states.at(-1)).toBe('quiet')
  })

  it('a new answer replaces the one being said', async () => {
    const { speaker, fetched, audio, states } = page(mp3)
    speaker.speak('One.')
    await settle()
    const first = audio.src
    speaker.speak('Two.')
    await settle()
    expect(fetched).toHaveBeenCalledTimes(2)
    expect(audio.src).not.toBe(first)
    expect(states.at(-1)).toBe('speaking')
  })

  it('says so when nothing can speak, or the browser voice never starts', async () => {
    const mute = page(() => refusal(502), false)
    mute.speaker.speak('Hello.')
    await settle()
    expect(mute.states.at(-1)).toBe('failed')

    const stuck = page(() => refusal(502))
    vi.useFakeTimers()
    stuck.speaker.speak('Hello.')
    await vi.advanceTimersByTimeAsync(10)
    expect(stuck.states.at(-1)).toBe('loading')
    await vi.advanceTimersByTimeAsync(4000)
    expect(stuck.states.at(-1)).toBe('failed')
    expect(stuck.synth.cancel).toHaveBeenCalled()
  })

  it('says nothing for text with no words in it', async () => {
    const { speaker, fetched, states } = page(mp3)
    speaker.speak('<p></p> ** ')
    await settle()
    expect(fetched).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe('quiet')
  })
})
