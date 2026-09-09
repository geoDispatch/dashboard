import { createSignal, onCleanup, batch } from 'solid-js'
import { WS_URL, SENSOR_URL, HEALTH_URL } from '../constants/zones'
import { routeMessage } from './router'
import { startMockStream, AL_HAOUZ_EVENT, EVENT_ID } from './mockStream'
import { depthFor } from './launch'

// One socket for the whole console.
//
// Frames are buffered and flushed once per animation frame inside a batch().
// The supervisor drops frames when its outbound channel fills (agent.md §6.6),
// so bursts are expected and applying them one at a time thrashes the store.
//
// If the supervisor is not reachable the stream falls back to the built-in
// Al Haouz demo so the console is never a blank screen. The source is exposed
// so the UI can say which one it is showing — a demo that pretends to be a
// supervisor is the one thing worse than no demo.
//
// ── Lifecycle invariants, each of which was broken ────────────────────────
//
//   ONE SOCKET.      connect() refuses to run while a socket is already
//                    connecting or open. useLive() used to call it straight
//                    into a live socket, leaving two.
//   ONE TIMER.       every reconnect is scheduled through scheduleReconnect(),
//                    which clears the previous one first.
//   MANUAL DEMO IS   choosing the demo sets manualDemo and tears the socket
//   STICKY.          down with its handlers detached, so no onclose fires, no
//                    reconnect is scheduled, and nothing drags the console
//                    back to a supervisor the operator deliberately left.
//                    Previously the demo survived about one backoff interval.
//   NO GHOST CLOSES. every teardown detaches onopen/onmessage/onclose/onerror
//                    before close(), so a socket that is on its way out can
//                    never schedule work for the one replacing it.

