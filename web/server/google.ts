import type { Speech } from './deps'
import type { TokenSource } from '../shared/google'

// The Cloud Storage bucket reader moved to shared/google.ts (the co-pilot reads the light grid from
// it too), and the model and the event queue to copilot/google.ts. What stays is the web server's own.

/**
 * One voice of Cloud Text-to-Speech. The text goes in the request's `text` field, never `ssml` or
 * `markup`, so nothing in it is read as an instruction to the voice. MP3 plays in every browser.
 *
 * The API has no project in its address, so Google bills the project the caller belongs to: for the
 * server's service account, its own. A developer's token belongs to no project, so `billTo` names one.
 */
export function googleSpeech(options: { voice: string; billTo?: string }, token: TokenSource): Speech {
  // A voice is named "<language>-<region>-<family>-<name>", for example en-US-Chirp3-HD-Leda.
  const languageCode = options.voice.split('-').slice(0, 2).join('-')
  return {
    async say(text, signal) {
      const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await token()}`,
          ...(options.billTo ? { 'x-goog-user-project': options.billTo } : {}),
        },
        body: JSON.stringify({ input: { text }, voice: { languageCode, name: options.voice }, audioConfig: { audioEncoding: 'MP3' } }),
        signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Text-to-Speech: HTTP ${response.status}`)
      }
      const { audioContent } = (await response.json()) as { audioContent?: string }
      if (!audioContent) throw new Error('Text-to-Speech: no audio in the answer')
      return { bytes: new Uint8Array(Buffer.from(audioContent, 'base64')), type: 'audio/mpeg' }
    },
  }
}
