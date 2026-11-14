import * as THREE from 'three'
import { CSM } from 'three/addons/csm/CSM.js'
import { EARTH_MAP_URL, EARTH_SHADING, SUN_SHADING } from './skyShading'

/** East, north, up in meters from the site's ground. */
export type Vec3 = [number, number, number]

export interface CameraPose {
  eye: Vec3
  forward: Vec3
}

/** One square of terrain from lib/terrainMesh, in plain arrays. */
export interface TerrainPatch {
  positions: Float32Array
  indices: Uint32Array
}

export interface TerrainFrame {
  pose: CameraPose
  /** Unit vector toward the Sun, east/north/up at the site, from the pipeline. */
  toSun: Vec3
  /** Unit vector toward Earth, east/north/up at the site, from the pipeline. */
  toEarth: Vec3
  /** How far the camera is from the ground, for the near plane. */
  aboveGroundM: number
  /** Looking down from a distance (true), or standing at the site (false). */
  fromAbove: boolean
}

export interface TerrainViewerConfig {
  canvas: HTMLCanvasElement
  /** A phone or small window: fewer pixels, fewer and smaller shadow maps. */
  small: boolean
  onLostChange: (lost: boolean) => void
}

const FOV_Y_DEG = 50
const FAR_M = 1_000_000
const MAX_PIXEL_RATIO = 2
const MAX_PIXEL_RATIO_SMALL = 1.5

/**
 * Shadows come from cascaded shadow maps: fine near the camera, coarser far away, out to the edge of
 * the terrain we draw (250 km). The light boxes reach this far up-Sun, so a ridge on the far side of
 * the terrain still shadows the site when the Sun is low.
 */
const SHADOW_FAR_M = 300_000
const LIGHT_MARGIN_M = 400_000
const CASCADES = 4
const CASCADES_SMALL = 3
const SHADOW_MAP_PX = 2048
const SHADOW_MAP_PX_SMALL = 1024
/** Lifts each shadow lookup off its slope, so low-Sun ground doesn't speckle with self-shadowing. */
const SHADOW_NORMAL_BIAS_M = 1.5
const SHADOW_NORMAL_BIAS_TEXELS = 0.6

const SUN_INTENSITY = 1.15 * Math.PI
/** A dim blue fill from a fixed direction shows the shape of unlit ground. A display aid, not physics. */
const FILL_INTENSITY = 0.12
const AMBIENT_INTENSITY = 0.03

/** Where the Sun and Earth models are drawn when standing: far enough to sit behind every ridge. */
const SKY_DISTANCE_M = 900_000
/** Angular radii (degrees), from distance and body radius; they vary by a few percent over a year. */
export const SUN_RADIUS_DEG = 0.267
export const EARTH_RADIUS_DEG = 0.95
/** From above, both are drawn at the end of their sight lines, enlarged so they can be seen. */
const RAY_LENGTH_M = 15_000
const MARKER_SCALE = 0.025

