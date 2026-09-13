// "Stream live" was the bug. These pin down the states that replaced it.

import { describe, expect, it } from 'vitest'
import { createRoot } from 'solid-js'

import {
  PHASES,
  SIMULATION_PHASE,
  SOURCE_DETAIL,
  SOURCE_LABEL,
  STALE_MS,
  streamChip,
  streamPhase,
  streamSentence,
} from './streamState'
import { createConsoleStore } from './store'
import { createSelectors } from './selectors'
import { routeMessage } from './router'
import { EVENT_A, errorPayload, eventStream, heartbeat, snapshotBegin, snapshotEnd } from './v2frames.fixture'

const at = (over = {}) => ({
  status: 'open', framesSinceOpen: 1, lastFrameAt: 1_000, now: 1_000, ...over,
})

describe('streamPhase', () => {
  it('reports the transport before anything else', () => {
    expect(streamPhase(at({ status: 'connecting' }))).toBe('connecting')
    expect(streamPhase(at({ status: 'reconnecting' }))).toBe('reconnecting')
    expect(streamPhase(at({ status: 'lost' }))).toBe('lost')
  })

  it('an open socket that has delivered nothing is waiting, not receiving', () => {
    expect(streamPhase(at({ framesSinceOpen: 0, lastFrameAt: 0 }))).toBe('waiting')
  })

  it('ignores frames delivered by a PREVIOUS socket', () => {
    // A reconnect that has produced nothing must not inherit the old socket's
    // freshness just because lastFrameAt is still recent.
    expect(streamPhase(at({ framesSinceOpen: 0, lastFrameAt: 999, now: 1_000 }))).toBe('waiting')
  })

  it('goes stale exactly at the timeout, not before', () => {
    const t0 = 1_700_000_000_000
    const base = { status: 'open', framesSinceOpen: 40, lastFrameAt: t0 }
    expect(streamPhase({ ...base, now: t0 + STALE_MS - 1 })).toBe('receiving')
    expect(streamPhase({ ...base, now: t0 + STALE_MS })).toBe('stalled')
    expect(streamPhase({ ...base, now: t0 + STALE_MS * 4 })).toBe('stalled')
  })

  it('allows three missed 15 s heartbeats before calling the stream stalled', () => {
    expect(STALE_MS).toBe(45_000)
  })

  it('treats lastFrameAt 0 as "never", not as the epoch', () => {
    expect(streamPhase({ status: 'open', framesSinceOpen: 3, lastFrameAt: 0, now: 5_000 }))
      .toBe('waiting')
  })

  it('treats an unknown status as connecting rather than as healthy', () => {
    expect(streamPhase(at({ status: 'banana' }))).toBe('connecting')
    expect(streamPhase(undefined)).toBe('connecting')
  })
})

describe('wording', () => {
  it('has exactly the six transport phases', () => {
    expect(PHASES).toEqual(['connecting', 'waiting', 'receiving', 'stalled', 'reconnecting', 'lost'])
  })

  it('never says live, and never mentions a demo', () => {
    for (const phase of PHASES) {
      const { text } = streamChip(phase)
      const sentence = streamSentence(phase)
      expect(text.toLowerCase()).not.toContain('live')
      expect(sentence.toLowerCase()).not.toContain('live')
      expect(`${text} ${sentence}`.toLowerCase()).not.toMatch(/demo|simulat/)
    }
  })

  it('names a simulation as a simulation, and never as the supervisor or live', () => {
    expect(streamPhase({ status: 'simulation', framesSinceOpen: 0, lastFrameAt: 0, now: 1 })).toBe(SIMULATION_PHASE)
    expect(PHASES).not.toContain(SIMULATION_PHASE)
    const { text, tone } = streamChip(SIMULATION_PHASE)
    const sentence = streamSentence(SIMULATION_PHASE)
    expect(text).toBe('Simulation')
    expect(tone).toBe('sim')
    expect(sentence).toContain('Synthetic data, not from the supervisor')
    expect(`${text} ${sentence}`.toLowerCase()).not.toContain('live')
    expect(sentence).not.toContain(SOURCE_DETAIL)
  })

  it('says a connected supervisor is connected, and that its upstream source is unverified', () => {
    expect(SOURCE_LABEL).toBe('Supervisor connected')
    expect(SOURCE_DETAIL).toBe('Frames come from the configured supervisor. Its upstream source is unverified.')
    expect(streamSentence('receiving')).toContain(SOURCE_DETAIL)
    expect(streamChip('stalled').tone).toBe('warn')
    expect(streamChip('lost').tone).toBe('bad')
    expect(streamChip('receiving').tone).toBe('ok')
  })
})

describe('the phase the UI actually reads', () => {
  it('turns stale once the clock is ticked past the timeout', () => {
    createRoot((dispose) => {
      const { state, actions } = createConsoleStore()
      const selectors = createSelectors(state)

      expect(selectors.phase()).toBe('connecting')

      actions.setStatus('open')
      expect(selectors.phase()).toBe('waiting')

      actions.countFrame()
      expect(selectors.phase()).toBe('receiving')

      // Nothing arrives. Only the tick can reveal that.
      actions.tick(state.connection.lastFrameAt + STALE_MS + 1)
      expect(selectors.phase()).toBe('stalled')

      // A frame brings it back.
      actions.countFrame()
      expect(selectors.phase()).toBe('receiving')

      dispose()
    })
  })

  it('heartbeats keep a quiet supervisor fresh; invalid frames do not', () => {
    createRoot((dispose) => {
      let clock = 1_000
      const { state, actions } = createConsoleStore({ now: () => clock })
      const selectors = createSelectors(state)
      actions.setStatus('open')
      routeMessage(actions, snapshotBegin('', 0, 'idle'))
      routeMessage(actions, snapshotEnd('', 0))

      clock += 40_000
      routeMessage(actions, heartbeat('', 0, 'idle', false))
      clock += 40_000
      actions.tick(clock)
      expect(selectors.phase()).toBe('receiving')

      // Garbage arriving is not proof of life.
      routeMessage(actions, '{not json')
      routeMessage(actions, { ...heartbeat('', 0, 'idle', false), v: 1 })
      clock += 10_000
      actions.tick(clock)
      expect(selectors.phase()).toBe('stalled')

      dispose()
    })
  })

  it('keeps pipeline health out of the transport phase', () => {
    createRoot((dispose) => {
      const { state, actions } = createConsoleStore()
      const selectors = createSelectors(state)

      actions.setStatus('open')
      routeMessage(actions, snapshotBegin('', 0, 'idle'))
      routeMessage(actions, snapshotEnd('', 0))
      const a = eventStream(EVENT_A)
      routeMessage(actions, a.start())
      routeMessage(actions, a.next('error', errorPayload({ code: 'DB_ERROR', stage: 'lookup', fatal: true, message: 'lookup failed' })))

      // The pipeline is halted; the socket is fine, and says so.
      expect(state.pipeline.fatal.code).toBe('DB_ERROR')
      expect(selectors.phase()).toBe('receiving')
      // Halted is not terminal until event_complete says so.
      expect(selectors.incidentState()).toBe('opening')

      dispose()
    })
  })
})
