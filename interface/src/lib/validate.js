// Frame validation for WebSocket contract v2 — pure, no Solid, no DOM.
//
// Every frame is checked here BEFORE the store sees it. A frame that fails is
// counted and dropped by the caller; nothing half-valid is ever applied,
// because a device with a latitude of 91 or a zone of "yellow" would be drawn
// somewhere, and a map that shows something false is worse than one that
// shows less.
//
// Reasons name the field and the rule, never the value. A reason can end up in
// a console warning or on screen, and the value might be a phone number.

export const CONTRACT_VERSION = 2

export const EVENT_TYPES = [
  'event_start',
  'event_context',
  'device_update',
  'zone_summary',
  'narrative_update',
  'error',
  'event_complete',
]

// Control frames carry seq 0 and may carry event_id "" when the supervisor
// holds no event.
export const CONTROL_TYPES = ['snapshot_begin', 'snapshot_end', 'heartbeat']

export const MESSAGE_TYPES = [...EVENT_TYPES, ...CONTROL_TYPES]

export const DISASTER_TYPES        = ['earthquake', 'flood', 'heatwave']
export const AFTERSHOCK_RISKS      = ['LOW', 'MEDIUM', 'HIGH']
export const ZONES                 = ['red', 'orange', 'green']
export const LIFECYCLES            = ['idle', 'running', 'completed', 'completed_with_failures', 'no_devices', 'failed']
export const COMPLETE_STATUSES     = ['completed', 'completed_with_failures', 'no_devices', 'failed']
export const REACHABILITY_STATUSES = ['CONNECTED_DATA', 'CONNECTED_SMS', 'NOT_CONNECTED']
export const DEVICE_STAGES         = ['triaged', 'decided', 'decision_failed']
export const ACTIONS               = ['sms', 'rescue_flag', 'both', 'none']
export const SMS_STATUSES          = ['not_requested', 'sent', 'failed', 'not_configured']
export const RESCUE_STATUSES       = ['not_requested', 'recorded', 'failed']
export const ERROR_CODES = [
  'CAMARA_TIMEOUT',
  'CAMARA_ERROR',
  'AGENT_ERROR',
  'AGENT_INVALID_RESPONSE',
  'SMS_FAILED',
  'DB_ERROR',
  'QOS_FAILED',
  'INTERNAL_ERROR',
]
export const ERROR_STAGES       = ['lookup', 'context', 'triage', 'decision', 'dispatch', 'pipeline']
export const CONGESTION_LEVELS  = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN']
export const QOS_STATUSES       = ['inactive', 'requested', 'active', 'failed']
export const NETWORK_SOURCES    = ['mock_camara', 'nokia_nac']
export const SMS_GATEWAY_STATES = ['configured', 'not_configured']
export const SHELTERS_STATUSES  = ['ok', 'unavailable']

// Outer edge of each band as a fraction of radius_km. Go's `zones` package
// owns these and sends them on every event_start; this copy is only drawn when
// an event somehow lacks them, and contract.test.js pins it to the schema.
export const ZONE_BAND_FALLBACK = Object.freeze({ red: 0.33, orange: 0.66, green: 1.0 })

export const PHONE_RE = /^\+[1-9]\d{1,14}$/
export const EVENT_ID_MAX_LENGTH = 64
// POST /sensor only accepts ids of this form, so a frame whose id breaks it
// cannot belong to an event the supervisor started.
export const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
export const NARRATIVE_MAX_LENGTH = 2000
export const MAX_SHELTERS = 3

const ENVELOPE_KEYS = ['v', 'type', 'event_id', 'seq', 'timestamp', 'replay', 'payload']

// ── primitive checks ─────────────────────────────────────────────────────────
//
// Each returns null when the value is fine, or the rule it broke.

// Key names come off the wire too. Only ones that look like contract field
// names are echoed into a reason; anything else could be a phone number.
const safeKey = (k) => (/^[a-z_]{1,40}$/.test(k) ? k : '(unrecognised key)')

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isInt = (v) => Number.isSafeInteger(v)

