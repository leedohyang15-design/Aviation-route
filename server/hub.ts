// The hub is the single source of truth. It owns:
//   1. the live aircraft snapshot (from whichever FlightFeed is active), and
//   2. the PresentationState (selection / filter / rotation / overlays).
// Every window connects here over WebSocket; commands mutate PresentationState
// and are rebroadcast so all windows — including late joiners — stay in sync.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type {
  Aircraft,
  ClientMessage,
  FlightDetail,
  WeatherFrame,
  WeatherLayer,
  ExhibitMode,
  PresentationState,
  ServerMessage,
  RefreshTarget,
  Settings
} from '../src/shared/types'
import { DEFAULT_PRESENTATION_STATE, SETTINGS_NEED_RESTART } from '../src/shared/types'
import { hasOpenSkyCredentials, onDetailEnriched } from './opensky'
import { createFlightFeed, type PausableFeed } from './resilient'
import { SAT_REPLAY_MAX_AGE_MS } from '../src/shared/config'
import {
  load as loadSettings,
  reset as resetSettings,
  settings,
  update as updateSettings,
  view as settingsView
} from './settings'
import { MARS_PROBES } from '../src/shared/probes'
import { isTargetId } from '../src/shared/mars-future'
import { GALILEAN, GALILEO_PROBE } from '../src/shared/jupiter'
import { tleFetchedAt, tleLastError } from './tle'
import { startMars, stopMars, marsLive } from './mars'
import { withDeadline } from './http'
import { mapsDir } from './datadir'
import { onLogLine, opsLog, recentLog } from './log'
import {
  hasRoute,
  onRouteResolved,
  prioritiseRoutes,
  resolveRoutes,
  loadRouteCache,
  saveRouteCache,
  startRouteResolver,
  stopRouteResolver
} from './routes'
import { isKnownFlight } from '../src/common/flightClass'
import { forceWeatherRefresh, haveFreshFrames, startWeather, stopWeather, weatherFrames } from './weather'
import {
  initSatellites,
  startElementRefresh,
  startSatellites,
  stopElementRefresh,
  stopSatellites,
  snapshot as satSnapshot,
  snapshotAgeMs as satSnapshotAgeMs,
  elementCount as satElementCount,
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
 * OpenSky, and nothing behind it.
 *
 * A simulation used to run underneath and take over whenever real data went
 * stale. A globe covered in aircraft that do not exist is worse than an empty
 * one, and it cost more than it looked: the two sets share no icao24, so every
 * handover invalidated the selection, the route, the card and the camera.
 * Without credentials the sky is simply empty and the status line says so.
 */
export function selectFeed(): PausableFeed {
  const feed = createFlightFeed()
  opsLog(
    hasOpenSkyCredentials()
      ? '[hub] OpenSky credentials present — using live data'
      : '[hub] OpenSky 키 없음 — 비행기 탭이 빕니다. 설정 화면에서 넣고 다시 시작하세요.'
  )
  return feed
}

/*
 * The settings file is read before anything else in the process needs a value
 * from it — the port this very server binds to is one of them.
 */
loadSettings()

/**
 * Serve one planet map, and nothing else.
 *
 * The whole surface is `GET /maps/<one file name>` out of a single folder. The
 * name is checked against a pattern rather than sanitised — a filter that tries
 * to strip `..` out of a path is a filter somebody eventually gets past, while
 * "letters, digits, dash, underscore, one known extension" has no path in it to
 * traverse in the first place. Anything else gets a 404 and no explanation.
 */
const MAP_NAME = /^[a-z0-9_-]+\.(jpe?g|png|webp)$/i
const MAP_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

function serveMap(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/'
  const name = url.startsWith('/maps/') ? decodeURIComponent(url.slice('/maps/'.length)) : ''
  if (req.method !== 'GET' || !MAP_NAME.test(name)) {
    res.writeHead(404).end()
    return
  }
  const file = join(mapsDir(), name)
  let size: number
  try {
    const st = statSync(file)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    res.writeHead(404).end()
    return
  }
  /*
   * CORS, and it is load-bearing rather than boilerplate.
   *
   * The window is loaded from file://, so its origin is opaque, and an image
   * fetched without this would taint the WebGL context the moment it is used as
   * a texture — texImage2D throws and the planet never appears. It is a local
   * loopback server handing out the map files the operator put there
   * themselves, so there is nothing here a page could not already read.
   */
  res.writeHead(200, {
    'Content-Type': MAP_TYPE[extname(name).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  })
  createReadStream(file).pipe(res)
}

export function startHub(port = settings().hubPort, feed: PausableFeed = selectFeed()): Hub {
  // Yesterday's answers are almost all still valid, so start from the saved
  // cache instead of re-asking adsbdb for every callsign.
  loadRouteCache()
  // Lookups run on their own clock, independent of the OpenSky poll cycle.
  startRouteResolver()
  /*
   * Orbital elements load in the background; satellite mode waits on nothing.
   *
   * A real loop, not a fire-and-forget call — the failure case (Celestrak
   * unreachable, no cache to fall back on) used to leave the tab at zero
   * satellites for the rest of the process's life, since nothing was ever
   * going to ask again until an operator noticed and pressed 새로고침 by hand.
   * This retries with backoff on its own and settles onto Celestrak's own
   * daily cadence once it succeeds. The propagation loop (startSatellites)
   * reads `entries` fresh every tick, so elements arriving in the background
   * reach a window that is already sitting on the satellite tab without
   * either loop needing to know about the other.
   */
  startElementRefresh((n) => {
    if (n > 0) opsLog(`[sat] ${n} satellites available to the exhibit`)
  })
  // Bind explicitly to the IPv4 loopback so it always matches the windows'
  // ws://127.0.0.1 client (avoids IPv6/dual-stack mismatch and the Windows
  // firewall prompt that a 0.0.0.0 bind would trigger).
  /*
   * One server, two jobs: the socket the windows talk on, and a static route
   * for the planet maps.
   *
   * The maps cannot live inside the package — see mapsDir() — and a window
   * loaded from file:// cannot read another file:// image into a WebGL texture
   * without tainting it. Serving them over the port that already exists solves
   * both: an ordinary http URL, with CORS set so the texture stays clean.
   */
  const httpServer = createServer((req, res) => serveMap(req, res))
  const wss = new WebSocketServer({ server: httpServer })
  httpServer.listen(port, '127.0.0.1')

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
      // How many route points came back, so an empty card can be told apart
      // from a card whose aircraft simply has no published route.
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
  // haven't asked about yet. Every aircraft here is real, so every one is
  // knows its own routes — and only identifiable callsigns are worth asking
  // about, which keeps the lookup volume down.
  const annotateRoutes = (snapshot: Aircraft[]): Aircraft[] => {
    const pending: { callsign: string; lat: number; lon: number }[] = []
    const out = snapshot.map((a) => {
      if (!isKnownFlight(a.callsign, a.hasRoute)) return a
      const known = hasRoute(a.callsign)
      if (known === undefined) pending.push({ callsign: a.callsign, lat: a.lat, lon: a.lon })
      return known === undefined ? a : { ...a, hasRoute: known }
    })
    /*
     * Queue nearest-to-the-view first.
     *
     * The resolver drains a few callsigns a second and a session opens with
     * several thousand waiting, so the order decides what a visitor sees for
     * the first fifteen minutes. It used to be whatever order the feed listed
     * the world in, which is why turning the globe to the Americas showed a sky
     * with no routes on any of it: those aircraft were simply at the back.
     *
     * Distance from the view's centre is the whole heuristic. It needs no
     * viewport arithmetic and it handles zoom for free — zoomed out, the centre
     * still says which half of the world is being looked at. Longitude is
     * wrapped and weighted by latitude so that "near" means near on the globe
     * rather than near in the numbers.
     */
    if (pending.length) {
      const { centerLon, centerLat } = state.view
      const cosLat = Math.max(0.05, Math.cos((centerLat * Math.PI) / 180))
      const near = (p: { lat: number; lon: number }): number => {
        let dLon = Math.abs(p.lon - centerLon) % 360
        if (dLon > 180) dLon = 360 - dLon
        return (dLon * cosLat) ** 2 + (p.lat - centerLat) ** 2
      }
      const ordered = [...pending].sort((a, b) => near(a) - near(b))
      resolveRoutes(ordered)
      // New arrivals are queued in that order; everything already waiting is
      // re-sorted to match, or the front of the queue would stay whatever the
      // first snapshot of the session put there.
      prioritiseRoutes(ordered.map((p) => p.callsign))
    }
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
  // The orbit line is only true for the moment it was computed: the ground
  // track slides west as the earth turns beneath it, so a line drawn once at
  // selection drifts away from the satellite that is meant to be on it. Cheap
  // to recompute, so it goes out again every so often.
  const ORBIT_REFRESH_MS = 20_000
  let lastOrbitAt = 0
  const onSatellites = () => {
    if (state.mode !== 'satellite') return
    broadcast({
      type: 'satellites',
      data: satSnapshot(),
      serverTime: Date.now(),
      tleAt: tleFetchedAt(),
      tleError: tleLastError()
    })
    if (!state.selected) return
    const d = satDetail(state.selected)
    broadcast({ type: 'satDetail', detail: d })
    if (Date.now() - lastOrbitAt > ORBIT_REFRESH_MS) {
      lastOrbitAt = Date.now()
      broadcast({ type: 'route', icao24: state.selected, points: d?.track ?? null })
    }
  }

  /**
   * Make a settings change take effect NOW, for the things that can.
   *
   * Most of these are read at the point of use, so nothing has to be done —
   * the next satellite tick simply waits the new interval. The two exceptions
   * are loops already asleep on an old timer: bouncing them is what turns a
   * five-minute weather interval into a one-minute one without waiting out the
   * old five minutes first.
   */
  function applySettingChanges(changed: (keyof Settings)[]): void {
    if (changed.includes('satTickMs') && state.mode === 'satellite') {
      stopSatellites()
      startSatellites(onSatellites)
    }
    if (changed.includes('weatherPollMs') || changed.includes('weatherMaxAgeMs')) {
      stopWeather()
      startWeather(onWeather)
      if (state.mode === 'weather') replayWeather()
    }
    const needRestart = changed.filter((k) =>
      (SETTINGS_NEED_RESTART as readonly string[]).includes(k)
    )
    if (needRestart.length) {
      opsLog(`[settings] ${needRestart.join(', ')} — takes effect when the exhibit is restarted`)
    }
  }

  /**
   * Fetch something again, right now.
   *
   * Each of these normally runs on a clock measured in hours — daily for the
   * orbits and the rovers, five-minutely for the weather — which is correct for
   * an exhibit that runs unattended and useless for somebody standing in front
   * of a tab that is visibly wrong. Restarting the whole exhibit was the only
   * lever before this.
   *
   * Every one of them is a stop-and-start of a loop that polls immediately, so
   * there is no second code path to keep in step with the first. Failures are
   * already loud in the log, which is on the tab next door.
   */
  async function refresh(what: RefreshTarget): Promise<void> {
    opsLog(`[hub] 새로고침: ${what}`)
    switch (what) {
      case 'weather':
        // See forceWeatherRefresh: every layer has an "unchanged since last
        // poll, don't bother" shortcut, and without this the restart below
        // would immediately hit it and do nothing — 새로고침 would poll,
        // find nothing new by the clock, and report success having fetched
        // zero bytes.
        forceWeatherRefresh()
        stopWeather()
        startWeather(onWeather)
        return
      case 'tle': {
        // force: skip the freshness rule and actually go and ask Celestrak.
        const n = await initSatellites(undefined, true)
        opsLog(`[hub] 새로고침: 궤도 정보 ${n}개`)
        if (state.mode === 'satellite') {
          stopSatellites()
          startSatellites(onSatellites)
        }
        return
      }
      case 'mars':
        stopMars()
        startMars(() => broadcast({ type: 'marsLive', data: marsLive() }))
        return
      case 'routes':
        // Not a fetch — the resolver never stops. What an operator actually
        // wants here is the aircraft ON SCREEN looked up first.
        prioritiseRoutes(aircraft.map((a) => a.callsign).filter(Boolean))
        opsLog(`[hub] 새로고침: 화면에 있는 ${aircraft.length}대의 노선을 먼저 찾습니다`)
        return
    }
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
   * nothing while OpenSky's first poll is in flight, the attract cycle picks
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

    // Answer FIRST, then swap the feeds. Starting a layer is not cheap — the
    // satellite start propagates three thousand TLEs, the weather start replays
    // three megabytes of cached tiles — and while that runs the hub is not
    // reading its socket, so the tab a child just pressed stayed unlit for
    // seconds and they pressed it again. These four are a few hundred bytes.
    broadcast({ type: 'state', state })
    // Clear the other layer's selection artefacts on both screens.
    broadcast({ type: 'route', icao24: '', points: null })
    broadcast({ type: 'detail', detail: null })
    broadcast({ type: 'satDetail', detail: null })

    // A switch, not an if/else: the else used to mean "anything that isn't
    // satellite resumes OpenSky", which quietly made a third layer start
    // spending credits on aircraft nobody was looking at.
    /*
     * What this layer has to show, at the moment it was asked for.
     *
     * "The icons keep not showing" has two halves and only one of them is in
     * the renderer. This is the other half: whether the hub had anything to
     * send when the tab was pressed. One line per switch, and between it and
     * the renderer's own [layer] line there is nowhere left for an empty tab
     * to hide.
     */
    opsLog(`[hub] mode → ${next}${layerStock(next)}`)

    switch (next) {
      case 'satellite':
        feed.setPaused(true, '위성 모드')
        startSatellites(onSatellites)
        replaySatellites()
        break
      case 'mars':
        // Nothing to start. The landing sites are settled history and live in
        // shared/probes.ts, which both windows import directly — no poll, no
        // socket traffic, and the tab works with the building unplugged.
        stopSatellites()
        feed.setPaused(true, '화성 모드')
        break
      case 'jupiter':
        // Same again, and more so: shared/jupiter.ts has no live half at all.
        // Where Mars has a daily rover check, Jupiter's moons are arithmetic
        // and the two spacecraft on their way left years ago.
        stopSatellites()
        feed.setPaused(true, '목성 모드')
        break
      case 'weather':
        stopSatellites()
        feed.setPaused(true, '날씨 모드')
        // Already running (see the warm start below); this is here so a manual
        // stop could never leave the tab dead, and it costs nothing.
        startWeather(onWeather)
        replayWeather()
        break
      default:
        stopSatellites()
        feed.setPaused(false)
    }
  }

  // The aircraft type arrives after the card has already gone out (it is never
  // waited on). When it lands for whatever is on screen, send the detail again
  // so the TYPE tile fills itself in.
  onDetailEnriched((icao24) => {
    if (state.selected === icao24) void sendDetail(null)
  })

  /*
   * A route landing late is the same story as the type landing late.
   *
   * The selection no longer waits several seconds for a definite answer, so the
   * card can go out saying nothing about the route. When one turns up — from
   * the on-demand lookup, or from the background resolver after the on-demand
   * one was rate-limited — the card is sent again and fills itself in.
   */
  onRouteResolved((callsign) => {
    if (!state.selected) return
    const sel = aircraft.find((a) => a.icao24 === state.selected)
    if (sel?.callsign?.trim().toUpperCase() === callsign) void sendDetail(null)
  })

  /*
   * Which frames each window already has.
   *
   * A weather frame is several megabytes of base64, and the whole set is close
   * to forty. They were re-sent in full every single time somebody pressed
   * 날씨 — the hub stringified forty megabytes on its only thread and both
   * windows parsed it, to arrive at exactly the picture they were already
   * holding in memory. That is the wait when the tab opens.
   *
   * A window keeps its frames across a tab change (the React state survives;
   * only the GPU textures are dropped and rebuilt), so the second visit needs
   * nothing sent at all. Keyed by layer, moment and step, so a genuinely new
   * poll still goes out. A WeakMap because the key is the socket: when it
   * closes, the record goes with it.
   */
  const sentWeather = new WeakMap<WebSocket, Map<WeatherLayer, Set<string>>>()

  function sendWeatherFrame(ws: WebSocket, frame: WeatherFrame): boolean {
    let byLayer = sentWeather.get(ws)
    if (!byLayer) {
      byLayer = new Map()
      sentWeather.set(ws, byLayer)
    }
    const step = frame.step ?? 0
    /*
     * Step 0 starts a new series — the same rule the WINDOW uses.
     *
     * Its receiver treats step 0 as "throw away what you had for this layer and
     * start again", so that is exactly the moment this record has to be cleared
     * too. Anything else and the two would disagree about what the window is
     * holding, which is the only way this optimisation could ever drop a frame
     * somebody needed.
     */
    if (step === 0) byLayer.set(frame.layer, new Set())
    let seen = byLayer.get(frame.layer)
    if (!seen) {
      seen = new Set()
      byLayer.set(frame.layer, seen)
    }
    const key = `${frame.time}:${step}`
    if (seen.has(key)) return false
    seen.add(key)
    send(ws, { type: 'weather', frame })
    return true
  }

  const onWeather = (frame: WeatherFrame) => {
    if (state.mode !== 'weather') return
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) sendWeatherFrame(ws, frame)
    }
  }

  /**
   * Everything the weather has, unless it is too old to be worth showing.
   *
   * Both places that hand weather to a window go through here -- the tab
   * opening, and a window connecting or reloading mid-session. They were
   * separate, and only one of them checked the age, so a reload in weather
   * mode could still put the morning's sky on the dome after the tab itself
   * had learned not to.
   */
  function currentWeatherFrames(): WeatherFrame[] {
    const frames = weatherFrames()
    if (!frames.length) return []
    // The same test the poll uses to decide what it may publish early, so
    // "too old to show" and "already on screen" cannot drift apart.
    if (haveFreshFrames()) return frames
    const age = Date.now() - frames.reduce((m, f) => Math.max(m, f.time), 0)
    opsLog(
      `[weather] cached picture is ${Math.round(age / 60_000)}분 old — not shown; ` +
        `waiting for the poll`
    )
    return []
  }

  /**
   * Hand the current picture to the windows when the tab opens.
   *
   * Not on this tick: each frame is several base64'd satellite images and
   * stringifying them is the hub's only thread, so doing it inline made the
   * tab a child had just pressed stay unlit for seconds and they pressed it
   * again.
   *
   * A cache older than WEATHER_CACHE_MAX_AGE_MS is NOT replayed. Opening the
   * exhibit in the afternoon used to put the morning's sky on the dome with
   * the morning's hour beside it — correctly labelled and completely wrong as
   * an answer to "what is it doing outside". A few seconds of "불러오는 중"
   * while the poll lands is the better trade, and with the warm start below
   * that gap only exists in the first moments after boot.
   */
  function replayWeather(): void {
    const frames = currentWeatherFrames()
    if (!frames.length) return
    setImmediate(() => {
      if (state.mode !== 'weather') return
      let sent = 0
      for (const ws of wss.clients) {
        if (ws.readyState !== ws.OPEN) continue
        for (const f of frames) if (sendWeatherFrame(ws, f)) sent++
      }
      if (sent) opsLog(`[weather] ${sent} frame(s) sent to the windows`)
    })
  }

  /**
   * Put the satellites on screen the instant the tab opens.
   *
   * startSatellites launches a pass immediately, but a pass is a pass: the
   * whole catalogue is propagated before the first byte goes out, and the
   * windows have already cleared the previous layer by then. The picture the
   * hub is holding is good enough to fill that gap — provided it is actually
   * recent. A snapshot from ten minutes ago would put every satellite a
   * quarter of an orbit from where it is and then slide them all across the
   * map when the real one lands, which is worse than a moment of nothing.
   */
  function replaySatellites(): void {
    if (satSnapshotAgeMs() > SAT_REPLAY_MAX_AGE_MS) return
    setImmediate(() => {
      if (state.mode !== 'satellite') return
      onSatellites()
    })
  }

  /** What the hub is holding for a layer, for the switch line. */
  function layerStock(mode: ExhibitMode): string {
    if (mode === 'satellite') {
      const age = satSnapshotAgeMs()
      return (
        ` — ${satElementCount()} elements loaded, ` +
        (Number.isFinite(age)
          ? `snapshot of ${satSnapshot().length} from ${(age / 1000).toFixed(1)}s ago`
          : 'no snapshot yet, first pass starting')
      )
    }
    if (mode === 'weather') {
      const frames = currentWeatherFrames()
      return frames.length
        ? ` — ${frames.length} frame(s) ready`
        : ' — NOTHING to show: no frame is both present and fresh, so the tab stays empty until the poll lands'
    }
    return ''
  }

  feed.start(
    (snapshot) => {
      aircraft = holdSelection(annotateRoutes(snapshot))
      if (state.mode !== 'flight') return
      broadcast({ type: 'aircraft', mode: 'full', data: aircraft, serverTime: Date.now() })
      broadcast({ type: 'status', source: feed.source, connected, count: aircraft.length, credentials: hasCreds })
      // Keep the selected plane's route/progress/ETA live (e.g. after a
      // re-route on arrival) so the old route doesn't linger.
      if (state.selected) void sendDetail(null)
    },
    (isConnected) => {
      connected = isConnected
    }
  )

  /*
   * Which sockets want the log, and the one hook that feeds them.
   *
   * A single listener fanning out to a set, rather than one listener per
   * socket: opsLog runs on the hub's only thread and is called from inside
   * poll loops, so the work it does per line has to stay flat no matter how
   * many windows are open.
   */
  const logWatchers = new Set<WebSocket>()
  onLogLine((line) => {
    for (const ws of logWatchers) {
      if (ws.readyState === ws.OPEN) send(ws, { type: 'log', line })
    }
  })

  wss.on('connection', (ws) => {
    console.log(`[hub] window connected (${wss.clients.size} total)`)
    // Bring the new window fully up to date immediately.
    send(ws, { type: 'state', state })
    // What the operator can change, and what it is set to now. Sent to every
    // window, not just the control one: the dome reads the same grading and
    // Jupiter numbers, and a dome that missed this message would quietly draw
    // a different planet from the one on the touchscreen.
    send(ws, { type: 'settings', settings: settingsView() })
    // Two objects at most, and only when there is something to say.
    if (marsLive().length) send(ws, { type: 'marsLive', data: marsLive() })
    if (state.mode === 'weather') {
      // Whatever is already assembled, so a window that connects (or reloads)
      // mid-session doesn't sit on a bare earth until the next poll.
      for (const frame of currentWeatherFrames()) sendWeatherFrame(ws, frame)
    } else if (state.mode === 'satellite') {
      const sats = satSnapshot()
      send(ws, {
        type: 'satellites',
        data: sats,
        serverTime: Date.now(),
        tleAt: tleFetchedAt(),
        tleError: tleLastError()
      })
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
      // Subscribing is about THIS socket, so it cannot go through
      // applyCommand, which only sees the message.
      if (msg.type === 'watchLog') {
        if (msg.on) {
          logWatchers.add(ws)
          send(ws, { type: 'logHistory', lines: recentLog() })
        } else {
          logWatchers.delete(ws)
        }
        return
      }
      applyCommand(msg)
    })
    ws.on('close', () => logWatchers.delete(ws))
  })

  /** Whether this id names something on the layer currently being shown. */
  function belongsToLayer(id: string): boolean {
    // Weather is a picture, not a set of objects — there is nothing to select.
    if (state.mode === 'weather') return false
    // Landing sites and candidate regions both live on the Mars layer. The
    // targets are not probes and are not in MARS_PROBES, so leaving them out
    // here made every tap on one a silent "ignored — not on the mars layer".
    if (state.mode === 'mars') return MARS_PROBES.some((p) => p.id === id) || isTargetId(id)
    // Four moons and the one place anything ever went in. Neither is a probe
    // on a surface, so neither is in MARS_PROBES.
    if (state.mode === 'jupiter') {
      return GALILEAN.some((m) => m.id === id) || id === GALILEO_PROBE.id
    }
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
        /*
         * Mars first, because everything below this is about aircraft.
         *
         * A landing site has no callsign to look up, no route to resolve and no
         * snapshot to be missing from — so the aircraft path would have logged
         * "NOT in the current snapshot" about a probe that is exactly where it
         * has been since 1976, and then sent a detail request for it. This is
         * the fourth-mode trap the satellite tab already hit once: the branch
         * that catches everything is an aircraft branch.
         */
        if (state.mode === 'mars' || state.mode === 'jupiter') {
          state.selected = msg.icao24
          opsLog(`[hub] ${state.mode} select ${msg.icao24 ?? '(cleared)'}`)
          broadcast({ type: 'state', state })
          // Nothing else has anything to say about a probe: the card is built
          // in the window from shared/probes.ts.
          broadcast({ type: 'route', icao24: '', points: null })
          broadcast({ type: 'detail', detail: null })
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
          // The card and its orbit go out NOW, without the next-pass line.
          // Working that out propagates the orbit across the next day — for a
          // satellite that never rises here, the whole day's worth — and doing
          // it first meant the card waited on it. The pass follows a tick
          // later and the card fills itself in.
          const id = msg.icao24
          const d = id ? satDetail(id, false) : null
          lastOrbitAt = Date.now()
          broadcast({ type: 'satDetail', detail: d })
          broadcast({ type: 'route', icao24: id ?? '', points: d?.track ?? null })
          if (id && d) {
            setImmediate(() => {
              if (state.selected !== id) return // they moved on; do not overwrite
              const full = satDetail(id)
              if (full) broadcast({ type: 'satDetail', detail: full })
            })
          }
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
      case 'note':
        // One line, no newlines, length-capped: this is a window writing into
        // the operator's log, so it gets a leash.
        opsLog(msg.text.replace(/[\r\n]+/g, ' ').slice(0, 400))
        return
      case 'setHiddenWeather':
        state.hiddenWeather = msg.layers
        broadcast({ type: 'state', state })
        return
      case 'setSettings': {
        /*
         * Apply, persist, and tell every window — including the one that asked.
         *
         * Echoing back to the sender is deliberate rather than wasteful: the
         * settings screen shows what the HUB holds, not what was typed into it,
         * so a value the hub clamped or refused (a poll interval below the
         * credit floor, a key pinned by the environment) corrects itself on
         * screen instead of leaving the operator believing an edit that never
         * happened.
         */
        const changed = updateSettings(msg.patch)
        if (changed.length) applySettingChanges(changed)
        // Broadcast even when nothing changed: that is the case where the hub
        // refused or clamped the edit, and the screen has to be corrected.
        broadcast({ type: 'settings', settings: settingsView() })
        return
      }
      case 'refresh':
        void refresh(msg.what)
        return
      case 'watchLog':
        // Handled where the socket is in scope; see the connection handler.
        return
      case 'resetSettings': {
        const changed = resetSettings()
        applySettingChanges(changed)
        broadcast({ type: 'settings', settings: settingsView() })
        return
      }
    }
  }

  /*
   * The weather poll runs from startup and keeps running, whatever tab is up.
   *
   * It used to start when somebody pressed 날씨 and stop when they left, which
   * meant the first thing a visitor saw was always the disk cache — whatever
   * the sky looked like the last time the exhibit was open — while a fetch of
   * several hundred tiles got under way behind it. Open the app at three in
   * the afternoon and the dome showed nine in the morning.
   *
   * Keeping it warm is now nearly free: a poll whose keyframes have not
   * changed costs one index request and downloads nothing, and the model
   * publishes hourly, so the real fetch happens about once an hour whether or
   * not anyone is looking. What that buys is a tab that is already current the
   * instant it is pressed.
   */
  startWeather(onWeather)
  // Same reasoning as the weather warm start: one request a day, and the tab is
  // current the instant it is pressed rather than a day behind.
  startMars(() => broadcast({ type: 'marsLive', data: marsLive() }))

  console.log(`[hub] listening on ws://127.0.0.1:${port} (feed: ${feed.source})`)
  /*
   * Say where the maps are looked for, and what is actually there.
   *
   * This is the one piece of setup that cannot be done from the settings screen
   * — the files are too big to type in — so it is the one most likely to be
   * missed, and "the planet is a wireframe" gives no clue as to which folder
   * was wrong. One line at startup turns that into a five-second check.
   */
  try {
    const found = readdirSync(mapsDir()).filter((f) => MAP_NAME.test(f))
    opsLog(
      found.length
        ? `[maps] ${mapsDir()} — ${found.join(', ')}`
        : `[maps] ${mapsDir()} 에 지도가 없습니다. 2:1 이미지 네 장(earth_equirect / earth_night / mars_equirect / jupiter_equirect)을 여기에 넣으세요.`
    )
  } catch {
    opsLog(`[maps] ${mapsDir()} 폴더가 없습니다 — 만들고 2:1 지도 이미지를 넣으세요.`)
  }

  return {
    close() {
      feed.stop()
      stopSatellites()
      stopElementRefresh()
      stopWeather()
      stopMars()
      stopRouteResolver()
      saveRouteCache()
      wss.close()
    }
  }
}
