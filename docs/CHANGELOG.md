# Changelog

Dashboard only. The supervisor, agent, contracts and deploy repositories are
untouched by everything below.

---

## Unreleased — the map ground is vector (Leaflet + MapLibre)

- **Leaflet stays; the ground under it is now MapLibre GL.** The dark, light
  and streets basemaps are OpenFreeMap vector styles (`dark`, `positron`,
  `liberty`) drawn inside a Leaflet layer by `@maplibre/maplibre-gl-leaflet`.
  Leaflet still owns the view, the controls, the device canvas, the zone rings
  and hit-testing, so nothing about selecting a dot or a band changed.
  Satellite stays Esri raster imagery.
- **Instant start, vector once it loads.** MapLibre (1.06 MB, 283 KB gzipped)
  is a separate chunk fetched with a dynamic import after the console has
  mounted; the main bundle is unchanged in weight. The ground fades in under
  what is already on screen.
- **Strictly 2D.** MapLibre 6 ships pre-bundled, so a bundler cannot tree-shake
  its globe or terrain code out; instead `lib/mapStyle.js` strips `projection`,
  `terrain`, `sky` and fill-extrusion layers from every style, and the GL map is
  non-interactive with pitch locked at 0.
- **Themes without a filter.** The dark canvas is recoloured in its style JSON
  — graphite (land #383B41, darker sea) in Light and Dark, navy (land #16265A,
  sea #091234) in Dark blue — instead of a CSS filter re-applied to a WebGL
  canvas every frame. Switching theme, or between vector grounds, restyles the
  live GL map with a style diff: every OpenFreeMap style reads the same tile
  source, so no tile is re-fetched.
- **The worker ships.** MapLibre 6 builds its worker's URL at runtime, which a
  bundler cannot see, so the file was never emitted and every tile would have
  failed. The worker is now bundled explicitly (`?worker&url`) and handed to
  `setWorkerUrl`.
- **Never an empty ground.** Every vector basemap keeps its Esri raster twin as
  a fallback: no WebGL 2, a failed chunk, or an unreachable style host draws
  the raster map (and, in Dark blue, the old filter tint) with one console
  warning. Verified by simulating each failure.
- **Previews are real.** Settings renders each vector basemap off-screen in the
  current theme and shows the image — what you pick is what you get. A preview
  falls back to the raster tile only when the live map would too.
- Vector grounds zoom to 19 (the raster grey canvases stopped at 16).
- Credit: "OpenFreeMap © OpenMapTiles, Data from OpenStreetMap", swapped
  cleanly with Esri's when the ground changes.
- New dependencies: `maplibre-gl` ^6.9.0, `@maplibre/maplibre-gl-leaflet`
  ^0.1.4.
- Tests: `lib/mapStyle.test.js` — colour parsing (every form the real styles
  use), the graphite and navy remaps, expression walking, the 2D strip, water
  pinning, and the basemap definitions.

## Unreleased — logo rebuilt as SVG, and three themes

### Logo

- Rebuilt from the PNG as pure vector in `design/logo/`, with a build script
  (`build_logo.py`) that regenerates every file from one set of numbers.
- **The mark is the product's zone model.** The three ring edges sit at
  exactly 33%, 66% and 100% of the radius — the red, orange and green
  thresholds the supervisor uses.
- **One stroke weight.** Every ring is drawn at the wordmark's stem width, so
  mark and type read as one object.
- **Aligned like a letter.** The circle overshoots the cap height by the same
  1.7% the O, G, S and C do, so it is optically the height of the two-line
  wordmark. The old in-app lockup was a third taller than its text.
- **The person is back** (the in-app version had lost it), redrawn as a bust
  in a porthole with a neck gap wide enough to survive at header size.
- **One colour, real knockouts, `currentColor`.** The same file is black on
  the light bar and white on the dark one; the gaps are genuinely empty, not
  painted white.
- **A small optical size** for the favicon, with the person removed — at 16px
  it is a blot — and slightly heavier rings.
- **The favicon was Vite's default purple lightning bolt.** It is now the
  mark, white on a `#001DF3` tile.

### Themes — Light, Dark, Dark blue

- **Same console, different colours.** No size, spacing, radius or layout
  token changes between themes. Only colours are redefined, keyed on
  `data-theme="light|dark|dark-blue"` on `<html>`.
- **Light** is unchanged and still the default.
- **Dark** is regular dark from edge to edge: the top bar, the left rail and
  the shell behind them are graphite `#0F1218`, a step darker than the
  `#161A23` cards; the map is Esri's dark grey canvas, untinted. The active
  rail tile is a blue tint, Launch incident inverts to a light button, counts
  stay red pills.
- **Dark blue** turns the top bar, the left rail and the shell into one
  `#001DF3` frame (the map's rounded corner is cut out of one continuous L of
  blue), with navy cards (`#0D1848`), a navy page behind them, lavender quiet
  inks, and the dark grey canvas tinted navy by a CSS filter on its tile
  panes only — device dots, zone rings and markers keep their exact colours,
  and satellite and streets are never tinted. On the blue: white text
  (8.5:1), fields at 12% white, the active rail tile inverts to white with a
  blue glyph, and counts become white pills with red figures.
- **Picked in Settings → Display, and only there** — GitHub's appearance
  picker: each theme is a card with a live miniature of the console drawn with
  that theme's real tokens (every theme block is keyed on a bare
  `[data-theme]`, so a preview can carry its own), a radio and the name.
  *Theme mode* is *Single theme* or *Sync with system*; in Sync, Light is the
  day theme and the operator picks the night theme (Dark or Dark blue), and
  the card on screen is marked *Active*. There is no top-bar toggle.
