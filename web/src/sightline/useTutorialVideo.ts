import { useEffect, useState } from 'react'

/** The tutorial video's files, once its recorder has put them in place. */
export interface TutorialVideo {
  file: string
  poster: string
  captions: string
}

let asked: Promise<TutorialVideo | null> | null = null

/**
 * The tutorial video, if it exists yet. Its recorder writes a small manifest beside the files
 * (`/video/sightline-tutorial.json`: `{ "file", "poster", "captions" }`); until that is there the
 * page offers no player and no link. Asked for once, and only when something that would show it is
 * open (`when`), so Watch and the first paint load nothing for it.
 */
export function useTutorialVideo(manifest: string, when: boolean): TutorialVideo | null {
  const [video, setVideo] = useState<TutorialVideo | null>(null)
  useEffect(() => {
    if (!when) return
    let current = true
    asked ??= fetch(manifest)
      // A server with no such file may answer with a page: only JSON that names the three files counts.
      .then(async (response) => (response.ok && (response.headers.get('content-type') ?? '').includes('json') ? ((await response.json()) as Partial<TutorialVideo>) : null))
      .then((found) => (found && typeof found.file === 'string' && typeof found.poster === 'string' && typeof found.captions === 'string' ? { file: found.file, poster: found.poster, captions: found.captions } : null))
      .catch(() => null)
    void asked.then((found) => {
      if (current) setVideo(found)
    })
    return () => {
      current = false
    }
  }, [manifest, when])
  return video
}
