# The stream

How the dashboard consumes the supervisor, what it does with each frame, and
the four things it deliberately refuses to do.

The wire contract itself is **locked** and lives in `contracts/`. Nothing here
proposes changing it. This document describes the client side of it.

---

## 1. Transport

| | |
|---|---|
| Endpoint | `ws://localhost:8080/ws` by default, configurable in Settings → Stream |
| Direction | **Server → client only.** The dashboard never sends over the socket. |
| Implementation | `src/lib/socket.js` |
| Reconnect | 1s, 2s, 4s, 8s, capped at 15s |

### Lifecycle invariants

These are enforced in code and covered by `src/lib/socket.test.js`.

- **One socket.** `connect()` returns immediately if a socket is already
  `CONNECTING` or `OPEN`.
- **One reconnect timer.** Every retry goes through `scheduleReconnect()`,
  which clears the previous timer before setting a new one.
- **Handlers are detached before close.** A superseded socket has its
  `onopen` / `onmessage` / `onclose` / `onerror` set to `null` before
  `close()`, so a dying socket can never schedule work for the one replacing
  it. Every handler also re-checks that it is still the current socket.
- **Manual demo is sticky.** Choosing the bundled demo sets `manualDemo`,
  closes the socket detached, and blocks `connect()` and
  `scheduleReconnect()`. Nothing returns the console to the supervisor except
  the operator choosing it.
- **The automatic fallback is not sticky.** If the supervisor never answers,
  the console falls back to the demo *without* setting `manualDemo`, keeps
  retrying underneath, and returns to the supervisor the moment one appears.

### An open socket is not a live stream

`src/lib/streamState.js` derives a **phase** from the transport, and it is the
only thing allowed to describe the stream:

| Phase | Meaning |
|---|---|
| `connecting` | opening the socket |
| `waiting` | socket open, **not one frame has arrived on it** |
| `receiving` | frames arriving, most recent within 30 s |
| `stalled` | socket open, nothing for ≥ 30 s — the board is frozen |
| `reconnecting` | dropped, retrying with backoff |
| `lost` | retried past the point of pretending |

`framesSinceOpen` resets on every open, so a reconnect that delivers nothing
reads as `waiting` rather than inheriting the previous socket's freshness.
`connection.now` is ticked every 500 ms, which is what lets `stalled` be
reached at all — with no frames arriving, nothing else would re-run the check.

### Source, and what cannot be known about it

Separate from the phase:

| Source | Meaning |
|---|---|
| `demo` | **Bundled browser demo.** Frames generated in this tab by `src/lib/mockStream.js`. No supervisor is involved. |
| `supervisor` | **Connected supervisor.** Frames arriving from the configured endpoint. |

The console can see that a socket is open to something speaking the contract.
It **cannot** see whether that supervisor is reading Nokia CAMARA or its own
bundled Go mocks, and it has no way to find out. Every place the source is
named says so: *"Connected supervisor — upstream source unverified."* The word
"live" appears nowhere in stream wording, and a test asserts that.

---

## 2. Frames

### Envelope

```jsonc
{ "type": "...", "event_id": "AL-HAOUZ-01", "timestamp": 0, "payload": { } }
```

`src/lib/router.js` is a pure `(actions, message) => result`. It validates the
shape, hands the payload **and `event_id`** to a store action, and touches
nothing else — so a fixture replays through the identical path a socket does.

| `type` | Store action | Notes |
|---|---|---|
| `event_start` | `eventStart` | Rejected without `payload.epicenter`. Clears all prior state. |
| `device_update` | `deviceUpdate` | Rejected without `payload.phone`. Merged by phone. |
| `zone_summary` | `zoneSummary` | Replaces; cumulative on the server side. |
| `narrative_update` | `narrative` | Replaces that zone's narrative. |
| `error` | `error` | Appended, capped at 200. |

Anything else returns `{ ok: false, reason }` and is logged, never applied.

### Incidents never merge

The supervisor sends no snapshot on connect and supports no replay, so the
console can legitimately be handed frames from two incidents seconds apart.
`src/lib/store.js` gates every non-`event_start` frame on `event_id`:

