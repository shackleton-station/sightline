import * as THREE from 'three'

/** Where the light grid sits on the Moon, from the pipeline's `light/meta.json`. */
export interface LightLayerConfig {
  /** Pixels along one side of the square grid. */
  size: number
  /** Half the grid's width and the Moon's radius, in meters. */
  halfWidthM: number
  radiusM: number
  /** The east longitudes the grid's x and y point toward, in degrees. */
  xLonDeg: number
  yLonDeg: number
  /** Terrain slopes along the grid's x and y, sharper than the globe's own polar maps. */
  slopeUrls: [string, string]
  /** The wide grid around this one, on the same plane: pixels along a side and half its width in meters. */
  wide?: { size: number; halfWidthM: number } | null
}

/** Which of the two grids a month belongs to. */
export type LightGridName = 'fine' | 'wide'

/**
 * One month of the grid. Each pixel's Sun (and Earth) visibility is the list of hours at which it
 * changes, starting from "down"; unused slots hold the number of hours in the month.
 */
export interface LightMonthData {
  hours: number
  /** 16 planes of `size * size` flips, slot by slot. */
  sun: Uint16Array
  /** 4 planes of `size * size` flips. */
  earth: Uint16Array
}

/** What the grid is colored by: who can see the Sun now, the Sun and Earth now, or the month's share of Sun. */
/**
 * What the grid draws: the three Atlas views, which recolor the ground inside the grid's squares, or
 * `shade`, which recolors nothing and only darkens ground the Sun cannot reach at the hour on screen.
 */
export type LightView = 'light' | 'both' | 'month' | 'shade'

const SUN_SLOTS = 16
const EARTH_SLOTS = 4
const VIEW_INDEX: Record<LightView, number> = { light: 0, both: 1, month: 2, shade: 3 }