function range(v, min, max) {
  if (!isFiniteNum(v)) return 'must be a finite number'
  if (v < min || v > max) return `must be between ${min} and ${max}`
  return null
}

function nonNegative(v) {
  if (!isFiniteNum(v)) return 'must be a finite number'
  return v < 0 ? 'must be ≥ 0' : null
}

function count(v) {
  if (!isInt(v)) return 'must be an integer'
  return v < 0 ? 'must be ≥ 0' : null
}

function oneOf(list) {
  return (v) => (list.includes(v) ? null : `must be one of ${list.join(', ')}`)
}

function bool(v) {
  return typeof v === 'boolean' ? null : 'must be a boolean'
}

function str(v) {
  return typeof v === 'string' ? null : 'must be a string'
}

function phone(v) {
  if (typeof v !== 'string') return 'must be a string'
  return PHONE_RE.test(v) ? null : 'must be an E.164 number'
}

const latitude  = (v) => range(v, -90, 90)
const longitude = (v) => range(v, -180, 180)

// ── object shapes ────────────────────────────────────────────────────────────

class Invalid extends Error {}

// Exactly these keys, each passing its check. Unknown keys are refused rather
// than ignored: v2 is a closed contract, and a field the console does not know
// (an AI `reasoning`, say) must never ride into the store on a valid frame.
function shape(value, path, fields) {
  if (!isObject(value)) throw new Invalid(`${path}: must be an object`)
  for (const key of Object.keys(value)) {
    if (!(key in fields)) throw new Invalid(`${path}.${safeKey(key)}: unknown field`)
  }
  for (const [key, check] of Object.entries(fields)) {
    if (!(key in value)) throw new Invalid(`${path}.${key}: required`)
    const problem = check(value[key], `${path}.${key}`)
    if (problem) throw new Invalid(`${path}.${key}: ${problem}`)
  }
  return value
}

// Adapter so a nested shape can be used as a field check.
const nested = (fields) => (value, path) => { shape(value, path, fields); return null }

const COORDINATES = { latitude, longitude }

const SHELTER = {
  name:        str,
  address:     str,
  location:    nested(COORDINATES),
  distance_km: nonNegative,
  capacity:    count,
}

const NETWORK = {
  congestion_level: oneOf(CONGESTION_LEVELS),
  qos_status:       oneOf(QOS_STATUSES),
}

const ZONE_STATS = {
  total:           count,
  reachable:       count,
  unreachable:     count,
  decided:         count,
  decision_failed: count,
  sms_sent:        count,
  sms_failed:      count,
  rescue_flagged:  count,
}

const FAILURES = {
  location:     count,
  reachability: count,
  decision:     count,
  sms:          count,
  rescue:       count,
}

const FATAL_ERROR = {
  code:    oneOf(ERROR_CODES),
  message: str,
}

function zoneBands(value, path) {
  shape(value, path, { red: bandEdge, orange: bandEdge, green: bandEdge })
  if (!(value.red < value.orange && value.orange < value.green)) {
    return 'must increase red < orange < green'
  }
  return null
}

function bandEdge(v) {
  if (!isFiniteNum(v)) return 'must be a finite number'
  return v > 0 && v <= 1 ? null : 'must be > 0 and ≤ 1'
}

function shelters(value, path) {
  if (!Array.isArray(value)) return 'must be an array'
  if (value.length > MAX_SHELTERS) return `must hold at most ${MAX_SHELTERS} shelters`
  value.forEach((s, i) => shape(s, `${path}[${i}]`, SHELTER))
  return null
}

// ── per-type payloads ────────────────────────────────────────────────────────

const HELD = {
  head_seq:  count,
  active:    bool,
  lifecycle: oneOf(LIFECYCLES),
}

