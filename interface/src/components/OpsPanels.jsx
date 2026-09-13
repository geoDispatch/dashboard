// Left-overlay panels for the rail's non-map views.
//
// The rail switches what floats over the top-left of the map. "Map" shows
// DeviceDetails; Rescue, Devices, Shelters and the notification bell show the
// panels below. They are driven entirely by the selectors and the supervisor's
// event_context, so they are real views over the same store the map is drawing
// — not placeholders.
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
import { DASH, maskPhone, num, percent } from '../lib/format'
import { useDisplay } from '../lib/settings'
import { agoText, enumLabel, reachabilityText, useT } from '../lib/i18n'

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
  const t = useT()
  const word = () => {
    if (!ZONE_LABELS[props.zone]) return DASH
    return t(`zone.${props.zone}`)
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

function priorityText(device, t) {
  if (!isNumber(device.rescue_priority)) return DASH
  if (device.rescue_priority <= 0) return t('device.priorityNone')
  return `P${device.rescue_priority}`
}

// `fmt` and `t` come from the panel, not from module scope: the operator's
// units and language are context and a module-level helper cannot read them.
function distanceText(device, fmt) {
  if (!isNumber(device.distance_km)) return DASH
  return fmt.distance(device.distance_km)
}

export function RescuePanel(props) {
  const fmt = useDisplay()
  const t = useT()
  const queue = () => props.queue || []
  const shown = () => queue().slice(0, RESCUE_LIMIT)

  return (
    <>
      <Card title={t('ops.rescueQueue')} meta={t('ops.flaggedCount', num(queue().length))}>
        <Show
          when={queue().length > 0}
          fallback={<p class="ops-empty">{t('ops.rescueEmpty')}</p>}
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
                        {t('distance.fromEpicenter', distanceText(device, fmt))} · {reachabilityText(t, device)}
                        <Show when={device.rescue_status === 'failed'}>
                          {' '}· {enumLabel(t, 'rescueStatus', device.rescue_status)}
                        </Show>
                      </span>
                    </span>
                    <span class="ops-row__side">
                      <ZoneWord zone={device.zone} />
                      <span class="ops-row__pri">{t('ops.priority', priorityText(device, t))}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>

          <Show when={queue().length > shown().length}>
            <p class="ops-note">
              {t('ops.showingFirst', num(shown().length), num(queue().length))}
            </p>
          </Show>
          <p class="ops-note">{t('ops.rescueOrder')}</p>
        </Show>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Devices — selectors.counts() + selectors.zoneGroups()
// ---------------------------------------------------------------------------

export function DevicesPanel(props) {
  const t = useT()
  const counts = () => props.counts || { total: 0 }
  const groups = () => props.groups || []

  return (
    <>
      <Card title={t('ops.devices')} meta={t('ops.locatedCount', num(counts().total))}>
        <Show
          when={counts().total > 0}
          fallback={<p class="ops-empty">{t('ops.devicesEmpty')}</p>}
        >
          <div class="ops-stats">
            <StatRow label={t('ops.locatedLabel')} value={num(counts().total)} />
            <StatRow
              label={t('ops.reachable')}
              value={`${num(counts().reachable)} · ${percent(counts().reachableRate, 0)}`}
            />
            <StatRow label={t('ops.unreachable')} value={num(counts().unreachable)} />
            <StatRow label={t('ops.aiDecided')} value={num(counts().decided)} />
            <StatRow label={t('ops.aiFailed')} value={num(counts().decisionFailed)} />
            <StatRow label={t('ops.smsAccepted')} value={num(counts().sms)} />
            <StatRow label={t('ops.smsFailed')} value={num(counts().smsFailed)} />
            <Show when={counts().smsNotConfigured > 0}>
              <StatRow
                label={t('ops.smsNoGateway')}
                value={num(counts().smsNotConfigured)}
              />
            </Show>
            <StatRow label={t('ops.rescueFlagged')} value={num(counts().rescue)} />
          </div>
        </Show>
      </Card>

      <Card title={t('ops.byZone')} meta={t('ops.devicesCount', num(counts().total))}>
        <Show
          when={counts().total > 0}
          fallback={<p class="ops-empty">{t('ops.devicesEmpty')}</p>}
        >
          <ul class="ops-list">
            <For each={groups()}>
              {(group) => (
                <li class="ops-list__item">
                  <div class="ops-row ops-row--static">
                    <span class="ops-row__main">
                      <span class="ops-row__title">
                        <ZoneWord zone={group.zone} />
                      </span>
                      <span class="ops-row__sub">
                        {t('ops.zoneSub', num(group.reachable), num(group.rescue))}
                      </span>
                    </span>
                    <span class="ops-row__side">
                      <span class="ops-row__pri">{t('ops.devicesCount', num(group.total))}</span>
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
          <p class="ops-note">{t('ops.noPlaceNames')}</p>
        </Show>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Shelters — event_context.shelters, as the supervisor looked them up
// ---------------------------------------------------------------------------

// The database holds a capacity and nothing about occupancy, so there is no
// "space free" or "full" to show — only what the record says.
function shelterSub(shelter, t) {
  const parts = []
  if (shelter.address) parts.push(shelter.address)
  parts.push(t('ops.capacity', isNumber(shelter.capacity) ? num(shelter.capacity) : DASH))
  return parts.join(' · ')
}

function shelterDistance(shelter, fmt, t) {
  if (!isNumber(shelter.distance_km)) return DASH
  return t('distance.fromEpicenter', fmt.distance(shelter.distance_km))
}

const hasPoint = (shelter) =>
  isNumber(shelter?.location?.latitude) && isNumber(shelter?.location?.longitude)

export function SheltersPanel(props) {
  const fmt = useDisplay()
  const t = useT()
  const shelters = () => props.shelters || []

  // Why the list is empty, when it is. Four different facts, four sentences.
  const emptyText = () => {
    if (!props.hasEvent) return t('ops.noIncident')
    if (props.status === 'unavailable') return t('ops.sheltersUnavailable')
    if (!props.status) return t('ops.sheltersWaiting')
    return t('ops.sheltersEmpty')
  }

  return (
    <>
      <Card title={t('ops.shelters')} meta={t('ops.listedCount', num(shelters().length))}>
        <Show
          when={shelters().length > 0}
          fallback={<p class="ops-empty">{emptyText()}</p>}
        >
          <ul class="ops-list">
            <For each={shelters()}>
              {(shelter) => (
                <li class="ops-list__item">
                  <button
                    type="button"
                    class="ops-row"
                    disabled={!hasPoint(shelter)}
                    onClick={() => props.onFocus && props.onFocus(shelter)}
                  >
                    <span class="ops-row__main">
                      <span class="ops-row__title">{shelter.name}</span>
                      <span class="ops-row__sub">{shelterSub(shelter, t)}</span>
                    </span>
                    <span class="ops-row__side">
                      <span class="ops-row__pri">{shelterDistance(shelter, fmt, t)}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <p class="ops-note">
            {props.simulated ? t('ops.sheltersSimNote') : t('ops.sheltersNote')}{' '}
            {t('ops.noOccupancy')}
          </p>
        </Show>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Errors — selectors.errorGroups(), opened from the notification bell
// ---------------------------------------------------------------------------

// ERROR_SEVERITY decides which codes are known; the words come from the
// dictionary, whose English is held equal to ERROR_SEVERITY's by i18n.test.js.
function errorReads(code, t) {
  if (!ERROR_SEVERITY[code]) return t('error.unknown')
  return t(`error.${code}`)
}

export function ErrorsPanel(props) {
  const t = useT()
  const groups = () => props.groups || []
  const total = () => props.total || 0

  return (
    <>
      <Card title={t('ops.errors')} meta={t('ops.receivedCount', num(total()))}>
        <Show
          when={groups().length > 0}
          fallback={<p class="ops-empty">{t('ops.errorsEmpty')}</p>}
        >
          <ul class="ops-list">
            <For each={groups()}>
              {(group) => (
                <li class="ops-list__item">
                  <div class="ops-row ops-row--static" classList={{ 'is-fatal': group.fatal }}>
                    <span class="ops-row__main">
                      <span class="ops-row__title">{errorReads(group.code, t)}</span>
                      <span class="ops-row__sub">
                        {t('ops.errorSub', group.code, agoText(t, group.latest && group.latest.receivedAt))}
                      </span>
                    </span>
                    <span class="ops-row__side">
                      <Show when={group.fatal}>
                        <span class="ops-row__word is-full">{t('ops.fatal')}</span>
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
              {t('ops.clearList')}
            </button>
          </div>
          <p class="ops-note">{t('ops.clearNote')}</p>
        </Show>
      </Card>
    </>
  )
}
