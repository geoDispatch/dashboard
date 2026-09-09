// "Stream live" was the bug. These pin down the states that replaced it.

import { describe, expect, it } from 'vitest'
import { createRoot } from 'solid-js'

import { STALE_MS, streamChip, streamPhase, streamSentence } from './streamState'
import { createConsoleStore } from './store'
import { createSelectors } from './selectors'

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
  it('never says the stream is live', () => {
    for (const phase of ['connecting', 'waiting', 'receiving', 'stalled', 'reconnecting', 'lost']) {
      for (const source of ['supervisor', 'demo']) {
        const { text } = streamChip(phase, source)
        expect(text.toLowerCase()).not.toContain('live')
        expect(streamSentence(phase, source).toLowerCase()).not.toContain('live supervisor')
      }
    }
  })

  it('distinguishes the bundled demo from a connected supervisor', () => {
    expect(streamChip('receiving', 'demo').text).toBe('Demo running')
    expect(streamChip('receiving', 'supervisor').text).toBe('Receiving')
    // A finished demo is not a fault; a stalled supervisor is.
    expect(streamChip('stalled', 'demo').tone).toBe('idle')
    expect(streamChip('stalled', 'supervisor').tone).toBe('warn')
  })

  it('says the upstream source is unverified for a connected supervisor', () => {
    expect(streamSentence('receiving', 'supervisor')).toMatch(/unverified/)
    expect(streamSentence('receiving', 'demo')).toMatch(/No supervisor is involved/)
  })
})

describe('the phase the UI actually reads', () => {
  it('turns stale once the clock is ticked past the timeout', () => {
    createRoot((dispose) => {
      const { state, actions } = createConsoleStore()
      const selectors = createSelectors(state)

      expect(selectors.phase()).toBe('connecting')

      actions.setStatus('open', 'supervisor')
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

  it('keeps pipeline health out of the transport phase', () => {
    createRoot((dispose) => {
      const { state, actions } = createConsoleStore()
      const selectors = createSelectors(state)

      actions.setStatus('open', 'supervisor')
      actions.countFrame()
      actions.error({ code: 'DB_ERROR', message: 'dead', fatal: true }, null)

      // The pipeline is halted; the socket is fine, and says so.
      expect(selectors.incidentState()).toBe('halted')
      expect(selectors.phase()).toBe('receiving')

      dispose()
    })
  })
})
