// Socket lifecycle and the real ingestion path: one connection, one timer, no
// bundled data source, and resyncs that are asked for and throttled.
//
// The WebSocket is faked so every transition is driven explicitly rather than
// waited for. Everything runs inside createRoot because createStream registers
// an onCleanup, and dispose() is what proves the teardown actually runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'

import { createConsoleStore } from './store'
import { MAX_QUEUE, RESYNC_MIN_INTERVAL_MS, createStream } from './socket'
import {
  EVENT_A,
  asReplay,
  decidedPayload,
  devicePayload,
  eventStream,
  heartbeat,
  snapshotBegin,
  snapshotEnd,
} from './v2frames.fixture'

class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static live = []

  constructor(url) {
    this.url = url
    this.readyState = FakeSocket.CONNECTING
    this.closedByClient = false
    FakeSocket.live.push(this)
  }

  // Server side of the conversation.
  accept() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  drop() {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.()
  }
  deliver(frame) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) })
  }

  close() {
    this.closedByClient = true
    this.readyState = FakeSocket.CLOSED
  }
}

/** Sockets that still have handlers attached — i.e. still able to act. */
const attached = () => FakeSocket.live.filter((s) => s.onclose || s.onopen || s.onmessage)
const latest = () => FakeSocket.live[FakeSocket.live.length - 1]

function harness(options = {}) {
  let api
  const { state, actions } = createConsoleStore()
  const dispose = createRoot((d) => {
    api = createStream(actions, { url: 'ws://localhost:8080/ws', ...options })
    return d
  })
  return { state, actions, stream: api, dispose }
}

/** Open the latest socket and finish an empty snapshot on it. */
function openIdle() {
  const s = latest()
  s.accept()
  s.deliver(snapshotBegin('', 0, 'idle'))
  s.deliver(snapshotEnd('', 0))
  return s
}

let warn
beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.live = []
  globalThis.WebSocket = FakeSocket
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  warn.mockRestore()
  delete globalThis.WebSocket
})

