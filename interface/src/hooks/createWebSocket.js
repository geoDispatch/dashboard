import { createSignal, onCleanup } from 'solid-js'
import { WS_URL } from '../constants/zones'

export function createWebSocket(onMessage) {
  const [connected, setConnected] = createSignal(false)
  const [error, setError]         = createSignal(null)

  let ws

  function connect() {
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      setConnected(true)
      setError(null)
      console.log('[WS] connected')
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        onMessage(msg)
      } catch (err) {
        console.error('[WS] bad message:', err)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      console.warn('[WS] disconnected — retrying in 3s')
      setTimeout(connect, 3000) // auto-reconnect
    }

    ws.onerror = (e) => {
      setError('WebSocket connection failed')
      console.error('[WS] error:', e)
    }
  }

  connect()

  onCleanup(() => {
    ws?.close()
  })

  return { connected, error }
}