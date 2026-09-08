// Browser-side demo stream — the Al Haouz M6.8 scenario.
//
// It emits the same five contract frames the Go supervisor emits, in the same
// order, so nothing downstream knows the difference. Two deliberate departures,
// both demo-only and both marked with `demo: true` on the payload:
//
//   1. device_update carries the AI decision detail (rescue_priority,
//      confidence, shelter_name, zone_escalated, reachability_status,
//      location_radius_m, last_location_time). The real backend does not send
//      these yet — agent.md §6.2 — and the panels that show them would
//      otherwise be empty on a demo machine.
//   2. Frames are emitted in per-tick groups so 4,812 devices can stream in
//      without a frame per event-loop turn.
//
// `reasoning` is never generated. It is audit-only by contract.

import { AL_HAOUZ_LOCALITIES } from './geo'

const EVENT_ID = 'AL-HAOUZ-01'

export const AL_HAOUZ_EVENT = {
  disaster_type:   'earthquake',
  severity:        6.8,
  epicenter:       { latitude: 31.0625, longitude: -8.4144 },
  radius_km:       50,
  tsunami_risk:    false,
  aftershock_risk: 'HIGH',
}

const SHELTERS = [
  { name: 'Lycée Ibn Sina',      occupied: 847, capacity: 1200 },
  { name: 'Centre Sportif Asni', occupied: 612, capacity:  800 },
  { name: 'École Moulay Brahim', occupied: 450, capacity:  450 },  // full, on purpose
]

const NARRATIVES = {
  red:
    "Red zone: 1,129 devices confirmed within 17 km of the epicentre. 892 reachable via SMS — " +
    "evacuation messages dispatched with shelter routing to Lycée Ibn Sina (1.2 km north) and " +
    "Centre Sportif Asni (4.6 km east). 237 devices returned NOT_CONNECTED across three " +
    "consecutive polls in terrain flagged for collapse risk; rescue teams dispatched, 41 " +
    "currently en route. Network congestion HIGH along the R203 corridor, QoS boost active. " +
    "SMS delivery holding at 94%.",
  orange:
    "Orange zone: 2,340 devices between 17 and 33 km. 2,106 reachable — evacuation SMS sent with " +
    "shelter routing. Structural damage reported in Amizmiz and Moulay Brahim; no rescue flags " +
    "raised in this band. Congestion easing to MEDIUM north of Asni.",
  green:
    "Green zone: 1,343 devices between 33 and 50 km. 1,298 reachable — alert and monitor only, " +
    "no evacuation ordered. Tahannaout and Marrakech Sud report power interruptions but intact " +
    "road access. Recommend holding capacity at Lycée Ibn Sina for red-zone arrivals.",
}

// Deterministic PRNG so the demo is identical on every run — a stage demo that
// changes shape between rehearsal and performance is worse than no demo.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function zoneFor(distanceKm, radiusKm) {
  if (distanceKm <= radiusKm * 0.33) return 'red'
  if (distanceKm <= radiusKm * 0.66) return 'orange'
  return 'green'
}

// Build the population once: devices scattered around the demo localities,
// with a tail spread across the disc so the map does not look like seven blobs.
export function buildPopulation({ total = 4812, seed = 20230908 } = {}) {
  const rnd = mulberry32(seed)
  const epi = AL_HAOUZ_EVENT.epicenter
  const radius = AL_HAOUZ_EVENT.radius_km
  const devices = []

  const localityTotal = AL_HAOUZ_LOCALITIES.reduce((n, l) => n + l.people, 0)
  const scale = total / localityTotal

  let i = 0
  for (const loc of AL_HAOUZ_LOCALITIES) {
    const n = Math.round(loc.people * scale)
    for (let k = 0; k < n; k++) {
      // Scatter around the locality centroid — tighter for small settlements.
      const spread = 0.045 + rnd() * 0.03
      const lat = loc.latitude + (rnd() - 0.5) * spread * 2
      const lng = loc.longitude + (rnd() - 0.5) * spread * 2.4
      const dKm = distanceKm(lat, lng, epi)
      devices.push(makeDevice(i++, lat, lng, dKm, radius, rnd, loc.name))
    }
  }

  return devices.sort((a, b) => a._distance - b._distance)
}