describe('one socket, one timer', () => {
  it('opens exactly one socket and reports the transport honestly', () => {
    const { state, dispose } = harness()

    expect(FakeSocket.live).toHaveLength(1)
    expect(state.connection.status).toBe('connecting')

    FakeSocket.live[0].accept()
    expect(state.connection.status).toBe('open')
    // Open is not receiving. Nothing has arrived yet.
    expect(state.connection.framesSinceOpen).toBe(0)

    dispose()
  })

  it('schedules one reconnect per drop, never two', () => {
    const { dispose } = harness()
    FakeSocket.live[0].accept()

    FakeSocket.live[0].drop()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    const timersAfterOneDrop = vi.getTimerCount()

    // A second onclose from the same dead socket must not add another timer.
    FakeSocket.live[0].drop()
    expect(vi.getTimerCount()).toBe(timersAfterOneDrop)

    vi.advanceTimersByTime(1_100)
    expect(FakeSocket.live).toHaveLength(2)   // exactly one replacement

    dispose()
  })

  it('does not open a second socket while one is already connecting', () => {
    const { stream, dispose } = harness()
    expect(FakeSocket.live).toHaveLength(1)

    // reconnect() tears the first down before making a new one, so the count
    // rises by exactly one and the old one is detached.
    stream.reconnect()
    expect(FakeSocket.live).toHaveLength(2)
    expect(FakeSocket.live[0].onclose).toBeNull()
    expect(attached()).toHaveLength(1)

    dispose()
  })

  it('a superseded socket cannot schedule work for its replacement', () => {
    const { stream, dispose } = harness()
    const first = FakeSocket.live[0]
    first.accept()

    stream.reconnect()
    vi.clearAllTimers()

    // The old socket dies late. It has been detached, so nothing happens.
    first.drop()
    expect(vi.getTimerCount()).toBe(0)
    expect(FakeSocket.live).toHaveLength(2)

    dispose()
  })

  it('backs off and reports lost after repeated failures', () => {
    const { state, dispose } = harness()
    for (let i = 0; i < 4; i++) {
      latest().drop()
      vi.advanceTimersByTime(20_000)
    }
    expect(state.connection.status).toBe('lost')
    dispose()
  })

  it('detaches and closes everything on cleanup', () => {
    const { dispose } = harness()
    const socket = FakeSocket.live[0]
    socket.accept()

    dispose()

    expect(socket.closedByClient).toBe(true)
    expect(socket.onclose).toBeNull()
    expect(socket.onmessage).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('no bundled data source', () => {
  it('exposes the supervisor controls and an explicit simulation source, nothing automatic', () => {
    const { stream, dispose } = harness()
    expect(Object.keys(stream).sort()).toEqual([
      'endpoint', 'lastError', 'reconnect', 'setUrl', 'source', 'startSimulation', 'stopSimulation',
    ])
    expect(stream.source()).toBe('supervisor')
    dispose()
  })

  it('nothing enters the store without a frame, however long nobody answers', () => {
    // An old caller passing the removed options gets no fallback either.
    const { state, dispose } = harness({ autoDemo: true, demoDelayMs: 10 })

    for (let i = 0; i < 10; i++) {
      latest().drop()
      vi.advanceTimersByTime(20_000)
    }

    expect(state.event).toBeNull()
    expect(state.devices).toEqual({})
    expect(state.context).toBeNull()
    expect(state.counters.received).toBe(0)
    expect(state.counters.accepted).toBe(0)
    expect(state.connection.status).toBe('lost')

    dispose()
  })
})

describe('frames through the socket', () => {
  it('routes a delivered frame into the store and counts it', () => {
    const { state, dispose } = harness()
    openIdle()
    latest().deliver(eventStream(EVENT_A).start())

    // Frames are buffered and flushed on the next frame/timer, whichever wins.
    vi.advanceTimersByTime(60)

    expect(state.event.disaster_type).toBe('earthquake')
    expect(state.activeEventId).toBe(EVENT_A)
    expect(state.connection.framesSinceOpen).toBe(3)
    expect(state.counters).toMatchObject({ received: 3, accepted: 1, control: 2, invalid: 0 })

    dispose()
  })

  it('counts a message that is not JSON as received and invalid, and warns without its content', () => {
    const { state, dispose } = harness()
    openIdle()
    latest().deliver('{"phone":"+212612345678",')
    latest().deliver(eventStream(EVENT_A).at(2, 'device_update', devicePayload({ phone: '+212612345678', latitude: 91 })))
    vi.advanceTimersByTime(60)

    expect(state.counters.received).toBe(4)
    expect(state.counters.invalid).toBe(2)
    expect(state.devices).toEqual({})
    expect(warn).toHaveBeenCalled()
    for (const call of warn.mock.calls) expect(call.join(' ')).not.toContain('612345678')

    dispose()
  })

  it('realistic volume: event_start and 30 000 device updates in one burst', () => {
    const { state, dispose } = harness()
    openIdle()
    const a = eventStream(EVENT_A)
    const s = latest()
    s.deliver(a.start())
    for (let i = 0; i < 30_000; i++) {
      const phone = `+2126${String(i).padStart(8, '0')}`
      s.deliver(a.next('device_update', devicePayload({ phone, distance_km: (i % 150) / 10 })))
    }
    vi.advanceTimersByTime(60)

    expect(state.activeEventId).toBe(EVENT_A)
    expect(state.event.radius_km).toBe(15)
    expect(Object.keys(state.devices)).toHaveLength(30_000)
    expect(state.counters).toMatchObject({ accepted: 30_001, duplicate: 0, gaps: 0, invalid: 0, droppedLocal: 0 })
    expect(state.sync.lastSeq).toBe(30_001)
    expect(state.sync.needsResync).toBeNull()
    expect(FakeSocket.live).toHaveLength(1)

    dispose()
  }, 30_000)

  it('drops the whole queue on overflow, counts it and resyncs', () => {
    const { state, dispose } = harness()
    const first = openIdle()
    vi.advanceTimersByTime(60)

    const beat = heartbeat('', 0, 'idle', false)
    for (let i = 0; i <= MAX_QUEUE; i++) first.deliver(beat)

    expect(state.counters.droppedLocal).toBe(MAX_QUEUE + 1)
    expect(state.counters.resyncs).toBe(1)
    expect(first.closedByClient).toBe(true)
    expect(FakeSocket.live).toHaveLength(2)
    expect(attached()).toHaveLength(1)

    // The new connection's snapshot is the recovery; it clears the request.
    openIdle()
    vi.advanceTimersByTime(60)
    expect(state.sync.needsResync).toBeNull()

    dispose()
  }, 30_000)

  it('a needed resync reconnects once, and at most once per 5 s', () => {
    const { state, dispose } = harness()
    openIdle()
    vi.advanceTimersByTime(60)

    // A frame for an event this console never saw start.
    latest().deliver(eventStream(EVENT_A).at(4, 'device_update', decidedPayload()))
    vi.advanceTimersByTime(60)
    expect(FakeSocket.live).toHaveLength(2)
    expect(state.counters.resyncs).toBe(1)
    expect(state.counters.foreign).toBe(1)

    // The new socket opens, and something asks for a resync again at once.
    latest().accept()
    latest().deliver(eventStream(EVENT_A).at(5, 'device_update', decidedPayload()))
    vi.advanceTimersByTime(60)
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS - 1_000)
    expect(FakeSocket.live).toHaveLength(2)
    expect(state.counters.resyncs).toBe(1)

    // Once the window is over, the request that waited is honoured.
    vi.advanceTimersByTime(1_000)
    expect(FakeSocket.live).toHaveLength(3)
    expect(state.counters.resyncs).toBe(2)

    dispose()
  })

  it('recovers the incident through the reconnect snapshot, selection intact', () => {
    const { state, actions, dispose } = harness()
    const a = eventStream(EVENT_A)
    const start = a.start()
    const device = a.next('device_update', decidedPayload())
    latest().accept()
    latest().deliver(snapshotBegin(EVENT_A, 2))
    latest().deliver(asReplay(start))
    latest().deliver(asReplay(device))
    latest().deliver(snapshotEnd(EVENT_A, 2, 2))
    vi.advanceTimersByTime(60)
    actions.selectDevice(device.payload.phone)

    latest().drop()
    expect(state.connection.status).toBe('reconnecting')
    // The last received state stays on screen while retrying.
    expect(state.devices[device.payload.phone]).toBeDefined()

    vi.advanceTimersByTime(1_100)
    latest().accept()
    latest().deliver(snapshotBegin(EVENT_A, 2))
    latest().deliver(asReplay(start))
    latest().deliver(asReplay(device))
    latest().deliver(snapshotEnd(EVENT_A, 2, 2))
    vi.advanceTimersByTime(60)

    expect(state.sync.phase).toBe('live')
    expect(state.sync.lastSeq).toBe(2)
    expect(state.selectedPhone).toBe(device.payload.phone)
    expect(Object.keys(state.devices)).toHaveLength(1)

    dispose()
  })

  it('setUrl clears the board and connects to the new supervisor', () => {
    const { state, stream, dispose } = harness()
    openIdle()
    latest().deliver(eventStream(EVENT_A).start())
    vi.advanceTimersByTime(60)
    expect(state.event).not.toBeNull()

    expect(stream.setUrl('ws://staging.example:8080/ws')).toBe(true)
    expect(state.event).toBeNull()
    expect(stream.endpoint()).toBe('ws://staging.example:8080/ws')
    expect(latest().url).toBe('ws://staging.example:8080/ws')
    expect(attached()).toHaveLength(1)
    expect(stream.setUrl('ws://staging.example:8080/ws')).toBe(false)

    dispose()
  })
})

describe('the simulation source', () => {
  const SENSOR = {
    event_id: 'SIM-SOCKET-1',
    disaster_type: 'earthquake',
    timestamp: 1_789_000_000_000,
    severity: 6.5,
    epicenter: { latitude: 40.7128, longitude: -74.006 },
    radius_km: 10,
    depth_km: 10,
    aftershock_risk: 'LOW',
    tsunami_risk: false,
  }

  it('closes the socket, clears the board and plays the frames through the store', async () => {
    const { buildSimulation } = await import('./simulation')
    const { state, stream, dispose } = harness()
    const socket = openIdle()
    socket.deliver(eventStream(EVENT_A).start())
    vi.advanceTimersByTime(60)
    expect(state.activeEventId).toBe(EVENT_A)

    const sim = buildSimulation(SENSOR, { now: Date.now() })
    expect(stream.startSimulation(sim.frames)).toBe(true)
    expect(stream.source()).toBe('simulation')
    expect(state.connection.status).toBe('simulation')
    expect(socket.closedByClient).toBe(true)
    expect(attached()).toHaveLength(0)
    // The supervisor's incident is gone the moment the simulation starts.
    expect(state.activeEventId).toBeNull()

    vi.advanceTimersByTime(sim.frames.at(-1).at + 100)
    expect(state.activeEventId).toBe('SIM-SOCKET-1')
    expect(Object.keys(state.devices)).toHaveLength(sim.devices.length)
    expect(state.lifecycle.status).toBe('completed')
    expect(state.counters.invalid).toBe(0)

    dispose()
  })

  it('opens no socket while simulating, whatever happens', async () => {
    const { buildSimulation } = await import('./simulation')
    const { actions, stream, dispose } = harness()
    openIdle()
    stream.startSimulation(buildSimulation(SENSOR, { now: Date.now() }).frames)
    const sockets = FakeSocket.live.length

    // A new endpoint is remembered, not dialled.
    expect(stream.setUrl('ws://staging.example:8080/ws')).toBe(true)
    // A resync request has no supervisor to go to.
    actions.requestResync('test')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.live).toHaveLength(sockets)
    expect(stream.endpoint()).toBe('ws://staging.example:8080/ws')

    dispose()
  })

  it('stopping clears the simulated board and reconnects to the supervisor', async () => {
    const { buildSimulation } = await import('./simulation')
    const { state, stream, dispose } = harness()
    openIdle()
    const sim = buildSimulation(SENSOR, { now: Date.now() })
    stream.startSimulation(sim.frames)
    vi.advanceTimersByTime(1_000)
    const sockets = FakeSocket.live.length

    expect(stream.stopSimulation()).toBe(true)
    expect(stream.source()).toBe('supervisor')
    expect(state.activeEventId).toBeNull()
    expect(state.devices).toEqual({})
    expect(FakeSocket.live).toHaveLength(sockets + 1)
    expect(attached()).toHaveLength(1)

    // The rest of the simulation's timers are gone with it.
    vi.advanceTimersByTime(sim.frames.at(-1).at + 1_000)
    expect(state.devices).toEqual({})
    expect(stream.stopSimulation()).toBe(false)

    dispose()
  })

  it('reconnect() during a simulation means leaving it', async () => {
    const { buildSimulation } = await import('./simulation')
    const { stream, dispose } = harness()
    openIdle()
    stream.startSimulation(buildSimulation(SENSOR, { now: Date.now() }).frames)
    stream.reconnect()
    expect(stream.source()).toBe('supervisor')
    expect(attached()).toHaveLength(1)
    dispose()
  })

  it('cleanup cancels a simulation in progress', async () => {
    const { buildSimulation } = await import('./simulation')
    const { stream, dispose } = harness()
    stream.startSimulation(buildSimulation(SENSOR, { now: Date.now() }).frames)
    dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
