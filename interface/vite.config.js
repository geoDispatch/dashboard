import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// The proxy exists so the incident launcher works in development.
//
// The dashboard runs on :5173 and the supervisor on :8080. A POST to
// /sensor with a JSON body is a cross-origin request, so the browser
// preflights it with OPTIONS — and the Go supervisor answers no CORS headers
// on any route, so the preflight fails and the POST never happens. Forwarding
// a same-origin /sensor from the dev server sidesteps that, because the
// forwarding happens server-side where CORS does not exist.
//
// THIS DOES NOT SOLVE PRODUCTION. `server.proxy` is a dev-server feature; a
// `vite build` output has no proxy of any kind. A deployed dashboard on a
// different origin from the supervisor needs either CORS support added to the
// supervisor or a same-origin reverse proxy in front of both. See
// src/lib/endpoints.js and docs/WEBSOCKET.md.
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8080'

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      '/sensor': { target: PROXY_TARGET, changeOrigin: true },
      '/health': { target: PROXY_TARGET, changeOrigin: true },
    },
  },
})