function distanceKm(lat, lng, epi) {
  const dLat = (lat - epi.latitude) * 111
  const dLng = (lng - epi.longitude) * 111 * Math.cos((epi.latitude * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

function makeDevice(i, lat, lng, dKm, radius, rnd, localityName) {
  const zone = zoneFor(dKm, radius)

  // Reachability degrades sharply inside the red band — collapsed cells and
  // terrain shadow are the whole reason the rescue queue exists.
  const reachChance = zone === 'red' ? 0.79 : zone === 'orange' ? 0.90 : 0.966
  const reachable = rnd() < reachChance

  const status = !reachable
    ? 'NOT_CONNECTED'
    : rnd() < 0.62 ? 'CONNECTED_DATA' : 'CONNECTED_SMS'

  // Only red-zone unreachable devices are ever rescue-flagged.
  const rescue = zone === 'red' && !reachable

  return {
    phone: `+2126${String(10_000_000 + i * 7 + 13).slice(-8)}`,
    latitude:  Number(lat.toFixed(5)),
    longitude: Number(lng.toFixed(5)),
    zone,
    reachable,
    sms_sent: false,
    rescue_flag: false,

    // demo-only enrichment (agent.md §6.2)
    demo: true,
    reachability_status: status,
    location_radius_m: Math.round(320 + rnd() * 400),
    last_location_time: new Date(Date.now() - Math.round(rnd() * 240_000)).toISOString(),
    locality_name: localityName,

    // internal, stripped before emit
    _distance: dKm,
    _rescue: rescue,
    _rnd: rnd(),
  }
}

function decisionFor(dev, rnd) {
  const rescue = dev._rescue
  const sms = dev.reachable
  const shelter = SHELTERS[Math.floor(dev._rnd * SHELTERS.length)]
  return {
    sms_sent: sms,
    rescue_flag: rescue,
    // demo-only decision detail
    rescue_priority: rescue ? 1 + Math.floor(dev._rnd * 10) : 0,
    confidence: Number((0.72 + dev._rnd * 0.27).toFixed(2)),
    shelter_name: shelter.name,
    zone_escalated: dev.zone === 'orange' && dev._rnd > 0.94,
    sms_message: sms
      ? 'ALERTE SEISME M6.8. Evacuez immediatement vers ' + shelter.name +
        ', 1.2km nord. Evitez les batiments endommages et les lignes electriques. ' +
        "Ne prenez pas votre vehicule. Repliques probables - restez a l'exterieur. Protection Civile."
      : '',
  }
}

const strip = (d) => {
  const { _distance, _rescue, _rnd, ...rest } = d
  return rest
}

const envelope = (type, payload, timestamp = 0) => ({
  type, event_id: EVENT_ID, timestamp, payload,
})

/**
 * Drive the Al Haouz scenario into `onFrames(frames[])`.
 * Returns a stop function. Frames arrive in groups, matching how a real burst
 * lands, and the caller is expected to apply a group inside one batch().
 */
export function startMockStream(onFrames, {
  total = 4812,
  triageMs = 7000,
  batchSize = 220,
  tickMs = 90,
  includeErrors = true,
  loop = false,
} = {}) {
  let stopped = false
  let timer = null
  const rnd = mulberry32(9182736)

  const devices = buildPopulation({ total })
  const emit = (frames) => { if (!stopped && frames.length) onFrames(frames) }

  function run() {
    emit([envelope('event_start', AL_HAOUZ_EVENT, Date.now())])

    // ── phase 1: triage — dots appear, no decisions yet ──────
    const perTick = Math.max(1, Math.ceil(devices.length / (triageMs / tickMs)))
    let cursor = 0

    const triageTick = () => {
      if (stopped) return
      const slice = devices.slice(cursor, cursor + perTick)
      cursor += perTick

      const frames = slice.map(d => envelope('device_update', {
        ...strip(d),
        sms_sent: false,
        rescue_flag: false,
      }))

      // A handful of CAMARA timeouts — dozens per event is normal, and the
      // error rail needs to survive them.
      if (includeErrors && rnd() < 0.22) {
        frames.push(envelope('error', {
          code: 'CAMARA_TIMEOUT',
          message: `location lookup failed: context deadline exceeded`,
          phone: slice[0]?.phone ?? '',
          fatal: false,
        }))
      }

      emit(frames)

      if (cursor < devices.length) timer = setTimeout(triageTick, tickMs)
      else timer = setTimeout(dispatchStart, 600)
    }

    // ── phase 2: dispatch — batches, each followed by summary + narrative ──
    const summary = {
      red_total: 0, red_reachable: 0, red_rescue: 0,
      orange_total: 0, orange_reachable: 0,
      green_total: 0, green_reachable: 0,
    }
    let bCursor = 0

    function dispatchStart() { dispatchTick() }

    const dispatchTick = () => {
      if (stopped) return
      const slice = devices.slice(bCursor, bCursor + batchSize)
      bCursor += batchSize
      if (!slice.length) return finish()

      const frames = []
      for (const d of slice) {
        const decision = decisionFor(d, rnd)
        frames.push(envelope('device_update', { ...strip(d), ...decision }))
        summary[`${d.zone}_total`] += 1
        if (decision.sms_sent) summary[`${d.zone}_reachable`] += 1
        if (decision.rescue_flag) summary.red_rescue += 1
      }

      if (includeErrors && rnd() < 0.3) {
        frames.push(envelope('error', {
          code: 'SMS_FAILED',
          message: 'SMS delivery failed for device after 3 retries',
          phone: slice[Math.floor(rnd() * slice.length)]?.phone ?? '',
          fatal: false,
        }))
      }

      frames.push(envelope('zone_summary', { ...summary }))
      frames.push(envelope('narrative_update', {
        zone: slice[0].zone,
        narrative: NARRATIVES[slice[0].zone],
      }))

      emit(frames)
      timer = setTimeout(dispatchTick, tickMs * 2)
    }

    function finish() {
      if (loop && !stopped) timer = setTimeout(run, 4000)
    }

    timer = setTimeout(triageTick, 900)
  }

  run()

  return function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

export { SHELTERS, NARRATIVES, EVENT_ID }
