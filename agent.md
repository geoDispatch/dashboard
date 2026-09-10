# agent.md — GeoDispatch Dashboard

> **Purpose of this file.** Portable context for any AI coding assistant (Claude, Cursor, Copilot, v0, Codex…).
> Paste it or keep it at the repo root. It describes the whole GeoDispatch system, the exact data
> contract the dashboard consumes, what the backend already provides, what it does **not**, and the
> frontend stack + conventions to follow.
>
> **Owner:** Ayoub — Dashboard (frontend).
> **Repo:** `git@github.com:geoDispatch/dashboard.git`
> **Language rule: SolidJS. Not React.** Every code suggestion must be idiomatic Solid — see §9.

---

## 1. What GeoDispatch is

**Autonomous crisis dispatcher for the MENA region.** Built for the MENA Ignite Hackathon on top of
Nokia's Network as Code (NaC) **CAMARA** APIs.

A seismic sensor fires an event. Within ~4 seconds the system locates every mobile device inside the
affected radius using carrier network APIs, sorts each device into a danger zone by distance from the
epicenter, asks an AI agent what to do with each one, and dispatches evacuation SMS + rescue flags in
parallel — while streaming everything live to a government operations dashboard.

```
Disaster Sensor  →  Go Supervisor  →  Python AI Agent  →  SMS + Rescue Dispatch
                         │                                        │
                   Nokia NaC CAMARA                      SolidJS Dashboard
                   (location + network)                  (live gov map)  ← YOU
```

### Pipeline, step by step

1. **Sensor** POSTs a disaster event to the Go supervisor (`POST /sensor`).
2. **Go supervisor** queries Postgres/PostGIS for every phone inside `radius_km` of the epicenter.
3. In parallel (3 goroutines): request **CAMARA QoS on Demand**, fetch the **3 nearest shelters**,
   and read **CAMARA Congestion Insights**.
4. Per device (semaphore capped at 50 concurrent): **CAMARA Location Retrieval** + **Device
   Reachability**, then **haversine** distance → zone assignment.
5. Devices are sorted by distance and cut into **batches of 20**, sent to the **Python AI agent**
   (`POST /decide`), one zone per request, red first.
6. The **AI agent** (FastAPI + Ollama) returns a per-device decision: `sms` / `rescue_flag` / `both` /
   `none`, the exact SMS text, the chosen shelter, a rescue priority, a confidence score, and a
   plain-text **government narrative** for the batch.
7. **Go** fires SMS and rescue flags in parallel and broadcasts every state change over **WebSocket**
   to the dashboard.

### Iron rules of the system (do not violate in UI logic)

- **Go calculates zones. The AI decides actions. Never reversed.** The dashboard never computes a zone.
- All timestamps are **Unix milliseconds** (`int64`).
- All phones are **E.164** (`+212XXXXXXXXX`).
- All zones are **lowercase**: `red` | `orange` | `green`.
- Rescue flagging happens in the **red zone only**.
- The `reasoning` field in AI decisions is **internal audit only — never render it to a user**.
- Phone numbers must be **masked on screen** (`+212 6** *** 678`). Never show a full number.

---

## 2. The five repositories

| Repo | Role | Stack | Owner |
|---|---|---|---|
| `supervisor` | Pipeline orchestration — CAMARA calls, zone assignment, AI batching, dispatch, WebSocket hub | Go 1.x, gorilla/websocket, Postgres+PostGIS | Ilias |
| `agent` | AI triage — receives device batches, decides actions, writes SMS + narratives | Python, FastAPI, Pydantic v2, Ollama | Yassine |
| `dashboard` | Live government map — device dots, zone counters, AI narratives | **SolidJS + Vite + Leaflet** | **Saad / Ayoub** |
| `contracts` | Locked JSON Schemas for every service boundary | JSON Schema draft-07 | shared |
| `deploy` | Docker Compose / deployment | Docker | Houssam |

All five live side by side inside `DashBoard Code/` locally.

---

## 3. Your scope (the dashboard)

A **read-only, real-time government operations console**. It consumes one WebSocket stream and renders:

- a **map** — epicenter marker, impact radius circle, one coloured dot per device
- **zone counters** — totals / reachable / rescue per zone
- the **AI situation report** — the agent's narrative per zone
- **AI decision visibility** — what the AI chose per device and why (see the gap in §6)
- **errors** — warnings and fatal alerts from any stage of the pipeline

The dashboard sends **exactly one thing**: `POST /sensor`, from the incident launcher. That is the
same request a seismic sensor makes — it asks the supervisor to consider an event, and the supervisor
decides everything that follows. Beyond that the console observes: it does not control the pipeline,
does not trigger dispatch, does not flag a rescue, and does not authenticate. The WebSocket remains
strictly server-to-client; nothing is ever sent back over it.

(Before the launcher existed this section read "the dashboard sends nothing". It was true then and is
not now, and a stale invariant in a spec is worse than none.)

### Important correction on "fetching JSON files"

The data does **not** arrive by polling JSON files or by HTTP request. It is **pushed over a
WebSocket**. The `.json` files in `contracts/examples/` are **JSON Schema definitions** — they
describe the *shape* of messages, they are not data.

What you *should* build with files: a **fixture + replay harness**. Record a real session's WebSocket
frames into a `.jsonl` file (one JSON message per line), then replay it from a tiny local script so
you can build and demo the UI without Postgres, Ollama, and the Go stack running. That is the correct
"JSON files" workflow here, and it is essential for designing screens before integration day.

---

## 4. The data contract — WebSocket

**Endpoint:** `ws://localhost:8080/ws` (supervisor `SERVER_PORT`, default `8080`)
**Direction:** server → client only. Nothing is ever sent from the dashboard.
**Schema file:** `contracts/examples/ws_update.json`
**Contract status:** **LOCKED.** `additionalProperties: false` on every payload. Adding a field is a
team-wide change that must be agreed with Ilias and Yassine first.

### Envelope — every message

```jsonc
{
  "type": "event_start" | "device_update" | "zone_summary" | "narrative_update" | "error",
  "event_id": "EQ-2024-001",   // string, groups all messages of one disaster
  "timestamp": 1700000000000,  // Unix ms — SEE WARNING IN §6, currently 0 on most types
  "payload": { /* varies by type */ }
}
```

Switch on `type`. Parse `payload` accordingly.

### 4.1 `event_start` — disaster detected

Sent once at the start. **Reset all state on this message.**

```jsonc
{
  "disaster_type": "earthquake" | "flood" | "heatwave",
  "severity": 6.8,                                    // 0–10, Richter for quakes
  "epicenter": { "latitude": 33.9716, "longitude": -6.8498 },
  "radius_km": 50.0,                                  // draw the impact circle with this
  "tsunami_risk": false,                              // true → coastal warning banner
  "aftershock_risk": "LOW" | "MEDIUM" | "HIGH"
}
```

UI: clear prior state, fly the map to the epicenter, draw the epicenter marker + radius circle,
fill the header banner.

