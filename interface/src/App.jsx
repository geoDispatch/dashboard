// GeoDispatch console — the Frame 18 shell.
//
// This file owns exactly three things: the store and the stream, the signals
// the chrome switches on (active rail view, panel hidden, layers, search), and
// the wiring between them. Every visible pixel belongs to a component that
// imports its own CSS; the only markup here is the shell and the overlays.
//
// Honesty rules that this file, and only this file, can enforce:
//   - the toolbar is told where the frames really come from (stream.source()),
//     so a demo can never be presented as the live supervisor;
//   - when the pipeline is fatal the console stops claiming to be live;
//   - the auth controls have no service behind them, so they say so instead of
//     pretending to sign anyone in;
//   - nothing is invented to fill a row — missing values reach the panels as
//     null and render as an em dash there.
//
// SolidJS: props are never destructured, component bodies run once, lists go
// through <For> and branches through <Show>.

import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

import TopBar from './components/TopBar'
import NavRail from './components/NavRail'
import MapToolbar from './components/MapToolbar'
import DisasterMap from './components/DisasterMap'
import DeviceDetails from './components/DeviceDetails'
import { DevicesPanel, ErrorsPanel, PanelShell, RescuePanel, SheltersPanel } from './components/OpsPanels'

import { createConsoleStore } from './lib/store'
import { createSelectors } from './lib/selectors'
import { createStream } from './lib/socket'
import { SHELTERS } from './lib/mockStream'
import { AL_HAOUZ_LOCALITIES, nearestLocality } from './lib/geo'
import { coords, maskPhone, num } from './lib/format'
import { ZONE_LABELS } from './constants/zones'

import { useNetworkStats } from './hooks/useNetworkStats'
import { useOperatorLocation } from './hooks/useOperatorLocation'

import './App.css'

// ── Shelters ────────────────────────────────────────────────────────────────
// The supervisor does not publish shelters; the bundled Al Haouz scenario does,
// but only as a name and an occupancy. A shelter is placed on the map only when
// its name resolves to a locality we hold a centroid for — the rest are listed
// with no coordinates rather than dropped at a made-up point.
const SHELTER_SITES = SHELTERS.map((shelter) => {
  const anchor = AL_HAOUZ_LOCALITIES.find((locality) => shelter.name.includes(locality.name))
  if (!anchor) {
    return { ...shelter, latitude: null, longitude: null, anchor: null }
  }
  return {
    ...shelter,
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    anchor: anchor.name,
  }
})

const SEARCH_LIMIT = 8
const NOTE_MS = 6000

// The rail keys that own a left-overlay view. 'errors' is reached from the
// notification bell rather than the rail.
const PANEL_LABELS = {
  rescue: 'Rescue queue',
  devices: 'Devices',
  shelters: 'Shelters',
  errors: 'Errors',
}

