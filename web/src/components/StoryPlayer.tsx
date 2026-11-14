import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlaggedSite } from '../data/useAllFlags'
import type { ScenarioData } from '../data/loadSite'
import { type CameraCue, STORY, type StoryContext, stepDurationMs } from '../lib/story'

interface Props {
  data: ScenarioData | null
  all: FlaggedSite[] | null
  /** False while the 3D view is still loading terrain; the step's clock waits for it. */
  ready: boolean
  paused: boolean
  onPausedChange: (paused: boolean) => void
  onScene: (siteId: string, month: string, camera: CameraCue) => void
  onIndex: (index: number) => void
  onClose: (keepView: boolean) => void
  onOpenGrid: () => void
}

const TICK_MS = 50
/** A slow download or a phone that can't draw 3D shouldn't stall the story. */
const MAX_WAIT_MS = 8000

const calmMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Plays the story: picks each scene, moves time through it, and captions it from the data. */
export function StoryPlayer({ data, all, ready, paused, onPausedChange, onScene, onIndex, onClose, onOpenGrid }: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [waitedMs, setWaitedMs] = useState(0)
  const [calm] = useState(calmMotion)
  const panel = useRef<HTMLDivElement>(null)
  const step = STORY[stepIndex]
  const last = stepIndex === STORY.length - 1

  useEffect(() => {
    panel.current?.focus()
  }, [])

  useEffect(() => {
    if (calm) onPausedChange(true)
  }, [calm, onPausedChange])

  // The clocks reset together with the step, so an old reading can't move the new step along.
  const goToStep = (next: number) => {
    setStepIndex(next)
    setElapsedMs(0)
    setWaitedMs(0)
  }

  useEffect(() => {
    onScene(step.siteId, step.month, step.camera)
  }, [step, onScene])

  const onShow = data?.site.id === step.siteId && data.month === step.month
  const context = useMemo<StoryContext | null>(() => {
    if (!onShow || !data || !all) return null
    return {
      track: data.track,
      horizon: data.horizon,
      flags: Object.fromEntries(all.map(({ site, flags }) => [site.id, flags])),
      places: Object.fromEntries(all.map(({ site }) => [site.id, site])),
    }
  }, [onShow, data, all])

  const caption = context && step.caption(context)
  const sweep = useMemo(() => context && step.sweep(context), [context, step])
  const durationMs = caption ? stepDurationMs(caption) : MAX_WAIT_MS
  const settled = context !== null && (ready || waitedMs >= MAX_WAIT_MS)

  useEffect(() => {
    if (paused || !context) return
    const timer = setInterval(() => {
      if (settled) setElapsedMs((value) => value + TICK_MS)
      else setWaitedMs((value) => value + TICK_MS)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [paused, context, settled])

  // Move time through the scene. With motion turned down, show where the scene ends up.
  useEffect(() => {
    if (!sweep || !settled) return
    const [from, to] = sweep
    const progress = calm ? 1 : Math.min(elapsedMs / durationMs, 1)
    onIndex(Math.round(from + (to - from) * progress))
  }, [sweep, settled, calm, elapsedMs, durationMs, onIndex])

  useEffect(() => {
    if (!last && !paused && elapsedMs >= durationMs) {
      setStepIndex((value) => value + 1)
      setElapsedMs(0)
      setWaitedMs(0)
    }
  }, [last, paused, elapsedMs, durationMs])

  return (
    <div
      ref={panel}
      className="story"
      role="group"
      aria-label={`Tour, step ${stepIndex + 1} of ${STORY.length}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose(false)
        if (event.key === 'ArrowRight' && !last) goToStep(stepIndex + 1)
        if (event.key === 'ArrowLeft' && stepIndex > 0) goToStep(stepIndex - 1)
      }}
    >
      <p className="story-caption" aria-live="polite">
        {caption ?? 'Loading the next place…'}
      </p>
      <div className="story-progress" aria-hidden="true">
        {STORY.map((item, i) => (
          <span key={item.id} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : undefined}>
            {i === stepIndex && (
              <span style={{ width: `${calm ? 100 : Math.min((100 * elapsedMs) / durationMs, 100)}%` }} />
            )}
          </span>
        ))}
      </div>
      <div className="story-controls">
        <button type="button" disabled={stepIndex === 0} onClick={() => goToStep(stepIndex - 1)}>
          Back
        </button>
        {!last && (
          <button type="button" onClick={() => onPausedChange(!paused)}>
            {paused ? 'Play' : 'Pause'}
          </button>
        )}
        {!last && (
          <button type="button" onClick={() => goToStep(stepIndex + 1)}>
            Next
          </button>
        )}
        {last ? (
          <>
            <button type="button" onClick={onOpenGrid}>
              See every site and month
            </button>
            <button type="button" onClick={() => onClose(true)}>
              Explore from here
            </button>
          </>
        ) : (
          <button type="button" onClick={() => onClose(false)}>
            Exit tour
          </button>
        )}
      </div>
    </div>
  )
}
