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
import { hasOpenSkyCredentials } from './opensky'
import { createResilientFeed } from './resilient'
import { HUB_PORT } from '../src/shared/config'
import { opsLog } from './log'

export interface Hub {
  close(): void
}

/** Choose the feed: real OpenSky when credentials exist (and FEED!=mock). */
export function selectFeed(): FlightFeed {
  if (process.env.FEED === 'mock') {
    opsLog('[hub] FEED=mock is set — forcing mock feed (unset it to use OpenSky)')
    return createMockFeed()
  }
  if (hasOpenSkyCredentials()) {
    opsLog('[hub] OpenSky credentials present — using OpenSky feed (mock fallback on stall)')
    return createResilientFeed()
  }
  opsLog('[hub] No OPENSKY_CLIENT_ID/SECRET — using mock feed.')
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

  // Fetch the selected aircraft's detail (async: real sources enrich over the
  // network) and push both the route line and the rich detail. Guarding on the
  // selection value (not a shared counter) means concurrent connect-time sends
  // and broadcasts don't cancel each other.
  const sendDetail = async (ws: WebSocket | null) => {
    const icao24 = state.selected
    try {
      const detail = icao24 ? await feed.getDetail(icao24) : null
      if (state.selected !== icao24) return // selection changed mid-fetch
      const route: ServerMessage = { type: 'route', icao24: icao24 ?? '', points: detail?.route ?? null }
      const det: ServerMessage = { type: 'detail', detail }
      if (ws) {
        send(ws, route)
        send(ws, det)
      } else {
        broadcast(route)
        broadcast(det)
      }
    } catch (err) {
      console.error('[hub] getDetail failed:', (err as Error).message)
    }
  }

  feed.start(
    (snapshot) => {
      aircraft = snapshot
      broadcast({ type: 'aircraft', mode: 'full', data: aircraft, serverTime: Date.now() })
      broadcast({ type: 'status', source: feed.source, connected, count: aircraft.length })
      // Keep the selected plane's route/progress/ETA live (e.g. after a mock
      // re-route on arrival) so the old route doesn't linger.
      if (state.selected) void sendDetail(null)
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
    void sendDetail(ws)

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
        void sendDetail(null)
        return
      case 'setFilter':
        state.filter = msg.filter
        broadcast({ type: 'state', state })
        return
      case 'setView':
        state.view = msg.view
        broadcast({ type: 'state', state })
        return
      case 'setDayNight':
        state.dayNightHour = msg.hour
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
