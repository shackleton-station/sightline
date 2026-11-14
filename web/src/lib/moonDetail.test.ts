import { describe, expect, it } from 'vitest'
import { detailClosestMPerPx, detailMetresPerPixel, detailWindow, detailWindowKey, REGIONAL, regionalAt, WAC } from './moonDetail'

describe('Moon Trek’s pictures of the ground', () => {
  it('are on a grid whose level 8 is 83 m a pixel and level 15 is 0.65 m', () => {
    expect(detailMetresPerPixel(8)).toBeCloseTo(83.29, 2)
    expect(detailMetresPerPixel(15)).toBeCloseTo(0.651, 3)
  })

  it('name a regional picture for the seven sites that have one, and none elsewhere', () => {
    expect(regionalAt(23.47314, 0.67416)?.product).toBe('A11_60x60km.eq')
    expect(regionalAt(3.6333, 26.13239)?.product).toBe('A15_60x60km.0_2.eq')
    expect(regionalAt(30.7723, 20.1911)?.product).toBe('A17_60x60km.eq')
    expect(regionalAt(61.8103, 18.5623)?.product).toBe('LRO_NAC_ortho_horseshoeV2')
    expect(regionalAt(1.44, -80.13)?.product).toBe('LRO_NAC_Post_Landing_OrthoMosaic_1mpp_IM_1_LandingSite')
    expect(regionalAt(25.251, -13.316)?.product).toBe('LRO_NAC_Mosaic_0_82mpp_Shioli')
    expect(regionalAt(177.589, -45.457)?.product).toBe('LRO_NAC_Mosaic_50cmpp_VonKarman_v2')
    // IM-2 Athena and Chandrayaan-3: the whole-Moon picture only.
    expect(regionalAt(29.1957, -84.7906)).toBeNull()
    expect(regionalAt(32.32, -69.3741)).toBeNull()
    expect(REGIONAL.every((source) => source.box !== undefined && source.maxLevel > WAC.maxLevel)).toBe(true)
  })

  it('let the view go in to the finest pixels there are for the place, a little enlarged', () => {
    expect(detailClosestMPerPx(30.7723, 20.1911)).toBeCloseTo(0.651 / 1.5, 2)
    expect(detailClosestMPerPx(1.44, -80.13)).toBeCloseTo(2.603 / 1.5, 2)
    expect(detailClosestMPerPx(32.32, -69.3741)).toBeCloseTo(83.29 / 1.5, 1)
  })
})

describe('the picture of the ground for a view', () => {
  it('is the whole-Moon mosaic while the screen is coarser than its pixels, through the site’s own route', () => {
    const view = detailWindow(30.7723, 20.1911, 150_000, 420)!
    expect(view.product).toBe(WAC.product)
    expect(view.level).toBe(6)
    expect(view.tiles[0].url).toMatch(/^\/trek\/EQ\/LRO_WAC_Mosaic_Global_303ppd_v02\/1\.0\.0\/default\/default028mm\/6\/\d+\/\d+\.jpg$/)
    expect(view.tiles.every((tile) => tile.or === undefined)).toBe(true)
    // It holds the point, with the ground asked for all round it.
    expect(Math.abs(view.lonDeg - 30.7723)).toBeLessThan(view.halfLonDeg)
    expect(Math.abs(view.latDeg - 20.1911)).toBeLessThan(view.halfLatDeg)
  })

  it('goes on to the region’s own mosaic past 83 m a pixel, with the whole-Moon tile standing in while it is not too coarse', () => {
    const near = detailWindow(30.7723, 20.1911, 3000, 30)!
    expect(near.product).toBe('A17_60x60km.eq')
    expect(near.level).toBe(9)
    expect(near.tiles[0].or?.url).toMatch(/LRO_WAC_Mosaic_Global_303ppd_v02\/1\.0\.0\/default\/default028mm\/8\//)
    expect(near.tiles[0].or?.crop.size).toBe(128)
    const closest = detailWindow(30.7723, 20.1911, 300, 0.43)!
    expect(closest.level).toBe(15)
    expect(closest.metresPerPixel).toBeCloseTo(0.651, 3)
    expect(closest.tiles.every((tile) => tile.or === undefined)).toBe(true)
  })

  it('stops at the whole-Moon mosaic’s finest level where no region has a picture', () => {
    expect(detailWindow(32.32, -69.3741, 300, 1)?.level).toBe(8)
    expect(detailWindow(32.32, -69.3741, 300, 1)?.product).toBe(WAC.product)
  })

  it('never holds more than 2,048 pixels a side, and takes a coarser level for a wide view', () => {
    for (const [reach, scale] of [[150_000, 420], [30_000, 60], [2000, 2], [400, 0.43]] as const) {
      const view = detailWindow(23.47314, 0.67416, reach, scale)!
      expect(view.widthPx).toBeLessThanOrEqual(2048)
      expect(view.heightPx).toBeLessThanOrEqual(2048)
    }
    // Far south a degree of longitude is short: the same ground takes more tiles across, so a coarser level.
    expect(detailWindow(1.44, -80.13, 20_000, 60)!.level).toBeLessThan(detailWindow(1.44, 0, 20_000, 60)!.level)
  })

  it('stays in one piece across 180 degrees, and leaves the poles to the polar pictures', () => {
    const view = detailWindow(179.99, -45, 20_000, 60)!
    const columns = view.tiles.map((tile) => Number(tile.url.split('/').pop()!.split('.')[0]))
    expect(new Set(columns).size).toBeGreaterThan(1)
    expect(Math.max(...columns)).toBe(2 ** (view.level + 1) - 1)
    expect(Math.min(...columns)).toBe(0)
    expect(detailWindow(0, -89.5, 5000, 20)).toBeNull()
  })

  it('is nothing while the globe’s own maps are as sharp as the screen, and has the same name for the same tiles', () => {
    expect(detailWindow(30.7723, 20.1911, 2_000_000, 6000)).toBeNull()
    const a = detailWindow(30.7723, 20.1911, 3000, 30)!
    const b = detailWindow(30.7724, 20.1911, 3000, 30)!
    expect(detailWindowKey(a)).toBe(detailWindowKey(b))
  })
})
