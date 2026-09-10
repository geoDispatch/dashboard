# Components, and the provenance of every value on screen

SolidJS, not React. Props are read (`props.x`), never destructured; component
bodies run once; lists go through `<For>` and branches through `<Show>`.

> **Naming trap.** Never name a component `Show`, `For`, `Index`, `Switch`,
> `Match`, `Dynamic`, `Portal`, `Suspense` or `ErrorBoundary`. The Solid
> compiler claims those element names and will silently replace your component
> with its own control flow at build time. This cost real debugging time — a
> toggle named `Switch` compiled into `solid-js`'s `<Switch>`, which then threw
> from inside the framework. The toggle is called `Toggle`.

---

## Provenance key

Every value the console displays is one of four things, and the UI says which:

| Tag | Meaning |
|---|---|
| **LIVE** | Arrived on the WebSocket. |
| **DERIVED** | Computed in the browser from LIVE data. |
| **DEMO** | From the bundled Al Haouz scenario. Labelled as demonstration data on screen. |
| **UNAVAILABLE** | The supervisor does not send it. Rendered `—` with the reason. Never estimated. |

---

## Shell

| File | Role |
|---|---|
| `App.jsx` | Store, stream, settings context, view routing, overlays. |
| `TopBar.jsx` | Location, search, **Launch incident**, notifications bell, account. |
| `NavRail.jsx` | Icon rail. Utility tiles open Settings. |
| `MapToolbar.jsx` | Stream chip, layer toggles, fullscreen, export. |

### TopBar

| Value | Provenance |
|---|---|
| Search results | DERIVED — masked phone, zone word, nearest locality, coordinates |
| Notification badge count | LIVE — `state.errors.length` |
| Operator name / badge | Local settings, this browser only. No account service exists. |

There is no *Sign in* and no *Get started*: reaching this console means being
on a station that already has an account, so the corner names the station
rather than offering a way in.

### MapToolbar

The stream chip is `streamChip(phase, source)` from `lib/streamState.js` and
nothing else. Coloured by **tone**, not by socket state, so `stalled` can look
wrong. See `docs/WEBSOCKET.md` §1.

---

## Map

`DisasterMap.jsx` — Leaflet, canvas-rendered.

| Value | Provenance |
|---|---|
| Device dots (position, zone) | LIVE |
| Hollow dot = unreachable, ring = rescue flag | LIVE — zone is never colour alone |
| Three concentric bands at 0.33 / 0.66 / 1.00 × `radius_km` | LIVE radius, DERIVED thresholds |
| Epicentre marker | LIVE |
| Shelter markers | DEMO — plotted only where the name resolves to a known locality |
| Basemap | Esri, keyless. **Not CARTO**: those URLs return HTTP 200 with an "API KEY REQUIRED" watermark baked into the tile. |
| Scale bar units | Local setting |

Bands stack, so the fills are chosen for the composite: ~6 % at the rim, ~15 %
in the middle band, ~28 % over the epicentre. Zone selection is an **edge** hit
within a few pixels of a circumference — the interiors are non-interactive so
they cannot steal a click meant for a dot.

---

## Panels

| File | Shows |
|---|---|
| `DeviceDetails.jsx` | One device: masked phone, zone, reachability, SMS, rescue, distance, coordinates |
| `ZoneDetails.jsx` | One band: counts, distance band, narrative |
| `OpsPanels.jsx` | Rescue queue, devices by area, shelters, errors |
| `IncidentDetailsPage.jsx` | Full-page: facts, counters, zones, triage table, shelters, network |
| `NetworkTelemetryDrawer.jsx` | Carrier faults by code, recent warnings, reachability split |
| `SettingsModal.jsx` | Station, basemap, alerts, stream, region |
| `IncidentLauncherModal.jsx` | The only control that writes |

### Device fields

