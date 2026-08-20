import { For } from 'solid-js'

export default function ErrorToast({ errors, onDismiss }) {
  return (
    <div class="toast-container">
      <For each={errors}>
        {(err, i) => (
          <div class={`toast ${err.fatal ? 'toast-fatal' : 'toast-warning'}`}>
            <div class="toast-header">
              <span>{err.fatal ? '🔴 CRITICAL' : '⚠️ WARNING'} — {err.code}</span>
              <button class="toast-close" onClick={() => onDismiss(i())}>✕</button>
            </div>
            <div class="toast-body">
              {err.message}
              {err.phone && <span class="toast-phone"> ({err.phone})</span>}
            </div>
          </div>
        )}
      </For>
    </div>
  )
}