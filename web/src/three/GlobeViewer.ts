import * as THREE from 'three'

import { meToScene } from './frames'
import { LIGHT_APPLY, LIGHT_SURFACE, LIGHT_UNIFORMS, type LightGridName, LightLayer, type LightLayerConfig, type LightMonthData, type LightView } from './lightLayer'

/** Where the viewer looks from, in plain numbers so callers never see Three.js types. */
export interface GlobeFrame {
  /** Latitude and longitude of the point at the middle of the view, in degrees (east positive). */
  view: { lat: number; lon: number }
  /** 1 fits the whole Moon in the box; larger magnifies around the middle. */
  zoom: number
  /** Unit vector toward the Sun in MOON_ME, from the pipeline, or null to light the globe evenly. */
  sun: readonly [number, number, number] | null
  /** Which way is up the screen, as a MOON_ME vector; north when left out. */
  up?: readonly [number, number, number]
  /**
   * Unit vector toward Earth in MOON_ME, from the pipeline. With it, and a Sun, the night side that
   * faces Earth is faintly lit by it (earthshine), more the fuller Earth is as seen from the Moon.
   */
  earth?: readonly [number, number, number] | null
  /** With a light grid: the hour on screen (from the start of its month) and what to color it by. */
  light?: { hour: number; view: LightView }
  /**
   * The part of the canvas that can be seen, as shares of its width and height from the top-left
   * corner. Nothing is drawn outside it, which matters when the canvas is larger than its window.
   */
  visible?: { left: number; top: number; right: number; bottom: number }
}

export interface GlobeViewerConfig {
  canvas: HTMLCanvasElement
  /** Our shaded relief (an equirectangular map centered on 0° E), drawn as soon as it arrives. */
  reliefUrl: string
  /** A small copy of the relief, a few dozen kB: drawn first, so the Moon shows at once, and replaced by the full one. */
  reliefFirstUrl?: string
  /** The Moon has been drawn for the first time (from whichever map arrived first). */
  onFirstDraw?: () => void
  /** Color maps, loaded in order, each replacing the last: a small one first, then a sharper one. */
  colorUrls: string[]
  /**
   * The sharpest color map, 8,192 pixels round the Moon, as a KTX2 file the graphics card keeps
   * compressed, and the folder holding three.js's transcoder for it. Fetched only when
   * `sharpenColor` asks, and only on a card that can hold it.
   */
  colorSharp?: { url: string; transcoderPath: string } | null
  /** The browser took the graphics context away. */
  onLost: () => void
  /** Terrain slopes to light the ground by, loaded last. Without them the globe is lit as a smooth ball. */
  slopes?: SlopeMaps | null
  /** The pipeline's per-pixel Sun and Earth visibility near the south pole, drawn over the polar map. */
  light?: LightLayerConfig | null
}

/**
 * A picture laid over the ground around the south pole, such as a Moon Trek layer: a square in polar
 * stereographic with the pole in the middle, 0° E up and 90° E to the right.
 */
export interface GlobeOverlay {
  image: HTMLCanvasElement
  /** From the pole to the middle of the square's side, and the Moon's radius the map is drawn for, in meters. */
  halfWidthM: number
  radiusM: number
  /** The picture as it is; one color wherever the picture has anything; or one color, as bright as the picture. */
  paint: 'picture' | 'mask' | 'ramp'
  /** That color, 0 to 1 (display values). */
  tint?: readonly [number, number, number]
  /** How much of the Moon underneath it hides, 0 to 1. */
  opacity: number
}

/** One of a shade's pictures: two moments of it and how far between them the Moon is, 0 (the first) to 1 (the second). */
export interface ShadeBlend<Picture> {
  from: Picture
  to: Picture
  mix: number
}

/**
 * A shade over the whole Moon (`setShade`): a transparent picture drawn over it, apart from the
 * Moon's own shader, which has no texture to spare. Any layer shows through it. Each picture is
 * given at two moments and blended between them, so a shade that changes with time moves smoothly
 * from pictures worked out some hours apart.
 */
export interface GlobeShade {
  /** The whole Moon, laid out like a map of the world: longitude across from 180° W, latitude down from the north pole. */
  wash: ShadeBlend<HTMLCanvasElement>
  /**
   * A finer picture of the ground round the south pole, shown in the wash's place as far as it
   * reaches: laid out as a `GlobeOverlay` is. Null for none.
   */
  polar: (ShadeBlend<HTMLCanvasElement> & { halfWidthM: number; radiusM: number }) | null
  /** How much of the Moon the shade hides, 0 to 1. */
  opacity: number
}

const SHADE_VERTEX = /* glsl */ `
varying vec2 vShadeUv;
varying vec3 vShadeView;
void main() {
  // SphereGeometry puts 0° E at u = 0.25; the wash has it in the middle (u = 0.5).
  vShadeUv = uv + vec2(0.25, 0.0);
  vec4 seen = modelViewMatrix * vec4(position, 1.0);
  vShadeView = seen.xyz;
  gl_Position = projectionMatrix * seen;
}
`

const SHADE_FRAGMENT = /* glsl */ `
uniform sampler2D washFrom;
uniform sampler2D washTo;
uniform float washBlend;
uniform sampler2D polarFrom;
uniform sampler2D polarTo;
uniform float polarBlend;
uniform float polarOn;
uniform float polarSize; // Moon radius / the polar picture's full width on the ground
uniform float shadeMix;
varying vec2 vShadeUv;
varying vec3 vShadeView;
void main() {
  vec4 shade = mix(texture2D(washFrom, vShadeUv), texture2D(washTo, vShadeUv), washBlend);
  // The polar picture's place, as the Moon's own shader finds a layer's: from where the pixel is on
  // screen, polar stereographic from the south pole, with 90° E to the right and 0° E up.
  vec2 disk = vShadeView.xy;
  vec3 up = normalize((vec4(disk, sqrt(max(1.0 - dot(disk, disk), 0.0)), 0.0) * viewMatrix).xyz).zxy;
  vec2 ground = 2.0 * up.xy / max(1.0 - up.z, 1.0);
  vec2 at = 0.5 + (ground * polarSize).yx;
  // The polar picture is shown as a disc that gives way to the wash over its outer third, so its
  // square never shows.
  float fade = smoothstep(1.0, 0.66, 2.0 * length(at - 0.5));
  vec2 inside = clamp(at, 0.0, 1.0);
  vec4 polar = mix(texture2D(polarFrom, inside), texture2D(polarTo, inside), polarBlend);
  shade = mix(shade, polar, polarOn * fade * step(up.z, 0.0) * polar.a);
  gl_FragColor = vec4(shade.rgb, shade.a * shadeMix);
  #include <colorspace_fragment>
}
`
/**
 * A photo of the ground in view, for the Moon's own picture to get sharper from (`setGroundDetail`):
 * laid on the Moon as a square round the south pole (as a `GlobeOverlayDetail` is) or as a rectangle
 * of longitude and latitude, north up.
 */
export interface GroundDetail {
  image: HTMLCanvasElement
  place:
    | { kind: 'polar'; centreXM: number; centreYM: number; halfWidthM: number; halfHeightM: number; radiusM: number }
    | { kind: 'lonLat'; lonDeg: number; latDeg: number; halfLonDeg: number; halfLatDeg: number }
  /** Meters of ground in one of its pixels. */
  metresPerPixel: number
}

/**
 * A sharper picture of part of the same ground, shown in a `GlobeOverlay`'s place: the ground in
 * view, at the detail the zoom needs. Same projection; its own middle and size. It must cover the
 * view, since outside it nothing of the overlay is drawn.
 */
