// Display formatters. Every one of these is safe to call with null/undefined —
// the stream drops frames and a device can arrive before its dispatch update,
// so no formatter may ever put "undefined" on screen.

const DASH = '—'

// +212612345678 → "+212 6** *** 678". Full numbers are never rendered:
// this is a government screen showing the live location of named citizens.
export function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return DASH
  if (phone.length < 9) return phone
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
// 31.0625, -8.4144  ->  31°03'45" N, 8°24'52" W
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

// Relative time from a millisecond timestamp. Because the supervisor stamps
// most frames with 0 (agent.md §6.3), callers pass client arrival time and
// the UI must say "received", never "occurred".
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

// The AI's action is not on the wire — it is derived from the two booleans
// that are (agent.md §"AI decision").
export function deriveAction(device) {
  if (!device) return 'none'
  const sms = !!device.sms_sent
  const rescue = !!device.rescue_flag
  if (sms && rescue) return 'both'
  if (sms) return 'sms'
  if (rescue) return 'rescue_flag'
  return 'none'
}

export const ACTION_LABELS = {
  sms:         'SMS sent',
  rescue_flag: 'Rescue flagged',
  both:        'SMS + rescue',
  none:        'No action',
}

export function reachabilityLabel(device) {
  if (!device) return DASH
  if (device.reachability_status) return device.reachability_status.replace(/_/g, ' ')
  return device.reachable ? 'Reachable' : 'Unreachable'
}

export function titleCase(s) {
  if (!s) return DASH
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

export { DASH }
