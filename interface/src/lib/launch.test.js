// What the incident launcher actually puts on the wire, and what it makes of
// every answer POST /sensor can give. No defaults anywhere: an incident is
// what the operator typed, or nothing is sent.

import { describe, expect, it, vi } from 'vitest'

import {
  COMING_SOON,
  COMING_SOON_REASON,
  SENSOR_FIELDS,
  SIMULATION_CAPABILITIES,
  SUPERVISOR_AREAS,
  UNSUPPORTED_REASON,
  buildSensorInput,
  capabilityOf,
  isOperational,
  presetFields,
  supervisorAreaAt,
  createSubmitGuard,
  makeEventId,
  newDraft,
  validateSensorInput,
} from './launch'
import { LaunchError, checkHealth, fetchCapabilities, triggerEvent } from './socket'
import { capabilitiesTarget, healthTarget, sensorTarget } from './endpoints'
import {
  lifecycleLabel,
  maskPhone,
  rescueStatusLabel,
  severityLabel,
  smsStatusLabel,
  stageLabel,
} from './format'
import { ERROR_SEVERITY, zoneBand } from '../constants/zones'
import { ERROR_CODES } from './validate'

const NOW = 1_757_700_000_000

/** A complete, valid SensorInput. */
const payload = (over = {}) => ({
  event_id: 'EQ-20260912-0001',
  disaster_type: 'earthquake',
  timestamp: NOW,
  severity: 6.8,
  epicenter: { latitude: 33.5731, longitude: -7.5898 },
  radius_km: 15,
  depth_km: 10.5,
  aftershock_risk: 'HIGH',
  tsunami_risk: false,
  ...over,
})

/** A filled-in launcher form. */
const filled = (over = {}) => ({
  ...newDraft(NOW),
  disaster_type: 'earthquake',
  severity: '6.8',
  latitude: '33.5731',
  longitude: '-7.5898',
  radius_km: '15',
  depth_km: '10.5',
  aftershock_risk: 'HIGH',
  tsunami_risk: 'false',
  ...over,
})

const CAPS = {
  contract_version: 2,
  disaster_types: { earthquake: 'operational', flood: 'operational', heatwave: 'unsupported' },
  limits: {
    event_id_max_length: 64,
    severity: { min: 0, max: 10 },
    radius_km: { exclusive_min: 0, max: 500 },
    depth_km: { min: 0, max: 800 },
  },
}

/** A fetch that answers once with `status` and a JSON body. */
function answer(status, body) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }))
}

async function failure(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected a LaunchError')
}

describe('the launcher draft', () => {
  it('makeEventId: <PREFIX>-<base36 ms>, safe characters only', () => {
    expect(makeEventId('eq', NOW)).toBe(`EQ-${NOW.toString(36).toUpperCase()}`)
    expect(makeEventId('a b/c', NOW)).toMatch(/^ABC-/)
    expect(makeEventId('', NOW)).toMatch(/^EVENT-/)
  })

  it('newDraft has an event id and a timestamp, and EMPTY measurements', () => {
    const d = newDraft(NOW)
    expect(d.event_id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)
    expect(d.timestamp).toBe(String(NOW))
    for (const key of ['disaster_type', 'severity', 'latitude', 'longitude', 'radius_km', 'depth_km', 'aftershock_risk', 'tsunami_risk']) {
      expect(d[key]).toBe('')
    }
  })

  it('an untouched draft builds nothing sendable: every measurement is required', () => {
    const { ok, errors } = buildSensorInput(newDraft(NOW))
    expect(ok).toBe(false)
    expect(errors).toEqual({
      disaster_type: 'required',
      severity: 'required',
      'epicenter.latitude': 'required',
      'epicenter.longitude': 'required',
      radius_km: 'required',
      depth_km: 'required',
      aftershock_risk: 'required',
      tsunami_risk: 'required',
    })
  })

  it('buildSensorInput turns form strings into the exact SensorInput', () => {
    const { ok, payload: p, errors } = buildSensorInput(filled())
    expect(errors).toEqual({})
    expect(ok).toBe(true)
    expect(p).toEqual(payload({ event_id: newDraft(NOW).event_id }))
    expect(Object.keys(p).sort()).toEqual([...SENSOR_FIELDS].sort())
  })

  it('buildSensorInput reports text that is not a number, and range errors', () => {
    const { errors } = buildSensorInput(filled({ severity: 'strong', radius_km: '0', latitude: '91', timestamp: '12abc' }))
    expect(errors.severity).toBe('must be a number')
    expect(errors.radius_km).toMatch(/> 0/)
    expect(errors['epicenter.latitude']).toMatch(/between -90 and 90/)
    expect(errors.timestamp).toMatch(/integer/)
  })
})