export const LIGHT_UNIFORMS = /* glsl */ `
uniform highp usampler2D lightSunA;
uniform highp usampler2D lightSunB;
uniform highp usampler2D lightEarth;
// The wide grid: the same three, for larger pixels reaching farther from the pole.
uniform highp usampler2D wideSunA;
uniform highp usampler2D wideSunB;
uniform highp usampler2D wideEarth;
uniform sampler2D lightSlopeX;
uniform sampler2D lightSlopeY;
uniform float lightSize;   // cells along one side of the fine grid
uniform float wideSize;
uniform float lightHours;  // hours in the fine grid's month
uniform float lightHour;   // the hour the fine grid shows, counted from the start of its month
uniform float wideHours;   // the same two for the wide grid: while one grid waits for a new month
uniform float wideHour;    // it holds its old one at its last hour, so each keeps its own
uniform float lightMix;    // 1 once a month of the fine grid has loaded
uniform float wideMix;     // 1 once a month of the wide grid has loaded
uniform float lightFine;   // 1 once the fine grid's own slope maps have loaded
uniform float lightScale;  // Moon radius / the fine grid's full width
uniform float wideScale;   // Moon radius / the wide grid's full width
uniform float lightView;   // 0 sunlight, 1 Sun and Earth, 2 the month's share of Sun, 3 shadow only (nothing recolored)
uniform float lightDim;    // how much the slope-shaded ground around the grids is dimmed: 0 seen whole, 1 close up
uniform vec2 lightAxisX;   // the direction, in MOON_ME x and y, that the grids' x points along
uniform vec2 lightAxisY;
uniform vec3 lightBoth;
uniform vec3 lightSunOnly;
uniform vec3 lightEarthOnly;
uniform vec3 lightNeither;

// How far each flip has taken hold at the time on screen: 0 until an hour before it, 1 from its own
// hour on, and a straight blend between. At a whole hour this is the data's own answer (a flip at
// or before the hour has passed); between two hours the picture blends from one to the next, so
// the ground's light changes smoothly as time plays instead of snapping once an hour. The month's
// last hour is not blended: the hour after it is in another file.
float lightNow = 0.0;   // the hour and the month's length of the grid being read: set before lightAt
float lightSpan = 1.0;
vec4 lightTaken(vec4 flips) {
  return clamp(min(lightNow, lightSpan - 1.0) - flips + 1.0, 0.0, 1.0);
}
// A cell is "up" at an hour when an odd number of its flips have passed: its flips are in order, so
// that is the first, less the second, plus the third, less the fourth. Unused slots hold the
// month's number of hours, which never passes.
float lightPassed(uvec4 flips) {
  vec4 taken = lightTaken(vec4(flips));
  return clamp(taken.x - taken.y + taken.z - taken.w, 0.0, 1.0);
}
// The Sun's textures hold two flips in each channel, 16 bits each: the start and end of one "up" run.
float lightPassedPairs(uvec4 pairs) {
  vec4 up = lightTaken(vec4(pairs & 0xFFFFu)) - lightTaken(vec4(pairs >> 16u));
  return up.x + up.y + up.z + up.w;
}
float lightRunHours(uvec4 pairs) {
  vec4 runs = vec4(pairs >> 16u) - vec4(pairs & 0xFFFFu);
  return runs.x + runs.y + runs.z + runs.w;
}
ivec2 lightCell(ivec2 cell, float size) {
  return clamp(cell, ivec2(0), ivec2(int(size) - 1));
}
float lightSunUp(highp usampler2D a, highp usampler2D b, float size, ivec2 cell) {
  ivec2 at = lightCell(cell, size);
  return clamp(lightPassedPairs(texelFetch(a, at, 0)) + lightPassedPairs(texelFetch(b, at, 0)), 0.0, 1.0);
}
float lightEarthUp(highp usampler2D e, float size, ivec2 cell) {
  return lightPassed(texelFetch(e, lightCell(cell, size), 0));
}
// The share of the month a cell has the Sun: the lengths of its "up" runs, added.
float lightSunShare(highp usampler2D a, highp usampler2D b, float size, ivec2 cell) {
  ivec2 at = lightCell(cell, size);
  return (lightRunHours(texelFetch(a, at, 0)) + lightRunHours(texelFetch(b, at, 0))) / lightSpan;
}
// Each of the three, blended between the four cells around a point, so edges are smooth close up.
// The result is x: Sun up, y: Earth up, z: the month's share of Sun; only what the view needs is read.
vec3 lightAt(highp usampler2D a, highp usampler2D b, highp usampler2D e, float size, vec2 uv) {
  vec2 texel = vec2(uv.x, 1.0 - uv.y) * size - 0.5;
  ivec2 cell = ivec2(floor(texel));
  vec2 part = fract(texel);
  ivec2 right = cell + ivec2(1, 0);
  ivec2 below = cell + ivec2(0, 1);
  ivec2 across = cell + ivec2(1, 1);
  vec3 found = vec3(0.0);
  if (lightView > 1.5 && lightView < 2.5) {
    found.z = mix(
      mix(lightSunShare(a, b, size, cell), lightSunShare(a, b, size, right), part.x),
      mix(lightSunShare(a, b, size, below), lightSunShare(a, b, size, across), part.x),
      part.y
    );
    return found;
  }
  found.x = mix(
    mix(lightSunUp(a, b, size, cell), lightSunUp(a, b, size, right), part.x),
    mix(lightSunUp(a, b, size, below), lightSunUp(a, b, size, across), part.x),
    part.y
  );
  if (lightView > 0.5 && lightView < 1.5) {
    found.y = mix(
      mix(lightEarthUp(e, size, cell), lightEarthUp(e, size, right), part.x),
      mix(lightEarthUp(e, size, below), lightEarthUp(e, size, across), part.x),
      part.y
    );
  }
  return found;
}
`