| Field | Provenance |
|---|---|
| `phone` | LIVE — **always** through `maskPhone()`. Never rendered unmasked, anywhere. |
| `latitude` / `longitude` | LIVE |
| `zone` | LIVE — Go computes it; the dashboard never does |
| `reachable` | LIVE |
| `sms_sent`, `rescue_flag` | LIVE |
| AI action (`sms` / `rescue` / `both` / `none`) | DERIVED from the two booleans |
| Distance from epicentre | DERIVED — haversine, mirroring the supervisor's |
| Nearest locality | DERIVED — nearest known centroid. Reverse geocoding is UNAVAILABLE. |
| `shelter_name`, `rescue_priority`, `confidence` | **DEMO only.** The live contract carries none of them; against a supervisor they read `—` with a note saying so. |
| `sms_message`, `location_radius_m`, `reachability_status` | UNAVAILABLE |
| `reasoning` | **Never rendered.** Audit-only by contract. |

### Rescue flags are not red-zone-only

The AI decides which devices are flagged and can escalate a zone, so an
orange-zone device can carry `rescue_flag: true`. The console shows the flag it
was sent and does not infer one from the band. Wording that claimed otherwise
has been corrected in the rescue queue, the incident page and the telemetry
drawer.

### Error codes, worded carefully

| Code | What the UI says |
|---|---|
| `CAMARA_TIMEOUT` | "A location or reachability call did not answer in time. Those devices may be missing from the map, **or on it with incomplete detail**." Two calls are made per device; a timeout on the reachability one still leaves the device placed and marked unreachable. |
| `SMS_FAILED` | "The send failed. Which stage failed is not visible." The console cannot tell a refusal at submission from a gateway that accepted and dropped it, so it does not pick one. |
| `QOS_FAILED` | Boost not granted; dispatch continued at standard priority. |
| `AGENT_ERROR` | A batch of up to twenty devices got no decision. |
| `DB_ERROR` | Fatal. Halts the pipeline; see `docs/WEBSOCKET.md` §3. |

### Shelters

**All DEMO.** Names, capacities and occupancy come from the bundled scenario —
the supervisor publishes no shelters at all. Both panels label this in full.
"Routed by the AI" (devices pointed at a shelter this run) is a separate,
also-demo number and is never added to the occupancy figure.

### Network telemetry

| Value | Provenance |
|---|---|
| Fault counts by code | LIVE |
| Recent warnings — time, masked phone, message | LIVE payload, **client arrival time** |
| Reachable / unreachable split | DERIVED |
| Congestion level, QoS state, SMS delivery rate | UNAVAILABLE — `—` with the reason |

---

## Settings and the launcher

Settings persist to `localStorage` behind a validator; an unknown value falls
back to its default rather than reaching the UI. `privacyMasked` is **pinned
on** and cannot be flipped from the UI or from hand-edited storage: the
authorised-full-view control is rendered, explained and gated, because no
credential service is connected and a switch that grants itself authorisation
is not authorisation.

The launcher is the only writer. Presets are Al Haouz and Casablanca; Custom
adds disaster type and aftershock risk, without which "custom" would silently
default. See `docs/WEBSOCKET.md` §4.

---

## Tests

`npm test` — Vitest, node environment, no DOM.

| File | Covers |
|---|---|
| `lib/ingest.test.js` | All five frame types, merge-by-phone, exact value fidelity, `event_id` isolation, late join, fatal handling |
| `lib/streamState.test.js` | Phase machine, 30 s staleness boundary, wording, transport vs pipeline |
| `lib/socket.test.js` | One socket, one timer, detached teardown, sticky manual demo, automatic fallback |
| `lib/launch.test.js` | `depth_km` per type, stable event id, verbatim POST, non-2xx rejection |

`vitest.config.js` pins solid-js to its **browser** build and inlines it.
Without both, node's `node` export condition resolves the SSR stub, where
`createMemo` never recomputes — every derivation test would pass against stale
values and prove the opposite of what it claims.
