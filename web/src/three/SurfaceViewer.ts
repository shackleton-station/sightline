import * as THREE from 'three'
import { cameraAxes, type Look, skyVector } from '../lib/surfaceView'
import { EARTH_MAP_URL, EARTH_SHADING, SUN_SHADING } from './skyShading'

/** The Sun or Earth for one frame: where the track puts it, and how big it looks from the site. */
export interface SkyBody {
  azDeg: number
  elDeg: number
  radiusDeg: number
  /** The track's own answer: is any part of it above the horizon? A body that isn't is not drawn. */
  up: boolean
}

export interface SurfaceFrame {
  look: Look
  /** `share` is the track's share of the Sun's disk above the horizon; it sets the glare. */
  sun: SkyBody & { share: number }
  earth: SkyBody
}

export interface SurfaceViewerConfig {
  canvas: HTMLCanvasElement
  onLostChange: (lost: boolean) => void
}

const MAX_PIXEL_RATIO = 2
/** Everything sits on balls round the eye: the land nearest, then the Sun and Earth, then the stars. */
const LAND_RADIUS = 10
const SKY_RADIUS = 100
const STAR_RADIUS = 400
/** The Sun's square reaches this many of its radii out, to hold its glare. Earth's only its own edge. */
const SUN_REACH = 9
const EARTH_REACH = 1.06
const STAR_COUNT = 7000
/** The land: nearly black, a little lighter in the few degrees under its top edge, with a hairline on the edge. */
const LAND_COLOR = 0x090a0e
const LAND_RIM_COLOR = 0x1d202c
const LAND_RIM_DEG = 3
const SKYLINE_COLOR = 0x6d7591

// A flat square facing the eye. `vDisk` is the place on it in the body's own radii: the disk is
// where its length is under 1.
const DISK_VERTEX = /* glsl */ `
uniform float reach;
varying vec2 vDisk;
void main() {
  vDisk = position.xy * reach;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// The Sun's disk, the same colors as in the 3D terrain view, and a glare round it that fades with
// the share of the disk in view: there is no air here to glow after the Sun has gone.
const SUN_FRAGMENT = /* glsl */ `
uniform float reach;
uniform float share;
varying vec2 vDisk;
${SUN_SHADING}
void main() {
  float r = length(vDisk);
  float soft = fwidth(r);
  float inside = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, r);
  float mu = sqrt(max(1.0 - r * r, 0.0));
  vec3 disk = sunColor(mu, vec3(vDisk, mu));
  float away = max(r - 1.0, 0.0);
  float glare = share * (0.5 * exp(-away * 2.4) + 0.1 * exp(-away * 0.55)) * (1.0 - smoothstep(reach * 0.55, reach, r));
  gl_FragColor = vec4(disk * inside + vec3(1.0, 0.84, 0.58) * glare * (1.0 - inside), inside);
  #include <colorspace_fragment>
}`

// Earth's disk as a ball seen face on: the surface direction at each point is worked out from its
// place on the disk, in the site's own east, north and up, so the lit part is the phase seen from
// the site whatever the stretch. The map is only for looks (see skyShading.ts): the face shown is
// always the same one, with Earth's north along the Moon's.
const EARTH_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 toSun;
uniform vec3 axisRight;
uniform vec3 axisUp;
uniform vec3 axisNear;
uniform vec3 pole;
varying vec2 vDisk;
${EARTH_SHADING}
void main() {
  float r = length(vDisk);
  float soft = fwidth(r);
  float inside = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, r);
  if (inside <= 0.0) discard;
  float facing = sqrt(max(1.0 - r * r, 0.0));
  vec3 normal = normalize(vDisk.x * axisRight + vDisk.y * axisUp + facing * axisNear);
  vec3 prime = normalize(axisNear - pole * dot(axisNear, pole));
  float lat = asin(clamp(dot(normal, pole), -1.0, 1.0));
  float lon = atan(dot(normal, cross(pole, prime)), dot(normal, prime));
  vec3 surface = texture2D(map, vec2(0.5 + lon / 6.2831853, 0.5 + lat / 3.1415927)).rgb;
  gl_FragColor = vec4(earthColor(surface, dot(normal, toSun), facing) * inside, inside);
  #include <colorspace_fragment>
}`