export interface GlobeOverlayDetail {
  image: HTMLCanvasElement
  /** The picture's middle on the map (x toward 90° E, y toward 0° E) and its half width and half height, in meters. */
  centreXM: number
  centreYM: number
  halfWidthM: number
  halfHeightM: number
  radiusM: number
}

/** The terrain-slope images and how to read them, from the pipeline's `slopes.json`. */
export interface SlopeMaps {
  /** East and north slopes of the whole Moon, laid out like the color map. */
  moon: [string, string]
  /** Slopes along the south-polar map's own x and y. */
  pole: [string, string]
  /**
   * Smaller copies of the two pairs, enough for the whole Moon on screen. Where given they are what
   * loads at first, and the full ones load only when `sharpenTerrain` asks for them.
   */
  moonFirst?: [string, string]
  poleFirst?: [string, string]
  /** The steepest slope the images can hold (rise over run). */
  slopeMax: number
  /** Half the polar map's width, and the Moon's radius, in meters. */
  poleHalfWidthM: number
  radiusM: number
  /** The east longitudes the polar map's x and y point toward, in degrees. */
  poleXLonDeg: number
  poleYLonDeg: number
}

const MAX_PIXEL_RATIO = 2
/**
 * Easing the drawing resolution while the view moves, on a machine that cannot keep up. After each
 * frame drawn in a run, the time to the screen's next refresh is noted; when the middle value of 20
 * of them is over EASE_SLOW_MS (a 60 Hz screen missing refreshes), moving frames are drawn with a
 * quarter fewer pixels each way, down to EASE_FLOOR device pixels per CSS pixel. A still picture is
 * always redrawn at full resolution, STILL_AFTER_MS after the last frame. Resolution comes back a
 * step after EASE_GOOD_WINDOWS quick windows in a row, and no sooner than EASE_RETRY_MS after it
 * last went down, so a machine on the edge does not flip back and forth.
 */
const EASE_SLOW_MS = 24
const EASE_QUICK_MS = 18
const EASE_WINDOW = 20
const EASE_STEP = 0.75
const EASE_FLOOR = 0.75
const EASE_GOOD_WINDOWS = 15
const EASE_RETRY_MS = 20_000
/** Frames closer together than this are one run of movement. */
const RUN_GAP_MS = 100
const STILL_AFTER_MS = 300
const SUN_INTENSITY = 1.2 * Math.PI
/** What's left on the night side (linear light, about the old 22% of display brightness), so its ground stays readable. */
const NIGHT_INTENSITY = 0.14
/**
 * Earthshine at its strongest (a full Earth straight overhead), as light on the ground beside the
 * night side's own NIGHT_INTENSITY. A look, not a measurement: real earthshine is about ten
 * thousand times fainter than sunlight, which no screen could show beside it.
 */
const EARTHSHINE = 0.5
/** With no Sun, the whole globe is evenly lit. */
const EVEN_INTENSITY = Math.PI
const CAMERA_DISTANCE = 5
/**
 * Seconds a newly arrived map takes to blend in. Switching in one frame made the whole Moon's
 * shading jump mid time-lapse when the terrain slopes finished downloading.
 */
const FADE_S = 1.5
/** The longest step one frame may take in a fade, so a slow frame doesn't snap it. */
const MAX_FADE_FRAME_S = 0.05
/** About what one pixel of the globe's own color map covers, in meters: where the ground's detail takes over from it. */
const BASE_M_PER_PX = 1300
/** How long a sharper picture takes to come into focus after replacing a softer one, and the most sizes down it may start. */
const FOCUS_S = 0.5
const MAX_SOFT = 6

const SURFACE_UNIFORMS = /* glsl */ `
varying vec2 vSurfaceUv;
varying vec3 vMoonNormal;
uniform sampler2D reliefMap;
uniform sampler2D colorMap;
uniform float colorMix;
// Terrain slopes from LOLA: how steeply the ground rises toward the east and the north (whole
// Moon), and along the two axes of the south-polar map. Mid-gray is level; slopeMax is the steepest stored.
uniform sampler2D slopeE;
uniform sampler2D slopeN;
uniform sampler2D poleX;
uniform sampler2D poleY;
uniform float terrainMix; // 1 once the whole-Moon slopes have loaded and there is a Sun
uniform float poleMix;    // 1 once the polar slopes have loaded
uniform float slopeMax;
uniform float poleScale;  // Moon radius / the polar map's full width
uniform vec2 poleAxisX;   // the direction, in MOON_ME x and y, that the polar map's x points along
uniform vec2 poleAxisY;
uniform float reliefGain; // seen whole, relief is exaggerated a little so craters read; close up it is true
// Earthshine: sunlight off Earth onto the Moon's night side. The direction to Earth in MOON_ME, and
// how strong it is now (0 with no Earth or no Sun; it grows as Earth, seen from the Moon, nears full).
uniform vec3 earthDir;
uniform float earthShine;
// A picture from outside (a Moon Trek layer) laid over the ground around the south pole.
uniform sampler2D overlayMap;
// A sharper picture that has just replaced a softer one is read that many sizes down at first, which
// is the softer one's own sharpness, and comes into focus from there: it never snaps. One each for
// the relief, the color map and a layer's picture.
uniform float reliefSoft;
uniform float colorSoft;
uniform float overlaySoft;
uniform float overlayKind;   // how the picture is laid on the Moon: 0 a square round the south pole, 1 a rectangle of longitude and latitude
uniform float overlayAs;     // 0 a map, shown as it is; 1 the ground's own grain, on the base map's tone and lit by the hour's Sun
uniform float overlayLow;    // for the grain: how many sizes down the picture's own broad tone is read
uniform float overlayMix;   // fades toward how much of the Moon the layer hides, or 0 with no layer
uniform vec2 overlayCentre; // the picture's middle on the map, in Moon radii (x toward 0° E, y toward 90° E)
uniform vec2 overlaySize;   // Moon radius / the picture's full size on the ground, along those two axes
uniform float overlayPaint; // 0 the picture as it is, 1 one color where it has anything, 2 one color as bright as it
uniform vec3 overlayTint;
float moonSlope(sampler2D map, vec2 uv) {
  return (texture2D(map, uv).r * 255.0 - 128.0) / 127.0 * slopeMax;
}
`