- Moving between Light and a dark theme switches the grey basemap to match;
  satellite and streets are never touched. The basemap preview for the dark
  canvas carries the same tint as the live map.
- Zone fills step back on the dark basemaps, where the light-mode tints
  composited into a muddy brown. Status WORDS use lifted tints
  (`--gd-red-text`, `ZONE_TEXT`) on the dark cards; dots keep the true hues.
- Three tokens were being referenced without ever being defined
  (`--gd-field-strong`, `--gd-amber-ink`, `--gd-red-ink`). They fell back to
  dark literals in every theme and would have been unreadable on graphite.
- Settings: `theme` accepts `light | dark | dark-blue | system`; new
  `nightTheme` (`dark | dark-blue`, default `dark`) is what Sync paints at
  night. Picking a dark theme also makes it the night theme.
- Tests: `lib/theme.test.js` — the theme lists, `isDarkTheme`, resolution
  including the night theme, basemap following for both darks, `applyTheme`,
  and both validators.

## Unreleased — stream lifecycle, incident isolation, honest wording, tests

The theme is the same throughout: **the console was claiming things it could
not know.** Each item below is a claim that has been either made true or
withdrawn.

### Fixed — WebSocket and demo lifecycle

- **Manual demo no longer drifts back to the supervisor.** Choosing the demo
  used to close the socket and leave its `onclose` attached, which scheduled a
  reconnect; one backoff interval later the console silently returned to the
  supervisor the operator had just left. The demo now sets `manualDemo`, which
  blocks both `connect()` and `scheduleReconnect()`.
- **One socket.** `connect()` returns immediately if one is already
  `CONNECTING` or `OPEN`. `useSupervisor()` used to call it straight into a
  live socket, leaving two.
- **One reconnect timer.** Every retry clears the previous timer first, so a
  double-schedule is impossible rather than merely unlikely.
- **No ghost closes.** Handlers are detached before `close()`, and each handler
  re-checks it is still the current socket, so a dying socket cannot schedule
  work for its replacement.
- **Cleanup is complete** — socket, reconnect timer, demo timer, fps interval,
  animation frame, fallback timer and the pending frame queue.
- **The automatic fallback stays automatic.** An unreachable supervisor still
  falls back to the demo, without setting `manualDemo`, and returns on its own
  when a supervisor appears.

### Fixed — "Stream live" was not a fact

An open socket is not a live stream: a supervisor that crashes mid-event holds
the connection open with nothing behind it, and the console showed a green
"Stream live" pill over a frozen board.

- New `src/lib/streamState.js` derives a phase — `connecting`, `waiting`,
  `receiving`, `stalled`, `reconnecting`, `lost` — from `lastFrameAt` with a
  30 s staleness timeout.
- `framesSinceOpen` resets on every open, so a reconnect that delivers nothing
  reads as `waiting` instead of inheriting the old socket's freshness.
- `connection.now` is ticked every 500 ms; without it `stalled` was
  unreachable, because with no frames arriving nothing re-ran the check.
- The toolbar pill is coloured by **tone**, not by socket state, so a stalled
  stream can look wrong.

### Fixed — incidents could merge

The supervisor sends no snapshot on connect and no replay, so frames from two
incidents can arrive seconds apart.

- The store tracks `activeEventId` and gates every `device_update`,
  `zone_summary`, `narrative_update` and `error` on it.
- Frames from another incident are **dropped and counted**, and a banner says
  so. A silent drop and a merge are both lies; a counted drop is a fact.
