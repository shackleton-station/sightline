/**
 * The Guide's videos: where a chapter starts, read from a WebVTT chapters file or from the list of
 * steps the recorder writes beside a video. Pure text in, plain data out; the fetching is the page's.
 */

/** One chapter of a video: where it starts, in seconds, and what it is called. */
export interface Chapter {
  at: number
  title: string
}

/** Seconds from a WebVTT timestamp, "01:02.500" or "00:01:02.500"; null when it is not one. */
function seconds(stamp: string): number | null {
  const parts = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(stamp.trim())
  return parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) + Number(parts[4]) / 1000 : null
}

/**
 * The chapters of a WebVTT chapters file: each cue's start and its text as the title. Notes, cue
 * names and anything that is not a cue are skipped; a file that is not WebVTT gives none.
 */
export function parseChapters(vtt: string): Chapter[] {
  const lines = vtt.replace(/^﻿/, '').split(/\r?\n/)
  if (!/^WEBVTT/.test(lines[0] ?? '')) return []
  const chapters: Chapter[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const cue = /^(\S+)\s+-->\s+(\S+)/.exec(lines[i])
    const at = cue ? seconds(cue[1]) : null
    if (at === null) continue
    const words: string[] = []
    for (i += 1; i < lines.length && lines[i].trim() !== ''; i += 1) words.push(lines[i].trim())
    // A title is words, never markup: tags are dropped.
    const title = words.join(' ').replace(/<[^>]*>/g, '').trim()
    if (title) chapters.push({ at, title })
  }
  return chapters
}

/** The chapters from the recorder's own list of steps (`{ steps: [{ title, start }] }`); none when it is not that. */
export function chaptersFromSteps(list: unknown): Chapter[] {
  const steps = typeof list === 'object' && list !== null && Array.isArray((list as { steps?: unknown }).steps) ? (list as { steps: unknown[] }).steps : []
  return steps.flatMap((step) => {
    const { title, start } = (step ?? {}) as { title?: unknown; start?: unknown }
    return typeof title === 'string' && title.trim() && typeof start === 'number' && Number.isFinite(start) && start >= 0 ? [{ at: start, title: title.trim() }] : []
  })
}

/** A moment of a video as a visitor reads it: "0:07", "1:12". */
export function chapterTime(at: number): string {
  const whole = Math.max(0, Math.floor(at))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
