import { useCallback, useEffect, useRef, useState } from 'react'
import { createSpeaker, loadSound, saveSound, type Speaker, type VoiceState } from '../lib/voice'
import { type Chapter, chapterMs, hourAt } from './script'

/** start: waiting for the first tap. done: the last chapter has finished and stays on show. */
export type PlayerStatus = 'start' | 'playing' | 'paused' | 'done'

/** A voice that is slow to finish can hold a chapter this much longer than its own time, and no more. */
const VOICE_GRACE_MS = 20_000
/** A pause between a chapter ending and the next beginning, so the voice has a breath. */
const GAP_MS = 600
/** How far through a chapter the next one's voice is fetched, so it starts the moment its chapter does. */
const FETCH_AHEAD_AT = 0.35

/**
 * Plays the briefing: one chapter after another, each for as long as its caption takes to say. With
 * sound on, Scout's voice says each caption and the chapter waits for it to finish. The clock is the
 * screen's own frames, so the briefing stops while the tab is hidden.
 */
export function usePlayer(chapters: Chapter[]) {
  const [status, setStatus] = useState<PlayerStatus>('start')
  const [index, setIndex] = useState(0)
  /** How far through the chapter it is, 0 to 1; only its changes re-draw the page. */
  const [progress, setProgress] = useState(0)
  // Narration is the point of a briefing, so it is on unless the visitor has turned Scout's sound off.
  const [sound, setSoundOn] = useState(() => loadSound() !== 'off')
  const [voice, setVoice] = useState<VoiceState>('quiet')
  const speaker = useRef<Speaker | null>(null)
  const theSpeaker = () => (speaker.current ??= createSpeaker(setVoice))
  const voiceNow = useRef<VoiceState>('quiet')
  useEffect(() => {
    voiceNow.current = voice
  }, [voice])

  const chapter = chapters[Math.min(index, chapters.length - 1)] as Chapter | undefined
  const count = chapters.length

  /** Start a chapter from its beginning, saying its caption if sound is on. */
  const begin = useCallback(
    (next: number, withSound: boolean) => {
      const to = chapters[next]
      if (!to) return
      setIndex(next)
      setProgress(0)
      setStatus('playing')
      if (withSound) theSpeaker().speak(to.caption)
      else speaker.current?.stop()
    },
    [chapters],
  )

  // The clock: runs while playing, and moves on when the chapter's time is up and the voice is done.
  useEffect(() => {
    if (status !== 'playing' || !chapter) return
    const length = chapterMs(chapter)
    let elapsed = 0
    let last: number | null = null
    let shown = -1
    let fetchedAhead = false
    let frame = requestAnimationFrame(function tick(time) {
      elapsed += last === null ? 0 : Math.min(time - last, 100)
      last = time
      const talking = voiceNow.current === 'loading' || voiceNow.current === 'speaking'
      if (elapsed >= length + GAP_MS && (!talking || elapsed >= length + VOICE_GRACE_MS)) {
        if (index + 1 < count) begin(index + 1, sound)
        else setStatus('done')
        return
      }
      // A new hour of a sweep, or another hundredth of the bar: nothing else needs a re-draw.
      const now = Math.min(elapsed / length, 1)
      const next = chapters[index + 1]
      if (sound && next && !fetchedAhead && now >= FETCH_AHEAD_AT) {
        fetchedAhead = true
        speaker.current?.prepare(next.caption)
      }
      const step = hourAt(chapter, now) * 1000 + Math.round(now * 100)
      if (step !== shown) {
        shown = step
        setProgress(now)
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [status, chapter, chapters, index, count, sound, begin])

  // Leaving the page ends the sound with it.
  useEffect(() => {
    const stop = () => speaker.current?.stop()
    window.addEventListener('pagehide', stop)
    return () => {
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [])

  const play = useCallback(() => {
    // Called from a tap or a key press, which is what lets the browser play sound afterwards.
    if (sound) theSpeaker().prime()
    begin(status === 'done' || status === 'start' ? 0 : index, sound)
  }, [begin, index, sound, status])
  const pause = useCallback(() => {
    speaker.current?.stop()
    setStatus((now) => (now === 'playing' ? 'paused' : now))
  }, [])
  const go = useCallback(
    (to: number) => {
      if (sound) theSpeaker().prime()
      begin(Math.max(0, Math.min(count - 1, to)), sound)
    },
    [begin, count, sound],
  )
  const setSound = useCallback(
    (on: boolean) => {
      saveSound(on)
      setSoundOn(on)
      if (!on) speaker.current?.stop()
      else {
        theSpeaker().prime()
        // Turned on mid-chapter: say this chapter from its start.
        if (status === 'playing') begin(index, true)
      }
    },
    [begin, index, status],
  )

  /** The pointer is on Play: fetch the first caption's voice, so it starts with the first chapter. */
  const warm = useCallback(() => {
    if (sound && chapters[0]) theSpeaker().prepare(chapters[0].caption)
  }, [chapters, sound])

  return {
    warm,
    status,
    index,
    chapter,
    progress,
    hour: chapter ? hourAt(chapter, status === 'done' ? 1 : progress) : 0,
    sound,
    setSound,
    speaking: voice === 'speaking',
    /** Sound is on, but this caption couldn't be said aloud. */
    unsaid: sound && voice === 'failed',
    play,
    pause,
    go,
  }
}