// Inside the grids' squares the picture is the data: each cell is lit or not by the pipeline's own
// horizon calculation for that cell. The fine grid is used where it reaches, the wide one around
// it. The slopes only give the ground its shape, lit from the Sun's real compass direction but as
// if it stood 30 degrees high, so hills read whether or not they are in sunlight.
export const LIGHT_SURFACE = /* glsl */ `
vec3 gridColor = vec3(0.0);
float gridMix = 0.0;
float gridOutline = 0.0;
float gridShade = 0.0;   // the shadow view: how far the ground is in the terrain's shadow, 0 to 1
{
  vec2 gridUv = vec2(0.5 + dot(polarGround, lightAxisX) * lightScale, 0.5 + dot(polarGround, lightAxisY) * lightScale);
  vec2 wideUv = vec2(0.5 + dot(polarGround, lightAxisX) * wideScale, 0.5 + dot(polarGround, lightAxisY) * wideScale);
  float south = step(moonUp.z, -0.9);
  float fromEdge = 0.5 - max(abs(gridUv.x - 0.5), abs(gridUv.y - 0.5));
  float wideEdge = 0.5 - max(abs(wideUv.x - 0.5), abs(wideUv.y - 0.5));
  // A line around the whole of the computed ground, and a fainter one where the finer grid begins.
  float fineLine = lightMix * (1.0 - smoothstep(0.0, 1.5 * fwidth(fromEdge), abs(fromEdge)));
  float wideLine = wideMix * (1.0 - smoothstep(0.0, 1.5 * fwidth(wideEdge), abs(wideEdge)));
  // The shadow view draws no lines: it is the Moon's own picture, darker where the Sun does not reach.
  gridOutline = south * max(wideLine, fineLine * mix(1.0, 0.45, wideMix)) * step(lightView, 2.5);
  vec2 coarse = vec2(moonSlope(poleX, poleUv), moonSlope(poleY, poleUv));
  vec2 fine = vec2(moonSlope(lightSlopeX, gridUv), moonSlope(lightSlopeY, gridUv));
  bool useFine = lightMix > 0.0 && fromEdge > 0.0;
  bool useWide = !useFine && wideMix > 0.0 && wideEdge > 0.0;
  if (lightView > 2.5) {
    // Shadow only. Each grid's answer is blended between the four cells around the point and eased
    // across the whole of a cell, which is as sharp as the grid can honestly be: no cell shows as a
    // box. The fine grid takes over from the wide one across the outer 2% of its square, and the
    // wide one fades out the same way at its own edge.
    if (south > 0.0) {
      float shadeWide = 0.0;
      float shadeFine = 0.0;
      float inFine = 0.0;
      if (wideMix > 0.0 && wideEdge > 0.0) {
        lightNow = wideHour;
        lightSpan = wideHours;
        shadeWide = wideMix * smoothstep(0.0, 0.02, wideEdge) * (1.0 - smoothstep(0.0, 1.0, lightAt(wideSunA, wideSunB, wideEarth, wideSize, wideUv).x));
      }
      if (lightMix > 0.0 && fromEdge > 0.0) {
        lightNow = lightHour;
        lightSpan = lightHours;
        inFine = lightMix * smoothstep(0.0, 0.02, fromEdge);
        shadeFine = 1.0 - smoothstep(0.0, 1.0, lightAt(lightSunA, lightSunB, lightEarth, lightSize, gridUv).x);
      }
      gridShade = mix(shadeWide, shadeFine, inFine);
    }
  } else if (south > 0.0 && (useFine || useWide)) {
    lightNow = useFine ? lightHour : wideHour;
    lightSpan = useFine ? lightHours : wideHours;
    vec3 seen = useFine ? lightAt(lightSunA, lightSunB, lightEarth, lightSize, gridUv) : lightAt(wideSunA, wideSunB, wideEarth, wideSize, wideUv);

    vec2 grade = useFine ? mix(coarse, fine, lightFine) : coarse;
    vec2 sunMap = vec2(0.7071);
    #if NUM_DIR_LIGHTS > 0
      vec3 sunMe = (vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz.zxy;
      vec2 sunFlat = vec2(dot(sunMe.xy, lightAxisX), dot(sunMe.xy, lightAxisY));
      sunMap = sunFlat / max(length(sunFlat), 1e-4);
    #endif
    float hill = clamp((0.5 - 0.866 * dot(grade, sunMap)) / sqrt(1.0 + dot(grade, grade)) / 0.5, 0.0, 2.2);

    if (lightView > 1.5) {
      vec3 low = vec3(0.008, 0.012, 0.045);
      vec3 mid = vec3(0.50, 0.13, 0.03);
      vec3 high = vec3(1.0, 0.82, 0.40);
      vec3 ramp = seen.z < 0.5 ? mix(low, mid, seen.z * 2.0) : mix(mid, high, seen.z * 2.0 - 1.0);
      gridColor = ramp * (0.55 + 0.45 * min(hill, 1.6));
    } else {
      float lit = smoothstep(0.3, 0.7, seen.x);
      if (lightView > 0.5) {
        float earth = smoothstep(0.3, 0.7, seen.y);
        vec3 state = mix(mix(lightNeither, lightEarthOnly, earth), mix(lightSunOnly, lightBoth, earth), lit);
        gridColor = state * (0.4 + 0.6 * min(hill, 1.6));
      } else {
        // Lit ground is never drawn as dark as unlit ground, however steeply it faces away: the
        // darkest "day" here is more than twice as bright as the brightest "night".
        vec3 day = vec3(0.30, 0.29, 0.275) * (0.35 + 0.65 * hill);
        vec3 night = vec3(0.016, 0.022, 0.042) * (0.2 + 0.8 * hill);
        gridColor = mix(night, day, lit);
      }
    }
    gridMix = useFine ? lightMix * smoothstep(0.0, 0.003, fromEdge) : wideMix * smoothstep(0.0, 0.003, wideEdge);
    // Just inside the fine square's edge, while it fades in, the wide grid shows through underneath.
    if (useFine && wideMix > 0.0) gridMix = max(gridMix, wideMix);
  }
}
`

