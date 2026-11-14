import { useEffect, useState } from 'react'
import { type Chapter, chaptersFromSteps, parseChapters } from '../lib/guideVideo'
import type { TourFile } from '../lib/tour'

/** One of the Guide's videos: its file, its poster and its captions. */
export interface GuideVideo {
  file: string
  poster: string
  captions: string
}

/** The Guide's videos that exist: the walkthrough with its chapters, and the 30-second demo. */
export interface GuideVideos {
  walkthrough: GuideVideo | null
  /** The walkthrough's chapters, in order; empty when it has none on hand. */
  chapters: Chapter[]
  demo: GuideVideo | null
}

const NONE: GuideVideos = { walkthrough: null, chapters: [], demo: null }
let asked: Promise<GuideVideos> | null = null

/** True when a file answers as a video: a server with no such file may answer with a page, or with nothing. Its headers alone are asked for. */
const answers = (file: string) =>
  fetch(file, { method: 'HEAD' })
    .then((response) => response.ok && (response.headers.get('content-type') ?? '').startsWith('video/'))
    .catch(() => false)

/** The walkthrough's chapters: from its chapters file, or else from the list of steps its recorder writes beside it. */
async function chaptersOf(video: TourFile['video']): Promise<Chapter[]> {
  const text = (url: string, kind: string) =>
    fetch(url)
      .then(async (response) => (response.ok && (response.headers.get('content-type') ?? '').includes(kind) ? await response.text() : null))
      .catch(() => null)
  const vtt = await text(video.chapters, 'vtt')
  const fromFile = vtt ? parseChapters(vtt) : []
  if (fromFile.length > 0) return fromFile
  const list = await text(video.steps, 'json')
  try {
    return list ? chaptersFromSteps(JSON.parse(list)) : []
  } catch {
    return []
  }
}

/**
 * The Guide's videos, if they exist yet: the page offers no player and no link for one until its
 * file answers as a video. Asked for once, and only when something that would show them is open
 * (`when`), so Watch and the first paint load nothing for them.
 */
export function useGuideVideos(tour: TourFile, when: boolean): GuideVideos {
  const [videos, setVideos] = useState<GuideVideos>(NONE)
  useEffect(() => {
    if (!when) return
    let current = true
    asked ??= Promise.all([answers(tour.video.file), answers(tour.demo.file)]).then(async ([walkthrough, demo]) => ({
      walkthrough: walkthrough ? { file: tour.video.file, poster: tour.video.poster, captions: tour.video.captions } : null,
      chapters: walkthrough ? await chaptersOf(tour.video) : [],
      demo: demo ? { file: tour.demo.file, poster: tour.demo.poster, captions: tour.demo.captions } : null,
    }))
    void asked.then((found) => {
      if (current) setVideos(found)
    })
    return () => {
      current = false
    }
  }, [tour, when])
  return videos
}
