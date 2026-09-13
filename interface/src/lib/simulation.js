// Browser-side incident SIMULATION: synthetic data, never the supervisor's.
//
// The supervisor only knows the subscribers it has been seeded with, so an
// event anywhere else rightly finds nobody. For those places the console can
// play an incident it generates itself: devices scattered around a handful of
// settlements, the three bands, three shelters, and the decision rules of the
// supervisor's development mock agent (scripts/agent) — so a simulated board
// reads like a real one.
//
// Every frame is a contract v2 frame and goes through the same path a
// supervisor frame does (validate → store), so the simulation cannot show
// anything a supervisor could not have sent. It is labelled wherever it shows:
// the stream chip, the simulation banner, every narrative, the shelter names,
// and the phone numbers, which sit under +999 — a country code no network
// assigns, so a simulated device can never be mistaken for a real subscriber.
//
// Pure and deterministic: the same launch gives the same incident. `isLand`
// is optional; the console passes the vector basemap's water test so the
// simulation keeps people out of the sea.
//
// EARTHQUAKES ONLY. Rings around an epicentre are how a quake spreads, not a
// flood (rivers, terrain) or a heatwave (temperature). Those are refused here
// and shown as coming soon in the launcher — SIMULATION_CAPABILITIES in
// lib/launch.js is the one table both read.

import { ZONE_BAND_FALLBACK } from './validate'
import { haversine } from './geo'
import { SIMULATION_CAPABILITIES, isOperational } from './launch'

export const SIM_PHONE_PREFIX = '+9990'
export const SIM_BATCH_SIZE = 20
// Pacing: devices are located over SIM_TRIAGE_MS, then one AI batch lands
// every SIM_BATCH_MS — the same rhythm as the development stack.
export const SIM_TRIAGE_MS = 2_500
export const SIM_BATCH_MS = 450
export const SIM_NARRATIVE_PREFIX = 'SIMULATION, synthetic data, not a situation report.'

const ZONE_ORDER = ['red', 'orange', 'green']

// The mock agent's fixed rules (scripts/agent/mock_agent.go), per zone.
const RULES = {
  red:    { reachable: 'both', unreachable: 'rescue_flag', priority: 1, confidence: 0.99 },
  orange: { reachable: 'both', unreachable: 'rescue_flag', priority: 2, confidence: 0.92 },
  green:  { reachable: 'sms',  unreachable: 'none',        priority: 0, confidence: 0.75 },
}

// Where each band's settlements sit, as fractions of the radius. Kept clear
// of the band edges so a settlement's scatter stays in its band mostly.
const BAND_RING = {
  red:    [0.02, 0.28],
  orange: [0.38, 0.62],
  green:  [0.70, 0.95],
}

// ── deterministic randomness ─────────────────────────────────────────────

function hashString(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// mulberry32 — small, fast and plenty for scattering dots.
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rand) {
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const round = (value, places) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}

// A point `northKm` north and `eastKm` east of (lat, lng). Flat-earth offsets
// are fine at these distances; the zone is decided by haversine afterwards.
function offset(lat, lng, northKm, eastKm) {
  const dLat = northKm / 111.32
  const dLng = eastKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  return { latitude: round(lat + dLat, 5), longitude: round(lng + dLng, 5) }
}

function zoneFor(distanceKm, radiusKm, bands = ZONE_BAND_FALLBACK) {
  if (distanceKm <= bands.red * radiusKm) return 'red'
  if (distanceKm <= bands.orange * radiusKm) return 'orange'
  return 'green'
}

/** How many devices a simulated event of this radius holds. */
export function simulationSize(radiusKm) {
  return Math.max(150, Math.min(600, Math.round(150 + radiusKm * 6)))
}

// ── the population ───────────────────────────────────────────────────────

function settlements(rand, epi, radiusKm, isLand) {
  const count = Math.max(6, Math.min(15, Math.round(4 + radiusKm / 4)))
  const out = []
  for (let k = 0; k < count; k++) {
    const zone = ZONE_ORDER[k % 3]
    const [lo, hi] = BAND_RING[zone]
    for (let attempt = 0; attempt < 40; attempt++) {
      const r = radiusKm * (lo + (hi - lo) * Math.sqrt(rand()))
      const bearing = rand() * 2 * Math.PI
      const centre = offset(epi.latitude, epi.longitude, r * Math.cos(bearing), r * Math.sin(bearing))
      if (!isLand(centre.latitude, centre.longitude)) continue
      out.push({
        ...centre,
        // The first settlement is the town at the epicentre: the biggest one.
        weight: (0.5 + rand() * 1.5) * (k === 0 ? 1.8 : 1),
        spreadKm: Math.max(0.35, Math.min(3, radiusKm * (0.025 + rand() * 0.02))),
      })
      break
    }
  }
  return out
}

