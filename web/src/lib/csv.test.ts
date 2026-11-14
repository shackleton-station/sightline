import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../data/contract'
import { csvFileName, trackCsv } from './csv'

const point: TrackPoint = {
  t: '2027-05-01T00:00:00Z',
  sun_az: 123.45,
  sun_el: -0.5,
  sun_frac: 0.25,
  sun_up: true,
  earth_az: 10,
  earth_el: 1.2,
  earth_up: false,
  sun_vec_me: [1, 0, 0],
} as TrackPoint

describe('trackCsv', () => {
  it('writes a header and one row per hour, without the drawing vector', () => {
    const lines = trackCsv([point, point]).trimEnd().split('\n')
    expect(lines[0]).toBe('t,sun_az,sun_el,sun_frac,sun_up,earth_az,earth_el,earth_up')
    expect(lines[1]).toBe('2027-05-01T00:00:00Z,123.45,-0.5,0.25,true,10,1.2,false')
    expect(lines).toHaveLength(3)
  })
})

describe('csvFileName', () => {
  it('keeps curated ids and makes custom points safe', () => {
    expect(csvFileName('connecting-ridge', '2027-05')).toBe('connecting-ridge_2027-05_hourly.csv')
    expect(csvFileName('-89.4,12.5', '2027-05')).toBe('-89.4_12.5_2027-05_hourly.csv')
  })
})
