// Incident launcher — the one control in this console that writes.
//
// Everything else here observes: the socket is server-to-client only and the
// dashboard never talks back to the pipeline. This dialog is the exception,
// and it is not an exception to that rule so much as a different conversation:
// it POSTs a SensorInput to the supervisor's /sensor route, which is the same
// thing the seismic sensor does. The supervisor then decides whether an event
// happens. Nothing here dispatches an SMS, flags a rescue, or touches a device.
//
// What it saves is a terminal. Starting a scenario used to mean
// `go run ./scripts/simulation/simulate_disaster_morocco.go` on the supervisor
// host, which is not a thing anyone does mid-demo.
//
// SolidJS: props are never destructured, lists go through <For>, branches
// through <Show>.

import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'

import { triggerEvent } from '../lib/socket'
import { buildLaunchPayload, depthFor, makeEventId } from '../lib/launch'
import { useDisplay } from '../lib/settings'
import { decimal } from '../lib/format'

import closeIcon from '../assets/icons/settings-close.svg?raw'
import checkIcon from '../assets/icons/settings-check.svg?raw'

import './IncidentLauncherModal.css'

// The two rehearsed scenarios. Both are real places with real fault lines
// under them; the numbers are the ones the team demos with.
const PRESETS = [
  {
    key: 'al-haouz',
    name: 'Al Haouz earthquake',
    where: 'High Atlas, south of Marrakech',
    idPrefix: 'AL-HAOUZ',
    payload: {
      disaster_type: 'earthquake',
      severity: 6.8,
      epicenter: { latitude: 31.11, longitude: -8.41 },
      radius_km: 50,
      aftershock_risk: 'HIGH',
      tsunami_risk: false,
    },
  },
  {
    key: 'casablanca',
    name: 'Casablanca seismic shock',
    where: 'Casablanca-Settat, coastal',
    idPrefix: 'CASA',
    payload: {
      disaster_type: 'earthquake',
      severity: 6.2,
      epicenter: { latitude: 33.5731, longitude: -7.5898 },
      radius_km: 15,
      aftershock_risk: 'MEDIUM',
      tsunami_risk: false,
    },
  },
  {
    key: 'custom',
    name: 'Custom scenario',
    where: 'Choose the epicentre, reach and severity',
    idPrefix: 'CUSTOM',
    payload: null,
  },
]

const DISASTER_TYPES = [
  { key: 'earthquake', label: 'Earthquake' },
  { key: 'flood',      label: 'Flood' },
  { key: 'heatwave',   label: 'Heatwave' },
]

const RISKS = [
  { key: 'LOW',    label: 'Low' },
  { key: 'MEDIUM', label: 'Medium' },
  { key: 'HIGH',   label: 'High' },
]

// Every field is validated before the button unlocks. A supervisor that
// receives a latitude of 931 will do something with it, and none of the
// somethings are good.
const RULES = {
  latitude:  { min: -90,  max: 90,  label: 'Latitude',  hint: '-90 to 90' },
  longitude: { min: -180, max: 180, label: 'Longitude', hint: '-180 to 180' },
  radius_km: { min: 0.1,  max: 500, label: 'Impact radius', hint: '0.1 to 500 km', unit: 'km' },
  severity:  { min: 0,    max: 10,  label: 'Severity',  hint: '0 to 10' },
}

function Icon(props) {
  return <span class="ilm-icon" innerHTML={props.markup} aria-hidden="true" />
}

// Named FieldToggle, not Switch: the Solid compiler claims <Switch> for its own
// control flow and silently swaps out any component of that name.
function FieldToggle(props) {
  return (
    <button
      type="button"
      role="switch"
      class="ilm-toggle"
      classList={{ 'is-on': !!props.checked }}
      aria-checked={props.checked ? 'true' : 'false'}
      aria-label={props.label}
      onClick={() => props.onChange && props.onChange(!props.checked)}
    >
      <span class="ilm-toggle__knob" aria-hidden="true" />
    </button>
  )
}