export function createStream(actions, {
  url = WS_URL,
  autoDemo = true,
  demoDelayMs = 2500,
} = {}) {
  const [source, setSource] = createSignal('supervisor')   // supervisor | demo
  const [lastError, setLastError] = createSignal(null)

  // Set when the OPERATOR picks the demo, cleared only when they pick the
  // supervisor again. The automatic fallback never sets it — an unreachable
  // supervisor should still be retried in the background.
  let manualDemo = false

  // The endpoint is a setting, not a constant: an operator can point this
  // console at a staging supervisor from the settings screen. Exposed as a
  // signal so anything showing "where are these frames from" stays truthful
  // when it changes.
  const [endpoint, setEndpoint] = createSignal(url)

  let ws = null
  let stopMock = null
  let reconnectTimer = null
  let demoTimer = null
  let rafHandle = null
  let fallbackTimer = null
  let flushScheduled = false
  let attempts = 0
  let closed = false

  const queue = []
  const fpsWindow = []

  // Frames are dropped rather than queued without bound. The supervisor already
  // drops when its own outbound channel fills, so an unbounded client queue buys
  // nothing except memory.
  const MAX_QUEUE = 20_000

  // ── frame plumbing ──────────────────────────────────────────
  //
  // Draining is scheduled on an animation frame so a burst lands in one batch,
  // BUT requestAnimationFrame does not fire while the tab is hidden. A console
  // on a second monitor, minimised, or on a wall display the OS has backgrounded
  // would then queue frames forever and appear frozen at 0/s — and dump the
  // whole backlog the moment it regained focus. So a timer runs alongside it and
  // whichever fires first drains the queue.
  function enqueue(frames) {
    for (const f of frames) queue.push(f)
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
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
    if (!queue.length) return
    const frames = queue.splice(0, queue.length)
    batch(() => {
      for (const frame of frames) {
        const result = routeMessage(actions, frame)
        if (!result.ok) console.warn('[stream]', result.reason, frame)
        actions.countFrame()
      }
    })
    const now = Date.now()
    for (let i = 0; i < frames.length; i++) fpsWindow.push(now)
  }

  // Rolling frames/second, and the clock the staleness check reads.
  //
  // The tick is what makes "stalled" a state the UI can actually reach: with
  // no frames arriving there is nothing else to re-run the derivation, so a
  // frozen board would sit under a "Receiving" chip forever.
  const fpsTimer = setInterval(() => {
    const now = Date.now()
    const cutoff = now - 1000
    while (fpsWindow.length && fpsWindow[0] < cutoff) fpsWindow.shift()
    actions.setFps(fpsWindow.length)
    actions.tick(now)
  }, 500)

  // ── teardown ────────────────────────────────────────────────
  //
  // Detach BEFORE closing. A socket whose onclose still fires after we have
  // moved on will schedule a reconnect for a connection nobody asked for, and
  // that reconnect races the one we are about to make.
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

  function cancelDemoFallback() {
    clearTimeout(demoTimer)
    demoTimer = null
  }

  // ── supervisor socket ───────────────────────────────────────
  function connect() {
    if (closed || manualDemo) return

    // One socket. Anything already connecting or open is the one socket.
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    clearTimeout(reconnectTimer)
    reconnectTimer = null
    // Same rule: a retry underneath a running demo does not repaint the chip.
    if (source() === 'supervisor') {
      actions.setStatus(attempts === 0 ? 'connecting' : 'reconnecting', 'supervisor')
    }

    let socket
    try {
      socket = new WebSocket(endpoint())
    } catch (err) {
      setLastError(String(err))
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
      setLastError(null)
      cancelDemoFallback()
      stopDemo()
      setSource('supervisor')
      actions.setStatus('open', 'supervisor')
    }

    socket.onmessage = (e) => {
      if (!isCurrent()) return
      try {
        enqueue([JSON.parse(e.data)])
      } catch {
        console.warn('[stream] non-JSON frame discarded')
      }
    }

    socket.onclose = () => {
      if (!isCurrent()) return
      ws = null
      if (manualDemo) return

      // While the DEMO is the source, this socket's retry state is not what
      // the console is showing. Writing 'reconnecting' or 'lost' here put the
      // supervisor's problem on the demo's chip — it read "Demo stopped"
      // while the demo was delivering 185 frames a second. The socket keeps
      // retrying underneath; it just stops narrating.
      if (source() === 'supervisor') actions.setStatus('reconnecting', 'supervisor')
      scheduleReconnect()
    }

    socket.onerror = () => {
      if (!isCurrent()) return
      setLastError(`cannot reach supervisor at ${endpoint()}`)
    }

    // If the supervisor never answers, fall back to the demo rather than
    // leaving the operator looking at an empty console. This is the AUTOMATIC
    // fallback: it does not set manualDemo, so the socket keeps retrying
    // underneath and the console returns to the supervisor the moment one
    // appears.
    if (autoDemo && !demoTimer && !manualDemo && source() === 'supervisor') {
      demoTimer = setTimeout(() => {
        demoTimer = null
        if (!closed && !manualDemo && (!ws || ws.readyState !== WebSocket.OPEN)) startDemo()
      }, demoDelayMs)
    }
  }

  function scheduleReconnect() {
    if (closed || manualDemo) return

    // One timer. Clearing first makes a double-schedule impossible rather
    // than merely unlikely.
    clearTimeout(reconnectTimer)
    attempts += 1
    // 1s, 2s, 4s … capped at 15s. The old hook retried a flat 3s forever.
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempts - 1, 4))
    if (attempts > 3 && source() === 'supervisor') actions.setStatus('lost', 'supervisor')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  // ── demo stream ─────────────────────────────────────────────
  function startDemo() {
    if (stopMock) return
    setSource('demo')
    actions.reset()
    actions.setStatus('open', 'demo')
    // Deliberately does not loop. A repeat would re-fire event_start, which
    // legitimately clears state — wiping whatever the operator had selected
    // every time the scenario came round again.
    stopMock = startMockStream(enqueue, { loop: false })
  }

  function stopDemo() {
    if (!stopMock) return
    stopMock()
    stopMock = null
  }

  connect()

  onCleanup(() => {
    closed = true
    cancelDemoFallback()
    clearInterval(fpsTimer)
    if (rafHandle != null) cancelAnimationFrame(rafHandle)
    if (fallbackTimer != null) clearTimeout(fallbackTimer)
    rafHandle = null
    fallbackTimer = null
    flushScheduled = false
    queue.length = 0
    stopDemo()
    closeSocket()
  })

  return {
    source,
    lastError,
    endpoint,

    /**
     * Point the console at a different supervisor.
     *
     * This drops the open socket and connects to the new one, which means the
     * board is cleared: there is no state snapshot on connect (agent.md §6.1),
     * so nothing is on screen again until the new supervisor sends its next
     * frame. That is the honest behaviour — carrying the previous
     * supervisor's devices over would attribute them to this one.
     */
    setUrl(next) {
      if (typeof next !== 'string' || next === endpoint()) return false

      closeSocket()
      cancelDemoFallback()
      stopDemo()

      // Pointing at a different supervisor is a decision to watch a supervisor.
      manualDemo = false
      actions.setManualDemo(false)

      setEndpoint(next)
      actions.reset()
      setLastError(null)
      attempts = 0
      setSource('supervisor')
      connect()
      return true
    },

    /** True while the operator has deliberately chosen the demo. */
    isManualDemo: () => manualDemo,

    /**
     * Force the built-in demo and STAY there.
     *
     * The socket is torn down with its handlers detached, so nothing schedules
     * a reconnect, and manualDemo keeps connect() from running even if
     * something else calls it. The operator leaves the demo by choosing the
     * supervisor, and by nothing else.
     */
    useDemo() {
      manualDemo = true
      actions.setManualDemo(true)
      cancelDemoFallback()
      closeSocket()
      attempts = 0
      startDemo()
    },

    /** Drop the demo and connect to the supervisor. */
    useSupervisor() {
      manualDemo = false
      actions.setManualDemo(false)
      cancelDemoFallback()
      stopDemo()
      closeSocket()          // clears any in-flight reconnect timer too
      actions.reset()
      attempts = 0
      setSource('supervisor')
      connect()
    },

    /**
     * Reconnect now, without waiting out the backoff.
     *
     * The explicit recovery the fatal banner offers. It does not clear the
     * board — `actions.reset()` is a separate, separately labelled action,
     * because throwing away the last known state and asking for a new socket
     * are different decisions.
     */
    reconnect() {
      if (manualDemo) return false
      cancelDemoFallback()
      closeSocket()
      attempts = 0
      connect()
      return true
    },

    /** Replay the demo from the top. */
    restartDemo() {
      stopDemo()
      startDemo()
    },
  }
}

