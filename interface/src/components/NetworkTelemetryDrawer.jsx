// Network telemetry — what the carrier side of the pipeline is doing to us.
//
// Every number here comes from two places the supervisor already sends:
// `error` frames, and the `reachable` boolean on `device_update`. Nothing is
// derived from a field the contract does not carry — there is no congestion
// level, no QoS state and no delivery rate on the wire, and this drawer would
// rather be short than invent them.
//
// The framing matters. An operator does not need to know that CAMARA_TIMEOUT
// is an error code; they need to know that some people were not found. Each
// counter says both, in that order.
//
// Times are client arrival times. The supervisor stamps almost every frame
// with 0 (agent.md §6.3), so everything here says "received", never "occurred".
//
// SolidJS: props are never destructured, lists go through <For>, branches
// through <Show>.

import { For, Show, createMemo, onCleanup, onMount } from 'solid-js'

import { DASH, ago, maskPhone, num, percent } from '../lib/format'

import closeIcon from '../assets/icons/settings-close.svg?raw'

import './NetworkTelemetryDrawer.css'

// The five codes the contract can send, in the order an operator cares about
// them: the ones that cost a person first, the ones that cost the system last.
//
// AGENT_ERROR is not carrier telemetry, but it arrives in the same stream and
// a code with no counter would leave entries in the list below that nothing
// on this screen accounts for.
const CODES = [
  {
    code: 'CAMARA_TIMEOUT',
    title: 'Carrier query timed out',
    // NOT "never placed". The supervisor makes two CAMARA calls per device —
    // location and reachability — and a timeout on either one produces this
    // code. A device whose location came back and whose reachability check
    // timed out is on the map, marked unreachable. The only honest statement
    // is that something about that device is missing.
    blurb: 'A location or reachability call to the carrier did not answer in time. Those devices may be missing from the map, or on it with incomplete detail.',
    surface: 'carrier',
  },
  {
    code: 'SMS_FAILED',
    title: 'Evacuation SMS not delivered',
    // NOT "accepted and then dropped". The supervisor emits this whenever its
    // send attempt fails, which covers a refusal at submission, a transport
    // error, and a gateway that accepted and then dropped it. The console
    // cannot tell those apart and should not pick one.
    blurb: 'The send failed. The message text and the reason are not forwarded here, so which stage failed is not visible.',
    surface: 'carrier',
  },
  {
    code: 'QOS_FAILED',
    title: 'QoS boost refused',
    blurb: 'Quality on Demand was not granted. Dispatch continued at standard priority.',
    surface: 'carrier',
  },
  {
    code: 'AGENT_ERROR',
    title: 'Batch got no decision',
    blurb: 'The AI agent failed on a batch of up to twenty devices. They are on the map, uncounted.',
    surface: 'pipeline',
  },
  {
    code: 'DB_ERROR',
    title: 'PostGIS unreachable',
    blurb: 'Shelter lookups and event logging failed. This one stops the pipeline.',
    surface: 'pipeline',
  },
]

const RECENT_LIMIT = 12

