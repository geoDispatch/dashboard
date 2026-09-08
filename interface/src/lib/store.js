import { createStore, produce } from 'solid-js/store'
import { batch } from 'solid-js'

// One normalised store for the whole console. Devices are keyed by phone and
// mutated in place with `produce`, so Solid's fine-grained reactivity updates
// only the dots that changed rather than the whole map.

export function createConsoleStore() {
  const [state, setState] = createStore({
    // ── connection ────────────────────────────────────────────
    connection: {
      status:      'connecting',  // connecting | live | reconnecting | lost
      source:      'live',        // live | demo
      since:       Date.now(),
      lastFrameAt: 0,
      frames:      0,
      fps:         0,
    },

    // ── event ─────────────────────────────────────────────────
    event:      null,   // EventStart payload + event_id + receivedAt
    joinedLate: false,  // devices arrived but event_start never did (gap §6.1)

    // ── data ──────────────────────────────────────────────────
    devices:    {},     // phone → DeviceUpdate (+ demo-only decision fields)
    summary:    null,   // server ZoneSummary — cross-check, not source of truth
    narratives: {},     // zone → { text, receivedAt, batch }
    errors:     [],     // ErrorUpdate + receivedAt + id
    fatal:      null,   // first fatal error — pipeline is dead

    // ── ui ────────────────────────────────────────────────────
    selectedPhone: null,
    region:        null,   // { name, latitude, longitude, source }
    batchCount:    0,
  })

  let errorSeq = 0

  const actions = {
    // ── connection ──────────────────────────────────────────
    setStatus(status, source) {
      setState('connection', produce(c => {
        if (c.status !== status) c.since = Date.now()
        c.status = status
        if (source) c.source = source
      }))
    },

    countFrame() {
      setState('connection', produce(c => {
        c.frames += 1
        c.lastFrameAt = Date.now()
      }))
    },

    setFps(fps) {
      setState('connection', 'fps', fps)
    },

    // ── stream messages ─────────────────────────────────────
    eventStart(payload, eventId, timestamp) {
      batch(() => {
        setState(produce(s => {
          s.event = {
            ...payload,
            event_id:   eventId,
            timestamp:  timestamp || 0,
            receivedAt: Date.now(),
          }
          // event_start clears prior state — a new disaster, not an update.
          s.devices       = {}
          s.narratives    = {}
          s.summary       = null
          s.errors        = []
          s.fatal         = null
          s.selectedPhone = null
          s.joinedLate    = false
          s.batchCount    = 0
        }))
      })
    },

    deviceUpdate(payload) {
      if (!payload?.phone) return
      setState(produce(s => {
        const existing = s.devices[payload.phone]
        if (existing) {
          // Dispatch phase overwrites triage phase — merge so the triage
          // fields (lat/lng/reachable) survive a partial later frame.
          Object.assign(existing, payload)
          existing.updatedAt = Date.now()
        } else {
          s.devices[payload.phone] = {
            ...payload,
            firstSeenAt: Date.now(),
            updatedAt:   Date.now(),
          }
          // A device before any event_start means we joined mid-event.
          if (!s.event) s.joinedLate = true
        }
      }))
    },

    zoneSummary(payload) {
      setState('summary', { ...payload, receivedAt: Date.now() })
    },

    narrative(payload) {
      if (!payload?.zone) return
      setState(produce(s => {
        s.batchCount += 1
        s.narratives[payload.zone] = {
          text:       payload.narrative ?? '',
          receivedAt: Date.now(),
          batch:      s.batchCount,
        }
      }))
    },

    error(payload) {
      setState(produce(s => {
        const entry = { ...payload, id: ++errorSeq, receivedAt: Date.now() }
        s.errors.push(entry)
        if (payload?.fatal && !s.fatal) s.fatal = entry
        // Keep the rail bounded — errors arrive dozens per event.
        if (s.errors.length > 200) s.errors.splice(0, s.errors.length - 200)
      }))
    },

    // ── ui ──────────────────────────────────────────────────
    selectDevice(phone) {
      setState('selectedPhone', phone ?? null)
    },

    dismissError(id) {
      setState('errors', errs => errs.filter(e => e.id !== id))
    },

    clearErrors() {
      setState('errors', [])
    },

    setRegion(region) {
      setState('region', region)
    },

    reset() {
      batch(() => {
        setState(produce(s => {
          s.event = null
          s.devices = {}
          s.narratives = {}
          s.summary = null
          s.errors = []
          s.fatal = null
          s.selectedPhone = null
          s.joinedLate = false
          s.batchCount = 0
        }))
      })
    },
  }

  return { state, actions }
}
