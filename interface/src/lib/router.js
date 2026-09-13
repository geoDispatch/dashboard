// Pure ingestion: (actions, raw frame) → status.
// No Solid, no DOM, no socket — so fixtures replay through the exact same path
// the real stream uses, and the whole ingestion layer is testable in node.
//
// Order matters and is the whole point of this file:
//
//   1. validate   a frame that breaks contract v2 is counted `invalid` and
//                 never reaches the store — and never refreshes lastFrameAt,
//                 so garbage cannot make a dead stream look alive
//   2. apply      the store gates by event and seq and returns what it did
//   3. freshness  only accepted and control frames count as proof of life
//
// Counting `received` is the socket's job (it sees every raw message,
// including ones that are not even JSON), so it is not repeated here.

import { validateFrame } from './validate'

/**
 * @param actions  the console store's actions
 * @param raw      a parsed frame, or its JSON text
 * @returns { status: 'accepted'|'control'|'invalid'|'foreign'|'duplicate', reason? }
 */
export function routeMessage(actions, raw) {
  const checked = validateFrame(raw)
  if (!checked.ok) {
    actions.noteInvalid(checked.reason)
    return { status: 'invalid', reason: checked.reason }
  }

  const status = actions.apply(checked.frame)
  if (status === 'accepted' || status === 'control') actions.countFrame()
  return { status }
}
