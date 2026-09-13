import { createStore, produce } from 'solid-js/store'
import { batch } from 'solid-js'

// One normalised store for the whole console, fed ONLY by validated contract
// v2 frames (lib/validate.js → lib/router.js → actions.apply). Nothing enters
// it any other way: a fresh store is empty, and it stays empty until the
// supervisor says otherwise.
//
// Devices are keyed by phone and updated in place, so Solid's fine-grained
// reactivity repaints only the dots that changed.
//
// Things kept deliberately apart, because collapsing any two of them produces
// a screen that lies:
//
//   connection  the transport. Open, dropped, retrying. Says nothing about
//               whether data is arriving — see lib/streamState.js.
//   sync        how this console's copy relates to the supervisor's: whether
//               the connection snapshot has been replayed, the last seq
//               applied, and whether a resync is needed.
//   lifecycle   what the incident itself is doing, from event_start and
//               event_complete.
//   pipeline    the first fatal error frame, if any.
//   event       which incident the data on screen belongs to.

const MAX_ERRORS = 200

function initialState(now) {
  return {
    connection: {
      // 'connecting' | 'open' | 'reconnecting' | 'lost', or 'simulation'
      // while a browser simulation replaces the socket. NOT 'live': an open
      // socket is not a live stream.
      status:          'connecting',
      since:           now,
      lastFrameAt:     0,   // accepted and control frames only
      framesSinceOpen: 0,   // reset every time a socket opens
      fps:             0,
      now,                  // ticked, so staleness re-evaluates
    },

    // Session diagnostics. foreign / lastForeignId are per incident and are
    // cleared when a new event starts; everything else accumulates.
    counters: {
      received:          0,
      accepted:          0,
      control:           0,
      invalid:           0,
      foreign:           0,
      duplicate:         0,
      gaps:              0,
      droppedLocal:      0,
      resyncs:           0,
      lastForeignId:     null,
      lastInvalidReason: null,   // field + rule only, never a value
    },

    sync: {
      phase:           'none',   // 'none' | 'snapshot' | 'live'
      headSeq:         0,        // the supervisor's head, as last reported
      lastSeq:         0,        // highest seq applied for the active event
      heldEventId:     null,     // what the supervisor says it holds
      serverActive:    false,
      serverLifecycle: 'idle',
      lastSnapshotAt:  0,
      lostEventId:     null,     // an event the supervisor no longer holds
      needsResync:     null,     // null | reason string
    },

    lifecycle: {
      status:   'idle',   // idle | running | completed | completed_with_failures | no_devices | failed
      complete: null,     // the event_complete payload once it arrives
    },

    // The first fatal error frame. The frame's own `fatal` flag decides —
    // no error code is assumed fatal.
    pipeline: {
      fatal:            null,
      haltedAt:         0,
      framesAfterFatal: 0,
    },

    event:         null,   // event_start payload + event_id, seq, emittedAt, receivedAt
    activeEventId: null,
    context:       null,   // latest event_context (replacement semantics)
    devices:       {},     // phone → latest device_update (full state)
    summary:       null,   // latest zone_summary (replacement, not increment)
    narratives:    {},     // zone → latest narrative_update
    errors:        [],     // error frames + id + receivedAt

    // Selecting a device and selecting a zone are mutually exclusive: the
    // details panel shows one subject at a time.
    selectedPhone: null,
    selectedZone:  null,
    region:        null,   // the operator's own location, not incident data
    batchCount:    0,      // AI batches reported by narrative_update
  }
}

