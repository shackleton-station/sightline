import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createCopilotApp } from '../copilot/app'
import { memoryOutbox, outboxRelay } from '../copilot/outbox'
import { apiError } from '../copilot/standIns'
import { type EventSink, KIND_ATTRIBUTE, OUTCOMES, pushBody, QUESTION_KIND, readEvent, readPush, TRACE_ATTRIBUTE } from '../shared/events'
import type { Log } from '../shared/log'
import { memoryStats } from '../shared/stats'
import { createWorker } from './app'

/**
 * The contract for a question event, checked from both ends.
 *
 * Three things read or write this shape and are deployed apart: the co-pilot (publishes it), the
 * events worker (counts it) and the BigQuery table (stores it, column by column). A change to the
 * shape has to keep all three working, with either side a version behind the other. So:
 *   - what the real publisher sends is put through the real worker, and through the table's columns;
 *   - the rules for changing it are tests: new fields are ignored, old events without an id still count.
 */
const ORIGIN = 'https://clps-web.example.run.app'
const quiet: Log = { info: () => {}, warn: () => {}, error: () => {} }

/** One real request to the co-pilot, and what it published. The model fails, which is still a question. */
async function publishedByTheCopilot(headers: Record<string, string> = {}) {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const sent: { event: Record<string, unknown>; attributes: Record<string, string> }[] = []
  const events: EventSink = { publish: (event, attributes = {}) => void sent.push({ event, attributes }) }
  const app = createCopilotApp({
    dataDir: '/nonexistent',
    bucket: null,
    model: { generate: async () => Promise.reject(apiError(500)) },
    allowedOrigins: [],
    relay: outboxRelay(events, memoryOutbox()),
    traces: headers['x-cloud-trace-context'] ? { write: () => {} } : null,
    version: 'test',
    codeVersion: 'test',
    dataVersion: 'test',
    revision: null,
    retry: { wait: async () => {} },
  })
  const response = await app.request(
    new Request(`${ORIGIN}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.7', ...headers },
      body: JSON.stringify({ messages: [{ role: 'user', text: 'How sunny is it?' }], view: '#a=connecting-ridge@2027-05' }),
    }),
  )
  await response.text()
  vi.restoreAllMocks()
  expect(sent).toHaveLength(1)
  return sent[0]
}

function aWorker() {
  const stats = memoryStats()
  return { stats, worker: createWorker({ stats, callers: null, pushIdentity: null, checkIdentities: [], log: quiet, version: 't', dataVersion: null, revision: null }) }
}

describe('the question event, from the publisher to its readers', () => {
  it('is counted by the worker exactly as the co-pilot publishes it', async () => {
    const { event, attributes } = await publishedByTheCopilot()
    expect(attributes[KIND_ATTRIBUTE]).toBe(QUESTION_KIND)
    const { stats, worker } = aWorker()
    const response = await worker.request('https://worker.example/push', { method: 'POST', body: pushBody(event, attributes, '1001') })
    expect(response.status).toBe(204)
    const day = String(event.at).slice(0, 10)
    expect((await stats.read(day)).counts).toEqual({ questions: 1, cached: 0, fallback: 0, busy: 0, failed: 1, refused: 0 })
  })

  it('has exactly the fields the BigQuery table has columns for', async () => {
    const { event } = await publishedByTheCopilot()
    // The table's schema as Terraform declares it (infra/events.tf): Pub/Sub writes each field to the column of the same name.
    const terraform = readFileSync(new URL('../../infra/events.tf', import.meta.url), 'utf8')
    const schema = terraform.slice(terraform.indexOf('schema = jsonencode(['), terraform.indexOf('])', terraform.indexOf('schema = jsonencode([')))
    const columns = [...schema.matchAll(/\{ name = "(\w+)", type = "(\w+)", mode = "(\w+)"/g)].map(([, name, type, mode]) => ({ name, type, mode }))
    expect(columns.map((column) => column.name).toSorted()).toEqual(Object.keys(event).toSorted())
    // Every column the table requires is one the publisher always sends.
    for (const column of columns.filter((c) => c.mode === 'REQUIRED')) expect(event[column.name], column.name).toBeTruthy()
    const types: Record<string, (value: unknown) => boolean> = {
      STRING: (value) => typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string')),
      TIMESTAMP: (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
      BOOLEAN: (value) => typeof value === 'boolean',
      INTEGER: (value) => Number.isInteger(value),
    }
    for (const column of columns) expect(types[column.type](event[column.name]), `${column.name} is a ${column.type}`).toBe(true)
  })

  it('carries the request\'s trace beside the event, in the standard form', async () => {
    const { attributes } = await publishedByTheCopilot({ 'x-cloud-trace-context': '105445aa7843bc8bf206b12000100000/1;o=1' })
    expect(attributes[TRACE_ATTRIBUTE]).toMatch(/^00-105445aa7843bc8bf206b12000100000-[0-9a-f]{16}-01$/)
  })
})

describe('the rules for changing the event', () => {
  const event = { kind: QUESTION_KIND, id: 'abc-123', at: '2026-11-12T11:59:00.000Z', cached: true, outcome: 'answered' }

  it('needs only four fields to count, and ignores every field it does not know', () => {
    expect(readEvent(event, '1')).toEqual({ is: 'question', question: { key: 'e-abc-123', day: '2026-11-12', cached: true, outcome: 'answered' } })
    expect(readEvent({ ...event, question: 'words', a_field_added_next_year: { nested: true } }, '1')).toEqual(readEvent(event, '1'))
    for (const outcome of OUTCOMES) expect(readEvent({ ...event, outcome }, '1').is).toBe('question')
  })

  it('still counts an event from a publisher too old to send an id, by the message id', () => {
    const old: Record<string, unknown> = { ...event }
    delete old.id
    expect(readEvent(old, '1001')).toMatchObject({ is: 'question', question: { key: 'm-1001' } })
    // The two kinds of key can never collide.
    expect(readEvent({ ...event, id: '1001' }, '1001')).toMatchObject({ question: { key: 'e-1001' } })
    expect(readEvent(old, null)).toEqual({ is: 'malformed', why: 'no id' })
  })

  it('treats an event of another kind as not its own, and a broken question as malformed', () => {
    expect(readEvent({ kind: 'plan_saved' }, '1')).toEqual({ is: 'other', kind: 'plan_saved' })
    expect(readEvent(null, '1').is).toBe('malformed')
    expect(readEvent([], '1').is).toBe('malformed')
    expect(readEvent({ ...event, kind: undefined }, '1').is).toBe('malformed')
    expect(readEvent({ ...event, at: 5 }, '1').is).toBe('malformed')
    expect(readEvent({ ...event, cached: 1 }, '1').is).toBe('malformed')
    expect(readEvent({ ...event, outcome: 'maybe' }, '1').is).toBe('malformed')
    expect(readEvent({ ...event, id: 'a/b' }, '1').is).toBe('malformed')
    expect(readEvent({ ...event, id: 'x'.repeat(65) }, '1').is).toBe('malformed')
  })

  it('reads a push in either of the two spellings Pub/Sub uses for the message id', () => {
    const data = Buffer.from(JSON.stringify(event)).toString('base64')
    expect(readPush(JSON.stringify({ message: { data, messageId: '7' }, deliveryAttempt: 3 }))).toMatchObject({ messageId: '7', deliveryAttempt: 3, attributes: {} })
    expect(readPush(JSON.stringify({ message: { data, message_id: '8', attributes: { kind: 'x', n: 5 } } }))).toMatchObject({ messageId: '8', deliveryAttempt: null, attributes: { kind: 'x' } })
    expect(readPush(pushBody(event, { a: 'b' }, '9'))).toMatchObject({ data: event, attributes: { a: 'b' }, messageId: '9' })
  })
})