describe('validateSensorInput mirrors POST /sensor (§2.1)', () => {
  it('accepts a complete earthquake', () => {
    expect(validateSensorInput(payload())).toEqual({ ok: true, errors: {} })
  })

  it('every field is required, and unknown fields are refused', () => {
    for (const key of SENSOR_FIELDS) {
      const p = payload()
      delete p[key]
      expect(validateSensorInput(p).errors[key]).toBe('required')
    }
    expect(validateSensorInput(payload({ shelter_name: 'x' })).errors.shelter_name).toBe('unknown field')
    expect(validateSensorInput(payload({ epicenter: { latitude: 1, longitude: 2, altitude: 3 } })).errors['epicenter.altitude']).toBe('unknown field')
    expect(validateSensorInput(null).ok).toBe(false)
  })

  it('event_id: 1..64 characters, letter or digit first', () => {
    expect(validateSensorInput(payload({ event_id: '' })).errors.event_id).toBeDefined()
    expect(validateSensorInput(payload({ event_id: 'x'.repeat(65) })).errors.event_id).toBeDefined()
    expect(validateSensorInput(payload({ event_id: '-EQ' })).errors.event_id).toBeDefined()
    expect(validateSensorInput(payload({ event_id: 'EQ 1' })).errors.event_id).toBeDefined()
    expect(validateSensorInput(payload({ event_id: 'x'.repeat(64) })).ok).toBe(true)
    expect(validateSensorInput(payload({ event_id: 'a.b_c:d-1' })).ok).toBe(true)
  })

  it('ranges: timestamp, severity, coordinates, radius, depth', () => {
    const err = (over) => validateSensorInput(payload(over)).errors
    expect(err({ timestamp: 0 }).timestamp).toBeDefined()
    expect(err({ timestamp: 1.5 }).timestamp).toBeDefined()
    expect(err({ severity: -0.1 }).severity).toBeDefined()
    expect(err({ severity: 10.1 }).severity).toBeDefined()
    expect(err({ severity: Number.NaN }).severity).toBeDefined()
    expect(err({ severity: '6.8' }).severity).toBeDefined()
    expect(err({ epicenter: { latitude: 90.01, longitude: 0 } })['epicenter.latitude']).toBeDefined()
    expect(err({ epicenter: { latitude: 0, longitude: -180.01 } })['epicenter.longitude']).toBeDefined()
    expect(err({ radius_km: 0 }).radius_km).toBeDefined()
    expect(err({ radius_km: 500.01 }).radius_km).toBeDefined()
    expect(err({ radius_km: Number.POSITIVE_INFINITY }).radius_km).toBeDefined()
    expect(err({ depth_km: -1 }).depth_km).toBeDefined()
    expect(err({ depth_km: 800.5 }).depth_km).toBeDefined()
    expect(validateSensorInput(payload({ severity: 0, radius_km: 500, depth_km: 0 })).ok).toBe(true)
    expect(validateSensorInput(payload({ severity: 10, radius_km: 0.1, depth_km: 800 })).ok).toBe(true)
  })

  it('enums and booleans', () => {
    const err = (over) => validateSensorInput(payload(over)).errors
    expect(err({ aftershock_risk: 'EXTREME' }).aftershock_risk).toBeDefined()
    expect(err({ aftershock_risk: 'high' }).aftershock_risk).toBeDefined()
    expect(err({ tsunami_risk: 'false' }).tsunami_risk).toBe('must be a boolean')
    expect(err({ disaster_type: 'tornado' }).disaster_type).toMatch(/one of/)
  })

  it('only operational types are accepted — earthquake alone when capabilities are unknown', () => {
    expect(validateSensorInput(payload({ disaster_type: 'flood' })).errors.disaster_type).toBe(UNSUPPORTED_REASON)
    expect(validateSensorInput(payload({ disaster_type: 'heatwave' })).errors.disaster_type).toBe(UNSUPPORTED_REASON)
    // A supervisor that reports flood as operational gets flood.
    expect(validateSensorInput(payload({ disaster_type: 'flood', depth_km: 0 }), CAPS).ok).toBe(true)
    expect(validateSensorInput(payload({ disaster_type: 'heatwave' }), CAPS).errors.disaster_type).toBe(UNSUPPORTED_REASON)
  })

  it('reads limits from capabilities when the supervisor reports them', () => {
    const tight = { ...CAPS, limits: { ...CAPS.limits, radius_km: { exclusive_min: 0, max: 100 } } }
    expect(validateSensorInput(payload({ radius_km: 150 }), tight).errors.radius_km).toMatch(/100/)
  })
})

