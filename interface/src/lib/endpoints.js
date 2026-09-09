// Turning the configured WebSocket endpoint into the HTTP routes beside it.
//
// The supervisor serves /ws, /sensor and /health on one host, so the operator
// configures one address and these are derived from it. Configuring three
// would be three chances to point the console at two different supervisors.
//
// ── The dev proxy, and what it does not solve ────────────────────────────
//
// POSTing to http://localhost:8080/sensor from a page served on :5173 is a
// cross-origin request with a JSON content type, so the browser sends a
// preflight OPTIONS first. The Go supervisor has no CORS handling at all — no
// Access-Control-Allow-Origin, no OPTIONS route — so the preflight is refused
// and fetch throws before the POST is ever attempted.
//
// In development Vite can forward a same-origin /sensor to the supervisor
// server-side, where CORS does not apply. That is what `viaProxy` selects.
//
// IT IS A DEVELOPMENT CRUTCH ONLY. `server.proxy` exists in `vite dev` and
// nowhere else: a `vite build` has no proxy, so a deployed dashboard talking
// to a supervisor on another origin will fail exactly as it does today. That
// needs one of two things, neither of which is a frontend change:
//
//   1. CORS support on the supervisor, or
//   2. a same-origin reverse proxy in front of both.
//
// The proxy is also used ONLY when the configured endpoint is the same host
// the proxy forwards to. Point the console at a staging supervisor and it
// goes back to the absolute URL, because a relative path would have quietly
// sent the incident to whichever host the proxy was built against.

/** Where `vite.config.js` forwards /sensor and /health in development. */
export const DEV_PROXY_TARGET =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROXY_TARGET) ||
  'http://localhost:8080'

const isDev = () =>
  typeof import.meta !== 'undefined' && !!import.meta.env?.DEV

/** ws://host/ws + '/sensor' → http://host/sensor. Null if the URL is unusable. */
export function httpUrlFor(wsUrl, path) {
  try {
    const url = new URL(wsUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = url.pathname.replace(/\/ws$/, path)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/** True when `wsUrl` resolves to the same origin the dev proxy forwards to. */
export function matchesProxyTarget(wsUrl, target = DEV_PROXY_TARGET) {
  const absolute = httpUrlFor(wsUrl, '/sensor')
  if (!absolute) return false
  try {
    return new URL(absolute).origin === new URL(target).origin
  } catch {
    return false
  }
}

/**
 * Where the launcher should POST, and whether that goes through the dev proxy.
 *
 * @returns { url, absolute, viaProxy }
 *   url       what fetch() is given
 *   absolute  where the request actually ends up, for the UI to display —
 *             "/sensor" tells the operator nothing about which supervisor
 *   viaProxy  true when the dev proxy is carrying it
 */
export function sensorTarget(wsUrl, { fallback, dev = isDev(), target = DEV_PROXY_TARGET } = {}) {
  const absolute = httpUrlFor(wsUrl, '/sensor') || fallback || `${target}/sensor`
  const viaProxy = dev && matchesProxyTarget(wsUrl, target)
  return { url: viaProxy ? '/sensor' : absolute, absolute, viaProxy }
}

/** Same rule for the health probe behind the settings screen's Ping button. */
export function healthTarget(wsUrl, { fallback, dev = isDev(), target = DEV_PROXY_TARGET } = {}) {
  const absolute = httpUrlFor(wsUrl, '/health') || fallback || `${target}/health`
  const viaProxy = dev && matchesProxyTarget(wsUrl, target)
  return { url: viaProxy ? '/health' : absolute, absolute, viaProxy }
}