export default function App() {
  // ── store, selectors, stream ─────────────────────────────────────────────
  const { state, actions } = createConsoleStore()
  const selectors = createSelectors(state)

  // The stream registers its own onCleanup, so it must be created inside the
  // component body. `source()` is the only truthful answer to "is this live?".
  const stream = createStream(actions)

  const net = useNetworkStats()

  // ── ui signals ───────────────────────────────────────────────────────────
  const [handle, setHandle] = createSignal(null)   // DisasterMap's imperative handle
  const [activeView, setActiveView] = createSignal('map')
  const [panelHidden, setPanelHidden] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [note, setNote] = createSignal(null)
  const [layers, setLayers] = createSignal({ zones: true, devices: true, shelters: false })

  let mapEl                 // the element that goes fullscreen
  let noteTimer = null

  // ── transient inline note ────────────────────────────────────────────────
  // Used for everything the console cannot actually do: auth, a refused
  // fullscreen, a declined location. It states the limit and clears itself.
  function showNote(text) {
    if (noteTimer) clearTimeout(noteTimer)
    setNote(text)
    noteTimer = setTimeout(() => setNote(null), NOTE_MS)
  }

  function authNote(label) {
    showNote(`${label} is not wired — this console has no auth service behind it.`)
  }

  onCleanup(() => {
    if (noteTimer) clearTimeout(noteTimer)
  })

  // ── operator location ────────────────────────────────────────────────────
  // Geolocation comes from the map (Leaflet's map.locate()) or the browser
  // directly. There is no IP service and no API key anywhere in this path.
  const operator = useOperatorLocation({
    onLocated: (loc) => {
      if (!loc) return
      actions.setRegion(loc)
      const map = handle()
      if (map) map.flyTo(loc.latitude, loc.longitude, loc.source === 'manual' ? 8 : 11)
    },
  })

  // A region remembered from a previous session is restored by the hook without
  // firing onLocated, so the store is told about it once the shell is up.
  onMount(() => {
    const restored = operator.location()
    if (restored) actions.setRegion(restored)
  })

  async function useMyLocation() {
    const map = handle()
    // The map handle's locate is passed straight through — that IS the
    // geolocation source, not a wrapper around some third-party lookup.
    const fix = await operator.locate(map ? { locate: map.locate } : {})
    if (!fix) {
      showNote(
        operator.error() ||
          'Location unavailable. Pick a region from the Set Location list instead.',
      )
    }
  }

  function selectRegion(name) {
    const region = operator.selectRegion(name)
    if (!region) showNote(`No region named ${name} is on the list.`)
  }

  const locationLabel = () => {
    const region = state.region
    if (region && region.name) return region.name
    return null
  }

  const locationBusy = () => operator.status() === 'locating'

  // ── search ───────────────────────────────────────────────────────────────
  // Masked phone, zone word, nearest locality and coordinates. The query is
  // read first so an empty field never subscribes to the device map — with
  // thousands of dots streaming, that would recompute on every frame.
  const results = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return []

    const out = []
    for (const device of Object.values(state.devices)) {
      const masked = maskPhone(device.phone)
      const zoneWord = ZONE_LABELS[device.zone] || ''
      const locality = nearestLocality(device.latitude, device.longitude)
      const place = locality ? locality.name : ''
      const point = coords(device.latitude, device.longitude)
      const raw = `${device.latitude} ${device.longitude}`

      const haystack = `${masked} ${device.zone || ''} ${zoneWord} ${place} ${point} ${raw}`
      if (!haystack.toLowerCase().includes(q)) continue

      out.push({
        phone: device.phone,
        label: masked,
        sub: place ? `${place} · ${point}` : point,
        zone: device.zone,
      })
      if (out.length >= SEARCH_LIMIT) break
    }
    return out
  })

  // Picking a device — from the search list, the rescue queue or a map dot.
  function pickDevice(phone) {
    actions.selectDevice(phone)
    const map = handle()
    if (map && phone) map.focusDevice(phone)
  }

  function pickResult(phone) {
    setQuery('')
    setActiveView('map')
    pickDevice(phone)
  }

  function focusShelter(shelter) {
    if (typeof shelter.latitude !== 'number') return
    const map = handle()
    if (map) map.flyTo(shelter.latitude, shelter.longitude, 12)
  }

  // ── map layers ───────────────────────────────────────────────────────────
  function toggleLayer(key) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // ── fullscreen ───────────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
      return
    }
    if (!mapEl || !mapEl.requestFullscreen) {
      showNote('This browser will not put the map into fullscreen.')
      return
    }
    const request = mapEl.requestFullscreen()
    if (request && typeof request.catch === 'function') {
      request.catch(() => showNote('The browser refused fullscreen for this page.'))
    }
  }

  // Leaflet has to be told the container changed size.
  onMount(() => {
    const onFullscreenChange = () => {
      const map = handle()
      if (map) requestAnimationFrame(() => map.invalidate())
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    onCleanup(() => document.removeEventListener('fullscreenchange', onFullscreenChange))
  })

  // Switching rail views or hiding the panel changes what covers the map; a
  // size check afterwards costs nothing and keeps Leaflet's tiles honest.
  createEffect(() => {
    activeView()
    panelHidden()
    const map = handle()
    if (map) map.invalidate()
  })

  // ── export ───────────────────────────────────────────────────────────────
  // A real Blob download of what this console is actually holding, stamped with
  // where the frames came from so an exported demo is never mistaken for a
  // record of a live event.
  function exportJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      source: stream.source(),
      connection: {
        status: state.connection.status,
        source: state.connection.source,
        fps: state.connection.fps,
        frames: state.connection.frames,
      },
      event: state.event,
      devices: Object.values(state.devices),
      summary: state.summary,
      narratives: state.narratives,
    }

    let url = null
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      url = URL.createObjectURL(blob)
      const eventId = (state.event && state.event.event_id) || 'no-event'
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `geodispatch-${eventId}-${stream.source()}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      showNote(`Exported ${num(payload.devices.length)} devices as JSON.`)
    } catch (err) {
      showNote(`Export failed: ${String((err && err.message) || err)}`)
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
  }

  // ── stream honesty ───────────────────────────────────────────────────────
  // A dead pipeline must never leave a green "live" pill on screen. The toolbar
  // is handed 'lost' the moment a fatal error lands, whatever the socket thinks.
  const toolbarStatus = () => {
    if (state.fatal) return 'lost'
    // While the demo is the source, the socket's own retry state belongs to the
    // supervisor, not to the frames on screen: reporting "lost" for a demo that
    // is still producing frames would be as false as calling a demo live. The
    // pill describes what is actually arriving; the strip names the source.
    if (stream.source() === 'demo') {
      return state.connection.fps > 0 ? 'live' : 'reconnecting'
    }
    return state.connection.status
  }

  const isDemo = () => stream.source() === 'demo'

  // "Degraded" means frames have actually stopped. A demo that is streaming
  // happily while the socket retries in the background is NOT degraded — it is
  // dishonest, which the strip says in words instead of in an alarm colour.
  const degraded = () => {
    if (state.fatal) return true
    if (isDemo()) return false
    return toolbarStatus() === 'reconnecting' || toolbarStatus() === 'lost'
  }

  // The strip is shown whenever the console is not simply live on the
  // supervisor — that includes a perfectly healthy demo, which still needs
  // saying out loud.
  const showStrip = () =>
    degraded() || isDemo() || state.connection.status === 'connecting'

  const stripTitle = () => {
    if (state.fatal) return 'Pipeline stopped'
    if (isDemo()) return 'Demo stream — not the live supervisor'
    if (toolbarStatus() === 'lost') return 'Stream lost'
    if (toolbarStatus() === 'reconnecting') return 'Reconnecting'
    return 'Connecting'
  }

  const stripBody = () => {
    if (state.fatal) {
      const code = state.fatal.code || 'unknown code'
      const detail = state.fatal.message || 'The supervisor reported a fatal error.'
      return `${detail} (${code}) Nothing on this screen is updating any more — the figures are the last ones received.`
    }
    if (isDemo()) {
      return 'These frames are generated by the bundled Al Haouz scenario, not by the live supervisor. Nothing on this map describes a real event.'
    }
    if (toolbarStatus() === 'lost') {
      return 'The supervisor stopped answering and the retries have backed off. What is on screen is the last frame received, not the current situation.'
    }
    if (toolbarStatus() === 'reconnecting') {
      return 'The socket dropped and is retrying. Figures are frozen at the last frame until it comes back.'
    }
    return 'Opening the socket to the supervisor. The bundled demo takes over if it does not answer.'
  }

  // While the demo is running the socket keeps retrying underneath it. That is
  // worth one quiet line, but it must not be mistaken for the demo stalling.
  const stripAside = () => {
    if (state.fatal || !isDemo()) return ''
    const status = state.connection.status
    if (status === 'live') return ''
    return 'The live supervisor is still not answering; the console keeps retrying in the background.'
  }

  function useDemoStream() {
    stream.useDemo()
    showNote('Switched to the bundled demo stream.')
  }

  function useLiveStream() {
    stream.useLive()
    showNote('Retrying the live supervisor.')
  }

  // ── rail ─────────────────────────────────────────────────────────────────
  const badges = () => ({
    rescue: selectors.rescueQueue().length,
    devices: selectors.counts().total,
    shelters: SHELTER_SITES.length,
  })

  function navigate(key) {
    setActiveView(key)
    setPanelHidden(false)
  }

  function openErrors() {
    setActiveView('errors')
    setPanelHidden(false)
  }

  const panelLabel = () => PANEL_LABELS[activeView()] || 'Panel'
  const toggleHidden = () => setPanelHidden(!panelHidden())

  return (
    <div class="app-shell">
      <TopBar
        locationLabel={locationLabel()}
        locationBusy={locationBusy()}
        regions={operator.regions}
        onUseMyLocation={useMyLocation}
        onSelectRegion={selectRegion}
        query={query()}
        results={results()}
        onQueryInput={(value) => setQuery(value)}
        onPickResult={pickResult}
        errorCount={state.errors.length}
        onNotifications={openErrors}
        onAuthNote={authNote}
      />

      <NavRail
        active={activeView()}
        badges={badges()}
        onNavigate={navigate}
        onAuthNote={authNote}
      />

      <main class="app-map" ref={mapEl}>
        <DisasterMap
          event={state.event}
          devices={state.devices}
          selectedPhone={state.selectedPhone}
          operator={state.region}
          layers={layers()}
          shelters={SHELTER_SITES}
          onSelect={(phone) => actions.selectDevice(phone)}
          onReady={(api) => setHandle(() => api)}
        />

        {/* Left overlay — whichever view the rail is on. */}
        <div class="map-overlay map-overlay--stack">
          <Show when={activeView() === 'map'}>
            <DeviceDetails
              device={selectors.selectedDevice()}
              hidden={panelHidden()}
              onToggleHidden={toggleHidden}
            />
          </Show>

          <Show when={activeView() === 'rescue'}>
            <PanelShell label={panelLabel()} hidden={panelHidden()} onToggleHidden={toggleHidden}>
              <RescuePanel
                queue={selectors.rescueQueue()}
                selectedPhone={state.selectedPhone}
                onSelect={pickDevice}
              />
            </PanelShell>
          </Show>

          <Show when={activeView() === 'devices'}>
            <PanelShell label={panelLabel()} hidden={panelHidden()} onToggleHidden={toggleHidden}>
              <DevicesPanel counts={selectors.counts()} areas={selectors.byLocality()} />
            </PanelShell>
          </Show>

          <Show when={activeView() === 'shelters'}>
            <PanelShell label={panelLabel()} hidden={panelHidden()} onToggleHidden={toggleHidden}>
              <SheltersPanel shelters={SHELTER_SITES} onFocus={focusShelter} />
            </PanelShell>
          </Show>

          <Show when={activeView() === 'errors'}>
            <PanelShell label={panelLabel()} hidden={panelHidden()} onToggleHidden={toggleHidden}>
              <ErrorsPanel
                groups={selectors.errorGroups()}
                total={state.errors.length}
                onClear={() => actions.clearErrors()}
              />
            </PanelShell>
          </Show>
        </div>

        {/* Right overlay — the map toolbar. */}
        <div class="map-overlay map-overlay--tr">
          <MapToolbar
            status={toolbarStatus()}
            source={stream.source()}
            fps={state.connection.fps}
            layers={layers()}
            netLabel={net.label()}
            netQuality={net.quality()}
            onToggleLayer={toggleLayer}
            onFullscreen={toggleFullscreen}
            onExport={exportJson}
          />
        </div>

        {/* Bottom-left — the state of the pipeline, in words, whenever it is
            anything other than plainly live on the supervisor. */}
        <Show when={showStrip()}>
          <aside
            class="map-overlay map-overlay--bl app-strip"
            classList={{ 'app-strip--degraded': degraded(), 'app-strip--fatal': !!state.fatal }}
            role="status"
            aria-live="polite"
          >
            <p class="app-strip__title">{stripTitle()}</p>
            <p class="app-strip__body">{stripBody()}</p>

            <Show when={stripAside()}>
              <p class="app-strip__body">{stripAside()}</p>
            </Show>

            <Show when={stream.lastError()}>
              <p class="app-strip__detail">{stream.lastError()}</p>
            </Show>

            <div class="app-strip__actions">
              <Show when={!isDemo()}>
                <button type="button" class="app-strip__btn" onClick={useDemoStream}>
                  Use the demo stream
                </button>
              </Show>
              <Show when={isDemo()}>
                <button type="button" class="app-strip__btn" onClick={useLiveStream}>
                  Retry the supervisor
                </button>
              </Show>
            </div>
          </aside>
        </Show>

        {/* Transient note — what the console cannot do, said plainly. */}
        <Show when={note()}>
          <p class="map-overlay app-note" role="status" aria-live="polite">
            {note()}
          </p>
        </Show>
      </main>

      {/* The fatal banner sits outside the map so it survives whichever rail
          view is open, and whether or not the panel is hidden. */}
      <Show when={state.fatal}>
        {(fatal) => (
          <p class="app-fatal" role="alert">
            Pipeline stopped — {fatal().code || 'unknown code'}. This console is no longer
            receiving updates from the supervisor.
          </p>
        )}
      </Show>
    </div>
  )
}