export default function NetworkTelemetryDrawer(props) {
  const errors = () => props.errors || []
  const counts = () => props.counts || null

  // Counted here rather than taken from selectors.errorGroups(), because this
  // screen needs a row for every known code including the ones at zero — a
  // missing QOS_FAILED row and a QOS_FAILED row reading 0 say opposite things.
  const tally = createMemo(() => {
    const byCode = {}
    for (const entry of errors()) {
      byCode[entry.code] = (byCode[entry.code] || 0) + 1
    }
    return byCode
  })

  const unknownCodes = createMemo(() => {
    const known = new Set(CODES.map((c) => c.code))
    return Object.keys(tally()).filter((code) => !known.has(code))
  })

  // Newest first. state.errors is append-ordered and capped at 200 upstream,
  // so this is a slice of the tail rather than a sort of everything.
  const recent = createMemo(() => errors().slice(-RECENT_LIMIT).reverse())

  const reachable = () => (counts() ? counts().reachable : 0)
  const unreachable = () => (counts() ? counts().unreachable : 0)
  const located = () => (counts() ? counts().total : 0)

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
    <div class="ntd-scrim" onClick={() => props.onClose && props.onClose()}>
      <aside
        class="ntd"
        role="dialog"
        aria-modal="true"
        aria-label="Network telemetry"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="ntd-head">
          <div class="ntd-head__text">
            <h2 class="ntd-head__title">Network telemetry</h2>
            <p class="ntd-head__sub">Nokia CAMARA and pipeline faults, as they arrive</p>
          </div>
          <button
            type="button"
            class="ntd-close"
            aria-label="Close network telemetry"
            onClick={() => props.onClose && props.onClose()}
          >
            <span class="ntd-icon" innerHTML={closeIcon} aria-hidden="true" />
          </button>
        </header>

        <div class="ntd-body">
          {/* ── Reachability ─────────────────────────────────────────────── */}
          <section class="ntd-card" aria-label="Reachability">
            <h3 class="ntd-card__title">Carrier reachability</h3>

            <Show
              when={located() > 0}
              fallback={
                <p class="ntd-empty">
                  No devices located yet. Reachability appears as the supervisor works
                  through the impact radius.
                </p>
              }
            >
              <div class="ntd-split">
                <div class="ntd-split__figure">
                  <span class="ntd-split__value">{num(reachable())}</span>
                  <span class="ntd-split__label">Answering</span>
                </div>
                <div class="ntd-split__figure">
                  <span class="ntd-split__value is-red">{num(unreachable())}</span>
                  <span class="ntd-split__label">Off the network</span>
                </div>
                <div class="ntd-split__figure">
                  <span class="ntd-split__value">
                    {counts() && counts().reachableRate !== null
                      ? percent(counts().reachableRate, 0)
                      : DASH}
                  </span>
                  <span class="ntd-split__label">Reachable rate</span>
                </div>
              </div>

              <span class="ntd-bar" aria-hidden="true">
                <span
                  class="ntd-bar__fill"
                  style={{ width: `${located() ? (reachable() / located()) * 100 : 0}%` }}
                />
              </span>

              <p class="ntd-note">
                A device is reachable when the carrier reports CONNECTED_DATA or
                CONNECTED_SMS. Anything else is a person the network cannot warn. The AI
                decides which of them are flagged for rescue and can flag outside the red
                zone; this console shows the flags it was sent rather than inferring them
                from the band.
              </p>
            </Show>
          </section>

          {/* ── Fault counters ───────────────────────────────────────────── */}
          <section class="ntd-card" aria-label="Faults">
            <div class="ntd-card__head">
              <h3 class="ntd-card__title">Faults by code</h3>
              <span class="ntd-card__meta">{num(errors().length, '0')} received</span>
            </div>

            <ul class="ntd-codes">
              <For each={CODES}>
                {(item) => (
                  <li
                    class="ntd-code"
                    classList={{
                      'is-quiet': !tally()[item.code],
                      'is-fatal': item.code === 'DB_ERROR' && !!tally()[item.code],
                    }}
                  >
                    <div class="ntd-code__text">
                      <span class="ntd-code__title">{item.title}</span>
                      <span class="ntd-code__blurb">{item.blurb}</span>
                      <span class="ntd-code__id">
                        {item.code}
                        <span class="ntd-code__surface">
                          {item.surface === 'carrier' ? 'carrier' : 'pipeline'}
                        </span>
                      </span>
                    </div>
                    <span class="ntd-code__count">{num(tally()[item.code] || 0)}</span>
                  </li>
                )}
              </For>
            </ul>

            <Show when={unknownCodes().length > 0}>
              <p class="ntd-note is-warn">
                <For each={unknownCodes()}>
                  {(code, index) => (
                    <>
                      {index() > 0 ? ', ' : ''}
                      {code}
                    </>
                  )}
                </For>
                {' '}
                arrived and is not in the contract this console was built against. It is
                counted in the total and listed below, but nothing here knows what it means.
              </p>
            </Show>
          </section>

          {/* ── Recent warnings ──────────────────────────────────────────── */}
          <section class="ntd-card" aria-label="Recent warnings">
            <div class="ntd-card__head">
              <h3 class="ntd-card__title">Recent</h3>
              <Show when={errors().length > 0}>
                <button
                  type="button"
                  class="ntd-clear"
                  onClick={() => props.onClear && props.onClear()}
                >
                  Clear
                </button>
              </Show>
            </div>

            <Show
              when={recent().length > 0}
              fallback={
                <p class="ntd-empty">
                  Nothing reported. Timeouts and failed sends land here as the supervisor
                  hits them — expect dozens in a real event.
                </p>
              }
            >
              <ul class="ntd-list">
                <For each={recent()}>
                  {(entry) => (
                    <li class="ntd-item" classList={{ 'is-fatal': !!entry.fatal }}>
                      <div class="ntd-item__top">
                        <span class="ntd-item__code">{entry.code}</span>
                        <span class="ntd-item__time">{ago(entry.receivedAt)}</span>
                      </div>
                      <p class="ntd-item__message">{entry.message || DASH}</p>
                      <Show
                        when={entry.phone}
                        fallback={<p class="ntd-item__phone is-none">Not device-specific</p>}
                      >
                        {(phone) => <p class="ntd-item__phone">{maskPhone(phone())}</p>}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>

              <Show when={errors().length > recent().length}>
                <p class="ntd-note">
                  Showing the {num(recent().length)} most recent of {num(errors().length)}.
                  Times are when this console received the frame, not when the fault
                  happened — the supervisor does not stamp them.
                </p>
              </Show>
            </Show>
          </section>

          {/* ── What is missing, said out loud ───────────────────────────── */}
          <p class="ntd-gap">
            Congestion level, QoS state and SMS delivery rate are read from CAMARA by the
            supervisor to make its own decisions, and are not forwarded to this console.
            They are absent here rather than estimated.
          </p>
        </div>
      </aside>
    </div>
  )
}