export const LIGHT_APPLY = /* glsl */ `
// The shadow view: ground in the terrain's shadow keeps a sixth of its sunlight, so its shape still reads.
reflectedLight.directDiffuse *= 1.0 - 0.84 * gridShade;
reflectedLight.directSpecular *= 1.0 - gridShade;
reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, gridColor, gridMix);
reflectedLight.indirectDiffuse *= 1.0 - gridMix;
reflectedLight.directSpecular *= 1.0 - gridMix;
reflectedLight.indirectSpecular *= 1.0 - gridMix;
// Around the square the polar map is still only slope shading. Close up it is dimmed, so its evenly
// lit ground isn't read as sunlight next to ground where the light is computed.
float beyond = 0.55 * lightDim * max(lightMix, wideMix) * cap * (1.0 - gridMix);
reflectedLight.directDiffuse *= 1.0 - beyond;
reflectedLight.indirectDiffuse *= 1.0 - beyond;
// A thin line around the square, so it is plain where the computed light ends.
reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, vec3(0.62, 0.42, 0.12), 0.75 * gridOutline);
reflectedLight.indirectDiffuse *= 1.0 - 0.75 * gridOutline;
`

/** Flips as a texture of whole numbers, read exactly (never blended) by the shader. */
function flipTexture(data: Uint16Array | Uint32Array, size: number): THREE.DataTexture {
  const wide = data instanceof Uint32Array
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAIntegerFormat, wide ? THREE.UnsignedIntType : THREE.UnsignedShortType)
  texture.internalFormat = wide ? 'RGBA32UI' : 'RGBA16UI'
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function grayTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
  texture.needsUpdate = true
  return texture
}

/** Four slot planes (`size * size` each) woven into one RGBA texel per cell. */
export function weaveSlots(planes: Uint16Array, first: number, cells: number): Uint16Array {
  const woven = new Uint16Array(cells * 4)
  for (let slot = 0; slot < 4; slot++) {
    const plane = planes.subarray((first + slot) * cells, (first + slot + 1) * cells)
    for (let cell = 0; cell < cells; cell++) woven[cell * 4 + slot] = plane[cell]
  }
  return woven
}

/**
 * Eight slot planes woven into one RGBA texel per cell, two flips to a channel: the earlier in the
 * low 16 bits and the later in the high 16, so a channel is one "up" run's start and end.
 */
export function weavePairs(planes: Uint16Array, first: number, cells: number): Uint32Array {
  const woven = new Uint32Array(cells * 4)
  for (let channel = 0; channel < 4; channel++) {
    const start = planes.subarray((first + 2 * channel) * cells, (first + 2 * channel + 1) * cells)
    const end = planes.subarray((first + 2 * channel + 1) * cells, (first + 2 * channel + 2) * cells)
    for (let cell = 0; cell < cells; cell++) woven[cell * 4 + channel] = start[cell] + end[cell] * 65536
  }
  return woven
}

/**
 * The textures and settings that draw the pipeline's light grid on the globe. The whole month sits
 * on the GPU as flip times, so moving time changes one number and uploads nothing.
 */
export class LightLayer {
  readonly uniforms: Record<string, { value: unknown }> & {
    lightMix: { value: number }
    wideMix: { value: number }
    lightFine: { value: number }
  }
  private readonly config: LightLayerConfig
  private readonly has: Record<LightGridName, boolean> = { fine: false, wide: false }
  /** A grid waiting for a new month keeps its old one at the hour it was showing, while the viewer fades it out. */
  private readonly frozen: Record<LightGridName, boolean> = { fine: false, wide: false }
  private slopes = 0

