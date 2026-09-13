// Contract v2 frame builders for the test suite. Imported by *.test.js files
// only — never by the app, which receives frames from the supervisor and from
// nowhere else.
//
// Every builder produces a frame that passes validateFrame; tests override
// individual fields to break it on purpose.

export const EVENT_A = 'EQ-20260912-0001'
export const EVENT_B = 'EQ-20260912-0002'

const T0 = 1_757_700_000_000

export function envelope(type, eventId, seq, payload, over = {}) {
  return { v: 2, type, event_id: eventId, seq, timestamp: T0 + seq, replay: false, payload, ...over }
}

export function startPayload(over = {}) {
  return {
    disaster_type: 'earthquake',
    severity: 6.8,
    epicenter: { latitude: 33.5731, longitude: -7.5898 },
    radius_km: 15,
    depth_km: 10.5,
    tsunami_risk: false,
    aftershock_risk: 'HIGH',
    sensor_timestamp: T0 - 1000,
    zone_bands: { red: 0.33, orange: 0.66, green: 1.0 },
    ...over,
  }
}

export function contextPayload(over = {}) {
  return {
    devices_in_radius: 2,
    shelters_status: 'ok',
    shelters: [
      {
        name: 'Fixture shelter 1',
        address: 'Fixture street 1',
        location: { latitude: 33.59, longitude: -7.62 },
        distance_km: 3.4,
        capacity: 5000,
      },
    ],
    network: { congestion_level: 'HIGH', qos_status: 'active' },
    network_source: 'mock_camara',
    sms_gateway: 'not_configured',
    ...over,
  }
}

// Stage `triaged`: located, no decision yet.
export function devicePayload(over = {}) {
  return {
    phone: '+212600000001',
    latitude: 33.5731,
    longitude: -7.5898,
    location_accuracy_m: 500,
    zone: 'red',
    distance_km: 0,
    reachable: false,
    reachability_status: 'NOT_CONNECTED',
    reachability_assumed: false,
    stage: 'triaged',
    action: null,
    zone_escalated: false,
    escalated_zone: null,
    rescue_priority: 0,
    confidence: null,
    sms_status: 'not_requested',
    sms_sent: false,
    rescue_flag: false,
    rescue_status: 'not_requested',
    ...over,
  }
}

// Stage `decided` with a recorded rescue flag.
export function decidedPayload(over = {}) {
  return devicePayload({
    stage: 'decided',
    action: 'rescue_flag',
    rescue_flag: true,
    rescue_status: 'recorded',
    rescue_priority: 1,
    confidence: 0.99,
    ...over,
  })
}

export const zoneStats = (over = {}) => ({
  total: 0, reachable: 0, unreachable: 0, decided: 0, decision_failed: 0,
  sms_sent: 0, sms_failed: 0, rescue_flagged: 0, ...over,
})

export function summaryPayload(over = {}) {
  return {
    red: zoneStats({ total: 1, unreachable: 1 }),
    orange: zoneStats(),
    green: zoneStats(),
    devices_in_radius: 1,
    triaged: 1,
    location_failed: 0,
    ...over,
  }
}

export function narrativePayload(over = {}) {
  return { zone: 'red', narrative: 'Red zone: 1 device, 1 flagged for rescue.', batch_index: 0, ...over }
}

export function errorPayload(over = {}) {
  return { code: 'CAMARA_TIMEOUT', message: 'location lookup timed out', phone: '', fatal: false, stage: 'triage', ...over }
}

export function completePayload(over = {}) {
  return {
    status: 'completed',
    duration_ms: 1834,
    devices_in_radius: 1,
    devices_triaged: 1,
    devices_decided: 1,
    failures: { location: 0, reachability: 0, decision: 0, sms: 0, rescue: 0 },
    sms_not_sent_no_gateway: 0,
    fatal_error: null,
    ...over,
  }
}

/** A per-event sequence: start() is seq 1, every next() is previous + 1. */
export function eventStream(eventId, startOver = {}) {
  let seq = 0
  return {
    get seq() { return seq },
    start(over = startOver) {
      seq = 1
      return envelope('event_start', eventId, 1, startPayload(over))
    },
    next(type, payload) {
      seq += 1
      return envelope(type, eventId, seq, payload)
    },
    /** A frame at an explicit seq, without moving the counter. */
    at(seq_, type, payload) {
      return envelope(type, eventId, seq_, payload)
    },
  }
}

export const snapshotBegin = (eventId, headSeq, lifecycle = 'running', active = lifecycle === 'running') =>
  envelope('snapshot_begin', eventId, 0, { head_seq: headSeq, active, lifecycle })

export const snapshotEnd = (eventId, headSeq, replayedCount = 0) =>
  envelope('snapshot_end', eventId, 0, { head_seq: headSeq, replayed: replayedCount })

export const heartbeat = (eventId, headSeq, lifecycle = 'running', active = lifecycle === 'running') =>
  envelope('heartbeat', eventId, 0, { head_seq: headSeq, active, lifecycle })

export const asReplay = (frame) => ({ ...frame, replay: true })
