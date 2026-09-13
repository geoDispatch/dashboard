import { describe, expect, it, vi } from 'vitest'

import { coordinatePlace, parseCoordinates, photonUrl, searchPlaces, toPlace } from './geocode'

// A trimmed copy of Photon's real answer to "new y".
const PHOTON_NEW_Y = {
  features: [
    {
      geometry: { coordinates: [-74.0060152, 40.7127281] },
      properties: { osm_type: 'R', osm_id: 175905, osm_key: 'place', osm_value: 'city', type: 'city', name: 'New York', state: 'New York', country: 'United States', extent: [-74.258843, 40.91763, -73.700233, 40.476578] },
    },
    {
      geometry: { coordinates: [-75.8449946, 43.1561681] },
      properties: { osm_type: 'R', osm_id: 61320, osm_key: 'boundary', osm_value: 'administrative', type: 'state', name: 'New York', country: 'United States' },
    },
    {
      geometry: { coordinates: [-73.9950148, 40.7292053] },
      properties: { osm_key: 'building', osm_value: 'university', type: 'house', name: 'New York University', state: 'New York', country: 'United States' },
    },
    {
      geometry: { coordinates: [-73.8802087, 40.9787934] },
      properties: { osm_key: 'highway', osm_value: 'primary', type: 'street', name: 'New Broadway', state: 'New York', country: 'United States' },
    },
  ],
}

const fakeFetch = (body, init = {}) => vi.fn(async () => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body }))

describe('parseCoordinates', () => {
  it('reads decimal pairs, latitude first', () => {
    expect(parseCoordinates('31.058, -8.385')).toEqual({ latitude: 31.058, longitude: -8.385 })
    expect(parseCoordinates('  40.7128 -74.006 ')).toEqual({ latitude: 40.7128, longitude: -74.006 })
    expect(parseCoordinates('33.5731;-7.5898')).toEqual({ latitude: 33.5731, longitude: -7.5898 })
  })

  it('reads degrees, minutes and seconds with hemispheres', () => {
    const p = parseCoordinates(`31°03'29"N 8°23'06"W`)
    expect(p.latitude).toBeCloseTo(31.058, 3)
    expect(p.longitude).toBeCloseTo(-8.385, 3)
  })

  it('refuses what is not a point on Earth', () => {
    expect(parseCoordinates('new york')).toBeNull()
    expect(parseCoordinates('91, 10')).toBeNull()
    expect(parseCoordinates('10, 181')).toBeNull()
    expect(parseCoordinates('')).toBeNull()
    expect(parseCoordinates(null)).toBeNull()
  })
})

describe('toPlace', () => {
  it('labels a place city, region, country — never the county', () => {
    const rabat = toPlace({
      geometry: { coordinates: [-6.8498, 34.0209] },
      properties: { osm_key: 'place', osm_value: 'city', type: 'city', name: 'Rabat', county: 'باشوية الرباط', state: 'Rabat-Salé-Kénitra', country: 'Morocco' },
    })
    expect(rabat.label).toBe('Rabat, Rabat-Salé-Kénitra, Morocco')
  })

  it('keeps cities and states, drops buildings and streets', () => {
    const places = PHOTON_NEW_Y.features.map(toPlace)
    expect(places[0]).toMatchObject({ name: 'New York', label: 'New York, United States', kind: 'city', zoom: 11 })
    expect(places[0].bounds).toEqual([[40.476578, -74.258843], [40.91763, -73.700233]])
    expect(places[1]).toMatchObject({ kind: 'state', zoom: 7 })
    expect(places[2]).toBeNull()
    expect(places[3]).toBeNull()
  })
})

describe('searchPlaces', () => {
  it('sends only the typed text to Photon and returns places, duplicates folded', async () => {
    const fetchImpl = fakeFetch(PHOTON_NEW_Y)
    const { places, error } = await searchPlaces('new y', { fetchImpl })
    expect(error).toBeNull()
    expect(places.map((p) => p.label)).toEqual(['New York, United States'])
    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/')
    expect(url.searchParams.get('q')).toBe('new y')
    expect([...url.searchParams.keys()].sort()).toEqual(['lang', 'limit', 'q'])
  })

  it('answers coordinates locally, without a request', async () => {
    const fetchImpl = fakeFetch(PHOTON_NEW_Y)
    const { places } = await searchPlaces('31.058, -8.385', { fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(places).toEqual([coordinatePlace({ latitude: 31.058, longitude: -8.385 })])
  })

  it('does not search on a single character', async () => {
    const fetchImpl = fakeFetch(PHOTON_NEW_Y)
    expect((await searchPlaces('n', { fetchImpl })).places).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports an unreachable or failing service instead of throwing', async () => {
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect((await searchPlaces('agadir', { fetchImpl: down })).error).toMatch(/unreachable/)
    expect((await searchPlaces('agadir', { fetchImpl: fakeFetch({}, { ok: false, status: 503 }) })).error).toMatch(/503/)
  })

  it('lets an abort through, so a superseded search can be dropped', async () => {
    const aborted = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    await expect(searchPlaces('agadir', { fetchImpl: aborted })).rejects.toThrow('aborted')
  })

  it('builds a request with nothing but the query, the limit and the language', () => {
    expect(photonUrl('  Casablanca ')).toBe('https://photon.komoot.io/api/?q=Casablanca&limit=6&lang=en')
  })
})
