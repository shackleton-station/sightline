import { describe, expect, it } from 'vitest'
import {
  angularDistanceDeg,
  blendView,
  clampZoom,
  dragView,
  fitLabels,
  MAX_VIEW_LAT,
  MAX_ZOOM,
  MIN_ZOOM,
  siteAtCenter,
  toCanvas,
  project,
  unproject,
  viewFor,
  wrapLon,
} from './globe'

const near = { lat: 0, lon: 0 }

describe('project', () => {
  it('puts the view center in the middle, facing the viewer', () => {
    expect(project(0, 0, near)).toEqual({ x: 0, y: 0, facing: 1 })
  })

  it('puts east on the right and north up', () => {
    const east = project(0, 90, near)
    expect(east.x).toBeCloseTo(1)
    expect(project(90, 0, near).y).toBeCloseTo(1)
  })

  it('marks the far side as facing away', () => {
    expect(project(0, 180, near).facing).toBeLessThan(0)
  })
})

describe('unproject', () => {
  it('undoes project on the near side', () => {
    const view = { lat: -60, lon: 140 }
    for (const [lat, lon] of [
      [-89.45, -137.15],
      [-45, 150],
      [-70, 100],
    ]) {
      const { x, y, facing } = project(lat, lon, view)
      expect(facing).toBeGreaterThan(0)
      const back = unproject(x, y, view)
      expect(back?.lat).toBeCloseTo(lat, 6)
      expect(wrapLon((back?.lon ?? 0) - lon)).toBeCloseTo(0, 6)
    }
  })

  it('returns null off the disk', () => {
    expect(unproject(0.8, 0.8, near)).toBeNull()
  })
})

describe('views', () => {
  it('turns the globe with a drag, and never tips over a pole', () => {
    expect(dragView(near, 0.5, 0).lon).toBeCloseTo(-45)
    expect(dragView(near, 0, -5).lat).toBe(MAX_VIEW_LAT)
  })

  it('keeps a polar site in view, short of the pole', () => {
    expect(viewFor(-89.45, 10).lat).toBe(-MAX_VIEW_LAT)
  })

  it('blends the short way across the 180° line', () => {
    expect(blendView({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 0.5).lon).toBeCloseTo(-180, 6)
  })
})

describe('fitLabels', () => {
  it('keeps the first of two overlapping labels and drops the second', () => {
    const kept = fitLabels(
      [
        { key: 'a', text: 'Mare Imbrium', x: 0, y: 0 },
        { key: 'b', text: 'Montes Alpes', x: 0.02, y: 0.01 },
        { key: 'c', text: 'Far away', x: 0.5, y: 0.5 },
      ],
      400,
    )
    expect([...kept]).toEqual(['a', 'c'])
  })

  it('drops a label that would spill past the edge', () => {
    expect(fitLabels([{ key: 'a', text: 'Oceanus Procellarum', x: -0.95, y: 0 }], 300).size).toBe(0)
  })
})

describe('zoom', () => {
  it('keeps zoom within its limits', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
  })

  it('puts a point outside the box once zoom pushes it past the edge', () => {
    expect(toCanvas({ x: 0.3, y: 0 }, 2)).toEqual({ x: 0.6, y: 0, inside: true })
    expect(toCanvas({ x: 0.3, y: 0 }, 4).inside).toBe(false)
  })
})

describe('siteAtCenter', () => {
  const sites = [
    { id: 'pole', lat: -89.45, lon: -137.15 },
    { id: 'apollo-11', lat: 0.67, lon: 23.47 },
  ]

  it('finds the site under the view', () => {
    expect(siteAtCenter(sites, { lat: -89.45, lon: -137.15 }, 3)?.id).toBe('pole')
    expect(siteAtCenter(sites, { lat: 1, lon: 23 }, 3)?.id).toBe('apollo-11')
  })

  it('finds nothing when no site is near the center', () => {
    expect(siteAtCenter(sites, { lat: 40, lon: -60 }, 3)).toBeNull()
  })

  it('measures angles on the sphere', () => {
    expect(angularDistanceDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(90)
    expect(angularDistanceDeg({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBeCloseTo(2)
  })
})

describe('limits a page can set for itself', () => {
  it('lets a view go nearer the pole, and zoom out past the whole Moon, only when asked', () => {
    expect(dragView({ lat: -70, lon: 0 }, 0, 1).lat).toBe(-MAX_VIEW_LAT)
    expect(dragView({ lat: -70, lon: 0 }, 0, 1, 89).lat).toBe(-89)
    expect(clampZoom(0.4)).toBe(MIN_ZOOM)
    expect(clampZoom(0.4, 0.5)).toBe(0.5)
    expect(clampZoom(0.7, 0.5)).toBe(0.7)
    expect(clampZoom(20, 0.5, 6)).toBe(6)
  })
})
