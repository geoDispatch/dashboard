import { createSignal, onCleanup, onMount, Show } from 'solid-js'

import logoLockup from '../assets/icons/geo-dispatch-logo.svg?raw'
import './EntryGate.css'

const INTRO_EXIT_MS = 1650
const INTRO_COMPLETE_MS = 2150

export default function EntryGate(props) {
  const [introExiting, setIntroExiting] = createSignal(false)
  const [introComplete, setIntroComplete] = createSignal(false)
  const [badgeId, setBadgeId] = createSignal('')
  const [accessKey, setAccessKey] = createSignal('')
  const [keepSession, setKeepSession] = createSignal(false)
  const [message, setMessage] = createSignal('')

  let badgeInput
  let exitTimer
  let completeTimer

  function focusBadge() {
    requestAnimationFrame(() => badgeInput?.focus())
  }

  onMount(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setIntroComplete(true)
      focusBadge()
      return
    }

    exitTimer = window.setTimeout(() => setIntroExiting(true), INTRO_EXIT_MS)
    completeTimer = window.setTimeout(() => {
      setIntroComplete(true)
      focusBadge()
    }, INTRO_COMPLETE_MS)
  })

  onCleanup(() => {
    window.clearTimeout(exitTimer)
    window.clearTimeout(completeTimer)
  })

  function submit(event) {
    event.preventDefault()
    const badge = badgeId().trim()

    if (!badge || !accessKey()) {
      setMessage('Enter your operator ID and access key.')
      if (!badge) badgeInput?.focus()
      return
    }

    // This repository has no authentication endpoint. The values deliberately
    // die with this component; only the optional tab-session flag is retained.
    setAccessKey('')
    props.onEnter?.({ keepSession: keepSession() })
  }

  function explainRecovery() {
    setMessage('Key recovery is not available yet.')
  }

  return (
    <section class="entry-gate" aria-label="GeoDispatch operator access">
      <Show when={!introComplete()}>
        <div
          class="entry-intro"
          classList={{ 'is-exiting': introExiting() }}
          aria-hidden={introExiting() ? 'true' : undefined}
        >
          <div class="entry-intro__brand">
            <span
              class="entry-intro__lockup"
              role="img"
              aria-label="GeoDispatch"
              innerHTML={logoLockup}
            />
            <span class="entry-intro__pulse" aria-hidden="true" />
          </div>
          <p class="entry-intro__line">Emergency operations console</p>
        </div>
      </Show>

      <div
        class="entry-login"
        classList={{ 'is-visible': introComplete() }}
        aria-hidden={introComplete() ? undefined : 'true'}
        inert={!introComplete()}
      >
        <div class="entry-login__card" role="dialog" aria-modal="true" aria-labelledby="entry-title">
          <header class="entry-login__header">
            <span
              class="entry-login__lockup"
              role="img"
              aria-label="GeoDispatch"
              innerHTML={logoLockup}
            />
            <h1 id="entry-title" class="entry-login__title">Operator access</h1>
            <p class="entry-login__subtitle">Emergency operations</p>
          </header>

          <form class="entry-form" onSubmit={submit} novalidate>
            <label class="entry-field">
              <span class="entry-field__label">Operator badge ID or email</span>
              <input
                ref={badgeInput}
                class="entry-field__input"
                type="text"
                value={badgeId()}
                placeholder="e.g. DISPATCH-092"
                autocomplete="username"
                autocapitalize="off"
                spellcheck={false}
                aria-invalid={message() && !badgeId().trim() ? 'true' : undefined}
                onInput={(event) => {
                  setBadgeId(event.currentTarget.value)
                  setMessage('')
                }}
              />
            </label>

            <label class="entry-field">
              <span class="entry-field__label">Security access key</span>
              <input
                class="entry-field__input"
                type="password"
                value={accessKey()}
                placeholder="Enter access key"
                autocomplete="current-password"
                aria-invalid={message() && !accessKey() ? 'true' : undefined}
                onInput={(event) => {
                  setAccessKey(event.currentTarget.value)
                  setMessage('')
                }}
              />
            </label>

            <div class="entry-form__options">
              <label class="entry-check">
                <input
                  type="checkbox"
                  checked={keepSession()}
                  onChange={(event) => setKeepSession(event.currentTarget.checked)}
                />
                <span>Keep this tab signed in</span>
              </label>
              <button type="button" class="entry-link" onClick={explainRecovery}>
                Forgot key?
              </button>
            </div>

            <Show when={message()}>
              <p class="entry-form__message" role="alert">{message()}</p>
            </Show>

            <button type="submit" class="entry-submit">
              Enter operations console
            </button>
          </form>

          <p class="entry-login__truth">
            Demo access only. Credentials are not sent, stored, or verified.
          </p>
        </div>
      </div>
    </section>
  )
}
