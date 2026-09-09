// Socket lifecycle: one connection, one timer, and a demo that stays chosen.
//
// The WebSocket is faked so every transition is driven explicitly rather than
// waited for. Everything runs inside createRoot because createStream registers
// an onCleanup, and dispose() is what proves the teardown actually runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'

import { createConsoleStore } from './store'
import { createStream } from './socket'

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
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  close() {
    this.closedByClient = true
    this.readyState = FakeSocket.CLOSED
  }
}

/** Sockets that still have handlers attached — i.e. still able to act. */
const attached = () => FakeSocket.live.filter((s) => s.onclose || s.onopen || s.onmessage)

function harness(options = {}) {
  let api
  const { state, actions } = createConsoleStore()
  const dispose = createRoot((d) => {
    api = createStream(actions, { url: 'ws://localhost:8080/ws', autoDemo: false, ...options })
    return d
  })
  return { state, actions, stream: api, dispose }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.live = []
  globalThis.WebSocket = FakeSocket
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.WebSocket
})

describe('one socket, one timer', () => {
  it('opens exactly one socket and reports the transport honestly', () => {
    const { state, stream, dispose } = harness()

    expect(FakeSocket.live).toHaveLength(1)
    expect(state.connection.status).toBe('connecting')

    FakeSocket.live[0].accept()
    expect(state.connection.status).toBe('open')
    expect(state.connection.source).toBe('supervisor')
    // Open is not receiving. Nothing has arrived yet.
    expect(state.connection.framesSinceOpen).toBe(0)

    dispose()
    expect(stream).toBeDefined()
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

describe('manual demo stays chosen', () => {
  it('closes the socket, schedules no reconnect, and does not drift back', () => {
    const { state, stream, dispose } = harness()
    const socket = FakeSocket.live[0]
    socket.accept()

    stream.useDemo()

    expect(stream.isManualDemo()).toBe(true)
    expect(state.connection.source).toBe('demo')
    expect(state.connection.manualDemo).toBe(true)
    expect(socket.closedByClient).toBe(true)
    expect(socket.onclose).toBeNull()      // cannot schedule a reconnect

    // The old failure: a backoff timer fired and dragged the console back to
    // the supervisor a few seconds after the operator chose the demo.
    const socketsBefore = FakeSocket.live.length
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.live).toHaveLength(socketsBefore)
    expect(stream.source()).toBe('demo')

    dispose()
  })

  it('refuses an explicit reconnect while the demo is chosen', () => {
    const { stream, dispose } = harness()
    stream.useDemo()
    const before = FakeSocket.live.length

    expect(stream.reconnect()).toBe(false)
    expect(FakeSocket.live).toHaveLength(before)

    dispose()
  })

  it('leaves the demo only when the supervisor is chosen', () => {
    const { state, stream, dispose } = harness()
    stream.useDemo()
    const before = FakeSocket.live.length

    stream.useSupervisor()

    expect(stream.isManualDemo()).toBe(false)
    expect(state.connection.manualDemo).toBe(false)
    expect(state.connection.source).toBe('supervisor')
    expect(FakeSocket.live).toHaveLength(before + 1)
    expect(attached()).toHaveLength(1)

    dispose()
  })

  it('a retrying socket does not repaint a demo that is delivering frames', async () => {
    const { state, dispose } = harness({ autoDemo: true, demoDelayMs: 200 })

    // Nobody answers. The console falls back and the demo starts producing.
    await vi.advanceTimersByTimeAsync(400)
    expect(state.connection.source).toBe('demo')
    expect(state.connection.status).toBe('open')

    // The supervisor socket goes on failing underneath. That is the
    // supervisor's problem, not the demo's, and must not reach the chip —
    // this read "Demo stopped" over a demo at 185 frames/second.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state.connection.status).toBe('open')
    expect(state.connection.source).toBe('demo')

    dispose()
  })

  it('the automatic fallback keeps retrying; the manual one does not', () => {
    const { stream, dispose } = harness({ autoDemo: true, demoDelayMs: 500 })

    // Nobody answers, so the console falls back on its own.
    vi.advanceTimersByTime(600)
    expect(stream.source()).toBe('demo')
    // ...but it never CHOSE the demo, so the socket is still its business.
    expect(stream.isManualDemo()).toBe(false)

    dispose()
  })
})

describe('frames', () => {
  it('routes a delivered frame into the store and counts it', async () => {
    const { state, dispose } = harness()
    FakeSocket.live[0].accept()

    FakeSocket.live[0].deliver({
      type: 'event_start',
      event_id: 'TEST-1',
      timestamp: 0,
      payload: {
        disaster_type: 'earthquake',
        severity: 6.1,
        epicenter: { latitude: 31, longitude: -8 },
        radius_km: 20,
        tsunami_risk: false,
        aftershock_risk: 'LOW',
      },
    })

    // Frames are buffered and flushed on the next frame/timer, whichever wins.
    await vi.advanceTimersByTimeAsync(60)

    expect(state.event.disaster_type).toBe('earthquake')
    expect(state.activeEventId).toBe('TEST-1')
    expect(state.connection.framesSinceOpen).toBe(1)

    dispose()
  })
})
