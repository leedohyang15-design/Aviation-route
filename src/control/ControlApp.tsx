import { useEffect, useMemo, useRef, useState } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { categoryKey, type CategoryKey } from '../common/flightClass'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { SatelliteDetailCard } from '../common/SatelliteDetailCard'
import type { Aircraft, OrbitClass, Satellite, WeatherLayer } from '@shared/types'
import { MapView } from './MapView'
import type { SelectionAnchor } from '../display/globe'
import { SatelliteSearch } from './SatelliteSearch'
import { FlightSearch } from './FlightSearch'

/** Card footprint, matched to .sheet in control.css — used to keep the card
 * inside the window when it is anchored to a tapped object. */
const SHEET_W = 360
const SHEET_H = 660
/** How far the card keeps off the object it describes. Generous: at the old
 * 28px it crowded the icon, and on a satellite it sat right on the panels. */
const GAP = 64
/**
 * How long to hold the card back after a selection while the route arrives.
 *
 * The route is a beat behind the selection, so the card was being placed
 * against an empty map, drawn there, and then teleported the moment the line
 * appeared under it. Waiting for the line — or giving up on it, for the
 * aircraft that have none — means it is only ever drawn once, in its final
 * place.
 */
const ROUTE_WAIT_MS = 6000
/** Backstop for an object still enough that no anchor ever arrives at all. */
const CAMERA_QUIET_MS = 400


/**
 * Pick a spot for the card that covers as little of the route as possible.
 *
 * "Put it on the side the route isn't on" was too crude: a flight whose path
 * runs off both sides of the aircraft has no free side, and the card landed on
 * the destination — the one thing the visitor tapped the aircraft to find out.
 * So the renderer sends the route's actual screen footprint and this tries a
 * handful of slots and scores them by how many of those points they'd hide.
 */
interface Placement {
  style: React.CSSProperties
  /**
   * Where the card sits RELATIVE TO THE OBJECT, in pixels.
   *
   * This is the whole trick. Pinning the card to the screen meant that panning
   * the map slid the aircraft out from under it while the card stayed where it
   * was — which from the other side of the glass is the card following your
   * hand. Holding an offset from the object instead makes the card travel with
   * the thing it describes: move the map and they move together, and the only
   * time the offset is reconsidered is when it has started covering something.
   */
  off: { dx: number; dy: number }
  /** Where it actually is, so a later frame can ask whether it still works. */
  rect: { x: number; y: number; w: number; h: number }
  /** How many keep-out points this spot covers — 0 is a clean placement. */
  hidden: number
}

/** Everything the card must not cover: what the renderer reported (the route,
 * its endpoint markers, the place names and the flags) plus the control
 * overlay, read from the DOM so it stays right on any screen. */
function keepOut(a: SelectionAnchor): { x: number; y: number }[] {
  const avoid = [...a.avoid]
  for (const sel of ['.ctrl-info', '.ctrl-zoom', '.reset-btn', '.ctrl-compass', '.touch-hint']) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      for (let fx = 0; fx <= 1; fx += 0.25) {
        for (let fy = 0; fy <= 1; fy += 0.25) {
          avoid.push({ x: r.left + r.width * fx, y: r.top + r.height * fy })
        }
      }
    }
  }
  return avoid
}

/**
 * What a card at this rect would hide.
 *
 * Two numbers, because two things are being hidden. `hard` is the destination
 * pin, the place names, the flags and the control overlay — hiding any of them
 * is the answer gone, so it is counted absolutely. `soft` is the line itself,
 * counted as a FRACTION of it: an aircraft's route is short and covering half
 * of it matters, while a satellite's orbit wraps the whole globe and covering
 * a tenth of it is unavoidable. Counting raw points made every satellite
 * placement look hopeless, so the card fled to a corner every time.
 */
