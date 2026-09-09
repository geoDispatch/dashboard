import { createSignal, onCleanup, batch } from 'solid-js'
import { WS_URL, SENSOR_URL, HEALTH_URL } from '../constants/zones'
import { routeMessage } from './router'
import { startMockStream, AL_HAOUZ_EVENT, EVENT_ID } from './mockStream'

// One socket for the whole console.
//
// Frames are buffered and flushed once per animation frame inside a batch().
// The supervisor drops frames when its outbound channel fills (agent.md §6.6),
// so bursts are expected and applying them one at a time thrashes the store.
//
// If the supervisor is not reachable the stream falls back to the built-in
// Al Haouz demo so the console is never a blank screen. The source is exposed
// so the UI can say which one it is showing — a demo that pretends to be live
// is the one thing worse than no demo.

export function createStream(actions, {
  url = WS_URL,
  autoDemo = true,
  demoDelayMs = 2500,
} = {}) {
  const [source, setSource] = createSignal('live')   // live | demo
  const [lastError, setLastError] = createSignal(null)

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

  // Rolling frames/second — drives the "Stream live · N/s" chip.
  const fpsTimer = setInterval(() => {
    const cutoff = Date.now() - 1000
    while (fpsWindow.length && fpsWindow[0] < cutoff) fpsWindow.shift()
    actions.setFps(fpsWindow.length)
  }, 500)

  // ── live socket ─────────────────────────────────────────────
  function connect() {
    if (closed) return
    clearTimeout(reconnectTimer)
    actions.setStatus(attempts === 0 ? 'connecting' : 'reconnecting', 'live')

    try {
      ws = new WebSocket(endpoint())
    } catch (err) {
      setLastError(String(err))
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      attempts = 0
      setLastError(null)
      stopDemo()
      setSource('live')
      actions.setStatus('live', 'live')
    }

    ws.onmessage = (e) => {
      try {
        enqueue([JSON.parse(e.data)])
      } catch {
        console.warn('[stream] non-JSON frame discarded')
      }
    }

    ws.onclose = () => {
      if (closed) return
      actions.setStatus('reconnecting', source())
      scheduleReconnect()
    }

    ws.onerror = () => {
      setLastError(`cannot reach supervisor at ${endpoint()}`)
    }

    // If the supervisor never answers, fall back to the demo rather than
    // leaving the operator looking at an empty console.
    if (autoDemo && !demoTimer && source() === 'live') {
      demoTimer = setTimeout(() => {
        if (!closed && ws?.readyState !== WebSocket.OPEN) startDemo()
      }, demoDelayMs)
    }
  }

  function scheduleReconnect() {
    attempts += 1
    // 1s, 2s, 4s … capped at 15s. The old hook retried a flat 3s forever.
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempts - 1, 4))
    if (attempts > 3) actions.setStatus('lost', source())
    reconnectTimer = setTimeout(connect, delay)
  }

  // ── demo stream ─────────────────────────────────────────────
  function startDemo() {
    if (stopMock) return
    setSource('demo')
    actions.reset()
    actions.setStatus('live', 'demo')
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
    clearTimeout(reconnectTimer)
    clearTimeout(demoTimer)
    clearInterval(fpsTimer)
    if (rafHandle != null) cancelAnimationFrame(rafHandle)
    if (fallbackTimer != null) clearTimeout(fallbackTimer)
    stopDemo()
    ws?.close()
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

      // Detach before closing. The old socket's onclose would otherwise fire
      // after the swap and schedule its own reconnect, leaving two connect
      // loops racing at the new address.
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        try { ws.close() } catch { /* already closing */ }
        ws = null
      }

      clearTimeout(reconnectTimer)
      clearTimeout(demoTimer)
      demoTimer = null
      stopDemo()

      setEndpoint(next)
      actions.reset()
      setLastError(null)
      attempts = 0
      setSource('live')
      connect()
      return true
    },

    /** Force the built-in Al Haouz demo, whatever the socket is doing. */
    useDemo() {
      clearTimeout(demoTimer)
      demoTimer = null
      ws?.close()
      startDemo()
    },

    /** Drop the demo and retry the supervisor now. */
    useLive() {
      stopDemo()
      actions.reset()
      attempts = 0
      setSource('live')
      connect()
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
  const body = {
    event_id:        overrides.event_id ?? `${EVENT_ID}-${Date.now().toString(36).toUpperCase()}`,
    disaster_type:   overrides.disaster_type ?? AL_HAOUZ_EVENT.disaster_type,
    timestamp:       Date.now(),
    severity:        overrides.severity ?? AL_HAOUZ_EVENT.severity,
    epicenter:       overrides.epicenter ?? AL_HAOUZ_EVENT.epicenter,
    radius_km:       overrides.radius_km ?? AL_HAOUZ_EVENT.radius_km,
    depth_km:        overrides.depth_km ?? 10.5,
    aftershock_risk: overrides.aftershock_risk ?? AL_HAOUZ_EVENT.aftershock_risk,
    tsunami_risk:    overrides.tsunami_risk ?? AL_HAOUZ_EVENT.tsunami_risk,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`supervisor returned ${res.status}`)
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
