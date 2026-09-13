// Ingestion, end to end without a socket: raw frame → validateFrame →
// routeMessage → store.apply → selectors. The same path the socket uses, so
// what passes here is what the console does with real frames.

import { afterEach, describe, expect, it } from 'vitest'
import { createRoot } from 'solid-js'

import { createConsoleStore } from './store'
import { createSelectors } from './selectors'
import { routeMessage } from './router'
import { eventFitKey } from './mapFit'
import {
  EVENT_A,
  EVENT_B,
  asReplay,
  completePayload,
  contextPayload,
  decidedPayload,
  devicePayload,
  envelope,
  errorPayload,
  eventStream,
  heartbeat,
  narrativePayload,
  snapshotBegin,
  snapshotEnd,
  summaryPayload,
  zoneStats,
} from './v2frames.fixture'

const PHONE_1 = '+212600000001'
const PHONE_2 = '+212600000002'
const PHONE_3 = '+212600000003'

let disposers = []
afterEach(() => {
  disposers.forEach((d) => d())
  disposers = []
})

function setup() {
  let clock = 1_000_000
  const now = () => clock
  return createRoot((dispose) => {
    disposers.push(dispose)
    const { state, actions } = createConsoleStore({ now })
    const sel = createSelectors(state)
    const feed = (...frames) => frames.map((f) => routeMessage(actions, f).status)
    // An open socket that has finished an empty snapshot: in step with a
    // supervisor that holds nothing, which is where every live test starts.
    const connect = (eventId = '', headSeq = 0) => {
      actions.setStatus('open')
      const lifecycle = eventId ? 'running' : 'idle'
      return feed(snapshotBegin(eventId, headSeq, lifecycle), snapshotEnd(eventId, headSeq))
    }
    return { state, actions, sel, feed, connect, advance: (ms) => { clock += ms } }
  })
}

describe('neutral empty state', () => {
  it('a fresh store holds no incident data at all', () => {
    const { state, sel } = setup()

    expect(state.event).toBeNull()
    expect(state.activeEventId).toBeNull()
    expect(state.context).toBeNull()
    expect(state.devices).toEqual({})
    expect(state.summary).toBeNull()
    expect(state.narratives).toEqual({})
    expect(state.errors).toEqual([])
    expect(state.lifecycle).toEqual({ status: 'idle', complete: null })
    expect(state.pipeline.fatal).toBeNull()
    expect(state.selectedPhone).toBeNull()
    expect(state.sync.needsResync).toBeNull()
    expect(state.connection.lastFrameAt).toBe(0)

    expect(sel.deviceList()).toEqual([])
    expect(sel.rescueQueue()).toEqual([])
    expect(sel.shelters()).toEqual([])
    expect(sel.epicenter()).toBeNull()
    expect(sel.incidentState()).toBe('disconnected')
    expect(eventFitKey(state.event)).toBeNull()
  })

  it('a supervisor holding nothing leaves it empty and reads idle', () => {
    const { state, sel, connect } = setup()
    expect(connect()).toEqual(['control', 'control'])
    expect(state.event).toBeNull()
    expect(state.devices).toEqual({})
    expect(sel.incidentState()).toBe('idle')
  })
})