const STAR_VERTEX = /* glsl */ `
attribute float size;
attribute float glow;
uniform float pixelRatio;
varying float vGlow;
void main() {
  vGlow = glow;
  gl_PointSize = size * pixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const STAR_FRAGMENT = /* glsl */ `
uniform float dim;
varying float vGlow;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float spot = 1.0 - smoothstep(0.35, 1.0, r);
  gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * vGlow * dim * spot, 0.0);
  #include <colorspace_fragment>
}`

/** Colors already multiplied by their cover, laid over what is behind: a disk hides, a glare adds. */
const OVERLAY = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const

/**
 * The view from the lander's eye: no terrain mesh, only what the pipeline computed. The land is a
 * dark shape whose top edge is the site's horizon file, point for point; the Sun and Earth are flat
 * disks at the track's azimuth and elevation, at their true angular sizes, and the land in front
 * hides whatever of them is below it. Stars are decoration. Draws only when asked, at most once
 * per screen refresh.
 */
export class SurfaceViewer {
  /** How long the last frame took to draw on this thread (ms), for measuring. */
  lastDrawMs = 0

  private readonly canvas: HTMLCanvasElement
  private readonly onLostChange: (lost: boolean) => void
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 4000)
  /** The land, Sun and Earth: scaled along "up" when heights are stretched. */
  private readonly world = new THREE.Group()
  private readonly land = new THREE.Group()
  private readonly sun: THREE.Mesh
  private readonly earth: THREE.Mesh
  private readonly stars: THREE.Points
  private readonly sunUniforms = { reach: { value: SUN_REACH }, share: { value: 1 } }
  private readonly earthUniforms = {
    reach: { value: EARTH_REACH },
    map: { value: plainTexture(20, 45, 110) as THREE.Texture },
    toSun: { value: new THREE.Vector3(0, 1, 0) },
    axisRight: { value: new THREE.Vector3(1, 0, 0) },
    axisUp: { value: new THREE.Vector3(0, 0, 1) },
    axisNear: { value: new THREE.Vector3(0, -1, 0) },
    pole: { value: new THREE.Vector3(0, 0, -1) },
  }
  private readonly starUniforms = { pixelRatio: { value: 1 }, dim: { value: 1 } }
  private readonly disposables: { dispose: () => void }[] = []
  private frame: SurfaceFrame | null = null
  private request: number | null = null
  private lost = false

  constructor({ canvas, onLostChange }: SurfaceViewerConfig) {
    this.canvas = canvas
    this.onLostChange = onLostChange
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    this.renderer.setClearColor(0x000000, 1)
    this.starUniforms.pixelRatio.value = this.renderer.getPixelRatio()
    canvas.addEventListener('webglcontextlost', this.handleLost)
    canvas.addEventListener('webglcontextrestored', this.handleRestored)

    // East, north, up: z is up, as in the rest of the app.
    this.camera.up.set(0, 0, 1)

    const square = new THREE.PlaneGeometry(2, 2)
    const sunMaterial = new THREE.ShaderMaterial({ uniforms: this.sunUniforms, vertexShader: DISK_VERTEX, fragmentShader: SUN_FRAGMENT, ...OVERLAY })
    const earthMaterial = new THREE.ShaderMaterial({ uniforms: this.earthUniforms, vertexShader: DISK_VERTEX, fragmentShader: EARTH_FRAGMENT, ...OVERLAY })
    this.sun = new THREE.Mesh(square, sunMaterial)
    this.earth = new THREE.Mesh(square, earthMaterial)
    // Stars first, then the Sun, then Earth, which is always the nearer of the two.
    this.sun.renderOrder = 1
    this.earth.renderOrder = 2
    this.stars = this.buildStars()
    this.world.add(this.land, this.sun, this.earth)
    this.scene.add(this.stars, this.world)
    this.disposables.push(square, sunMaterial, earthMaterial, this.earthUniforms.map.value)

    new THREE.TextureLoader().load(EARTH_MAP_URL, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      this.earthUniforms.map.value = texture
      this.disposables.push(texture)
      this.schedule()
    })
  }

  /** Decoration: evenly scattered points, mostly faint, the same every time. Not a star map. */
  private buildStars(): THREE.Points {
    const positions = new Float32Array(STAR_COUNT * 3)
    const sizes = new Float32Array(STAR_COUNT)
    const glows = new Float32Array(STAR_COUNT)
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const z = 2 * scatter(4 * i) - 1
      const around = 2 * Math.PI * scatter(4 * i + 1)
      const flat = Math.sqrt(1 - z * z)
      positions.set([STAR_RADIUS * flat * Math.cos(around), STAR_RADIUS * flat * Math.sin(around), STAR_RADIUS * z], i * 3)
      const brightness = scatter(4 * i + 2) ** 4
      sizes[i] = 1.6 + 2.4 * brightness
      glows[i] = 0.25 + 0.75 * brightness
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('glow', new THREE.BufferAttribute(glows, 1))
    const material = new THREE.ShaderMaterial({ uniforms: this.starUniforms, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, ...OVERLAY })
    this.disposables.push(geometry, material)
    const stars = new THREE.Points(geometry, material)
    stars.frustumCulled = false
    return stars
  }

  private readonly handleLost = (event: Event) => {
    event.preventDefault()
    this.lost = true
    this.onLostChange(true)
  }

  private readonly handleRestored = () => {
    // Three.js uploads the scene again on the next render.
    this.lost = false
    this.onLostChange(false)
    this.schedule()
  }

  /**
   * The land, from a site's horizon. Its top edge is the horizon file's points joined by straight
   * lines, which is how the pipeline reads between them; below that it is a plain dark shape that
   * reaches straight down under the eye. It is a little lighter just under the top edge, so the
   * edge reads against a black sky: a way of drawing, not light worked out from anything.
   */
  setHorizon(horizon: { az: number; el: number }[]): void {
    this.releaseLand()
    const count = horizon.length
    // Three rings of points: the top edge, the same edge a few degrees lower, and the point below the eye.
    const positions = new Float32Array((2 * count + 1) * 3)
    const colors = new Float32Array((2 * count + 1) * 3)
    const rim = new THREE.Color(LAND_RIM_COLOR)
    const deep = new THREE.Color(LAND_COLOR)
    horizon.forEach((point, i) => {
      const top = skyVector(point.az, point.el)
      const lower = skyVector(point.az, Math.max(point.el - LAND_RIM_DEG, -89))
      positions.set([top[0] * LAND_RADIUS, top[1] * LAND_RADIUS, top[2] * LAND_RADIUS], i * 3)
      positions.set([lower[0] * LAND_RADIUS, lower[1] * LAND_RADIUS, lower[2] * LAND_RADIUS], (count + i) * 3)
      colors.set([rim.r, rim.g, rim.b], i * 3)
      colors.set([deep.r, deep.g, deep.b], (count + i) * 3)
    })
    positions.set([0, 0, -LAND_RADIUS], 2 * count * 3)
    colors.set([deep.r, deep.g, deep.b], 2 * count * 3)
    const indices: number[] = []
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count
      indices.push(i, next, count + i, next, count + next, count + i, count + i, count + next, 2 * count)
    }
    const ground = new THREE.BufferGeometry()
    ground.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    ground.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    ground.setIndex(indices)
    const groundMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })

    // A hairline along the top edge, a touch nearer than the land so it is never behind it.
    const edge = new THREE.BufferGeometry()
    edge.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 3).map((value) => value * 0.999), 3))
    const edgeMaterial = new THREE.LineBasicMaterial({ color: SKYLINE_COLOR })

    this.land.add(new THREE.Mesh(ground, groundMaterial), new THREE.LineLoop(edge, edgeMaterial))
    for (const child of this.land.children) child.frustumCulled = false
    this.schedule()
  }

  /**
   * Which way Earth's north points, seen from a site at this latitude: along the Moon's own north
   * pole, which is within a few degrees of right for the look of the disk (Earth's daily spin and
   * the tilt of its axis are not modelled).
   */
  setLatitude(latDeg: number): void {
    const lat = (latDeg * Math.PI) / 180
    this.earthUniforms.pole.value.set(0, Math.cos(lat), Math.sin(lat))
    this.schedule()
  }

  /** Ask for a frame. */
  draw(frame: SurfaceFrame): void {
    this.frame = frame
    this.schedule()
  }

  private schedule(): void {
    if (this.request !== null) return
    this.request = requestAnimationFrame(() => {
      this.request = null
      this.render()
    })
  }

  /** Put a body's square where the track says, facing the eye, sized to its angular radius. */
  private place(mesh: THREE.Mesh, body: SkyBody, reach: number): { right: THREE.Vector3; up: THREE.Vector3; near: THREE.Vector3 } {
    const toward = new THREE.Vector3(...skyVector(body.azDeg, body.elDeg))
    const az = (body.azDeg * Math.PI) / 180
    const right = new THREE.Vector3(Math.cos(az), -Math.sin(az), 0)
    const near = toward.clone().negate()
    const up = new THREE.Vector3().crossVectors(near, right)
    mesh.position.copy(toward).multiplyScalar(SKY_RADIUS)
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, near))
    mesh.scale.setScalar(SKY_RADIUS * Math.tan((body.radiusDeg * Math.PI) / 180) * reach)
    mesh.visible = body.up
    return { right, up, near }
  }

  private render(): void {
    const { frame, canvas, camera } = this
    if (!frame || this.lost || canvas.clientWidth === 0 || canvas.clientHeight === 0) return
    const started = performance.now()
    const size = this.renderer.getSize(new THREE.Vector2())
    if (size.x !== canvas.clientWidth || size.y !== canvas.clientHeight) {
      this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    }

    // The camera is the lens the page's own geometry describes (lib/surfaceView), so what is drawn
    // and what was checked against the track are the same picture.
    const { look } = frame
    const { forward } = cameraAxes(look)
    camera.fov = look.fovDeg
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
    camera.lookAt(forward[0], forward[1], forward[2])
    this.world.scale.set(1, 1, look.stretch)

    this.place(this.sun, frame.sun, SUN_REACH)
    const axes = this.place(this.earth, frame.earth, EARTH_REACH)
    this.sunUniforms.share.value = frame.sun.share
    this.earthUniforms.axisRight.value.copy(axes.right)
    this.earthUniforms.axisUp.value.copy(axes.up)
    this.earthUniforms.axisNear.value.copy(axes.near)
    this.earthUniforms.toSun.value.set(...skyVector(frame.sun.azDeg, frame.sun.elDeg))
    // A camera set for sunlit ground would show few stars; they fade as the Sun comes into view.
    this.starUniforms.dim.value = 1 - 0.7 * frame.sun.share

    this.renderer.render(this.scene, camera)
    this.lastDrawMs = performance.now() - started
  }

  private releaseLand(): void {
    for (const child of this.land.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
        child.geometry.dispose()
        ;(child.material as THREE.Material).dispose()
      }
    }
    this.land.clear()
  }

  /** Free the GPU memory now, rather than whenever the browser gets round to it. */
  dispose(): void {
    if (this.request !== null) cancelAnimationFrame(this.request)
    this.request = null
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored)
    this.releaseLand()
    for (const item of this.disposables) item.dispose()
    this.renderer.dispose()
    // Only when the canvas has really gone: React's strict mode remounts onto the same canvas.
    if (!this.canvas.isConnected) this.renderer.forceContextLoss()
  }
}

/** A 1×1 texture of one color, until the real map arrives. */
function plainTexture(r: number, g: number, b: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * A number from 0 to 1 that looks random but is the same every time for the same `n`, so the stars
 * are the same on every visit. The same sine hash the Sun's grain uses (skyShading.ts).
 */
function scatter(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