function hiddenBy(
  rect: { x: number; y: number; w: number; h: number },
  avoid: SelectionAnchor['avoid'],
  a: SelectionAnchor
): { hard: number; soft: number } {
  let hard = 0
  let soft = 0
  let softTotal = 0
  for (const p of avoid) {
    if (!p.hard) softTotal++
    const inside =
      p.x > rect.x - 8 && p.x < rect.x + rect.w + 8 && p.y > rect.y - 8 && p.y < rect.y + rect.h + 8
    if (!inside) continue
    if (p.hard) hard++
    else soft++
  }
  // The object itself must never end up under the card either.
  if (a.x > rect.x && a.x < rect.x + rect.w && a.y > rect.y && a.y < rect.y + rect.h) hard += 100
  return { hard, soft: softTotal ? soft / softTotal : 0 }
}

/**
 * How big the card is at a given camera span. Bounded, and deliberately so.
 *
 * The card used to be re-scaled by the RATIO of the current span to the span it
 * was placed at, which has no bottom and no top: zoom out far enough and the
 * card grew past the edge of the screen, zoom in and it shrank to a stamp. The
 * card is a thing you read, not a thing on the map — it only ever moves between
 * three quarters and full size, and it does that so a zoomed-in map (nearly
 * empty) doesn't sit under a slab.
 */
function cardScale(span: number): number {
  const t = Math.max(0, Math.min(1, (span - 0.15) / 0.55))
  return 0.74 + 0.26 * t
}

function placeCard(a: SelectionAnchor): Placement {
  const scale = cardScale(a.span)
  const W = SHEET_W * scale
  const H = SHEET_H * scale
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = GAP * scale
  const M = 12

  // The overlay furniture counts as "must not cover" too — the title block and
  // the chips top-left, the compass, zoom and reset top-right, the touch invite
  // along the bottom. Read from the DOM rather than hard-coded, so it stays
  // right whatever the exhibit's screen turns out to be.
  const avoid = keepOut(a)

  const clampX = (x: number) => Math.max(M, Math.min(vw - W - M, x))
  const clampY = (y: number) => Math.max(M, Math.min(vh - H - M, y))
  // Beside the object first, then the corners — a corner is further from what
  // it describes, but a card that hides the flight path is worse than one that
  // is a hand's width away from it.
  // Candidates, nearest first: eight directions around the object at a few
  // distances, then the corners as a last resort. The old version offered only
  // "left of it, right of it, or a corner", so anything that did not fit beside
  // the object jumped to the far side of the screen — the card ended up a
  // hand's width from the aircraft it was describing. A ring lets it slide just
  // far enough to clear the route and stop there.
  const slots: { x: number; y: number; bias: number }[] = []
  const DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, -0.7], [-1, -0.7], [1, 0.7], [-1, 0.7]
  ]
  for (const step of [1, 1.6, 2.4, 3.4]) {
    for (const [dx, dy] of DIRS) {
      const d = gap * step
      slots.push({
        x: clampX(a.x + dx * (d + W / 2) - W / 2),
        y: clampY(a.y + dy * (d + H / 2) - H / 2),
        bias: 0
      })
    }
  }
  // The corners carry a penalty so they are only taken when the ring is full —
  // the top ones more so, since that is where the title, the chips and the zoom
  // controls live.
  slots.push({ x: vw - W - M, y: vh - H - M, bias: 3 })
  slots.push({ x: M, y: vh - H - M, bias: 3 })
  slots.push({ x: vw - W - M, y: M, bias: 8 })
  slots.push({ x: M, y: M, bias: 8 })

  let best = slots[0]
  let bestCost = Infinity
  let bestHidden = 0
  for (const s of slots) {
    const h = hiddenBy({ x: s.x, y: s.y, w: W, h: H }, avoid, a)
    // Covering something is always worse than being further away, but among
    // slots that cover nothing the nearest one wins outright — distance is
    // counted in real pixels now, not divided into insignificance.
    const cost =
      h.hard * 100_000 +
      h.soft * 60_000 +
      s.bias * 1_000 +
      Math.hypot(s.x + W / 2 - a.x, s.y + H / 2 - a.y)
    if (cost < bestCost) {
      bestCost = cost
      best = s
      bestHidden = h.hard + (h.soft >= 0.04 ? 1 : 0)
    }
  }
  return {
    hidden: bestHidden,
    off: { dx: best.x - a.x, dy: best.y - a.y },
    rect: { x: best.x, y: best.y, w: W, h: H },
    style: {
      left: best.x,
      top: best.y,
      right: 'auto',
      bottom: 'auto',
      width: SHEET_W,
      transform: `scale(${scale})`,
      transformOrigin: 'top left'
    }
  }
}

