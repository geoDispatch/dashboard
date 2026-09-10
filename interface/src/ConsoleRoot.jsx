import { createSignal, Show } from 'solid-js'

import App from './App'
import EntryGate from './components/EntryGate'
import { readEntrySession, writeEntrySession } from './lib/entrySession'

export default function ConsoleRoot() {
  const [hasAccess, setHasAccess] = createSignal(readEntrySession())

  function enterConsole(options = {}) {
    writeEntrySession(!!options.keepSession)
    setHasAccess(true)
  }

  function endShift() {
    writeEntrySession(false)
    setHasAccess(false)
  }

  return (
    <>
      {/* Keep the console mounted behind the opaque gate. Its WebSocket starts
          immediately, so the intro cannot make the board miss event_start. */}
      <div
        class="app-runtime"
        inert={!hasAccess()}
        aria-hidden={hasAccess() ? undefined : 'true'}
      >
        <App onEndShift={endShift} />
      </div>

      <Show when={!hasAccess()}>
        <EntryGate onEnter={enterConsole} />
      </Show>
    </>
  )
}
