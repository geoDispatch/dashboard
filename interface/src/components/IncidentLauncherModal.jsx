// Incident launcher — the one control in this console that writes.
//
// Everything else here observes: the socket is server-to-client only and the
// dashboard never talks back to the pipeline. This dialog is the exception,
// and it is not an exception to that rule so much as a different conversation:
// it POSTs a SensorInput to the supervisor's /sensor route, which is the same
// thing the seismic sensor does. The supervisor then decides whether an event
// happens. Nothing here dispatches an SMS, flags a rescue, or touches a device.
//
// The form is the whole SensorInput and nothing else. The event id and the
// timestamp are generated (and editable); every measurement starts empty,
// because a launcher that pre-fills one will one day start an incident nobody
// described. A named preset fills them all at once, in view, for the operator
// to read and edit before anything is sent.
// Validation is lib/launch.js — the same checks POST /sensor applies — so a
// bad field is flagged here before the supervisor has to refuse it, and a
// field the supervisor still refuses (422) is shown on the field it names.
//
// Where it runs. Inside an area the development supervisor holds subscribers
// for (Al Haouz, Agadir, Casablanca) the launch goes to the supervisor and
// the real pipeline. Anywhere else the supervisor would find nobody, so the
// default there is a SIMULATION: synthetic devices, zones and shelters
// generated in this browser (lib/simulation.js), sent to no one. The operator
// can override either way; the dialog says which it is going to do.
//
// SolidJS: props are never destructured, lists go through <For>, branches
// through <Show>.

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'

import { LaunchError, fetchCapabilities, triggerEvent } from '../lib/socket'
import {
  AFTERSHOCK_RISKS,
  DISASTER_TYPES,
  SENSOR_LIMITS,
  COMING_SOON,
  SIMULATION_CAPABILITIES,
  SUPERVISOR_AREAS,
  buildSensorInput,
  capabilityOf,
  createSubmitGuard,
  isOperational,
  makeEventId,
  newDraft,
  presetFields,
  supervisorAreaAt,
} from '../lib/launch'
import { ZONE_BAND_FALLBACK } from '../lib/validate'
import { useDisplay } from '../lib/settings'
import { severityLabel, titleCase } from '../lib/format'

import closeIcon from '../assets/icons/settings-close.svg?raw'

import './IncidentLauncherModal.css'

const TYPE_LABELS = {
  earthquake: 'Earthquake',
  flood:      'Flood',
  heatwave:   'Heatwave',
}

const RISK_OPTIONS = AFTERSHOCK_RISKS.map((key) => ({ key, label: titleCase(key) }))

// A toggle cannot say "not chosen yet", and tsunami_risk is required like
// every other field, so it is a two-way choice that starts unset.
const TSUNAMI_OPTIONS = [
  { key: 'false', label: 'No' },
  { key: 'true',  label: 'Yes' },
]

// Form field → the JSON path lib/launch.js and the supervisor report errors on.
const PATHS = {
  event_id:        'event_id',
  disaster_type:   'disaster_type',
  timestamp:       'timestamp',
  severity:        'severity',
  latitude:        'epicenter.latitude',
  longitude:       'epicenter.longitude',
  radius_km:       'radius_km',
  depth_km:        'depth_km',
  aftershock_risk: 'aftershock_risk',
  tsunami_risk:    'tsunami_risk',
}
const KNOWN_PATHS = new Set([...Object.values(PATHS), 'epicenter'])

const NUMERIC_FIELDS = ['latitude', 'longitude', 'severity', 'radius_km', 'depth_km']

// LaunchError kinds after which the supervisor certainly started nothing.
// After the others (no answer, a gateway, an unexpected 2xx) it may or may
// not have, and the dialog says so rather than guessing.
const CERTAIN_NOTHING = new Set(['busy', 'conflict', 'invalid'])

function Icon(props) {
  return <span class="ilm-icon" innerHTML={props.markup} aria-hidden="true" />
}

function Segmented(props) {
  return (
    <div class="ilm-segment" role="group" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="ilm-segment__btn"
            classList={{ 'is-active': props.value === option.key, 'is-soon': !!option.badge }}
            aria-pressed={props.value === option.key}
            disabled={!!option.disabled}
            title={option.title}
            onClick={() => props.onChange && props.onChange(option.key)}
          >
            {option.label}
            <Show when={option.badge}>
              <span class="ilm-segment__badge">{option.badge}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  )
}

