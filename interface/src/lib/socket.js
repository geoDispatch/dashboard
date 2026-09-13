import { createSignal, onCleanup, batch } from 'solid-js'
import { WS_URL, SENSOR_URL, HEALTH_URL, CAPABILITIES_URL } from '../constants/zones'
import { routeMessage } from './router'
import { validateSensorInput } from './launch'

// One socket for the whole console. Frames reach the store from the configured
// supervisor — or, only when the operator starts one, from a browser
// SIMULATION (lib/simulation.js). There is no automatic fallback of any kind:
// an unreachable supervisor is shown as unreachable.
//
// A simulation is a second SOURCE, never mixed with the first. Starting one
// closes the socket and clears the board; its frames then take the same path
// a supervisor frame does (queue → validate → store). Stopping it clears the
// board again and reconnects, and the supervisor's snapshot puts back exactly
// what it holds. `source()` says which one the board is showing.
//
// Frames are buffered and flushed once per animation frame inside a batch(),
// because the supervisor can publish tens of thousands of device updates in a
// burst and applying them one at a time thrashes the store.
//
// ── Invariants ────────────────────────────────────────────────────────────
//
//   ONE SOCKET.      connect() refuses to run while a socket is already
//                    connecting or open.
//   ONE TIMER.       every reconnect is scheduled through scheduleReconnect(),
//                    which clears the previous one first.
//   NO GHOST CLOSES. every teardown detaches onopen/onmessage/onclose/onerror
//                    before close(), so a socket on its way out can never
//                    schedule work for the one replacing it.
//   NOTHING SILENTLY LOST. A full local queue is dropped whole, counted, and
//                    followed by a resync; the new connection's snapshot puts
//                    back exactly what the supervisor holds.
//   ONE RESYNC PER 5 s. A resync is a reconnect. When the store asks for one
//                    faster than that, the request waits out the window.

export const MAX_QUEUE = 50_000
export const RESYNC_MIN_INTERVAL_MS = 5_000

