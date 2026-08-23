import { createSignal } from 'solid-js'
import { createWebSocket } from './hooks/createWebSocket'
import DisasterMap from './components/DisasterMap'
import SidebarPanel from './components/SidebarPanel'
import EventBanner from './components/EventBanner'
import ErrorToast from './components/ErrorToast'
import './App.css'

window.__geodispatch = { events: [], devices: {}, errors: [], lastEvent: null }

export default function App() {
  const [event,       setEvent]       = createSignal(null)
  const [devices,     setDevices]     = createSignal({})
  const [zoneSummary, setZoneSummary] = createSignal(null)
  const [narratives,  setNarratives]  = createSignal({})
  const [errors,      setErrors]      = createSignal([])

  const { connected } = createWebSocket((msg) => {
    console.log('[APP] routing message type:', msg.type, msg.payload)
    window.__geodispatch.events.push(msg)

    const p = msg.payload

    switch (msg.type) {
      case 'event_start':
        console.log('[APP] 🌍 event_start received:', p)
        window.__geodispatch.lastEvent = p
        setEvent(p)
        setDevices({})
        setNarratives({})
        setZoneSummary(null)
        setErrors([])
        break

      case 'device_update':
        console.log('[APP] 📱 device_update:', p.phone, p.zone, p.reachable)
        window.__geodispatch.devices[p.phone] = p
        setDevices(d => ({ ...d, [p.phone]: p }))
        break

      case 'zone_summary':
        console.log('[APP] 📊 zone_summary received:', p)
        setZoneSummary(p)
        break

      case 'narrative_update':
        console.log('[APP] 📝 narrative_update zone:', p.zone)
        setNarratives(n => ({ ...n, [p.zone]: p.narrative }))
        break

      case 'error':
        console.warn('[APP] ⚠️ error:', p)
        window.__geodispatch.errors.push(p)
        setErrors(e => [...e, p])
        break

      default:
        console.warn('[WS] unknown message type:', msg.type, msg)
    }
  })

  return (
    <div class="app">
      <EventBanner event={event()} connected={connected()} />

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

      <ErrorToast errors={errors()} onDismiss={(i) =>
        setErrors(e => e.filter((_, idx) => idx !== i))
      } />
    </div>
  )
}