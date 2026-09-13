// validateFrame: every rule of contract v2, and nothing half-valid gets through.

import { describe, expect, it } from 'vitest'

import {
  CONTROL_TYPES,
  EVENT_TYPES,
  MESSAGE_TYPES,
  ZONE_BAND_FALLBACK,
  validateFrame,
} from './validate'
import { ZONE_RADIUS_THRESHOLDS } from '../constants/zones'
import {
  EVENT_A,
  completePayload,
  contextPayload,
  decidedPayload,
  devicePayload,
  envelope,
  errorPayload,
  heartbeat,
  narrativePayload,
  snapshotBegin,
  snapshotEnd,
  startPayload,
  summaryPayload,
} from './v2frames.fixture'

const VALID = {
  snapshot_begin:   snapshotBegin(EVENT_A, 5),
  snapshot_end:     snapshotEnd(EVENT_A, 5, 4),
  heartbeat:        heartbeat('', 0, 'idle', false),
  event_start:      envelope('event_start', EVENT_A, 1, startPayload()),
  event_context:    envelope('event_context', EVENT_A, 2, contextPayload()),
  device_update:    envelope('device_update', EVENT_A, 3, decidedPayload()),
  zone_summary:     envelope('zone_summary', EVENT_A, 4, summaryPayload()),
  narrative_update: envelope('narrative_update', EVENT_A, 5, narrativePayload()),
  error:            envelope('error', EVENT_A, 6, errorPayload()),
  event_complete:   envelope('event_complete', EVENT_A, 7, completePayload()),
}

const device = (over) => envelope('device_update', EVENT_A, 3, devicePayload(over))

const reject = (frame) => {
  const r = validateFrame(frame)
  expect(r.ok).toBe(false)
  return r.reason
}

// The spec's prose says "11 types" but enumerates ten (seven event, three
// control); the enumeration and the schema's oneOf are what count.
describe('the ten message types', () => {
  it('lists exactly seven event types and three control types', () => {
    expect(EVENT_TYPES).toHaveLength(7)
    expect(CONTROL_TYPES).toEqual(['snapshot_begin', 'snapshot_end', 'heartbeat'])
    expect(MESSAGE_TYPES).toHaveLength(10)
  })

  it.each(Object.keys(VALID))('accepts a valid %s frame', (type) => {
    const r = validateFrame(VALID[type])
    expect(r).toEqual({ ok: true, frame: VALID[type] })
  })

  it('accepts raw JSON text and rejects text that is not JSON', () => {
    expect(validateFrame(JSON.stringify(VALID.device_update)).ok).toBe(true)
    expect(validateFrame('{"v":2,')).toEqual({ ok: false, reason: 'invalid JSON' })
  })
})

describe('envelope', () => {
  it.each(['v', 'type', 'event_id', 'seq', 'timestamp', 'replay', 'payload'])(
    'requires %s',
    (key) => {
      const f = { ...VALID.device_update }
      delete f[key]
      expect(reject(f)).toMatch(new RegExp(`${key}: required`))
    },
  )

  it('refuses another version, an unknown type and an extra envelope field', () => {
    expect(reject({ ...VALID.event_start, v: 1 })).toMatch(/v: must be 2/)
    expect(reject({ ...VALID.event_start, type: 'device_removed' })).toMatch(/unknown message type/)
    expect(reject({ ...VALID.event_start, extra: true })).toMatch(/unknown envelope field/)
  })

  it('enforces seq rules for event and control frames', () => {
    expect(reject({ ...VALID.event_start, seq: 2 })).toMatch(/event_start must be 1/)
    expect(reject({ ...VALID.device_update, seq: 0 })).toMatch(/≥ 1/)
    expect(reject({ ...VALID.device_update, seq: 2.5 })).toMatch(/seq/)
    expect(reject({ ...VALID.heartbeat, seq: 3 })).toMatch(/must be 0 on a control frame/)
    expect(reject({ ...VALID.snapshot_begin, replay: true })).toMatch(/replay/)
  })

  it('allows an empty event_id only on control frames', () => {
    expect(validateFrame(snapshotBegin('', 0, 'idle')).ok).toBe(true)
    expect(reject({ ...VALID.device_update, event_id: '' })).toMatch(/event_id: required/)
  })

  it('requires a positive integer timestamp and a boolean replay', () => {
    expect(reject({ ...VALID.error, timestamp: 0 })).toMatch(/timestamp/)
    expect(reject({ ...VALID.error, timestamp: '1757700000000' })).toMatch(/timestamp/)
    expect(reject({ ...VALID.error, replay: 'false' })).toMatch(/replay/)
  })
})