// NASA's color, textured and lit by the ground's own shape.
//  - Until the slope maps arrive: our baked relief gives the color its texture, as before.
//  - With them: each pixel's surface is tilted by the real LOLA slope there, so sunlight picks out
//    crater walls and ridges and moves across them with the hour. This is slope shading: it does
//    not cast one hill's shadow onto another.
//  - Within about 9 degrees of the south pole the whole-Moon maps run out of pixels (a flat map
//    squeezes the pole into one row), so a polar map takes over there.
const SURFACE_FRAGMENT = /* glsl */ `
float relief = texture2D(reliefMap, vSurfaceUv, reliefSoft).r;
// MOON_ME from scene axes (see frames.ts): x toward 0 E, y toward 90 E, z north.
vec3 moonUp = normalize(vMoonNormal).zxy;
#ifdef LIGHT_GRID
  // Close up, the mesh's flat faces sit hundreds of meters off the sphere. Seen from far away
  // (orthographic), a pixel's place on the true sphere follows from where it is on screen.
  vec2 onDisk = -vViewPosition.xy;
  moonUp = normalize((vec4(onDisk, sqrt(max(1.0 - dot(onDisk, onDisk), 0.0)), 0.0) * viewMatrix).xyz).zxy;
#endif
float moonLat = asin(clamp(moonUp.z, -1.0, 1.0));
float moonLon = atan(moonUp.y, moonUp.x);
vec3 moonEast = vec3(-sin(moonLon), cos(moonLon), 0.0);
vec3 moonNorth = cross(moonUp, moonEast);

// The polar map is a flat picture of the ground around the pole: its coordinates are distances from the pole.
#ifdef LIGHT_GRID
  // The same point as below, without going through an angle that loses precision right at the pole.
  vec2 polarGround = 2.0 * moonUp.xy / max(1.0 - moonUp.z, 1.8);
#else
  float fromPole = min(1.5707963 + moonLat, 0.5);
  vec2 polarGround = 2.0 * tan(fromPole * 0.5) * vec2(cos(moonLon), sin(moonLon));
#endif
vec2 poleUv = vec2(0.5 + dot(polarGround, poleAxisX) * poleScale, 0.5 + dot(polarGround, poleAxisY) * poleScale);
float inPolarMap = step(abs(poleUv.x - 0.5), 0.49) * step(abs(poleUv.y - 0.5), 0.49);
// Fades in between 80.5 and 81.6 degrees south.
float cap = poleMix * inPolarMap * (1.0 - smoothstep(-1.425, -1.405, moonLat));

// Which way the ground tilts, as a vector along the surface.
vec3 tilt = moonSlope(slopeE, vSurfaceUv) * moonEast + moonSlope(slopeN, vSurfaceUv) * moonNorth;
vec3 poleTilt = moonSlope(poleX, poleUv) * vec3(poleAxisX, 0.0) + moonSlope(poleY, poleUv) * vec3(poleAxisY, 0.0);
poleTilt -= dot(poleTilt, moonUp) * moonUp;
tilt = mix(tilt, poleTilt, cap);
vec3 tilted = normalize(moonUp - tilt * reliefGain * terrainMix);
vec3 terrainNormal = normalize((viewMatrix * vec4(tilted.yzx, 0.0)).xyz);

// The smooth sphere decides day from night, so a slope past the day-night line can't catch light.
float sunSide = 1.0;
#if NUM_DIR_LIGHTS > 0
  sunSide = mix(1.0, smoothstep(-0.03, 0.02, dot(normalize(vNormal), directionalLights[0].direction)), terrainMix);
#endif
// Ground the Sun doesn't reach keeps a fixed soft shading so it still reads; sunlit ground is lit for real.
float baked = 0.55 + 0.9 * relief;
float soft = 1.0 - 2.2 * clamp(dot(tilt, normalize(moonEast + moonNorth)), -0.36, 0.36);
float shading = mix(mix(baked, soft, cap), 1.05, terrainMix * sunSide);
// At the pole the color map is a smear: plain regolith gray instead.
vec3 tint = mix(texture2D(colorMap, vSurfaceUv, colorSoft).rgb, vec3(0.36, 0.35, 0.335), cap);
vec3 surface = mix(vec3(mix(relief, 0.5 * soft, cap)), tint * shading, colorMix);
diffuseColor.rgb *= surface;
// The overlay's place in its picture: polar stereographic from the south pole, straight from the
// direction (no angle, so it stays exact at the pole), with 90° E to the right and 0° E up.
// Close up, the mesh's flat faces sit hundreds of meters off the sphere, so the place on the true
// sphere is worked out from where the pixel is on screen (the view is from far away, orthographic).
vec2 overlayDisk = -vViewPosition.xy;
vec3 overlayUp = normalize((vec4(overlayDisk, sqrt(max(1.0 - dot(overlayDisk, overlayDisk), 0.0)), 0.0) * viewMatrix).xyz).zxy;
vec2 overlayGround = 2.0 * overlayUp.xy / max(1.0 - overlayUp.z, 1.0);
vec2 overlayUv = 0.5 + ((overlayGround - overlayCentre) * overlaySize).yx;
float overlayIn = step(abs(overlayUv.x - 0.5), 0.5) * step(abs(overlayUv.y - 0.5), 0.5) * step(overlayUp.z, 0.0);
if (overlayKind > 0.5) {
  // A rectangle of longitude and latitude, north up: overlayCentre is its middle (radians) and
  // overlaySize one over its full width and height. The longitude is taken the short way round.
  float overlayLon = atan(overlayUp.y, overlayUp.x) - overlayCentre.x;
  overlayLon -= 6.2831853 * floor(overlayLon / 6.2831853 + 0.5);
  overlayUv = vec2(0.5 + overlayLon * overlaySize.x, 0.5 + (asin(clamp(overlayUp.z, -1.0, 1.0)) - overlayCentre.y) * overlaySize.y);
  overlayIn = step(abs(overlayUv.x - 0.5), 0.5) * step(abs(overlayUv.y - 0.5), 0.5);
}
vec4 overlayTexel = texture2D(overlayMap, overlayUv, overlaySoft);
vec3 overlayColor = overlayPaint < 0.5 ? overlayTexel.rgb : overlayPaint < 1.5 ? overlayTint : overlayTint * overlayTexel.r;
float overlayAmount = overlayMix * overlayTexel.a * overlayIn;
if (overlayAs > 0.5) {
  // The ground's own grain: the photo divided by its own broad tone, multiplied onto the base map.
  // So the ground keeps the base map's shade and the hour's light, and only gets sharper; a photo
  // read soft (overlaySoft, as it arrives) is its own broad tone, which changes nothing.
  vec4 overlayBroad = textureLod(overlayMap, overlayUv, overlayLow);
  float grain = dot(overlayTexel.rgb, vec3(0.3333)) / max(overlayTexel.a, 0.05);
  float tone = dot(overlayBroad.rgb, vec3(0.3333)) / max(overlayBroad.a, 0.05);
  diffuseColor.rgb *= mix(1.0, clamp(grain / max(tone, 0.004), 0.3, 3.0), overlayAmount);
  overlayAmount = 0.0;
}
#ifdef LIGHT_GRID
${LIGHT_SURFACE}
#endif
`

const TERRAIN_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
normal = terrainNormal;
`

// The Moon's dust doesn't darken toward the terminator the way a matte (Lambert) ball does: it scatters
// close to Lommel-Seeliger, so the lit side stays evenly bright and the terminator is sharp. This turns
// Three.js's Lambert sunlight into Lommel-Seeliger (equal to it where the Sun and camera line up).
const LUNAR_SCATTER = /* glsl */ `
#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  float sunCos = max(dot(geometryNormal, directionalLights[0].direction), 0.0);
  float viewCos = max(dot(geometryNormal, geometryViewDir), 0.0);
  reflectedLight.directDiffuse *= sunSide * 2.0 / max(sunCos + viewCos, 0.05);
#endif
#ifdef LIGHT_GRID
${LIGHT_APPLY}
#endif
#if NUM_DIR_LIGHTS > 0
  // Earthshine on ground the Sun doesn't reach and Earth can see: faint, a little blue, strongest
  // where Earth stands high. Left off the ground the light grid has computed, which shows the Sun alone.
  float nightSide = 1.0 - smoothstep(-0.03, 0.02, dot(normalize(vNormal), directionalLights[0].direction));
  float towardEarth = max(dot(moonUp, earthDir), 0.0);
  float shine = earthShine * nightSide * towardEarth;
  #ifdef LIGHT_GRID
    shine *= 1.0 - gridMix;
  #endif
  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.62, 0.76, 1.0) * shine;