const PAYLOADS = {
  snapshot_begin: (p) => shape(p, 'payload', HELD),
  heartbeat:      (p) => shape(p, 'payload', HELD),
  snapshot_end:   (p) => shape(p, 'payload', { head_seq: count, replayed: count }),

  event_start: (p) => shape(p, 'payload', {
    disaster_type:    oneOf(DISASTER_TYPES),
    severity:         (v) => range(v, 0, 10),
    epicenter:        nested(COORDINATES),
    radius_km:        (v) => {
      if (!isFiniteNum(v)) return 'must be a finite number'
      return v > 0 && v <= 500 ? null : 'must be > 0 and ≤ 500'
    },
    depth_km:         (v) => range(v, 0, 800),
    tsunami_risk:     bool,
    aftershock_risk:  oneOf(AFTERSHOCK_RISKS),
    sensor_timestamp: (v) => (isInt(v) && v > 0 ? null : 'must be an integer > 0'),
    zone_bands:       zoneBands,
  }),

  event_context: (p) => {
    shape(p, 'payload', {
      devices_in_radius: count,
      shelters_status:   oneOf(SHELTERS_STATUSES),
      shelters,
      network:           nested(NETWORK),
      network_source:    oneOf(NETWORK_SOURCES),
      sms_gateway:       oneOf(SMS_GATEWAY_STATES),
    })
    // A failed shelter query has no rows to show, and a list beside an
    // "unavailable" flag would be two claims that cannot both be true.
    if (p.shelters_status === 'unavailable' && p.shelters.length) {
      throw new Invalid('payload.shelters: must be empty when shelters_status is unavailable')
    }
  },

  device_update: (p) => {
    shape(p, 'payload', {
      phone,
      latitude,
      longitude,
      location_accuracy_m:  nonNegative,
      zone:                 oneOf(ZONES),
      distance_km:          nonNegative,
      reachable:            bool,
      reachability_status:  oneOf(REACHABILITY_STATUSES),
      reachability_assumed: bool,
      stage:                oneOf(DEVICE_STAGES),
      action:               (v) => (v === null ? null : oneOf(ACTIONS)(v)),
      zone_escalated:       bool,
      escalated_zone:       (v) => (v === null ? null : oneOf(ZONES)(v)),
      rescue_priority:      (v) => (isInt(v) && v >= 0 && v <= 10 ? null : 'must be an integer between 0 and 10'),
      confidence:           (v) => (v === null ? null : range(v, 0, 1)),
      sms_status:           oneOf(SMS_STATUSES),
      sms_sent:             bool,
      rescue_flag:          bool,
      rescue_status:        oneOf(RESCUE_STATUSES),
    })

    // The contract's "iff" rules. A frame that breaks one contradicts itself,
    // and the console has no way to know which half is true.
    const decided = p.stage === 'decided'
    if (decided && p.action === null) throw new Invalid('payload.action: required when stage is decided')
    if (!decided && p.action !== null) throw new Invalid('payload.action: must be null unless stage is decided')
    if (!decided && p.confidence !== null) throw new Invalid('payload.confidence: must be null unless stage is decided')
    if (p.reachable !== (p.reachability_status !== 'NOT_CONNECTED')) {
      throw new Invalid('payload.reachable: must equal reachability_status != NOT_CONNECTED')
    }
    if (p.reachability_assumed && p.reachability_status !== 'NOT_CONNECTED') {
      throw new Invalid('payload.reachability_assumed: only NOT_CONNECTED can be assumed')
    }
    if (p.zone_escalated !== (p.escalated_zone !== null)) {
      throw new Invalid('payload.escalated_zone: must be set iff zone_escalated')
    }
    if (p.sms_sent !== (p.sms_status === 'sent')) {
      throw new Invalid('payload.sms_sent: must equal sms_status == sent')
    }
    if (p.rescue_flag !== (p.action === 'rescue_flag' || p.action === 'both')) {
      throw new Invalid('payload.rescue_flag: must equal action in {rescue_flag, both}')
    }
  },

  zone_summary: (p) => shape(p, 'payload', {
    red:               nested(ZONE_STATS),
    orange:            nested(ZONE_STATS),
    green:             nested(ZONE_STATS),
    devices_in_radius: count,
    triaged:           count,
    location_failed:   count,
  }),

  narrative_update: (p) => shape(p, 'payload', {
    zone:        oneOf(ZONES),
    narrative:   (v) => {
      if (typeof v !== 'string') return 'must be a string'
      return v.length >= 1 && v.length <= NARRATIVE_MAX_LENGTH
        ? null
        : `must be 1..${NARRATIVE_MAX_LENGTH} characters`
    },
    batch_index: count,
  }),

  error: (p) => shape(p, 'payload', {
    code:    oneOf(ERROR_CODES),
    message: str,
    phone:   (v) => (v === '' ? null : phone(v)),
    fatal:   bool,
    stage:   oneOf(ERROR_STAGES),
  }),

  event_complete: (p) => {
    shape(p, 'payload', {
      status:                  oneOf(COMPLETE_STATUSES),
      duration_ms:             count,
      devices_in_radius:       count,
      devices_triaged:         count,
      devices_decided:         count,
      failures:                nested(FAILURES),
      sms_not_sent_no_gateway: count,
      fatal_error:             (v, path) => (v === null ? null : nested(FATAL_ERROR)(v, path)),
    })
    if ((p.status === 'failed') !== (p.fatal_error !== null)) {
      throw new Invalid('payload.fatal_error: must be set iff status is failed')
    }
  },
}

