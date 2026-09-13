// The incident launcher's data side: an empty draft, the SensorInput built
// from it, and the same validation POST /sensor applies (§2.1), so an operator
// sees a bad field before the supervisor has to refuse it.
//
// Pure and separate from the dialog so the exact bytes that go on the wire can
// be asserted in a test, rather than inferred from a screenshot of a form.
//
// A fresh draft has no measurement in it: a launcher that pre-fills a
// magnitude, an epicentre or a depth will one day start an incident nobody
// described. The operator fills every field, or picks a named preset — which
// fills them all in view, to be read and edited before anything is sent.

import { AFTERSHOCK_RISKS, DISASTER_TYPES, EVENT_ID_MAX_LENGTH, EVENT_ID_PATTERN } from './validate'
import { haversine } from './geo'

export { AFTERSHOCK_RISKS, DISASTER_TYPES, EVENT_ID_PATTERN }

export const SENSOR_FIELDS = [
  'event_id',
  'disaster_type',
  'timestamp',
  'severity',
  'epicenter',
  'radius_km',
  'depth_km',
  'aftershock_risk',
  'tsunami_risk',
]

// The supervisor's limits, in the shape GET /capabilities reports them.
// Used when capabilities cannot be read; contract.test.js holds them equal to
// sensor_input.json.
export const SENSOR_LIMITS = Object.freeze({
  event_id_max_length: EVENT_ID_MAX_LENGTH,
  severity:  Object.freeze({ min: 0, max: 10 }),
  radius_km: Object.freeze({ exclusive_min: 0, max: 500 }),
  depth_km:  Object.freeze({ min: 0, max: 800 }),
  latitude:  Object.freeze({ min: -90, max: 90 }),
  longitude: Object.freeze({ min: -180, max: 180 }),
})

// What the supervisor supports when it cannot be asked: earthquake only, as
// §2.1 says today. A type the console cannot confirm is not offered.
export const FALLBACK_CAPABILITIES = Object.freeze({
  disaster_types: Object.freeze({ earthquake: 'operational', flood: 'unsupported', heatwave: 'unsupported' }),
  limits: SENSOR_LIMITS,
})

export const UNSUPPORTED_REASON = 'unsupported: not implemented by this supervisor'

// A disaster type the console knows is planned but refuses today.
export const COMING_SOON = 'coming_soon'
export const COMING_SOON_REASON = 'coming soon: only earthquakes can be simulated today'

// A simulation runs in this browser, not on the supervisor, but it only knows
// how an EARTHQUAKE spreads: rings around an epicentre, people on land. A
// flood follows rivers and terrain, and a heatwave follows temperature; the
// simulation has neither, and would happily put a flood in the middle of a
// desert. So both are refused, and shown as coming soon, until it can model
// them. lib/simulation.js checks the same table, so nothing gets past it.
export const SIMULATION_CAPABILITIES = Object.freeze({
  disaster_types: Object.freeze({ earthquake: 'operational', flood: COMING_SOON, heatwave: COMING_SOON }),
  limits: SENSOR_LIMITS,
})

/**
 * The places the development supervisor holds test subscribers for, with the
 * event each preset sends. Mirrors supervisor/scripts/camara/areas.go (whose
 * tests check every preset reaches all three zones). A launch inside one runs
 * the real pipeline; anywhere else the supervisor would find nobody, so the
 * launcher offers a browser simulation instead.
 */
export const SUPERVISOR_AREAS = Object.freeze([
  Object.freeze({
    key: 'al-haouz',
    name: 'Al Haouz',
    note: 'High Atlas villages around the 2023 epicentre',
    epicenter: Object.freeze({ latitude: 31.058, longitude: -8.385 }),
    radius_km: 50,
    severity: 6.8,
    depth_km: 18.5,
    aftershock_risk: 'HIGH',
    tsunami_risk: false,
  }),
  Object.freeze({
    key: 'agadir',
    name: 'Agadir',
    note: 'Agadir, Inezgane and Aït Melloul',
    epicenter: Object.freeze({ latitude: 30.4205, longitude: -9.5839 }),
    radius_km: 20,
    severity: 5.8,
    depth_km: 15,
    aftershock_risk: 'MEDIUM',
    tsunami_risk: false,
  }),
  Object.freeze({
    key: 'casablanca',
    name: 'Casablanca',
    note: 'Twenty-one districts of the city',
    epicenter: Object.freeze({ latitude: 33.5731, longitude: -7.5898 }),
    radius_km: 15,
    severity: 6.2,
    depth_km: 10,
    aftershock_risk: 'MEDIUM',
    tsunami_risk: false,
  }),
])

/** The supervisor area whose preset radius contains this point, or null. */
export function supervisorAreaAt(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const point = { latitude, longitude }
  for (const area of SUPERVISOR_AREAS) {
    if (haversine(point, area.epicenter) <= area.radius_km) return area
  }
  return null
}

