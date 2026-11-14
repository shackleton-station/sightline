import { describe, expect, it } from 'vitest'
import { inFinePhoto, TREK_LAYERS, trekClosestMPerPx, trekGround, trekHalfWidthM, trekLayer, trekMetresPerPixel, trekPicturePx, trekTiles, trekWindow, trekWindowKey } from './trekLayers'

describe('the Moon Trek layers', () => {
  it('are the six switches, each with words, Trek’s product name and Trek’s own title', () => {
    expect(TREK_LAYERS.map((layer) => layer.id)).toEqual(['photo', 'steep', 'shadow', 'sunlight', 'earth', 'temperature'])
    for (const layer of TREK_LAYERS) {
      expect(layer.label.length).toBeGreaterThan(3)
      expect(layer.says.length).toBeGreaterThan(20)
      expect(layer.product).toMatch(/^[A-Za-z0-9_]+$/)
      expect(layer.title.length).toBeGreaterThan(10)
    }
  })

  it('never say "lunar day" or "lunar night"', () => {
    expect(TREK_LAYERS.every((layer) => !/lunar (day|night)/i.test(layer.label + layer.says))).toBe(true)
  })

  it('give a colour to every layer drawn in one colour, and none to a picture', () => {
    for (const layer of TREK_LAYERS) expect(layer.tint !== undefined).toBe(layer.paint !== 'picture')
  })

  it('finds a layer by its id', () => {
    expect(trekLayer('earth')?.product).toBe('AVGVISIB_85S_060M_201608_EARTH_SP')
    expect(trekLayer('nothing')).toBeNull()
    expect(trekLayer(null)).toBeNull()
  })
})

describe('a layer’s picture', () => {
  const photo = trekLayer('photo')!
  const shadow = trekLayer('shadow')!

  it('is the middle tiles of its level, with the pole where they meet', () => {
    const tiles = trekTiles(photo)
    expect(tiles).toHaveLength(16)
    expect(tiles[0]).toEqual({ url: '/trek/SP/LRO_NAC_AvgMosaic_SPole855_1mp/1.0.0/default/default028mm/5/14/14.png', x: 0, y: 0 })
    expect(tiles[15].url).toContain('/5/17/17.png')
    expect(tiles[15]).toMatchObject({ x: 768, y: 768 })
    expect(trekTiles(shadow).map((tile) => tile.url.split('/').slice(-3).join('/'))).toEqual(['3/3/3.png', '3/3/4.png', '3/4/3.png', '3/4/4.png'])
  })

  it('covers the ground its level and tile count say', () => {
    // Level 5 tiles are 68,495.625 m wide: four of them reach 136,991.25 m from the pole.
    expect(trekHalfWidthM(photo)).toBeCloseTo(136_991.25, 2)
    expect(trekHalfWidthM(shadow)).toBeCloseTo(273_982.5, 2)
    expect(trekMetresPerPixel(photo)).toBeCloseTo(267.561, 3)
    expect(trekPicturePx(photo)).toBe(1024)
    expect(trekPicturePx(shadow)).toBe(512)
  })

  it('reaches at least as far as the layer’s own data, or says where it stops', () => {
    // The photo mosaic's own extent is 136,526 m: inside the picture.
    expect(trekHalfWidthM(photo)).toBeGreaterThan(136_526)
  })
})

describe('a point on Trek’s south-pole map', () => {
  it('puts the pole in the middle, 0° E up and 90° E to the right, true to scale at the pole', () => {
    expect(trekGround([0, 0, -1])).toEqual({ x: 0, y: 0 })
    const rad = Math.PI / 180
    // One degree from the pole toward 0° E: 2R tan(0.5°) up the map.
    const up = trekGround([Math.sin(rad), 0, -Math.cos(rad)])
    expect(up.x).toBeCloseTo(0, 6)
    expect(up.y).toBeCloseTo(2 * 1_737_400 * Math.tan(rad / 2), 3)
    const right = trekGround([0, Math.sin(rad), -Math.cos(rad)])
    expect(right.x).toBeCloseTo(up.y, 6)
    expect(right.y).toBeCloseTo(0, 6)
  })
})

