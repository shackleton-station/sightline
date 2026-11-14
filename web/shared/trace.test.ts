import { describe, expect, it, vi } from 'vitest'
import { currentSpanId, currentTraceId, currentTraceparent, span, startTrace, traceContext, traceparentContext, type Span } from './trace'

const request = (header?: string) => new Request('https://site.example/api/chat', { headers: header ? { 'x-cloud-trace-context': header } : {} })

describe('traceContext', () => {
  it("joins the trace Google's front end started", () => {
    expect(traceContext('105445aa7843bc8bf206b12000100000/255;o=1')).toEqual({ traceId: '105445aa7843bc8bf206b12000100000', parentSpanId: '00000000000000ff' })
    expect(traceContext('105445aa7843bc8bf206b12000100000')).toEqual({ traceId: '105445aa7843bc8bf206b12000100000', parentSpanId: null })
  })

  it('starts a trace of its own when there is none, or the header is not one', () => {
    for (const header of [null, '', 'not a trace', '1234/5']) {
      const made = traceContext(header)
      expect(made.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(made.parentSpanId).toBeNull()
    }
    expect(traceContext(null).traceId).not.toBe(traceContext(null).traceId)
  })
})

describe('a trace carried by a queue message', () => {
  it('is written in the standard form by the publisher and read back by the receiver', async () => {
    const write = vi.fn<(traceId: string, spans: Span[]) => void>()
    expect(currentTraceparent()).toBeNull()
    expect(currentSpanId()).toBeNull()
    // The publisher: inside a request's trace, a step writes down where it is.
    let carried = ''
    await startTrace('POST /api/chat', request('105445aa7843bc8bf206b12000100000/255;o=1'), { write }, async (finish) => {
      await span('outbox', async () => {
        carried = currentTraceparent() ?? ''
        expect(carried).toBe(`00-105445aa7843bc8bf206b12000100000-${currentSpanId()}-01`)
      })
      finish()
    })
    const outbox = write.mock.calls[0][1].find((s) => s.name === 'outbox')

    // The receiver: no request header to go by, only the message's attribute.
    const context = traceparentContext(carried)
    expect(context).toEqual({ traceId: '105445aa7843bc8bf206b12000100000', parentSpanId: outbox?.spanId })
    await startTrace('worker', context ?? traceContext(null), { write }, async (finish) => {
      expect(currentTraceId()).toBe('105445aa7843bc8bf206b12000100000')
      finish()
    })
    // Same trace, and the receiver's work hangs under the publisher's step.
    expect(write.mock.calls[1][0]).toBe('105445aa7843bc8bf206b12000100000')
    expect(write.mock.calls[1][1][0].parentSpanId).toBe(outbox?.spanId)
  })

  it('is ignored when it is not one', () => {
    for (const value of [null, undefined, '', 'nonsense', '00-short-00f067aa0ba902b7-01', '01-105445aa7843bc8bf206b12000100000-00f067aa0ba902b7-01', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`, `00-105445aa7843bc8bf206b12000100000-${'0'.repeat(16)}-01`]) {
      expect(traceparentContext(value), String(value)).toBeNull()
    }
  })
})

describe('a trace', () => {
  it('records steps under the step that started them, with how long each took', async () => {
    const clock = { ms: 1000 }
    const write = vi.fn<(traceId: string, spans: Span[]) => void>()
    await startTrace(
      'GET /thing',
      request(),
      { write },
      async (finish) => {
        expect(currentTraceId()).toMatch(/^[0-9a-f]{32}$/)
        await span('outer', async () => {
          clock.ms += 10
          await span('inner', async () => {
            clock.ms += 5
          })
        })
        await span('after', async () => {
          clock.ms += 1
        }, { kind: 'test' })
        finish({ status: '200' })
      },
      () => clock.ms,
    )
    const spans = write.mock.calls[0][1]
    const [root, outer, inner, after] = spans
    expect(spans.map((s) => [s.name, s.endMs - s.startMs])).toEqual([['GET /thing', 16], ['outer', 15], ['inner', 5], ['after', 1]])
    expect(outer.parentSpanId).toBe(root.spanId)
    expect(inner.parentSpanId).toBe(outer.spanId)
    expect(after.parentSpanId).toBe(root.spanId)
    expect(after.attributes).toEqual({ kind: 'test' })
    expect(root.attributes).toEqual({ status: '200' })
  })

  it('is sent once, and closes any step still running when the request ends', async () => {
    const write = vi.fn<(traceId: string, spans: Span[]) => void>()
    let release = () => {}
    await startTrace('GET /thing', request(), { write }, async (finish) => {
      void span('still going', () => new Promise<void>((resolve) => (release = resolve)))
      finish()
      finish()
    })
    release()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][1].every((s) => s.endMs >= s.startMs && s.endMs > 0)).toBe(true)
  })

  it('notes a step that failed, and lets the failure through', async () => {
    const write = vi.fn<(traceId: string, spans: Span[]) => void>()
    await startTrace('GET /thing', request(), { write }, async (finish) => {
      await expect(span('breaks', async () => Promise.reject(new Error('no luck')))).rejects.toThrow('no luck')
      finish()
    })
    expect(write.mock.calls[0][1][1].attributes).toEqual({ error: 'no luck' })
  })

  it('costs nothing when tracing is off', async () => {
    expect(await startTrace('GET /thing', request(), null, async () => span('step', async () => currentTraceId()))).toBeNull()
  })
})
