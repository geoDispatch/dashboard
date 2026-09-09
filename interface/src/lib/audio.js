// Dispatch alert tones.
//
// Synthesised with the Web Audio API rather than shipped as files: two short
// tones are a few lines of oscillator, and an operations console should not
// have to fetch an asset before it can tell someone a rescue was flagged.
//
// Two sounds, deliberately unalike, because they mean opposite things:
//
//   rescue  a rising two-note bell. Something needs a person. Calm.
//   fatal   a falling three-pulse buzz. The pipeline is dead and nothing on
//           screen is updating any more. Urgent, and it does not sound pretty.
//
// Browsers refuse to start an AudioContext until the page has been interacted
// with. Everything here is best-effort: if the context cannot start, the call
// returns false and the settings screen says so rather than pretending an
// alarm will fire.

let context = null

function audioContext() {
  if (context) return context
  const Ctor = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null
  if (!Ctor) return null
  try {
    context = new Ctor()
  } catch {
    context = null
  }
  return context
}

// Each note is [frequency, startOffset, duration].
const VOICES = {
  rescue: {
    type: 'sine',
    gain: 0.35,
    notes: [[880, 0, 0.16], [1318.5, 0.14, 0.34]],
  },
  fatal: {
    type: 'square',
    // A square wave at the same gain is far louder than a sine; this keeps the
    // two alerts at a comparable level rather than making the alarm painful.
    gain: 0.12,
    notes: [[440, 0, 0.14], [392, 0.2, 0.14], [330, 0.4, 0.36]],
  },
}

/**
 * Play one of the two voices at `volume` (0–1).
 *
 * Async, and it has to be: a context created on the first alert starts
 * suspended, and resume() settles on a later tick. Checking the state
 * immediately after asking for it always reads "suspended", which silently
 * swallowed the very first alert of every session — the one that matters most,
 * because it is the one announcing the first P1 rescue.
 *
 * Resolves true if the tone was scheduled, false if audio is unavailable or
 * the browser is still withholding it for want of a user gesture.
 */
export async function playAlert(voice, volume = 0.8) {
  const spec = VOICES[voice]
  const ctx = audioContext()
  if (!spec || !ctx) return false

  // resume() only succeeds once the page has been interacted with at least
  // once. Before that it rejects or stays suspended, and the caller is told.
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      return false
    }
  }
  if (ctx.state !== 'running') return false

  const level = Math.min(1, Math.max(0, volume)) * spec.gain
  if (level <= 0) return false

  try {
    for (const [frequency, offset, duration] of spec.notes) {
      const start = ctx.currentTime + offset
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = spec.type
      osc.frequency.setValueAtTime(frequency, start)

      // A hard start or stop on an oscillator is an audible click. Ramping the
      // gain instead of switching it is what makes this read as a chime.
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(level, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration + 0.02)
    }
    return true
  } catch {
    return false
  }
}
