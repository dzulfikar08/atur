import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { isNative, resolveWsUrl } from '@/lib/native'

const WS_PROTOCOL = {
  STEP1: 0x00,
  STEP2: 0x01,
  UPDATE: 0x02,
} as const

export function useCollab(pageId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const doc = new Y.Doc()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = isNative()
      ? resolveWsUrl(`/live/collaboration/${pageId}`)
      : `${protocol}//${window.location.host}/live/collaboration/${pageId}`
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    const updateListener = (update: Uint8Array) => {
      if (ws.readyState === WebSocket.OPEN) {
        const msg = new Uint8Array(1 + update.length)
        msg[0] = WS_PROTOCOL.UPDATE
        msg.set(update, 1)
        ws.send(msg)
      }
    }

    ws.onopen = () => {
      setConnected(true)
      // Send Step1 to request server state
      ws.send(new Uint8Array([WS_PROTOCOL.STEP1]))
    }

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return
      const data = new Uint8Array(event.data)
      if (data.length === 0) return

      const msgType = data[0]
      const payload = data.slice(1)

      switch (msgType) {
        case WS_PROTOCOL.STEP2:
          // Initial state from server
          if (payload.length > 0) {
            Y.applyUpdate(doc, payload)
          }
          break
        case WS_PROTOCOL.UPDATE:
          // Incremental update from another client
          if (payload.length > 0) {
            Y.applyUpdate(doc, payload)
          }
          break
      }
    }

    // Listen for local Y.js updates and send them to the server
    doc.on('update', updateListener)

    ws.onclose = () => {
      setConnected(false)
    }

    // Set ydoc in state so consumers re-render with the doc available
    setYdoc(doc)

    return () => {
      doc.off('update', updateListener)
      ws.close()
      doc.destroy()
      setYdoc(null)
    }
  }, [pageId])

  return { ydoc, connected }
}