### 4.2 `device_update` — one dot on the map

**Sent TWICE per device.** Once at triage (dot appears) and again after dispatch (dot updates).
**Key by `phone` and merge — never append to a list.** The first message always carries
`sms_sent: false` and `rescue_flag: false` because dispatch has not happened yet.

```jsonc
{
  "phone": "+212612345678",   // E.164 — MASK ON SCREEN
  "latitude": 33.9716,
  "longitude": -6.8498,
  "zone": "red" | "orange" | "green",
  "reachable": true,          // true if CONNECTED_DATA or CONNECTED_SMS
  "sms_sent": true,           // Go successfully dispatched an SMS
  "rescue_flag": false        // AI flagged this device for rescue
}
```

UI: dot colour = zone. Suggested encodings: unreachable → lower opacity; `rescue_flag` → larger
radius + thicker ring; `sms_sent` → a check state in the popup.

### 4.3 `zone_summary` — sidebar counters

Sent after each batch completes. **Cumulative**, not per-batch — replace, don't add.

```jsonc
{
  "red_total": 12, "red_reachable": 9, "red_rescue": 3,
  "orange_total": 47, "orange_reachable": 38,
  "green_total": 203, "green_reachable": 198
}
```

Note there is **no `orange_rescue` / `green_rescue`** — rescue is red-zone only by design.

### 4.4 `narrative_update` — the AI situation report

Replaces the previous narrative **for that zone**. Store as a map keyed by zone.

```jsonc
{
  "zone": "red" | "orange" | "green",
  "narrative": "Red zone: 12 devices within 5km of epicenter. 9 reachable via SMS — evacuation messages sent. 3 unreachable — rescue teams dispatched. Network congestion HIGH, QoS boost active."
}
```

Plain text, no PII, ~500 chars max. This is the AI's voice to the government official — give it real
visual weight in the layout, it is the "AI decision" the whole product is selling.

### 4.5 `error` — something failed

```jsonc
{
  "code": "CAMARA_TIMEOUT" | "AGENT_ERROR" | "SMS_FAILED" | "DB_ERROR" | "QOS_FAILED",
  "message": "CAMARA Location API timeout after 5s for device +212612345678",
  "phone": "+212612345678",   // "" or absent when not device-specific
  "fatal": false              // true → pipeline halted, show critical alert
}
```

| Code | Source | Typically fatal? | Meaning for the operator |
|---|---|---|---|
| `CAMARA_TIMEOUT` | CAMARA calls | no | one device skipped — expect these in volume, group them |
| `AGENT_ERROR` | AI agent | no (per batch) | a whole batch got no decisions |
| `SMS_FAILED` | SMS dispatch | no | delivery failed; rescue may still run |
| `DB_ERROR` | database | **yes** | cannot query shelters or log — pipeline dead |
| `QOS_FAILED` | CAMARA QoS | no | fell back to standard QoS |

**Design implication:** `CAMARA_TIMEOUT` and `SMS_FAILED` can fire dozens of times in one event.
A naive toast-per-error will bury the screen. Group by `code`, show a count, and reserve the loud
full-screen treatment for `fatal: true`.

### 4.6 Zone thresholds (computed by Go, shown by you)

| Zone | Distance from epicenter | Meaning |
|---|---|---|
| `red` | ≤ 33% of `radius_km` | critical — immediate danger |
| `orange` | 33–66% | high — evacuation recommended |
| `green` | 66–100% | moderate — alert and monitor |

### 4.7 Expected message order

```
event_start
  → device_update × N        (triage phase, streaming in as CAMARA responds)
  → device_update × N        (dispatch phase, after each AI batch)
  → zone_summary             (after each batch)
  → narrative_update         (after each batch)
  → error × M                (interleaved, any time)
```

Batches go **red → orange → green**. Do not assume strict global ordering beyond this; write the
router so any message type can arrive at any time.

---

## 5. Upstream contracts (context — you don't consume these directly)

Useful to understand what the AI actually produces, because much of it is **not** currently forwarded
to you (§6).

**`AgentRequest`** (Go → Python, `POST /decide`, one zone batch, ≤20 devices): `event_id`,
`disaster_type`, `severity`, `aftershock_risk`, `tsunami_risk`, `zone`, `batch_index`, `devices[]`
(each with `phone`, lat/lng, `location_radius_m`, `last_location_time`, `reachability_status`,
`last_status_time`, `zone`, `distance_km`), `nearest_shelters[]` (≤3: `name`, `address`, `location`,
`distance_km`, `capacity`), `network_status` (`congestion_level`, `sms_delivery_rate`, `qos_status`).

**`AgentResponse`** (Python → Go): `event_id`, `zone`, `gov_narrative`, `request_qos`, `confidence`,
and `decisions[]` where each **`DeviceDecision`** is:

```jsonc
{
  "phone": "+212612345678",
  "zone_confirmed": "red",
  "zone_escalated": false,          // AI upgraded the zone (e.g. orange→red)
  "action": "sms" | "rescue_flag" | "both" | "none",
  "sms_message": "ALERTE: Séisme détecté. Évacuez vers École Ibn Battouta (1.2km nord)…",
  "shelter_name": "École Ibn Battouta",
  "rescue_priority": 1,             // 0 = not flagged, 1 = most urgent
  "confidence": 0.87,
  "reasoning": "…"                  // AUDIT ONLY — NEVER RENDER
}
```

| Action | SMS sent | Rescue flagged |
|---|---|---|
| `sms` | ✅ | ❌ |
| `rescue_flag` | ❌ | ✅ |
| `both` | ✅ | ✅ |
| `none` | ❌ | ❌ |

---

## 6. Backend status — what exists, what's missing

### ✅ The backend EXISTS and is substantially built

- **Go supervisor** — `supervisor/cmd/supervisor/main.go`. Full pipeline implemented: CAMARA fan-out
  with a 50-slot semaphore, haversine zone assignment, distance-sorted batching, AI client, parallel
  SMS/rescue dispatch, structured console tables with per-stage timing.
- **WebSocket hub** — `supervisor/internal/dashboard/hub.go`. Working. Serves `/ws`, single-writer
  goroutine (correct for gorilla/websocket), broadcast helpers for all five message types.
- **HTTP routes** — `POST /sensor`, `GET /ws`, `GET /health` on `:8080`.
- **Python AI agent** — FastAPI (`agent/main.py`, `agent/routes/decide.py`), Pydantic v2 models that
  mirror the contract 1:1 with `extra="forbid"`, Ollama-backed, per-disaster Modelfiles + prompts,
  a real test suite (`test_e2e.py`, `test_concurrent.py`, `test_faults.py`, `validate_contract.py`).
- **Postgres + PostGIS** — migrations (`001_init.sql`, `002_events.sql`) and seed data (40 test phones
  spread across red/orange/green, MENA shelters).
- **Mock CAMARA + mock AI agent servers** in Go, containerised, so the pipeline runs with no Nokia key.
- **`docker-compose.dev.yml`** — full local stack with health checks and dependency ordering.

