import { createHash } from 'node:crypto'
import { plainSentences, SPEAK_MAX_CHARS } from '../../src/lib/speech'
import type { Deps } from '../deps'
import { originAllowed, reply, visitorOf } from '../../shared/http'
import type { Cache, Limiter } from '../../shared/store'
import { span } from '../../shared/trace'

export interface SpeakLimits {
  /** Per visitor and minute: counted on every call, whether or not the voice has to be asked. */
  each: Limiter
  /** Per visitor and day, counted only for texts the voice has to say. */
  eachDay: Limiter
  /**
   * Everyone together, per minute and per day, counted only for texts the voice has to say. The
   * daily one is the ceiling on what the voice can cost.
   */
  all: Limiter
  allDay: Limiter
}

/** How long a spoken text is kept. The same sentence is the same sound, so a day's repeats cost nothing. */
const KEPT_TTL_S = 24 * 60 * 60
/** A clip larger than this isn't kept: 900 characters of speech is well under it. */
const MAX_KEPT_BYTES = 600_000

/** The cache key for a text: the sentence itself, once cleaned. */
function keptKey(text: string): string {
  return `speak:${createHash('sha256').update(text).digest('hex')}`
}

/** A kept clip as it is stored, and read back; null if what was stored isn't one. */
function pack(audio: { bytes: Uint8Array; type: string }): string {
  return JSON.stringify({ type: audio.type, audio: Buffer.from(audio.bytes).toString('base64') })
}
function unpack(kept: string): { bytes: Uint8Array<ArrayBuffer>; type: string } | null {
  try {
    const parsed = JSON.parse(kept) as { type?: unknown; audio?: unknown }
    if (typeof parsed.type !== 'string' || typeof parsed.audio !== 'string') return null
    return { type: parsed.type, bytes: new Uint8Array(Buffer.from(parsed.audio, 'base64')) }
  } catch {
    return null
  }
}

function audioReply(audio: { bytes: Uint8Array<ArrayBuffer>; type: string }, kept: 'hit' | 'miss'): Response {
  return new Response(audio.bytes, {
    headers: { 'content-type': audio.type, 'content-length': String(audio.bytes.byteLength), 'cache-control': 'no-store', 'x-cache': kept },
  })
}

/** A request is one short text in a small JSON wrapper; anything bigger isn't from the page. */
const MAX_BODY_CHARS = 4000
const SPEECH_TIMEOUT_MS = 10_000

/** The text to say, as plain sentences, or null if the request isn't one short piece of text. */
function readText(body: string): string | null {
  if (body.length > MAX_BODY_CHARS) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const text = (parsed as { text?: unknown } | null)?.text
  if (typeof text !== 'string' || text.length > SPEAK_MAX_CHARS) return null
  // Whatever a client sends, only sentence text goes on: no tags, no markup for the voice.
  const plain = plainSentences(text)
  return plain.length > 0 ? plain : null
}

/**
 * POST /api/speak: one short text, spoken in Scout's voice, as an audio file. It has the same guards
 * as the co-pilot, so it can't be used as a free text-to-speech service: only this site's pages may
 * call it, a few times a minute, with a daily ceiling for everyone together. The page falls back to
 * the browser's own voice whenever this says no.
 *
 * A text already said in the last day is answered from the cache. That costs nothing, so it counts
 * only against the visitor's minute: the briefing says the same captions to everyone who plays it,
 * and should not use up the day's ceiling doing so.
 */
export async function handleSpeak(request: Request, deps: Deps, limits: SpeakLimits, cache: Cache): Promise<Response> {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405)
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  const speech = deps.speech
  if (!speech) return reply({ error: 'not-configured' }, 503)
  const visitor = visitorOf(request, deps.trustedProxies)
  // Counted on every call, before anything else, so junk can't be sent faster than real texts.
  if (!(await span('rate limits', () => limits.each.take(visitor)))) return reply({ error: 'busy' }, 429)

  const text = readText(await request.text())
  if (!text) return reply({ error: 'bad-text' }, 400)

  const key = keptKey(text)
  const kept = await span('speech cache', () => cache.get(key).catch(() => null))
  const again = kept ? unpack(kept) : null
  if (again) return audioReply(again, 'hit')

  // A text the voice has to say is what costs: these three are counted before it is sent on.
  const allowed = await span('cost limits', () => Promise.all([limits.eachDay.take(visitor), limits.all.take('all'), limits.allDay.take('all')]))
  if (allowed.includes(false)) return reply({ error: 'busy' }, 429)

  try {
    const audio = await span('speech', () => speech.say(text, AbortSignal.timeout(SPEECH_TIMEOUT_MS)), { chars: String(text.length) })
    // Kept before answering: the server may get no CPU once the response has gone.
    if (audio.bytes.byteLength <= MAX_KEPT_BYTES) await cache.set(key, pack(audio), KEPT_TTL_S).catch(() => {})
    return audioReply(audio, 'miss')
  } catch (error) {
    console.error('speak failed', error instanceof Error ? error.message : error)
    return reply({ error: 'upstream' }, 502)
  }
}