export function ControlApp(): JSX.Element {
  const {
    send,
    aircraft,
    state,
    connected,
    source,
    credentials,
    route,
    detail,
    satellites,
    satDetail,
    weather,
    weatherAgeMin
  } = useHub('control')
  const mode = state.mode
  const isSat = mode === 'satellite'
  const isWeather = mode === 'weather'
  const hiddenWeather = state.hiddenWeather ?? []
  const toggleWeather = (l: WeatherLayer) => {
    poke()
    const next = hiddenWeather.includes(l)
      ? hiddenWeather.filter((x) => x !== l)
      : [...hiddenWeather, l]
    send({ type: 'setHiddenWeather', layers: next })
  }
  // Orbit-class filter, mirroring how the aircraft category chips work.
  const hiddenOrbits = state.hiddenOrbits ?? []
  const satVisible = useMemo(
    () => satellites.filter((s) => !hiddenOrbits.includes(s.orbit)),
    [satellites, hiddenOrbits]
  )
  const perOrbit = useMemo(() => {
    const c: Record<OrbitClass, number> = { leo: 0, starlink: 0, meo: 0, geo: 0 }
    for (const s of satellites) c[s.orbit]++
    return c
  }, [satellites])
  const toggleOrbit = (o: OrbitClass) => {
    poke()
    const next = hiddenOrbits.includes(o) ? hiddenOrbits.filter((x) => x !== o) : [...hiddenOrbits, o]
    send({ type: 'setHiddenOrbits', orbits: next })
  }
  /** Jump to a searched satellite. Starlink is hidden by default (it is two
   * thirds of the sky), so a search that lands in a hidden class has to unhide
   * it — otherwise the selection would point at something not on screen. */
  const pickSatellite = (s: Satellite) => {
    poke()
    if (hiddenOrbits.includes(s.orbit)) {
      send({ type: 'setHiddenOrbits', orbits: hiddenOrbits.filter((x) => x !== s.orbit) })
    }
    send({ type: 'select', icao24: s.id })
  }
  /** Jump to a searched flight. A hit in a hidden category has to unhide it —
   * 자가용·기타 is off by default, so a search for a private registration would
   * otherwise select something that isn't on screen. */
  const pickFlight = (a: Aircraft) => {
    poke()
    const cat = categoryKey(a.callsign, null, a.hasRoute)
    if (hidden.includes(cat)) {
      send({
        type: 'setFilter',
        filter: { ...state.filter, hiddenCategories: hidden.filter((c) => c !== cat) }
      })
    }
    send({ type: 'select', icao24: a.icao24 })
  }
  const visible = useMemo(
    () => applyFilter(aircraft, state.filter, state.selected),
    [aircraft, state.filter, state.selected]
  )
  const sel = state.selected ? visible.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null
  // How many aircraft each category contributes, ignoring the category filter
  // itself — so a hidden category still shows what turning it back on would add.
  const perCategory = useMemo(() => {
    const counts: Record<CategoryKey, number> = { passenger: 0, cargo: 0, military: 0, other: 0 }
    for (const a of applyFilter(aircraft, { ...state.filter, hiddenCategories: [] }, state.selected)) {
      counts[categoryKey(a.callsign, null, a.hasRoute)]++
    }
    return counts
  }, [aircraft, state.filter, state.selected])
  // True while the exhibit is auto-cycling (attract) — used to keep the touch
  // invite visible even though a plane is auto-selected.
  const [attract, setAttract] = useState(false)
  /**
   * The newest anchor, as a plain value rather than state.
   *
   * `anchorTick` is bumped only when the card still needs PLACING, which is a
   * handful of times per selection — everything after that is handled by
   * `follow` writing to the element, so the sixty-per-second case never
   * re-renders anything.
   */
  const [anchorTick, setAnchorTick] = useState(0)
  const pokeRef = useRef<(() => void) | null>(null)
  /** Any tap on the overlay UI counts as a visitor being present. Those
   * controls sit on a pointer-events island above the canvas, so they never
   * reached the renderer's own input handlers — a visitor could search for the
   * ISS, tap the hit, and have the attract cycle throw it away a second later
   * because its 30s countdown had been running the whole time. */
  const poke = () => pokeRef.current?.()

  /**
   * Where the card sits — and only satellites get a say in it.
   *
   * An aircraft's card goes back in the bottom-right corner, where it started.
   * Beside-the-object was the right idea for a satellite, which is a dot with
   * nothing else attached to it, and the wrong one for a flight: a flight comes
   * with an origin, a destination, two flags and a line across half the world,
   * and no offset from the aircraft avoids all of them at every zoom. The
   * corner never covers any of it.
   *
   * When it IS anchored (satellites), it is placed once and then only ever
   * rides along with the object — it never re-chooses its spot, because a card
   * that relocates itself while you are reading it is worse than one in a
   * slightly awkward place.
   */
  const [placed, setPlaced] = useState<React.CSSProperties>({})
  /** False until the card has a final home, so it is never drawn mid-decision. */
  const [settled, setSettled] = useState(false)
  const placedRef = useRef<Placement | null>(null)
  const anchorRef = useRef<SelectionAnchor | null>(null)
  const openedAt = useRef(0)
  /**
   * The card's own element, so following can write to it directly.
   *
   * The anchor arrives on every rendered frame, and putting it through React
   * state meant re-rendering the whole control window sixty times a second to
   * move one box — six thousand aircraft re-filtered, every chip and legend
   * reconciled, for a translation. That is where the stutter in the card and
   * the general heaviness both came from. Placement still goes through state,
   * because it happens once; following does not, because it happens always.
   */
  const sheetRef = useRef<HTMLDivElement | null>(null)

  const apply = (p: Placement) => {
    placedRef.current = p
    setPlaced(p.style)
    setSettled(true)
  }

  /**
   * Re-hang the card at its chosen offset from wherever the object is now.
   *
   * No clamping to the viewport. Clamping is what made it follow the observer:
   * pan the aircraft off the left edge and a clamped card stops at the edge and
   * sits there, staring at you, while the thing it describes is gone. It is
   * nailed to the object — if the object leaves the screen, so does the card.
   */
  const follow = (a: SelectionAnchor, p: Placement) => {
    const scale = cardScale(a.span) // bounded — never a ratio against the old span
    const w = SHEET_W * scale
    const h = SHEET_H * scale
    const left = a.x + p.off.dx
    const top = a.y + p.off.dy
    // Straight to the element. No setState: see sheetRef.
    const el = sheetRef.current
    if (el) {
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.right = 'auto'
      el.style.bottom = 'auto'
      el.style.width = `${SHEET_W}px`
      el.style.transform = `scale(${scale})`
      el.style.transformOrigin = 'top left'
    }
    placedRef.current = { ...p, rect: { ...p.rect, x: left, y: top, w, h } }
  }

  useEffect(() => {
    placedRef.current = null
    openedAt.current = Date.now()
    setSettled(false)
    if (!state.selected) setPlaced({})
  }, [state.selected])

  /**
   * Everything the card is waiting on has arrived.
   *
   * Selecting starts two things the card's position depends on — the route
   * comes back from the hub, and the camera recentres on the object — and
   * either landing after the card was drawn made it jump. So it waits for the
   * route to actually be there (or for the detail to say there will never be
   * one), with a long stop so nothing can hang.
   */
  const [waitTick, setWaitTick] = useState(0)
  useEffect(() => {
    if (!state.selected) return
    const t = setTimeout(() => setWaitTick((n) => n + 1), ROUTE_WAIT_MS + 100)
    return () => clearTimeout(t)
  }, [state.selected])
  void waitTick
  // The hub always answers a selection with a route message — points or null.
  // THAT arriving is the signal, not a detail that happens to have no route in
  // it yet: the card was being drawn on the strength of a half-filled detail
  // and then shoved aside when the line turned up under it.
  const routeReady =
    !!state.selected &&
    (route.icao24 === state.selected || Date.now() - openedAt.current > ROUTE_WAIT_MS)

  /**
   * Only the satellite card listens for the anchor.
   *
   * It arrives every frame the map is moving, and each one is a setState — in
   * flight mode that re-rendered the whole control window sixty times a second
   * to position a card that is nailed to the corner and does not move.
   */
  const anchorSink = isSat
    ? (a: SelectionAnchor | null) => {
        anchorRef.current = a
        if (!a) return
        const p = placedRef.current
        if (p) follow(a, p)
        else setAnchorTick((n) => n + 1) // still deciding: let the effect run
      }
    : undefined

  // Aircraft: straight to the corner, the moment there is something to show.
  // Nothing to wait for — the corner cannot land on the route, so there is no
  // reason to hold the card back until the line arrives.
  useEffect(() => {
    if (isSat || !state.selected) return
    setPlaced({})
    setSettled(true)
  }, [isSat, state.selected])

  useEffect(() => {
    const anchor = anchorRef.current
    if (!isSat || !anchor) return

    if (!placedRef.current) {
      if (!routeReady) return
      /*
       * No waiting for the camera to park.
       *
       * It used to, on the reasoning that a card placed mid-ease is placed
       * against a map about to be somewhere else. That reasoning is for a card
       * pinned to the screen; this one is pinned to the SATELLITE and follows
       * it every frame, so where the camera ends up does not move it relative
       * to what it describes. What the wait actually bought was a card that
       * took the whole recentre-and-zoom to appear — and then a two and a half
       * second alarm clock behind that for a geostationary satellite that
       * never moves enough to send another anchor. That is the "정보탭이 너무
       * 느리다": nothing was being computed, it was being waited for.
       *
       * The one thing the camera affects is which side of the object reads
       * best, and for a satellite that is nearly free: an orbit is deliberately
       * not something the card avoids, so there is little to score against.
       */
      apply(placeCard(anchor))
      return
    }

    // Placed: ride along with the object, and never move again. Relocating a
    // card that is already on screen is the thing that annoys — better to have
    // picked well once. It is only ever re-chosen for a NEW selection.
    follow(anchor, placedRef.current)
  }, [anchorTick, routeReady, isSat])

  // A geostationary satellite can sit still enough that no further anchor ever
  // arrives, so the wait needs its own alarm clock as a backstop.
  useEffect(() => {
    if (!isSat || !state.selected || placedRef.current || !routeReady) return
    const t = setTimeout(() => {
      const a = anchorRef.current
      if (a && !placedRef.current) apply(placeCard(a))
    }, CAMERA_QUIET_MS)
    return () => clearTimeout(t)
  }, [isSat, state.selected, routeReady])

  const sheetStyle = placed


  // Category filter (also serves as the color legend). hiddenCategories lists
  // the categories to hide; clicking a chip toggles it.
  const hidden = state.filter.hiddenCategories ?? []
  const toggleCat = (cat: string) => {
    poke()
    const next = hidden.includes(cat) ? hidden.filter((c) => c !== cat) : [...hidden, cat]
    send({ type: 'setFilter', filter: { ...state.filter, hiddenCategories: next } })
  }

  // Live data vs. forced simulation. Live is the default; simulation is there
  // for demos and for when the daily OpenSky credit budget runs out.
  const feedMode = state.feedMode ?? 'auto'
  // The tab is the operator's *choice*; `source` is what's actually on screen.
  // In live mode the simulation still covers the first seconds (and any OpenSky
  // outage), so say which of those is happening instead of just "simulation".
  const live = connected && (feedMode === 'mock' || source === 'opensky')
  const statusText =
    feedMode === 'mock'
      ? '시뮬레이션 · 연습 모드'
      : source === 'opensky'
        ? 'OpenSky · 실시간'
        : credentials
          ? '실시간 준비 중… (지금은 시뮬레이션)'
          : '실시간 미설정 (.env 없음) · 시뮬레이션'

  return (
    <div className="control-root">
      <MapView
        mode={state.mode}
        satellites={satVisible}
        weather={weather}
        hiddenWeather={hiddenWeather}
        aircraft={visible}
        selected={state.selected}
        route={route.points}
        noRouteForSelected={!!d && !d.route}
        onSelect={(icao24) => send({ type: 'select', icao24 })}
        onView={(view) => send({ type: 'setView', view })}
        onAttract={setAttract}
        onAnchor={anchorSink}
        pokeRef={pokeRef}
        dayNightHour={state.dayNightHour}
        originCity={d?.origin?.city ?? null}
        destCity={d?.destination?.city ?? null}
        originFlag={d?.origin?.countryCode ?? null}
        destFlag={d?.destination?.countryCode ?? null}
      />

      {/* Info overlay (top-left) — moved off the projected sphere. */}
      <div className="ctrl-info">
        <h1>실시간 항공 경로</h1>
        <div className="sub">Real-time Global Air Traffic</div>
        <div className="count">
          {isWeather ? (
            <>
              {weatherAgeMin == null ? (
                '날씨 영상을 불러오는 중…'
              ) : (
                <>
                  <b>{weatherAgeMin}</b>분 전 지구의 하늘
                </>
              )}
            </>
          ) : isSat ? (
            <>
              지금 지구 위에 🛰 <b>{satVisible.length.toLocaleString()}</b>개
            </>
          ) : (
            <>
              지금 하늘에 ✈ <b>{visible.length.toLocaleString()}</b>대
            </>
          )}
        </div>
        {/* While OpenSky's first poll is still in flight the exhibit runs on the
            simulation — for up to a minute or so after launch. That used to be a
            line of small grey text, which is how a whole evaluation session got
            spent on simulated aircraft. Make it a badge nobody can miss. */}
        <div className={'src ' + (isWeather ? (weatherAgeMin == null ? 'pending' : 'ok') : isSat || live ? 'ok' : 'pending')}>
          {/* Attribution — the exhibit's only place for it. Both layers now
              come from the one service, which is the point of the change. */}
          {isWeather
            ? '© MapTiler · GFS 실황'
            : isSat
            ? '위성 궤도 · 실시간 계산'
            : statusText}
        </div>

        {/* Layer tabs — aircraft or satellites. */}
        <div className="feed-tabs" role="tablist" aria-label="화면">
          <button
            role="tab"
            aria-selected={mode === 'flight'}
            className={'feed-tab' + (mode === 'flight' ? ' on' : '')}
            onClick={() => {
              poke()
              send({ type: 'setMode', mode: 'flight' })
            }}
          >
            ✈ 비행기
          </button>
          <button
            role="tab"
            aria-selected={isSat}
            className={'feed-tab' + (isSat ? ' on' : '')}
            onClick={() => {
              poke()
              send({ type: 'setMode', mode: 'satellite' })
            }}
          >
            🛰 위성
          </button>
          <button
            role="tab"
            aria-selected={isWeather}
            className={'feed-tab' + (isWeather ? ' on' : '')}
            onClick={() => {
              poke()
              send({ type: 'setMode', mode: 'weather' })
            }}
          >
            ☁ 날씨
          </button>
        </div>
        {/* The simulation/live tabs are gone: the exhibit picks for itself. It
            runs live whenever OpenSky is answering and falls back to simulation
            on its own when it isn't, so the choice was one an operator never
            needed to make — and one a visitor could make by accident. FEED=mock
            in .env still pins simulation for a demo. */}
        {isWeather ? (
          <div className="legend">
            {(
              [
                ['cloud', '☁ 구름', '#dfe8f5'],
                ['rain', '🌧 비 · 눈', '#5aa9ff']
              ] as [WeatherLayer, string, string][]
            ).map(([key, label, color]) => (
              <button
                key={key}
                className={'leg' + (hiddenWeather.includes(key) ? ' off' : '')}
                onClick={() => toggleWeather(key)}
              >
                <i style={{ background: color }} />
                {label}
              </button>
            ))}
            {/* Radar colour is a scale, not a category, and without the key the
                red just looks alarming. Drawn to match RainViewer's Universal
                Blue ramp — if WEATHER_RAIN_COLOR changes, change this too. */}
            {!hiddenWeather.includes('rain') && (
              <div className="rain-key">
                <span>약한 비</span>
                <i />
                <span>강한 비</span>
              </div>
            )}
          </div>
        ) : isSat ? (
          <div className="legend">
            {(
              [
                ['leo', '저궤도', '#5ce1e6'],
                ['starlink', '스타링크', '#b48cff'],
                ['meo', '중궤도', '#ffd166'],
                ['geo', '정지궤도', '#ff7b6b']
              ] as [OrbitClass, string, string][]
            ).map(([key, label, color]) => (
              <button
                key={key}
                className={'leg' + (hiddenOrbits.includes(key) ? ' off' : '')}
                onClick={() => toggleOrbit(key)}
              >
                <i style={{ background: color }} />
                {label} {perOrbit[key].toLocaleString()}개
              </button>
            ))}
            <SatelliteSearch
              satellites={satellites}
              hiddenOrbits={hiddenOrbits}
              onPick={pickSatellite}
            />
          </div>
        ) : (
        <div className="legend">
          <button
            className={'leg' + (hidden.includes('passenger') ? ' off' : '')}
            onClick={() => toggleCat('passenger')}
          >
            <i style={{ background: '#35c1ff' }} />
            여객기 {perCategory.passenger.toLocaleString()}대
          </button>
          <button
            className={'leg' + (hidden.includes('cargo') ? ' off' : '')}
            onClick={() => toggleCat('cargo')}
          >
            <i style={{ background: '#f5a623' }} />
            화물기 {perCategory.cargo.toLocaleString()}대
          </button>
          <button
            className={'leg' + (hidden.includes('military') ? ' off' : '')}
            onClick={() => toggleCat('military')}
          >
            <i style={{ background: '#74d16a' }} />
            군용기 {perCategory.military.toLocaleString()}대
          </button>
          <button
            className={'leg' + (hidden.includes('other') ? ' off' : '')}
            onClick={() => toggleCat('other')}
          >
            <i style={{ background: '#93a4b8' }} />
            자가용·기타 {perCategory.other.toLocaleString()}대
          </button>
          <FlightSearch
            aircraft={aircraft}
            hiddenCategories={hidden as CategoryKey[]}
            onPick={pickFlight}
          />
        </div>
        )}
      </div>

      {/* Aircraft: bottom-right corner (the CSS default, i.e. no inline style),
          clear of the flight path, the two flags and the place names. Satellite:
          beside the object, since an orbit is a ring that says the same thing
          everywhere and there is nothing else on screen to cover. Keyed by the
          selection so it re-mounts and replays the pop-up each time. */}
      <div className="sheet" ref={sheetRef} style={sheetStyle} hidden={!settled}>
        {isWeather
          ? null
          : isSat
          ? state.selected && (
              <div className="sheet-card" key={state.selected}>
                <SatelliteDetailCard detail={satDetail} />
              </div>
            )
            : sel && (
                <div className="sheet-card" key={state.selected ?? ''}>
                  <FlightDetailCard aircraft={sel} detail={d} />
                </div>
              )}
      </div>

      {/* Touch hint (bottom-center) — invites visitors to interact; hidden once
          a plane is selected so it doesn't fight the boarding-pass card. */}
      {(!state.selected || attract) && (
        <div className="touch-hint">
          🖐 지구를 돌려{isWeather ? '보세요!' : `보고, ${isSat ? '위성을' : '비행기를'} 눌러보세요!`}
        </div>
      )}
    </div>
  )
}
