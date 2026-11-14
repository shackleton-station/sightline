import { randomUUID } from 'node:crypto'
import { type EventSink, pushBody } from '../shared/events'
import type { TokenSource } from '../shared/google'

/**
 * The co-pilot's client for Google Cloud's queue, where its question events go (Pub/Sub). Only the
 * co-pilot service publishes there (docs/ARCHITECTURE_PHASE_3.md). The model used to be here too
 * (Gemini on Vertex AI); it is Claude on the Anthropic API now, in claude.ts
 * (docs/decisions/0009-copilot-on-claude.md).
 */

/**
 * Events to a Pub/Sub topic, each with its attributes. It never rejects: the result tells the
 * outbox relay (`outbox.ts`) whether the queue has the event, so it can be marked sent or tried again.
 */
export function pubsubEvents(options: { project: string; topic: string }, token: TokenSource): EventSink {
  const url = `https://pubsub.googleapis.com/v1/projects/${options.project}/topics/${options.topic}:publish`
  return {
    async publish(event, attributes = {}) {
      const data = Buffer.from(JSON.stringify(event)).toString('base64')
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
          body: JSON.stringify({ messages: [{ data, attributes }] }),
          signal: AbortSignal.timeout(5000),
        })
        await response.body?.cancel()
        if (response.ok) return 'sent'
        console.warn(`Pub/Sub: HTTP ${response.status} publishing an event`)
        // 400 means the message itself is wrong, and sending it again cannot help. Anything else
        // (busy, a permission not yet in place, an outage) may pass, so the event is kept and retried.
        return response.status === 400 ? 'refused' : 'retry'
      } catch (error) {
        console.warn('Pub/Sub: could not publish an event:', error instanceof Error ? error.message : error)
        return 'retry'
      }
    },
  }
}

/**
 * A stand-in for the queue when everything runs on one machine (`npm run dev:server`, Compose):
 * the event goes straight to the events worker, shaped as Pub/Sub would push it. There is no
 * Pub/Sub locally, so nothing else retries; the outbox relay still does.
 */
export function directPush(url: string): EventSink {
  return {
    async publish(event, attributes = {}) {
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: pushBody(event, attributes, randomUUID()), signal: AbortSignal.timeout(5000) })
        await response.body?.cancel()
        return response.ok ? 'sent' : response.status === 400 ? 'refused' : 'retry'
      } catch {
        return 'retry'
      }
    },
  }
}
