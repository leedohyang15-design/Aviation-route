// Thin typed WebSocket client used by both renderer windows. Auto-reconnects so
// the exhibit survives a hub restart without anyone touching the machine.

import type { ClientMessage, ServerMessage } from './types'

type Handler = (msg: ServerMessage) => void
type StatusHandler = (connected: boolean) => void

export class Bus {
  private ws: WebSocket | null = null
  private handlers = new Set<Handler>()
  private statusHandlers = new Set<StatusHandler>()
  private queue: ClientMessage[] = []
  private closed = false
  private reconnectDelay = 500

  constructor(
    private readonly url: string,
    private readonly role: 'control' | 'display'
  ) {}

  connect(): void {
    if (this.closed) return
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = 500
      this.send({ type: 'hello', role: this.role })
      // Flush anything queued while disconnected.
      for (const m of this.queue.splice(0)) this.rawSend(m)
      this.statusHandlers.forEach((h) => h(true))
    }

    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      this.handlers.forEach((h) => h(msg))
    }

    ws.onclose = () => {
      this.statusHandlers.forEach((h) => h(false))
      if (this.closed) return
      const delay = this.reconnectDelay
      this.reconnectDelay = Math.min(delay * 2, 8000)
      setTimeout(() => this.connect(), delay)
    }

    ws.onerror = () => ws.close()
  }

  onMessage(h: Handler): () => void {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }

  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h)
    return () => this.statusHandlers.delete(h)
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rawSend(msg)
    } else {
      this.queue.push(msg)
    }
  }

  private rawSend(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg))
  }

  dispose(): void {
    this.closed = true
    this.ws?.close()
  }
}