describe('device_update', () => {
  it.each(['0612345678', '+0123456789', '212600000001', '+2126000000011112', '+212 600 000 001', ''])(
    'refuses the phone %j',
    (phone) => {
      expect(reject(device({ phone }))).toMatch(/payload\.phone/)
    },
  )

  it('refuses out-of-range and non-finite coordinates', () => {
    expect(reject(device({ latitude: 91 }))).toMatch(/latitude: must be between -90 and 90/)
    expect(reject(device({ longitude: -180.5 }))).toMatch(/longitude/)
    expect(reject(device({ latitude: Number.NaN }))).toMatch(/finite/)
    expect(reject(device({ distance_km: -1 }))).toMatch(/distance_km/)
  })

  it('refuses enums outside the contract', () => {
    expect(reject(device({ zone: 'yellow' }))).toMatch(/zone: must be one of red, orange, green/)
    expect(reject(device({ reachability_status: 'MAYBE' }))).toMatch(/reachability_status/)
    expect(reject(device({ stage: 'done' }))).toMatch(/stage/)
    expect(reject(device({ sms_status: 'queued' }))).toMatch(/sms_status/)
  })

  it('refuses non-boolean booleans', () => {
    expect(reject(device({ reachable: 'yes' }))).toMatch(/reachable: must be a boolean/)
  })

  it('refuses a missing field and an unknown one — reasoning never rides in', () => {
    const missing = devicePayload()
    delete missing.rescue_status
    expect(reject(envelope('device_update', EVENT_A, 3, missing))).toMatch(/rescue_status: required/)
    expect(reject(device({ reasoning: 'because' }))).toMatch(/reasoning: unknown field/)
    expect(reject(device({ shelter_name: 'x' }))).toMatch(/unknown field/)
  })

  it('enforces nullability by stage', () => {
    expect(reject(device({ action: 'sms' }))).toMatch(/action: must be null unless stage is decided/)
    expect(reject(device({ confidence: 0.5 }))).toMatch(/confidence/)
    expect(reject(envelope('device_update', EVENT_A, 3, decidedPayload({ action: null, rescue_flag: false }))))
      .toMatch(/action: required when stage is decided/)
    expect(reject(envelope('device_update', EVENT_A, 3, decidedPayload({ confidence: 1.2 })))).toMatch(/confidence/)
  })

  it('enforces the contract\'s "iff" rules', () => {
    expect(reject(device({ reachable: true }))).toMatch(/reachable: must equal/)
    expect(reject(device({ sms_sent: true }))).toMatch(/sms_sent/)
    expect(reject(envelope('device_update', EVENT_A, 3, decidedPayload({ rescue_flag: false })))).toMatch(/rescue_flag/)
    expect(reject(device({ zone_escalated: true }))).toMatch(/escalated_zone/)
    expect(reject(device({
      reachable: true, reachability_status: 'CONNECTED_DATA', reachability_assumed: true,
    }))).toMatch(/assumed/)
  })

  it('accepts an escalation annotation and an assumed NOT_CONNECTED', () => {
    const escalated = decidedPayload({ zone: 'orange', zone_escalated: true, escalated_zone: 'red' })
    expect(validateFrame(envelope('device_update', EVENT_A, 3, escalated)).ok).toBe(true)
    expect(validateFrame(device({ reachability_assumed: true })).ok).toBe(true)
  })

  it('never puts the phone number into a reason', () => {
    const phone = '+212612345678'
    const reasons = [
      reject(device({ phone, latitude: 91 })),
      reject(device({ phone, zone: 'yellow' })),
      reject(device({ phone, [phone]: 1 })),
    ]
    for (const reason of reasons) expect(reason).not.toContain('612345678')
  })
})

