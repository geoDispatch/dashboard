// The entry screen is a frontend-only access gate. This flag remembers only
// that the operator chose to keep this browser tab open; credentials are never
// written to storage and no authentication claim is made here.
export const ENTRY_SESSION_KEY = 'geodispatch.entry-session.v1'

export function readEntrySession(storage = globalThis.sessionStorage) {
  try {
    return storage?.getItem(ENTRY_SESSION_KEY) === 'active'
  } catch {
    return false
  }
}

export function writeEntrySession(active, storage = globalThis.sessionStorage) {
  try {
    if (active) storage?.setItem(ENTRY_SESSION_KEY, 'active')
    else storage?.removeItem(ENTRY_SESSION_KEY)
    return true
  } catch {
    return false
  }
}