- A device frame arriving before `event_start` adopts the id and sets
  `joinedLate`. **No event object is invented** — an id is known, an epicentre
  is not — and no snapshot or replay is faked, because the backend has neither.

### Fixed — fatal errors

- Pipeline health moved out of `state.fatal` into `state.pipeline`, separate
  from `state.connection`. A halted pipeline on a healthy socket is a real
  state and was previously unsayable.
- The banner no longer claims "this console is no longer receiving updates",
  which it had no way to know. **Later frames are still applied** — and
  counted — and the banner reports that.
- Two explicit recoveries: **Reconnect** (new socket, board untouched) and
  **Clear incident** (board emptied). There is no third; nothing can offer to
  "resume".
- The toolbar no longer reports `lost` on a fatal error, which put a socket
  problem's wording on a pipeline problem.

### Fixed — incident launcher

- `depth_km` is **10.5** for earthquakes and **0** for floods and heatwaves.
  It defaulted to 10.5 for everything, writing a plausible hypocentre depth
  into events that have no hypocentre.
- One `event_id` per launch attempt, stamped once and reused throughout.
- Payload construction moved to `src/lib/launch.js` — pure, and tested against
  the exact bytes.
- Success requires a 2xx. `triggerEvent` throws on anything else, including
  the status code in the message.
- Validation unchanged: latitude, longitude, radius and severity are still
  range-checked and the button stays disabled until they pass.

### Fixed — misleading copy

- **Rescue flags are not red-zone-only.** The AI can escalate a zone and flag
  an orange-zone device; the console shows the flag it was sent. Corrected in
  the rescue queue, the incident page, the telemetry drawer and the selectors.
- **`CAMARA_TIMEOUT` no longer says the device "was never placed."** Two
  CAMARA calls are made per device, and a timeout on the reachability one
  leaves the device on the map, marked unreachable.
- **`SMS_FAILED` no longer says the gateway "accepted and then dropped it."**
  The console cannot tell that from a refusal at submission and does not pick
  one.
- **"Live supervisor" is gone.** Replaced with "Connected supervisor —
  upstream source unverified": the console can see a socket is open to
  something speaking the contract, not whether that something is reading Nokia
  CAMARA or its own mocks. A test asserts the word "live" never appears in
  stream wording.
- Bundled demo, connected supervisor and unverified upstream are now three
  distinct, separately worded ideas.
- Shelters, occupancy and "routed by the AI" are labelled **DEMONSTRATION
  DATA** in full, everywhere they appear.

### Added — tests

`npm test`. Vitest, node environment, 46 tests, no DOM, under a second.

Covers every frame type; two updates to one phone; wrong, missing and delayed
`event_id`; manual demo and reconnection; stale detection at the 30 s
boundary; fatal errors and later frames; launcher payloads for all three
disaster types; and that incoming latitude, longitude, zone, reachability, SMS
and rescue values reach the store exactly as sent with nothing invented
alongside them.

`vitest.config.js` pins solid-js to its browser build and inlines it —
node's `node` export condition resolves an SSR stub where `createMemo` never
recomputes, which would have made every derivation test pass against stale
values.

### Added — development CORS proxy

`vite.config.js` proxies `/sensor` and `/health` to `http://localhost:8080`.
`src/lib/endpoints.js` uses the relative path **only** when the configured
endpoint is the origin the proxy forwards to, so pointing the console at a
staging supervisor does not quietly send the incident to localhost.

**This does not solve production.** `server.proxy` is a dev-server feature and
`vite build` output has no proxy. A deployed dashboard on a different origin
needs CORS on the supervisor or a same-origin reverse proxy. Backend/DevOps.

### Changed — docs

`docs/WEBSOCKET.md`, `docs/COMPONENTS.md` and `interface/README.md` written
from empty or from Vite boilerplate. Every displayed value is now documented as
live, derived, demo, or unavailable. `agent.md` §3's "the dashboard sends
nothing" is corrected — the launcher POSTs `/sensor`.

---

## Earlier (`6126742` and before)

| Commit | |
|---|---|
| `6126742` | Operator settings (station, basemap, alerts, stream, region), incident launcher, network telemetry drawer, account control replacing Sign in / Get started |
| `3ef1a06` | One icon set |
| `6623e2f` | Zone selection by ring edge |
| `538aed6` | Logo and icon fixes |
| `89d5a88` | Zone details, notifications at the bell, usable overlay |
| `3cf2df9` | Two bugs that made the map look empty |
| `38e1774` | Frame 18 components wired into `App.jsx` |
| `6d9a905` | CARTO basemap replaced with a keyless one — CARTO returns HTTP 200 with "API KEY REQUIRED" watermarked into the tile |
