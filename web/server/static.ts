import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gz': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.vtt': 'text/vtt; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * How long a browser may keep a file.
 * - Pages (any address ending in / or .html) and version.json: never. A phone that reopens an old tab would otherwise run old code
 *   against today's data (see src/data/staleBuild.ts).
 * - /assets/: a year. Their names carry a hash of their contents, so a new build means new names.
 * - Everything else (data files): check with the server each time; unchanged files cost a 304.
 */
export function cacheFor(pathname: string): string {
  if (pathname.endsWith('/') || pathname.endsWith('.html') || pathname === '/version.json') return 'no-store'
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'no-cache'
}

/** The file for a URL path inside `distDir`, or null if the path tries to leave it. */
export function resolveInside(distDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  // An address ending in / is that folder's page.
  const file = normalize(join(distDir, decoded.endsWith('/') ? `${decoded}index.html` : decoded))
  return file === distDir || file.startsWith(distDir + sep) ? file : null
}

/** Serves one built file with its cache rule, or a 404. */
export async function serveStatic(request: Request, distDir: string, pathname: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const file = resolveInside(distDir, pathname)
  const info = file ? await stat(file).catch(() => null) : null
  // A folder asked for without its closing slash (/scout): send the browser to the page inside it.
  if (file && info?.isDirectory() && !pathname.endsWith('/')) {
    return new Response(null, { status: 301, headers: { location: `${pathname}/`, 'cache-control': 'no-store' } })
  }
  if (!file || !info?.isFile()) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })

  const etag = `"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`
  const headers = new Headers({
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': cacheFor(pathname),
    etag,
  })
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  headers.set('content-length', String(info.size))
  if (request.method === 'HEAD') return new Response(null, { headers })
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, { headers })
}