/** The form values a preset fills in. Strings, like every draft field. */
export function presetFields(area) {
  return {
    disaster_type:   'earthquake',
    severity:        String(area.severity),
    latitude:        String(area.epicenter.latitude),
    longitude:       String(area.epicenter.longitude),
    radius_km:       String(area.radius_km),
    depth_km:        String(area.depth_km),
    aftershock_risk: area.aftershock_risk,
    tsunami_risk:    String(area.tsunami_risk),
  }
}

/**
 * One event id per launch attempt: `<PREFIX>-<base36 ms>`.
 *
 * Stamped once, from the clock at the moment the draft is made, and reused
 * for the payload, the note and anything the operator reads afterwards.
 */
export function makeEventId(prefix, now = Date.now()) {
  const safe = String(prefix || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+/, '').slice(0, 40)
  return `${safe || 'EVENT'}-${now.toString(36).toUpperCase()}`
}

/**
 * A fresh launcher form: a generated event id and timestamp, and every other
 * field EMPTY. Values are form values (strings); buildSensorInput converts.
 */
export function newDraft(now = Date.now()) {
  return {
    event_id:        makeEventId('EVT', now),
    timestamp:       String(now),
    disaster_type:   '',
    severity:        '',
    latitude:        '',
    longitude:       '',
    radius_km:       '',
    depth_km:        '',
    aftershock_risk: '',
    tsunami_risk:    '',   // '' | 'true' | 'false' (booleans accepted too)
  }
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

function toNumber(v) {
  if (typeof v === 'number') return v
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : NaN
}

function toBool(v) {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

/**
 * Draft (strings) → SensorInput (numbers, nested epicentre).
 *
 * @returns { payload, errors, ok }
 *   payload  the SensorInput, with any field that could not be converted left out
 *   errors   { '<json path>': reason } — conversion errors plus validateSensorInput's
 *   ok       true when errors is empty
 */
export function buildSensorInput(draft, capabilities) {
  const d = draft || {}
  const errors = {}
  const payload = {}

  const text = (key) => {
    if (isBlank(d[key])) { errors[key] = 'required'; return }
    payload[key] = String(d[key]).trim()
  }
  const number = (key, path = key, target = payload, targetKey = key) => {
    if (isBlank(d[key])) { errors[path] = 'required'; return }
    const n = toNumber(d[key])
    if (Number.isNaN(n)) { errors[path] = 'must be a number'; return }
    target[targetKey] = n
  }

  text('event_id')
  text('disaster_type')

  if (isBlank(d.timestamp)) errors.timestamp = 'required'
  else if (typeof d.timestamp === 'number' || /^\d+$/.test(String(d.timestamp).trim())) {
    payload.timestamp = Number(d.timestamp)
  } else errors.timestamp = 'must be an integer > 0 (Unix ms)'

  number('severity')

  const epicenter = {}
  number('latitude', 'epicenter.latitude', epicenter, 'latitude')
  number('longitude', 'epicenter.longitude', epicenter, 'longitude')
  if ('latitude' in epicenter && 'longitude' in epicenter) payload.epicenter = epicenter

  number('radius_km')
  number('depth_km')
  text('aftershock_risk')

  const tsunami = toBool(d.tsunami_risk)
  if (isBlank(d.tsunami_risk)) errors.tsunami_risk = 'required'
  else if (tsunami === undefined) errors.tsunami_risk = 'must be true or false'
  else payload.tsunami_risk = tsunami

  // Range / enum / capability checks on whatever did convert. Conversion
  // errors win for the same field: "must be a number" is the useful one.
  const checked = validateSensorInput(payload, capabilities)
  const coordError = Object.keys(errors).some((k) => k.startsWith('epicenter.'))
  for (const [path, reason] of Object.entries(checked.errors)) {
    if (path in errors) continue
    // A missing epicentre object is already explained by its coordinate errors.
    if (path === 'epicenter' && coordError) continue
    errors[path] = reason
  }

  return { payload, errors, ok: Object.keys(errors).length === 0 }
}

function limitsFrom(capabilities) {
  const l = capabilities?.limits
  const n = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    idMax:     n(l?.event_id_max_length, SENSOR_LIMITS.event_id_max_length),
    sevMin:    n(l?.severity?.min, SENSOR_LIMITS.severity.min),
    sevMax:    n(l?.severity?.max, SENSOR_LIMITS.severity.max),
    radiusMin: n(l?.radius_km?.exclusive_min, SENSOR_LIMITS.radius_km.exclusive_min),
    radiusMax: n(l?.radius_km?.max, SENSOR_LIMITS.radius_km.max),
    depthMin:  n(l?.depth_km?.min, SENSOR_LIMITS.depth_km.min),
    depthMax:  n(l?.depth_km?.max, SENSOR_LIMITS.depth_km.max),
  }
}

/**
 * What `capabilities` says about a disaster type: 'operational',
 * 'unsupported', COMING_SOON, or null when it does not name it. Without
 * capabilities, the earthquake-only fallback answers.
 */
export function capabilityOf(type, capabilities) {
  const table = capabilities?.disaster_types && typeof capabilities.disaster_types === 'object'
    ? capabilities.disaster_types
    : FALLBACK_CAPABILITIES.disaster_types
  return table[type] ?? null
}

/** Is this disaster type accepted by the supervisor (or by the fallback)? */
export function isOperational(type, capabilities) {
  return capabilityOf(type, capabilities) === 'operational'
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * The checks POST /sensor applies (§2.1 step 6), on a SensorInput object.
 *
 * @param payload       the object that would be sent
 * @param capabilities  GET /capabilities result; FALLBACK_CAPABILITIES when absent
 * @returns { ok, errors: { '<json path>': reason } }
 */
export function validateSensorInput(payload, capabilities) {
  const errors = {}
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: { $: 'must be a JSON object' } }
  }
  const lim = limitsFrom(capabilities)
  const has = (k) => Object.prototype.hasOwnProperty.call(payload, k)

  for (const key of Object.keys(payload)) {
    if (!SENSOR_FIELDS.includes(key)) errors[key] = 'unknown field'
  }
  for (const key of SENSOR_FIELDS) {
    if (!has(key)) errors[key] = 'required'
  }

  if (has('event_id')) {
    const id = payload.event_id
    if (typeof id !== 'string') errors.event_id = 'must be a string'
    else if (id.length < 1 || id.length > lim.idMax) errors.event_id = `must be 1..${lim.idMax} characters`
    else if (!EVENT_ID_PATTERN.test(id)) errors.event_id = 'must start with a letter or digit and use only letters, digits, . _ : -'
  }

  if (has('disaster_type')) {
    const t = payload.disaster_type
    if (!DISASTER_TYPES.includes(t)) errors.disaster_type = `must be one of ${DISASTER_TYPES.join(', ')}`
    else if (!isOperational(t, capabilities)) {
      errors.disaster_type = capabilityOf(t, capabilities) === COMING_SOON ? COMING_SOON_REASON : UNSUPPORTED_REASON
    }
  }

  if (has('timestamp')) {
    const t = payload.timestamp
    if (!Number.isSafeInteger(t) || t <= 0) errors.timestamp = 'must be an integer > 0 (Unix ms)'
  }

  if (has('severity')) {
    const v = payload.severity
    if (!finite(v)) errors.severity = 'must be a finite number'
    else if (v < lim.sevMin || v > lim.sevMax) errors.severity = `must be between ${lim.sevMin} and ${lim.sevMax}`
  }

  if (has('epicenter')) {
    const e = payload.epicenter
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      errors.epicenter = 'must be an object'
    } else {
      for (const key of Object.keys(e)) {
        if (key !== 'latitude' && key !== 'longitude') errors[`epicenter.${key}`] = 'unknown field'
      }
      const coord = (key, min, max) => {
        if (!(key in e)) errors[`epicenter.${key}`] = 'required'
        else if (!finite(e[key])) errors[`epicenter.${key}`] = 'must be a finite number'
        else if (e[key] < min || e[key] > max) errors[`epicenter.${key}`] = `must be between ${min} and ${max}`
      }
      coord('latitude', SENSOR_LIMITS.latitude.min, SENSOR_LIMITS.latitude.max)
      coord('longitude', SENSOR_LIMITS.longitude.min, SENSOR_LIMITS.longitude.max)
    }
  }

  if (has('radius_km')) {
    const v = payload.radius_km
    if (!finite(v)) errors.radius_km = 'must be a finite number'
    else if (v <= lim.radiusMin || v > lim.radiusMax) errors.radius_km = `must be > ${lim.radiusMin} and ≤ ${lim.radiusMax}`
  }

  if (has('depth_km')) {
    const v = payload.depth_km
    if (!finite(v)) errors.depth_km = 'must be a finite number'
    else if (v < lim.depthMin || v > lim.depthMax) errors.depth_km = `must be between ${lim.depthMin} and ${lim.depthMax}`
  }

  if (has('aftershock_risk') && !AFTERSHOCK_RISKS.includes(payload.aftershock_risk)) {
    errors.aftershock_risk = `must be one of ${AFTERSHOCK_RISKS.join(', ')}`
  }

  if (has('tsunami_risk') && typeof payload.tsunami_risk !== 'boolean') {
    errors.tsunami_risk = 'must be a boolean'
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

/**
 * Refuses a second submit while the first is still in flight.
 *
 *   const guard = createSubmitGuard({ onChange: setPending })
 *   guard.run(() => triggerEvent(payload))   // → the task's promise, or null if refused
 *
 * A disabled button is not enough on its own: a double click lands both
 * clicks before the re-render that disables it.
 */
export function createSubmitGuard({ onChange } = {}) {
  let pending = false
  const set = (v) => { pending = v; onChange?.(v) }

  return {
    isPending: () => pending,
    run(task) {
      if (pending) return null
      set(true)
      let result
      try {
        result = Promise.resolve(task())
      } catch (err) {
        result = Promise.reject(err)
      }
      return result.finally(() => set(false))
    },
  }
}
