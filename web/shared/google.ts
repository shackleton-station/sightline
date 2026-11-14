import { GoogleAuth } from 'google-auth-library'
import type { Bucket } from './bucket'
import type { Span, TraceSink } from './trace'

/** Gives a Google Cloud access token. */
export type TokenSource = () => Promise<string>

/**
 * Tokens for calling Google Cloud as this service. On Cloud Run they come from the service's own
 * service account, so there are no keys to store. Locally they come from
 * `gcloud auth application-default login`, or from GOOGLE_OAUTH_ACCESS_TOKEN (what `npm run dev:server`
 * sets from `gcloud auth print-access-token`).
 */
export function googleToken(): TokenSource {
  const fixed = process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  if (fixed) return () => Promise.resolve(fixed)
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  return async () => {
    const token = await auth.getAccessToken()
    if (!token) throw new Error('No Google Cloud credentials')
    return token
  }
}

/** Request traces to Cloud Trace. A failed write is logged and dropped. */
export function cloudTraces(project: string, token: TokenSource): TraceSink {
  const url = `https://cloudtrace.googleapis.com/v2/projects/${project}/traces:batchWrite`
  const text = (value: string) => ({ value: value.slice(0, 256) })
  const toApi = (traceId: string, span: Span) => ({
    name: `projects/${project}/traces/${traceId}/spans/${span.spanId}`,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    displayName: text(span.name),
    startTime: new Date(span.startMs).toISOString(),
    endTime: new Date(span.endMs).toISOString(),
    attributes: { attributeMap: Object.fromEntries(Object.entries(span.attributes).map(([key, value]) => [key, { stringValue: text(value) }])) },
  })
  return {
    write(traceId, spans) {
      return (async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
          body: JSON.stringify({ spans: spans.map((span) => toApi(traceId, span)) }),
          signal: AbortSignal.timeout(5000),
        })
        await response.body?.cancel()
        if (!response.ok) console.warn(`Cloud Trace: HTTP ${response.status} writing a trace`)
      })().catch((error: unknown) => console.warn('Cloud Trace: could not write a trace:', error instanceof Error ? error.message : error))
    },
  }
}

/**
 * A Cloud Storage bucket, read through its JSON API so byte ranges pass straight through. The web
 * server streams tiles and video from it; the co-pilot reads the light grid's months.
 */
export function gcsBucket(name: string, token: TokenSource): Bucket {
  return {
    async get(key, range) {
      const url = `https://storage.googleapis.com/storage/v1/b/${name}/o/${encodeURIComponent(key)}?alt=media`
      const headers: Record<string, string> = { authorization: `Bearer ${await token()}` }
      if (range) headers.range = range
      const response = await fetch(url, { headers })
      if (response.status === 404 || response.status === 416) {
        await response.body?.cancel()
        return null
      }
      if (response.status !== 200 && response.status !== 206) {
        await response.body?.cancel()
        throw new Error(`Cloud Storage: HTTP ${response.status} for ${key}`)
      }
      return {
        status: response.status,
        body: response.body,
        length: response.headers.get('content-length'),
        contentRange: response.headers.get('content-range'),
        etag: response.headers.get('etag'),
      }
    },
  }
}
