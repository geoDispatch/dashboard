// What the incident launcher actually puts on the wire.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildLaunchPayload, depthFor, makeEventId, EARTHQUAKE_DEPTH_KM } from './launch'
import { triggerEvent } from './socket'

const NOW = 1_700_000_000_000

const quake = {
  idPrefix: 'AL-HAOUZ',
  disaster_type: 'earthquake',
  severity: 6.8,
  epicenter: { latitude: 31.11, longitude: -8.41 },
  radius_km: 50,
  aftershock_risk: 'HIGH',
  tsunami_risk: false,
}

describe('depth_km', () => {
  it('is a hypocentre depth for an earthquake', () => {
    expect(depthFor('earthquake')).toBe(EARTHQUAKE_DEPTH_KM)
    expect(depthFor('earthquake')).toBe(10.5)
  })

  it('is zero for events that have no hypocentre', () => {
    expect(depthFor('flood')).toBe(0)
    expect(depthFor('heatwave')).toBe(0)
  })
})

describe('buildLaunchPayload', () => {
  it('builds a complete SensorInput for an earthquake', () => {
    expect(buildLaunchPayload(quake, { now: NOW })).toEqual({
      event_id: 'AL-HAOUZ-LOYW3V28',
      disaster_type: 'earthquake',
      timestamp: NOW,
      severity: 6.8,
      epicenter: { latitude: 31.11, longitude: -8.41 },
      radius_km: 50,
      depth_km: 10.5,
      aftershock_risk: 'HIGH',
      tsunami_risk: false,
    })
  })

  it('sends depth 0 for a flood', () => {
    const body = buildLaunchPayload(
      { ...quake, idPrefix: 'CUSTOM', disaster_type: 'flood', severity: 4.2, tsunami_risk: true },
      { now: NOW },
    )
    expect(body.depth_km).toBe(0)
    expect(body.disaster_type).toBe('flood')
    expect(body.tsunami_risk).toBe(true)
  })

  it('sends depth 0 for a heatwave', () => {
    const body = buildLaunchPayload(
      { ...quake, disaster_type: 'heatwave', severity: 9 },
      { now: NOW },
    )
    expect(body.depth_km).toBe(0)
    expect(body.disaster_type).toBe('heatwave')
  })

  it('carries the epicentre through untouched', () => {
    const body = buildLaunchPayload(
      { ...quake, epicenter: { latitude: 33.5731, longitude: -7.5898 }, radius_km: 15, severity: 6.2 },
      { now: NOW },
    )
    expect(body.epicenter).toEqual({ latitude: 33.5731, longitude: -7.5898 })
    expect(body.radius_km).toBe(15)
    expect(body.severity).toBe(6.2)
  })
})

describe('event id', () => {
  it('is stable for one attempt and derived from the scenario', () => {
    const id = makeEventId('CASA', NOW)
    expect(id.startsWith('CASA-')).toBe(true)
    // The same attempt reuses the same id everywhere it appears.
    expect(buildLaunchPayload(quake, { now: NOW, eventId: id }).event_id).toBe(id)
  })

  it('does not label a Casablanca event as Al Haouz', () => {
    const body = buildLaunchPayload({ ...quake, idPrefix: 'CASA' }, { now: NOW })
    expect(body.event_id).toMatch(/^CASA-/)
    expect(body.event_id).not.toMatch(/HAOUZ/)
  })

  it('a later attempt gets its own id', () => {
    expect(makeEventId('CASA', NOW)).not.toBe(makeEventId('CASA', NOW + 1000))
  })
})

describe('triggerEvent', () => {
  afterEach(() => { delete globalThis.fetch })

  it('POSTs the payload verbatim and returns it on 2xx', async () => {
    let seen = null
    globalThis.fetch = vi.fn(async (url, init) => {
      seen = { url, body: JSON.parse(init.body), method: init.method }
      return { ok: true, status: 202, statusText: 'Accepted' }
    })

    const body = buildLaunchPayload({ ...quake, disaster_type: 'flood' }, { now: NOW })
    const returned = await triggerEvent(body, { url: '/sensor' })

    expect(seen.method).toBe('POST')
    expect(seen.url).toBe('/sensor')
    expect(seen.body).toEqual(body)
    expect(seen.body.depth_km).toBe(0)
    expect(returned).toEqual(body)
  })

  it('throws on a non-2xx answer, so nothing can claim success', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request' }))
    await expect(triggerEvent(buildLaunchPayload(quake, { now: NOW }), { url: '/sensor' }))
      .rejects.toThrow(/400/)
  })

  it('throws when the request never reaches anything', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(triggerEvent(buildLaunchPayload(quake, { now: NOW }), { url: '/sensor' }))
      .rejects.toThrow(/Failed to fetch/)
  })
})