**Conclusion: you do not need to build a backend.** You need to consume one, and negotiate a small
number of additions.

### ⚠️ Gaps that directly affect your work — raise these with Ilias

These are real, verified in the code. Ordered by how much they hurt.

1. **No state snapshot on connect. This is the biggest one.**
   `hub.ServeWS` adds the socket to the client set and nothing else. If the dashboard connects *after*
   `event_start`, or the operator refreshes the page mid-event, **the screen stays empty until the next
   message arrives**, and `event_start` never repeats — so the map never initialises.
   **Ask for:** a snapshot pushed on connect, or `GET /events/{event_id}/state` returning the current
   device map + last summary + narratives. Without one, a page refresh during the live demo shows a
   blank screen.

2. **The AI's decision detail never reaches you.**
   `DeviceDecision` carries `rescue_priority`, `shelter_name`, `confidence`, `zone_escalated` and
   `sms_message`. The `device_update` payload carries **none of them** — only two booleans. Since your
   stated goal is *"a real-time dashboard of the AI decision"*, this is a content gap, not a nitpick.
   You currently cannot build a rescue priority queue, show shelter assignments, or display AI
   confidence.
   **Ask for:** those fields added to `device_update`, or a new `decision_update` message type.
   **`reasoning` must stay excluded** — audit only, by design.

3. **`timestamp` is `0` on almost every message.**
   `hub.go` calls `h.broadcast(..., eventID, 0)` for `device_update`, `zone_summary`,
   `narrative_update` and `error`. Only `event_start` carries a real timestamp (from the sensor input).
   **Consequence:** you cannot build a timeline, an event log with real times, or latency metrics from
   the stream. **Ask for:** `time.Now().UnixMilli()` at broadcast time. **Until then:** stamp messages
   with client-side arrival time (`Date.now()`) and label the UI "received at", not "occurred at".

4. **`zone_summary` "reachable" does not mean reachable.**
   `updateZoneSummary` in `main.go` derives it from the AI action (`sms` or `both`), not from the
   device's actual `reachability_status`. The contract says "reachable devices in zone". These diverge
   whenever the AI chooses `none` for a reachable device.
   **Also:** the summary only counts devices that received an AI decision. Devices triaged but lost to
   an `AGENT_ERROR` batch appear as dots on your map but never in the counters — **your map count will
   legitimately exceed the sidebar count.**
   **Recommendation:** compute your own counters client-side from the device map (which you already
   have, complete) and treat `zone_summary` as a server cross-check, not the source of truth. Consider
   showing both if they diverge — that divergence is itself operationally interesting.

5. **No "pipeline finished" message.**
   The pipeline prints a completion banner to stdout and broadcasts nothing. The dashboard can never
   show "event complete" or stop its spinners.
   **Ask for:** an `event_complete` type (with total duration and final counts — great demo material).
   **Until then:** infer completion from an idle timeout (e.g. no message for 10s).

6. **Messages are dropped silently under load.**
   `broadcast` uses a 512-buffered channel with a `default:` case that discards when full — deliberate,
   so the pipeline never blocks, but it means the stream is **not guaranteed complete**. Another reason
   to render defensively and never assume your device map is exhaustive.

7. **No authentication and `CheckOrigin` always returns `true`.**
   Any origin can connect. Acceptable for a hackathon; flag it in your presentation as known future
   work, since this is framed as a government system.

8. **`deploy/docker-compose.yml` includes `dashboard/docker-compose.yml`, which does not exist.**
   `docker compose up` from `deploy/` will fail today. Either add a dashboard compose service or
   remove the include. Coordinate with Houssam.

9. **Minor:** `agent/main.py`'s docstring says port 8000; the supervisor's `AGENT_URL` default and the
   contract both say **5000**. 5000 is correct.

---

## 7. Running it locally

### Full stack (real data)

```bash
cd supervisor
cp .env.example .env          # leave NOKIA_NAC_API_KEY empty → mock CAMARA is used
docker compose -f docker-compose.dev.yml up --build
```

Brings up Postgres+PostGIS (seeded), mock CAMARA on `:8081`, mock AI agent on `:5000`, supervisor on
`:8080`.

Then fire a disaster:

```bash
cd supervisor && go run ./scripts/simulation/simulate_disaster_morocco.go
```

Defaults: Casablanca epicenter `33.5731, -7.5898`, M6.2, 15 km radius, `MEDIUM` aftershock risk.
Override with `-event`, `-severity`, `-host`.

Dashboard:

```bash
cd dashboard/interface && npm install && npm run dev   # http://localhost:5173
```

### Fixture replay harness (build this first)

**Do this before any UI work.** It decouples you from Postgres + Ollama + Docker + the rest of the
team, and gives you a deterministic demo that cannot fail on stage. It also lets you develop against
backend gaps §6.1 and §6.5 *before* they're fixed.

Three small Node scripts, one dev dependency:

```bash
cd dashboard/interface
npm i -D ws
mkdir -p scripts fixtures
```

#### File format

One JSON object per line. `t` is milliseconds since the first frame (so replay can preserve real
pacing); `frame` is the untouched WebSocket message.

```jsonc
{"t":0,"frame":{"type":"event_start","event_id":"EQ-2024-001","timestamp":1700000000000,"payload":{…}}}
{"t":842,"frame":{"type":"device_update","event_id":"EQ-2024-001","timestamp":0,"payload":{…}}}
```

Extract raw contract messages any time with `jq -c '.frame' fixtures/eq-casablanca.jsonl`.

#### `scripts/record.mjs` — capture a live session

```js
// node scripts/record.mjs [wsUrl] [outFile]   — Ctrl-C to stop
import fs from 'node:fs'
import WebSocket from 'ws'

const URL = process.argv[2] ?? 'ws://localhost:8080/ws'
const OUT = process.argv[3] ?? `fixtures/session-${Date.now()}.jsonl`

fs.mkdirSync('fixtures', { recursive: true })
const out = fs.createWriteStream(OUT, { flags: 'a' })
const ws  = new WebSocket(URL)
let t0 = null, n = 0

ws.on('open', () => console.log(`recording ${URL} → ${OUT}`))
ws.on('message', (data) => {
  let frame
  try { frame = JSON.parse(data.toString()) }
  catch { return console.warn('\nskipped non-JSON frame') }
  const now = Date.now()
  t0 ??= now
  out.write(JSON.stringify({ t: now - t0, frame }) + '\n')
  process.stdout.write(`\r${++n} frames`)
})
ws.on('close', () => { out.end(); console.log(`\ndone — ${n} frames → ${OUT}`) })
ws.on('error', (e) => { console.error('\nWS error:', e.message); process.exit(1) })
process.on('SIGINT', () => ws.close())
```

Record with the full stack up (§7), then in another terminal run the simulator.

#### `scripts/replay.mjs` — serve a fixture as a WebSocket

