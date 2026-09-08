import { createMemo } from 'solid-js'
import { haversine, nearestLocality } from './geo'
import { ZONE_ORDER } from '../constants/zones'
import { deriveAction } from './format'

// Derived views over the store. Counts, queues and groupings are computed here
// rather than stored, so there is no second copy of the truth to keep in sync.
//
// Note on counters: zone_summary from the server only counts devices that got
// an AI decision, and derives "reachable" from the AI action rather than the
// device's reachability (agent.md §6.4). The client-side counts below are the
// source of truth for display; the server summary is kept as a cross-check.

export function createSelectors(state) {
  const deviceList = createMemo(() => Object.values(state.devices))

  const epicenter = createMemo(() => state.event?.epicenter ?? null)

  // distance_km is not on the wire — derive it the same way Go does.
  const devicesWithDistance = createMemo(() => {
    const epi = epicenter()
    return deviceList().map(d => ({
      ...d,
      distance_km: epi
        ? haversine({ latitude: d.latitude, longitude: d.longitude }, epi)
        : null,
    }))
  })

  const counts = createMemo(() => {
    const base = { total: 0, reachable: 0, unreachable: 0, sms: 0, rescue: 0 }
    const byZone = {
      red:    { ...base },
      orange: { ...base },
      green:  { ...base },
    }
    let total = 0, reachable = 0, rescue = 0, sms = 0

    for (const d of deviceList()) {
      const z = byZone[d.zone]
      total += 1
      if (d.reachable) reachable += 1
      if (d.sms_sent) sms += 1
      if (d.rescue_flag) rescue += 1
      if (!z) continue
      z.total += 1
      if (d.reachable) z.reachable += 1
      else z.unreachable += 1
      if (d.sms_sent) z.sms += 1
      if (d.rescue_flag) z.rescue += 1
    }

    return {
      byZone,
      total,
      reachable,
      unreachable: total - reachable,
      sms,
      rescue,
      reachableRate: total ? reachable / total : null,
    }
  })

  // The server's own counters, for the cross-check row.
  const serverCounts = createMemo(() => {
    const s = state.summary
    if (!s) return null
    return {
      red:    { total: s.red_total,    reachable: s.red_reachable, rescue: s.red_rescue },
      orange: { total: s.orange_total, reachable: s.orange_reachable },
      green:  { total: s.green_total,  reachable: s.green_reachable },
      total: (s.red_total ?? 0) + (s.orange_total ?? 0) + (s.green_total ?? 0),
    }
  })

  // True when our map holds devices the server summary never counted —
  // itself operationally interesting, so it is surfaced rather than hidden.
  const countsDiverge = createMemo(() => {
    const server = serverCounts()
    if (!server) return false
    return counts().total !== server.total
  })

  // Red zone only, ever. rescue_priority is a backend gap: when it is absent
  // the queue falls back to distance from the epicentre.
  const rescueQueue = createMemo(() =>
    devicesWithDistance()
      .filter(d => d.rescue_flag)
      .sort((a, b) => {
        const pa = a.rescue_priority ?? 99
        const pb = b.rescue_priority ?? 99
        if (pa !== pb) return pa - pb
        return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
      }),
  )

  // Reverse geocoding is a backend gap — devices are bucketed by nearest
  // known locality centroid instead.
  const byLocality = createMemo(() => {
    const buckets = new Map()
    for (const d of deviceList()) {
      const loc = nearestLocality(d.latitude, d.longitude)
      const name = loc?.name ?? 'Unlocated'
      if (!buckets.has(name)) {
        buckets.set(name, { name, zone: loc?.zone ?? null, total: 0, reachable: 0, rescue: 0 })
      }
      const b = buckets.get(name)
      b.total += 1
      if (d.reachable) b.reachable += 1
      if (d.rescue_flag) b.rescue += 1
    }
    return [...buckets.values()].sort((a, b) => b.total - a.total)
  })

  // Errors arrive dozens per event — group so one noisy code can't bury the rest.
  const errorGroups = createMemo(() => {
    const groups = new Map()
    for (const e of state.errors) {
      if (!groups.has(e.code)) {
        groups.set(e.code, { code: e.code, count: 0, fatal: false, latest: null, samples: [] })
      }
      const g = groups.get(e.code)
      g.count += 1
      g.fatal = g.fatal || !!e.fatal
      g.latest = e
      if (g.samples.length < 3) g.samples.push(e)
    }
    return [...groups.values()].sort((a, b) => {
      if (a.fatal !== b.fatal) return a.fatal ? -1 : 1
      return b.count - a.count
    })
  })

  const selectedDevice = createMemo(() => {
    const phone = state.selectedPhone
    if (!phone) return null
    const d = state.devices[phone]
    if (!d) return null
    const epi = epicenter()
    return {
      ...d,
      action: deriveAction(d),
      distance_km: epi
        ? haversine({ latitude: d.latitude, longitude: d.longitude }, epi)
        : null,
      locality: nearestLocality(d.latitude, d.longitude),
    }
  })

  // The ten states from agent.md §11, collapsed into what the UI switches on.
  const streamState = createMemo(() => {
    const conn = state.connection
    const nDevices = counts().total
    const idleMs = conn.lastFrameAt ? Date.now() - conn.lastFrameAt : 0

    if (state.fatal) return 'fatal'
    if (conn.status === 'reconnecting' || conn.status === 'lost') return 'reconnecting'
    if (state.joinedLate && !state.event) return 'joined_late'
    if (!state.event) return 'idle'
    if (nDevices === 0 && idleMs > 8000) return 'no_devices'
    if (nDevices === 0) return 'opening'
    if (idleMs > 30_000) return 'quiet'
    return 'streaming'
  })

  const zoneRows = createMemo(() => {
    const c = counts()
    const radius = state.event?.radius_km ?? null
    return ZONE_ORDER.map(zone => ({
      zone,
      radiusKm: radius,
      ...c.byZone[zone],
      share: c.total ? c.byZone[zone].total / c.total : 0,
      reachableRate: c.byZone[zone].total
        ? c.byZone[zone].reachable / c.byZone[zone].total
        : null,
    }))
  })

  return {
    deviceList,
    devicesWithDistance,
    epicenter,
    counts,
    serverCounts,
    countsDiverge,
    rescueQueue,
    byLocality,
    errorGroups,
    selectedDevice,
    streamState,
    zoneRows,
  }
}