describe('other payloads', () => {
  it('event_start: radius, depth, severity, bands', () => {
    const start = (over) => envelope('event_start', EVENT_A, 1, startPayload(over))
    expect(reject(start({ radius_km: 0 }))).toMatch(/radius_km/)
    expect(reject(start({ radius_km: 501 }))).toMatch(/radius_km/)
    expect(reject(start({ depth_km: 801 }))).toMatch(/depth_km/)
    expect(reject(start({ severity: 11 }))).toMatch(/severity/)
    expect(reject(start({ disaster_type: 'tornado' }))).toMatch(/disaster_type/)
    expect(reject(start({ zone_bands: { red: 0.7, orange: 0.66, green: 1 } }))).toMatch(/zone_bands/)
    expect(reject(start({ zone_bands: undefined }))).toMatch(/zone_bands/)
  })

  it('event_context: shelters are consistent with their status and capped at three', () => {
    const ctx = (over) => envelope('event_context', EVENT_A, 2, contextPayload(over))
    expect(validateFrame(ctx({ shelters_status: 'unavailable', shelters: [] })).ok).toBe(true)
    expect(reject(ctx({ shelters_status: 'unavailable' }))).toMatch(/must be empty/)
    const s = contextPayload().shelters[0]
    expect(reject(ctx({ shelters: [s, s, s, s] }))).toMatch(/at most 3/)
    expect(reject(ctx({ shelters: [{ ...s, occupancy: 10 }] }))).toMatch(/occupancy: unknown field/)
    expect(reject(ctx({ network_source: 'live_camara' }))).toMatch(/network_source/)
  })

  it('narrative_update: 1..2000 characters', () => {
    const n = (narrative) => envelope('narrative_update', EVENT_A, 5, narrativePayload({ narrative }))
    expect(reject(n(''))).toMatch(/narrative/)
    expect(reject(n('x'.repeat(2001)))).toMatch(/narrative/)
    expect(validateFrame(n('x'.repeat(2000))).ok).toBe(true)
  })

  it('error: phone is E.164 or empty; code and stage are enums', () => {
    const e = (over) => envelope('error', EVENT_A, 6, errorPayload(over))
    expect(validateFrame(e({ phone: '+212600000004', code: 'SMS_FAILED', stage: 'dispatch' })).ok).toBe(true)
    expect(reject(e({ phone: '0600000004' }))).toMatch(/phone/)
    expect(reject(e({ code: 'SOMETHING' }))).toMatch(/code/)
    expect(reject(e({ stage: 'mars' }))).toMatch(/stage/)
    expect(reject(e({ fatal: 'true' }))).toMatch(/fatal/)
  })

  it('event_complete: fatal_error is set iff the status is failed', () => {
    const c = (over) => envelope('event_complete', EVENT_A, 7, completePayload(over))
    expect(reject(c({ status: 'failed' }))).toMatch(/fatal_error/)
    expect(reject(c({ fatal_error: { code: 'DB_ERROR', message: 'x' } }))).toMatch(/fatal_error/)
    expect(validateFrame(c({ status: 'failed', fatal_error: { code: 'DB_ERROR', message: 'lookup failed' } })).ok).toBe(true)
  })

  it('zone_summary: every zone carries all eight counters', () => {
    const summary = summaryPayload()
    delete summary.green.rescue_flagged
    expect(reject(envelope('zone_summary', EVENT_A, 4, summary))).toMatch(/green\.rescue_flagged: required/)
  })
})

describe('zone band fallback', () => {
  it('is 0.33 / 0.66 / 1.0 and is what constants/zones.js draws', () => {
    expect(ZONE_BAND_FALLBACK).toEqual({ red: 0.33, orange: 0.66, green: 1.0 })
    expect(ZONE_RADIUS_THRESHOLDS).toEqual(ZONE_BAND_FALLBACK)
  })
})