```js
// node scripts/replay.mjs [file]     env: PORT=8090 SPEED=1 LOOP=0
import fs from 'node:fs'
import { WebSocketServer } from 'ws'

const FILE  = process.argv[2] ?? 'fixtures/eq-casablanca.jsonl'
const PORT  = Number(process.env.PORT  ?? 8090)
const SPEED = Number(process.env.SPEED ?? 1)   // 2 = 2× faster, 0 = no delays at all
const LOOP  = process.env.LOOP === '1'

const frames = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const sleep  = (ms) => new Promise(r => setTimeout(r, ms))

new WebSocketServer({ port: PORT }).on('connection', async (ws) => {
  console.log('client connected — replaying from frame 0')
  do {
    let prev = 0
    for (const { t, frame } of frames) {
      if (ws.readyState !== ws.OPEN) return
      if (SPEED > 0) await sleep(Math.max(0, (t - prev) / SPEED))
      prev = t
      ws.send(JSON.stringify(frame))
    }
    if (LOOP) await sleep(2000)
  } while (LOOP && ws.readyState === ws.OPEN)
  console.log('replay complete')
})

console.log(`ws://localhost:${PORT} — ${FILE} (${frames.length} frames) speed=${SPEED}x loop=${LOOP}`)
```

**Every client gets its own replay from frame 0.** That's deliberate: a browser refresh replays the
whole event, so you always land on a populated map during development. Do **not** let that lull you —
the real supervisor does the opposite (gap §6.1). Use `eq-midstream.jsonl` below to test the truth.

`SPEED=0` fires every frame with no delay — the fastest way to check that a burst doesn't drop
frames or thrash the map. Note `SPEED` stops scaling linearly past ~10×: `setTimeout` has a ~1 ms
floor per call, so a 1,000-frame fixture can't replay faster than ~1 s while delays are enabled.
Use `SPEED=0` for a true burst (measured: 1,051 frames in 18 ms vs 1,269 ms at `SPEED=50`).

#### `scripts/synth.mjs` — generate a large synthetic fixture

The seeded database only has 40 phones. You need thousands of dots to decide Leaflet vs MapLibre
(§10), and to see whether your store and map survive a real crowd.

```js
// node scripts/synth.mjs [deviceCount] [outFile]
import fs from 'node:fs'

const N      = Number(process.argv[2] ?? 2000)
const OUT    = process.argv[3] ?? `fixtures/synthetic-${N}.jsonl`
const EVENT  = 'EQ-SYNTH-001'
const EPI    = { latitude: 33.5731, longitude: -7.5898 }   // Casablanca
const RADIUS = 15

const lines = []
let t = 0
const push = (type, payload) =>
  lines.push(JSON.stringify({ t, frame: { type, event_id: EVENT, timestamp: 0, payload } }) + '\n')

push('event_start', {
  disaster_type: 'earthquake', severity: 6.2, epicenter: EPI,
  radius_km: RADIUS, tsunami_risk: false, aftershock_risk: 'MEDIUM',
})

// Uniform sample over the impact disc, then sort nearest-first — the supervisor
// batches by distance, which keeps batches roughly zone-homogeneous.
const devices = []
for (let i = 0; i < N; i++) {
  const a = Math.random() * 2 * Math.PI
  const r = Math.sqrt(Math.random()) * RADIUS
  devices.push({ r, dev: {
    phone: `+2126${String(10000000 + i).slice(-8)}`,
    latitude:  EPI.latitude  + (r / 111) * Math.cos(a),
    longitude: EPI.longitude + (r / (111 * Math.cos(EPI.latitude * Math.PI / 180))) * Math.sin(a),
    zone: r <= RADIUS * 0.33 ? 'red' : r <= RADIUS * 0.66 ? 'orange' : 'green',
    reachable: Math.random() > 0.15,
  }})
}
devices.sort((x, y) => x.r - y.r)

// Triage phase — dots stream in over ~4s.
devices.forEach(({ dev }, i) => {
  t = 200 + Math.round((i / N) * 4000)
  push('device_update', { ...dev, sms_sent: false, rescue_flag: false })
})

// Dispatch phase — batches of 20, summary + narrative after each.
const c = { red_total: 0, red_reachable: 0, red_rescue: 0,
            orange_total: 0, orange_reachable: 0, green_total: 0, green_reachable: 0 }

for (let i = 0; i < devices.length; i += 20) {
  const batch = devices.slice(i, i + 20).map(d => d.dev)
  t += 120
  for (const dev of batch) {
    const rescue = dev.zone === 'red' && !dev.reachable
    const sms    = dev.reachable
    push('device_update', { ...dev, sms_sent: sms, rescue_flag: rescue })
    c[`${dev.zone}_total`]++
    if (sms)    c[`${dev.zone}_reachable`]++
    if (rescue) c.red_rescue++
  }
  push('zone_summary', { ...c })
  push('narrative_update', {
    zone: batch[0].zone,
    narrative: `${batch[0].zone.toUpperCase()} zone: ${c[`${batch[0].zone}_total`]} devices processed. SYNTHETIC FIXTURE — not a real situation report.`,
  })
}

fs.mkdirSync('fixtures', { recursive: true })
fs.writeFileSync(OUT, lines.join(''))
console.log(`${lines.length} frames, ${N} devices → ${OUT}`)
```

Note it emits `timestamp: 0` on every frame except `event_start` — that faithfully reproduces backend
gap §6.3. Keep it that way until the supervisor is fixed, so your UI is built against reality.

#### The fixture set to build

| File | How to make it | What it proves |
|---|---|---|
| `eq-casablanca.jsonl` | record a normal run | happy path, real pacing, your demo tape |
| `eq-fatal-db.jsonl` | truncate + append a fatal frame | the critical alert screen |
| `eq-noisy.jsonl` | inject many `CAMARA_TIMEOUT` frames | error grouping doesn't bury the console (§4.5) |
| `eq-midstream.jsonl` | delete the leading `event_start` | **reproduces gap §6.1** — what an operator sees on refresh |
| `synthetic-2000.jsonl` | `npm run synth 2000` | map performance → settles the Leaflet vs MapLibre call |

```bash
# fatal DB_ERROR partway through
head -40 fixtures/eq-casablanca.jsonl > fixtures/eq-fatal-db.jsonl
echo '{"t":9000,"frame":{"type":"error","event_id":"EQ-2024-001","timestamp":0,"payload":{"code":"DB_ERROR","message":"shelter query failed: connection refused","phone":"","fatal":true}}}' >> fixtures/eq-fatal-db.jsonl