export default function IncidentLauncherModal(props) {
  const fmt = useDisplay()

  // ── the form ──────────────────────────────────────────────────────────
  // Form values are strings; buildSensorInput converts and validates them.
  // Opened from a clicked point, the epicentre is that point and nothing else.
  const initial = newDraft()
  if (props.initialPoint) {
    initial.latitude = String(props.initialPoint.latitude)
    initial.longitude = String(props.initialPoint.longitude)
  }
  const [draft, setDraft] = createStore(initial)
  const [touched, setTouched] = createStore({})

  // Where the launch runs: null follows the epicentre (see the header), or
  // the operator's explicit 'supervisor' | 'simulation'.
  const [sourceChoice, setSourceChoice] = createSignal(null)
  const [presetKey, setPresetKey] = createSignal(null)
  // The id follows the preset and the source until the operator types one.
  const [autoId, setAutoId] = createSignal(true)
  const [idStamp, setIdStamp] = createSignal(Date.now())
  const [attempted, setAttempted] = createSignal(false)
  // What the supervisor said about the last attempt: { path: reason } from a
  // 422, cleared field by field as the operator edits.
  const [serverFields, setServerFields] = createStore({})
  const [failure, setFailure] = createSignal(null)   // { text, certain }
  const [pending, setPending] = createSignal(false)

  const guard = createSubmitGuard({ onChange: setPending })

  // ── capabilities ──────────────────────────────────────────────────────
  // undefined while asking, null when the supervisor could not be read.
  const [caps, setCaps] = createSignal(undefined)
  let alive = true
  onCleanup(() => { alive = false })
  onMount(() => {
    fetchCapabilities({ url: props.capabilitiesUrl }).then((result) => {
      if (alive) setCaps(result)
    })
  })

  // ── where it runs ─────────────────────────────────────────────────────
  const point = () => {
    const lat = Number(String(draft.latitude).trim())
    const lng = Number(String(draft.longitude).trim())
    return String(draft.latitude).trim() && String(draft.longitude).trim() && Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: lat, longitude: lng }
      : null
  }
  const pointArea = createMemo(() => {
    const p = point()
    return p ? supervisorAreaAt(p.latitude, p.longitude) : null
  })
  const source = () => sourceChoice() ?? (point() && !pointArea() ? 'simulation' : 'supervisor')
  const simulated = () => source() === 'simulation'

  const idPrefix = () => {
    if (simulated()) return 'SIM'
    return presetKey() ? presetKey().toUpperCase() : 'EVT'
  }
  createEffect(() => {
    const id = makeEventId(idPrefix(), idStamp())
    if (autoId()) setDraft('event_id', id)
  })

  // lib/launch.js falls back to earthquake-only when given nothing. A
  // simulation answers to its own table: earthquakes only, flood and heatwave
  // coming soon.
  const effectiveCaps = () => (simulated() ? SIMULATION_CAPABILITIES : caps() || undefined)

  // Offered types: what /capabilities lists, non-operational ones disabled.
  // Without an answer only earthquake is offered — the one type §2.1 says
  // every supervisor runs — and the note says the supervisor has the last word.
  // A type that is coming soon is shown, disabled, with a "Soon" badge.
  const typeOptions = () => {
    const known = caps() || simulated()
    const keys = known ? DISASTER_TYPES : ['earthquake']
    return keys.map((key) => {
      const operational = isOperational(key, effectiveCaps())
      const soon = !operational && capabilityOf(key, effectiveCaps()) === COMING_SOON
      return {
        key,
        label: TYPE_LABELS[key] || titleCase(key),
        badge: soon ? 'Soon' : undefined,
        disabled: !operational,
        title: operational ? undefined : soon ? 'Coming soon' : 'Not supported by this supervisor',
      }
    })
  }
  const unsupportedTypes = () =>
    caps() && !simulated() ? DISASTER_TYPES.filter((key) => !isOperational(key, caps())) : []
  const comingSoonTypes = () =>
    simulated() ? DISASTER_TYPES.filter((key) => capabilityOf(key, SIMULATION_CAPABILITIES) === COMING_SOON) : []

  // ── presets ───────────────────────────────────────────────────────────
  const PRESET_OPTIONS = [
    ...SUPERVISOR_AREAS.map((area) => ({ key: area.key, label: area.name, title: area.note })),
    { key: 'custom', label: 'Custom point', title: 'Type an epicentre, or use the map centre' },
  ]

  function applyPreset(key) {
    if (key === 'custom') {
      setPresetKey(null)
      return
    }
    const area = SUPERVISOR_AREAS.find((a) => a.key === key)
    if (!area) return
    const fields = presetFields(area)
    for (const [field, value] of Object.entries(fields)) {
      setDraft(field, value)
      setTouched(field, true)
      setServerFields(PATHS[field], undefined)
    }
    setServerFields('epicenter', undefined)
    setPresetKey(key)
    setSourceChoice(null)
    setFailure(null)
  }

  const SOURCE_OPTIONS = [
    { key: 'supervisor', label: 'Supervisor', title: 'POST /sensor: the real pipeline' },
    { key: 'simulation', label: 'Simulation', title: 'Synthetic data generated in this browser' },
  ]

  const sourceNote = () => {
    if (simulated()) {
      return 'Plays a simulated incident in this browser: synthetic devices, zones and shelters. ' +
        'Not real data, and nothing is sent to the supervisor.'
    }
    if (pointArea()) {
      return `Runs the real pipeline on the supervisor's test subscribers in ${pointArea().name}.`
    }
    if (point()) {
      return 'The supervisor holds no test subscribers here, so this event will find no devices. ' +
        'Run it as a simulation to see devices, zones and shelters.'
    }
    return 'Pick a place, or type an epicentre.'
  }

  const limits = () => caps()?.limits || SENSOR_LIMITS
  const bands = () => caps()?.zone_bands || ZONE_BAND_FALLBACK

  const hints = () => {
    const l = limits()
    const r = (x, fallback) => (typeof x === 'number' ? x : fallback)
    return {
      severity:  `${r(l.severity?.min, 0)} to ${r(l.severity?.max, 10)}`,
      latitude:  '-90 to 90',
      longitude: '-180 to 180',
      radius_km: `> ${r(l.radius_km?.exclusive_min, 0)} and ≤ ${r(l.radius_km?.max, 500)}`,
      depth_km:  `${r(l.depth_km?.min, 0)} to ${r(l.depth_km?.max, 800)}`,
    }
  }

  // Severity is worded for the type: only an earthquake has a magnitude.
  const severityName = () => ({
    earthquake: 'Magnitude (M)',
    flood:      'Flood severity',
    heatwave:   'Heat severity',
  }[draft.disaster_type] || 'Severity')

  const LABELS = {
    severity:  () => severityName(),
    latitude:  () => 'Epicentre latitude',
    longitude: () => 'Epicentre longitude',
    radius_km: () => 'Impact radius (km)',
    depth_km:  () => 'Depth (km)',
  }

  // ── validation ────────────────────────────────────────────────────────
  const built = createMemo(() => buildSensorInput({ ...draft }, effectiveCaps()))

  // A field's error: the supervisor's verdict first (it is the authority),
  // then the local check — but only once the field has been touched or a
  // launch attempted, so an empty form is not a wall of red on open.
  function errorFor(field) {
    const path = PATHS[field]
    const server = serverFields[path] || (field === 'latitude' ? serverFields.epicenter : null)
    if (server) return server
    if (!attempted() && !touched[field]) return null
    const local = built().errors
    return local[path] || (field === 'latitude' ? local.epicenter : null) || null
  }

  // Server errors on paths the form has no field for (an unknown field, the
  // body as a whole). Rare, and shown as a list rather than dropped.
  const otherServerErrors = () =>
    Object.entries(serverFields).filter(([path, reason]) => reason && !KNOWN_PATHS.has(path))

  function setField(field, value) {
    setDraft(field, value)
    setTouched(field, true)
    setServerFields(PATHS[field], undefined)
    if (field === 'latitude') setServerFields('epicenter', undefined)
    if (field === 'event_id') setAutoId(false)
    // A hand-edited epicentre is no longer the preset's.
    if (field === 'latitude' || field === 'longitude') setPresetKey(null)
    setFailure(null)
  }

  const touch = (field) => setTouched(field, true)

  function newId() {
    setAutoId(true)
    setIdStamp(Date.now())
    setServerFields('event_id', undefined)
    setFailure(null)
  }

  function stampNow() {
    setField('timestamp', String(Date.now()))
  }

  const timestampIso = () => {
    const raw = String(draft.timestamp).trim()
    if (!/^\d+$/.test(raw)) return null
    const d = new Date(Number(raw))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  // Optional: the map's current centre as the epicentre. Only fills the two
  // fields; nothing else is inferred from where the map happens to be.
  const mapCentre = () => (props.mapCenter ? props.mapCenter() : null)
  function useMapCentre() {
    const c = mapCentre()
    if (!c) return
    setField('latitude', String(Number(c.latitude.toFixed(5))))
    setField('longitude', String(Number(c.longitude.toFixed(5))))
  }

  const canLaunch = () => !pending()

  // ── launch ────────────────────────────────────────────────────────────
  function launch() {
    if (guard.isPending()) return
    setAttempted(true)
    setFailure(null)
    const { payload, ok } = built()
    if (!ok) return

    // A simulation sends nothing; the shell plays it.
    if (simulated()) {
      props.onSimulate && props.onSimulate(payload)
      return
    }
    // A real launch while a simulation is on screen returns to the
    // supervisor first, so its frames are not dropped as another incident's.
    if (props.simulating) props.onExitSimulation && props.onExitSimulation()

    const run = guard.run(() => triggerEvent(payload, {
      url: props.sensorUrl,
      capabilities: effectiveCaps(),
    }))
    if (!run) return

    run.then(
      (result) => {
        if (!alive) return
        props.onLaunched && props.onLaunched(result, payload)
      },
      (err) => {
        if (!alive) return
        if (!(err instanceof LaunchError)) {
          setFailure({ text: `Unexpected error: ${String((err && err.message) || err)}`, certain: false })
          return
        }
        if (err.kind === 'invalid') {
          for (const [path, reason] of Object.entries(err.fields || {})) {
            setServerFields(path, String(reason))
          }
        }
        const target = props.sensorTarget || props.sensorUrl
        const extra = {
          busy:        ' Wait for it to complete before launching another.',
          conflict:    ' Generate a new ID and launch again.',
          invalid:     ' The fields it named are marked below.',
          unreachable: ` Nothing answered at ${target}.`,
          gateway:     props.viaDevProxy ? ' The development proxy could not reach the supervisor.' : '',
          rejected:    '',
        }[err.kind] || ''
        setFailure({ text: `${err.message}${extra}`, certain: CERTAIN_NOTHING.has(err.kind) || (err.kind === 'rejected' && err.status >= 400) })
      },
    )
  }

  onMount(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        props.onClose && props.onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  // ── summary of what will be sent (only when it would be accepted here) ──
  const summary = () => (built().ok ? built().payload : null)

  return (
    <div class="ilm-scrim" onClick={() => props.onClose && props.onClose()}>
      <div
        class="ilm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Launch incident"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="ilm-head">
          <div class="ilm-head__text">
            <h2 class="ilm-head__title">Launch incident</h2>
            <p class="ilm-head__sub">
              {simulated()
                ? 'Play a simulated incident in this browser.'
                : 'Send a sensor reading to the supervisor.'}
            </p>
          </div>
          <button
            type="button"
            class="ilm-close"
            aria-label="Close"
            onClick={() => props.onClose && props.onClose()}
          >
            <Icon markup={closeIcon} />
          </button>
        </header>

        <div class="ilm-body">
          <div class="ilm-form">
            {/* ── Place and where it runs ─────────────────────────────── */}
            <div class="ilm-row">
              <span class="ilm-label">Place</span>
              <Segmented
                label="Place"
                value={presetKey() ?? 'custom'}
                options={PRESET_OPTIONS}
                onChange={applyPreset}
              />
            </div>
            <div class="ilm-row">
              <span class="ilm-label">Runs on</span>
              <Segmented
                label="Runs on"
                value={source()}
                options={SOURCE_OPTIONS}
                onChange={(key) => setSourceChoice(key)}
              />
            </div>
            <p class="ilm-note" classList={{ 'ilm-note--sim': simulated(), 'ilm-note--warn': !simulated() && !!point() && !pointArea() }}>
              {sourceNote()}
            </p>

            {/* ── Identity ─────────────────────────────────────────────── */}
            <div class="ilm-grid">
              <label class="ilm-field">
                <span class="ilm-label">Event ID</span>
                <span class="ilm-inline">
                  <input
                    type="text"
                    class="ilm-input"
                    classList={{ 'is-invalid': !!errorFor('event_id') }}
                    value={draft.event_id}
                    spellcheck={false}
                    autocomplete="off"
                    aria-invalid={!!errorFor('event_id')}
                    onInput={(e) => setField('event_id', e.currentTarget.value)}
                    onBlur={() => touch('event_id')}
                  />
                  <button type="button" class="ilm-btn ilm-btn--quiet" onClick={newId}>
                    New ID
                  </button>
                </span>
                <span class="ilm-field__note" classList={{ 'is-error': !!errorFor('event_id') }}>
                  {errorFor('event_id') || 'Letters, digits, . _ : - (max 64)'}
                </span>
              </label>

              <label class="ilm-field">
                <span class="ilm-label">Timestamp (Unix ms)</span>
                <span class="ilm-inline">
                  <input
                    type="text"
                    inputmode="numeric"
                    class="ilm-input"
                    classList={{ 'is-invalid': !!errorFor('timestamp') }}
                    value={draft.timestamp}
                    aria-invalid={!!errorFor('timestamp')}
                    onInput={(e) => setField('timestamp', e.currentTarget.value)}
                    onBlur={() => touch('timestamp')}
                  />
                  <button type="button" class="ilm-btn ilm-btn--quiet" onClick={stampNow}>
                    Now
                  </button>
                </span>
                <span class="ilm-field__note" classList={{ 'is-error': !!errorFor('timestamp') }}>
                  {errorFor('timestamp') || timestampIso() || 'Integer > 0'}
                </span>
              </label>
            </div>

            {/* ── Type ─────────────────────────────────────────────────── */}
            <div class="ilm-row">
              <span class="ilm-label">Disaster type</span>
              <Segmented
                label="Disaster type"
                value={draft.disaster_type}
                options={typeOptions()}
                onChange={(key) => setField('disaster_type', key)}
              />
            </div>
            <Show when={errorFor('disaster_type')}>
              <p class="ilm-field__note is-error">{errorFor('disaster_type')}</p>
            </Show>
            <Show when={caps() === undefined}>
              <p class="ilm-note">Reading this supervisor's capabilities…</p>
            </Show>
            <Show when={caps() === null}>
              <p class="ilm-note">
                The supervisor's capabilities could not be read, so only earthquake is offered.
                The supervisor validates the type when the reading arrives.
              </p>
            </Show>
            <Show when={unsupportedTypes().length > 0}>
              <p class="ilm-note">
                {unsupportedTypes().map((key) => TYPE_LABELS[key] || key).join(' and ')}: not
                supported by this supervisor.
              </p>
            </Show>
            <Show when={comingSoonTypes().length > 0}>
              <p class="ilm-note">
                {comingSoonTypes().map((key) => TYPE_LABELS[key] || key).join(' and ')} simulations:
                coming soon. The simulation only models earthquakes today.
              </p>
            </Show>

            {/* ── Measurements ─────────────────────────────────────────── */}
            <div class="ilm-row">
              <span class="ilm-label">Epicentre and measurements</span>
              <button
                type="button"
                class="ilm-btn ilm-btn--quiet"
                disabled={!mapCentre()}
                title="Fill latitude and longitude from the centre of the map view"
                onClick={useMapCentre}
              >
                Use map centre
              </button>
            </div>
            <div class="ilm-grid">
              <For each={NUMERIC_FIELDS}>
                {(field) => (
                  <label class="ilm-field">
                    <span class="ilm-label">{LABELS[field]()}</span>
                    <input
                      type="text"
                      inputmode="decimal"
                      class="ilm-input"
                      classList={{ 'is-invalid': !!errorFor(field) }}
                      value={draft[field]}
                      aria-invalid={!!errorFor(field)}
                      onInput={(e) => setField(field, e.currentTarget.value)}
                      onBlur={() => touch(field)}
                    />
                    <span class="ilm-field__note" classList={{ 'is-error': !!errorFor(field) }}>
                      {errorFor(field) || hints()[field]}
                    </span>
                  </label>
                )}
              </For>
            </div>

            {/* ── Risks ────────────────────────────────────────────────── */}
            <div class="ilm-row">
              <span class="ilm-label">Aftershock risk</span>
              <Segmented
                label="Aftershock risk"
                value={draft.aftershock_risk}
                options={RISK_OPTIONS}
                onChange={(key) => setField('aftershock_risk', key)}
              />
            </div>
            <Show when={errorFor('aftershock_risk')}>
              <p class="ilm-field__note is-error">{errorFor('aftershock_risk')}</p>
            </Show>

            <div class="ilm-row">
              <span class="ilm-label">Tsunami risk</span>
              <Segmented
                label="Tsunami risk"
                value={String(draft.tsunami_risk)}
                options={TSUNAMI_OPTIONS}
                onChange={(key) => setField('tsunami_risk', key)}
              />
            </div>
            <Show when={errorFor('tsunami_risk')}>
              <p class="ilm-field__note is-error">{errorFor('tsunami_risk')}</p>
            </Show>
          </div>

          {/* ── What is about to be sent ─────────────────────────────── */}
          <Show when={summary()}>
            {(p) => (
              <dl class="ilm-summary">
                <div class="ilm-summary__row">
                  <dt>Runs on</dt>
                  <dd>{simulated() ? 'Simulation in this browser (synthetic data)' : 'Supervisor (real pipeline)'}</dd>
                </div>
                <div class="ilm-summary__row">
                  <dt>Event</dt>
                  <dd>{p().event_id}</dd>
                </div>
                <div class="ilm-summary__row">
                  <dt>Epicentre</dt>
                  <dd>{fmt.coords(p().epicenter.latitude, p().epicenter.longitude)}</dd>
                </div>
                <div class="ilm-summary__row">
                  <dt>Impact radius</dt>
                  <dd>{fmt.distance(p().radius_km, 1)}</dd>
                </div>
                <div class="ilm-summary__row">
                  <dt>Severity</dt>
                  <dd>{severityLabel(p().disaster_type, p().severity)}</dd>
                </div>
                <div class="ilm-summary__row">
                  <dt>Depth</dt>
                  <dd>{fmt.distance(p().depth_km, 1)}</dd>
                </div>
                <div class="ilm-summary__row">
                  <dt>Risks</dt>
                  <dd>
                    Aftershock {p().aftershock_risk.toLowerCase()}
                    {p().tsunami_risk ? ' · tsunami risk' : ' · no tsunami risk'}
                  </dd>
                </div>
                <div class="ilm-summary__row">
                  <dt>Zones</dt>
                  <dd>
                    Red {fmt.band('red', p().radius_km, bands())} · orange{' '}
                    {fmt.band('orange', p().radius_km, bands())} · green{' '}
                    {fmt.band('green', p().radius_km, bands())}
                  </dd>
                </div>
              </dl>
            )}
          </Show>

          <Show when={otherServerErrors().length > 0}>
            <ul class="ilm-warn is-error ilm-warn--list">
              <For each={otherServerErrors()}>
                {([path, reason]) => <li>{path}: {reason}</li>}
              </For>
            </ul>
          </Show>

          <Show when={failure()}>
            {(f) => (
              <p class="ilm-warn is-error" role="alert">
                {f().certain ? 'Nothing was launched. ' : ''}
                {f().text}
                {f().certain
                  ? ''
                  : ' The supervisor may or may not have received it. Retrying with the same ID is safe: an identical repeat is answered as a duplicate.'}
              </p>
            )}
          </Show>
        </div>

        <footer class="ilm-foot">
          <Show
            when={!simulated()}
            fallback={
              <p class="ilm-foot__target">
                <span class="ilm-label">Simulation</span>
                <span class="ilm-foot__url">Runs in this browser. Nothing is sent.</span>
              </p>
            }
          >
            <p class="ilm-foot__target">
              <span class="ilm-label">Sensor endpoint</span>
              {/* The absolute target, never the relative "/sensor" the dev proxy
                  is given: a path tells the operator nothing about WHICH
                  supervisor is about to be handed an incident. */}
              <span class="ilm-foot__url">{props.sensorTarget || props.sensorUrl}</span>
              <Show when={props.viaDevProxy}>
                <span class="ilm-foot__hint">Development proxy</span>
              </Show>
            </p>
          </Show>
          <div class="ilm-foot__actions">
            <button type="button" class="ilm-btn" onClick={() => props.onClose && props.onClose()}>
              Cancel
            </button>
            <button
              type="button"
              class="ilm-btn ilm-btn--primary"
              disabled={!canLaunch()}
              aria-busy={pending()}
              onClick={launch}
            >
              <Show when={pending()} fallback={simulated() ? 'Run simulation' : 'Launch incident'}>
                Launching…
              </Show>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
