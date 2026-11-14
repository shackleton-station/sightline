import { useEffect, useRef, useState } from 'react'
import { Comparison, type Readout, type Readouts, SIDES, type SideName } from './compare'
import { loadMaps, loadSuns } from './maps'
import { BUNDLES, SHARED_NOTE } from './measured'
import type { Scene } from './script'
import type { Summary } from './stats'

const TITLES: Record<SideName, string> = { webgl2: 'WebGL2: what the site uses', webgpu: 'WebGPU: the same globe, ported' }

const ms = (value: number) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`
const typical = (summary: Summary) => `median ${ms(summary.median)}, 95% under ${ms(summary.p95)} (${summary.n} frames)`

function backendWords(name: SideName, readout: Readout): string {
  if (readout.error) return `Not running: ${readout.error}`
  if (!readout.backend) return 'Starting…'
  if (name === 'webgl2') return 'WebGL2, through Three.js WebGLRenderer'
  if (readout.backend === 'webgpu') return 'WebGPU, through Three.js WebGPURenderer'
  return 'WebGL2. This browser has no WebGPU; what you see on the right is WebGL2, through the fallback inside Three.js WebGPURenderer'
}

function gpuWords(readout: Readout): string {
  if (readout.timesGpu === null || readout.completeMs === null) return '…'
  if (!readout.timesGpu) return 'this browser does not say'
  return readout.gpu ? typical(readout.gpu) : 'waiting for the first answers…'
}

function SideReadout({ name, readout }: { name: SideName; readout: Readout | undefined }) {
  const bundle = BUNDLES[name]
  const total = bundle.files.reduce((sum, file) => sum + file.gzipKb, 0)
  if (!readout) return null
  return (
    <dl className="gpu-readout">
      <dt>Drawn by</dt>
      <dd data-fallback={name === 'webgpu' && readout.backend === 'webgl2'}>{backendWords(name, readout)}</dd>
      <dt>Graphics card</dt>
      <dd>{readout.graphics ?? '…'}</dd>
      <dt>Canvas</dt>
      <dd>
        {readout.widthPx} × {readout.heightPx} device pixels
      </dd>
      <dt>Processor time in the render call</dt>
      <dd>{readout.cpu ? typical(readout.cpu) : '…'}</dd>
      <dt>Graphics card time per frame</dt>
      <dd>{gpuWords(readout)}</dd>
      <dt>First complete picture</dt>
      <dd>{readout.completeMs === null ? '…' : `${(readout.completeMs / 1000).toFixed(2)} s after the page began to load`}</dd>
      <dt>JavaScript downloaded</dt>
      <dd>
        {total.toFixed(0)} kB gzipped: {bundle.files.map((file) => `${file.name} ${file.gzipKb.toFixed(0)}`).join(' + ')}. {bundle.note}{' '}
        {SHARED_NOTE}
      </dd>
    </dl>
  )
}

/**
 * The comparison page at /gpu/: the site's whole-Moon globe on WebGL2 next to the same globe on
 * WebGPU, on one scripted camera and Sun, with the time each takes to draw a frame.
 * `?only=webgl2` or `?only=webgpu` runs one side alone, and `?view=pole` starts at the pole.
 */
export function GpuPage() {
  const query = new URLSearchParams(window.location.search)
  const shown = SIDES.filter((name) => !query.get('only') || query.get('only') === name)
  const [scene, setScene] = useState<Scene>(query.get('view') === 'pole' ? 'pole' : 'moon')
  const [readouts, setReadouts] = useState<Readouts | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const canvases = useRef<Partial<Record<SideName, HTMLCanvasElement | null>>>({})
  const comparison = useRef<Comparison | null>(null)
  const firstScene = useRef(scene)

  useEffect(() => {
    let current = true
    let refresh: number | undefined
    Promise.all([loadMaps(), loadSuns()])
      .then(([maps, suns]) => {
        if (!current) return
        const { webgl2, webgpu } = canvases.current
        const running = new Comparison({ webgl2: webgl2 ?? undefined, webgpu: webgpu ?? undefined }, maps, suns, firstScene.current)
        comparison.current = running
        refresh = window.setInterval(() => setReadouts(running.readouts()), 500)
      })
      .catch((error: unknown) => setProblem(String(error)))
    return () => {
      current = false
      window.clearInterval(refresh)
      comparison.current?.stop()
      comparison.current = null
    }
  }, [])

  useEffect(() => {
    comparison.current?.show(scene)
  }, [scene])

  const difference = readouts?.difference
  return (
    // The numbers are also written on the element as text, for the script that records them (scripts/gpu-compare.mjs).
    <main className="gpu" data-readouts={readouts ? JSON.stringify(readouts) : undefined}>
      <p className="tag">
        <a href="/">Shackleton Station</a> · a measurement, not a part of the site
      </p>
      <h1>The Moon on WebGL2 and on WebGPU</h1>
      <p>
        The same Moon drawn twice with Three.js, from the same maps, the same camera and the same Sun: on the left by WebGL2, which the site
        uses, and on the right by WebGPU, the newer way for a web page to reach the graphics card.
      </p>
      <p className="actions">
        <button type="button" aria-pressed={scene === 'moon'} onClick={() => setScene('moon')}>
          Whole Moon
        </button>
        <button type="button" aria-pressed={scene === 'pole'} onClick={() => setScene('pole')}>
          South pole, zoomed in
        </button>
        {shown.length === 2 && (
          <button type="button" onClick={() => comparison.current?.measureDifference()}>
            Compare the two pictures
          </button>
        )}
      </p>
      {problem && <p role="alert">{problem}</p>}
      <div className="gpu-sides" data-count={shown.length}>
        {shown.map((name) => (
          <section key={name} aria-label={TITLES[name]}>
            <h2>{TITLES[name]}</h2>
            <canvas
              ref={(canvas) => {
                canvases.current[name] = canvas
              }}
            />
            <SideReadout name={name} readout={readouts?.sides[name]} />
          </section>
        ))}
      </div>
      {difference && (
        <p className="gpu-difference">
          The two pictures, pixel by pixel over the Moon's disk: {difference.meanSteps.toFixed(2)} of 255 brightness steps apart on average, and{' '}
          {difference.over8Pct.toFixed(2)}% of pixels more than 8 steps apart.
        </p>
      )}
      <p>
        How to read the numbers: both sides draw a new frame only when the screen refreshes
        {readouts?.interval ? ` (here every ${ms(readouts.interval.median)})` : ''}, so frames per second is the same for both and says nothing;
        what matters is how long one frame takes to draw, on the processor and on the graphics card, and anything well under the time between
        two refreshes looks equally smooth.
      </p>
      <p className="note">
        The camera turns once a minute and the Sun runs through January 2027 as our pipeline computed it, so every run draws the same
        pictures. A browser tab's clock ticks every 0.1 ms, so processor times come in steps of that. The numbers we recorded are in
        docs/SYSTEM_DESIGN.md, under "Measured".
      </p>
    </main>
  )
}
