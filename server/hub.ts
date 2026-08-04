// The hub is the single source of truth. It owns:
//   1. the live aircraft snapshot (from whichever FlightFeed is active), and
//   2. the PresentationState (selection / filter / rotation / overlays).
// Every window connects here over WebSocket; commands mutate PresentationState
// and are rebroadcast so all windows — including late joiners — stay in sync.

import { WebSocketServer, WebSocket } from 'ws'
import type {
  Aircraft,
  ClientMessage,
  FlightDetail,
  ExhibitMode,
  PresentationState,
  ServerMessage
} from '../src/shared/types'
import { DEFAULT_PRESENTATION_STATE } from '../src/shared/types'
import { hasOpenSkyCredentials, onDetailEnriched } from './opensky'
import { createResilientFeed, type SwitchableFeed } from './resilient'
import { HUB_PORT } from '../src/shared/config'
import { withDeadline } from './http'
import { opsLog } from './log'
import {
  hasRoute,
  resolveRoutes,
  loadRouteCache,
  saveRouteCache,
  startRouteResolver,
  stopRouteResolver
} from './routes'
import { isKnownFlight } from '../src/common/flightClass'
import {
  initSatellites,
  startSatellites,
  stopSatellites,
  snapshot as satSnapshot,
  getDetail as satDetail
} from './satellites'

export interface Hub {
  close(): void
}

/** Longest a selection may wait for enrichment before the windows are answered
 * anyway. Comfortably above the individual call timeouts, so it only fires when
 * something has gone wrong in a way those didn't catch. */
const DETAIL_DEADLINE_MS = 8000

/**
 * The feed is always the switchable resilient one: it polls OpenSky when
 * credentials exist, keeps a simulation running underneath as a fallback, and
 * lets the operator pin simulation from the control window.
 */
export function selectFeed(): SwitchableFeed {
  const feed = createResilientFeed()
  if (hasOpenSkyCredentials()) {
    opsLog('[hub] OpenSky credentials present — using live data (simulation fallback on stall)')
  } else {
    opsLog('[hub] No OPENSKY_CLIENT_ID/SECRET — simulation only.')
  }
  if (process.env.FEED === 'mock') {
    opsLog('[hub] FEED=mock is set — starting in simulation mode')
    feed.setMode('mock')
  }
  return feed
}

