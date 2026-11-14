import { useEffect, useState } from 'react'

/** The tutorial video's files, once its recorder has put them in place. */
export interface TutorialVideo {
  file: string
  poster: string
  captions: string
}

let asked: Promise<TutorialVideo | null> | null = null

/**
 * The tutorial video, if it exists yet: the page offers no player and no link until its file
 * answers as a video (a server with no such file may answer with a page, or with nothing). Asked for
 * once, by its headers alone, and only when something that would show it is open (`when`), so Watch
 * and the first paint load nothing for it.
 */
export function useTutorialVideo(files: TutorialVideo, when: boolean): TutorialVideo | null {
  const [video, setVideo] = useState<TutorialVideo | null>(null)
  useEffect(() => {
    if (!when) return
    let current = true
    asked ??= fetch(files.file, { method: 'HEAD' })
      .then((response) => (response.ok && (response.headers.get('content-type') ?? '').startsWith('video/') ? { file: files.file, poster: files.poster, captions: files.captions } : null))
      .catch(() => null)
    void asked.then((found) => {
      if (current) setVideo(found)
    })
    return () => {
      current = false
    }
  }, [files, when])
  return video
}
