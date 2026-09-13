import { ZONE_BAND_FALLBACK } from '../lib/validate'

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
// mode they are the zone colours exactly. On the dark themes' graphite and
// navy cards the pure hues sit just on the contrast line, so words get lifted
// tints that pass, while the dot beside them keeps the true colour.
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
  red:    'Critical: immediate danger',
  orange: 'High: evacuation recommended',
  green:  'Moderate: alert and monitor',
}

export const ZONE_ORDER = ['red', 'orange', 'green']

// Outer edge of each band as a fraction of radius_km. Go assigns zones and
// sends its bands on every event_start (`event.zone_bands`); these are only
// the fallback, and contract.test.js holds them equal to the schema's.
export const ZONE_RADIUS_THRESHOLDS = ZONE_BAND_FALLBACK

/**
 * Inner and outer edge of a zone's band in km, or null.
 * @param bands  the event's zone_bands; the fallback when absent or unusable
 */
export function zoneBandRange(zone, radiusKm, bands) {
  if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm <= 0) return null
  const b = usableBands(bands) ? bands : ZONE_RADIUS_THRESHOLDS
  const index = ZONE_ORDER.indexOf(zone)
  if (index < 0) return null
  const inner = index === 0 ? 0 : b[ZONE_ORDER[index - 1]]
  return { innerKm: inner * radiusKm, outerKm: b[zone] * radiusKm }
}

/** Human band label, e.g. "0–5 km" for the red zone of a 15 km radius. */
export function zoneBand(zone, radiusKm, bands) {
  const r = zoneBandRange(zone, radiusKm, bands)
  if (!r) return ''
  return `${Math.round(r.innerKm)}–${Math.round(r.outerKm)} km`
}

function usableBands(b) {
  return !!b && ZONE_ORDER.every((z) => typeof b[z] === 'number' && Number.isFinite(b[z]))
}

export const WS_URL = import.meta.env?.VITE_WS_URL || 'ws://localhost:8080/ws'

// The supervisor's HTTP routes — same host as the socket, http(s) scheme.
const httpSibling = (path) => WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, path)

export const SENSOR_URL       = import.meta.env?.VITE_SENSOR_URL || httpSibling('/sensor')
export const HEALTH_URL       = import.meta.env?.VITE_HEALTH_URL || httpSibling('/health')
export const CAPABILITIES_URL = import.meta.env?.VITE_CAPABILITIES_URL || httpSibling('/capabilities')

// What each error code means to an operator. Deliberately no `fatal` here:
// whether an error stopped the pipeline is carried by the frame's own `fatal`
// flag, and the same code (DB_ERROR) is fatal in one stage and not in another.
export const ERROR_SEVERITY = {
  CAMARA_TIMEOUT:         { reads: 'A network lookup timed out' },
  CAMARA_ERROR:           { reads: 'A network lookup failed' },
  AGENT_ERROR:            { reads: 'A batch got no AI decision' },
  AGENT_INVALID_RESPONSE: { reads: 'An AI answer was rejected as invalid' },
  SMS_FAILED:             { reads: 'The SMS gateway did not accept a message' },
  DB_ERROR:               { reads: 'A database operation failed' },
  QOS_FAILED:             { reads: "The network priority request didn't apply" },
  INTERNAL_ERROR:         { reads: 'The supervisor hit an internal error' },
}
