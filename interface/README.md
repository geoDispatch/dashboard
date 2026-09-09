# GeoDispatch dashboard

Read-mostly operations console for the GeoDispatch pipeline. **SolidJS + Vite +
Leaflet**, plain CSS, no component framework.

It consumes one WebSocket and sends exactly one request — `POST /sensor`, from
the incident launcher, which is the same thing a seismic sensor does. Nothing
else here talks back to the pipeline.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

With no supervisor reachable the console falls back to the bundled Al Haouz
demo after ~2.5 s, and says so. That is a browser-side scenario, not a
recording of anything real.

For the real stack, from the `supervisor` repository:

```bash
docker compose -f docker-compose.dev.yml up --build
```

That serves Postgres+PostGIS, mock CAMARA, a mock AI agent and the supervisor
on `:8080`, which is what `vite.config.js` proxies to.

| Script | |
|---|---|
| `npm run dev` | Dev server, with the `/sensor` and `/health` proxy |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the build. **No proxy** — see CORS below. |
| `npm test` | Vitest, node environment, ~0.5 s |
| `npm run test:watch` | Same, watching |

---

## The one thing that will bite you: CORS

The supervisor sets no `Access-Control-Allow-Origin` on any route and has no
`OPTIONS` handler. A JSON `POST` from `:5173` to `:8080` is preflighted, the
preflight is refused, and `fetch` throws **before** the POST happens — which
looks exactly like the supervisor being down.

`vite.config.js` proxies `/sensor` and `/health` so development requests are
same-origin and CORS never applies. `src/lib/endpoints.js` uses the relative
path only when the configured endpoint is the origin the proxy forwards to;
point the console at a staging supervisor and it goes back to the absolute URL.

**This is a development crutch.** `server.proxy` does not exist in a build, so
`npm run preview` and any deployment will hit CORS again. Fixing it properly
needs one of:

1. CORS middleware on the Go supervisor, or
2. a same-origin reverse proxy serving the dashboard and forwarding `/ws`,
   `/sensor` and `/health`.

Both are backend/DevOps work. Diagnose with `curl -i -X POST .../sensor` — if
curl gets `202` and the browser does not, it is CORS.

---

## Layout

```
src/
  lib/          socket, router, store, selectors, streamState, launch,
                endpoints, settings, format, geo, audio, mockStream
  components/   map, panels, modals, drawer, chrome
  constants/    zones, basemaps
  hooks/        network stats, operator location
  styles/       tokens.css — every colour, radius, size and duration
```

`lib/` is plain JavaScript with no DOM, which is what makes the test suite fast
and the ingestion path replayable.

---

## SolidJS, not React

- Component bodies run **once**. There is no re-render.
- **Never destructure props** — `props.event`, not `{ event }`. Destructuring
  reads the value once and freezes it.
- `<Show>` and `<For>`, not ternaries and `.map()`.
- `class`, not `className`.
- Imperative libraries (Leaflet) live in `onMount` and are torn down in
  `onCleanup`.

> Do not name a component `Show`, `For`, `Index`, `Switch`, `Match`, `Dynamic`,
> `Portal`, `Suspense` or `ErrorBoundary`. The compiler claims those names and
> will replace your component with its own control flow, silently, at build
> time.

---

## Rules the UI keeps

- **Phone numbers are always masked** — `+212 6** *** 678`. There is one
  function that turns a stored number into pixels, and there is no way to
  unmask from the UI or from storage.
- **The `reasoning` field is never rendered.** Audit-only by contract.
- **Zone is never colour alone** — every zone carries its word.
- **Nothing missing is filled in.** A value the supervisor does not send is a
  dash and a reason, never a plausible number.
- **Demo data says so** — shelters and occupancy are labelled demonstration
  data wherever they appear.
- **An open socket is not a live stream.** See `docs/WEBSOCKET.md`.

Provenance of every displayed value: `docs/COMPONENTS.md`.
