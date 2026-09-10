// Zone palette — product colours from the design canvas (see agent.md §11).
// The contract's iOS hexes (#FF3B30 / #FF9500 / #34C759) are a display hint,
// not a wire value, so they are safe to override here.

export const ZONE_COLORS = {
  red:    '#FF2D3D',
  orange: '#FFA51F',
  green:  '#22D07A',
}

// The colour a zone WORD is drawn in. Dots, rings and bars use ZONE_COLORS
// directly; words go through these tokens so a theme can lift them. In light
// mode they are the zone colours exactly. In dark mode the surface is #001DF3,
// where pure zone red is 2.3:1 — so words get pale tints that pass, while the
// dot beside them keeps the true colour.
export const ZONE_TEXT = {
  red:    'var(--gd-zone-red-text)',
  orange: 'var(--gd-zone-orange-text)',
  green:  'var(--gd-zone-green-text)',
}

export const ZONE_LABELS = {
  red:    'Red zone',
  orange: 'Orange zone',
  green:  'Green zone',
}

// Never encode a zone by colour alone — every zone carries a second channel.
export const ZONE_MEANING = {
  red:    'Critical — immediate danger',
  orange: 'High — evacuation recommended',
  green:  'Moderate — alert and monitor',
}

export const ZONE_ORDER = ['red', 'orange', 'green']

// Fractions of radius_km. Go owns the real assignment; these mirror it for labels.
export const ZONE_RADIUS_THRESHOLDS = {
  red:    0.33,
  orange: 0.66,
  green:  1.00,
}

// Human band label, e.g. "0–17 km" for a 50 km radius.
export function zoneBand(zone, radiusKm) {
  if (!radiusKm) return ''
  const lo = zone === 'red' ? 0 : zone === 'orange' ? radiusKm * 0.33 : radiusKm * 0.66
  const hi = zone === 'red' ? radiusKm * 0.33 : zone === 'orange' ? radiusKm * 0.66 : radiusKm
  return `${Math.round(lo)}–${Math.round(hi)} km`
}

export const WS_URL = import.meta.env?.VITE_WS_URL || 'ws://localhost:8080/ws'

// POST /sensor on the supervisor — same host as the socket, http(s) scheme.
export const SENSOR_URL =
  import.meta.env?.VITE_SENSOR_URL ||
  WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/sensor')

export const HEALTH_URL =
  import.meta.env?.VITE_HEALTH_URL ||
  WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/health')

export const ERROR_SEVERITY = {
  CAMARA_TIMEOUT: { fatal: false, reads: "Some people weren't found" },
  SMS_FAILED:     { fatal: false, reads: "This person wasn't warned" },
  QOS_FAILED:     { fatal: false, reads: "The network boost didn't apply" },
  AGENT_ERROR:    { fatal: false, reads: 'A batch got no decision' },
  DB_ERROR:       { fatal: true,  reads: 'The system has stopped' },
}
