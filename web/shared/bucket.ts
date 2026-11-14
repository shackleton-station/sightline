/** One stored file, or part of one when a byte range was asked for. */
export interface StoredObject {
  status: 200 | 206
  body: ReadableStream<Uint8Array> | null
  /** Bytes in this response. */
  length: string | null
  /** `bytes start-end/total`, on a 206. */
  contentRange: string | null
  etag: string | null
}

/** A Cloud Storage bucket, as far as the site reads one: terrain tiles, video and the light grid's months. */
export interface Bucket {
  /** The object at `key`, or null if there is none. `range` is an HTTP Range header value. */
  get(key: string, range?: string | null): Promise<StoredObject | null>
}