  constructor(config: LightLayerConfig) {
    this.config = config
    const rad = Math.PI / 180
    this.uniforms = {
      // 1 x 1 textures of the right kinds keep the integer samplers valid until a month arrives.
      lightSunA: { value: flipTexture(new Uint32Array(4), 1) },
      lightSunB: { value: flipTexture(new Uint32Array(4), 1) },
      lightEarth: { value: flipTexture(new Uint16Array(4), 1) },
      wideSunA: { value: flipTexture(new Uint32Array(4), 1) },
      wideSunB: { value: flipTexture(new Uint32Array(4), 1) },
      wideEarth: { value: flipTexture(new Uint16Array(4), 1) },
      wideSize: { value: 1 },
      wideMix: { value: 0 },
      wideScale: { value: config.wide ? config.radiusM / (2 * config.wide.halfWidthM) : 1 },
      lightSlopeX: { value: grayTexture() },
      lightSlopeY: { value: grayTexture() },
      lightSize: { value: 1 },
      lightHours: { value: 1 },
      lightHour: { value: 0 },
      wideHours: { value: 1 },
      wideHour: { value: 0 },
      lightMix: { value: 0 },
      lightFine: { value: 0 },
      lightScale: { value: config.radiusM / (2 * config.halfWidthM) },
      lightView: { value: 0 },
      lightDim: { value: 0 },
      lightAxisX: { value: new THREE.Vector2(Math.cos(config.xLonDeg * rad), Math.sin(config.xLonDeg * rad)) },
      lightAxisY: { value: new THREE.Vector2(Math.cos(config.yLonDeg * rad), Math.sin(config.yLonDeg * rad)) },
      // The time river's own colors, so the map and the river read as one legend.
      lightBoth: { value: new THREE.Color('#3fbf86') },
      lightSunOnly: { value: new THREE.Color('#ffc04d') },
      lightEarthOnly: { value: new THREE.Color('#4d86e0') },
      lightNeither: { value: new THREE.Color('#23243a') },
    }
  }

  /** Whether a month of a grid is loaded, which is when that grid should be shown. */
  ready(grid: LightGridName): boolean {
    return this.has[grid]
  }

  get fine(): boolean {
    return this.slopes === 2
  }

  /**
   * Put a month of a grid on the GPU, replacing the last one; null takes that grid away. Nothing
   * is dropped in one frame, which would flash: a month that is replaced gives way to the new one
   * at the new hour, and a grid taken away (while the next month loads) keeps its last picture at
   * the hour it was showing, never under a new month's hour, while the viewer fades it out.
   */
  setMonth(month: LightMonthData | null, grid: LightGridName = 'fine'): void {
    const wide = grid === 'wide'
    const shown = this.has[grid]
    this.has[grid] = false
    const size = wide ? this.config.wide?.size : this.config.size
    if (!month || !size) {
      if (shown) this.frozen[grid] = true
      else this.uniforms[wide ? 'wideMix' : 'lightMix'].value = 0
      return
    }
    const cells = size * size
    if (month.sun.length !== SUN_SLOTS * cells || month.earth.length !== EARTH_SLOTS * cells) {
      throw new Error('light grid month does not match the grid')
    }
    const parts: [string, Uint16Array | Uint32Array][] = [
      [wide ? 'wideSunA' : 'lightSunA', weavePairs(month.sun, 0, cells)],
      [wide ? 'wideSunB' : 'lightSunB', weavePairs(month.sun, 8, cells)],
      [wide ? 'wideEarth' : 'lightEarth', weaveSlots(month.earth, 0, cells)],
    ]
    for (const [name, data] of parts) {
      const uniform = this.uniforms[name] as { value: THREE.DataTexture }
      uniform.value.dispose()
      uniform.value = flipTexture(data, size)
    }
    this.uniforms[wide ? 'wideSize' : 'lightSize'].value = size
    this.uniforms[wide ? 'wideHours' : 'lightHours'].value = month.hours
    this.has[grid] = true
    this.frozen[grid] = false
  }

  /** One of the grid's two slope maps has loaded. */
  setSlope(index: 0 | 1, texture: THREE.Texture): void {
    const uniform = this.uniforms[index === 0 ? 'lightSlopeX' : 'lightSlopeY'] as { value: THREE.Texture }
    texture.format = THREE.RedFormat
    texture.wrapS = THREE.ClampToEdgeWrapping
    uniform.value.dispose()
    uniform.value = texture
    this.slopes += 1
  }

  /** The hour on screen, what to color the grid by, and how far in the view is zoomed. */
  show(hour: number, view: LightView, zoom: number): void {
    if (!this.frozen.fine) this.uniforms.lightHour.value = hour
    if (!this.frozen.wide) this.uniforms.wideHour.value = hour
    this.uniforms.lightView.value = VIEW_INDEX[view]
    // Seen whole, the polar map is a few pixels of the Moon and stays as it is. The shadow view dims nothing around the grids.
    this.uniforms.lightDim.value = view === 'shade' ? 0 : Math.min(Math.max((zoom - 2) / 4, 0), 1)
  }

  dispose(): void {
    for (const name of ['lightSunA', 'lightSunB', 'lightEarth', 'wideSunA', 'wideSunB', 'wideEarth', 'lightSlopeX', 'lightSlopeY']) {
      ;(this.uniforms[name] as { value: THREE.Texture }).value.dispose()
    }
  }
}
