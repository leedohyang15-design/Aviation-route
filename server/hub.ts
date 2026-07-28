// The hub is the single source of truth. It owns:
//   1. the live aircraft snapshot (from whichever FlightFeed is active), and
//   2. the PresentationState (selection / filter / rotation / overlays).
// Every window connects here over WebSocket; commands mutate PresentationState
// and are rebroadcast so all windows — including late joiners — stay in sync.

import { WebSocketServer, WebSocket } from 'ws'
import type {
  Aircraft,
  ClientMessage,
  PresentationState,
  ServerMessage
} from '../src/shared/types'
import { DEFAULT_PRESENTATION_STATE } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { createMockFeed } from './mock'
import { createOpenSkyFeed, hasOpenSkyCredentials } from './opensky'
import { HUB_PORT } from '../src/shared/config'

export interface Hub {
  close(): void
}

/** Choose the feed: real OpenSky when credentials exist (and FEED!=mock). */
export function selectFeed(): FlightFeed {
  if (process.env.FEED === 'mock') {
    console.log('[hub] FEED=mock is set — forcing mock feed (unset it to use OpenSky)')
    return createMockFeed()
  }
  if (hasOpenSkyCredentials()) {
    console.log('[hub] OpenSky credentials present — using OpenSky feed')
    return createOpenSkyFeed()
  }
  console.warn('[hub] No OPENSKY_CLIENT_ID/SECRET — using mock feed.')
  return createMockFeed()
}

export function startHub(port = HUB_PORT, feed: FlightFeed = selectFeed()): Hub {
  // Bind explicitly to the IPv4 loopback so it always matches the windows'
  // ws://127.0.0.1 client (avoids IPv6/dual-stack mismatch and the Windows
  // firewall prompt that a 0.0.0.0 bind would trigger).
  const wss = new WebSocketServer({ port, host: '127.0.0.1' })

  wss.on('listening', () => console.log('[hub] window can now connect'))
  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[hub] port ${port} is already in use — a previous run is still alive. ` +
          `Close all Electron/node processes and start again.`
      )
    } else {
      console.error('[hub] server error:', err.message)
    }
  })

  const state: PresentationState = structuredClone(DEFAULT_PRESENTATION_STATE)
  let aircraft: Aircraft[] = []
  let connected = false

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }
  const broadcast = (msg: ServerMessage) => {
    const payload = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload)
    }
  }

  const sendRoute = (ws: WebSocket | null) => {
    const icao24 = state.selected
    const points = icao24 ? feed.getRoute(icao24) : null
    const msg: ServerMessage = { type: 'route', icao24: icao24 ?? '', points }
    if (ws) send(ws, msg)
    else broadcast(msg)
  }

  feed.start(
    (snapshot) => {
      aircraft = snapshot
      broadcast({ type: 'aircraft', mode: 'full', data: aircraft, serverTime: Date.now() })
      broadcast({ type: 'status', source: feed.source, connected, count: aircraft.length })
    },
    (isConnected) => {
      connected = isConnected
    }
  )

  wss.on('connection', (ws) => {
    console.log(`[hub] window connected (${wss.clients.size} total)`)
    // Bring the new window fully up to date immediately.
    send(ws, { type: 'state', state })
    send(ws, { type: 'aircraft', mode: 'full', data: aircraft, serverTime: Date.now() })
    send(ws, { type: 'status', source: feed.source, connected, count: aircraft.length })
    sendRoute(ws)

    ws.on('message', (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      applyCommand(msg)
    })
  })

  function applyCommand(msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello':
        return
      case 'select':
        state.selected = msg.icao24
        broadcast({ type: 'state', state })
        sendRoute(null)
        return
      case 'setFilter':
        state.filter = msg.filter
        broadcast({ type: 'state', state })
        return
      case 'setRotation':
        state.lonOffset = msg.lonOffset
        broadcast({ type: 'state', state })
        return
      case 'toggleOverlay':
        state.overlays[msg.key] = msg.value ?? !state.overlays[msg.key]
        broadcast({ type: 'state', state })
        return
    }
  }

  console.log(`[hub] listening on ws://127.0.0.1:${port} (feed: ${feed.source})`)

  return {
    close() {
      feed.stop()
      wss.close()
    }
  }
}
