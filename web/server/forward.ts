import { reply } from '../shared/http'

/** Headers that describe one connection, not the request, and so are not passed on. */
const NOT_PASSED_ON = ['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive']

/**
 * Passes a request on to another service and returns its answer: a stand-in for the load balancer's
 * path rule when everything runs on one machine (`npm run dev:server`, Compose). In the cloud the
 * load balancer does this, and no service calls another to answer a visitor.
 *
 * The method, the path, the body and the visitor's headers go through unchanged (sign-in, the
 * idempotency key, the origin, the addresses in X-Forwarded-For). `fetch` cannot send another
 * service a Host header of our choosing, so the other service is told this site's origin in its
 * ALLOWED_ORIGINS setting.
 */
export function forwardTo(base: string): (request: Request) => Promise<Response> {
  const target = base.replace(/\/$/, '')
  return async (request) => {
    const url = new URL(request.url)
    const headers = new Headers(request.headers)
    for (const name of NOT_PASSED_ON) headers.delete(name)
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    try {
      const answer = await fetch(`${target}${url.pathname}${url.search}`, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined, signal: AbortSignal.timeout(30_000) })
      // `fetch` has already unpacked the body, so the headers that described its packing no longer hold.
      const passedBack = new Headers(answer.headers)
      passedBack.delete('content-encoding')
      passedBack.delete('content-length')
      return new Response(answer.body, { status: answer.status, headers: passedBack })
    } catch (error) {
      console.warn(`Could not reach ${target}:`, error instanceof Error ? error.message : error)
      return reply({ error: 'upstream' }, 502)
    }
  }
}
