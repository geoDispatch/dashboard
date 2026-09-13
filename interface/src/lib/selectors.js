import { createMemo } from 'solid-js'
import { haversine } from './geo'
import { ZONE_ORDER, ERROR_SEVERITY } from '../constants/zones'
import { COMPLETE_STATUSES, ZONE_BAND_FALLBACK } from './validate'
import { streamPhase } from './streamState'

// Derived views over the store. Counts, queues and groupings are computed here
// rather than stored, so there is no second copy of the truth to keep in sync.
//
// The client-side counts are over the devices this console holds; the
// supervisor's zone_summary is kept beside them as `serverCounts`, and
// `countsDiverge` says when the two disagree rather than hiding it.

const TERMINAL = new Set(COMPLETE_STATUSES)

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

export function createSelectors(state) {
  const deviceList = createMemo(() => Object.values(state.devices))

  const epicenter = createMemo(() => state.event?.epicenter ?? null)

  // Go's own haversine distance is on the wire and is what the zone was
  // computed from. Recomputing it here is only a display fallback for a value
  // that is somehow missing, and it is labelled as such.
  function withDistance(d, epi) {
    if (isNum(d.distance_km)) return { ...d, distanceSource: 'supervisor' }
    const computed = epi ? haversine({ latitude: d.latitude, longitude: d.longitude }, epi) : null
    return { ...d, distance_km: computed, distanceSource: computed === null ? null : 'computed' }
  }

  const devicesWithDistance = createMemo(() => {
    const epi = epicenter()
    return deviceList().map((d) => withDistance(d, epi))
  })

  const counts = createMemo(() => {
    const base = {
      total: 0, reachable: 0, unreachable: 0, sms: 0, rescue: 0,
      decided: 0, decisionFailed: 0, smsFailed: 0,
    }
    const byZone = {
      red:    { ...base },
      orange: { ...base },
      green:  { ...base },
    }
    const all = { ...base, smsNotConfigured: 0 }

    for (const d of deviceList()) {
      const buckets = byZone[d.zone] ? [all, byZone[d.zone]] : [all]
      for (const b of buckets) {
        b.total += 1
        if (d.reachable) b.reachable += 1
        else b.unreachable += 1
        if (d.sms_sent) b.sms += 1
        if (d.sms_status === 'failed') b.smsFailed += 1
        // Independent of zone: an orange or green device can be flagged too.
        if (d.rescue_flag) b.rescue += 1
        if (d.stage === 'decided') b.decided += 1
        if (d.stage === 'decision_failed') b.decisionFailed += 1
      }
      if (d.sms_status === 'not_configured') all.smsNotConfigured += 1
    }

    return {
      ...all,
      byZone,
      reachableRate: all.total ? all.reachable / all.total : null,
    }
  })

  // The supervisor's own cumulative counters (zone_summary), for the
  // cross-check row. Reachability there is CAMARA's, the same as ours.
  const serverCounts = createMemo(() => {
    const s = state.summary
    if (!s) return null
    return {
      red:             s.red,
      orange:          s.orange,
      green:           s.green,
      total:           s.red.total + s.orange.total + s.green.total,
      devicesInRadius: s.devices_in_radius,
      triaged:         s.triaged,
      locationFailed:  s.location_failed,
    }
  })

  // True when the map holds a different number of devices from the ones the
  // supervisor says it triaged — operationally interesting, so surfaced.
  const countsDiverge = createMemo(() => {
    const server = serverCounts()
    if (!server) return false
    return counts().total !== server.total
  })

  // Every rescue flag, whatever the zone. The AI can flag an orange or green
  // device it judges to be in trouble; the dashboard shows the flag it was
  // sent, not a second opinion on which band deserves one. Ordered by the
  // backend's priority (1 = most urgent … 10), with 0 / missing last, then by
  // distance from the epicentre.
  const rescueQueue = createMemo(() => {
    const rank = (p) => (isNum(p) && p >= 1 ? p : Infinity)
    return devicesWithDistance()
      .filter((d) => d.rescue_flag)
      .sort((a, b) => {
        const pa = rank(a.rescue_priority)
        const pb = rank(b.rescue_priority)
        if (pa !== pb) return pa - pb
        return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
      })
  })

  // Devices grouped by the supervisor's zone. There is no place name on the
  // wire, so there is no grouping by place.
  const zoneGroups = createMemo(() => {
    const c = counts()
    return ZONE_ORDER.map((zone) => ({
      zone,
      total:     c.byZone[zone].total,
      reachable: c.byZone[zone].reachable,
      rescue:    c.byZone[zone].rescue,
    }))
  })

  // Nearest shelters as the supervisor looked them up. Empty when there is no
  // context yet, none were found, or the query failed — `context.shelters_status`
  // says which.
  const shelters = createMemo(() => state.context?.shelters ?? [])

  const zoneBands = createMemo(() => {
    const b = state.event?.zone_bands
    const usable = b && ZONE_ORDER.every((z) => isNum(b[z]))
    return usable ? b : ZONE_BAND_FALLBACK
  })

  // Errors arrive in bursts — group so one noisy code can't bury the rest.
  const errorGroups = createMemo(() => {
    const groups = new Map()
    for (const e of state.errors) {
      if (!groups.has(e.code)) {
        groups.set(e.code, {
          code: e.code,
          // What the code actually means to an operator, not just its name.
          reads: ERROR_SEVERITY[e.code]?.reads ?? 'Unrecognised error code',
          count: 0,
          fatal: false,
          latest: null,
          samples: [],
        })
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
    return withDistance(d, epicenter())
  })

  // What the TRANSPORT is doing. Reads connection.now, which is ticked twice a
  // second, so "stalled" is a state the UI actually reaches.
  const phase = createMemo(() => streamPhase({
    status:          state.connection.status,
    framesSinceOpen: state.connection.framesSinceOpen,
    lastFrameAt:     state.connection.lastFrameAt,
    now:             state.connection.now,
  }))

  // What the INCIDENT is doing, as far as this console can honestly say:
  //
  //   disconnected   no open socket — anything on screen is the last received state
  //   syncing        open, but the connection snapshot has not finished
  //   idle           in step with a supervisor that holds no incident
  //   opening        event_start received, no device yet
  //   running        devices arriving
  //   completed | completed_with_failures | no_devices | failed
  //                  event_complete received
  const incidentState = createMemo(() => {
    const status = state.connection.status
    if (status !== 'open' && status !== 'simulation') return 'disconnected'
    if (state.sync.phase !== 'live') return 'syncing'
    if (!state.event) return 'idle'
    if (TERMINAL.has(state.lifecycle.status)) return state.lifecycle.status
    return deviceList().length === 0 ? 'opening' : 'running'
  })

  const zoneRows = createMemo(() => {
    const c = counts()
    const radius = state.event?.radius_km ?? null
    const bands = zoneBands()
    return ZONE_ORDER.map((zone) => ({
      zone,
      radiusKm: radius,
      bandFraction: bands[zone],
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
    zoneGroups,
    shelters,
    zoneBands,
    errorGroups,
    selectedDevice,
    phase,
    incidentState,
    zoneRows,
  }
}