export function createStream(actions, { url = WS_URL, now = () => Date.now() } = {}) {
  const [lastError, setLastError] = createSignal(null)

  // The endpoint is a setting, not a constant: an operator can point this
  // console at a staging supervisor from the settings screen. Exposed as a
  // signal so anything showing "where are these frames from" stays truthful
  // when it changes.
  const [endpoint, setEndpoint] = createSignal(url)

  // 'supervisor' | 'simulation'. While simulating there is no socket at all,
  // and nothing (a drop, a resync, a new endpoint) opens one until stopped.
  const [source, setSource] = createSignal('supervisor')
  let simulating = false
  let simTimers = []

  let ws = null
  let reconnectTimer = null
  let resyncTimer = null
  let rafHandle = null
  let fallbackTimer = null
  let flushScheduled = false
  let attempts = 0
  let everOpened = false
  let closed = false
  let lastResyncAt = -Infinity

  // Raw messages seen but not yet added to counters.received. Counted in one
  // store write per flush rather than one per message, so a burst of 30 000
  // frames does not re-run every observer of the counter 30 000 times.
  let unnoted = 0

  const queue = []
  const fpsWindow = []

  // ── frame plumbing ──────────────────────────────────────────
  //
  // Draining is scheduled on an animation frame so a burst lands in one batch,
  // BUT requestAnimationFrame does not fire while the tab is hidden. A console
  // on a second monitor or a backgrounded wall display would then queue frames
  // forever and appear frozen. So a timer runs alongside it and whichever
  // fires first drains the queue.
  function noteUnnoted() {
    if (!unnoted) return
    actions.noteReceived(unnoted)
    unnoted = 0
  }

  function enqueue(frame) {
    queue.push(frame)
    if (queue.length > MAX_QUEUE) {
      const dropped = queue.length
      queue.length = 0
      noteUnnoted()
      actions.noteDroppedLocal(dropped)
      actions.requestResync('local queue overflow')
      console.warn(`[stream] local queue overflow: ${dropped} frames dropped, resyncing`)
      maybeResync()
      return
    }
    scheduleFlush()
  }

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    rafHandle = requestAnimationFrame(runFlush)
    fallbackTimer = setTimeout(runFlush, 50)
  }

  function runFlush() {
    if (!flushScheduled) return
    flushScheduled = false
    if (rafHandle != null) cancelAnimationFrame(rafHandle)
    if (fallbackTimer != null) clearTimeout(fallbackTimer)
    rafHandle = null
    fallbackTimer = null
    flush()
  }

  function flush() {
    noteUnnoted()
    if (queue.length) {
      const frames = queue.splice(0, queue.length)
      let counted = 0
      let invalid = 0
      let lastReason = null
      batch(() => {
        for (const frame of frames) {
          const { status, reason } = routeMessage(actions, frame)
          if (status === 'accepted' || status === 'control') counted += 1
          else if (status === 'invalid') { invalid += 1; lastReason = reason }
        }
      })
      // Type + reason only. Never the frame: it can carry a phone number.
      if (invalid) console.warn(`[stream] ${invalid} invalid frame(s) dropped; last: ${lastReason}`)
      const t = now()
      for (let i = 0; i < counted; i++) fpsWindow.push(t)
    }
    maybeResync()
  }

  // Rolling frames/second, and the clock the staleness check reads.
  //
  // The tick is what makes "stalled" a state the UI can actually reach: with
  // no frames arriving there is nothing else to re-run the derivation.
  const fpsTimer = setInterval(() => {
    const t = now()
    const cutoff = t - 1000
    while (fpsWindow.length && fpsWindow[0] < cutoff) fpsWindow.shift()
    actions.setFps(fpsWindow.length)
    actions.tick(t)
  }, 500)

  // ── resync ──────────────────────────────────────────────────
  //
  // The store raises sync.needsResync when its copy cannot be trusted — a seq
  // gap, a frame for an event it never saw start, a heartbeat that is ahead.
  // The cure is always the same: a fresh connection, whose snapshot restores
  // the supervisor's exact state.
  function maybeResync() {
    // A simulation has no supervisor to resync from.
    if (closed || simulating) return
    const reason = actions.pendingResync()
    if (!reason) return
    // Not connected: the reconnect already on its way brings a snapshot, and
    // snapshot_begin clears the request.
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const wait = lastResyncAt + RESYNC_MIN_INTERVAL_MS - now()
    if (wait > 0) {
      if (!resyncTimer) {
        resyncTimer = setTimeout(() => {
          resyncTimer = null
          maybeResync()
        }, wait)
      }
      return
    }

    lastResyncAt = now()
    actions.clearResync()
    actions.noteResync()
    console.warn(`[stream] resyncing: ${reason}`)
    closeSocket()
    attempts = 0
    connect()
  }

  // ── teardown ────────────────────────────────────────────────
  //
  // Detach BEFORE closing. A socket whose onclose still fires after we have
  // moved on will schedule a reconnect for a connection nobody asked for.
  function closeSocket() {
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      try { ws.close() } catch { /* already closing or never opened */ }
      ws = null
    }
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  // ── supervisor socket ───────────────────────────────────────
  function connect() {
    if (closed || simulating) return

    // One socket. Anything already connecting or open is the one socket.
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    clearTimeout(reconnectTimer)
    reconnectTimer = null
    if (!everOpened && attempts === 0) actions.setStatus('connecting')
    else if (attempts <= 3) actions.setStatus('reconnecting')
    // Past three attempts the status stays 'lost' between tries too, rather
    // than flickering back to 'reconnecting' for each one.

    let socket
    try {
      socket = new WebSocket(endpoint())
    } catch (err) {
      setLastError(String(err?.message ?? err))
      scheduleReconnect()
      return
    }
    ws = socket

    // Every handler checks it is still THE socket. A handler that fires after
    // its socket has been replaced must do nothing at all.
    const isCurrent = () => ws === socket && !closed

    socket.onopen = () => {
      if (!isCurrent()) return
      attempts = 0
      everOpened = true
      setLastError(null)
      actions.setStatus('open')
    }

    socket.onmessage = (e) => {
      if (!isCurrent()) return
      unnoted += 1
      let frame
      try {
        frame = JSON.parse(e.data)
      } catch {
        noteUnnoted()
        actions.noteInvalid('invalid JSON')
        console.warn('[stream] invalid frame dropped: invalid JSON')
        return
      }
      enqueue(frame)
    }

    socket.onclose = () => {
      if (!isCurrent()) return
      ws = null
      actions.setStatus('reconnecting')
      scheduleReconnect()
    }

    socket.onerror = () => {
      if (!isCurrent()) return
      setLastError(`cannot reach supervisor at ${endpoint()}`)
    }
  }

  function scheduleReconnect() {
    if (closed || simulating) return

    // One timer. Clearing first makes a double-schedule impossible rather
    // than merely unlikely.
    clearTimeout(reconnectTimer)
    attempts += 1
    // 1s, 2s, 4s … capped at 15s.
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempts - 1, 4))
    if (attempts > 3) actions.setStatus('lost')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  // ── simulation source ───────────────────────────────────────
  function clearSimulation() {
    for (const timer of simTimers) clearTimeout(timer)
    simTimers = []
  }

  function enqueueSimulated(frame) {
    unnoted += 1
    enqueue(frame)
  }

  // The empty snapshot a fresh connection to an idle supervisor would begin
  // with, so the store is in step before the simulated event starts.
  function controlFrame(type, payload) {
    return { v: 2, type, event_id: '', seq: 0, timestamp: now(), replay: false, payload }
  }

  // Leave the simulation: clear its board and reconnect to the supervisor,
  // whose snapshot then shows whatever it holds.
  function stopSimulation() {
    if (!simulating) return false
    clearSimulation()
    simulating = false
    setSource('supervisor')
    queue.length = 0
    unnoted = 0
    actions.reset()
    attempts = 0
    everOpened = false
    connect()
    return true
  }

  connect()

  onCleanup(() => {
    closed = true
    clearSimulation()
    clearInterval(fpsTimer)
    if (rafHandle != null) cancelAnimationFrame(rafHandle)
    if (fallbackTimer != null) clearTimeout(fallbackTimer)
    clearTimeout(resyncTimer)
    rafHandle = null
    fallbackTimer = null
    resyncTimer = null
    flushScheduled = false
    queue.length = 0
    closeSocket()
  })

  return {
    lastError,
    endpoint,
    source,

    /**
     * Play a simulated incident: timed frames from lib/simulation.js.
     *
     * The socket is closed and stays closed, the board is cleared, and each
     * frame is fed at its `at` offset through the ordinary ingestion path.
     * Starting another replaces this one.
     *
     * @param frames  [{ at, frame }]
     */
    startSimulation(frames) {
      if (closed || !Array.isArray(frames)) return false
      clearSimulation()
      closeSocket()
      clearTimeout(resyncTimer)
      resyncTimer = null
      queue.length = 0
      unnoted = 0

      simulating = true
      setSource('simulation')
      setLastError(null)
      actions.reset()
      actions.setStatus('simulation')

      enqueueSimulated(controlFrame('snapshot_begin', { head_seq: 0, active: false, lifecycle: 'idle' }))
      enqueueSimulated(controlFrame('snapshot_end', { head_seq: 0, replayed: 0 }))
      for (const { at, frame } of frames) {
        simTimers.push(setTimeout(() => enqueueSimulated(frame), Math.max(0, at || 0)))
      }
      return true
    },

    stopSimulation,

    /**
     * Point the console at a different supervisor.
     *
     * The board is cleared first: carrying the previous supervisor's incident
     * over would attribute it to this one. The new connection's snapshot then
     * shows whatever the new supervisor holds. During a simulation the address
     * is only remembered; stopping the simulation connects to it.
     */
    setUrl(next) {
      if (typeof next !== 'string' || next === endpoint()) return false
      if (simulating) {
        setEndpoint(next)
        return true
      }

      closeSocket()
      clearTimeout(resyncTimer)
      resyncTimer = null
      queue.length = 0
      unnoted = 0
      lastResyncAt = -Infinity

      setEndpoint(next)
      actions.reset()
      setLastError(null)
      attempts = 0
      everOpened = false
      connect()
      return true
    },

    /**
     * Reconnect now, without waiting out the backoff.
     *
     * Does not clear the board: the new connection's snapshot replaces it with
     * exactly what the supervisor holds, and until then the last received
     * state is better than an empty one. During a simulation, reconnecting
     * means leaving it.
     */
    reconnect() {
      if (simulating) return stopSimulation()
      closeSocket()
      attempts = 0
      connect()
      return true
    },
  }
}

