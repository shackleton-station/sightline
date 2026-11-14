import { afterEach, describe, expect, it, vi } from 'vitest'
import { listen, micProblem, type Recognizer, recognizerClass } from './listen'

/** Stands in for the browser's speech recognition; the test plays the browser's part. */
class FakeRecognizer implements Recognizer {
  static last: FakeRecognizer
  static failToStart = false
  lang = ''
  continuous = true
  interimResults = false
  maxAlternatives = 5
  onresult: Recognizer['onresult'] = null
  onerror: Recognizer['onerror'] = null
  onend: Recognizer['onend'] = null
  started = false
  stopped = false
  aborted = false
  constructor() {
    FakeRecognizer.last = this
  }
  start() {
    if (FakeRecognizer.failToStart) throw new Error('InvalidStateError')
    this.started = true
  }
  stop() {
    this.stopped = true
  }
  abort() {
    this.aborted = true
  }
  hears(...phrases: string[]) {
    this.onresult?.({ results: phrases.map((transcript) => [{ transcript }]) })
  }
}

describe('asking out loud', () => {
  const listening = () => {
    const words = vi.fn()
    const end = vi.fn()
    const session = listen(FakeRecognizer, { words, end })
    return { words, end, session, browser: FakeRecognizer.last }
  }
  afterEach(() => {
    FakeRecognizer.failToStart = false
  })

  it('finds the recognition under either name, or says there is none', () => {
    expect(recognizerClass({ SpeechRecognition: FakeRecognizer })).toBe(FakeRecognizer)
    expect(recognizerClass({ webkitSpeechRecognition: FakeRecognizer })).toBe(FakeRecognizer)
    expect(recognizerClass({})).toBeNull()
  })

  it('listens for one question in English, shows the words as they come, and asks when the visitor stops', () => {
    const { words, end, browser } = listening()
    expect(browser).toMatchObject({ started: true, lang: 'en-US', continuous: false, interimResults: true, maxAlternatives: 1 })
    browser.hears('when can')
    browser.hears('when can I land', ' here ')
    expect(words.mock.calls.map((call) => call[0])).toEqual(['when can', 'when can I land here'])
    expect(end).not.toHaveBeenCalled()
    browser.onend?.()
    browser.onend?.()
    expect(end).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledWith('when can I land here', null)
  })

  it('throws away what was heard when cancelled, at once', () => {
    const { words, end, session, browser } = listening()
    browser.hears('when can')
    session.cancel()
    expect(browser.aborted).toBe(true)
    expect(end).toHaveBeenCalledWith('', null)
    // The browser's own goodbye, and anything it still recognizes, change nothing.
    browser.onerror?.({ error: 'aborted' })
    browser.hears('when can I')
    browser.onend?.()
    expect(end).toHaveBeenCalledTimes(1)
    expect(words).toHaveBeenCalledTimes(1)
  })

  it('asks what was heard so far when told to finish', () => {
    const { end, session, browser } = listening()
    browser.hears('how sunny is it')
    session.finish()
    expect(browser.stopped).toBe(true)
    browser.onend?.()
    expect(end).toHaveBeenCalledWith('how sunny is it', null)
  })

  it('explains a refused microphone, silence and other failures in plain sentences', async () => {
    const refused = listening()
    refused.browser.onerror?.({ error: 'not-allowed' })
    refused.browser.onend?.()
    expect(refused.end).toHaveBeenCalledWith('', expect.stringContaining('microphone is switched off for this site'))

    const silent = listening()
    silent.browser.onend?.()
    expect(silent.end).toHaveBeenCalledWith('', expect.stringContaining("didn't hear anything"))

    for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'no-speech', 'network', 'language-not-supported', 'something-new']) {
      const sentence = micProblem(code)
      expect(sentence).toMatch(/^[A-Z].*\.$/)
      expect(sentence).not.toContain(code)
      expect(sentence).not.toMatch(/error/i)
    }
    expect(micProblem('aborted')).toBeNull()

    // A browser that refuses to start is reported the same way, once `listen` has returned.
    FakeRecognizer.failToStart = true
    const broken = listening()
    expect(broken.end).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(broken.end).toHaveBeenCalledWith('', expect.stringContaining('type your question'))
  })
})
