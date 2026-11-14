/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { fromAzEl } from './camera3d'
import { toLocalDirection } from './moon3d'

const dataFile = (path: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${path}`, import.meta.url)), 'utf8'))

describe('3D directions', () => {
  it('reads east, north and up at a site', () => {
    // On the equator at longitude 0: up is +x, east is +y and north is +z.
    expect(toLocalDirection([0, 1, 0], 0, 0)[0]).toBeCloseTo(1)
    expect(toLocalDirection([0, 0, 1], 0, 0)[1]).toBeCloseTo(1)
    expect(toLocalDirection([1, 0, 0], 0, 0)[2]).toBeCloseTo(1)
  })

  // The frame check: the Sun that lights the 3D view must be the Sun the panorama shows.
  it.each(['connecting-ridge', 'peak-near-shackleton', 'apollo-11', 'chandrayaan-3', 'change-4'])(
    'lights %s from the azimuth and elevation in the panorama',
    (id) => {
      const sites: SiteInfo[] = dataFile('sites.json')
      const site = sites.find((candidate) => candidate.id === id)
      if (!site) throw new Error(`No site ${id}`)
      const track: TrackPoint[] = dataFile(`${id}/2027-05/track.json`)
      expect(track.length).toBeGreaterThan(700)
      for (const point of track) {
        const local = toLocalDirection(point.sun_vec_me, site.lat, site.lon)
        const shown = fromAzEl(point.sun_az, point.sun_el)
        // From the cross product, because the exported vector is rounded and isn't exactly unit length.
        const [x, y, z] = local
        const [u, v, w] = shown
        const sine = Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u)
        const gapDeg = (Math.atan2(sine, x * u + y * v + z * w) * 180) / Math.PI
        expect(gapDeg).toBeLessThan(0.05)
      }
    },
  )
})