// ── supervisor REST ───────────────────────────────────────────

/**
 * Why a launch did not start an incident.
 *
 *   kind    'busy'        409 pipeline_busy — another incident is running (body.active_event_id)
 *           'conflict'    409 event_id_conflict — the id was already used
 *           'invalid'     422 validation_failed, or refused here before sending
 *           'rejected'    400 / 403 / 405 / 413 / 415 / other refusals and unexpected answers
 *           'unreachable' the request never got an answer (network error, timeout)
 *           'gateway'     502 / 503 / 504
 *   status  HTTP status, or null when there was no answer
 *   body    parsed JSON reply, or null
 *   fields  { '<json path>': reason } for 'invalid'; {} otherwise
 */
export class LaunchError extends Error {
  constructor(kind, message, { status = null, body = null, fields = {} } = {}) {
    super(message)
    this.name = 'LaunchError'
    this.kind = kind
    this.status = status
    this.body = body
    this.fields = fields
  }
}

async function readBody(res) {
  try {
    if (typeof res.text === 'function') {
      const text = await res.text()
      return text ? JSON.parse(text) : null
    }
    if (typeof res.json === 'function') return await res.json()
  } catch {
    /* not JSON — the status alone has to speak */
  }
  return null
}

async function request(url, init, { timeout, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl && timeout ? setTimeout(() => ctrl.abort(), timeout) : null
  try {
    const res = await doFetch(url, { ...init, ...(ctrl ? { signal: ctrl.signal } : {}) })
    const body = await readBody(res)
    return { res, body }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * POST /sensor — the only way to start an incident, and the only request this
 * console ever sends that changes anything.
 *
 * No defaults, at all. The payload must be a complete SensorInput that passes
 * validateSensorInput; anything else is refused here and fetch is never
 * called. 202 means ACCEPTED — the pipeline has started, not finished.
 *
 * @returns { outcome: 'accepted' | 'duplicate', status, body }
 * @throws  LaunchError
 */
export async function triggerEvent(payload, {
  url = SENSOR_URL,
  fetchImpl,
  capabilities,
  timeout = 15_000,
} = {}) {
  const checked = validateSensorInput(payload, capabilities)
  if (!checked.ok) {
    throw new LaunchError('invalid', 'The incident is incomplete or invalid. Nothing was sent.', {
      fields: checked.errors,
    })
  }

  let res, body
  try {
    ({ res, body } = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, { timeout, fetchImpl }))
  } catch (err) {
    const timedOut = err?.name === 'AbortError'
    throw new LaunchError('unreachable', timedOut
      ? `The supervisor at ${url} did not answer within ${Math.round(timeout / 1000)} s.`
      : `Could not reach the supervisor at ${url}.`)
  }

  const status = res.status
  const meta = { status, body }

  if (status === 202) return { outcome: 'accepted', status, body }
  if (status === 200 && body?.status === 'duplicate') return { outcome: 'duplicate', status, body }

  if (status === 409) {
    if (body?.error === 'pipeline_busy') {
      const id = typeof body.active_event_id === 'string' ? body.active_event_id : 'another incident'
      throw new LaunchError('busy', `Supervisor is busy with incident ${id}.`, meta)
    }
    throw new LaunchError('conflict', `Event id conflict: ${body?.detail || 'the event_id was already used with a different payload'}.`, meta)
  }
  if (status === 422) {
    const fields = body?.fields && typeof body.fields === 'object' ? body.fields : {}
    throw new LaunchError('invalid', 'The supervisor rejected some fields (422).', { ...meta, fields })
  }
  if (status === 502 || status === 503 || status === 504) {
    throw new LaunchError('gateway', body?.error === 'database_unavailable'
      ? `The supervisor's database is unavailable (${status}).`
      : `The supervisor or a gateway in front of it is unavailable (${status}).`, meta)
  }
  const code = typeof body?.error === 'string' ? ` ${body.error}` : ''
  throw new LaunchError('rejected', status >= 200 && status < 300
    ? `Unexpected answer from the supervisor (${status}). The incident may not have started.`
    : `The supervisor refused the request (${status}${code}).`, meta)
}

/**
 * GET /health — readiness, for the settings screen's Ping button.
 *
 * The URL is a parameter because the endpoint is a setting: pinging the
 * compiled-in default while the console listens to a staging supervisor would
 * answer a question nobody asked.
 *
 * @returns { ok, status, body }  status null and body null when unreachable
 */
export async function checkHealth({ url = HEALTH_URL, timeout = 3000, fetchImpl } = {}) {
  try {
    const { res, body } = await request(url, { method: 'GET' }, { timeout, fetchImpl })
    return { ok: !!res.ok, status: res.status, body }
  } catch {
    return { ok: false, status: null, body: null }
  }
}

/**
 * GET /capabilities — which disaster types this supervisor runs, and its limits.
 * @returns the parsed object, or null when it cannot be read
 */
export async function fetchCapabilities({ url = CAPABILITIES_URL, timeout = 3000, fetchImpl } = {}) {
  try {
    const { res, body } = await request(url, { method: 'GET' }, { timeout, fetchImpl })
    if (!res.ok || !body || typeof body !== 'object' || Array.isArray(body)) return null
    return body
  } catch {
    return null
  }
}
