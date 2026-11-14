import { describe, expect, it } from 'vitest'
import { horizonsQueryUrl, withinWords } from './horizonsLink'

describe('horizonsQueryUrl', () => {
  const url = new URL(horizonsQueryUrl('sun', -89.45, -137.31, 1.234, '2027-05-13T12:00:00Z'))

  it('asks the Horizons API', () => {
    expect(url.origin + url.pathname).toBe('https://ssd.jpl.nasa.gov/api/horizons.api')
  })

  it('asks the pipeline’s question: a surface point on the Moon, apparent azimuth and elevation in degrees', () => {
    expect(url.searchParams.get('COMMAND')).toBe("'10'")
    expect(url.searchParams.get('CENTER')).toBe("'coord@301'")
    expect(url.searchParams.get('COORD_TYPE')).toBe("'GEODETIC'")
    expect(url.searchParams.get('QUANTITIES')).toBe("'4'")
    expect(url.searchParams.get('ANG_FORMAT')).toBe("'DEG'")
  })

  it('gives the point as east longitude from 0 to 360, latitude, height in km', () => {
    expect(url.searchParams.get('SITE_COORD')).toBe("'222.69,-89.45,1.234'")
  })

  it('asks for the one hour on screen', () => {
    expect(url.searchParams.get('START_TIME')).toBe("'2027-05-13 12:00'")
    expect(url.searchParams.get('STOP_TIME')).toBe("'2027-05-13 12:01'")
    expect(url.searchParams.get('STEP_SIZE')).toBe("'1h'")
  })

  it('asks about Earth by its own number', () => {
    expect(new URL(horizonsQueryUrl('earth', 0.67, 23.47, -1.9, '2030-12-31T23:00:00Z')).searchParams.get('COMMAND')).toBe("'399'")
  })
})

describe('withinWords', () => {
  it('rounds up to the hundredth', () => {
    expect(withinWords(0.007)).toBe('0.01°')
    expect(withinWords(0.01)).toBe('0.01°')
    expect(withinWords(0.0101)).toBe('0.02°')
  })
})
