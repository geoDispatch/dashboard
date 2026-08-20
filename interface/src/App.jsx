import { createSignal } from 'solid-js'
import { createWebSocket } from './hooks/createWebSocket'
import DisasterMap from './components/DisasterMap'
import SidebarPanel from './components/SidebarPanel'
import EventBanner from './components/EventBanner'
import ErrorToast from './components/ErrorToast'
import './App.css'

export default function App() {
  // ── state signals ─────────────────────────────────────────
  const [event,       setEvent]       = createSignal(null)
  const [devices,     setDevices]     = createSignal({})   // phone → DeviceUpdate
  const [zoneSummary, setZoneSummary] = createSignal(null)
  const [narratives,  setNarratives]  = createSignal({})   // zone → string
  const [errors,      setErrors]      = createSignal([])

  // ── WS message router ─────────────────────────────────────
  const { connected } = createWebSocket((msg) => {
    const p = msg.payload
    switch (msg.type) {
      case 'event_start':
        setEvent(p)
        setDevices({})       // clear previous event dots
        setNarratives({})
        setZoneSummary(null)
        setErrors([])
        break

      case 'device_update':
        setDevices(d => ({ ...d, [p.phone]: p }))
        break

      case 'zone_summary':
        setZoneSummary(p)
        break

      case 'narrative_update':
        setNarratives(n => ({ ...n, [p.zone]: p.narrative }))
        break

      case 'error':
        setErrors(e => [...e, p])
        break

      default:
        console.warn('[WS] unknown message type:', msg.type)
    }
  })

  return (
    <div class="app">
      {/* top bar */}
      <EventBanner event={event()} connected={connected()} />

      {/* main layout */}
      <div class="layout">
        <div class="map-container">
          <DisasterMap
            event={event()}
            devices={devices()}
          />
        </div>
        <SidebarPanel
          zoneSummary={zoneSummary()}
          narratives={narratives()}
        />
      </div>

      {/* floating error toasts */}
      <ErrorToast errors={errors()} onDismiss={(i) =>
        setErrors(e => e.filter((_, idx) => idx !== i))
      } />
    </div>
  )
}