# a stream that starts mid-event — no event_start ever arrives
grep -v '"event_start"' fixtures/eq-casablanca.jsonl > fixtures/eq-midstream.jsonl
```

#### Wiring it into the app

Make the socket URL configurable instead of hardcoded. In `src/constants/zones.js`:

```js
export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws'
```

`package.json`:

```jsonc
"scripts": {
  "dev":         "vite",
  "dev:fixture": "VITE_WS_URL=ws://localhost:8090 vite",
  "record":      "node scripts/record.mjs",
  "replay":      "node scripts/replay.mjs",
  "synth":       "node scripts/synth.mjs"
}
```

Two terminals and you're working:

```bash
npm run replay fixtures/eq-casablanca.jsonl    # terminal 1
npm run dev:fixture                            # terminal 2
```

#### Also use fixtures as test input

Because the message router should be a pure `(state, message) => void` (§8), you can feed a whole
fixture through it in Vitest with no browser and no socket — asserting final device counts, zone
totals, and that a `fatal` error sets the right state. That is the cheapest real test coverage in
this project.

> All three scripts and both derived-fixture commands above were run and verified on Node 24:
> a 500-device synthetic fixture generates 1,051 frames that pass a full contract check (envelope
> keys, `additionalProperties: false` payloads, E.164 phones, valid zones, rescue flags red-only,
> zone totals summing to the device count), and a replay → record round-trip returns byte-identical
> frames.

---

## 8. Frontend architecture

### Current state of the code

`dashboard/interface/` is a Vite + SolidJS app: `App.jsx` (WS router + 5 signals), a
`createWebSocket` hook with 3-second reconnect, `DisasterMap.jsx` (Leaflet), `SidebarPanel.jsx`,
`EventBanner.jsx`, `ErrorToast.jsx`, and `constants/zones.js`. It works end-to-end. Treat it as a
**working prototype to rebuild against the Figma designs**, not as a foundation to preserve.

Two things in it to fix on the rewrite:
- **Props are destructured** in `SidebarPanel`, `EventBanner`, `ErrorToast` — this **breaks Solid's
  reactivity**. See §9.
- State lives in five separate `createSignal`s with object spreading on every device update
  (`setDevices(d => ({...d, [phone]: p}))`). That reallocates the whole map per device. Use a store.

### Recommended shape

```
src/
  lib/
    socket.js         one WebSocket, reconnect + backoff, connection state
    router.js         switch on msg.type → store actions (pure, unit-testable)
    store.js          createStore: event, devices{}, summary, narratives{}, errors[]
    selectors.js      derived: counts by zone, rescue queue sorted by priority, error groups
    format.js         maskPhone, formatCoords, relative time
  components/…
  screens/…
