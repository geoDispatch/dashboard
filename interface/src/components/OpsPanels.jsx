// Left-overlay panels for the rail's non-map views.
//
// The rail switches what floats over the top-left of the map. "Map" shows
// DeviceDetails; Rescue, Devices, Shelters and the notification bell show the
// panels below. They are driven entirely by the existing selectors, so they are
// real views over the same store the map is drawing — not placeholders.
//
// Contract rules enforced here, same as in DeviceDetails:
//   - phone numbers only ever appear through maskPhone();
//   - a zone always carries its WORD, never a bare colour;
//   - a value the supervisor does not send renders DASH plus a muted note —
//     nothing is invented to fill a row;
//   - the AI `reasoning` field is never read.
//
// props is never destructured — that would read each value once and freeze it.

import { For, Show } from 'solid-js'

import { HideButton } from './DeviceDetails'
import { ERROR_SEVERITY, ZONE_COLORS, ZONE_LABELS, ZONE_TEXT } from '../constants/zones'
import { DASH, ago, maskPhone, num, percent, reachabilityLabel } from '../lib/format'
import { useDisplay } from '../lib/settings'

import './OpsPanels.css'

function isNumber(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

// ---------------------------------------------------------------------------
// Shell — the same 400px stack + Hide button geometry DeviceDetails uses, so
// every rail view sits in exactly the same place and the button never moves.
// ---------------------------------------------------------------------------

export function PanelShell(props) {
  return (
    <div class="ops">
      <Show
        when={!props.hidden}
        fallback={<HideButton hidden onClick={() => props.onToggleHidden && props.onToggleHidden()} />}
      >
        <div class="ops__stack" role="region" aria-label={props.label}>
          {props.children}
        </div>
        <HideButton onClick={() => props.onToggleHidden && props.onToggleHidden()} />
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Card(props) {
  return (
    <section class="ops-card">
      <div class="ops-card__head">
        <h2 class="ops-card__title">{props.title}</h2>
        <Show when={props.meta}>
          <span class="ops-card__meta">{props.meta}</span>
        </Show>
      </div>
      {props.children}
    </section>
  )
}

// Colour is only ever the second channel — the word is always drawn.
function ZoneWord(props) {
  const word = () => {
    const label = ZONE_LABELS[props.zone]
    if (!label) return DASH
    return label
  }
  const tone = () => {
    const colour = ZONE_COLORS[props.zone]
    if (!colour) return 'var(--gd-ink-3)'
    return colour
  }

  return (
    <span class="ops-zone" style={{ color: ZONE_TEXT[props.zone] || 'var(--gd-ink-3)' }}>
      <span class="ops-zone__dot" style={{ background: tone() }} aria-hidden="true" />
      {word()}
    </span>
  )
}

function StatRow(props) {
  return (
    <div class="ops-stat">
      <span class="ops-stat__label">{props.label}</span>
      <span class="ops-stat__value" classList={{ 'is-missing': !!props.missing }}>
        {props.value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rescue queue — selectors.rescueQueue()
// ---------------------------------------------------------------------------

const RESCUE_LIMIT = 40

function priorityText(device) {
  if (!isNumber(device.rescue_priority)) return DASH
  if (device.rescue_priority <= 0) return 'None'
  return `P${device.rescue_priority}`
}

// `fmt` comes from the panel, not from module scope: the operator's units are
// context and a module-level helper cannot read it.
function distanceText(device, fmt) {
  if (!isNumber(device.distance_km)) return DASH
  return fmt.distance(device.distance_km)
}

export function RescuePanel(props) {
  const fmt = useDisplay()
  const queue = () => props.queue || []
  const shown = () => queue().slice(0, RESCUE_LIMIT)

  return (
    <>
      <Card title="Rescue queue" meta={`${num(queue().length)} flagged`}>
        <Show
          when={queue().length > 0}
          fallback={<p class="ops-empty">No devices are flagged for rescue.</p>}
        >
          <ul class="ops-list">
            <For each={shown()}>
              {(device) => (
                <li class="ops-list__item">
                  <button
                    type="button"
                    class="ops-row"
                    classList={{ 'is-selected': device.phone === props.selectedPhone }}
                    aria-current={device.phone === props.selectedPhone ? 'true' : undefined}
                    onClick={() => props.onSelect && props.onSelect(device.phone)}
                  >
                    <span class="ops-row__main">
                      <span class="ops-row__title">{maskPhone(device.phone)}</span>
                      <span class="ops-row__sub">
                        {distanceText(device, fmt)} from epicenter · {reachabilityLabel(device)}
                      </span>
                    </span>
                    <span class="ops-row__side">
                      <ZoneWord zone={device.zone} />
                      <span class="ops-row__pri">Priority {priorityText(device)}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>

          <Show when={queue().length > shown().length}>
            <p class="ops-note">
              Showing the first {num(shown().length)} of {num(queue().length)}.
            </p>
          </Show>
          <Show when={queue().length > 0 && !isNumber(shown()[0].rescue_priority)}>
            <p class="ops-note">Priority not provided. Sorted by distance.</p>
          </Show>
        </Show>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Devices — selectors.counts() + selectors.byLocality()
// ---------------------------------------------------------------------------

export function DevicesPanel(props) {
  const counts = () => props.counts || { total: 0 }
  const areas = () => props.areas || []

  return (
    <>
      <Card title="Devices" meta={`${num(counts().total)} located`}>
        <Show
          when={counts().total > 0}
          fallback={<p class="ops-empty">No devices located yet.</p>}
        >
          <div class="ops-stats">
            <StatRow label="Located" value={num(counts().total)} />
            <StatRow
              label="Reachable"
              value={`${num(counts().reachable)} · ${percent(counts().reachableRate, 0)}`}
            />
            <StatRow label="Unreachable" value={num(counts().unreachable)} />
            <StatRow label="SMS sent" value={num(counts().sms)} />
            <StatRow label="Rescue flagged" value={num(counts().rescue)} />
          </div>
        </Show>
      </Card>

      <Card title="By area" meta={`${num(areas().length)} areas`}>
        <Show
          when={areas().length > 0}
          fallback={<p class="ops-empty">No areas yet.</p>}
        >
          <ul class="ops-list">
            <For each={areas()}>
              {(area) => (
                <li class="ops-list__item">
                  <div class="ops-row ops-row--static">
                    <span class="ops-row__main">
                      <span class="ops-row__title">{area.name}</span>
                      <span class="ops-row__sub">
                        {num(area.reachable)} reachable · {num(area.rescue)} rescue
                      </span>
                    </span>
                    <span class="ops-row__side">
                      <ZoneWord zone={area.zone} />
                      <span class="ops-row__pri">{num(area.total)} devices</span>
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
          <p class="ops-note">Area names use the nearest known locality.</p>
        </Show>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Shelters — SHELTERS from the bundled demo scenario
// ---------------------------------------------------------------------------

function occupancyRate(shelter) {
  if (!isNumber(shelter.occupied) || !isNumber(shelter.capacity) || shelter.capacity <= 0) {
    return null
  }
  return shelter.occupied / shelter.capacity
}

function occupancyText(shelter) {
  if (!isNumber(shelter.occupied) || !isNumber(shelter.capacity)) return DASH
  return `${num(shelter.occupied)} of ${num(shelter.capacity)}`
}

function capacityWord(shelter) {
  const rate = occupancyRate(shelter)
  if (rate === null) return DASH
  if (rate >= 1) return 'At capacity'
  if (rate >= 0.9) return 'Nearly full'
  return 'Space free'
}

export function SheltersPanel(props) {
  const shelters = () => props.shelters || []

  return (
    <>
      <Card title="Shelters" meta={`${num(shelters().length)} listed`}>
        <Show
          when={shelters().length > 0}
          fallback={<p class="ops-empty">No shelters are listed for this scenario.</p>}
        >
          <ul class="ops-list">
            <For each={shelters()}>
              {(shelter) => (
                <li class="ops-list__item">
                  <button
                    type="button"
                    class="ops-row"
                    disabled={!isNumber(shelter.latitude)}
                    onClick={() => props.onFocus && props.onFocus(shelter)}
                  >
                    <span class="ops-row__main">
                      <span class="ops-row__title">{shelter.name}</span>
                      <span class="ops-row__sub">
                        {occupancyText(shelter)} · {percent(occupancyRate(shelter), 0)}
                      </span>
                    </span>
                    <span class="ops-row__side">
                      <span
                        class="ops-row__word"
                        classList={{ 'is-full': occupancyRate(shelter) >= 1 }}
                      >
                        {capacityWord(shelter)}
                      </span>
                      <Show
                        when={isNumber(shelter.latitude)}
                        fallback={<span class="ops-row__pri">No coordinates</span>}
                      >
                        <span class="ops-row__pri">Near {shelter.anchor}</span>
                      </Show>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <p class="ops-note">
            Demo data only. Shelter details are not provided by the supervisor.
          </p>
        </Show>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Errors — selectors.errorGroups(), opened from the notification bell
// ---------------------------------------------------------------------------

function errorReads(code) {
  const entry = ERROR_SEVERITY[code]
  if (!entry) return 'Unclassified error from the supervisor'
  return entry.reads
}

export function ErrorsPanel(props) {
  const groups = () => props.groups || []
  const total = () => props.total || 0

  return (
    <>
      <Card title="Errors" meta={`${num(total())} received`}>
        <Show
          when={groups().length > 0}
          fallback={<p class="ops-empty">No errors reported.</p>}
        >
          <ul class="ops-list">
            <For each={groups()}>
              {(group) => (
                <li class="ops-list__item">
                  <div class="ops-row ops-row--static" classList={{ 'is-fatal': group.fatal }}>
                    <span class="ops-row__main">
                      <span class="ops-row__title">{errorReads(group.code)}</span>
                      <span class="ops-row__sub">
                        {group.code} · latest {ago(group.latest && group.latest.receivedAt)}
                      </span>
                    </span>
                    <span class="ops-row__side">
                      <Show when={group.fatal}>
                        <span class="ops-row__word is-full">Fatal</span>
                      </Show>
                      <span class="ops-row__pri">{num(group.count)}</span>
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
          <div class="ops-actions">
            <button type="button" class="ops-btn" onClick={() => props.onClear && props.onClear()}>
              Clear the list
            </button>
          </div>
          <p class="ops-note">Clears this list only.</p>
        </Show>
      </Card>
    </>
  )
}
