import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import type { Deps, Speech } from '../deps'
import { memoryStore } from '../../shared/store'

const ORIGIN = 'https://clps-web.example.run.app'
/** Stands in for an MP3: the handler passes whatever the voice returns straight through. */
const AUDIO = new Uint8Array([0xff, 0xf3, 0x44, 0xc4, 1, 2, 3, 4])

/** A voice that returns the same few bytes for anything, and remembers what it was asked to say. */
function voice() {
  return { say: vi.fn<Speech['say']>(async () => ({ bytes: AUDIO, type: 'audio/mpeg' })) }
}

const site = (overrides: Partial<Deps> = {}) => createApp({ distDir: '/nonexistent', bucket: null, allowedOrigins: [], speech: voice(), ...overrides })

const post = (body: unknown, init: { origin?: string | null; method?: string; visitor?: string } = {}) => {
  const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': init.visitor ?? '203.0.113.7' })
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN)
  const method = init.method ?? 'POST'
  return new Request(`${ORIGIN}/api/speak`, { method, headers, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
}
const say = (text: string, init: Parameters<typeof post>[1] = {}) => post({ text }, init)

describe('POST /api/speak', () => {
  it('returns the audio as it came from the voice, with its type, never cached or compressed', async () => {
    const speech = voice()
    const response = await site({ speech }).request(say('The Sun is up 59.5% of May 2027.'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('content-length')).toBe(String(AUDIO.byteLength))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(AUDIO)
    expect(speech.say).toHaveBeenCalledTimes(1)
    expect(speech.say.mock.calls[0][0]).toBe('The Sun is up 59.5% of May 2027.')
  })

  it('refuses other sites and other methods before calling the voice', async () => {
    const speech = voice()
    const app = site({ speech })
    expect((await app.request(say('Hello', { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await app.request(say('Hello', { origin: null }))).status).toBe(403)
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const refused = await app.request(say('Hello', { method }))
      expect(refused.status).toBe(405)
      expect(await refused.json()).toEqual({ error: 'method' })
    }
    expect(speech.say).not.toHaveBeenCalled()
    // A dev origin on the list is let in.
    expect((await site({ allowedOrigins: ['http://localhost:5173'] }).request(say('Hello', { origin: 'http://localhost:5173' }))).status).toBe(200)
  })

  it('refuses text that is too long, empty or not text at all', async () => {
    const speech = voice()
    const app = site({ speech })
    const bad = [
      { text: 'x'.repeat(901) },
      { text: '' },
      { text: '   \n ' },
      { text: '<speak></speak> {} **' },
      { text: 42 },
      { text: ['Hello'] },
      { ssml: '<speak>Hello</speak>' },
      {},
      null,
      'Hello',
      '{"text": "Hello"',
      { text: 'Hello', padding: 'x'.repeat(4000) },
    ]
    for (const body of bad) {
      const refused = await app.request(post(body, { visitor: `198.51.100.${bad.indexOf(body)}` }))
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ error: 'bad-text' })
    }
    expect(speech.say).not.toHaveBeenCalled()
    // The longest allowed text is the longest answer the co-pilot gives.
    expect((await app.request(say('x'.repeat(900)))).status).toBe(200)
  })

  it('sends the voice sentence text only: no tags, no markup', async () => {
    const speech = voice()
    const app = site({ speech })
    await app.request(say('<speak>Hello <break time="10s"/> <prosody pitch="+20st">there</prosody></speak>'))
    await app.request(say('  **Sunset** in\n22 h. [pause long] {{r1.pct_sun}} <script>alert(1)</script> '))
    expect(speech.say.mock.calls.map((call) => call[0])).toEqual(['Hello there', 'Sunset in 22 h. pause long r1.pct sun alert(1)'])
  })

  it('says so when the voice fails, without passing its error on', async () => {
    const speech: Speech = { say: async () => Promise.reject(new Error('Text-to-Speech: HTTP 403')) }
    const failed = await site({ speech }).request(say('Hello'))
    expect(failed.status).toBe(502)
    expect(failed.headers.get('content-type')).toBe('application/json')
    expect(await failed.json()).toEqual({ error: 'upstream' })
  })

  it('is off cleanly when no voice is configured, and /api/status says which it is', async () => {
    const off = site({ speech: null })
    const refused = await off.request(say('Hello'))
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'not-configured' })
    // Still only for this site's pages, and still POST only.
    expect((await off.request(say('Hello', { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await off.request(say('Hello', { method: 'GET' }))).status).toBe(405)
    expect(((await (await off.request(`${ORIGIN}/api/status`)).json()) as { voice: boolean }).voice).toBe(false)
    expect(((await (await site().request(`${ORIGIN}/api/status`)).json()) as { voice: boolean }).voice).toBe(true)
  })

  it('allows 6 texts a minute per visitor, counting refused ones too', async () => {
    let time = 0
    const speech = voice()
    const app = site({ speech, now: () => time })
    for (let i = 0; i < 5; i++) expect((await app.request(say(`Hello ${i}`))).status).toBe(200)
    // A text that is refused still uses up a turn, so the limit can't be dodged with junk.
    expect((await app.request(say(''))).status).toBe(400)
    expect((await app.request(say('Hello again'))).status).toBe(429)
    expect(speech.say).toHaveBeenCalledTimes(5)
    expect((await app.request(say('Hello again', { visitor: '198.51.100.2' }))).status).toBe(200)
    time = 61_000
    expect((await app.request(say('Hello again'))).status).toBe(200)
  })

  it('allows 200 texts a day for everyone together: the most the voice can cost', async () => {
    let time = 0
    const speech = voice()
    const app = site({ speech, now: () => time })
    // Each from a different visitor, and slowly enough to stay under 30 a minute overall.
    for (let i = 0; i < 200; i++) {
      time = i * 2_100
      expect((await app.request(say(`Text ${i}`, { visitor: `198.51.${Math.floor(i / 250)}.${i % 250}` }))).status).toBe(200)
    }
    time = 200 * 2_100
    const over = await app.request(say('One more', { visitor: '192.0.2.1' }))
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'busy' })
    expect(speech.say).toHaveBeenCalledTimes(200)
    // A text already said that day is still answered, from the cache: it costs nothing.
    time = 200 * 2_100 + 1_000
    const kept = await app.request(say('Text 199', { visitor: '192.0.2.1' }))
    expect(kept.status).toBe(200)
    expect(kept.headers.get('x-cache')).toBe('hit')
    expect(speech.say).toHaveBeenCalledTimes(200)
    time = 25 * 3_600_000
    expect((await app.request(say('One more', { visitor: '192.0.2.1' }))).status).toBe(200)
  })

  it('says a text once, and answers it from the cache for a day', async () => {
    let time = 0
    const speech = voice()
    // A kept clip's expiry is a day plus or minus 10%, chosen per write. 0.5 is the middle: exactly a day.
    const app = site({ speech, now: () => time, store: memoryStore(() => time, () => 0.5) })
    const first = await app.request(say('The Sun is up 59.5% of May 2027.'))
    expect(first.headers.get('x-cache')).toBe('miss')
    const second = await app.request(say('The Sun is up 59.5% of May 2027.', { visitor: '198.51.100.9' }))
    expect(second.status).toBe(200)
    expect(second.headers.get('x-cache')).toBe('hit')
    expect(second.headers.get('content-type')).toBe('audio/mpeg')
    expect(second.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(AUDIO)
    // The same sentence with different spacing or markup is the same text once cleaned.
    expect((await app.request(say('<b>The Sun is up 59.5% of May 2027.</b>', { visitor: '198.51.100.10' }))).headers.get('x-cache')).toBe('hit')
    expect((await app.request(say('The Sun is up 61% of June 2027.'))).headers.get('x-cache')).toBe('miss')
    expect(speech.say).toHaveBeenCalledTimes(2)
    // A day later it is said afresh.
    time = 25 * 3_600_000
    expect((await app.request(say('The Sun is up 59.5% of May 2027.'))).headers.get('x-cache')).toBe('miss')
    expect(speech.say).toHaveBeenCalledTimes(3)
  })

  it('still holds a visitor to 6 a minute when every text comes from the cache', async () => {
    const speech = voice()
    const app = site({ speech, now: () => 0 })
    for (let i = 0; i < 6; i++) expect((await app.request(say('Hello'))).status).toBe(200)
    expect((await app.request(say('Hello'))).status).toBe(429)
    expect(speech.say).toHaveBeenCalledTimes(1)
  })

  it('is traced like the other handlers: the limits, then the voice with how much it said', async () => {
    const write = vi.fn()
    const response = await site({ traces: { write } }).request(say('Hello there.'))
    await response.arrayBuffer()
    expect(write).toHaveBeenCalledTimes(1)
    const spans = (write.mock.calls[0] as [string, { name: string; attributes: Record<string, string>; endMs: number }[]])[1]
    expect(spans.map((span) => span.name)).toEqual(['POST /api/speak', 'rate limits', 'speech cache', 'cost limits', 'speech'])
    expect(spans[0].attributes).toMatchObject({ status: '200' })
    expect(spans[4].attributes).toEqual({ chars: '12' })
    expect(spans.every((span) => span.endMs > 0)).toBe(true)
  })
})
