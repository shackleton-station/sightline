import { briefly } from './events'
import { startTrace, type TraceSink } from './trace'

/** Handles one API request as a trace. `name` is what the request's own step is called. */
export type Traced = (name: string, request: Request, handle: () => Promise<Response>) => Promise<Response>

/**
 * Wraps a request handler so its work is one trace: the steps inside it are timed and sent to Cloud
 * Trace once the answer is worked out. The trace joins the one Google's front end started for the
 * same request (see `traceContext`), so a request that crosses the load balancer and a service shows
 * as one. The response waits a moment for the send (see `briefly`); for a stream, the wait comes
 * after the last byte. With no sink the handler just runs.
 *
 * Every service that answers visitors uses this, which is why it lives in the shared folder.
 */
export function tracedBy(traces: TraceSink | null | undefined, now: () => number = Date.now): Traced {
  return (name, request, handle) => {
    if (!traces) return handle()
    return startTrace(
      name,
      request,
      traces,
      async (finish) => {
        try {
          const response = await handle()
          const facts = { status: String(response.status), cache: response.headers.get('x-cache') ?? 'none' }
          if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
            await briefly(finish(facts))
            return response
          }
          const ending = new TransformStream<Uint8Array, Uint8Array>({ flush: () => briefly(finish(facts)) })
          return new Response(response.body.pipeThrough(ending), response)
        } catch (error) {
          await briefly(finish({ status: '500' }))
          throw error
        }
      },
      now,
    )
  }
}