function Segmented(props) {
  return (
    <div class="ilm-segment" role="group" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="ilm-segment__btn"
            classList={{ 'is-active': props.value === option.key }}
            aria-pressed={props.value === option.key}
            onClick={() => props.onChange && props.onChange(option.key)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

export default function IncidentLauncherModal(props) {
  const fmt = useDisplay()

  const [selected, setSelected] = createSignal('al-haouz')
  const [status, setStatus] = createSignal({ state: 'idle', message: null })

  // Custom scenario. A store rather than five signals: it is one object that
  // gets read as a whole when the payload is built.
  const [custom, setCustom] = createStore({
    disaster_type: 'earthquake',
    latitude: '31.11',
    longitude: '-8.41',
    radius_km: '50',
    severity: '6.8',
    aftershock_risk: 'MEDIUM',
    tsunami_risk: false,
  })

  const isCustom = () => selected() === 'custom'
  const preset = () => PRESETS.find((p) => p.key === selected()) || PRESETS[0]

  // ── validation ────────────────────────────────────────────────────────
  const numberOf = (raw) => {
    const trimmed = String(raw).trim()
    if (!trimmed) return null
    const value = Number(trimmed)
    return Number.isFinite(value) ? value : null
  }

  function errorFor(field) {
    const rule = RULES[field]
    const value = numberOf(custom[field])
    if (value === null) return 'Enter a number'
    // Worded differently from the hint on purpose: the note slot shows one or
    // the other, and "-90 to 90" turning red is a weaker signal than a sentence
    // that is plainly a correction.
    if (value < rule.min || value > rule.max) return `Must be ${rule.hint}`
    return null
  }

  const customErrors = createMemo(() => {
    const out = {}
    for (const field of Object.keys(RULES)) {
      const problem = errorFor(field)
      if (problem) out[field] = problem
    }
    return out
  })

  const canLaunch = () =>
    status().state !== 'sending' && (!isCustom() || Object.keys(customErrors()).length === 0)

  // ── the scenario that will be sent ────────────────────────────────────
  //
  // The summary below renders from this, and lib/launch.js turns it into the
  // SensorInput. Two things that are NOT decided here: the event id and
  // depth_km, both of which are stamped once at the moment a launch begins.
  const scenario = createMemo(() => {
    if (!isCustom()) return { ...preset().payload, idPrefix: preset().idPrefix }
    return {
      idPrefix: preset().idPrefix,
      disaster_type: custom.disaster_type,
      severity: numberOf(custom.severity),
      epicenter: {
        latitude: numberOf(custom.latitude),
        longitude: numberOf(custom.longitude),
      },
      radius_km: numberOf(custom.radius_km),
      aftershock_risk: custom.aftershock_risk,
      tsunami_risk: !!custom.tsunami_risk,
    }
  })

  async function launch() {
    if (!canLaunch()) return

    // ONE id and ONE timestamp per attempt, taken here and carried through the
    // payload, the request and the confirmation. Deriving them further down
    // would let the summary, the POST body and the note disagree about which
    // incident had just been started.
    const now = Date.now()
    const body = buildLaunchPayload(scenario(), {
      now,
      eventId: makeEventId(preset().idPrefix, now),
    })

    setStatus({ state: 'sending', message: null })
    try {
      // triggerEvent throws unless /sensor answers 2xx, so reaching the next
      // line is the only thing that counts as "launched". A request that was
      // merely sent is not a request that was accepted.
      const sent = await triggerEvent(body, { url: props.sensorUrl })
      setStatus({ state: 'idle', message: null })
      props.onLaunched && props.onLaunched(sent)
    } catch (err) {
      // Three different failures that all look the same from a form:
      //
      //   TypeError    the request never reached anything — wrong host,
      //                nothing listening, or a refused CORS preflight.
      //                "Failed to fetch" tells an operator nothing; the
      //                address does.
      //   502/503/504  the dev proxy answered because the supervisor did not.
      //                Blaming the supervisor for "refusing" it would be
      //                wrong — it never saw the request.
      //   anything     the supervisor really did answer, and said no.
      //   else
      const raw = String((err && err.message) || err)
      const target = props.sensorTarget || props.sensorUrl
      const gateway = /\b(502|503|504)\b/.test(raw)

      setStatus({
        state: 'failed',
        message: err instanceof TypeError
          ? `Nothing answered at ${target}.`
          : gateway
            ? `No response from ${target}. The development proxy could not reach the supervisor.`
            : `Supervisor rejected the request: ${raw}.`,
      })
    }
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
            <p class="ilm-head__sub">Send a sensor reading to the supervisor.</p>
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
          {/* ── Scenario ─────────────────────────────────────────────────── */}
          <div class="ilm-presets" role="radiogroup" aria-label="Scenario">
            <For each={PRESETS}>
              {(item) => (
                <button
                  type="button"
                  role="radio"
                  class="ilm-preset"
                  classList={{ 'is-active': selected() === item.key }}
                  aria-checked={selected() === item.key}
                  onClick={() => setSelected(item.key)}
                >
                  <span class="ilm-preset__top">
                    <span class="ilm-preset__name">{item.name}</span>
                    <Show when={selected() === item.key}>
                      <span class="ilm-preset__tick" aria-hidden="true">
                        <Icon markup={checkIcon} />
                      </span>
                    </Show>
                  </span>
                  <span class="ilm-preset__where">{item.where}</span>
                </button>
              )}
            </For>
          </div>

          {/* ── Custom form ──────────────────────────────────────────────── */}
          <Show when={isCustom()}>
            <div class="ilm-form">
              <div class="ilm-row">
                <span class="ilm-label">Disaster type</span>
                <Segmented
                  label="Disaster type"
                  value={custom.disaster_type}
                  options={DISASTER_TYPES}
                  onChange={(key) => setCustom('disaster_type', key)}
                />
              </div>

              <div class="ilm-grid">
                <For each={['latitude', 'longitude', 'radius_km', 'severity']}>
                  {(field) => (
                    <label class="ilm-field">
                      <span class="ilm-label">
                        {RULES[field].label}
                        <Show when={RULES[field].unit}>
                          {(unit) => <span class="ilm-label__unit"> ({unit()})</span>}
                        </Show>
                      </span>
                      <input
                        type="text"
                        inputmode="decimal"
                        class="ilm-input"
                        classList={{ 'is-invalid': !!customErrors()[field] }}
                        value={custom[field]}
                        aria-invalid={!!customErrors()[field]}
                        onInput={(e) => setCustom(field, e.currentTarget.value)}
                      />
                      <span
                        class="ilm-field__note"
                        classList={{ 'is-error': !!customErrors()[field] }}
                      >
                        {customErrors()[field] || RULES[field].hint}
                      </span>
                    </label>
                  )}
                </For>
              </div>

              <div class="ilm-row">
                <span class="ilm-label">
                  Aftershock risk
                  <Show when={custom.disaster_type !== 'earthquake'}>
                    <span class="ilm-label__unit"> (required for all disaster types)</span>
                  </Show>
                </span>
                <Segmented
                  label="Aftershock risk"
                  value={custom.aftershock_risk}
                  options={RISKS}
                  onChange={(key) => setCustom('aftershock_risk', key)}
                />
              </div>

              <div class="ilm-row">
                <span class="ilm-label">Tsunami risk</span>
                <FieldToggle
                  label="Tsunami risk"
                  checked={custom.tsunami_risk}
                  onChange={(value) => setCustom('tsunami_risk', value)}
                />
              </div>

              <p class="ilm-note">
                Depth is set automatically: 10.5 km for earthquakes, 0 for floods and heatwaves.
              </p>
            </div>
          </Show>

          {/* ── What is about to be sent ─────────────────────────────────── */}
          <Show when={!isCustom() || Object.keys(customErrors()).length === 0}>
            <dl class="ilm-summary">
              <div class="ilm-summary__row">
                <dt>Epicentre</dt>
                <dd>{fmt.coords(scenario().epicenter.latitude, scenario().epicenter.longitude)}</dd>
              </div>
              <div class="ilm-summary__row">
                <dt>Impact radius</dt>
                <dd>{fmt.distance(scenario().radius_km, 0)}</dd>
              </div>
              <div class="ilm-summary__row">
                <dt>Severity</dt>
                <dd>
                  {scenario().disaster_type === 'earthquake'
                    ? `M ${decimal(scenario().severity, 1)}`
                    : decimal(scenario().severity, 1)}
                </dd>
              </div>
              <div class="ilm-summary__row">
                <dt>Risks</dt>
                <dd>
                  Aftershock {scenario().aftershock_risk.toLowerCase()}
                  {scenario().tsunami_risk ? ' · tsunami warning' : ' · no tsunami'}
                </dd>
              </div>
              <div class="ilm-summary__row">
                <dt>Depth</dt>
                <dd>
                  {scenario().disaster_type === 'earthquake'
                    ? `${depthFor(scenario().disaster_type)} km`
                    : '0 (not applicable)'}
                </dd>
              </div>
              <div class="ilm-summary__row">
                <dt>Zones</dt>
                <dd>
                  Red {fmt.band('red', scenario().radius_km)} · orange{' '}
                  {fmt.band('orange', scenario().radius_km)} · green{' '}
                  {fmt.band('green', scenario().radius_km)}
                </dd>
              </div>
            </dl>
          </Show>

          {/* ── Honesty about where this lands ───────────────────────────── */}
          <Show when={props.source === 'demo'}>
            <p class="ilm-warn">
              The map is showing the bundled demo. This launch is sent to the endpoint below,
              but its frames appear only after switching to Connected supervisor.
            </p>
          </Show>

          <Show when={status().state === 'failed'}>
            <p class="ilm-warn is-error" role="alert">
              Nothing was launched. {status().message}
            </p>
          </Show>
        </div>

        <footer class="ilm-foot">
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
          <div class="ilm-foot__actions">
            <button type="button" class="ilm-btn" onClick={() => props.onClose && props.onClose()}>
              Cancel
            </button>
            <button
              type="button"
              class="ilm-btn ilm-btn--primary"
              disabled={!canLaunch()}
              onClick={launch}
            >
              <Show when={status().state === 'sending'} fallback="Launch incident">
                Launching…
              </Show>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
