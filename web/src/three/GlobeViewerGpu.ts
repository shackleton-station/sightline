import {
  asin,
  atan,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  dot,
  max,
  min,
  mix,
  normalLocal,
  normalView,
  positionViewDirection,
  sin,
  smoothstep,
  step,
  tan,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import * as THREE from 'three/webgpu'

import { meToScene } from './frames'
import type { GlobeFrame, GlobeViewerConfig } from './GlobeViewer'

/**
 * The whole-Moon globe of GlobeViewer.ts, drawn by Three.js's WebGPURenderer instead of its
 * WebGLRenderer. It exists for the comparison page at /gpu/ and nothing else uses it.
 *
 * GlobeViewer's GLSL (added to MeshStandardMaterial through onBeforeCompile) does not run here:
 * WebGPURenderer builds its shaders from nodes, so the same steps are written again below in
 * Three's node language (TSL). Ported: relief, color, slope lighting, the polar map, the lunar
 * scattering and the blend-in of new maps. Not ported: the light grid of lightLayer.ts (the Atlas)
 * and drawing only a part of the canvas (`frame.visible`).
 */

/** What is really drawing: WebGPURenderer falls back to WebGL2 by itself where WebGPU is missing. */
export type GpuBackend = 'webgpu' | 'webgl2'

// The same numbers as GlobeViewer.ts.
const MAX_PIXEL_RATIO = 2
const SUN_INTENSITY = 1.2 * Math.PI
const NIGHT_INTENSITY = 0.14
const EVEN_INTENSITY = Math.PI
const CAMERA_DISTANCE = 5
const FADE_S = 1.5
const MAX_FADE_FRAME_S = 0.05

type Light = Parameters<THREE.PhysicalLightingModel['direct']>[0]
type Builder = Parameters<THREE.PhysicalLightingModel['direct']>[1]

/**
 * The Moon's dust scatters close to Lommel-Seeliger, not like a matte ball: this turns the standard
 * material's sunlight into that, as LUNAR_SCATTER does in GlobeViewer.ts.
 */
class LunarLightingModel extends THREE.PhysicalLightingModel {
  private readonly sunSide: THREE.Node<'float'>

  constructor(sunSide: THREE.Node<'float'>) {
    super()
    this.sunSide = sunSide
  }

  direct(light: Light, builder: Builder): void {
    super.direct(light, builder)
    // The typings give these as plain nodes: both are three-part vectors.
    const sunDirection = light.lightDirection as THREE.Node<'vec3'>
    const sunlight = light.reflectedLight.directDiffuse as THREE.Node<'vec3'>
    const sunCos = max(dot(normalView, sunDirection), 0)
    const viewCos = max(dot(normalView, positionViewDirection), 0)
    sunlight.mulAssign(this.sunSide.mul(2).div(max(sunCos.add(viewCos), 0.05)))
  }
}

/** The surface as nodes: the same steps, in the same order, as SURFACE_FRAGMENT in GlobeViewer.ts. */
function moonSurface() {
  const colorMix = uniform(0)
  const terrainMix = uniform(0)
  const poleMix = uniform(0)
  const slopeMax = uniform(1)
  const poleScale = uniform(1)
  const poleAxisX = uniform(new THREE.Vector2(0, 1))
  const poleAxisY = uniform(new THREE.Vector2(1, 0))
  const reliefGain = uniform(1)
  /** Toward the Sun, in scene axes. */
  const sunScene = uniform(new THREE.Vector3(0, 0, 1))

  // SphereGeometry puts 0° E at u = 0.25; our maps have it in the middle (u = 0.5).
  const surfaceUv = uv().add(vec2(0.25, 0))
  // MOON_ME from scene axes (see frames.ts): x toward 0 E, y toward 90 E, z north.
  const moonUp = normalLocal.normalize().zxy
  const moonLat = asin(clamp(moonUp.z, -1, 1))
  const moonLon = atan(moonUp.y, moonUp.x)
  const moonEast = vec3(sin(moonLon).negate(), cos(moonLon), 0)
  const moonNorth = cross(moonUp, moonEast)

  // The polar map is a flat picture of the ground around the pole: its coordinates are distances from the pole.
  const fromPole = min(moonLat.add(Math.PI / 2), 0.5)
  const polarGround = vec2(cos(moonLon), sin(moonLon)).mul(tan(fromPole.mul(0.5)).mul(2))
  const poleUv = vec2(dot(polarGround, poleAxisX).mul(poleScale).add(0.5), dot(polarGround, poleAxisY).mul(poleScale).add(0.5))
  const inPolarMap = step(poleUv.x.sub(0.5).abs(), 0.49).mul(step(poleUv.y.sub(0.5).abs(), 0.49))
  // Fades in between 80.5 and 81.6 degrees south.
  const cap = poleMix.mul(inPolarMap).mul(smoothstep(-1.425, -1.405, moonLat).oneMinus())

  const maps = {
    relief: texture(placeholderTexture(), surfaceUv),
    color: texture(placeholderTexture(), surfaceUv),
    slopeE: texture(placeholderTexture(), surfaceUv),
    slopeN: texture(placeholderTexture(), surfaceUv),
    poleX: texture(placeholderTexture(), poleUv),
    poleY: texture(placeholderTexture(), poleUv),
  }
  /** A slope image's value as rise over run: mid-gray is level. */
  const slope = (map: THREE.TextureNode) => map.r.mul(255).sub(128).div(127).mul(slopeMax)

  // Which way the ground tilts, as a vector along the surface.
  const moonTilt = moonEast.mul(slope(maps.slopeE)).add(moonNorth.mul(slope(maps.slopeN)))
  const poleFlat = vec3(poleAxisX, 0).mul(slope(maps.poleX)).add(vec3(poleAxisY, 0).mul(slope(maps.poleY)))
  const poleTilt = poleFlat.sub(moonUp.mul(dot(poleFlat, moonUp)))
  const tilt = mix(moonTilt, poleTilt, cap)
  const tilted = moonUp.sub(tilt.mul(reliefGain).mul(terrainMix)).normalize()
  const normalNode = cameraViewMatrix.mul(vec4(tilted.yzx, 0)).xyz.normalize()

  // The smooth sphere decides day from night, so a slope past the day-night line can't catch light.
  const sunSide = mix(1, smoothstep(-0.03, 0.02, dot(normalLocal.normalize(), sunScene)), terrainMix)
  // Ground the Sun doesn't reach keeps a fixed soft shading so it still reads; sunlit ground is lit for real.
  const relief = maps.relief.r
  const baked = relief.mul(0.9).add(0.55)
  const soft = clamp(dot(tilt, moonEast.add(moonNorth).normalize()), -0.36, 0.36).mul(-2.2).add(1)
  const shading = mix(mix(baked, soft, cap), 1.05, terrainMix.mul(sunSide))
  // At the pole the color map is a smear: plain regolith gray instead.
  const tint = mix(maps.color.rgb, vec3(0.36, 0.35, 0.335), cap)
  const colorNode = mix(vec3(mix(relief, soft.mul(0.5), cap)), tint.mul(shading), colorMix)

  return { colorNode, normalNode, sunSide, maps, colorMix, terrainMix, poleMix, slopeMax, poleScale, poleAxisX, poleAxisY, reliefGain, sunScene }
}

/** GlobeViewer's globe on WebGPURenderer. Takes the same maps and the same GlobeFrame. */
export class GlobeViewerGpu {
  /** Resolves with what is really drawing, once the graphics device is ready. */
  readonly ready: Promise<GpuBackend>
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGPURenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY)
  private readonly ambient = new THREE.AmbientLight(0xffffff, NIGHT_INTENSITY)
  private readonly geometry = new THREE.SphereGeometry(1, 192, 96)
  private readonly material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 })
  private readonly surface = moonSurface()
  private moonSlopes = 0
  private poleSlopes = 0
  private hasRelief = false
  private colorTarget = 0
  private pending = 0
  private lastRender: number | null = null
  private started = false
  private disposed = false

  constructor({ canvas, reliefUrl, colorUrls, onLost, slopes = null }: GlobeViewerConfig) {
    this.canvas = canvas
    // trackTimestamp asks for the time the GPU spends on each frame, where the browser offers it.
    this.renderer = new THREE.WebGPURenderer({ canvas, alpha: true, antialias: true, trackTimestamp: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    this.renderer.onDeviceLost = () => {
      this.dispose()
      onLost()
    }
    this.ready = this.renderer.init().then(() => {
      this.started = true
      return this.isWebGpu ? 'webgpu' : 'webgl2'
    })

    const { surface } = this
    this.material.colorNode = surface.colorNode
    this.material.normalNode = surface.normalNode
    this.material.setupLightingModel = () => new LunarLightingModel(surface.sunSide)
    this.scene.add(new THREE.Mesh(this.geometry, this.material), this.sunLight, this.ambient)

    this.loadTexture(reliefUrl, THREE.NoColorSpace, (map) => {
      this.swap(surface.maps.relief, map)
      this.hasRelief = true
    })
    // The same order as GlobeViewer: color, sharper color, then the terrain.
    const loadSlopes = () => {
      if (!slopes) return
      const rad = Math.PI / 180
      surface.slopeMax.value = slopes.slopeMax
      surface.poleScale.value = slopes.radiusM / (2 * slopes.poleHalfWidthM)
      surface.poleAxisX.value.set(Math.cos(slopes.poleXLonDeg * rad), Math.sin(slopes.poleXLonDeg * rad))
      surface.poleAxisY.value.set(Math.cos(slopes.poleYLonDeg * rad), Math.sin(slopes.poleYLonDeg * rad))
      const slot = [surface.maps.slopeE, surface.maps.slopeN, surface.maps.poleX, surface.maps.poleY]
      ;[...slopes.moon, ...slopes.pole].forEach((url, i) => {
        this.loadTexture(url, THREE.NoColorSpace, (map) => {
          // One value per pixel, and the polar map has edges where the whole-Moon maps wrap around.
          map.format = THREE.RedFormat
          if (i >= 2) map.wrapS = THREE.ClampToEdgeWrapping
          this.swap(slot[i], map)
          if (i < 2) this.moonSlopes += 1
          else this.poleSlopes += 1
        })
      })
    }
    const loadColor = (index: number) => {
      const url = colorUrls[index]
      if (!url) return loadSlopes()
      this.loadTexture(url, THREE.SRGBColorSpace, (map) => {
        this.swap(surface.maps.color, map)
        this.colorTarget = 1
        loadColor(index + 1)
      })
    }
    loadColor(0)
  }

  private get isWebGpu(): boolean {
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
  }

  private swap(node: THREE.TextureNode, map: THREE.Texture): void {
    node.value.dispose()
    node.value = map
  }

  /** Decoded off the main thread and the right way up, as in GlobeViewer; put on the GPU once the device is ready. */
  private loadTexture(url: string, colorSpace: THREE.ColorSpace, onLoad: (map: THREE.Texture) => void): void {
    this.pending += 1
    const loader = new THREE.ImageBitmapLoader()
    loader.setOptions({ imageOrientation: 'flipY' })
    loader.load(url, async (bitmap) => {
      await this.ready
      if (this.disposed) return bitmap.close()
      const map = new THREE.Texture(bitmap)
      map.flipY = false
      map.colorSpace = colorSpace
      map.wrapS = THREE.RepeatWrapping
      map.wrapT = THREE.ClampToEdgeWrapping
      map.anisotropy = this.renderer.getMaxAnisotropy()
      map.needsUpdate = true
      map.addEventListener('dispose', () => bitmap.close())
      onLoad(map)
      this.renderer.initTexture(map)
      this.pending -= 1
    })
  }

  /** Draw this view now. True once the picture is drawn from every map the globe was given. */
  drawNow(frame: GlobeFrame): boolean {
    if (!this.started || !this.hasRelief || this.disposed) return false
    const { canvas, surface } = this
    const size = this.renderer.getSize(new THREE.Vector2())
    if (size.x !== canvas.clientWidth || size.y !== canvas.clientHeight) this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)

    const rad = Math.PI / 180
    const { lat, lon } = frame.view
    const center = [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)]
    this.camera.position.copy(meToScene(center)).multiplyScalar(CAMERA_DISTANCE)
    this.camera.up.copy(meToScene(frame.up ?? [0, 0, 1]))
    this.camera.lookAt(0, 0, 0)
    if (this.camera.zoom !== frame.zoom) {
      this.camera.zoom = frame.zoom
      this.camera.updateProjectionMatrix()
    }

    // New maps blend in over FADE_S, as in GlobeViewer.
    const now = performance.now()
    const step = (this.lastRender === null ? 0 : Math.min((now - this.lastRender) / 1000, MAX_FADE_FRAME_S)) / FADE_S
    this.lastRender = now
    fadeToward(surface.colorMix, this.colorTarget, step)
    fadeToward(surface.terrainMix, frame.sun && this.moonSlopes === 2 ? 1 : 0, step)
    fadeToward(surface.poleMix, this.poleSlopes === 2 ? 1 : 0, step)
    surface.reliefGain.value = 1.7 - 0.7 * Math.min(Math.max((frame.zoom - 1) / 3, 0), 1)

    if (frame.sun) {
      surface.sunScene.value.copy(meToScene(frame.sun))
      this.sunLight.position.copy(surface.sunScene.value).multiplyScalar(CAMERA_DISTANCE)
    }
    // Zero rather than hidden, so the shader isn't rebuilt for a different number of lights.
    this.sunLight.intensity = frame.sun ? SUN_INTENSITY : 0
    this.ambient.intensity = frame.sun ? NIGHT_INTENSITY : EVEN_INTENSITY
    if (canvas.width > 0) this.renderer.render(this.scene, this.camera)
    return this.pending === 0
  }

  /** Whether the browser tells how long the GPU takes (WebGPU's "timestamp-query", or WebGL2's timer queries on the fallback). */
  get timesGpu(): boolean {
    const backend = this.renderer.backend as { trackTimestamp?: boolean; disjoint?: unknown }
    return backend.trackTimestamp === true && (this.isWebGpu || Boolean(backend.disjoint))
  }

  /** Milliseconds the GPU spent on the latest frame it has finished, or null where the browser doesn't say. */
  async gpuMs(): Promise<number | null> {
    if (this.disposed || !this.timesGpu) return null
    return (await this.renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)) ?? null
  }

  /** Resolves when the GPU has finished everything asked of it so far. */
  async finished(): Promise<void> {
    const backend = this.renderer.backend as { device?: GPUDevice; gl?: WebGL2RenderingContext }
    if (backend.device) await backend.device.queue.onSubmittedWorkDone()
    else backend.gl?.finish()
  }

  /** The graphics card as the browser names it. */
  get graphics(): string {
    const backend = this.renderer.backend as { device?: GPUDevice; gl?: WebGL2RenderingContext }
    const info = backend.device?.adapterInfo
    if (info) return [info.vendor, info.architecture, info.description].filter(Boolean).join(' ')
    const gl = backend.gl
    const names = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl && names ? String(gl.getParameter(names.UNMASKED_RENDERER_WEBGL)) : 'not named'
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.geometry.dispose()
    this.material.dispose()
    for (const map of Object.values(this.surface.maps)) map.value.dispose()
    // Not before the device has arrived: the renderer can't be taken apart half-made.
    void this.ready.then(() => this.renderer.dispose())
  }
}

/** Move a uniform up to `step` toward its target. */
function fadeToward(uniform: { value: number }, target: number, step: number): void {
  uniform.value += Math.max(-step, Math.min(step, target - uniform.value))
}

/**
 * A 1×1 mid-gray texture stands in until the real maps arrive. It must be a smoothed one, like them:
 * WebGPURenderer writes the shader for the texture a node holds when it is first drawn, and for a
 * texture read at its nearest pixel (a DataTexture's default) that shader reads single pixels of the
 * full-size image with no sampler at all. A map swapped in later would be read the same way.
 */
function placeholderTexture(): THREE.DataTexture {
  const map = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
  map.magFilter = THREE.LinearFilter
  map.minFilter = THREE.LinearFilter
  map.needsUpdate = true
  return map
}