// ── supervisor REST ───────────────────────────────────────────

/**
 * POST /sensor — the only way to start a real event, and the only request this
 * console ever sends. Everything else here listens.
 *
 * `url` is a parameter for the same reason checkHealth's is: the endpoint is a
 * setting, and firing an incident at the compiled-in default while the operator
 * is watching a staging supervisor would start a disaster on the wrong machine.
 */
export async function triggerEvent(overrides = {}, { url = SENSOR_URL } = {}) {
  // depth_km is NOT defaulted here any more. It used to fall back to 10.5 —
  // an earthquake hypocentre depth — for every disaster type, so a flood
  // carried a plausible seismic reading it had no business carrying.
  // lib/launch.js sets it from the disaster type and passes it explicitly;
  // anything else calling this must do the same.
  const body = {
    event_id:        overrides.event_id ?? `${EVENT_ID}-${Date.now().toString(36).toUpperCase()}`,
    disaster_type:   overrides.disaster_type ?? AL_HAOUZ_EVENT.disaster_type,
    timestamp:       overrides.timestamp ?? Date.now(),
    severity:        overrides.severity ?? AL_HAOUZ_EVENT.severity,
    epicenter:       overrides.epicenter ?? AL_HAOUZ_EVENT.epicenter,
    radius_km:       overrides.radius_km ?? AL_HAOUZ_EVENT.radius_km,
    depth_km:        overrides.depth_km ?? depthFor(overrides.disaster_type ?? AL_HAOUZ_EVENT.disaster_type),
    aftershock_risk: overrides.aftershock_risk ?? AL_HAOUZ_EVENT.aftershock_risk,
    tsunami_risk:    overrides.tsunami_risk ?? AL_HAOUZ_EVENT.tsunami_risk,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // The ONLY success. A request that left the browser is not a request the
  // supervisor accepted, and the caller must not tell the operator otherwise.
  if (!res.ok) {
    throw new Error(`the supervisor answered ${res.status} ${res.statusText || ''}`.trim())
  }
  return body
}

/**
 * GET /health — used by the settings screen's Ping button.
 *
 * The URL is a parameter because the endpoint is a setting: pinging the
 * compiled-in default while the console listens to a staging supervisor would
 * answer a question nobody asked.
 */
export async function checkHealth({ url = HEALTH_URL, timeout = 3000 } = {}) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}
