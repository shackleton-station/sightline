import type { Bucket } from './deps'
import { reply } from '../shared/http'

/**
 * Names the pipeline writes: `manifest.json`, terrain tiles `<set>/<row>_<col>.bin.gz`, and the light
 * grids' months and slope maps (`light/2027-05.bin.gz`, `light/wide/2027-05.bin.gz`,
 * `light/slope_x.jpg`). Nothing else is served.
 */
const TILE_KEY = /^(manifest\.json|(global|polar)\/\d+_\d+\.bin\.gz|light\/((wide\/)?\d{4}-\d{2}\.bin\.gz|slope_[xy]\.jpg))$/

function tileType(key: string): string {
  if (key.endsWith('.json')) return 'application/json'
  return key.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'
}

/** The demo video and its companions, kept in the bucket under `media/`. */
const MEDIA_TYPES: Record<string, string> = {
  'demo.mp4': 'video/mp4',
  'demo.vtt': 'text/vtt; charset=utf-8',
  'demo-poster.jpg': 'image/jpeg',
  // The easter egg page's video (/hype/).
  'hype.mp4': 'video/mp4',
  'hype-poster.jpg': 'image/jpeg',
}

function readOnly(request: Request): boolean {
  return request.method === 'GET' || request.method === 'HEAD'
}

/**
 * Serves a terrain tile from the bucket (`tiles/…`). Tiles only change when the pipeline reruns, so
 * browsers keep them a day. They go out as raw bytes: the page unpacks the gzip itself, so there is no
 * Content-Encoding here.
 */
export async function serveTile(request: Request, bucket: Bucket | null, pathname: string): Promise<Response> {
  if (!readOnly(request)) return reply({ error: 'method' }, 405)
  const key = pathname.slice('/tiles/'.length)
  if (!TILE_KEY.test(key)) return reply({ error: 'not-found' }, 404)
  if (!bucket) return reply({ error: 'not-configured' }, 503)
  const object = await bucket.get(`tiles/${key}`)
  if (!object) return reply({ error: 'not-found' }, 404)
  const headers = new Headers({
    'content-type': tileType(key),
    'cache-control': 'public, max-age=86400',
  })
  if (object.length) headers.set('content-length', object.length)
  if (object.etag) headers.set('etag', object.etag)
  if (request.method === 'HEAD') await object.body?.cancel()
  return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}

/** Streams a media file from the bucket (`media/…`), honoring Range requests so players can seek. */
export async function serveMedia(request: Request, bucket: Bucket | null, pathname: string): Promise<Response> {
  if (!readOnly(request)) return reply({ error: 'method' }, 405)
  const name = pathname.slice('/media/'.length)
  const type = MEDIA_TYPES[name]
  if (!type) return reply({ error: 'not-found' }, 404)
  if (!bucket) return reply({ error: 'not-configured' }, 503)
  const object = await bucket.get(`media/${name}`, request.headers.get('range'))
  if (!object) return reply({ error: 'not-found' }, 404)
  const headers = new Headers({
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  })
  if (object.length) headers.set('content-length', object.length)
  if (object.etag) headers.set('etag', object.etag)
  if (object.status === 206 && object.contentRange) headers.set('content-range', object.contentRange)
  if (request.method === 'HEAD') await object.body?.cancel()
  return new Response(request.method === 'HEAD' ? null : object.body, { status: object.status, headers })
}
