// Display formatters. Every one of these is safe to call with null/undefined —
// a device is on screen at stage `triaged` before any decision exists, and
// several v2 fields are null until then, so no formatter may ever put
// "undefined" on screen.

const DASH = '—'

// +212612345678 → "+212 6** *** 678". Full numbers are never rendered:
// this is a government screen showing the live location of named citizens.
export function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return DASH
  // Too short to mask meaningfully — show nothing of it, as Go's MaskPhone does.
  if (phone.length < 9) return '***'
  const cc = phone.slice(0, 4)          // +212
  const first = phone.slice(4, 5)       // 6
  const last = phone.slice(-3)          // 678
  return `${cc} ${first}** *** ${last}`
}

export function coords(lat, lng, decimals = 4) {
  if (!isNum(lat) || !isNum(lng)) return DASH
  return `${lat.toFixed(decimals)}, ${lng.toFixed(decimals)}`
}

// The same point written the way a rescue team's handheld reads it.
// 34.0209, -6.8416  ->  34°01'15" N, 6°50'30" W
export function dms(lat, lng) {
  if (!isNum(lat) || !isNum(lng)) return DASH
  return `${dmsPart(lat, 'N', 'S')}, ${dmsPart(lng, 'E', 'W')}`
}

function dmsPart(value, positive, negative) {
  const hemisphere = value >= 0 ? positive : negative
  const abs = Math.abs(value)

  let degrees = Math.floor(abs)
  const minutesFloat = (abs - degrees) * 60
  let minutes = Math.floor(minutesFloat)
  let seconds = Math.round((minutesFloat - minutes) * 60)

  // Rounding the seconds can carry into the minutes, and the minutes into the
  // degrees. Without this, 31.99999 prints as 31°60'00".
  if (seconds === 60) { seconds = 0; minutes += 1 }
  if (minutes === 60) { minutes = 0; degrees += 1 }

  const pad = (n) => String(n).padStart(2, '0')
  return `${degrees}\u00b0${pad(minutes)}'${pad(seconds)}" ${hemisphere}`
}

export function num(n, fallback = DASH) {
  if (!isNum(n)) return fallback
  return n.toLocaleString('en-US')
}

export function decimal(n, places = 1, fallback = DASH) {
  if (!isNum(n)) return fallback
  return n.toFixed(places)
}

export function percent(n, places = 1, fallback = DASH) {
  if (!isNum(n)) return fallback
  return `${(n * 100).toFixed(places)}%`
}

export function km(n, places = 1) {
  if (!isNum(n)) return DASH
  return `${n.toFixed(places)} km`
}

// Distances always arrive from the pipeline in kilometres — the haversine in
// geo.js mirrors the Go supervisor's, and Go works in km. Miles are a display
// choice made here and nowhere else; nothing upstream ever sees them.
const MILES_PER_KM = 0.621371

export function distance(valueKm, { units = 'km', places = 1 } = {}) {
  if (!isNum(valueKm)) return DASH
  if (units === 'mi') return `${(valueKm * MILES_PER_KM).toFixed(places)} mi`
  return `${valueKm.toFixed(places)} km`
}

export function metres(n) {
  if (!isNum(n)) return DASH
  return `±${Math.round(n)} m`
}

// Relative time from a millisecond timestamp. v2 frames carry the supervisor's
// emit time (`emittedAt` in the store) and the store adds the client's arrival
// time (`receivedAt`); callers say which one they are showing. Neither is when
// the disaster itself occurred.
export function ago(ms, now = Date.now()) {
  if (!isNum(ms) || ms <= 0) return DASH
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

// ISO 8601 → relative. CAMARA sends these; they may be absent.
export function agoISO(iso, now = Date.now()) {
  if (!iso) return DASH
  const t = Date.parse(iso)
  return Number.isNaN(t) ? DASH : ago(t, now)
}

export function clock(ms) {
  if (!isNum(ms) || ms <= 0) return DASH
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false })
}

// The AI's decision, as sent in device_update.action. It is what the AI ASKED
// for, not what happened: whether an SMS actually went out is sms_status.
export const ACTION_LABELS = {
  sms:         'Send SMS',
  rescue_flag: 'Flag for rescue',
  both:        'SMS + rescue flag',
  none:        'No action',
}

export const STAGE_LABELS = {
  triaged:         'Located — awaiting AI decision',
  decided:         'Decided',
  decision_failed: 'AI decision failed',
}

export const SMS_STATUS_LABELS = {
  not_requested:  'Not requested',
  sent:           'Accepted by the SMS gateway',
  failed:         'Failed — the SMS gateway rejected it',
  not_configured: 'Not sent — no SMS gateway configured',
}

export const RESCUE_STATUS_LABELS = {
  not_requested: 'Not requested',
  recorded:      'Recorded',
  failed:        'Recording failed',
}

export const LIFECYCLE_LABELS = {
  idle:                    'No incident',
  running:                 'Running',
  completed:               'Completed',
  completed_with_failures: 'Completed with failures',
  no_devices:              'No registered devices within radius',
  failed:                  'Failed',
}

const lookup = (table) => (key) => (key != null && table[key]) || DASH

/** `null` (no decision yet) and unknown values render as a dash. */
export const actionLabel       = lookup(ACTION_LABELS)
export const stageLabel        = lookup(STAGE_LABELS)
export const smsStatusLabel    = lookup(SMS_STATUS_LABELS)
export const rescueStatusLabel = lookup(RESCUE_STATUS_LABELS)
export const lifecycleLabel    = lookup(LIFECYCLE_LABELS)

// Reachability comes from CAMARA, not the AI. When the lookup itself failed the
// supervisor assumes NOT_CONNECTED and says so; so does this label.
export function reachabilityLabel(device) {
  if (!device || !device.reachability_status) return DASH
  const words = device.reachability_status.replace(/_/g, ' ')
  return device.reachability_assumed ? `${words} (assumed — lookup failed)` : words
}

/**
 * Severity worded for its disaster type. Only an earthquake has a magnitude;
 * an "M" in front of a flood's number would claim a scale it is not on.
 */
export function severityLabel(type, value) {
  if (!isNum(value)) return DASH
  const v = value.toFixed(1)
  switch (type) {
    case 'earthquake': return `M ${v}`
    case 'flood':      return `Flood severity ${v}`
    case 'heatwave':   return `Heat severity ${v}`
    default:           return `Severity ${v}`
  }
}

export function titleCase(s) {
  if (!s) return DASH
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

export { DASH }