function population(rand, sensor, isLand) {
  const epi = sensor.epicenter
  const radiusKm = sensor.radius_km
  const towns = settlements(rand, epi, radiusKm, isLand)
  if (!towns.length) return []

  const target = simulationSize(radiusKm)
  const totalWeight = towns.reduce((sum, t) => sum + t.weight, 0)
  const devices = []

  for (const town of towns) {
    const share = Math.round((town.weight / totalWeight) * target)
    for (let i = 0; i < share; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        let dx = normal(rand)
        let dy = normal(rand)
        const norm = Math.hypot(dx, dy)
        if (norm > 2.5) { dx *= 2.5 / norm; dy *= 2.5 / norm }
        const point = offset(town.latitude, town.longitude, dy * town.spreadKm, dx * town.spreadKm)
        const distanceKm = haversine(point, epi)
        if (distanceKm > radiusKm * 0.999 || !isLand(point.latitude, point.longitude)) continue

        // Close in, the quake has taken more of the network down.
        const damage = Math.max(0, 1 - distanceKm / (0.5 * radiusKm))
        const pNotConnected = 0.08 + 0.32 * damage
        const u = rand()
        const reachability =
          u < pNotConnected ? 'NOT_CONNECTED' : u < pNotConnected + 0.22 ? 'CONNECTED_SMS' : 'CONNECTED_DATA'

        devices.push({
          ...point,
          distance_km: round(distanceKm, 3),
          zone: zoneFor(distanceKm, radiusKm),
          reachability_status: reachability,
          location_accuracy_m: Math.round(300 + rand() * 700),
        })
        break
      }
    }
  }

  // Located nearest-first, like the supervisor's triage; phones in that order.
  devices.sort((a, b) => a.distance_km - b.distance_km)
  return devices.map((d, i) => ({ ...d, phone: `${SIM_PHONE_PREFIX}${String(i + 1).padStart(8, '0')}` }))
}

function shelters(rand, sensor, isLand) {
  const epi = sensor.epicenter
  const radiusKm = sensor.radius_km
  const names = ['A', 'B', 'C']
  const start = rand() * 2 * Math.PI
  const out = []
  names.forEach((letter, i) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const bearing = start + (i * 2 * Math.PI) / 3 + (rand() - 0.5) * 0.9
      const r = radiusKm * (0.45 + rand() * 0.35)
      const location = offset(epi.latitude, epi.longitude, r * Math.cos(bearing), r * Math.sin(bearing))
      if (!isLand(location.latitude, location.longitude)) continue
      out.push({
        name: `Simulated shelter ${letter}`,
        address: 'Synthetic location (simulation)',
        location,
        distance_km: round(haversine(location, epi), 3),
        capacity: 500 + Math.round(rand() * 25) * 100,
      })
      break
    }
  })
  return out.sort((a, b) => a.distance_km - b.distance_km)
}

// ── decisions ────────────────────────────────────────────────────────────

function decide(device) {
  const rule = RULES[device.zone]
  const reachable = device.reachability_status !== 'NOT_CONNECTED'
  const action = reachable ? rule.reachable : rule.unreachable
  const rescue = action === 'rescue_flag' || action === 'both'
  const sms = action === 'sms' || action === 'both'
  return {
    action,
    rescue_priority: rescue ? rule.priority || 1 : 0,
    confidence: rule.confidence,
    // No SMS gateway exists in a simulation, so nothing is ever "sent".
    sms_status: sms ? 'not_configured' : 'not_requested',
    rescue_flag: rescue,
    rescue_status: rescue ? 'recorded' : 'not_requested',
  }
}

function devicePayload(device, decision) {
  return {
    phone: device.phone,
    latitude: device.latitude,
    longitude: device.longitude,
    location_accuracy_m: device.location_accuracy_m,
    zone: device.zone,
    distance_km: device.distance_km,
    reachable: device.reachability_status !== 'NOT_CONNECTED',
    reachability_status: device.reachability_status,
    reachability_assumed: false,
    stage: decision ? 'decided' : 'triaged',
    action: decision ? decision.action : null,
    zone_escalated: false,
    escalated_zone: null,
    rescue_priority: decision ? decision.rescue_priority : 0,
    confidence: decision ? decision.confidence : null,
    sms_status: decision ? decision.sms_status : 'not_requested',
    sms_sent: false,
    rescue_flag: decision ? decision.rescue_flag : false,
    rescue_status: decision ? decision.rescue_status : 'not_requested',
  }
}

function emptyStats() {
  return { total: 0, reachable: 0, unreachable: 0, decided: 0, decision_failed: 0, sms_sent: 0, sms_failed: 0, rescue_flagged: 0 }
}

// ── the frames ───────────────────────────────────────────────────────────

/**
 * A whole simulated incident as timed contract v2 frames.
 *
 * @param sensor   a SensorInput (what the launcher would POST)
 * @param options  isLand(lat, lng) → boolean; now() for the frame timestamps
 * @returns { frames: [{ at, frame }], devices, shelters }
 *          `at` is milliseconds after the start
 */