// ── envelope ─────────────────────────────────────────────────────────────────

function checkEnvelope(f) {
  if (!isObject(f)) throw new Invalid('frame: must be a JSON object')
  for (const key of Object.keys(f)) {
    if (!ENVELOPE_KEYS.includes(key)) throw new Invalid(`${safeKey(key)}: unknown envelope field`)
  }
  for (const key of ENVELOPE_KEYS) {
    if (!(key in f)) throw new Invalid(`${key}: required`)
  }

  if (f.v !== CONTRACT_VERSION) throw new Invalid(`v: must be ${CONTRACT_VERSION}`)
  if (typeof f.type !== 'string' || !MESSAGE_TYPES.includes(f.type)) throw new Invalid('type: unknown message type')
  if (typeof f.event_id !== 'string') throw new Invalid('event_id: must be a string')
  if (f.event_id.length > EVENT_ID_MAX_LENGTH) throw new Invalid(`event_id: longer than ${EVENT_ID_MAX_LENGTH}`)
  if (f.event_id && !EVENT_ID_PATTERN.test(f.event_id)) throw new Invalid('event_id: not a valid event id')
  if (!isInt(f.seq) || f.seq < 0) throw new Invalid('seq: must be an integer ≥ 0')
  if (!isInt(f.timestamp) || f.timestamp <= 0) throw new Invalid('timestamp: must be an integer > 0')
  if (typeof f.replay !== 'boolean') throw new Invalid('replay: must be a boolean')
  if (!isObject(f.payload)) throw new Invalid('payload: must be an object')

  if (CONTROL_TYPES.includes(f.type)) {
    if (f.seq !== 0) throw new Invalid('seq: must be 0 on a control frame')
    // Control frames are generated per connection, never re-sent.
    if (f.replay) throw new Invalid('replay: must be false on a control frame')
  } else {
    if (!f.event_id) throw new Invalid('event_id: required on an event frame')
    if (f.seq < 1) throw new Invalid('seq: must be ≥ 1 on an event frame')
    if (f.type === 'event_start' && f.seq !== 1) throw new Invalid('seq: event_start must be 1')
  }
}

/**
 * Validate one frame against contract v2.
 *
 * @param raw  a parsed frame, or the raw JSON text of one
 * @returns    { ok: true, frame } | { ok: false, reason }
 */
export function validateFrame(raw) {
  let frame = raw
  if (typeof raw === 'string') {
    try {
      frame = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'invalid JSON' }
    }
  }
  try {
    checkEnvelope(frame)
    PAYLOADS[frame.type](frame.payload)
    return { ok: true, frame }
  } catch (err) {
    if (err instanceof Invalid) {
      const type = MESSAGE_TYPES.includes(frame?.type) ? frame.type : 'frame'
      return { ok: false, reason: `${type}: ${err.message}` }
    }
    // A check threw something it should not have. Still a refusal, never a crash.
    return { ok: false, reason: 'validator failure' }
  }
}

export function isControlType(type) {
  return CONTROL_TYPES.includes(type)
}