| Situation | Behaviour |
|---|---|
| No active incident, frame carries an id | Adopt the id, set `joinedLate`. **No event object is invented** — an id is known, an epicentre is not. |
| Frame id matches | Accept. |
| Frame id differs | **Drop**, increment `dropped.foreign`, record `dropped.lastId`. A banner tells the operator it happened. |
| Frame carries no id | Accept. The contract says every envelope has one, so an empty one is a supervisor bug, not evidence of a second incident. |
| `event_start` | Never gated. A new incident legitimately replaces the board. |

### Late join

Because there is no snapshot, an operator who reloads mid-event sees devices
arrive with no epicentre, no radius and no rings. That is shown as what it is
— `joinedLate` — and **nothing is fabricated to fill the gap**. There is no
replay request to make and the console does not pretend otherwise.

---

## 3. Pipeline health is not connection health

A fatal `DB_ERROR` kills the supervisor's pipeline and leaves the WebSocket
wide open. The two are tracked separately:

- `state.connection` — the transport.
- `state.pipeline` — `fatal`, `haltedAt`, `framesAfterFatal`.

**Later frames are still applied.** The console cannot know that the
supervisor has stopped sending, and discarding data it is still being handed
would be a second failure on top of the first. The banner therefore says what
was reported, that dispatch has stopped *at the supervisor*, and how many
frames have arrived since — and offers the two recoveries that actually exist:

- **Reconnect** — new socket, board untouched.
- **Clear incident** — board emptied, waits for the next `event_start`.

There is no third option. Nothing here can offer to "resume".

---

## 4. `POST /sensor` — the one thing the console sends

The incident launcher (`src/components/IncidentLauncherModal.jsx`) POSTs a
`SensorInput`, exactly as a seismic sensor would. `src/lib/launch.js` builds it
and is separately tested.

- `depth_km` is **10.5** for `earthquake` and **0** for `flood` and
  `heatwave`. It used to default to 10.5 for everything, which wrote a
  plausible hypocentre depth into events that have no hypocentre.
- One `event_id` per launch attempt, stamped once and reused for the payload,
  the request and the confirmation.
- **Success is a 2xx and nothing else.** `triggerEvent` throws on any other
  status, so the confirmation cannot appear for a request that was merely
  sent.

### CORS — a real blocker, not a frontend bug

The supervisor sets no `Access-Control-Allow-Origin` on any route and has no
`OPTIONS` handler (`cmd/supervisor/main.go`). A JSON POST from `:5173` to
`:8080` is preflighted, the preflight is refused, and `fetch` throws before the
POST happens. The failure looks identical to the supervisor being down.

**Development:** `vite.config.js` proxies `/sensor` and `/health` to
`http://localhost:8080`, so the request is same-origin and CORS never applies.
`src/lib/endpoints.js` uses the relative path **only** when the configured
endpoint is the same origin the proxy forwards to — point the console at a
staging supervisor and it goes back to the absolute URL, because a relative
path would have quietly sent the incident to the wrong host.

**Production: this is not solved.** `server.proxy` is a dev-server feature;
`vite build` output has no proxy. A deployed dashboard on a different origin
from the supervisor needs one of:

1. CORS support on the Go supervisor, or
2. a same-origin reverse proxy in front of both.

Both are backend/DevOps work. The frontend cannot fix it.

---

## 5. Known gaps in the contract

Not defects in this dashboard — things the supervisor does not send.

| Gap | Consequence here |
|---|---|
| No state snapshot on connect | A reload mid-event shows a late join, permanently. |
| `timestamp` is `0` on all but `event_start` | Every time shown is **client arrival time** and is labelled "received", never "occurred". |
| No `event_complete` | The console never claims an incident finished. `stalled` is as far as it goes. |
| Frames dropped under load (512-buffer, `default:` discard) | The device map is never assumed exhaustive. |
| `zone_summary.reachable` derived from the AI action | Client-side counts are the source of truth; the server summary is a cross-check. |
| No congestion / QoS / delivery rate | Rendered as `—` with the reason, never estimated. |
| No auth, `CheckOrigin` returns `true` | Flagged as future work. |
