// What the stream is actually doing — as a pure function, so it can be tested
// without a socket and reasoned about without reading four files.
//
// The rule this module exists to enforce: AN OPEN SOCKET IS NOT A LIVE STREAM.
// A supervisor that has crashed mid-event can hold the connection open with
// nothing behind it, and a console that said "live" would have the operator
// reading a frozen board under a green light.
//
// Freshness is judged on lastFrameAt, which only accepted and control frames
// move. The supervisor sends a heartbeat every 15 s on every connection, so a
// quiet but healthy supervisor keeps it fresh, and STALE_MS — three missed
// heartbeats — separates "nothing is happening" from "nothing is arriving".
//
// Whether the PIPELINE is healthy, and what the incident is doing, live in the
// store (`pipeline`, `lifecycle`) and are not represented here at all. A dead
// pipeline on a healthy socket is a real state, and folding it into this enum
// would make it unsayable.

/** No accepted or control frame for this long, on an open socket, and the board is stale. */
export const STALE_MS = 45_000

export const PHASES = [
  'connecting',    // opening the socket, nothing established yet
  'waiting',       // socket open, not one frame has arrived on it
  'receiving',     // frames arriving, most recent within STALE_MS
  'stalled',       // socket open, nothing for STALE_MS — the board is frozen
  'reconnecting',  // dropped, retrying with backoff
  'lost',          // retried past the point of pretending
]

// Not a transport phase: there is no socket while a browser simulation plays
// (lib/simulation.js), and the board says so rather than naming the supervisor.
export const SIMULATION_PHASE = 'simulating'

/**
 * @param {object} conn
 *   status          'connecting' | 'open' | 'reconnecting' | 'lost' | 'simulation'
 *   framesSinceOpen frames counted since THIS socket opened, not cumulative —
 *                   a reconnect that never delivers must read as 'waiting'
 *                   however many frames the previous socket delivered
 *   lastFrameAt     epoch ms of the most recent counted frame, 0 if none
 *   now             epoch ms, injected so this is deterministic under test
 */
export function streamPhase(conn) {
  const status = conn && conn.status
  if (status === 'simulation') return SIMULATION_PHASE
  if (status === 'reconnecting') return 'reconnecting'
  if (status === 'lost') return 'lost'
  if (status !== 'open') return 'connecting'

  const frames = (conn && conn.framesSinceOpen) || 0
  const lastFrameAt = (conn && conn.lastFrameAt) || 0
  if (!frames || !lastFrameAt) return 'waiting'

  const now = (conn && conn.now) || Date.now()
  const staleMs = (conn && conn.staleMs) || STALE_MS
  return now - lastFrameAt >= staleMs ? 'stalled' : 'receiving'
}

// ── Wording ────────────────────────────────────────────────────────────────
//
// "Supervisor connected", never "live". The console can see that a socket is
// open to something that speaks the contract. It cannot see whether that
// something is talking to a real network API or to the bundled Go mocks — the
// supervisor may DECLARE its configured source, but a declaration is not a
// verification — so it does not claim to know.

export const SOURCE_LABEL = 'Supervisor connected'

export const SOURCE_DETAIL =
  'Frames come from the configured supervisor. Its upstream source is unverified.'

export const SIMULATION_LABEL = 'Simulation'

export const SIMULATION_DETAIL =
  'Frames are generated in this browser. Synthetic data, not from the supervisor.'

const PHASE_TEXT = {
  connecting:   'Connecting',
  waiting:      'No frames yet',
  receiving:    'Receiving',
  stalled:      'Stalled',
  reconnecting: 'Reconnecting',
  lost:         'Connection lost',
  simulating:   SIMULATION_LABEL,
}

const PHASE_TONE = {
  connecting:   'idle',
  waiting:      'idle',
  receiving:    'ok',
  stalled:      'warn',
  reconnecting: 'warn',
  lost:         'bad',
  simulating:   'sim',
}

/** Short chip text plus a tone, for the toolbar and the settings readout. */
export function streamChip(phase) {
  return {
    text: PHASE_TEXT[phase] || PHASE_TEXT.connecting,
    tone: PHASE_TONE[phase] || 'idle',
  }
}

/** One sentence saying what the chip means, including where frames come from. */
export function streamSentence(phase) {
  if (phase === SIMULATION_PHASE) return `Simulation running. ${SIMULATION_DETAIL}`
  const phaseSentence = {
    connecting:   'Connecting to the supervisor.',
    waiting:      'Connected. Waiting for the first frame.',
    receiving:    'Frames are arriving.',
    stalled:      `No frames for ${Math.round(STALE_MS / 1000)} seconds, not even a heartbeat. Showing the last received state.`,
    reconnecting: 'Connection lost. Reconnecting.',
    lost:         'Connection lost. Showing the last received state.',
  }[phase] || 'Connecting to the supervisor.'

  return `${phaseSentence} ${SOURCE_DETAIL}`
}
