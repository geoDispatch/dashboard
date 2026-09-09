// What the stream is actually doing — as a pure function, so it can be tested
// without a socket and reasoned about without reading four files.
//
// The rule this module exists to enforce: AN OPEN SOCKET IS NOT A LIVE STREAM.
// The console used to say "Stream live" the moment the WebSocket opened, which
// is true of a supervisor that has crashed mid-event and is holding the
// connection open with nothing behind it. The operator would have been reading
// a frozen board under a green light.
//
// Two independent axes, deliberately never collapsed into one word:
//
//   phase   what the transport is doing right now
//   source  where the frames are coming from
//
// A third thing — whether the PIPELINE is healthy — lives in the store as
// `state.pipeline` and is not represented here at all. A dead pipeline on a
// healthy socket is a real and important state, and folding it into this
// enum would make it unsayable.

/** No frame for this long, on an open socket, and the board is stale. */
export const STALE_MS = 30_000

export const PHASES = [
  'connecting',    // opening the socket, nothing established yet
  'waiting',       // socket open, not one frame has arrived on it
  'receiving',     // frames arriving, most recent within STALE_MS
  'stalled',       // socket open, nothing for STALE_MS — the board is frozen
  'reconnecting',  // dropped, retrying with backoff
  'lost',          // retried past the point of pretending
]

export const SOURCES = ['supervisor', 'demo']

/**
 * @param {object} conn
 *   status          'connecting' | 'open' | 'reconnecting' | 'lost'
 *   framesSinceOpen frames received since THIS socket opened, not cumulative —
 *                   a reconnect that never delivers must read as 'waiting'
 *                   however many frames the previous socket delivered
 *   lastFrameAt     epoch ms of the most recent frame, 0 if none
 *   now             epoch ms, injected so this is deterministic under test
 */
export function streamPhase(conn) {
  const status = conn && conn.status
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
// "Connected supervisor", never "live supervisor". The console can see that a
// socket is open to something that speaks the contract. It cannot see whether
// that something is talking to Nokia CAMARA or to the bundled Go mocks, and it
// has no way to find out — so it does not claim to know.

export const SOURCE_LABEL = {
  demo:       'Bundled demo',
  supervisor: 'Connected supervisor',
}

export const SOURCE_DETAIL = {
  demo:
    'Frames are generated inside this browser by the bundled Al Haouz scenario. ' +
    'No supervisor is involved and nothing here reflects a real event.',
  supervisor:
    'Frames are arriving from the supervisor at the configured endpoint. Whether ' +
    'that supervisor is reading Nokia CAMARA or its own bundled mocks is not ' +
    'visible from here — the upstream source is unverified.',
}

const PHASE_TEXT = {
  connecting:   'Connecting',
  waiting:      'No frames yet',
  receiving:    'Receiving',
  stalled:      'Stalled',
  reconnecting: 'Reconnecting',
  lost:         'Connection lost',
}

// The demo has no transport, so its phases mean different things and get their
// own words. "Demo finished" is the honest reading of a stalled demo: the
// bundled scenario runs once and stops, which is not a fault.
const DEMO_TEXT = {
  connecting:   'Demo starting',
  waiting:      'Demo starting',
  receiving:    'Demo running',
  stalled:      'Demo finished',
  reconnecting: 'Demo running',
  lost:         'Demo stopped',
}

const PHASE_TONE = {
  connecting:   'idle',
  waiting:      'idle',
  receiving:    'ok',
  stalled:      'warn',
  reconnecting: 'warn',
  lost:         'bad',
}

/** Short chip text plus a tone, for the toolbar and the settings readout. */
export function streamChip(phase, source) {
  const isDemo = source === 'demo'
  return {
    text: (isDemo ? DEMO_TEXT : PHASE_TEXT)[phase] || PHASE_TEXT.connecting,
    // A finished demo is not a warning; a stalled supervisor is.
    tone: isDemo && phase === 'stalled' ? 'idle' : (PHASE_TONE[phase] || 'idle'),
  }
}

/** One sentence saying what the chip means, including where frames come from. */
export function streamSentence(phase, source) {
  const origin = SOURCE_DETAIL[source] || SOURCE_DETAIL.supervisor

  const phaseSentence = {
    connecting:   'Opening the connection.',
    waiting:      'The connection is open but no frame has arrived on it yet.',
    receiving:    'Frames are arriving.',
    stalled:      `The connection is open but nothing has arrived for over ${Math.round(STALE_MS / 1000)} seconds. What is on screen is the last thing that was sent, not the current situation.`,
    reconnecting: 'The connection dropped. Retrying with backoff.',
    lost:         'The connection could not be re-established. What is on screen is the last thing that arrived.',
  }[phase] || ''

  if (source === 'demo') {
    const demoSentence = {
      stalled: 'The bundled scenario has played to its end. It runs once and stops.',
      lost:    'The demo was stopped.',
    }[phase] || 'The bundled scenario is playing.'
    return `${demoSentence} ${origin}`
  }

  return `${phaseSentence} ${origin}`
}