export function createConsoleStore({ now = () => Date.now() } = {}) {
  const [state, setState] = createStore(initialState(now()))

  let errorSeq = 0

  // ── helpers (run inside produce) ──────────────────────────────────────────

  // Everything that belongs to one incident. Called when a different incident
  // replaces it, or when the supervisor turns out to hold nothing at all.
  function blankEvent(s) {
    s.event         = null
    s.activeEventId = null
    s.context       = null
    s.devices       = {}
    s.summary       = null
    s.narratives    = {}
    s.errors        = []
    s.selectedPhone = null
    s.selectedZone  = null
    s.batchCount    = 0
    s.lifecycle.status   = 'idle'
    s.lifecycle.complete = null
    s.pipeline.fatal            = null
    s.pipeline.haltedAt         = 0
    s.pipeline.framesAfterFatal = 0
    s.counters.foreign       = 0
    s.counters.lastForeignId = null
    s.sync.lastSeq = 0
  }

  function resync(s, reason) {
    if (!s.sync.needsResync) s.sync.needsResync = reason
  }

  // Frames for an incident this console has no event_start for. Never
  // adopted: an id alone says nothing about where the epicentre is, and a
  // board built from a guess is a board that never existed. The resync makes
  // the supervisor replay the real thing.
  function foreign(s, eventId, reason) {
    s.counters.foreign += 1
    s.counters.lastForeignId = eventId
    resync(s, reason)
    return 'foreign'
  }

  const stamp = (f) => ({ seq: f.seq, emittedAt: f.timestamp, receivedAt: now() })

  // ── control frames ────────────────────────────────────────────────────────

  function snapshotBegin(s, f) {
    const p = f.payload
    s.sync.phase           = 'snapshot'
    s.sync.headSeq         = p.head_seq
    s.sync.heldEventId     = f.event_id || null
    s.sync.serverActive    = p.active
    s.sync.serverLifecycle = p.lifecycle
    // This snapshot IS the resync; whatever asked for one is being answered.
    s.sync.needsResync     = null

    // The supervisor holds nothing, but this console still shows an incident.
    // The supervisor keeps the last event until the next one starts, so this
    // means it restarted and forgot — which no reconnect can undo. Blank the
    // board and remember the id, so the UI can say so rather than go quiet.
    if (!f.event_id && s.activeEventId) {
      const lost = s.activeEventId
      blankEvent(s)
      s.sync.lostEventId = lost
    }
    s.counters.control += 1
    return 'control'
  }

  function snapshotEnd(s, f) {
    const p = f.payload
    if (f.event_id !== (s.sync.heldEventId ?? '')) {
      resync(s, 'snapshot_end does not match snapshot_begin')
    }
    s.sync.phase          = 'live'
    s.sync.headSeq        = p.head_seq
    s.sync.lastSeq        = p.head_seq
    s.sync.lastSnapshotAt = now()

    // The snapshot promised an event but never replayed its event_start, so
    // whatever is on screen is not the incident the supervisor holds.
    if (s.sync.heldEventId && s.activeEventId !== s.sync.heldEventId) {
      resync(s, 'snapshot did not replay event_start')
    }
    // Selection survives a same-event snapshot only if its subject did.
    if (s.selectedPhone && !s.devices[s.selectedPhone]) s.selectedPhone = null
    if (!s.event) s.selectedZone = null

    s.counters.control += 1
    return 'control'
  }

  // A heartbeat is how a silent drop becomes visible: the supervisor says what
  // it holds and how far it has got, and anything this console has not seen
  // means the copy on screen is behind.
  function heartbeat(s, f) {
    const p = f.payload
    s.sync.serverActive    = p.active
    s.sync.serverLifecycle = p.lifecycle
    if (s.sync.phase !== 'snapshot') {
      s.sync.headSeq     = p.head_seq
      s.sync.heldEventId = f.event_id || null
      if (f.event_id !== (s.activeEventId ?? '')) {
        resync(s, 'heartbeat reports a different event')
      } else if (p.head_seq > s.sync.lastSeq) {
        resync(s, 'heartbeat is ahead of the last applied seq')
      }
    }
    s.counters.control += 1
    return 'control'
  }

  // ── event frames ──────────────────────────────────────────────────────────

  function eventStart(s, f, inSnapshot) {
    if (inSnapshot) {
      if (f.event_id !== s.sync.heldEventId) return foreign(s, f.event_id, 'replayed event is not the held event')
    } else if (f.event_id === s.activeEventId && f.seq <= s.sync.lastSeq) {
      s.counters.duplicate += 1
      return 'duplicate'
    }

    // A replay of the incident already on screen (a reconnect) keeps what the
    // operator was looking at; snapshot_end drops it if the device is gone.
    // A different incident takes nothing from the previous one.
    const keep = inSnapshot && f.event_id === s.activeEventId
    const phone = keep ? s.selectedPhone : null
    const zone  = keep ? s.selectedZone : null

    blankEvent(s)
    s.selectedPhone = phone
    s.selectedZone  = zone

    s.event = { ...f.payload, event_id: f.event_id, ...stamp(f) }
    s.activeEventId      = f.event_id
    s.lifecycle.status   = 'running'
    s.sync.lastSeq       = f.seq
    s.sync.lostEventId   = null
    if (!inSnapshot) {
      s.sync.heldEventId     = f.event_id
      s.sync.headSeq         = f.seq
      s.sync.serverActive    = true
      s.sync.serverLifecycle = 'running'
    }
    s.counters.accepted += 1
    return 'accepted'
  }

  const APPLY = {
    event_context(s, f) {
      s.context = { ...f.payload, ...stamp(f) }
    },

    // Full current state of one device. Every field is required on the wire,
    // so assigning over the existing entry IS a replacement — done in place
    // so a dot whose zone did not change is not repainted.
    device_update(s, f) {
      const p = f.payload
      const existing = s.devices[p.phone]
      if (existing) {
        Object.assign(existing, p, { seq: f.seq, emittedAt: f.timestamp, updatedAt: now() })
      } else {
        const t = now()
        s.devices[p.phone] = { ...p, seq: f.seq, emittedAt: f.timestamp, firstSeenAt: t, updatedAt: t }
      }
    },

    // Cumulative state computed by Go. Replaced, never added to.
    zone_summary(s, f) {
      s.summary = { ...f.payload, ...stamp(f) }
    },

    narrative_update(s, f) {
      const p = f.payload
      s.narratives[p.zone] = { ...p, ...stamp(f) }
      s.batchCount = Math.max(s.batchCount, p.batch_index + 1)
    },

    error(s, f) {
      const entry = { ...f.payload, ...stamp(f), id: ++errorSeq }
      s.errors.push(entry)
      if (entry.fatal && !s.pipeline.fatal) {
        s.pipeline.fatal    = entry
        s.pipeline.haltedAt = entry.receivedAt
      }
      if (s.errors.length > MAX_ERRORS) s.errors.splice(0, s.errors.length - MAX_ERRORS)
    },

    event_complete(s, f, inSnapshot) {
      s.lifecycle.status   = f.payload.status
      s.lifecycle.complete = { ...f.payload, ...stamp(f) }
      if (!inSnapshot) {
        s.sync.serverActive    = false
        s.sync.serverLifecycle = f.payload.status
      }
    },
  }

  function applyFrame(s, f) {
    switch (f.type) {
      case 'snapshot_begin': return snapshotBegin(s, f)
      case 'snapshot_end':   return snapshotEnd(s, f)
      case 'heartbeat':      return heartbeat(s, f)
    }

    // Inside a snapshot the supervisor replays in category order, not seq
    // order, so seq is not checked there; snapshot_end sets lastSeq.
    const inSnapshot = s.sync.phase === 'snapshot'
    if (f.type === 'event_start') return eventStart(s, f, inSnapshot)

    if (!s.activeEventId) return foreign(s, f.event_id, 'event frame without event_start')
    if (f.event_id !== s.activeEventId) return foreign(s, f.event_id, 'frame for another event')

    if (inSnapshot) {
      s.sync.lastSeq = Math.max(s.sync.lastSeq, f.seq)
    } else {
      if (f.seq <= s.sync.lastSeq) {
        s.counters.duplicate += 1
        return 'duplicate'
      }
      // Something was lost in between. The frame itself is still true, so it
      // is applied; the resync brings back whatever went missing.
      if (f.seq > s.sync.lastSeq + 1) {
        s.counters.gaps += 1
        resync(s, 'sequence gap')
      }
      s.sync.lastSeq = f.seq
      if (f.seq > s.sync.headSeq) s.sync.headSeq = f.seq
    }

    if (s.pipeline.fatal && f.type !== 'event_complete') s.pipeline.framesAfterFatal += 1
    APPLY[f.type](s, f, inSnapshot)
    s.counters.accepted += 1
    return 'accepted'
  }

  // ── actions ───────────────────────────────────────────────────────────────

  const actions = {
    /**
     * Apply one VALIDATED frame. Gating, sequencing and snapshot handling all
     * happen here, atomically.
     * @returns 'accepted' | 'control' | 'foreign' | 'duplicate'
     */
    apply(frame) {
      let status
      setState(produce((s) => { status = applyFrame(s, frame) }))
      return status
    },

    noteReceived(n = 1) {
      setState('counters', 'received', (v) => v + n)
    },

    noteInvalid(reason) {
      setState('counters', produce((c) => {
        c.invalid += 1
        c.lastInvalidReason = reason ?? null
      }))
    },

    noteDroppedLocal(n) {
      setState('counters', 'droppedLocal', (v) => v + n)
    },

    requestResync(reason) {
      setState('sync', 'needsResync', (v) => v ?? (reason || 'resync requested'))
    },

    clearResync() {
      setState('sync', 'needsResync', null)
    },

    /** The pending resync reason, or null. The socket polls this after each flush. */
    pendingResync() {
      return state.sync.needsResync
    },

    noteResync() {
      setState('counters', 'resyncs', (v) => v + 1)
    },

    // ── connection ──────────────────────────────────────────
    setStatus(status) {
      setState(produce((s) => {
        const c = s.connection
        if (c.status === status) return
        c.since = now()
        // A newly opened socket — or a newly started simulation — has
        // delivered nothing yet, whatever the previous source delivered.
        if (status === 'open' || status === 'simulation') c.framesSinceOpen = 0
        c.status = status
        // Any change of socket means this console is no longer in step with
        // the supervisor until the next snapshot says it is.
        s.sync.phase = 'none'
      }))
    },

    /** Freshness. Accepted and control frames only — see router.js. */
    countFrame() {
      setState('connection', produce((c) => {
        c.framesSinceOpen += 1
        c.lastFrameAt = now()
        c.now = c.lastFrameAt
      }))
    },

    setFps(fps) {
      setState('connection', 'fps', fps)
    },

    /** Advance the clock the staleness check reads. */
    tick(t = now()) {
      setState('connection', 'now', t)
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
      setState('errors', (errs) => errs.filter((e) => e.id !== id))
    },

    clearErrors() {
      setState('errors', [])
    },

    setRegion(region) {
      setState('region', region)
    },

    /**
     * Back to the neutral empty state: incident data, sync position, lifecycle
     * and counters. The connection and the operator's region are kept.
     *
     * Used when the console is pointed at a different supervisor — carrying
     * one supervisor's incident over would attribute it to the other. It does
     * not make a supervisor forget: if the connected one still holds an event,
     * its next heartbeat triggers a resync and the event comes back.
     */
    reset() {
      setState(produce((s) => {
        const fresh = initialState(now())
        blankEvent(s)
        s.counters = fresh.counters
        s.sync     = fresh.sync
      }))
    },
  }

  return { state, actions }
}
