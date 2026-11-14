import { describe, expect, it } from 'vitest'
import { anyLayerReaches, layersReach, lightReaches, trekReaches, trekReachKm } from './layerReach'
import type { LightMeta } from './lightGrid'
import { TREK_LAYERS, trekLayer } from './trekLayers'

// The light grid as the pipeline describes it: a fine square 61.44 km to a side's middle, a wider one 153.6 km.
const LIGHT = {
  size: 1024,
  pixel_m: 120,
  half_width_m: 61_440,
  radius_m: 1_737_400,
  x_axis_lon_deg: 90,
  y_axis_lon_deg: 0,
  obs_height_m: 2,
  sun_slots: 16,
  earth_slots: 4,
  hours: {},
  wide: { size: 1024, pixel_m: 300, half_width_m: 153_600 },
} as LightMeta

const RIDGE = { lat: -89.45, lon: -137.31 }
const APOLLO_11 = { lat: 0.674, lon: 23.473 }

describe('how far each Moon Trek map reaches, from its own tiles and level', () => {
  it('is 68 km for long-run sunlight, 137 km for most, 274 km for permanent shadow', () => {
    expect(Object.fromEntries(TREK_LAYERS.map((layer) => [layer.id, trekReachKm(layer)]))).toEqual({ photo: 137, steep: 137, shadow: 274, sunlight: 68, earth: 137, temperature: 137 })
  })

  it('holds a ridge site near the pole in every map, and Apollo 11 in none', () => {
    for (const layer of TREK_LAYERS) {
      expect(trekReaches(layer, RIDGE.lat, RIDGE.lon), layer.id).toBe(true)
      expect(trekReaches(layer, APOLLO_11.lat, APOLLO_11.lon), layer.id).toBe(false)
    }
  })

  it('differs by map between their edges: 100 km from the pole is on the 137 km maps and off the 68 km one', () => {
    // 100 km along the surface from the pole is about 3.3 degrees of latitude.
    const lat = -90 + 3.3
    expect(trekReaches(trekLayer('sunlight')!, lat, 0)).toBe(false)
    expect(trekReaches(trekLayer('photo')!, lat, 0)).toBe(true)
    expect(trekReaches(trekLayer('shadow')!, -90 + 8, 0)).toBe(true)
    expect(trekReaches(trekLayer('photo')!, -90 + 8, 0)).toBe(false)
  })
})

describe("the app's light grid", () => {
  it('holds a place inside its fine or wide square, and says nothing until its description arrives', () => {
    expect(lightReaches(LIGHT, RIDGE.lat, RIDGE.lon)).toBe(true)
    // 4 degrees from the pole: outside the fine square, inside the wide one.
    expect(lightReaches(LIGHT, -86, 0)).toBe(true)
    expect(lightReaches(LIGHT, -84, 0)).toBe(false)
    expect(lightReaches(LIGHT, APOLLO_11.lat, APOLLO_11.lon)).toBe(false)
    expect(lightReaches(undefined, RIDGE.lat, RIDGE.lon)).toBeNull()
    expect(lightReaches(null, RIDGE.lat, RIDGE.lon)).toBe(false)
  })
})

describe('layer by layer', () => {
  it('at a ridge site everything reaches; at Apollo 11 only the place names do', () => {
    const ridge = layersReach(RIDGE, LIGHT)
    expect(Object.values(ridge.trek).every(Boolean)).toBe(true)
    expect(ridge.light).toBe(true)
    const apollo = layersReach(APOLLO_11, LIGHT)
    expect(Object.values(apollo.trek).some(Boolean)).toBe(false)
    expect(apollo.light).toBe(false)
    expect(apollo.names).toBe(true)
  })

  it('says whether any layer does something there: with place names printed everywhere, one always does', () => {
    expect(anyLayerReaches(layersReach(APOLLO_11, LIGHT))).toBe(true)
    // Were the place names not offered, nothing would reach Apollo 11, and Layers would be greyed there.
    const none = { ...layersReach(APOLLO_11, LIGHT), names: false } as unknown as Parameters<typeof anyLayerReaches>[0]
    expect(anyLayerReaches(none)).toBe(false)
  })
})
