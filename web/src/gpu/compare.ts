import { loadPart } from '../data/staleBuild'
import type { Vec3 } from '../lib/polarCamera'
import type { GlobeFrame, GlobeViewerConfig } from '../three/GlobeViewer'
import { type PictureDifference, pictureDifference } from './difference'
import { GlTimer } from './glTimer'
import { frameAt, type Scene } from './script'
import { Recent, type Summary } from './stats'

/** The two globes: the site's own on the left, the WebGPU port on the right. */
export type SideName = 'webgl2' | 'webgpu'
export const SIDES: SideName[] = ['webgl2', 'webgpu']
type Backend = 'webgl2' | 'webgpu'

/** The maps both globes are given. */
export type GlobeMaps = Omit<GlobeViewerConfig, 'canvas' | 'onLost'>

/** One globe, as the comparison drives it. */
interface Side {
  /** What is really drawing: the right side is WebGL2 too where the browser has no WebGPU. */
  backend: Backend
  /** The graphics card as the browser names it. */
  graphics: string
  /** Whether the browser tells how long the GPU takes. */
  timesGpu: boolean
  /** Draw one frame now. `cpuMs` is the time spent inside the render call; `complete` once every map is in the picture. */
  draw(frame: GlobeFrame): { complete: boolean; cpuMs: number }
  /** GPU milliseconds per frame that have come in since the last call. */
  gpuTimes(): number[]
  /** Resolves when the GPU has finished everything asked of it so far. */
  finished(): Promise<void>
  dispose(): void
}

/** What the page shows under one globe. Null means not known yet. */
export interface Readout {
  backend: Backend | null
  graphics: string | null
  widthPx: number
  heightPx: number
  /** Time in the render call on the CPU, and time on the GPU, over the latest 300 frames (ms). */
  cpu: Summary | null
  gpu: Summary | null
  timesGpu: boolean | null
  /** From the start of the page load to the first frame drawn from every map, finished on the GPU (ms). */
  completeMs: number | null
  error: string | null
}

export interface Readouts {
  sides: Partial<Record<SideName, Readout>>
  /** Time between two screen refreshes, over the latest 300 (ms). */
  interval: Summary | null
  difference: PictureDifference | null
}

async function startWebgl2(config: GlobeViewerConfig): Promise<Side> {
  const { GlobeViewer } = await loadPart(() => import('../three/GlobeViewer'))
  const viewer = new GlobeViewer(config)
  // Three.js has made the canvas's WebGL2 context; asking for it again hands back the same one.
  const gl = config.canvas.getContext('webgl2')
  if (!gl) throw new Error('WebGL2 is not available')
  const timer = new GlTimer(gl)
  const names = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    backend: 'webgl2',
    graphics: names ? String(gl.getParameter(names.UNMASKED_RENDERER_WEBGL)) : 'not named',
    timesGpu: timer.offered,
    draw(frame) {
      timer.begin()
      const start = performance.now()
      const complete = viewer.drawNow(frame)
      const cpuMs = performance.now() - start
      timer.end()
      return { complete, cpuMs }
    },
    gpuTimes: () => timer.read(),
    finished: async () => gl.finish(),
    dispose: () => viewer.dispose(),
  }
}

async function startWebgpu(config: GlobeViewerConfig): Promise<Side> {
  const { GlobeViewerGpu } = await loadPart(() => import('../three/GlobeViewerGpu'))
  const viewer = new GlobeViewerGpu(config)
  const backend = await viewer.ready
  const times: number[] = []
  let asking = false
  return {
    backend,
    graphics: viewer.graphics,
    timesGpu: viewer.timesGpu,
    draw(frame) {
      const start = performance.now()
      const complete = viewer.drawNow(frame)
      const cpuMs = performance.now() - start
      // One question at a time: each answer is the GPU's time for the latest frame it has finished.
      if (viewer.timesGpu && !asking) {
        asking = true
        void viewer.gpuMs().then((ms) => {
          asking = false
          if (ms) times.push(ms)
        })
      }
      return { complete, cpuMs }
    },
    gpuTimes: () => times.splice(0),
    finished: () => viewer.finished(),
    dispose: () => viewer.dispose(),
  }
}