export function startHub(port = HUB_PORT, feed: SwitchableFeed = selectFeed()): Hub {
  // Yesterday's answers are almost all still valid, so start from the saved
  // cache instead of re-asking adsbdb for every callsign.
  loadRouteCache()
  // Lookups run on their own clock, independent of the OpenSky poll cycle.
  startRouteResolver()
  // Orbital elements load in the background; satellite mode waits on nothing.
  void initSatellites()
  // Bind explicitly to the IPv4 loopback so it always matches the windows'
  // ws://127.0.0.1 client (avoids IPv6/dual-stack mismatch and the Windows
  // firewall prompt that a 0.0.0.0 bind would trigger).
  const wss = new WebSocketServer({ port, host: '127.0.0.1' })

  wss.on('listening', () => opsLog('[hub] window can now connect'))
  // opsLog, not console.error: the packaged exe has no console, so a hub that
  // fails to bind used to leave NOTHING in the log — and because this listener
  // marks the error handled, the crash dialog in electron/main.ts never fired
  // either. Both windows just sat on "connecting" with no way to find out why.
  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      opsLog(
        `[hub] FATAL: port ${port} is already in use — a previous run is still alive. ` +
          `The windows will never connect. Close all Electron/node processes and start again.`
      )
    } else {
      opsLog(`[hub] FATAL: server error: ${err.message} — the windows will never connect.`)
    }
  })

  const state: PresentationState = structuredClone(DEFAULT_PRESENTATION_STATE)
  // FEED=mock starts the feed in simulation; keep the broadcast state in step.
  if (process.env.FEED === 'mock') state.feedMode = 'mock'
  // Whether live data is even possible, so the windows can tell "still
  // connecting" apart from "no credentials configured".
  const hasCreds = hasOpenSkyCredentials()
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
  // The last detail that actually said something about the selection. During
  // holdSelection's grace window the aircraft is gone from the feed's own map,
  // so buildDetail returns a shell with no callsign, airline, endpoints or ETA —
  // and the card and the dome fall back to "정보가 없는 비행기예요", which is the
  // exact blanking the grace window exists to prevent.
  let lastGoodDetail: FlightDetail | null = null
  const saysSomething = (d: FlightDetail | null): boolean =>
    !!d && (!!d.route || !!d.origin || !!d.destination || !!d.airline)

  const sendDetail = async (ws: WebSocket | null) => {
    const icao24 = state.selected
    try {
      // Hard deadline. The enrichment calls have their own timeouts now, but a
      // selection is a visitor-facing action and must never be able to hang on
      // anything: if it does, send what we have and let the next poll's refresh
      // fill it in. This is the last line of defence, not the first.
      const detail = icao24
        ? await withDeadline(feed.getDetail(icao24), DETAIL_DEADLINE_MS, () => {
            opsLog(`[detail] ${icao24} timed out after ${DETAIL_DEADLINE_MS}ms — sending without detail`)
            return null
          })
        : null
      // Which feed answered. If a real aircraft is on screen but this says
      // "mock", the detail came from the simulation and can never have a route.
      if (icao24) opsLog(`[detail] feed=${feed.source} points=${detail?.route?.length ?? 0}`)
      if (state.selected !== icao24) return // selection changed mid-fetch
      let out = detail
      if (saysSomething(out)) {
        lastGoodDetail = out
      } else if (icao24 && lastGoodDetail?.icao24 === icao24 && missedSnapshots > 0) {
        // Missing from this snapshot only: keep showing what it was showing.
        out = lastGoodDetail
      }
      const route: ServerMessage = { type: 'route', icao24: icao24 ?? '', points: out?.route ?? null }
      const det: ServerMessage = { type: 'detail', detail: out }
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

  // Tag each aircraft with what we know about its route, and queue the ones we
  // haven't asked about yet. Only real data needs this — the simulation always
  // knows its own routes — and only identifiable callsigns are worth asking
  // about, which keeps the lookup volume down.
  const annotateRoutes = (snapshot: Aircraft[]): Aircraft[] => {
    if (feed.source === 'mock') return snapshot
    const pending: { callsign: string; lat: number; lon: number }[] = []
    const out = snapshot.map((a) => {
      if (!isKnownFlight(a.callsign, a.hasRoute)) return a
      const known = hasRoute(a.callsign)
      if (known === undefined) pending.push({ callsign: a.callsign, lat: a.lat, lon: a.lon })
      return known === undefined ? a : { ...a, hasRoute: known }
    })
    // Queue only; the resolver loop drains it in the background and results
    // land in the cache for a later snapshot.
    if (pending.length) resolveRoutes(pending)
    // How much of the sky actually has a route to draw. "Why does nothing show
    // a route" is answerable from this line alone: all-unknown means the lookup
    // hasn't caught up, all-none means the callsigns genuinely have no route,
    // and a healthy split with nothing on screen points somewhere else entirely.
    let withRoute = 0
    let without = 0
    for (const a of out) {
      if (a.hasRoute === true) withRoute++
      else if (a.hasRoute === false) without++
    }
    opsLog(
      `[routes] ${out.length} aircraft — ${withRoute} route / ${without} none / ` +
        `${out.length - withRoute - without} not looked up yet`
    )
    return out
  }

  // Satellites are propagated locally once a second; only broadcast them while
  // that's the layer on screen, so flight mode carries no extra traffic.
  const onSatellites = () => {
    if (state.mode !== 'satellite') return
    broadcast({ type: 'satellites', data: satSnapshot(), serverTime: Date.now() })
    if (state.selected) broadcast({ type: 'satDetail', detail: satDetail(state.selected) })
  }

  /** Drop the current selection and clear every trace of it on both windows. */
  function clearSelection(why: string): void {
    lastGoodDetail = null
    if (!state.selected) return
    opsLog(`[hub] selection ${state.selected} ${why} — cleared`)
    state.selected = null
    missedSnapshots = 0
    broadcast({ type: 'state', state })
    broadcast({ type: 'route', icao24: '', points: null })
    broadcast({ type: 'detail', detail: null })
  }

  /**
   * A selected aircraft that is no longer in the snapshot has to be released.
   *
   * Nothing used to do this, and the consequence was the reported "nothing
   * appears when I click a plane": the exhibit spends its first minute on the
   * simulation while OpenSky's first poll is in flight, the attract cycle picks
   * a simulated aircraft, and then live data replaces the whole fleet. That
   * simulated icao24 exists in no later snapshot, but `state.selected` stayed
   * pinned to it — so the control's card (which is looked up by id in the
   * current snapshot) vanished and never came back, while the hub went on
   * asking for the detail of an aircraft that wasn't there.
   *
   * Two consecutive misses rather than one: an aircraft dropping out of
   * coverage for a single poll is ordinary, and releasing the visitor's
   * selection for that would be its own bug.
   */
  let missedSnapshots = 0
  let lastSelectedState: Aircraft | null = null
  function holdSelection(snapshot: Aircraft[]): Aircraft[] {
    if (!state.selected) {
      missedSnapshots = 0
      lastSelectedState = null
      return snapshot
    }
    const here = snapshot.find((a) => a.icao24 === state.selected)
    if (here) {
      missedSnapshots = 0
      lastSelectedState = here
      return snapshot
    }
    if (++missedSnapshots >= 2) {
      clearSelection('left the snapshot')
      return snapshot
    }
    // Inside the grace period: carry the last known state through, so a plane
    // that blinks out for one poll doesn't blank the card for the whole
    // interval — which on live data is a minute and a half. The renderer already
    // dead-reckons from the last position, so this is the state it was showing
    // anyway; it just no longer has to throw the aircraft away to do it.
    return lastSelectedState ? [...snapshot, lastSelectedState] : snapshot
  }

  function applyMode(next: ExhibitMode): void {
    state.mode = next
    state.selected = null // an icao24 means nothing to the other layer
    if (next === 'satellite') {
      feed.setPaused(true)
      startSatellites(onSatellites)
    } else {
      stopSatellites()
      feed.setPaused(false)
    }
    broadcast({ type: 'state', state })
    // Clear the other layer's selection artefacts on both screens.
    broadcast({ type: 'route', icao24: '', points: null })
    broadcast({ type: 'detail', detail: null })
    broadcast({ type: 'satDetail', detail: null })
  }

  // The simulation and live data share no aircraft, so a handover invalidates
  // the selection outright — don't wait for the two-snapshot grace period.
  feed.onSourceChange = () => clearSelection('belonged to the previous feed')

  // The aircraft type arrives after the card has already gone out (it is never
  // waited on). When it lands for whatever is on screen, send the detail again
  // so the TYPE tile fills itself in.
  onDetailEnriched((icao24) => {
    if (state.selected === icao24) void sendDetail(null)
  })

  feed.start(
    (snapshot) => {
      aircraft = holdSelection(annotateRoutes(snapshot))
      if (state.mode !== 'flight') return
      broadcast({ type: 'aircraft', mode: 'full', data: aircraft, serverTime: Date.now() })
      broadcast({ type: 'status', source: feed.source, connected, count: aircraft.length, credentials: hasCreds })
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
    if (state.mode === 'satellite') {
      const sats = satSnapshot()
      send(ws, { type: 'satellites', data: sats, serverTime: Date.now() })
      if (state.selected) {
        const d = satDetail(state.selected)
        send(ws, { type: 'satDetail', detail: d })
        // The orbit line too — it only goes out on select, so a window that
        // connects (or reconnects) afterwards would otherwise never get it.
        send(ws, { type: 'route', icao24: state.selected, points: d?.track ?? null })
      }
    } else {
      send(ws, { type: 'aircraft', mode: 'full', data: aircraft, serverTime: Date.now() })
      void sendDetail(ws)
    }
    send(ws, { type: 'status', source: feed.source, connected, count: aircraft.length, credentials: hasCreds })

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

  /** Whether this id names something on the layer currently being shown. */
  function belongsToLayer(id: string): boolean {
    if (state.mode === 'satellite') return satDetail(id) != null
    // An aircraft that has just blinked out of one snapshot is still the
    // visitor's selection (see holdSelection), so the grace window counts too.
    return aircraft.some((a) => a.icao24 === id) || lastSelectedState?.icao24 === id
  }

  function applyCommand(msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello':
        return
      case 'select': {
        // An id only means something to the layer it came from. A window whose
        // mode change hasn't landed yet — or whose attract cycle fires in the
        // gap — will happily offer an aircraft while the exhibit is showing
        // satellites, and the hub used to accept it and broadcast that
        // aircraft's flight path over the orbit map. Reject anything that isn't
        // on the layer currently on screen.
        if (msg.icao24 && !belongsToLayer(msg.icao24)) {
          opsLog(`[hub] select ${msg.icao24} ignored — not on the ${state.mode} layer`)
          return
        }
        // Log what arrived, and whether the hub can even see that aircraft.
        // Without this there is no way to tell a click that never reached the
        // hub from one that did but had nothing to show.
        const found = msg.icao24 ? aircraft.find((a) => a.icao24 === msg.icao24) : null
        opsLog(
          msg.icao24
            ? `[hub] select ${msg.icao24} ${found ? `(${found.callsign || 'no callsign'})` : '— NOT in the current snapshot'}`
            : '[hub] select cleared'
        )
        missedSnapshots = 0
        // Remember it now, not on the next poll: a plane selected moments before
        // it blinks out would otherwise have nothing to carry through the gap.
        lastSelectedState = found ?? null
        state.selected = msg.icao24
        broadcast({ type: 'state', state })
        if (state.mode === 'satellite') {
          const d = msg.icao24 ? satDetail(msg.icao24) : null
          broadcast({ type: 'satDetail', detail: d })
          broadcast({ type: 'route', icao24: msg.icao24 ?? '', points: d?.track ?? null })
        } else {
          void sendDetail(null)
        }
        return
      }
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
      case 'setMode':
        if (msg.mode !== state.mode) applyMode(msg.mode)
        return
      case 'setHiddenOrbits':
        state.hiddenOrbits = msg.orbits
        broadcast({ type: 'state', state })
        return
      case 'setFeedMode':
        state.feedMode = msg.mode
        feed.setMode(msg.mode)
        broadcast({ type: 'state', state })
        // Report the switch immediately so the source label doesn't wait for the
        // next poll (live polls can be 90s apart).
        broadcast({ type: 'status', source: feed.source, connected, count: aircraft.length, credentials: hasCreds })
        return
    }
  }

  console.log(`[hub] listening on ws://127.0.0.1:${port} (feed: ${feed.source})`)

  return {
    close() {
      feed.stop()
      stopSatellites()
      stopRouteResolver()
      saveRouteCache()
      wss.close()
    }
  }
}