// Earth gets its own small shader: the shadow cascades are several lights, and a standard material
// would add them all up. Lit by the same Sun direction, so its phase is the one seen from the site.
// The Blue Marble map is only for looks: Earth's daily spin isn't modelled, so which continent faces
// the Moon is not the real one. Its north pole points roughly along the Moon's (ecliptic north).
const EARTH_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewNormal;
varying vec2 vUv;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewNormal = normalize(normalMatrix * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const EARTH_FRAGMENT = /* glsl */ `
uniform vec3 toSun;
uniform sampler2D map;
varying vec3 vNormal;
varying vec3 vViewNormal;
varying vec2 vUv;
${EARTH_SHADING}
void main() {
  gl_FragColor = vec4(earthColor(texture2D(map, vUv).rgb, dot(normalize(vNormal), toSun), normalize(vViewNormal).z), 1.0);
  #include <colorspace_fragment>
}`

// The Sun's ball; its color is the shared rule in skyShading.ts.
const SUN_VERTEX = /* glsl */ `
varying vec3 vViewNormal;
varying vec3 vSpot;
void main() {
  vViewNormal = normalize(normalMatrix * normal);
  vSpot = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const SUN_FRAGMENT = /* glsl */ `
varying vec3 vViewNormal;
varying vec3 vSpot;
${SUN_SHADING}
void main() {
  gl_FragColor = vec4(sunColor(clamp(normalize(vViewNormal).z, 0.0, 1.0), vSpot), 1.0);
  #include <colorspace_fragment>
}`

/**
 * The 3D terrain view in Three.js: LOLA terrain lit by the pipeline's Sun direction, shadowed with
 * cascaded shadow maps, and models of the Sun and Earth where the ephemeris puts them. Draws only
 * when asked, at most once per screen refresh.
 */
export class TerrainViewer {
  /** The last frame's view-projection matrix (column-major), for placing labels over the canvas. */
  viewProjection: Float32Array = new Float32Array(16)

  private readonly canvas: HTMLCanvasElement
  private readonly onLostChange: (lost: boolean) => void
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV_Y_DEG, 1, 1, FAR_M)
  private readonly csm: CSM
  private readonly terrainMaterial = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 1, metalness: 0 })
  private readonly earthUniforms = {
    toSun: { value: new THREE.Vector3(0, 0, 1) },
    map: { value: plainTexture(20, 45, 110) as THREE.Texture },
  }
  private readonly terrain = new THREE.Group()
  private readonly sun: THREE.Group
  private readonly earth: THREE.Mesh
  private readonly disposables: { dispose: () => void }[] = []
  private frame: TerrainFrame | null = null
  private request: number | null = null
  private lost = false
  private lens = { near: 0, aspect: 0 }

  constructor({ canvas, small, onLostChange }: TerrainViewerConfig) {
    this.canvas = canvas
    this.onLostChange = onLostChange
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !small })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? MAX_PIXEL_RATIO_SMALL : MAX_PIXEL_RATIO))
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    canvas.addEventListener('webglcontextlost', this.handleLost)
    canvas.addEventListener('webglcontextrestored', this.handleRestored)

    // East, north, up: z is up, as in the rest of the app.
    this.camera.up.set(0, 0, 1)

    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: small ? CASCADES_SMALL : CASCADES,
      maxFar: SHADOW_FAR_M,
      mode: 'practical',
      shadowMapSize: small ? SHADOW_MAP_PX_SMALL : SHADOW_MAP_PX,
      lightDirection: new THREE.Vector3(0, 0, -1),
      lightIntensity: SUN_INTENSITY,
      lightNear: 1,
      lightFar: LIGHT_MARGIN_M + 2 * SHADOW_FAR_M,
      lightMargin: LIGHT_MARGIN_M,
    })
    this.csm.setupMaterial(this.terrainMaterial)

    const fill = new THREE.DirectionalLight(0x8cadff, FILL_INTENSITY)
    fill.position.set(-0.7, 0.7, 1)
    this.scene.add(this.terrain, fill, new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY))

    this.sun = this.buildSun()
    this.earth = this.buildEarth()
    this.scene.add(this.sun, this.earth)
  }

  private buildSun(): THREE.Group {
    const ball = new THREE.SphereGeometry(1, 48, 24)
    const ballMaterial = new THREE.ShaderMaterial({ vertexShader: SUN_VERTEX, fragmentShader: SUN_FRAGMENT })
    const glowTexture = radialGlow()
    const glow = (color: number, opacity: number, size: number) => {
      const material = new THREE.SpriteMaterial({
        map: glowTexture,
        color,
        opacity,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      this.disposables.push(material)
      const sprite = new THREE.Sprite(material)
      sprite.scale.setScalar(size)
      return sprite
    }
    this.disposables.push(ball, ballMaterial, glowTexture)
    const group = new THREE.Group()
    // A tight bright corona and a wide faint halo, as the Sun looks in a camera with no air around it.
    group.add(new THREE.Mesh(ball, ballMaterial), glow(0xffe2a8, 0.9, 4), glow(0xffb85c, 0.35, 14))
    return group
  }

  private buildEarth(): THREE.Mesh {
    const ball = new THREE.SphereGeometry(1, 64, 32)
    const material = new THREE.ShaderMaterial({
      uniforms: this.earthUniforms,
      vertexShader: EARTH_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
    })
    this.disposables.push(ball, material, this.earthUniforms.map.value)
    new THREE.TextureLoader().load(EARTH_MAP_URL, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      this.earthUniforms.map.value = texture
      this.disposables.push(texture)
      this.schedule()
    })
    const earth = new THREE.Mesh(ball, material)
    // The sphere's poles are along y; from the lunar south pole, ecliptic north is below the horizon.
    earth.rotation.x = -Math.PI / 2
    return earth
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

  /** Replace the terrain being drawn. */
  setTerrain(patches: TerrainPatch[]): void {
    this.releaseTerrain()
    for (const patch of patches) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(patch.positions, 3))
      geometry.setIndex(new THREE.BufferAttribute(patch.indices, 1))
      geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, this.terrainMaterial)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.terrain.add(mesh)
    }
    this.schedule()
  }

  /**
   * Point the camera and ask for a frame. `viewProjection` is current on return, so labels can be
   * placed straight away.
   */
  draw(frame: TerrainFrame): void {
    this.frame = frame
    this.placeCamera(frame)
    this.schedule()
  }

  private placeCamera({ pose, aboveGroundM }: TerrainFrame): void {
    const { camera, canvas } = this
    const [fx, fy, fz] = pose.forward
    const near = Math.max(0.5, Math.min(2_000, aboveGroundM * 0.1))
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    if (near !== this.lens.near || aspect !== this.lens.aspect) {
      this.lens = { near, aspect }
      camera.near = near
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      // The cascades are cut from the camera's view, so they follow its lens.
      this.csm.updateFrustums()
    }
    // Looking straight down, "up" on screen is north.
    if (Math.abs(fz) > 0.999) camera.up.set(0, 1, 0)
    else camera.up.set(0, 0, 1)
    camera.position.set(...pose.eye)
    camera.lookAt(pose.eye[0] + fx, pose.eye[1] + fy, pose.eye[2] + fz)
    camera.updateMatrixWorld()
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.viewProjection = Float32Array.from(m.elements)
  }

  private placeSky({ toSun, toEarth, pose, fromAbove }: TerrainFrame): void {
    const eye = new THREE.Vector3(...pose.eye)
    const place = (object: THREE.Object3D, direction: Vec3, radiusDeg: number) => {
      const unit = new THREE.Vector3(...direction).normalize()
      if (fromAbove) {
        // At the end of the sight line from the site, enlarged so it's visible from far away.
        object.position.copy(unit).multiplyScalar(RAY_LENGTH_M)
        const range = object.position.distanceTo(eye)
        object.scale.setScalar(range * MARKER_SCALE * Math.sqrt(radiusDeg / EARTH_RADIUS_DEG))
      } else {
        // True size and direction, seen from where the camera stands.
        object.position.copy(unit).multiplyScalar(SKY_DISTANCE_M).add(eye)
        object.scale.setScalar(SKY_DISTANCE_M * Math.tan((radiusDeg * Math.PI) / 180))
      }
    }
    place(this.sun, toSun, SUN_RADIUS_DEG)
    place(this.earth, toEarth, EARTH_RADIUS_DEG)
    this.earthUniforms.toSun.value.set(...toSun).normalize()
  }

  private schedule(): void {
    if (this.request !== null) return
    this.request = requestAnimationFrame(() => {
      this.request = null
      this.render()
    })
  }

  private render(): void {
    const { frame, canvas } = this
    if (!frame || this.lost || canvas.clientWidth === 0 || canvas.clientHeight === 0) return
    const size = this.renderer.getSize(new THREE.Vector2())
    if (size.x !== canvas.clientWidth || size.y !== canvas.clientHeight) {
      this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    }
    this.placeCamera(frame)
    this.csm.lightDirection.set(...frame.toSun).normalize().negate()
    this.csm.update()
    // Each cascade's texels are a different size, so each gets its own slope bias: enough to stop
    // low-Sun striping, small enough to keep the long grazing shadows that matter at the pole.
    for (const light of this.csm.lights) {
      const texelM = (light.shadow.camera.right - light.shadow.camera.left) / light.shadow.mapSize.x
      light.shadow.normalBias = Math.max(SHADOW_NORMAL_BIAS_M, SHADOW_NORMAL_BIAS_TEXELS * texelM)
    }
    this.placeSky(frame)
    this.renderer.render(this.scene, this.camera)
  }

  private releaseTerrain(): void {
    for (const child of this.terrain.children) {
      if (child instanceof THREE.Mesh) child.geometry.dispose()
    }
    this.terrain.clear()
  }

  /** Free the GPU memory now, rather than whenever the browser gets round to it. */
  dispose(): void {
    if (this.request !== null) cancelAnimationFrame(this.request)
    this.request = null
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored)
    this.releaseTerrain()
    this.csm.dispose()
    this.csm.remove()
    this.terrainMaterial.dispose()
    for (const item of this.disposables) item.dispose()
    this.renderer.dispose()
    // Only when the canvas has really gone: React's strict mode remounts onto the same canvas.
    if (!this.canvas.isConnected) this.renderer.forceContextLoss()
  }
}

/**
 * How many pixels the Sun's or Earth's disk spans (radius) on a canvas `heightPx` tall, so labels
 * can sit just above it. Matches the sizes `placeSky` draws.
 */
export function skyDiskRadiusPx(radiusDeg: number, fromAbove: boolean, heightPx: number): number {
  const tanRadius = fromAbove
    ? MARKER_SCALE * Math.sqrt(radiusDeg / EARTH_RADIUS_DEG)
    : Math.tan((radiusDeg * Math.PI) / 180)
  return (tanRadius / Math.tan((FOV_Y_DEG * Math.PI) / 360)) * (heightPx / 2)
}

/** A 1×1 texture of one color, until the real map arrives. */
function plainTexture(r: number, g: number, b: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** A soft round glow for the Sun, drawn once into a small canvas. */
function radialGlow(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.15, 'rgba(255,255,255,0.6)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
