import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

/** One timed step of a request: its name, when it ran, and a few facts about it. */
export interface Span {
  spanId: string
  parentSpanId: string | null
  name: string
  startMs: number
  endMs: number
  attributes: Record<string, string>
}

/** Where finished traces are sent. Cloud Trace in production; nothing in tests unless one is passed. */
export interface TraceSink {
  /** The promise settles when the trace is stored, or the attempt has failed; it never rejects. */
  write(traceId: string, spans: Span[]): Promise<void> | void
}

interface Trace {
  traceId: string
  /** The span new steps hang under: the request's own, then whichever step is running. */
  current: string
  spans: Span[]
  sink: TraceSink
  now: () => number
}

const active = new AsyncLocalStorage<Trace>()
const newSpanId = () => randomBytes(8).toString('hex')

/**
 * Google's front end stamps each request with `x-cloud-trace-context: TRACE/SPAN;o=1`. Using its
 * trace id means our steps appear under the load balancer's own span for the same request.
 */
export function traceContext(header: string | null): TraceContext {
  const match = /^([0-9a-f]{32})(?:\/(\d+))?/.exec(header ?? '')
  if (!match) return { traceId: randomBytes(16).toString('hex'), parentSpanId: null }
  // The span id arrives as a decimal number; Cloud Trace wants 16 hex digits.
  const parent = match[2] ? BigInt(match[2]).toString(16).padStart(16, '0') : null
  return { traceId: match[1], parentSpanId: parent }
}

/** Which trace a piece of work belongs to, and the step it hangs under there. */
export interface TraceContext {
  traceId: string
  parentSpanId: string | null
}

/**
 * A queue has no headers to carry a trace across, so the publisher puts it in a message attribute,
 * written the standard way (W3C Trace Context): `00-<trace, 32 hex>-<span, 16 hex>-<flags>`.
 * Null when the value is not one, so the receiver starts a trace of its own.
 */
export function traceparentContext(value: string | null | undefined): TraceContext | null {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(value ?? '')
  // All zeros means "no trace" in the standard.
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null
  return { traceId: match[1], parentSpanId: match[2] }
}

/**
 * The step running now, written as a `traceparent` for a message that leaves this service; null
 * outside a trace. Whoever receives the message hangs its own steps under this one.
 */
export function currentTraceparent(): string | null {
  const trace = active.getStore()
  return trace ? `00-${trace.traceId}-${trace.current}-01` : null
}

/**
 * Runs the handling of one request as a trace: every `span()` inside it, however deep, is recorded
 * under it. `finish` closes the request's own span and sends the lot; call it when the response
 * is complete (for a stream, when the stream ends). It returns the send, for a caller that wants
 * to wait for it.
 *
 * `from` says which trace to join: the request (Google's front end stamps it with a header), or a
 * context read from somewhere else, such as a queue message's attributes.
 */
export function startTrace<T>(
  name: string,
  from: Request | TraceContext,
  sink: TraceSink | null | undefined,
  work: (finish: (attributes?: Record<string, string>) => Promise<void> | void) => T,
  now: () => number = Date.now,
): T {
  if (!sink) return work(() => {})
  const { traceId, parentSpanId } = from instanceof Request ? traceContext(from.headers.get('x-cloud-trace-context')) : from
  const root: Span = { spanId: newSpanId(), parentSpanId, name, startMs: now(), endMs: 0, attributes: {} }
  const trace: Trace = { traceId, current: root.spanId, spans: [root], sink, now }
  let finished = false
  const finish = (attributes: Record<string, string> = {}) => {
    if (finished) return
    finished = true
    root.endMs = now()
    Object.assign(root.attributes, attributes)
    // A step still running when the request ends is cut off there, so the trace is whole.
    for (const span of trace.spans) if (span.endMs === 0) span.endMs = root.endMs
    return sink.write(traceId, trace.spans)
  }
  return active.run(trace, () => work(finish))
}

/** Times one step of the current request. Outside a trace it just runs the step. */
export async function span<T>(name: string, work: () => Promise<T>, attributes: Record<string, string> = {}): Promise<T> {
  const trace = active.getStore()
  if (!trace) return work()
  const step: Span = { spanId: newSpanId(), parentSpanId: trace.current, name, startMs: trace.now(), endMs: 0, attributes }
  trace.spans.push(step)
  // Steps started inside this one hang under it.
  return active.run({ ...trace, current: step.spanId }, async () => {
    try {
      return await work()
    } catch (error) {
      step.attributes.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      step.endMs = trace.now()
    }
  })
}

/** The id of the trace this request belongs to, for tying a log line to it; null outside one. */
export function currentTraceId(): string | null {
  return active.getStore()?.traceId ?? null
}

/** The id of the step running now, for the same log line; null outside a trace. */
export function currentSpanId(): string | null {
  return active.getStore()?.current ?? null
}
