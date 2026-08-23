import { createSignal, onCleanup } from 'solid-js'
import { WS_URL } from '../constants/zones'

export function createWebSocket(onMessage) {
  const [connected, setConnected] = createSignal(false)
  const [error, setError]         = createSignal(null)
  let ws

  function connect() {
    console.log('[WS] connecting to:', WS_URL)
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      setConnected(true)
      setError(null)
      console.log('[WS] ✅ connected to', WS_URL)
    }

    ws.onmessage = (e) => {
      console.group('[WS] 📨 message received')
      console.log('raw:', e.data)
      try {
        const msg = JSON.parse(e.data)
        console.log('type:', msg.type)
        console.log('event_id:', msg.event_id)
        console.log('payload:', msg.payload)
        console.groupEnd()
        onMessage(msg)
      } catch (err) {
        console.error('[WS] ❌ bad message:', err)
        console.groupEnd()
      }
    }

    ws.onclose = (e) => {
      setConnected(false)
      console.warn('[WS] ⚠️ disconnected — code:', e.code, 'reason:', e.reason || 'none')
      console.log('[WS] retrying in 3s...')
      setTimeout(connect, 3000)
    }

    ws.onerror = (e) => {
      setError('WebSocket connection failed')
      console.error('[WS] ❌ error event:', e)
      console.error('[WS] readyState:', ws.readyState, '— is the supervisor running on', WS_URL, '?')
    }
  }

  connect()

  onCleanup(() => {
    console.log('[WS] cleanup — closing connection')
    ws?.close()
  })

  return { connected, error }
}