describe('the close-up picture for a view', () => {
  const photo = trekLayer('photo')!
  const shadow = trekLayer('shadow')!

  it('is not needed while the whole-cap picture is as sharp as the screen', () => {
    expect(trekWindow(photo, { x: 0, y: 0 }, 100_000, 300)).toBeNull()
  })

  it('takes the level whose pixels match the screen’s, and the tiles that cover the ground in view', () => {
    // 20 m of ground a screen pixel: level 8 tiles are 33.4 m a pixel, level 9 are 16.7 m.
    const window = trekWindow(photo, { x: -2812, y: -6647 }, 12_000, 20)!
    expect(window.level).toBe(9)
    expect(window.metresPerPixel).toBeCloseTo(16.723, 3)
    expect(window.product).toBe('LRO_NAC_AvgMosaic_SPole855_1mp')
    // The picture reaches at least 12 km every way from the middle of the view.
    expect(window.centreXM - window.halfWidthM).toBeLessThanOrEqual(-2812 - 12_000)
    expect(window.centreXM + window.halfWidthM).toBeGreaterThanOrEqual(-2812 + 12_000)
    expect(window.centreYM - window.halfHeightM).toBeLessThanOrEqual(-6647 - 12_000)
    expect(window.centreYM + window.halfHeightM).toBeGreaterThanOrEqual(-6647 + 12_000)
    expect(window.tiles).toHaveLength((window.widthPx / 256) * (window.heightPx / 256))
    expect(window.tiles[0].url).toMatch(/\/LRO_NAC_AvgMosaic_SPole855_1mp\/1\.0\.0\/default\/default028mm\/9\/\d+\/\d+\.png$/)
  })

  it('never goes finer than Trek serves, and switches to the sharper mosaic for its last level', () => {
    const window = trekWindow(photo, { x: 0, y: 0 }, 400, 0.5)!
    expect(window.level).toBe(12)
    expect(window.product).toBe('LRO_NAC_Mosaic_1mpp_SP')
    expect(window.title).toBe('LRO NAC Mosaic 1mpp, S Pole')
    expect(trekWindow(shadow, { x: 0, y: 0 }, 400, 0.5)).toBeNull()
  })

  it('never asks for a picture larger than 2048 px a side', () => {
    // 40 km every way at 20 m a screen pixel would be nineteen level-9 tiles a side: it steps down to level 7 (17 km tiles).
    const window = trekWindow(photo, { x: 5000, y: 5000 }, 40_000, 20)!
    expect(window.level).toBe(7)
    expect(window.widthPx).toBeLessThanOrEqual(2048)
    expect(window.heightPx).toBeLessThanOrEqual(2048)
    expect(window.centreXM - window.halfWidthM).toBeLessThanOrEqual(5000 - 40_000)
    expect(window.centreXM + window.halfWidthM).toBeGreaterThanOrEqual(5000 + 40_000)
  })

  it('is nothing when the view is far outside the layer', () => {
    expect(trekWindow(photo, { x: 900_000, y: 0 }, 12_000, 20)).toBeNull()
  })

  it('has the same name for the same tiles', () => {
    const a = trekWindow(photo, { x: -2812, y: -6647 }, 12_000, 20)!
    const b = trekWindow(photo, { x: -2700, y: -6600 }, 12_000, 20)!
    expect(trekWindowKey(a)).toBe(trekWindowKey(b))
    expect(trekWindowKey(trekWindow(photo, { x: 40_000, y: 0 }, 12_000, 20)!)).not.toBe(trekWindowKey(a))
  })

  it('lets the screen go as close as the layer’s finest pixels, a little enlarged', () => {
    expect(trekClosestMPerPx(photo)).toBeCloseTo(2.0903 / 1.5, 3)
    expect(trekClosestMPerPx(shadow)).toBeCloseTo(1070.24 / 1.5, 1)
  })
})

