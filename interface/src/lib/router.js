// Pure ingestion: (actions, message) => void.
// No Solid, no DOM, no socket — so fixtures replay through the exact same path
// the live stream uses, and the whole ingestion layer is testable in node.

const HANDLED = new Set([
  'event_start',
  'device_update',
  'zone_summary',
  'narrative_update',
  'error',
])

export function routeMessage(actions, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return { ok: false, reason: 'malformed frame' }
  }

  const p = msg.payload

  switch (msg.type) {
    case 'event_start':
      if (!p?.epicenter) return { ok: false, reason: 'event_start without epicenter' }
      actions.eventStart(p, msg.event_id, msg.timestamp)
      return { ok: true }

    case 'device_update':
      if (!p?.phone) return { ok: false, reason: 'device_update without phone' }
      actions.deviceUpdate(p)
      return { ok: true }

    case 'zone_summary':
      actions.zoneSummary(p ?? {})
      return { ok: true }

    case 'narrative_update':
      actions.narrative(p ?? {})
      return { ok: true }

    case 'error':
      actions.error(p ?? {})
      return { ok: true }

    default:
      return { ok: false, reason: `unknown message type: ${msg.type}` }
  }
}

export function isHandled(type) {
  return HANDLED.has(type)
}