export function buildSimulation(sensor, { isLand = () => true, now = Date.now() } = {}) {
  if (!isOperational(sensor?.disaster_type, SIMULATION_CAPABILITIES)) {
    throw new Error(`${sensor?.disaster_type || 'This'} simulations are coming soon. Only earthquakes can be simulated today.`)
  }
  const eventId = sensor.event_id
  const seed = hashString(`${eventId}|${sensor.epicenter.latitude}|${sensor.epicenter.longitude}|${sensor.radius_km}`)
  const rand = prng(seed)
  const safeIsLand = (lat, lng) => {
    try {
      return isLand(lat, lng) !== false
    } catch {
      return true
    }
  }

  const devices = population(rand, sensor, safeIsLand)
  const shelterList = shelters(rand, sensor, safeIsLand)

  const frames = []
  let seq = 0
  const push = (at, type, payload) => {
    seq += 1
    frames.push({ at, frame: { v: 2, type, event_id: eventId, seq, timestamp: now + at, replay: false, payload } })
  }

  push(0, 'event_start', {
    disaster_type: sensor.disaster_type,
    severity: sensor.severity,
    epicenter: { latitude: sensor.epicenter.latitude, longitude: sensor.epicenter.longitude },
    radius_km: sensor.radius_km,
    depth_km: sensor.depth_km,
    tsunami_risk: sensor.tsunami_risk,
    aftershock_risk: sensor.aftershock_risk,
    sensor_timestamp: sensor.timestamp,
    zone_bands: { ...ZONE_BAND_FALLBACK },
  })

  const congestion = devices.length === 0
    ? 'UNKNOWN'
    : sensor.severity >= 6.5 ? 'HIGH' : sensor.severity >= 5 ? 'MEDIUM' : 'LOW'
  push(200, 'event_context', {
    devices_in_radius: devices.length,
    shelters_status: 'ok',
    shelters: shelterList,
    network: { congestion_level: congestion, qos_status: devices.length ? 'active' : 'inactive' },
    network_source: 'mock_camara',
    sms_gateway: 'not_configured',
  })

  const stats = { red: emptyStats(), orange: emptyStats(), green: emptyStats() }
  const summary = () => ({
    red: { ...stats.red },
    orange: { ...stats.orange },
    green: { ...stats.green },
    devices_in_radius: devices.length,
    triaged: devices.length,
    location_failed: 0,
  })

  // Triage: every device appears, nearest first, over SIM_TRIAGE_MS.
  devices.forEach((device, i) => {
    const s = stats[device.zone]
    s.total += 1
    if (device.reachability_status === 'NOT_CONNECTED') s.unreachable += 1
    else s.reachable += 1
    push(400 + Math.round((i / Math.max(1, devices.length)) * SIM_TRIAGE_MS), 'device_update', devicePayload(device))
  })

  let at = 400 + SIM_TRIAGE_MS + 200
  let smsNotSent = 0

  if (devices.length) {
    push(at, 'zone_summary', summary())

    // Decisions: zone-pure batches, red first, nearest first — the order the
    // supervisor asks its agent in.
    let batchIndex = 0
    for (const zone of ZONE_ORDER) {
      const inZone = devices.filter((d) => d.zone === zone)
      for (let i = 0; i < inZone.length; i += SIM_BATCH_SIZE) {
        const batch = inZone.slice(i, i + SIM_BATCH_SIZE)
        at += SIM_BATCH_MS
        let reachable = 0
        let sms = 0
        let rescue = 0
        for (const device of batch) {
          const decision = decide(device)
          push(at, 'device_update', devicePayload(device, decision))
          stats[zone].decided += 1
          if (decision.rescue_flag) { stats[zone].rescue_flagged += 1; rescue += 1 }
          if (decision.sms_status === 'not_configured') { smsNotSent += 1; sms += 1 }
          if (device.reachability_status !== 'NOT_CONNECTED') reachable += 1
        }
        push(at, 'zone_summary', summary())
        push(at, 'narrative_update', {
          zone,
          narrative: `${SIM_NARRATIVE_PREFIX} ${zone[0].toUpperCase()}${zone.slice(1)} zone, batch ${batchIndex + 1}: ` +
            `${batch.length} device(s), ${reachable} reachable, ${batch.length - reachable} unreachable. ` +
            `SMS requested for ${sms}, rescue requested for ${rescue}.`,
          batch_index: batchIndex,
        })
        batchIndex += 1
      }
    }
  }

  at += 300
  push(at, 'event_complete', {
    status: devices.length ? 'completed' : 'no_devices',
    duration_ms: at,
    devices_in_radius: devices.length,
    devices_triaged: devices.length,
    devices_decided: devices.length,
    failures: { location: 0, reachability: 0, decision: 0, sms: 0, rescue: 0 },
    sms_not_sent_no_gateway: smsNotSent,
    fatal_error: null,
  })

  return { frames, devices, shelters: shelterList }
}

/** True for a phone number this module generated. */
export function isSimulatedPhone(phone) {
  return typeof phone === 'string' && phone.startsWith(SIM_PHONE_PREFIX)
}