describe('our own finer photo, round a ridge site', () => {
  const photo = trekLayer('photo')!
  const steep = trekLayer('steep')!
  // One disc, 10 km round a point 30 km from the pole toward 90° E and 20 km toward 180° E.
  const fine = { level: 13, radiusM: 10_000, discs: [{ x: 30_000, y: -20_000 }], title: 'LROC Controlled NAC South Pole Average Mosaic, 1 m/pixel', credit: 'NASA/GSFC/Arizona State University' }
  const middle = { x: 30_000, y: -20_000 }

  it('covers the ground inside its discs and nowhere else', () => {
    expect(inFinePhoto(fine, 30_000, -20_000)).toBe(true)
    expect(inFinePhoto(fine, 39_900, -20_000)).toBe(true)
    expect(inFinePhoto(fine, 40_100, -20_000)).toBe(false)
  })

  it('takes the photo two levels past Trek’s, from our own tiles, each with Trek’s tile of the same mosaic to stand in', () => {
    const close = trekWindow(photo, middle, 500, 1, fine)!
    expect(close.level).toBe(13)
    expect(close.product).toBe('NAC_POLE_SOUTH_CM_AVG')
    expect(close.metresPerPixel).toBeCloseTo(1.0452, 3)
    const first = close.tiles[0]
    expect(first.url).toMatch(/^\/tiles\/polar\/photo\/13\/\d+\/\d+\.jpg$/)
    // Level 13's row and column, divided by four, are level 11's; the square is a quarter of a tile a side.
    const [row, col] = first.url.split('/').slice(-2).map((part) => Number.parseInt(part, 10))
    expect(first.or?.url).toBe(`/trek/SP/LRO_NAC_AvgMosaic_SPole855_1mp/1.0.0/default/default028mm/11/${row >> 2}/${col >> 2}.png`)
    expect(first.or?.crop).toEqual({ sx: (col & 3) * 64, sy: (row & 3) * 64, size: 64 })
  })

  it('passes over Trek’s own close-up mosaic on the way in: it sits 300 m from this one', () => {
    // 2.5 m a screen pixel on a small view asks for level 12, which is Trek's other mosaic: ours takes its place.
    expect(trekWindow(photo, middle, 400, 2.5, fine)?.level).toBe(13)
    // A view too wide for our tiles at that scale stays on the layer's own mosaic, never the other one.
    expect(trekWindow(photo, middle, 2500, 2.5, fine)?.level).toBe(11)
    expect(trekWindow(photo, middle, 2500, 2.5, fine)?.product).toBe('LRO_NAC_AvgMosaic_SPole855_1mp')
  })

  it('at a disc’s edge draws Trek’s tile, enlarged, where we have none', () => {
    const edge = trekWindow(photo, { x: 39_900, y: -20_000 }, 600, 1, fine)!
    expect(edge.level).toBe(13)
    const ours = edge.tiles.filter((tile) => tile.url.startsWith('/tiles/polar/photo/'))
    const theirs = edge.tiles.filter((tile) => tile.url.startsWith('/trek/'))
    expect(ours.length).toBeGreaterThan(0)
    expect(theirs.length).toBeGreaterThan(0)
    expect(theirs.every((tile) => tile.crop?.size === 64 && tile.or === undefined)).toBe(true)
  })

  it('changes nothing outside the discs, for other layers, or with no finer photo known', () => {
    const away = { x: -60_000, y: 10_000 }
    expect(trekWindow(photo, away, 500, 1, fine)).toEqual(trekWindow(photo, away, 500, 1))
    expect(trekWindow(steep, middle, 500, 1, fine)).toEqual(trekWindow(steep, middle, 500, 1))
    expect(trekWindow(photo, middle, 500, 1, null)?.level).toBe(12)
  })

  it('lets the screen go in to 0.70 m a pixel over a disc', () => {
    expect(trekClosestMPerPx(photo, fine.level)).toBeCloseTo(1.0452 / 1.5, 3)
    expect(trekClosestMPerPx(photo)).toBeCloseTo(2.0903 / 1.5, 3)
  })
})

