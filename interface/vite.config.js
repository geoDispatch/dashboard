import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// The proxy exists so the incident launcher, the Ping button and the
// launcher's capabilities read work in development whatever the supervisor's
// origin allowlist says.
//
// The dashboard runs on :5173 and the supervisor on :8080, so /sensor,
// /health and /capabilities are cross-origin requests. The supervisor answers
// CORS only for origins on its ALLOWED_ORIGINS list; forwarding a same-origin
// request from the dev server sidesteps that, because the forwarding happens
// server-side where CORS does not exist.
//
// THIS DOES NOT SOLVE PRODUCTION. `server.proxy` is a dev-server feature; a
// `vite build` output has no proxy of any kind. A deployed dashboard on a
// different origin from the supervisor needs that origin on the supervisor's
// ALLOWED_ORIGINS, or a same-origin reverse proxy in front of both. See
// src/lib/endpoints.js.
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8080'

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      '/sensor':       { target: PROXY_TARGET, changeOrigin: true },
      '/health':       { target: PROXY_TARGET, changeOrigin: true },
      '/capabilities': { target: PROXY_TARGET, changeOrigin: true },
    },
  },
})