describe('createSubmitGuard', () => {
  it('blocks a second submit while the first is pending, then allows the next', async () => {
    const changes = []
    const guard = createSubmitGuard({ onChange: (v) => changes.push(v) })
    let release
    const task = vi.fn(() => new Promise((resolve) => { release = resolve }))

    const first = guard.run(task)
    expect(guard.isPending()).toBe(true)
    expect(guard.run(task)).toBeNull()
    expect(task).toHaveBeenCalledTimes(1)

    release('done')
    await expect(first).resolves.toBe('done')
    expect(guard.isPending()).toBe(false)
    expect(changes).toEqual([true, false])

    await guard.run(async () => 'again')
    expect(guard.isPending()).toBe(false)
  })

  it('releases after a failure too', async () => {
    const guard = createSubmitGuard()
    await expect(guard.run(() => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(guard.isPending()).toBe(false)
  })
})

describe('triggerEvent', () => {
  it('POSTs the payload exactly as given; 202 is accepted, not complete', async () => {
    const fetchImpl = answer(202, { status: 'accepted', event_id: 'EQ-20260912-0001', contract_version: 2 })
    const res = await triggerEvent(payload(), { url: '/sensor', fetchImpl })

    expect(res).toEqual({ outcome: 'accepted', status: 202, body: { status: 'accepted', event_id: 'EQ-20260912-0001', contract_version: 2 } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/sensor')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual(payload())
  })

  it('200 duplicate is reported as a duplicate — nothing new started', async () => {
    const res = await triggerEvent(payload(), { fetchImpl: answer(200, { status: 'duplicate', event_id: 'EQ-20260912-0001', lifecycle: 'running' }) })
    expect(res.outcome).toBe('duplicate')
    expect(res.body.lifecycle).toBe('running')
  })

  it('409 pipeline_busy names the running incident', async () => {
    const err = await failure(triggerEvent(payload(), { fetchImpl: answer(409, { error: 'pipeline_busy', active_event_id: 'EQ-OTHER-7' }) }))
    expect(err).toBeInstanceOf(LaunchError)
    expect(err.kind).toBe('busy')
    expect(err.status).toBe(409)
    expect(err.body.active_event_id).toBe('EQ-OTHER-7')
    expect(err.message).toContain('EQ-OTHER-7')
  })

  it('409 event_id_conflict is a conflict', async () => {
    const err = await failure(triggerEvent(payload(), {
      fetchImpl: answer(409, { error: 'event_id_conflict', event_id: 'EQ-20260912-0001', detail: 'event_id already used with a different payload' }),
    }))
    expect(err.kind).toBe('conflict')
    expect(err.message).toContain('already used')
  })

  it('422 carries the field errors', async () => {
    const err = await failure(triggerEvent(payload(), {
      fetchImpl: answer(422, { error: 'validation_failed', fields: { disaster_type: UNSUPPORTED_REASON } }),
    }))
    expect(err.kind).toBe('invalid')
    expect(err.status).toBe(422)
    expect(err.fields).toEqual({ disaster_type: UNSUPPORTED_REASON })
  })

  it('400 and other refusals are rejected', async () => {
    const err = await failure(triggerEvent(payload(), { fetchImpl: answer(400, { error: 'invalid_json', detail: 'x' }) }))
    expect(err.kind).toBe('rejected')
    expect(err.status).toBe(400)
    const forbidden = await failure(triggerEvent(payload(), { fetchImpl: answer(403, { error: 'origin_not_allowed' }) }))
    expect(forbidden.kind).toBe('rejected')
    expect(forbidden.message).toContain('origin_not_allowed')
  })

  it('a network TypeError is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const err = await failure(triggerEvent(payload(), { url: 'http://localhost:8080/sensor', fetchImpl }))
    expect(err.kind).toBe('unreachable')
    expect(err.status).toBeNull()
    expect(err.message).toContain('http://localhost:8080/sensor')
  })

  it.each([502, 503, 504])('%i is a gateway problem', async (status) => {
    const err = await failure(triggerEvent(payload(), { fetchImpl: answer(status, status === 503 ? { error: 'database_unavailable' } : undefined) }))
    expect(err.kind).toBe('gateway')
    expect(err.status).toBe(status)
  })

  it('refuses an incomplete payload without calling fetch — no defaults', async () => {
    const fetchImpl = answer(202, {})
    const incomplete = payload()
    delete incomplete.epicenter
    delete incomplete.depth_km

    const err = await failure(triggerEvent(incomplete, { fetchImpl }))
    expect(err.kind).toBe('invalid')
    expect(err.fields).toMatchObject({ epicenter: 'required', depth_km: 'required' })

    await failure(triggerEvent({}, { fetchImpl }))
    await failure(triggerEvent(undefined, { fetchImpl }))
    await failure(triggerEvent(payload({ disaster_type: 'flood' }), { fetchImpl }))
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('supervisor reads', () => {
  it('checkHealth returns ok, status and the parsed body — also for a 503', async () => {
    const body = { status: 'not_ready', checks: { database: { ok: false, error: 'timeout' } } }
    expect(await checkHealth({ url: '/health', fetchImpl: answer(503, body) })).toEqual({ ok: false, status: 503, body })
    expect(await checkHealth({ fetchImpl: answer(200, { status: 'ready' }) })).toMatchObject({ ok: true, status: 200 })
    expect(await checkHealth({ fetchImpl: vi.fn(async () => { throw new TypeError('x') }) })).toEqual({ ok: false, status: null, body: null })
  })

  it('fetchCapabilities returns the object, or null when it cannot be read', async () => {
    expect(await fetchCapabilities({ fetchImpl: answer(200, CAPS) })).toEqual(CAPS)
    expect(await fetchCapabilities({ fetchImpl: answer(404, { error: 'not found' }) })).toBeNull()
    expect(await fetchCapabilities({ fetchImpl: vi.fn(async () => { throw new TypeError('x') }) })).toBeNull()
  })

  it('capabilitiesTarget follows the same proxy rule as /sensor and /health', () => {
    const local = 'ws://localhost:8080/ws'
    expect(capabilitiesTarget(local, { dev: true })).toEqual({ url: '/capabilities', absolute: 'http://localhost:8080/capabilities', viaProxy: true })
    expect(capabilitiesTarget(local, { dev: false }).url).toBe('http://localhost:8080/capabilities')
    expect(capabilitiesTarget('wss://ops.example/ws', { dev: true })).toEqual({ url: 'https://ops.example/capabilities', absolute: 'https://ops.example/capabilities', viaProxy: false })
    expect(sensorTarget(local, { dev: true }).url).toBe('/sensor')
    expect(healthTarget(local, { dev: true }).url).toBe('/health')
  })
})

describe('display wording', () => {
  it('severityLabel: only an earthquake has a magnitude', () => {
    expect(severityLabel('earthquake', 6.8)).toBe('M 6.8')
    expect(severityLabel('flood', 6.8)).toBe('Flood severity 6.8')
    expect(severityLabel('heatwave', 6.8)).toBe('Heat severity 6.8')
    expect(severityLabel('tornado', 6.8)).toBe('Severity 6.8')
    expect(severityLabel('flood', 6.8)).not.toMatch(/M/)
    expect(severityLabel('heatwave', 3)).not.toMatch(/^M/)
    expect(severityLabel('earthquake', null)).toBe('—')
  })

  it('labels every stage, SMS status, rescue status and lifecycle; SMS without a gateway says nothing was sent', () => {
    for (const s of ['triaged', 'decided', 'decision_failed']) expect(stageLabel(s)).not.toBe('—')
    for (const s of ['not_requested', 'sent', 'failed', 'not_configured']) expect(smsStatusLabel(s)).not.toBe('—')
    for (const s of ['not_requested', 'recorded', 'failed']) expect(rescueStatusLabel(s)).not.toBe('—')
    for (const s of ['idle', 'running', 'completed', 'completed_with_failures', 'no_devices', 'failed']) expect(lifecycleLabel(s)).not.toBe('—')
    expect(smsStatusLabel('not_configured')).toBe('Not sent — no SMS gateway configured')
    expect(stageLabel(null)).toBe('—')
    expect(maskPhone('+212612345678')).toBe('+212 6** *** 678')
  })

  it('every error code has operator wording, and none is assumed fatal', () => {
    expect(Object.keys(ERROR_SEVERITY).sort()).toEqual([...ERROR_CODES].sort())
    for (const code of ERROR_CODES) expect(ERROR_SEVERITY[code]).not.toHaveProperty('fatal')
  })

  it('zoneBand uses the event bands, falling back to the contract ones', () => {
    expect(zoneBand('red', 15)).toBe('0–5 km')
    expect(zoneBand('green', 15)).toBe('10–15 km')
    expect(zoneBand('red', 10, { red: 0.5, orange: 0.8, green: 1 })).toBe('0–5 km')
    expect(zoneBand('red', 0)).toBe('')
  })
})

describe('presets and where a launch can run', () => {
  it('every preset fills a complete, valid SensorInput for the supervisor', () => {
    for (const area of SUPERVISOR_AREAS) {
      const draft = { ...newDraft(NOW), ...presetFields(area) }
      const { ok, payload, errors } = buildSensorInput(draft)
      expect(ok, JSON.stringify(errors)).toBe(true)
      expect(payload.disaster_type).toBe('earthquake')
      expect(payload.epicenter).toEqual({ latitude: area.epicenter.latitude, longitude: area.epicenter.longitude })
      expect(payload.radius_km).toBe(area.radius_km)
      expect(Object.keys(payload).sort()).toEqual([...SENSOR_FIELDS].sort())
    }
  })

  it('matches the supervisor fixture areas: Al Haouz, Agadir and Casablanca', () => {
    expect(SUPERVISOR_AREAS.map((a) => a.key)).toEqual(['al-haouz', 'agadir', 'casablanca'])
    expect(SUPERVISOR_AREAS.find((a) => a.key === 'al-haouz').epicenter).toEqual({ latitude: 31.058, longitude: -8.385 })
  })

  it('knows which points the supervisor holds subscribers for', () => {
    expect(supervisorAreaAt(31.2171, -8.2333)?.key).toBe('al-haouz')     // Amizmiz
    expect(supervisorAreaAt(30.3563, -9.5459)?.key).toBe('agadir')       // Inezgane
    expect(supervisorAreaAt(33.5731, -7.5898)?.key).toBe('casablanca')
    expect(supervisorAreaAt(40.7128, -74.006)).toBeNull()                 // New York
    expect(supervisorAreaAt(34.0209, -6.8416)).toBeNull()                 // Rabat
    expect(supervisorAreaAt(NaN, 1)).toBeNull()
  })

  it('the simulation runs earthquakes only: flood and heatwave are coming soon', () => {
    const base = { ...newDraft(NOW), ...presetFields(SUPERVISOR_AREAS[0]) }
    expect(buildSensorInput(base, SIMULATION_CAPABILITIES).ok).toBe(true)
    expect(isOperational('earthquake', SIMULATION_CAPABILITIES)).toBe(true)
    for (const type of ['flood', 'heatwave']) {
      const draft = { ...base, disaster_type: type }
      expect(isOperational(type, SIMULATION_CAPABILITIES)).toBe(false)
      expect(capabilityOf(type, SIMULATION_CAPABILITIES)).toBe(COMING_SOON)
      // Each refusal says why: coming soon in the simulation, not implemented
      // by today's supervisor.
      expect(buildSensorInput(draft, SIMULATION_CAPABILITIES).errors.disaster_type).toBe(COMING_SOON_REASON)
      expect(buildSensorInput(draft).errors.disaster_type).toBe(UNSUPPORTED_REASON)
    }
  })
})
