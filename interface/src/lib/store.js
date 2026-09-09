import { createStore, produce } from 'solid-js/store'
import { batch } from 'solid-js'

// One normalised store for the whole console. Devices are keyed by phone and
// mutated in place with `produce`, so Solid's fine-grained reactivity updates
// only the dots that changed rather than the whole map.
//
// Three things this store keeps deliberately apart, because collapsing any two
// of them produces a screen that lies:
//
//   connection   the transport. Open, dropped, retrying. Says nothing about
//                whether data is arriving — see lib/streamState.js.
//   pipeline     the supervisor's own health. A fatal DB_ERROR kills the
//                pipeline while leaving the socket perfectly open.
//   event        which incident the frames on screen belong to.
//
// The last one is enforced rather than assumed. The supervisor sends
// `event_id` on every envelope and gives no snapshot on connect, so a console
// that joins mid-event, or that is still holding an old incident when a new
// one starts, can be handed frames from two incidents in the same second.
// Merging those would produce a map that never existed.

export function createConsoleStore() {
  const [state, setState] = createStore({
    // ── connection ────────────────────────────────────────────
    connection: {
      // 'connecting' | 'open' | 'reconnecting' | 'lost'
      // NOT 'live'. An open socket is not a live stream, and naming it 'live'
      // is how the console came to claim one.
      status:          'connecting',
      source:          'supervisor',   // 'supervisor' | 'demo'
      manualDemo:      false,          // operator chose the demo; do not reconnect
      since:           Date.now(),
      lastFrameAt:     0,
      frames:          0,              // cumulative, this session
      framesSinceOpen: 0,              // reset every time a socket opens
      fps:             0,
      now:             Date.now(),     // ticked, so staleness re-evaluates
    },

    // ── pipeline ──────────────────────────────────────────────
    // The supervisor's health, not ours. `fatal` holds the first fatal error
    // frame; frames that arrive afterwards are still applied, because the
    // supervisor may well keep sending and throwing that data away would be a
    // second failure on top of the first.
    pipeline: {
      fatal:      null,
      haltedAt:   0,
      framesAfterFatal: 0,
    },

    // ── event ─────────────────────────────────────────────────
    event:         null,   // EventStart payload + event_id + receivedAt
    activeEventId: null,   // set by event_start, or adopted on a late join
    joinedLate:    false,  // frames arrived but event_start never did (gap §6.1)
    dropped: {
      foreign: 0,          // frames belonging to a different incident
      lastId:  null,
    },

    // ── data ──────────────────────────────────────────────────
    devices:    {},     // phone → DeviceUpdate
    summary:    null,   // server ZoneSummary — cross-check, not source of truth
    narratives: {},     // zone → { text, receivedAt, batch }
    errors:     [],     // ErrorUpdate + receivedAt + id

    // ── ui ────────────────────────────────────────────────────
    // Selecting a device and selecting a zone are mutually exclusive: the
    // details panel shows one subject at a time.
    selectedPhone: null,
    selectedZone:  null,
    region:        null,   // { name, latitude, longitude, source }
    batchCount:    0,
  })

  let errorSeq = 0

  // ── incident gate ─────────────────────────────────────────────────────────
  //
  // Runs inside produce(), so it can both answer and record. Three cases:
  //
  //   no incident yet   adopt whatever this frame claims and mark the join as
  //                     late — we know an id, we do NOT know the epicentre,
  //                     and nothing here invents one.
  //   same incident     accept.
  //   different id      drop, and count it. A silent drop and a merge are both
  //                     lies; a counted drop is a fact the UI can show.
  //
  // A frame with no event_id at all is accepted: the contract says every
  // envelope carries one, so an empty one is a supervisor bug rather than
  // evidence of a second incident, and it cannot be attributed elsewhere.
  function belongsToActiveEvent(s, eventId) {
    if (!s.activeEventId) {
      if (eventId) {
        s.activeEventId = eventId
        s.joinedLate = true
      }
      return true
    }
    if (!eventId) return true
    if (eventId === s.activeEventId) return true

    s.dropped.foreign += 1
    s.dropped.lastId = eventId
    return false
  }

  function noteFrameAfterFatal(s) {
    if (s.pipeline.fatal) s.pipeline.framesAfterFatal += 1
  }

  const blank = (s) => {
    s.event          = null
    s.activeEventId  = null
    s.devices        = {}
    s.narratives     = {}
    s.summary        = null
    s.errors         = []
    s.selectedPhone  = null
    s.selectedZone   = null
    s.joinedLate     = false
    s.batchCount     = 0
    s.dropped.foreign = 0
    s.dropped.lastId  = null
    s.pipeline.fatal            = null
    s.pipeline.haltedAt         = 0
    s.pipeline.framesAfterFatal = 0
  }

  const actions = {
    // ── connection ──────────────────────────────────────────
    setStatus(status, source) {
      setState('connection', produce(c => {
        if (c.status !== status) c.since = Date.now()
        // A newly opened socket has delivered nothing yet, whatever the
        // previous one delivered. Without this reset a reconnect that never
        // produces a frame would still read as "receiving".
        if (status === 'open' && c.status !== 'open') c.framesSinceOpen = 0
        c.status = status
        if (source) c.source = source
      }))
    },

    setManualDemo(on) {
      setState('connection', 'manualDemo', !!on)
    },

    countFrame() {
      setState('connection', produce(c => {
        c.frames += 1
        c.framesSinceOpen += 1
        c.lastFrameAt = Date.now()
        c.now = c.lastFrameAt
      }))
    },

    setFps(fps) {
      setState('connection', 'fps', fps)
    },

    /** Advance the clock the staleness check reads. */
    tick(now = Date.now()) {
      setState('connection', 'now', now)
    },

    // ── stream messages ─────────────────────────────────────
    // Every one of these takes the envelope's event_id. The router passes it;
    // nothing here guesses.
    eventStart(payload, eventId, timestamp) {
      batch(() => {
        setState(produce(s => {
          // event_start is the one frame that is never gated: a new incident
          // legitimately replaces whatever was on screen.
          blank(s)
          s.event = {
            ...payload,
            event_id:   eventId ?? null,
            timestamp:  timestamp || 0,
            receivedAt: Date.now(),
          }
          s.activeEventId = eventId ?? null
        }))
      })
    },

    deviceUpdate(payload, eventId) {
      if (!payload?.phone) return
      setState(produce(s => {
        if (!belongsToActiveEvent(s, eventId)) return
        noteFrameAfterFatal(s)

        const existing = s.devices[payload.phone]
        if (existing) {
          // Sent twice per device: once at triage, once after dispatch. The
          // later frame wins field by field, so triage's lat/lng survive a
          // dispatch frame and dispatch's booleans overwrite triage's.
          Object.assign(existing, payload)
          existing.updatedAt = Date.now()
        } else {
          s.devices[payload.phone] = {
            ...payload,
            firstSeenAt: Date.now(),
            updatedAt:   Date.now(),
          }
        }
      }))
    },

    zoneSummary(payload, eventId) {
      setState(produce(s => {
        if (!belongsToActiveEvent(s, eventId)) return
        noteFrameAfterFatal(s)
        s.summary = { ...payload, receivedAt: Date.now() }
      }))
    },

    narrative(payload, eventId) {
      if (!payload?.zone) return
      setState(produce(s => {
        if (!belongsToActiveEvent(s, eventId)) return
        noteFrameAfterFatal(s)
        s.batchCount += 1
        s.narratives[payload.zone] = {
          text:       payload.narrative ?? '',
          receivedAt: Date.now(),
          batch:      s.batchCount,
        }
      }))
    },

    error(payload, eventId) {
      setState(produce(s => {
        if (!belongsToActiveEvent(s, eventId)) return
        noteFrameAfterFatal(s)

        const entry = { ...payload, id: ++errorSeq, receivedAt: Date.now() }
        s.errors.push(entry)

        if (payload?.fatal && !s.pipeline.fatal) {
          s.pipeline.fatal = entry
          s.pipeline.haltedAt = entry.receivedAt
        }
        // Keep the rail bounded — errors arrive dozens per event.
        if (s.errors.length > 200) s.errors.splice(0, s.errors.length - 200)
      }))
    },

    // ── ui ──────────────────────────────────────────────────
    selectDevice(phone) {
      batch(() => {
        setState('selectedPhone', phone ?? null)
        if (phone) setState('selectedZone', null)
      })
    },

    selectZone(zone) {
      batch(() => {
        setState('selectedZone', zone ?? null)
        if (zone) setState('selectedPhone', null)
      })
    },

    clearSelection() {
      batch(() => {
        setState('selectedPhone', null)
        setState('selectedZone', null)
      })
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

    /**
     * Drop the incident on screen and wait for the next one.
     *
     * The explicit way out of a halted pipeline: there is no snapshot to
     * re-request and no replay to ask for, so the only honest recovery is to
     * stop showing a board nobody is updating.
     */
    reset() {
      batch(() => setState(produce(blank)))
    },
  }

  return { state, actions }
}