#endif
// A layer is shown as it is, not lit by the hour's Sun: it is a map, and must read the same at any time.
reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, overlayColor, overlayAmount);
reflectedLight.indirectDiffuse *= 1.0 - overlayAmount;
reflectedLight.directSpecular *= 1.0 - overlayAmount;
reflectedLight.indirectSpecular *= 1.0 - overlayAmount;
`

/**
 * The whole Moon as a Three.js globe, seen from far away (orthographic, so it matches the label and
 * picking math in lib/globe.ts) and lit by the Sun direction our pipeline computed for that hour.
 * It draws only when asked, at most once per screen refresh.
 */
export class GlobeViewer {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY)
  private readonly ambient = new THREE.AmbientLight(0xffffff, NIGHT_INTENSITY)
  private readonly geometry = new THREE.SphereGeometry(1, 192, 96)
  /** The shade over the Moon, made the first time one is given. */
  private shade: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; textures: Map<HTMLCanvasElement, THREE.Texture> } | null = null
  private readonly material: THREE.MeshStandardMaterial
  private readonly uniforms = {
    reliefMap: { value: placeholderTexture() as THREE.Texture },
    colorMap: { value: placeholderTexture() as THREE.Texture },
    colorMix: { value: 0 },
    slopeE: { value: placeholderTexture() as THREE.Texture },
    slopeN: { value: placeholderTexture() as THREE.Texture },
    poleX: { value: placeholderTexture() as THREE.Texture },
    poleY: { value: placeholderTexture() as THREE.Texture },
    terrainMix: { value: 0 },
    poleMix: { value: 0 },
    slopeMax: { value: 1 },
    poleScale: { value: 1 },
    poleAxisX: { value: new THREE.Vector2(0, 1) },
    poleAxisY: { value: new THREE.Vector2(1, 0) },
    reliefGain: { value: 1 },
    earthDir: { value: new THREE.Vector3(1, 0, 0) },
    earthShine: { value: 0 },
    overlayMap: { value: placeholderTexture() as THREE.Texture },
    overlayMix: { value: 0 },
    reliefSoft: { value: 0 },
    colorSoft: { value: 0 },
    overlaySoft: { value: 0 },
    overlayKind: { value: 0 },
    overlayAs: { value: 0 },
    overlayLow: { value: 0 },
    overlayCentre: { value: new THREE.Vector2(0, 0) },
    overlaySize: { value: new THREE.Vector2(1, 1) },
    overlayPaint: { value: 0 },
    overlayTint: { value: new THREE.Color(1, 1, 1) },
  }
  /**
   * The overlay's own picture, kept while a close-up of the ground in view stands in for it: the
   * shader has one place for the two, since they show the same ground and a graphics card has only
   * so many textures to give.
   */
  private overlayWhole: { texture: THREE.Texture; halfWidthM: number; radiusM: number } | null = null
  private overlayClose: THREE.Texture | null = null
  /** The ground's own detail on show (`setGroundDetail`), with the ground one of its pixels covers; and one waiting for a layer to leave. */
  private ground: THREE.Texture | null = null
  private groundMPerPx = 0
  private groundNext: GroundDetail | null | undefined = undefined
  /** Where overlayMix fades toward: the layer's opacity, or 0 with none. */
  private overlayTarget = 0
  /** How many of the two whole-Moon slope maps, and the two polar ones, have arrived. */
  private moonSlopes = 0
  private poleSlopes = 0
  private readonly light: LightLayer | null
  private readonly onLost: () => void
  private frame: GlobeFrame | null = null
  private request: number | null = null
  private hasRelief = false
  private disposed = false
  /** Where colorMix fades toward: 1 once a color map has arrived. */
  private colorTarget = 0
  private lastRender: number | null = null
  /** Maps asked for that have not arrived yet, and whether the opening run of maps is still going. */
  private pending = 0
  private opening = true
  private onFirstDraw: (() => void) | undefined
  private drawnOnce = false
  private slopes: SlopeMaps | null = null
  /** Which of the full-size slope pairs have been asked for (they wait for `sharpenTerrain` when smaller copies exist). */
  private sharp = { moon: false, pole: false }
  /** The light grid's own slope maps: megabytes that are fetched only once a month of the grid is shown. */
  private lightSlopeUrls: [string, string] | null = null
  private colorSharp: { url: string; transcoderPath: string } | null = null
  /** The softness each of the three pictures started its focus from, which sets how fast it sharpens: every swap takes FOCUS_S. */
  private softFrom = { reliefSoft: 0, colorSoft: 0, overlaySoft: 0 }
  /** A layer, and its close-up if one came, waiting for the layer on show to fade out. */
  private overlayNext: GlobeOverlay | null = null
  private detailNext: GlobeOverlayDetail | null | undefined = undefined
  /** The ground each pixel of the layer's picture on show covers, in meters: what a close-up is compared with. */
  private overlayMPerPx = 0
  /** How far the Moon is lit by the Sun (1) rather than evenly (0): it fades between the two. */
  private sunMix = { value: 0 }
  /** Device pixels per CSS pixel: for a still picture, and for frames in a run of movement (eased on a slow machine). */
  private fullRatio = 1
  private movingRatio = 1
  /** When the last frame was drawn, by the screen's clock; null once the view has come to rest. */
  private lastFrameAt: number | null = null
  private refreshGaps: number[] = []
  private quickWindows = 0
  private easedAt = Number.NEGATIVE_INFINITY
  private probe: number | null = null
  private stillTimer: number | null = null
  private colorSharpAsked: Promise<number> | null = null
  /** How sharp the color map in use is: its place in `colorUrls`, or above them all for the 8K one. A map never replaces a sharper one. */
  private colorRank = -1

  constructor({ canvas, reliefUrl, reliefFirstUrl, colorUrls, colorSharp = null, onLost, onFirstDraw, slopes = null, light = null }: GlobeViewerConfig) {
    this.canvas = canvas
    this.colorSharp = colorSharp
    this.onLost = onLost
    this.light = light ? new LightLayer(light) : null
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.fullRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    this.movingRatio = this.fullRatio
    this.setRatio(this.fullRatio)
    canvas.addEventListener('webglcontextlost', this.handleLost)

    this.material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    // Only a globe given a light grid compiles the grid's code; the others' shader is unchanged.
    if (this.light) this.material.defines = { ...this.material.defines, LIGHT_GRID: '' }
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, this.light?.uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSurfaceUv;\nvarying vec3 vMoonNormal;')
        // SphereGeometry puts 0° E at u = 0.25; our maps have it in the middle (u = 0.5).
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSurfaceUv = uv + vec2(0.25, 0.0);\nvMoonNormal = normal;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SURFACE_UNIFORMS}${this.light ? LIGHT_UNIFORMS : ''}`)
        .replace('#include <map_fragment>', SURFACE_FRAGMENT)
        .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL)
        .replace('#include <lights_fragment_end>', LUNAR_SCATTER)
    }
    this.scene.add(new THREE.Mesh(this.geometry, this.material), this.sunLight, this.ambient)
    this.camera.up.set(0, 1, 0)

    this.onFirstDraw = onFirstDraw
    this.slopes = slopes
    this.lightSlopeUrls = light?.slopeUrls ?? null
    void this.loadMaps(reliefUrl, reliefFirstUrl, colorUrls)
  }

  /** One map, as a promise. It never settles once the viewer is gone, which ends whatever was waiting on it. */
  private fetchTexture(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture> {
    return new Promise((resolve) => this.loadTexture(url, colorSpace, resolve))
  }

  /**
   * The maps, in the order that puts a Moon on screen soonest and sharpens it from there: a small
   * relief, a small color, then the full relief, the color maps and the terrain slopes. Each replaces
   * the one before it in place, so nothing flashes.
   */
  private async loadMaps(reliefUrl: string, reliefFirstUrl: string | undefined, colorUrls: string[]): Promise<void> {
    const setRelief = (texture: THREE.Texture) => {
      if (this.hasRelief) this.soften('reliefSoft', widthOf(this.uniforms.reliefMap.value), widthOf(texture))
      this.uniforms.reliefMap.value.dispose()
      this.uniforms.reliefMap.value = texture
      this.hasRelief = true
    }
    const setColor = (texture: THREE.Texture, rank: number) => this.setColor(texture, rank)
    setRelief(await this.fetchTexture(reliefFirstUrl ?? reliefUrl, THREE.NoColorSpace))
    if (colorUrls[0]) setColor(await this.fetchTexture(colorUrls[0], THREE.SRGBColorSpace), 0)
    if (reliefFirstUrl) setRelief(await this.fetchTexture(reliefUrl, THREE.NoColorSpace))
    if (colorUrls[1]) setColor(await this.fetchTexture(colorUrls[1], THREE.SRGBColorSpace), 1)
    // The terrain before the sharpest color: lit relief changes the picture more than extra pixels do.
    const slopes = this.slopes
    if (slopes) {
      const rad = Math.PI / 180
      this.uniforms.slopeMax.value = slopes.slopeMax
      this.uniforms.poleScale.value = slopes.radiusM / (2 * slopes.poleHalfWidthM)
      this.uniforms.poleAxisX.value.set(Math.cos(slopes.poleXLonDeg * rad), Math.sin(slopes.poleXLonDeg * rad))
      this.uniforms.poleAxisY.value.set(Math.cos(slopes.poleYLonDeg * rad), Math.sin(slopes.poleYLonDeg * rad))
      if (!slopes.moonFirst) this.sharp.moon = true
      if (!slopes.poleFirst) this.sharp.pole = true
      await Promise.all([this.loadSlopePair('moon', slopes.moonFirst ?? slopes.moon), this.loadSlopePair('pole', slopes.poleFirst ?? slopes.pole)])
    }
    for (const [i, url] of colorUrls.slice(2).entries()) setColor(await this.fetchTexture(url, THREE.SRGBColorSpace), i + 2)
    this.opening = false
  }

  /**
   * A picture `to` pixels wide is about to replace one `from` pixels wide that shows the same ground:
   * start it as soft as the old one (each halving of size is one step down its own smaller copies)
   * and let `render` bring it into focus. Added to any softness still left from the swap before.
   */
  private soften(which: 'reliefSoft' | 'colorSoft' | 'overlaySoft', from: number, to: number): void {
    if (!(from > 0) || !(to > from)) return
    const soft = Math.min(this.uniforms[which].value + Math.log2(to / from), MAX_SOFT)
    this.uniforms[which].value = soft
    this.softFrom[which] = soft
  }

  /** A color map into use, unless a sharper one is already there. */
  private setColor(texture: THREE.Texture, rank: number): void {
    if (rank < this.colorRank) {
      texture.dispose()
      return
    }
    if (this.colorRank >= 0) this.soften('colorSoft', widthOf(this.uniforms.colorMap.value), widthOf(texture))
    this.colorRank = rank
    this.uniforms.colorMap.value.dispose()
    this.uniforms.colorMap.value = texture
    this.colorTarget = 1
    this.schedule()
  }

  /**
   * Ask for the 8K color map, for when the view is closer than the 4K one can show. Its size on the
   * graphics card in bytes once it is in use; 0 where it is not to be had: no such map, a card whose
   * textures stop short of 8,192 pixels, or one that cannot keep it compressed (as plain pixels it
   * would take four times the memory, so those stay on 4K). Asking again gives the same answer and
   * fetches nothing more.
   */
  sharpenColor(): Promise<number> {
    this.colorSharpAsked ??= this.loadColorSharp()
    return this.colorSharpAsked
  }

  private async loadColorSharp(): Promise<number> {
    const sharp = this.colorSharp
    if (this.disposed || !sharp) return 0
    const has = (name: string) => this.renderer.extensions.has(name)
    // ASTC (phones, Apple) or BC7 (desktop cards): the two formats that hold this map without smearing it.
    if (this.renderer.capabilities.maxTextureSize < 8192 || !(has('WEBGL_compressed_texture_astc') || has('EXT_texture_compression_bptc'))) return 0
    this.pending += 1
    // The loader and its transcoder are code only this map needs: fetched with it, not with the globe.
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js')
    const loader = new KTX2Loader().setTranscoderPath(sharp.transcoderPath).detectSupport(this.renderer)
    try {
      const texture = await loader.loadAsync(sharp.url)
      if (this.disposed) {
        texture.dispose()
        return 0
      }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      // Every size of the map, as the card keeps it.
      const bytes = texture.mipmaps.reduce((sum, level) => sum + ((level.data as ArrayBufferView | null)?.byteLength ?? 0), 0)
      this.renderer.initTexture(texture)
      this.setColor(texture, Number.POSITIVE_INFINITY)
      return bytes
    } catch {
      // The 4K map stays: a missing or unreadable file is not worth losing the globe over.
      return 0
    } finally {
      loader.dispose()
      this.pending -= 1
      this.schedule()
    }
  }

  /** Two slope maps into their places: the whole Moon's east and north, or the polar map's x and y. */
  private async loadSlopePair(which: 'moon' | 'pole', urls: [string, string]): Promise<void> {
    const slots = which === 'moon' ? [this.uniforms.slopeE, this.uniforms.slopeN] : [this.uniforms.poleX, this.uniforms.poleY]
    const textures = await Promise.all(urls.map((url) => this.fetchTexture(url, THREE.NoColorSpace)))
    textures.forEach((texture, i) => {
      // One value per pixel, not four: these are measurements, not pictures.
      texture.format = THREE.RedFormat
      // The polar map has edges; the whole-Moon maps wrap around in longitude.
      if (which === 'pole') texture.wrapS = THREE.ClampToEdgeWrapping
      slots[i].value.dispose()
      slots[i].value = texture
    })
    if (which === 'moon') this.moonSlopes = 2
    else this.poleSlopes = 2
    this.schedule()
  }

  /**
   * Ask for the full-size slopes of the whole Moon or of the polar map, where the viewer started with
   * smaller copies: for when the view is close enough for the difference to show. Asking again does nothing.
   */
  sharpenTerrain(which: 'moon' | 'pole'): void {
    if (this.disposed || !this.slopes || this.sharp[which]) return
    this.sharp[which] = true
    void this.loadSlopePair(which, which === 'moon' ? this.slopes.moon : this.slopes.pole)
  }

  private readonly handleLost = () => {
    // Three.js keeps the context restorable; the page swaps in its flat map either way.
    this.dispose()
    this.onLost()
  }

  /**
   * Maps are decoded off the main thread (createImageBitmap) where the browser can, so a 4K map
   * arriving mid-animation doesn't stall the time-lapse; otherwise an ordinary image load.
   */
  private loadTexture(url: string, colorSpace: THREE.ColorSpace, onLoad: (texture: THREE.Texture) => void): void {
    this.pending += 1
    const ready = (texture: THREE.Texture) => {
      if (this.disposed) {
        texture.dispose()
        return
      }
      texture.colorSpace = colorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      // Upload now, on its own frame, rather than in the frame that starts using it.
      this.renderer.initTexture(texture)
      onLoad(texture)
      this.pending -= 1
      this.schedule()
    }
    if (typeof createImageBitmap === 'function') {
      const loader = new THREE.ImageBitmapLoader()
      // An ImageBitmap can't be flipped at upload, so it's decoded the right way up instead.
      loader.setOptions({ imageOrientation: 'flipY' })
      loader.load(url, (bitmap) => {
        const texture = new THREE.Texture(bitmap)
        texture.flipY = false
        texture.needsUpdate = true
        texture.addEventListener('dispose', () => bitmap.close())
        ready(texture)
      })
    } else {
      new THREE.TextureLoader().load(url, ready)
    }
  }

  /** Put a month of one of the light grids on the GPU (null takes it away). Only for a globe built with `light`. */
  setLightMonth(month: LightMonthData | null, grid: LightGridName = 'fine'): void {
    if (this.disposed) return
    this.light?.setMonth(month, grid)
    // The grid's own slope maps are megabytes: fetched with the first month, not with the page.
    if (month && this.light && this.lightSlopeUrls) {
      const urls = this.lightSlopeUrls
      this.lightSlopeUrls = null
      urls.forEach((url, i) => this.loadTexture(url, THREE.NoColorSpace, (texture) => this.light?.setSlope(i === 0 ? 0 : 1, texture)))
    }
    this.schedule()
  }

  /**
   * Shade the whole Moon, or take the shade away (null). It is drawn over the Moon as it is, not
   * lit by the hour's Sun, and any layer shows through it. A picture already given is not sent to
   * the graphics card again: a shade whose pictures are the same and only blended differently
   * costs nothing to set.
   */
  setShade(shade: GlobeShade | null): void {
    if (this.disposed) return
    if (!shade) {
      if (this.shade) this.shade.mesh.visible = false
      this.schedule()
      return
    }
    if (!this.shade) {
      const none = () => ({ value: null as THREE.Texture | null })
      const material = new THREE.ShaderMaterial({
        uniforms: { washFrom: none(), washTo: none(), washBlend: { value: 0 }, polarFrom: none(), polarTo: none(), polarBlend: { value: 0 }, polarOn: { value: 0 }, polarSize: { value: 1 }, shadeMix: { value: 0 } },
        vertexShader: SHADE_VERTEX,
        fragmentShader: SHADE_FRAGMENT,
        transparent: true,
        // The same sphere as the Moon, drawn after it: the far side is culled, so depth has nothing to add.
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(this.geometry, material)
      mesh.renderOrder = 1
      this.scene.add(mesh)
      this.shade = { mesh, material, textures: new Map() }
    }
    const { mesh, material, textures } = this.shade
    const wanted = new Set<HTMLCanvasElement>([shade.wash.from, shade.wash.to, ...(shade.polar ? [shade.polar.from, shade.polar.to] : [])])
    for (const [image, texture] of textures) {
      if (wanted.has(image)) continue
      texture.dispose()
      textures.delete(image)
    }
    const textureOf = (image: HTMLCanvasElement, wraps: boolean) => {
      const made = textures.get(image)
      if (made) return made
      const texture = new THREE.CanvasTexture(image)
      texture.colorSpace = THREE.SRGBColorSpace
      // Round the back of the Moon the wash's two ends meet. No smaller copies of it: they would show that seam as a line.
      texture.wrapS = wraps ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      if (wraps) {
        texture.generateMipmaps = false
        texture.minFilter = THREE.LinearFilter
      } else texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      textures.set(image, texture)
      return texture
    }
    material.uniforms.washFrom.value = textureOf(shade.wash.from, true)
    material.uniforms.washTo.value = textureOf(shade.wash.to, true)
    material.uniforms.washBlend.value = shade.wash.mix
    material.uniforms.polarOn.value = shade.polar ? 1 : 0
    if (shade.polar) {
      material.uniforms.polarFrom.value = textureOf(shade.polar.from, false)
      material.uniforms.polarTo.value = textureOf(shade.polar.to, false)
      material.uniforms.polarBlend.value = shade.polar.mix
      material.uniforms.polarSize.value = shade.polar.radiusM / (2 * shade.polar.halfWidthM)
    }
    material.uniforms.shadeMix.value = shade.opacity
    mesh.visible = true
    this.schedule()
  }
  /**
   * Lay a picture over the ground around the south pole, or take it away (null). A new picture
   * fades in from nothing; taking it away fades it out.
   */
  setOverlay(overlay: GlobeOverlay | null): void {
    if (this.disposed) return
    this.overlayNext = null
    this.detailNext = undefined
    if (!overlay) {
      this.overlayTarget = 0
      this.schedule()
      return
    }
    // A layer still on show (or still fading out) leaves first: the new one waits for it, and
    // `render` puts it in once nothing of the old one is left. Swapped at once, the old one would vanish in one frame.
    if ((this.overlayWhole || this.ground) && this.uniforms.overlayMix.value > 0) {
      this.overlayNext = overlay
      this.overlayTarget = 0
      this.schedule()
      return
    }
    this.putOverlay(overlay)
  }

  private putOverlay(overlay: GlobeOverlay): void {
    const texture = new THREE.CanvasTexture(overlay.image)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    this.renderer.initTexture(texture)
    // The first picture takes the place of the gray stand-in the shader started with.
    if (!this.overlayWhole) this.uniforms.overlayMap.value.dispose()
    this.overlayWhole?.texture.dispose()
    this.overlayClose?.dispose()
    this.overlayClose = null
    // A layer is a map over the south pole: not the ground's own detail, which it replaces.
    this.ground = null
    this.uniforms.overlayKind.value = 0
    this.uniforms.overlayAs.value = 0
    this.overlayWhole = { texture, halfWidthM: overlay.halfWidthM, radiusM: overlay.radiusM }
    this.showWholeOverlay()
    this.uniforms.overlayPaint.value = overlay.paint === 'picture' ? 0 : overlay.paint === 'mask' ? 1 : 2
    // The tint is given as it should look on screen; the shader works in linear light.
    const [r, g, b] = overlay.tint ?? [1, 1, 1]
    this.uniforms.overlayTint.value.setRGB(r, g, b, THREE.SRGBColorSpace)
    this.uniforms.overlayMix.value = 0
    this.overlayTarget = overlay.opacity
    this.schedule()
  }

  /** Put the overlay's own picture, the whole of its ground, in the shader's place for it. */
  private showWholeOverlay(): void {
    if (!this.overlayWhole) return
    const { texture, halfWidthM, radiusM } = this.overlayWhole
    this.uniforms.overlayMap.value = texture
    // Back to the wider, softer picture: nothing to bring into focus.
    this.uniforms.overlaySoft.value = 0
    this.overlayMPerPx = (2 * halfWidthM) / Math.max(widthOf(texture), 1)
    this.uniforms.overlayCentre.value.set(0, 0)
    this.uniforms.overlaySize.value.set(radiusM / (2 * halfWidthM), radiusM / (2 * halfWidthM))
  }

  /**
   * The ground's own detail for the view: a photo of the ground on show, laid on the Moon as grain
   * (its fine detail, on the base map's tone, lit by the hour's Sun), or null for none. It shares
   * the layer's place in the shader, so it is for when no layer is on: one given while a layer is
   * on show or fading waits until nothing of the layer is left. A new picture starts as soft as
   * what it replaces and comes into focus; none is ever swapped in one frame.
   */
  setGroundDetail(detail: GroundDetail | null): void {
    if (this.disposed) return
    const layerOn = this.overlayNext !== null || (this.overlayWhole !== null && this.ground === null && (this.overlayTarget > 0 || this.uniforms.overlayMix.value > 0))
    if (layerOn) {
      this.groundNext = detail
      return
    }
    this.groundNext = undefined
    this.putGround(detail)
  }

  private putGround(detail: GroundDetail | null): void {
    if (!detail) {
      // Gone by fading: with nothing of it left the base map is what it was.
      if (this.ground) this.overlayTarget = 0
      this.schedule()
      return
    }
    const texture = new THREE.CanvasTexture(detail.image)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    this.renderer.initTexture(texture)
    const last = this.ground
    // A layer's pictures, long faded out, are let go; the first picture replaces the gray stand-in.
    if (!last && !this.overlayWhole) this.uniforms.overlayMap.value.dispose()
    this.overlayWhole?.texture.dispose()
    this.overlayClose?.dispose()
    this.overlayWhole = null
    this.overlayClose = null
    const place = detail.place
    if (place.kind === 'polar') {
      this.uniforms.overlayKind.value = 0
      this.uniforms.overlayCentre.value.set(place.centreYM / place.radiusM, place.centreXM / place.radiusM)
      this.uniforms.overlaySize.value.set(place.radiusM / (2 * place.halfHeightM), place.radiusM / (2 * place.halfWidthM))
    } else {
      const rad = Math.PI / 180
      this.uniforms.overlayKind.value = 1
      this.uniforms.overlayCentre.value.set(place.lonDeg * rad, place.latDeg * rad)
      this.uniforms.overlaySize.value.set(1 / (2 * place.halfLonDeg * rad), 1 / (2 * place.halfLatDeg * rad))
    }
    this.uniforms.overlayAs.value = 1
    this.uniforms.overlayPaint.value = 0
    // Its broad tone is read at about the base map's own sharpness, and never from fewer than 8 pixels across.
    this.uniforms.overlayLow.value = Math.max(0, Math.min(Math.log2(BASE_M_PER_PX / detail.metresPerPixel), Math.log2(Math.max(widthOf(texture), 16)) - 3))
    // It starts as soft as what it replaces: the last picture, or the base map.
    this.uniforms.overlaySoft.value = 0
    this.soften('overlaySoft', 1, (last ? this.groundMPerPx : BASE_M_PER_PX) / detail.metresPerPixel)
    if (!last) this.uniforms.overlayMix.value = 0
    this.ground = texture
    this.groundMPerPx = detail.metresPerPixel
    this.uniforms.overlayMap.value = texture
    this.overlayTarget = 1
    last?.dispose()
    this.schedule()
  }

  /**
   * Show a sharper picture of the ground in view in the overlay's place, or go back to the overlay's
   * own picture (null). Both show the same ground, so nothing moves; the sharper one starts as soft
   * as the one it replaces and comes into focus over FOCUS_S.
   */
  setOverlayDetail(detail: GlobeOverlayDetail | null): void {
    if (this.disposed) return
    // A close-up of a layer that is still waiting its turn waits with it.
    if (this.overlayNext) {
      this.detailNext = detail
      return
    }
    if (!this.overlayWhole) return
    const last = this.overlayClose
    if (!detail) {
      this.overlayClose = null
      this.showWholeOverlay()
    } else {
      const texture = new THREE.CanvasTexture(detail.image)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      this.renderer.initTexture(texture)
      this.overlayClose = texture
      // The close-up starts as soft as the picture it replaces and comes into focus: tiles never pop in.
      const mPerPx = (2 * detail.halfWidthM) / Math.max(widthOf(texture), 1)
      if (mPerPx > 0) this.soften('overlaySoft', 1, this.overlayMPerPx / mPerPx)
      this.overlayMPerPx = mPerPx
      this.uniforms.overlayMap.value = texture
      // The shader's ground is in Moon radii with x toward 0° E and y toward 90° E; the map's x is toward 90° E.
      this.uniforms.overlayCentre.value.set(detail.centreYM / detail.radiusM, detail.centreXM / detail.radiusM)
      this.uniforms.overlaySize.value.set(detail.radiusM / (2 * detail.halfHeightM), detail.radiusM / (2 * detail.halfWidthM))
    }
    last?.dispose()
    this.schedule()
  }

  /** Draw this view on the next screen refresh. */
  draw(frame: GlobeFrame): void {
    this.frame = frame
    this.schedule()
  }

  /**
   * Draw this view now, inside this call, instead of on the next screen refresh, so the call can be
   * timed (the /gpu/ comparison). True once the picture is drawn from every map the globe was given.
   */
  drawNow(frame: GlobeFrame): boolean {
    this.frame = frame
    this.render()
    return this.hasRelief && !this.opening && this.pending === 0
  }

  private schedule(): void {
    if (this.request !== null || this.disposed) return
    this.request = requestAnimationFrame((at) => {
      this.request = null
      // The resolution is set in the same turn as the drawing, so a resized canvas is never shown empty.
      const moving = this.lastFrameAt !== null && at - this.lastFrameAt < RUN_GAP_MS
      this.setRatio(moving ? this.movingRatio : this.fullRatio)
      this.render()
      this.afterFrame(at, moving)
    })
  }

  private setRatio(ratio: number): void {
    if (this.renderer.getPixelRatio() === ratio && this.canvas.dataset.pixelRatio !== undefined) return
    this.renderer.setPixelRatio(ratio)
    // For the page's checks: the resolution the Moon is being drawn at.
    this.canvas.dataset.pixelRatio = String(Number(ratio.toFixed(3)))
  }

  /**
   * After a frame: while the view is moving, note how long the screen takes to refresh next; and once
   * it rests, draw the still picture again at full resolution. `at` is the screen's clock for the frame.
   */
  private afterFrame(at: number, moving: boolean): void {
    if (this.disposed) return
    this.lastFrameAt = at
    if (moving && this.probe === null) {
      this.probe = requestAnimationFrame((next) => {
        this.probe = null
        this.noteRefresh(next - at)
      })
    }
    if (this.stillTimer !== null) window.clearTimeout(this.stillTimer)
    this.stillTimer = window.setTimeout(() => {
      this.stillTimer = null
      this.lastFrameAt = null
      this.refreshGaps.length = 0
      // The next frame is not part of a run, so it is drawn at full resolution.
      if (!this.disposed && this.renderer.getPixelRatio() !== this.fullRatio) this.schedule()
    }, STILL_AFTER_MS)
  }

  /** One refresh time into the window; a full window decides whether moving frames get fewer pixels, or some back. */
  private noteRefresh(gapMs: number): void {
    this.refreshGaps.push(gapMs)
    if (this.refreshGaps.length < EASE_WINDOW) return
    const middle = this.refreshGaps.sort((a, b) => a - b)[EASE_WINDOW / 2]
    this.refreshGaps.length = 0
    const now = performance.now()
    if (middle > EASE_SLOW_MS) {
      this.quickWindows = 0
      if (this.movingRatio > EASE_FLOOR) {
        this.movingRatio = Math.max(EASE_FLOOR, this.movingRatio * EASE_STEP)
        this.easedAt = now
      }
    } else if (middle < EASE_QUICK_MS && this.movingRatio < this.fullRatio) {
      this.quickWindows += 1
      if (this.quickWindows >= EASE_GOOD_WINDOWS && now - this.easedAt > EASE_RETRY_MS) {
        this.quickWindows = 0
        this.movingRatio = Math.min(this.fullRatio, this.movingRatio / EASE_STEP)
      }
    } else {
      this.quickWindows = 0
    }
  }

  private render(): void {
    const { frame, canvas } = this
    if (!frame || !this.hasRelief || this.disposed) return
    this.resize()

    const { lat, lon } = frame.view
    const rad = Math.PI / 180
    const center: [number, number, number] = [
      Math.cos(lat * rad) * Math.cos(lon * rad),
      Math.cos(lat * rad) * Math.sin(lon * rad),
      Math.sin(lat * rad),
    ]
    this.camera.position.copy(meToScene(center)).multiplyScalar(CAMERA_DISTANCE)
    this.camera.up.copy(meToScene(frame.up ?? [0, 0, 1]))
    this.camera.lookAt(0, 0, 0)
    if (this.camera.zoom !== frame.zoom) {
      this.camera.zoom = frame.zoom
      this.camera.updateProjectionMatrix()
    }

    // New maps blend in over FADE_S rather than switching in one frame. Terrain lighting needs a
    // Sun to light it; an evenly lit globe keeps the plain picture.
    const now = performance.now()
    const dt = this.lastRender === null ? 0 : Math.min((now - this.lastRender) / 1000, MAX_FADE_FRAME_S)
    this.lastRender = now
    const step = dt / FADE_S
    // The layer that was waiting for the last one to fade out goes in now, unseen, and fades in from here.
    // The ground's detail that was waiting for a layer to leave goes in the same way.
    if (this.groundNext !== undefined && !this.overlayNext && this.overlayTarget === 0 && this.uniforms.overlayMix.value === 0) {
      const next = this.groundNext
      this.groundNext = undefined
      this.putGround(next)
    }
    if (this.overlayNext && this.uniforms.overlayMix.value === 0) {
      const next = this.overlayNext
      const detail = this.detailNext
      this.overlayNext = null
      this.detailNext = undefined
      this.putOverlay(next)
      if (detail !== undefined) this.setOverlayDetail(detail)
    }
    const focus = dt / FOCUS_S
    const fading = [
      fadeToward(this.uniforms.reliefSoft, 0, focus * this.softFrom.reliefSoft),
      fadeToward(this.uniforms.colorSoft, 0, focus * this.softFrom.colorSoft),
      fadeToward(this.uniforms.overlaySoft, 0, focus * this.softFrom.overlaySoft),
      fadeToward(this.uniforms.colorMix, this.colorTarget, step),
      fadeToward(this.uniforms.terrainMix, frame.sun && this.moonSlopes === 2 ? 1 : 0, step),
      fadeToward(this.uniforms.poleMix, this.poleSlopes === 2 ? 1 : 0, step),
      fadeToward(this.uniforms.overlayMix, this.overlayTarget, step * 3),
      this.light ? fadeToward(this.light.uniforms.lightMix, this.light.ready('fine') && frame.light ? 1 : 0, step) : false,
      this.light ? fadeToward(this.light.uniforms.wideMix, this.light.ready('wide') && frame.light ? 1 : 0, step) : false,
      this.light ? fadeToward(this.light.uniforms.lightFine, this.light.fine ? 1 : 0, step) : false,
    ].some(Boolean)
    if (this.light && frame.light) this.light.show(frame.light.hour, frame.light.view, frame.zoom)
    this.uniforms.reliefGain.value = 1.7 - 0.7 * Math.min(Math.max((frame.zoom - 1) / 3, 0), 1)

    // Earthshine: none without both bodies; strongest at new Moon, when Earth is full in the Moon's sky.
    if (frame.sun && frame.earth) {
      const [ex, ey, ez] = frame.earth
      const full = (1 - (frame.sun[0] * ex + frame.sun[1] * ey + frame.sun[2] * ez)) / 2
      this.uniforms.earthDir.value.set(ex, ey, ez)
      this.uniforms.earthShine.value = EARTHSHINE * full
    } else {
      this.uniforms.earthShine.value = 0
    }
    // From evenly lit to lit by the Sun, and back, over FADE_S: the Sun's direction arrives a moment
    // after the first maps, and the Moon must not snap from a full disc to its phase in one frame.
    // The Sun keeps its last direction while its light fades out.
    if (frame.sun) this.sunLight.position.copy(meToScene(frame.sun)).multiplyScalar(CAMERA_DISTANCE)
    const sunFading = fadeToward(this.sunMix, frame.sun ? 1 : 0, this.drawnOnce ? step : 1)
    // Zero rather than hidden, so the shader isn't rebuilt for a different number of lights.
    this.sunLight.intensity = SUN_INTENSITY * this.sunMix.value
    this.ambient.intensity = EVEN_INTENSITY + (NIGHT_INTENSITY - EVEN_INTENSITY) * this.sunMix.value
    this.uniforms.earthShine.value *= this.sunMix.value
    const seen = frame.visible
    this.renderer.setScissorTest(seen !== undefined)
    if (seen) {
      // Measured from the bottom-left corner, in CSS pixels.
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      this.renderer.setScissor(seen.left * width, (1 - seen.bottom) * height, (seen.right - seen.left) * width, (seen.bottom - seen.top) * height)
    }
    if (canvas.width > 0) {
      this.renderer.render(this.scene, this.camera)
      if (!this.drawnOnce) {
        this.drawnOnce = true
        this.onFirstDraw?.()
      }
    }
    if (fading || sunFading || this.overlayNext || this.groundNext !== undefined) this.schedule()
    else this.lastRender = null
  }

  /** Match the drawing buffer to the canvas's size on screen. Safe to call every frame. */
  resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    const size = this.renderer.getSize(new THREE.Vector2())
    if (size.x !== width || size.y !== height) this.renderer.setSize(width, height, false)
  }

  /** Free everything on the GPU and stop drawing. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.request !== null) cancelAnimationFrame(this.request)
    this.request = null
    if (this.probe !== null) cancelAnimationFrame(this.probe)
    if (this.stillTimer !== null) window.clearTimeout(this.stillTimer)
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.geometry.dispose()
    this.material.dispose()
    if (this.shade) {
      for (const texture of this.shade.textures.values()) texture.dispose()
      this.shade.material.dispose()
    }
    this.uniforms.reliefMap.value.dispose()
    this.uniforms.colorMap.value.dispose()
    for (const map of [this.uniforms.slopeE, this.uniforms.slopeN, this.uniforms.poleX, this.uniforms.poleY]) map.value.dispose()
    this.overlayWhole?.texture.dispose()
    this.overlayClose?.dispose()
    this.ground?.dispose()
    this.light?.dispose()
    this.renderer.dispose()
    // Only when the canvas has really gone: React's strict mode remounts onto the same canvas.
    if (!this.canvas.isConnected) this.renderer.forceContextLoss()
  }
}

/** Move a uniform up to `step` toward its target; true while it still has further to go. */
/** A texture's width in pixels, whatever kind of picture it holds; 0 if it has none yet. */
function widthOf(texture: THREE.Texture): number {
  return (texture.image as { width?: number } | null)?.width ?? 0
}

function fadeToward(uniform: { value: number }, target: number, step: number): boolean {
  const gap = target - uniform.value
  uniform.value += Math.max(-step, Math.min(step, gap))
  return uniform.value !== target
}

/** A 1×1 mid-gray texture keeps the samplers valid until the real maps arrive. */
function placeholderTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
  texture.needsUpdate = true
  return texture
}