```

Principles:
- **One socket** for the whole app, created once at the root, passed down or held in a context.
- **Normalised store**: `devices` keyed by `phone`. Use `produce` to mutate in place — Solid's
  fine-grained reactivity then updates only the dots that changed, not the whole map.
- **The router is a pure function** `(state, message) => void`. That makes fixture replay trivial and
  the whole ingestion layer unit-testable without a browser.
- **Derive, don't store.** Zone counts, the rescue queue, and error groupings are `createMemo`s over
  the device map, not extra state to keep in sync.
- **Every payload field is untrusted.** The stream can drop messages and a device can appear before
  its dispatch update. Render `null`/missing gracefully everywhere — no `undefined` on screen.

---

## 9. SolidJS rules — read before writing any component

AI assistants reflexively write React. Solid looks like React and behaves nothing like it.
**A Solid component function runs exactly once.** There is no re-render, no virtual DOM, no hook rules.

| Don't (React habit) | Do (Solid) |
|---|---|
| `function C({ event, connected })` | `function C(props)` then `props.event` — **destructuring kills reactivity** |
| `useState` | `createSignal` — read by **calling**: `count()` |
| `useEffect(fn, [deps])` | `createEffect(fn)` — dependencies tracked automatically, no array |
| `useMemo` | `createMemo` |
| `items.map(...)` in JSX | `<For each={items()}>{item => …}</For>` (keyed) or `<Index>` (index-stable) |
| `cond && <X/>` / ternaries | `<Show when={cond()} fallback={…}>` |
| `switch`/nested ternaries | `<Switch><Match when={…}>` |
| `useContext` + provider re-renders | `createContext` — cheap, no re-render cost |
| `useRef` | plain `let el` + `ref={el}` |
| `class=` vs `className` | Solid uses **`class`** |
| Spread-copy nested state | `createStore` + `produce` / `reconcile` from `solid-js/store` |

More:
- Need props reactive in a helper? `splitProps(props, ["a","b"])` / `mergeProps(defaults, props)` —
  both preserve getters.
- Imperative libraries (Leaflet, MapLibre, Chart canvases) go inside `onMount`, torn down in
  `onCleanup`. Never in the component body.
- `createEffect(on(source, handler))` when you want explicit, non-inferred dependencies.
- `batch()` when applying several store writes from one WebSocket frame.
- `untrack()` to read a signal without subscribing.
- Don't reach for a state library. `createStore` + `createMemo` covers everything this app needs.

---

## 10. Library stack

Nothing here is mandatory; these are the recommended defaults with the reasoning, so an AI can pick
correctly without re-litigating each choice.

### Core (already in place)

| Need | Pick | Note |
|---|---|---|
| Framework | **solid-js** ^1.9 | already installed |
| Build | **Vite** + `vite-plugin-solid` | already installed |
| Routing (only if multi-page) | `@solidjs/router` | skip for a single console screen |

### Map — the one real decision

| Option | When to pick it |
|---|---|
| **Leaflet** (installed today) | Simplest. Raster tiles, DOM/SVG markers. Degrades noticeably past a few hundred markers. Fine if the demo is ~40 seeded devices and time is short. |
| **MapLibre GL JS** ← recommended | WebGL vector tiles, free, no API token (open fork of Mapbox GL pre-licence-change). Thousands of points at 60 fps by feeding a **GeoJSON source + circle layer** instead of per-device DOM markers. Smooth zoom/rotate/pitch, real dark basemap styling — which matters a lot for a dark ops console. |
| **deck.gl** (over MapLibre) | Add if you want the visual "wow": `ScatterplotLayer`, `HeatmapLayer`, `HexagonLayer`, `ArcLayer` (great for drawing device → shelter arcs). Heavier bundle; add only after the basics work. |
| `solid-map-gl` | SolidJS wrapper for MapLibre/Mapbox if you prefer declarative JSX over imperative `onMount`. |
| `supercluster` | Point clustering if device counts get large. |

**Recommendation:** MapLibre GL JS, driven imperatively inside `onMount`, with all devices in a single
GeoJSON source updated per frame batch. Keep Leaflet only if the schedule is tight — the current
Leaflet component already works.

### Data & state

| Need | Pick |
|---|---|
| App state | `solid-js/store` — `createStore`, `produce`, `reconcile` (built in, no dependency) |
| WebSocket | Hand-rolled (you already have one) **or** `@solid-primitives/websocket` for reconnect handling |
| Utility primitives | `@solid-primitives/*` — `scheduled` (throttle/debounce), `timer`, `storage`, `resize-observer`, `media`, `event-listener` |
| Long list virtualisation | `@tanstack/solid-virtual` — needed once the device list passes ~200 rows |
| Runtime validation of WS payloads | `valibot` (~1 kB, tree-shakeable) or `zod`. Optional, but it turns a malformed frame into a logged warning instead of a white screen mid-demo. |

### UI

| Need | Pick |
|---|---|
| Styling | **Tailwind CSS v4** (first-class Vite plugin) or plain CSS modules — the existing `App.css` is fine too |
| Accessible unstyled components | **Kobalte** (the Radix of Solid — dialog, popover, select, tabs, tooltip) |
| Drawers / resizable panels | `corvu` |
| Icons | `lucide-solid` |
| Toasts | `solid-toast` — but see §4.5, group errors before you toast them |
| Animation | `solid-motionone` (Motion One bindings), or plain CSS transitions — a dashboard rarely needs more |

### Charts (for timelines, delivery rates, latency)

| Option | When |
|---|---|
| **uPlot** | Tiny, canvas, purpose-built for streaming time-series. Best fit for a live latency/throughput strip. |
| **ECharts** | Everything-included, canvas, good dark themes. Heavier. |
| **Observable Plot** / D3 | Maximum control; more work. |
| Hand-written SVG | For sparklines and simple bars this is often less code than any library. |

### Dev / test

| Need | Pick |
|---|---|
| Unit tests | **Vitest** + `@solidjs/testing-library` |
| Fixture replay server | Node + `ws` — ~30 lines, replays `.jsonl` frames (see §7) |
| Date formatting | native `Intl.DateTimeFormat`, or `date-fns` if you need relative times |

### Deliberately not recommended

Redux / Zustand / Jotai (Solid's store makes them redundant) · React Query (no request/response
model here — it's a push stream) · Mapbox GL JS v2+ (requires a token and has licence restrictions;
MapLibre is the free fork) · any React component library (won't work).

---

## 11. Design system

### Tokens already established in `design/Main.dc.html`

```
Accent      --ac         #001DF3   (with lift #4457FF, tint #8391FF)
Red         --red        #FF2D3D
Amber       --amber      #FFA51F
Green       --green      #22D07A
Ink (bg)    --ink        #14171A
Well        --well       #0B0E11
Panel       --panel      #171B21
Raised      --raise      #1E242B
Hairline    --line       rgba(255,255,255,0.075)   --line2 rgba(255,255,255,0.14)
Text        --w70/45/26  rgba(255,255,255,0.70 / 0.45 / 0.34)

Display font   Outfit         300–800
Mono font      JetBrains Mono  400/500/700 — use `font-variant-numeric: tabular-nums` for all counters
Labels         9.5px, 600, letter-spacing 0.13em, uppercase
Panel radius   12px
```

### ⚠️ Palette conflict to resolve

The **contract and current code** specify iOS system colours — `red #FF3B30`, `orange #FF9500`,
`green #34C759` (in `ws_update.json` and `constants/zones.js`). **Your design canvas** uses
`#FF2D3D / #FFA51F / #22D07A`. Pick one and make it consistent. **Recommendation: keep your design
canvas palette** (it's tuned for the dark console) and update `constants/zones.js`; the colours in the
contract are a display hint, not a wire value, so changing them breaks nothing.

### Screens to design in Figma

The prototype is a single console. Suggested page-by-page inventory:

1. **Idle / awaiting event** — connected, no disaster. Often overlooked and the first thing a judge
   sees. Show connection health and system readiness.
2. **Live operations console** — the primary screen. Map + zone counters + AI situation report +
   error rail.
3. **Device detail** — panel or popover: masked phone, zone, distance, reachability, SMS status,
   rescue flag, assigned shelter, AI confidence. (Some fields depend on gap §6.2 being closed —
   design it anyway, it's the strongest argument for the change.)
4. **Rescue priority queue** — red-zone devices ordered by `rescue_priority`. The single most
   operationally useful view for a government official, and currently the biggest missing feature.
5. **AI situation report expanded** — the three zone narratives with history/timestamps.
6. **Error / degraded state** — grouped non-fatal errors, and the fatal full-screen alert.
7. **Reconnecting / stream lost** — what the operator sees when the socket drops.
8. **Post-event summary** — final counts, total pipeline duration. (Depends on gap §6.5.)

### The ten states

Design states, not just screens — a screen with six states is six frames. Most consoles get built
in the streaming state alone and fall apart in the other nine. Every panel needs an answer in every
row below.

| State | What causes it | Map | Counters | AI report |
|---|---|---|---|---|
| **Idle** | Connected, no event. The normal state 99% of the time. | Region view, no epicentre | Dashes, not zeros | Empty prompt |
| **Event opening** | `event_start` arrived, no devices yet. Lasts 1–3s. | Epicentre + radius ring, zero dots | `0` | Waiting |
| **Streaming** | Devices arriving. The obvious state. | Dots appearing | Climbing | Arrives at batch 1 |
| **Awaiting AI** | Triage done, agent still deciding a batch. | Dots present, none flagged | Below map count | Previous batch |
| **Quiet** | No frames for ~30s. Probably finished — unconfirmed (gap §6.5). | Static | Final values | Last narrative |
| **Degraded** | Many `CAMARA_TIMEOUT`. Devices silently missing. | Sparse — and you can't say how sparse | Undercounting | Still valid |
| **Fatal** | `DB_ERROR` or any `fatal: true`. Pipeline dead. | Frozen, visibly stale | Frozen | Frozen |
| **Reconnecting** | Socket dropped, retrying every 3s. | Last known, dimmed | Last known | Last known |
| **Joined late** | Opened after `event_start`, or refreshed mid-event. | **No epicentre, no radius, ever** | Partial | Next batch only |
| **No devices** | Event fired, zero phones in radius. | Ring, no dots | `0` | None sent |

**"Joined late" is the one to design carefully.** Because of gap §6.1 there is no state snapshot on
connect and `event_start` never repeats, so an operator who refreshes during a live event gets a
blank map that never recovers. Until the Go side sends a snapshot this is not an edge case — it is
what happens on every reload. It needs a real designed screen, not a spinner.

### Figma → code notes for the AI

- Deliver SolidJS `.jsx` (or `.tsx`) components, **never React**.
- Map Figma variables to the CSS custom properties above; never hardcode a hex that has a token.
- Dark theme is the primary. If a light theme is needed, tokenise from the start.
- The map fills its container; panels overlay or dock. Assume a 1600×1000 desktop canvas —
  this is a wall-display / desk console, **mobile is not a target**.
- Every number on screen is live-updating: use tabular numerals so digits don't jitter.

---

### Field display reference

§4 is the wire contract — what arrives. This is how to *display* it: format, a real example, and
where the data actually comes from. Tags:

- **LIVE** — already arrives on the WebSocket. Design freely.
- **DERIVE** — not sent, but computable in the browser from what is.
- **GAP** — no backend for this yet (see §6). Design it, but flag it at handoff.

**Event header**

| Field | Format | Example | Source |
|---|---|---|---|
| `event_id` | Free string | `AL-HAOUZ-01` | LIVE |
| `disaster_type` | 3 values only | `earthquake` · `flood` · `heatwave` | LIVE |
| `severity` | 0–10, one decimal | `6.8` | LIVE |
| `epicenter` | 4 decimals; lng always negative in Morocco | `31.0625, -8.4144` | LIVE |
| `radius_km` | Number, one decimal | `50.0` | LIVE |
| `aftershock_risk` | `LOW` · `MEDIUM` · `HIGH` | `HIGH` | LIVE |
| `tsunami_risk` | Boolean — banner only when true | `false` | LIVE |
| `depth_km` | Sent to the sensor, not forwarded to you | `10.5` | GAP |

**Device — map dot and list row**

| Field | Format | Example | Source |
|---|---|---|---|
| `phone` | E.164 — **mask on screen**, fixed width | `+212 6** *** 412` | LIVE |
| `zone` | Lowercase, 3 values | `red` · `orange` · `green` | LIVE |
| `reachable` | Boolean → dot opacity | `true` | LIVE |
| `sms_sent` | Boolean — always false in the triage phase | `true` | LIVE |
| `rescue_flag` | Boolean — red zone only, ever | `false` | LIVE |
| `latitude` / `longitude` | 4 decimals | `31.0891, -8.3972` | LIVE |
| `distance_km` | One decimal, 0 → radius | `2.1 km` | DERIVE (haversine) |
| `reachability_status` | `CONNECTED_DATA` · `CONNECTED_SMS` · `NOT_CONNECTED` | `NOT_CONNECTED` | GAP — only the boolean is sent |
| `location_radius_m` | GPS accuracy in metres, ~500 in cities | `±480 m` | GAP |
| `last_location_time` | ISO 8601 → show relative | `2m 14s ago` | GAP |

**Never encode zone by colour alone.** Red/green is the most common colour-blindness confusion, and
this screen decides who gets rescued. Every zone needs a second channel — dot size, ring, icon, or
the word. Same for reachable vs unreachable.

**AI decision — device detail panel**

The genuinely novel part of the product, and almost none of it reaches the dashboard yet.

| Field | Format | Example | Source |
|---|---|---|---|
| `action` | `sms` · `rescue_flag` · `both` · `none` | `rescue_flag` | DERIVE from the 2 booleans |
| `rescue_priority` | 0 = unflagged, 1 = most urgent … 10 | `1 of 10` | GAP |
| `confidence` | 0.00–1.00, always 2 decimals | `0.94` | GAP |
| `shelter_name` | Free text, can be long | `Complexe Sportif Moulay Abdellah` | GAP |
| `zone_escalated` | Boolean — AI overrode Go's zone | `false` | GAP |
| `sms_message` | ≤320 chars, French | see copy bank | GAP |
| `reasoning` | **Audit log only** | *— withheld —* | NEVER |

**Zone summary — the asymmetry matters**

Only **red** has a rescue count. Don't design three identical cards and put a placeholder in the
empty slot — that invents data. Orange and green have one fewer number by design.

| Zone | Total | Reachable | Rescue |
|---|---|---|---|
| red | 1,129 | 892 | 237 |
| orange | 2,340 | 2,106 | — none by design |
| green | 1,343 | 1,298 | — none by design |

**Network and pipeline status**

| Field | Values | Source |
|---|---|---|
| `congestion_level` | `LOW` · `MEDIUM` · `HIGH` · `CRITICAL` · `UNKNOWN` | GAP |
| `qos_status` | `inactive` · `requested` · `active` · `failed` | GAP |
| `sms_delivery_rate` | 0.0–1.0 → show as `94%` | GAP |
| Stream health | connected · reconnecting · lost · frames/sec | DERIVE |
| Dispatch latency | `3.42s` sensor → SMS — the headline claim | GAP |

### Layout breakers

Real worst-case values. Paste these into a frame before calling a panel finished.

**Longest AI narrative — the spec allows ~500 characters:**

> Red zone: 1,129 devices confirmed within 17 km of the epicentre. 892 reachable via SMS —
> evacuation messages dispatched with shelter routing to Lycée Ibn Sina (1.2 km north) and Centre
> Sportif Asni (4.6 km east). 237 devices returned NOT_CONNECTED across three consecutive polls in
> terrain flagged for collapse risk; rescue teams dispatched, 41 currently en route. Network
> congestion HIGH along the R203 corridor, QoS boost active. SMS delivery holding at 94%.

That is eight lines, not two. Decide whether the panel scrolls, clamps with a "more" affordance, or
grows and pushes the layout.

**Longest realistic locality name:** `Sidi Abdallah Ghiat` · `Talat N'Yaaqoub` · `Aït Ourir` —
Moroccan place names carry apostrophes and diacritics, transliterate inconsistently, and may need
Arabic or Tifinagh alongside. Size for 24 Latin characters and check `N'Yaaqoub` against your
truncation.

**Longest error message:** `shelter query failed: dial tcp 10.0.1.44:5432: connect: connection
refused` — error text is raw Go output, not written for humans and not length-bounded. Wrap or
scroll; never assume one line.

**Biggest counters:** `127,483` located · `98,204` reachable · `4,916` rescue flagged. A 50 km
radius over a populated region is tens of thousands of devices. Tabular numerals everywhere.

**The SMS character trap.** The contract allows 320 characters, but any accented character (é, è, à)
switches the encoding from GSM-7 to UCS-2 and drops the per-segment budget from 160 characters to
70. A French evacuation message with accents costs roughly five segments instead of two — real money
and real latency under congestion. If you design an SMS preview, show the segment count.

### Copy bank

Real strings for frames. Never lorem ipsum in an emergency console — placeholder text hides exactly
the length problems above.

**Evacuation SMS, accent-free for GSM-7:**

```
ALERTE SEISME M6.8. Evacuez immediatement vers Lycee Ibn Sina, 1.2km nord. Evitez les batiments
endommages et les lignes electriques. Ne prenez pas votre vehicule. Repliques probables - restez
a l'exterieur. Protection Civile.
```

**Empty and waiting states — statements, not apologies:**

```
No active event. Monitoring 12 regions.
Waiting for first device locations…
AI situation report arrives after the first batch.
No devices found within the impact radius.
```

**Degraded and failure states — say what broke and what it means:**

```
Stream lost. Reconnecting… last update 14s ago.
Showing the last known state — this screen is no longer live.
Pipeline halted: shelter database unreachable. Dispatch has stopped.
41 location lookups timed out. Device count may be incomplete.
```

**Operator identity and event chips:**

```
Cmdt. R. Bennani — Protection Civile · Ops
AL-HAOUZ-01 · M 6.8 · EARTHQUAKE · AFTERSHOCK HIGH
```

### Never show

Three rules from the contract, not preferences (see also §1):

- **Full phone numbers.** Always masked: `+212 6** *** 412`. This is a government screen showing the
  live location of named citizens.
- **The `reasoning` field.** The AI's chain of thought is an internal audit record — never rendered,
  never sent in an SMS. If you design a decision panel, show an explicit "withheld" row rather than
  silently omitting it.
- **A zone the dashboard computed.** Go calculates zones, the AI decides actions, the dashboard only
  displays. A design implying the operator can reassign a zone contradicts the system's core rule.

Two softer ones: no precise wall-clock time you can't source (gap §6.3), and no "complete" state the
pipeline never confirms (gap §6.5).

### Reference data

**Zone thresholds** — set by Go, never by the dashboard:

| Zone | Distance from epicentre | Meaning | Product colour |
|---|---|---|---|
| red | 0–33% of radius (0–17 km at 50 km) | Critical — immediate danger | `#FF2D3D` |
| orange | 33–66% (17–33 km) | High — evacuate | `#FFA51F` |
| green | 66–100% (33–50 km) | Moderate — alert and monitor | `#22D07A` |

**Error codes and their real severity:**

| Code | Fatal? | How often | Operator reads it as |
|---|---|---|---|
| `CAMARA_TIMEOUT` | No | Dozens per event | "Some people weren't found" |
| `SMS_FAILED` | No | Common under congestion | "This person wasn't warned" |
| `QOS_FAILED` | No | Rare | "The network boost didn't apply" |
| `AGENT_ERROR` | Per batch | Occasional | "20 people got no decision" |
| `DB_ERROR` | **Yes** | Rare | "The system has stopped" |

**Morocco's twelve regions** — for the region selector (gap §6, no backend query yet):

```
Tanger-Tétouan-Al Hoceïma · Oriental · Fès-Meknès · Rabat-Salé-Kénitra
Béni Mellal-Khénifra · Casablanca-Settat · Marrakech-Safi · Drâa-Tafilalet
Souss-Massa · Guelmim-Oued Noun · Laâyoune-Sakia El Hamra · Dakhla-Oued Ed-Dahab
```

Longest is `Laâyoune-Sakia El Hamra` at 23 characters — size the selector to it.

**Al Haouz demo scenario** — use these everywhere so the demo never contradicts itself:

| Locality | Zone | People |
|---|---|---|
| Amizmiz | orange | 1,129 |
| Asni | orange | 842 |
| Tahannaout | green | 721 |
| Talat N'Yaaqoub | red | 634 |
| Marrakech Sud | green | 622 |
| Ouirgane | red | 495 |
| Moulay Brahim | orange | 369 |
| **Total** | — | **4,812** |

These sum correctly against the zone counters above (red 1,129 · orange 2,340 · green 1,343).

**Shelters:**

| Name | Occupied | Capacity | State |
|---|---|---|---|
| Lycée Ibn Sina | 847 | 1,200 | Space available |
| Centre Sportif Asni | 612 | 800 | Filling |
| École Moulay Brahim | 450 | 450 | **Full** |

Always design one shelter at capacity — a full shelter is the operational problem the panel exists
to surface, and a panel where everything is fine teaches the operator nothing.

---

## 12. What kind of project this is — for research and learning

Search these exact terms to find prior art, patterns, and tutorials.

### Primary names

- **Common Operating Picture (COP)** — the canonical emergency-management / military term for exactly
  this: one shared real-time view of an unfolding situation. Search this first.
- **Emergency Operations Center (EOC) dashboard**
- **Real-time geospatial situational awareness dashboard**
- **Crisis / incident command dashboard**
- **Live operations console** / **mission control UI** / **NOC dashboard**

### Secondary / technical framings

- **Event-driven streaming dashboard** (WebSocket push, not request/response)
- **Real-time GIS / geospatial telemetry visualisation**
- **AI decision-support UI** and **human-in-the-loop AI observability** — the "show what the model
  decided and how confident it was" angle, which is the distinctive half of your dashboard
- **Telecom network operations dashboard** (the CAMARA/NaC side)

### Products worth studying

| Product | What to steal from it |
|---|---|
| **ESRI ArcGIS Dashboards** | The reference implementation of this genre. Indicator/gauge/list/map composition. |
| **Palantir Gotham / Foundry** | Dense dark operational UI, entity detail panels, decision provenance. |
| **Flightradar24 · MarineTraffic** | Thousands of live moving dots on a map without dropping frames. |
| **Grafana · Kibana · Datadog** | Panel layout, alert grouping, time-range controls, dark-mode density. |
| **Everbridge · RapidSOS · Rave Mobile Safety** | Commercial mass-notification and 911 dispatch — your closest direct competitors. |
| **NASA / SpaceX mission control** | Status semantics: nominal / caution / critical, and how to show them calmly. |
| **deck.gl examples gallery** | Scatterplot, hexagon, arc and heatmap layers over a basemap. |
| **Uber / Lyft ops dashboards** (conference talks) | Real-world engineering of live geospatial dashboards at scale. |

### Concepts to learn (roughly in order of payoff here)

1. **WebSocket lifecycle** — reconnect with exponential backoff, heartbeat/ping, and why a
   **state snapshot on reconnect** is non-negotiable (gap §6.1 is a textbook example).
2. **Web Mercator, tile servers, GeoJSON, haversine** — enough to reason about what Go is computing.
3. **WebGL map rendering** — why a GeoJSON source + circle layer beats N DOM markers.
4. **Fine-grained reactivity** (Solid's signals) vs virtual DOM diffing (React) — the actual reason
   this project chose Solid.
5. **Backpressure and lossy streams** — bounded channels, dropped messages, rendering defensively
   against an incomplete stream.
6. **Information design for operations**: preattentive attributes, colour-blind-safe encoding (do
   **not** rely on red/green alone — add shape, size, or a label), alarm fatigue, and the
   Ironies of Automation problem (operators must be able to see *why* the AI decided something).
7. **Accessibility in dark, dense UIs** — contrast ratios, focus rings, and not encoding meaning
   in colour alone.

---

## 13. Open decisions

| Decision | Options | Recommendation |
|---|---|---|
| Map library | Leaflet (installed) / MapLibre GL / + deck.gl | **MapLibre GL**; keep Leaflet if time is short |
| Zone palette | contract iOS colours / design-canvas colours | **design-canvas colours**, update `constants/zones.js` |
| Counter source of truth | server `zone_summary` / client-derived | **client-derived** from the device map; show `zone_summary` as cross-check |
| TypeScript | plain `.jsx` (current) / migrate to `.tsx` | **TypeScript** if time allows — five message shapes and ~20 payload fields is exactly where it pays for itself |
| Message timestamps | server `timestamp` / client arrival time | **client arrival time** until gap §6.3 is fixed; label it "received" |

## 14. Asks for the backend team — copy/paste for Ilias

1. Snapshot on WebSocket connect (or `GET /events/{id}/state`) so a page refresh mid-event recovers.
2. Real `time.Now().UnixMilli()` on every broadcast, not `0`.
3. AI decision detail in `device_update` (or a new `decision_update`): `rescue_priority`,
   `shelter_name`, `confidence`, `zone_escalated`. **Not `reasoning`.**
4. An `event_complete` message with final counts and total duration.
5. Confirm whether `zone_summary`'s `*_reachable` should mean *network-reachable* or *SMS-decided* —
   the code and the contract currently disagree.
6. Add or remove the missing `dashboard/docker-compose.yml` referenced by `deploy/docker-compose.yml`.