const START: Record<SideName, (config: GlobeViewerConfig) => Promise<Side>> = { webgl2: startWebgl2, webgpu: startWebgpu }

interface Lane {
  name: SideName
  canvas: HTMLCanvasElement
  side: Side | null
  cpu: Recent
  gpu: Recent
  complete: boolean
  completeMs: number | null
  error: string | null
}

/**
 * Draws the globes it is given canvases for, every screen refresh, from the same scripted camera
 * and Sun, and keeps the time each takes.
 */
export class Comparison {
  /** How far apart the two pictures were when last asked; null before that, or with one globe. */
  difference: PictureDifference | null = null
  private readonly lanes: Lane[]
  private readonly suns: readonly Vec3[]
  private readonly intervals = new Recent()
  private readonly startedAt = performance.now()
  private scene: Scene
  private request: number
  private lastTick: number | null = null
  private wantDifference = false
  private stopped = false

  constructor(canvases: Partial<Record<SideName, HTMLCanvasElement>>, maps: GlobeMaps, suns: readonly Vec3[], scene: Scene) {
    this.suns = suns
    this.scene = scene
    this.lanes = SIDES.flatMap((name) => {
      const canvas = canvases[name]
      return canvas ? [{ name, canvas, side: null, cpu: new Recent(), gpu: new Recent(), complete: false, completeMs: null, error: null }] : []
    })
    for (const lane of this.lanes) {
      const onLost = () => {
        lane.side = null
        lane.error = 'The browser took the graphics away.'
      }
      START[lane.name]({ ...maps, canvas: lane.canvas, onLost })
        .then((side) => {
          if (this.stopped) side.dispose()
          else lane.side = side
        })
        .catch((error: unknown) => {
          lane.error = String(error)
        })
    }
    this.request = requestAnimationFrame(this.tick)
  }

  private readonly tick = (now: number) => {
    this.request = requestAnimationFrame(this.tick)
    if (this.lastTick !== null) this.intervals.add(now - this.lastTick)
    this.lastTick = now
    const frame = frameAt((now - this.startedAt) / 1000, this.scene, this.suns)
    for (const lane of this.lanes) {
      const side = lane.side
      if (!side) continue
      const { complete, cpuMs } = side.draw(frame)
      for (const ms of side.gpuTimes()) lane.gpu.add(ms)
      if (complete && !lane.complete) {
        // The first whole picture: timings start here, and the clock stops when the GPU has drawn it.
        lane.complete = true
        lane.cpu.clear()
        lane.gpu.clear()
        void side.finished().then(() => {
          lane.completeMs = performance.now()
        })
      } else if (complete) {
        lane.cpu.add(cpuMs)
      }
    }
    if (this.wantDifference && this.lanes.length === 2 && this.lanes.every((lane) => lane.complete)) {
      this.wantDifference = false
      this.difference = pictureDifference(this.lanes[0].canvas, this.lanes[1].canvas)
    }
  }

  /** Switch between the whole Moon and the pole; the timings start again. */
  show(scene: Scene): void {
    if (scene === this.scene) return
    this.scene = scene
    this.difference = null
    for (const lane of this.lanes) {
      lane.cpu.clear()
      lane.gpu.clear()
    }
  }

  /** Compare the two pictures on the next frame; the answer appears in `difference`. */
  measureDifference(): void {
    this.wantDifference = true
  }

  readouts(): Readouts {
    const sides: Partial<Record<SideName, Readout>> = {}
    for (const lane of this.lanes) {
      sides[lane.name] = {
        backend: lane.side?.backend ?? null,
        graphics: lane.side?.graphics ?? null,
        widthPx: lane.canvas.width,
        heightPx: lane.canvas.height,
        cpu: lane.cpu.summary(),
        gpu: lane.gpu.summary(),
        timesGpu: lane.side?.timesGpu ?? null,
        completeMs: lane.completeMs,
        error: lane.error,
      }
    }
    return { sides, interval: this.intervals.summary(), difference: this.difference }
  }

  stop(): void {
    this.stopped = true
    cancelAnimationFrame(this.request)
    for (const lane of this.lanes) lane.side?.dispose()
  }
}
