import { describe, expect, it } from 'vitest'
import { forSpeech, plainSentences, SPEAK_MAX_CHARS } from './speech'

describe('text on its way to a voice', () => {
  it('keeps ordinary sentences as they are', () => {
    const answer = "The Sun is up 59.5% of May 2027 (that's most of it); Earth isn't: it sets on 21 June 2027, 17:00 UTC."
    expect(plainSentences(answer)).toBe(answer)
    expect(plainSentences('  Olá,\n  Scout — ça va?  ')).toBe('Olá, Scout — ça va?')
  })

  it('removes markup of every kind, and whatever sits inside a tag', () => {
    expect(plainSentences('<speak>Hello <break time="3s"/>there</speak>')).toBe('Hello there')
    expect(plainSentences('<prosody rate="x-slow" onload="alert(1)">Slow</prosody> &amp; steady &#60;')).toBe('Slow steady')
    expect(plainSentences('**Bold** _and_ `code` [pause long] {{r1.pct_sun}} # heading | a\\b')).toBe('Bold and code pause long r1.pct sun heading a b')
    expect(plainSentences('See https://evil.example/a?b=c')).toBe('See https: evil.example a?b c')
    expect(plainSentences('<<<>>> \u0000​')).toBe('')
  })

  it('says the units the data writes short, without touching a number', () => {
    expect(forSpeech('At most 4 d 22 h of darkness, then 1 d 1 h of light. Sunset in 22 h.')).toBe(
      'At most 4 days 22 hours of darkness, then 1 day 1 hour of light. Sunset in 22 hours.',
    )
    expect(forSpeech('A custom point at 89.460°S, 137.200°W, Earth at least 2° above the terrain.')).toBe(
      'A custom point at 89.460 degrees south, 137.200 degrees west, Earth at least 2 degrees above the terrain.',
    )
    expect(forSpeech('A vertical panel gets 656 W/m² of sunlight, 12 km away.')).toBe('A vertical panel gets 656 watts per square meter of sunlight, 12 km away.')
    // Letters that only look like units are left alone.
    expect(forSpeech('Plan d has 3 days. Apollo 11 landed.')).toBe('Plan d has 3 days. Apollo 11 landed.')
  })

  it('stops a very long answer at its last whole sentence that fits', () => {
    const sentence = 'The Sun is up most of the month. '
    const long = sentence.repeat(40)
    const said = forSpeech(long)
    expect(said.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS)
    expect(said.endsWith('month.')).toBe(true)
    expect(long.startsWith(said)).toBe(true)
    // With no sentence to stop at, it is simply cut.
    expect(forSpeech('a'.repeat(2000))).toHaveLength(SPEAK_MAX_CHARS)
  })
})