describe('two incidents', () => {
  it('Event B shares nothing with Event A: id, epicentre and radius all differ', () => {
    const { state, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start({ ...a.start().payload, epicenter: { latitude: 33.5731, longitude: -7.5898 }, radius_km: 15 }))
    expect(state.event.event_id).toBe(EVENT_A)
    expect(state.event.radius_km).toBe(15)
    const keyA = eventFitKey(state.event)

    feed(a.next('event_complete', completePayload({ devices_in_radius: 0, devices_triaged: 0, devices_decided: 0, status: 'no_devices' })))

    const b = eventStream(EVENT_B)
    feed(b.start({ ...b.start().payload, epicenter: { latitude: 47.4979, longitude: 19.0402 }, radius_km: 10 }))
    expect(state.event.event_id).toBe(EVENT_B)
    expect(state.event.epicenter).toEqual({ latitude: 47.4979, longitude: 19.0402 })
    expect(state.event.radius_km).toBe(10)
    expect(eventFitKey(state.event)).not.toBe(keyA)
  })

  it("Event B's event_start clears ALL of Event A", () => {
    const { state, actions, sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(
      a.start(),
      a.next('event_context', contextPayload()),
      a.next('device_update', decidedPayload({ phone: PHONE_1 })),
      a.next('zone_summary', summaryPayload()),
      a.next('narrative_update', narrativePayload()),
      a.next('error', errorPayload({ code: 'DB_ERROR', stage: 'lookup', fatal: true, message: 'lookup failed' })),
      a.next('event_complete', completePayload({ status: 'failed', fatal_error: { code: 'DB_ERROR', message: 'lookup failed' } })),
    )
    // A stray frame for some third incident, counted against A.
    feed(envelope('device_update', 'OTHER-1', 3, devicePayload()))
    actions.selectDevice(PHONE_1)

    expect(Object.keys(state.devices)).toEqual([PHONE_1])
    expect(state.pipeline.fatal).not.toBeNull()
    expect(state.lifecycle.status).toBe('failed')
    expect(state.counters.foreign).toBe(1)

    const b = eventStream(EVENT_B)
    expect(feed(b.start())).toEqual(['accepted'])

    expect(state.activeEventId).toBe(EVENT_B)
    expect(state.devices).toEqual({})
    expect(state.context).toBeNull()
    expect(state.summary).toBeNull()
    expect(state.narratives).toEqual({})
    expect(state.errors).toEqual([])
    expect(state.selectedPhone).toBeNull()
    expect(state.selectedZone).toBeNull()
    expect(state.pipeline.fatal).toBeNull()
    expect(state.pipeline.framesAfterFatal).toBe(0)
    expect(state.lifecycle).toEqual({ status: 'running', complete: null })
    expect(state.counters.foreign).toBe(0)
    expect(state.counters.lastForeignId).toBeNull()
    expect(state.sync.lastSeq).toBe(1)
    expect(sel.incidentState()).toBe('opening')
  })
})

describe('devices merge by phone', () => {
  it('two updates for one phone make one device; the second state wins; selection is kept', () => {
    const { state, actions, sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start(), a.next('device_update', devicePayload({ phone: PHONE_1 })))
    actions.selectDevice(PHONE_1)

    feed(a.next('device_update', decidedPayload({ phone: PHONE_1, action: 'both', rescue_priority: 2, sms_status: 'not_configured' })))

    expect(Object.keys(state.devices)).toEqual([PHONE_1])
    expect(sel.deviceList()).toHaveLength(1)
    expect(state.devices[PHONE_1].stage).toBe('decided')
    expect(state.devices[PHONE_1].action).toBe('both')
    expect(state.devices[PHONE_1].sms_status).toBe('not_configured')
    expect(state.devices[PHONE_1].seq).toBe(3)
    expect(state.selectedPhone).toBe(PHONE_1)
    expect(sel.selectedDevice().stage).toBe('decided')
  })

  it('a phone re-sent with changed coordinates moves; still one entry', () => {
    const { state, sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start(), a.next('device_update', devicePayload({ phone: PHONE_1, latitude: 33.5, longitude: -7.5, distance_km: 1 })))
    feed(a.next('device_update', devicePayload({ phone: PHONE_1, latitude: 33.6, longitude: -7.6, distance_km: 4, zone: 'orange' })))

    expect(sel.deviceList()).toHaveLength(1)
    expect(state.devices[PHONE_1]).toMatchObject({ latitude: 33.6, longitude: -7.6, zone: 'orange', distance_km: 4 })
    expect(sel.counts().byZone.red.total).toBe(0)
    expect(sel.counts().byZone.orange.total).toBe(1)
  })
})

describe('map fit key', () => {
  it('changes when an event_start reuses an event_id with a moved epicentre or a new radius', () => {
    const base = { event_id: EVENT_A, epicenter: { latitude: 33.5, longitude: -7.5 }, radius_km: 15 }
    expect(eventFitKey(base)).toBe(`${EVENT_A}|33.5|-7.5|15`)
    expect(eventFitKey({ ...base, epicenter: { latitude: 33.6, longitude: -7.5 } })).not.toBe(eventFitKey(base))
    expect(eventFitKey({ ...base, radius_km: 20 })).not.toBe(eventFitKey(base))
    expect(eventFitKey(null)).toBeNull()
  })

  it('follows the store when a supervisor replays a reused id with a different epicentre', () => {
    const { state, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start())
    const before = eventFitKey(state.event)

    // The supervisor restarted with a wiped database and the same id was
    // accepted again, somewhere else. The reconnect snapshot says so.
    const moved = eventStream(EVENT_A).start({ ...a.start().payload, epicenter: { latitude: 34.0209, longitude: -6.8416 }, radius_km: 30 })
    feed(snapshotBegin(EVENT_A, 1), asReplay(moved), snapshotEnd(EVENT_A, 1, 1))

    expect(state.event.epicenter).toEqual({ latitude: 34.0209, longitude: -6.8416 })
    expect(eventFitKey(state.event)).not.toBe(before)
  })
})

describe('connection snapshots', () => {
  function replayOf(stream) {
    return [
      asReplay(stream.start()),
      asReplay(stream.at(2, 'event_context', contextPayload())),
      asReplay(stream.at(4, 'device_update', devicePayload({ phone: PHONE_2, zone: 'orange', distance_km: 6 }))),
      asReplay(stream.at(5, 'device_update', decidedPayload({ phone: PHONE_1 }))),
      asReplay(stream.at(6, 'zone_summary', summaryPayload())),
      asReplay(stream.at(7, 'narrative_update', narrativePayload())),
    ]
  }

  it('late join: the snapshot rebuilds state and lastSeq becomes head_seq', () => {
    const { state, sel, actions, feed } = setup()
    actions.setStatus('open')
    const a = eventStream(EVENT_A)

    const statuses = feed(snapshotBegin(EVENT_A, 9), ...replayOf(a))
    expect(statuses).toEqual(['control', 'accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'accepted'])
    expect(state.sync.phase).toBe('snapshot')
    expect(sel.incidentState()).toBe('syncing')

    feed(snapshotEnd(EVENT_A, 9, 6))
    expect(state.sync.phase).toBe('live')
    expect(state.sync.lastSeq).toBe(9)
    expect(state.sync.needsResync).toBeNull()
    expect(state.event.event_id).toBe(EVENT_A)
    expect(Object.keys(state.devices).sort()).toEqual([PHONE_1, PHONE_2])
    expect(state.context.devices_in_radius).toBe(2)
    expect(state.narratives.red.batch_index).toBe(0)
    expect(sel.incidentState()).toBe('running')

    // Live frames continue from head_seq: 10 is next, 9 is already applied.
    expect(feed(a.at(9, 'device_update', devicePayload({ phone: PHONE_3 })))).toEqual(['duplicate'])
    expect(feed(a.at(10, 'device_update', devicePayload({ phone: PHONE_3 })))).toEqual(['accepted'])
    expect(state.devices[PHONE_3]).toBeDefined()
  })

  it('reconnect with a snapshot of the SAME event keeps the selection when the device still exists', () => {
    const { state, actions, feed } = setup()
    actions.setStatus('open')
    const a = eventStream(EVENT_A)
    feed(snapshotBegin(EVENT_A, 7), ...replayOf(a), snapshotEnd(EVENT_A, 7, 6))
    actions.selectDevice(PHONE_2)

    // The socket drops and a new one opens.
    actions.setStatus('reconnecting')
    actions.setStatus('open')
    feed(snapshotBegin(EVENT_A, 7), ...replayOf(a), snapshotEnd(EVENT_A, 7, 6))

    expect(state.selectedPhone).toBe(PHONE_2)
    expect(Object.keys(state.devices)).toHaveLength(2)
    expect(state.counters.duplicate).toBe(0)
  })

  it('drops the selection at snapshot_end when the device is gone', () => {
    const { state, actions, feed } = setup()
    actions.setStatus('open')
    const a = eventStream(EVENT_A)
    feed(snapshotBegin(EVENT_A, 7), ...replayOf(a), snapshotEnd(EVENT_A, 7, 6))
    actions.selectDevice(PHONE_2)

    const withoutPhone2 = replayOf(a).filter((f) => f.payload.phone !== PHONE_2)
    feed(snapshotBegin(EVENT_A, 7), ...withoutPhone2)
    // Kept while the snapshot is still arriving…
    expect(state.selectedPhone).toBe(PHONE_2)
    feed(snapshotEnd(EVENT_A, 7, 5))
    // …and dropped once it is complete without that device.
    expect(state.selectedPhone).toBeNull()
  })

  it('a snapshot of a DIFFERENT event takes nothing from the old one', () => {
    const { state, actions, feed } = setup()
    actions.setStatus('open')
    const a = eventStream(EVENT_A)
    feed(snapshotBegin(EVENT_A, 7), ...replayOf(a), snapshotEnd(EVENT_A, 7, 6))
    actions.selectDevice(PHONE_1)

    const b = eventStream(EVENT_B)
    feed(snapshotBegin(EVENT_B, 1), asReplay(b.start()), snapshotEnd(EVENT_B, 1, 1))
    expect(state.activeEventId).toBe(EVENT_B)
    expect(state.devices).toEqual({})
    expect(state.selectedPhone).toBeNull()
  })

  it('snapshot_begin with event_id "" while holding an event blanks the board and records lostEventId', () => {
    const { state, actions, sel, feed } = setup()
    actions.setStatus('open')
    const a = eventStream(EVENT_A)
    feed(snapshotBegin(EVENT_A, 7), ...replayOf(a), snapshotEnd(EVENT_A, 7, 6))

    feed(snapshotBegin('', 0, 'idle'), snapshotEnd('', 0))

    expect(state.event).toBeNull()
    expect(state.devices).toEqual({})
    expect(state.sync.lostEventId).toBe(EVENT_A)
    expect(state.sync.needsResync).toBeNull()
    expect(sel.incidentState()).toBe('idle')

    // The next incident clears the note.
    feed(eventStream(EVENT_B).start())
    expect(state.sync.lostEventId).toBeNull()
  })

  it('a snapshot that promises an event but never replays its event_start asks for a resync', () => {
    const { state, actions, feed } = setup()
    actions.setStatus('open')
    expect(feed(snapshotBegin(EVENT_A, 3), snapshotEnd(EVENT_A, 3, 0))).toEqual(['control', 'control'])
    expect(state.event).toBeNull()
    expect(state.sync.needsResync).toMatch(/event_start/)
  })
})

describe('gating by event and by seq', () => {
  it('frames for another event are counted foreign and not applied', () => {
    const { state, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start())

    expect(feed(eventStream(EVENT_B).at(2, 'device_update', devicePayload()))).toEqual(['foreign'])
    expect(state.devices).toEqual({})
    expect(state.counters.foreign).toBe(1)
    expect(state.counters.lastForeignId).toBe(EVENT_B)
    expect(state.activeEventId).toBe(EVENT_A)
  })

  it('an event frame with no event_start is not adopted: foreign, and a resync is requested', () => {
    const { state, feed, connect } = setup()
    connect()

    expect(feed(eventStream(EVENT_A).at(5, 'device_update', decidedPayload()))).toEqual(['foreign'])
    expect(state.event).toBeNull()
    expect(state.activeEventId).toBeNull()
    expect(state.devices).toEqual({})
    expect(state.counters.foreign).toBe(1)
    expect(state.sync.needsResync).toMatch(/without event_start/)
  })

  it('duplicate, stale and out-of-order frames (seq ≤ lastSeq) are counted and dropped', () => {
    const { state, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(
      a.start(),
      a.next('device_update', devicePayload({ phone: PHONE_1 })),                        // 2
      a.next('device_update', decidedPayload({ phone: PHONE_1, rescue_priority: 3 })),   // 3
    )

    const statuses = feed(
      a.at(3, 'device_update', decidedPayload({ phone: PHONE_1, rescue_priority: 9 })), // duplicate
      a.at(2, 'device_update', devicePayload({ phone: PHONE_1 })),                      // stale
      a.start(),                                                                        // replayed start, live
    )
    expect(statuses).toEqual(['duplicate', 'duplicate', 'duplicate'])
    expect(state.counters.duplicate).toBe(3)
    expect(state.devices[PHONE_1].stage).toBe('decided')
    expect(state.devices[PHONE_1].rescue_priority).toBe(3)
    expect(state.sync.lastSeq).toBe(3)
    expect(state.sync.needsResync).toBeNull()
  })

  it('a gap is counted, the frame applied, and a resync requested', () => {
    const { state, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start())

    expect(feed(a.at(5, 'device_update', devicePayload({ phone: PHONE_2 })))).toEqual(['accepted'])
    expect(state.devices[PHONE_2]).toBeDefined()
    expect(state.counters.gaps).toBe(1)
    expect(state.sync.lastSeq).toBe(5)
    expect(state.sync.needsResync).toMatch(/gap/)
  })

  it('a heartbeat ahead of lastSeq, or naming another event, requests a resync; a matching one does not', () => {
    const ahead = setup()
    ahead.connect()
    const a = eventStream(EVENT_A)
    ahead.feed(a.start(), a.next('event_context', contextPayload()))
    expect(ahead.feed(heartbeat(EVENT_A, 2))).toEqual(['control'])
    expect(ahead.state.sync.needsResync).toBeNull()
    ahead.feed(heartbeat(EVENT_A, 4))
    expect(ahead.state.sync.needsResync).toMatch(/ahead/)

    const other = setup()
    other.connect()
    other.feed(eventStream(EVENT_A).start())
    other.feed(heartbeat(EVENT_B, 1))
    expect(other.state.sync.needsResync).toMatch(/different event/)

    // A console that holds nothing hears the supervisor holds something.
    const empty = setup()
    empty.connect()
    empty.feed(heartbeat(EVENT_A, 12))
    expect(empty.state.sync.needsResync).not.toBeNull()
  })

  it('a snapshot answers the pending resync', () => {
    const { state, feed, connect } = setup()
    connect()
    feed(eventStream(EVENT_A).at(4, 'device_update', devicePayload()))
    expect(state.sync.needsResync).not.toBeNull()
    feed(snapshotBegin(EVENT_A, 4))
    expect(state.sync.needsResync).toBeNull()
  })
})

describe('malformed frames', () => {
  const a = eventStream(EVENT_A)
  const bad = {
    'bad JSON':          '{"v":2,"type":"device_update",',
    'bad phone':         a.at(2, 'device_update', devicePayload({ phone: '0612345678' })),
    'lat 91':            a.at(2, 'device_update', devicePayload({ latitude: 91 })),
    'zone yellow':       a.at(2, 'device_update', devicePayload({ zone: 'yellow' })),
    'reachable "yes"':   a.at(2, 'device_update', devicePayload({ reachable: 'yes' })),
    'missing field':     (() => { const p = devicePayload(); delete p.zone; return a.at(2, 'device_update', p) })(),
    'missing envelope':  (() => { const f = a.at(2, 'device_update', devicePayload()); delete f.seq; return f })(),
    'unknown type':      envelope('device_removed', EVENT_A, 2, {}),
    'v1 frame':          { type: 'device_update', event_id: EVENT_A, timestamp: 1, payload: devicePayload() },
    'not an object':     [1, 2, 3],
    'null':              null,
  }

  it.each(Object.keys(bad))('%s: counted invalid, store untouched, freshness not refreshed', (name) => {
    const { state, feed, connect, advance } = setup()
    connect()
    feed(a.start(), a.next('device_update', devicePayload({ phone: PHONE_1 })))
    const before = JSON.stringify({ devices: state.devices, event: state.event, sync: state.sync })
    const lastFrameAt = state.connection.lastFrameAt
    const frames = state.connection.framesSinceOpen
    advance(5_000)

    expect(feed(bad[name])).toEqual(['invalid'])
    expect(state.counters.invalid).toBe(1)
    expect(state.counters.lastInvalidReason).toEqual(expect.any(String))
    expect(JSON.stringify({ devices: state.devices, event: state.event, sync: state.sync })).toBe(before)
    expect(state.connection.lastFrameAt).toBe(lastFrameAt)
    expect(state.connection.framesSinceOpen).toBe(frames)
  })

  it('a reason never carries the phone number', () => {
    const { state, feed } = setup()
    feed(a.at(2, 'device_update', devicePayload({ phone: '+212612345678', zone: 'yellow' })))
    expect(state.counters.lastInvalidReason).not.toContain('612345678')
  })
})

describe('payload semantics', () => {
  it('zone_summary replaces, it does not add up', () => {
    const { state, sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start())
    feed(a.next('zone_summary', summaryPayload({ red: zoneStats({ total: 5, unreachable: 5 }), triaged: 5, devices_in_radius: 5 })))
    feed(a.next('zone_summary', summaryPayload({ red: zoneStats({ total: 3, unreachable: 3 }), triaged: 3, devices_in_radius: 5 })))

    expect(state.summary.red.total).toBe(3)
    expect(state.summary.triaged).toBe(3)
    expect(sel.serverCounts().total).toBe(3)
    expect(sel.serverCounts().devicesInRadius).toBe(5)
  })

  it('narratives are stored by zone, latest per zone wins', () => {
    const { state, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(
      a.start(),
      a.next('narrative_update', narrativePayload({ zone: 'red', narrative: 'red one', batch_index: 0 })),
      a.next('narrative_update', narrativePayload({ zone: 'orange', narrative: 'orange one', batch_index: 1 })),
      a.next('narrative_update', narrativePayload({ zone: 'red', narrative: 'red two', batch_index: 2 })),
    )
    expect(Object.keys(state.narratives).sort()).toEqual(['orange', 'red'])
    expect(state.narratives.red.narrative).toBe('red two')
    expect(state.narratives.orange.narrative).toBe('orange one')
    expect(state.batchCount).toBe(3)
  })

  it('event_context replaces the previous context', () => {
    const { state, sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start(), a.next('event_context', contextPayload({ network: { congestion_level: 'HIGH', qos_status: 'requested' } })))
    feed(a.next('event_context', contextPayload({ shelters_status: 'unavailable', shelters: [] })))
    expect(state.context.shelters_status).toBe('unavailable')
    expect(state.context.network.qos_status).toBe('active')
    expect(sel.shelters()).toEqual([])
  })

  it('zero-device completion: lifecycle and incident state are no_devices', () => {
    const { state, sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    const statuses = feed(
      a.start(),
      a.next('event_context', contextPayload({
        devices_in_radius: 0, shelters: [], network: { congestion_level: 'UNKNOWN', qos_status: 'inactive' },
      })),
      a.next('event_complete', completePayload({
        status: 'no_devices', devices_in_radius: 0, devices_triaged: 0, devices_decided: 0,
      })),
    )
    expect(statuses).toEqual(['accepted', 'accepted', 'accepted'])
    expect(state.lifecycle.status).toBe('no_devices')
    expect(state.lifecycle.complete.devices_in_radius).toBe(0)
    expect(state.sync.serverActive).toBe(false)
    expect(sel.incidentState()).toBe('no_devices')
    expect(sel.deviceList()).toEqual([])
  })

  it('only a frame with fatal: true halts the pipeline — never the code alone', () => {
    const { state, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start(), a.next('error', errorPayload({ code: 'DB_ERROR', stage: 'context', message: 'shelter query failed' })))
    expect(state.pipeline.fatal).toBeNull()
    expect(state.errors).toHaveLength(1)

    feed(a.next('error', errorPayload({ code: 'INTERNAL_ERROR', stage: 'pipeline', fatal: true, message: 'deadline exceeded' })))
    expect(state.pipeline.fatal.code).toBe('INTERNAL_ERROR')
    feed(a.next('event_complete', completePayload({ status: 'failed', fatal_error: { code: 'INTERNAL_ERROR', message: 'deadline exceeded' } })))
    expect(state.lifecycle.status).toBe('failed')
  })

  it('dismissError and clearErrors remove errors from the list', () => {
    const { state, actions, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(a.start(), a.next('error', errorPayload()), a.next('error', errorPayload({ code: 'QOS_FAILED', stage: 'context' })))
    actions.dismissError(state.errors[0].id)
    expect(state.errors.map((e) => e.code)).toEqual(['QOS_FAILED'])
    actions.clearErrors()
    expect(state.errors).toEqual([])
  })
})

describe('selectors', () => {
  it('rescue flags count in every zone and the queue follows backend priority, then distance', () => {
    const { state, sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(
      a.start(),
      a.next('device_update', decidedPayload({ phone: PHONE_1, zone: 'orange', distance_km: 7, rescue_priority: 2 })),
      a.next('device_update', decidedPayload({ phone: PHONE_2, zone: 'green', distance_km: 12, rescue_priority: 1 })),
      a.next('device_update', decidedPayload({ phone: PHONE_3, zone: 'red', distance_km: 1, action: 'none', rescue_flag: false, rescue_status: 'not_requested', rescue_priority: 0 })),
      a.next('device_update', decidedPayload({ phone: '+212600000004', zone: 'orange', distance_km: 5, rescue_priority: 2 })),
    )

    expect(sel.rescueQueue().map((d) => d.phone)).toEqual([PHONE_2, '+212600000004', PHONE_1])
    expect(sel.counts().byZone.orange.rescue).toBe(2)
    expect(sel.counts().byZone.green.rescue).toBe(1)
    expect(sel.counts().byZone.red.rescue).toBe(0)
    expect(sel.counts().rescue).toBe(3)
    expect(sel.zoneGroups()).toEqual([
      { zone: 'red', total: 1, reachable: 0, rescue: 0 },
      { zone: 'orange', total: 2, reachable: 0, rescue: 2 },
      { zone: 'green', total: 1, reachable: 0, rescue: 1 },
    ])
    expect(state.devices[PHONE_2].zone).toBe('green')
  })

  it('counts decided, decision_failed and SMS failures per zone', () => {
    const { sel, feed, connect } = setup()
    connect()
    const a = eventStream(EVENT_A)
    feed(
      a.start(),
      a.next('device_update', devicePayload({ phone: PHONE_1, stage: 'decision_failed' })),
      a.next('device_update', decidedPayload({
        phone: PHONE_2, action: 'sms', rescue_flag: false, rescue_status: 'not_requested', rescue_priority: 0,
        sms_status: 'failed', reachable: true, reachability_status: 'CONNECTED_SMS',
      })),
    )
    const red = sel.counts().byZone.red
    expect(red).toMatchObject({ total: 2, decided: 1, decisionFailed: 1, smsFailed: 1, reachable: 1, unreachable: 1 })
  })

  it('distance is Go\'s distance_km; bands come from the event, the fallback only without one', () => {
    const { sel, feed, connect } = setup()
    connect()
    expect(sel.zoneBands()).toEqual({ red: 0.33, orange: 0.66, green: 1.0 })
    const a = eventStream(EVENT_A)
    feed(a.start(), a.next('event_context', contextPayload()), a.next('device_update', devicePayload({ phone: PHONE_1, distance_km: 2.5 })))
    const [d] = sel.devicesWithDistance()
    expect(d.distance_km).toBe(2.5)
    expect(d.distanceSource).toBe('supervisor')
    expect(sel.shelters()).toHaveLength(1)
    expect(sel.shelters()[0].capacity).toBe(5000)
  })

  it('incidentState walks disconnected → syncing → idle → opening → running → completed', () => {
    const { actions, sel, feed } = setup()
    expect(sel.incidentState()).toBe('disconnected')
    actions.setStatus('open')
    expect(sel.incidentState()).toBe('syncing')
    feed(snapshotBegin('', 0, 'idle'), snapshotEnd('', 0))
    expect(sel.incidentState()).toBe('idle')
    const a = eventStream(EVENT_A)
    feed(a.start())
    expect(sel.incidentState()).toBe('opening')
    feed(a.next('device_update', devicePayload()))
    expect(sel.incidentState()).toBe('running')
    feed(a.next('event_complete', completePayload()))
    expect(sel.incidentState()).toBe('completed')
    actions.setStatus('reconnecting')
    expect(sel.incidentState()).toBe('disconnected')
  })

  it('reset() returns to the neutral state but keeps the operator region', () => {
    const { state, actions, feed, connect } = setup()
    connect()
    actions.setRegion({ name: 'Operator', latitude: 1, longitude: 2 })
    const a = eventStream(EVENT_A)
    feed(a.start(), a.next('device_update', devicePayload()))
    actions.reset()
    expect(state.event).toBeNull()
    expect(state.devices).toEqual({})
    expect(state.counters.accepted).toBe(0)
    expect(state.sync.phase).toBe('none')
    expect(state.region).toEqual({ name: 'Operator', latitude: 1, longitude: 2 })
  })
})
