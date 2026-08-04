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
 * How still the map has to be before the card is allowed to reconsider.
 *
 * Long on purpose. A visitor pans in bursts with pauses between them, and at
 * 700ms every one of those pauses was long enough to move the card — which
 * from the other side of the glass looks exactly like the card following your
 * finger. At two and a half seconds it only ever moves once you have stopped.
 */
const SETTLE_MS = 2500
/**
 * How long to hold the card back after a selection while the route arrives.
 *
 * The route is a beat behind the selection, so the card was being placed
 * against an empty map, drawn there, and then teleported the moment the line
 * appeared under it. Waiting for the line — or giving up on it, for the
 * aircraft that have none — means it is only ever drawn once, in its final
 * place.
 */
const ROUTE_WAIT_MS = 900


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

/** Whether a card sitting where it is would still be a clean placement — asked
 * fresh against the CURRENT route position, not against the count that was
 * true when it was placed. That stale count was the bug: the card was put
 * somewhere clear, the visitor panned the route underneath it, and the check
 * kept answering "still clear" from a number taken minutes earlier. */
function stillClear(a: SelectionAnchor, rect: Placement['rect']): boolean {
  const h = hiddenBy(rect, keepOut(a), a)
  // A token overlap is not worth moving the card for. Moving it is the thing
  // the visitor notices; a corner of the line under a corner of the card is not.
  return h.hard === 0 && h.soft < 0.04
}

function placeCard(a: SelectionAnchor): Placement {
  // Shrink as the map zooms in. Zoomed out the card is one object among
  // thousands; zoomed in it is a slab over a nearly empty map.
  const t = Math.max(0, Math.min(1, (a.span - 0.15) / 0.55))
  const scale = 0.74 + 0.26 * t
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
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null)
  const pokeRef = useRef<(() => void) | null>(null)
  /** Any tap on the overlay UI counts as a visitor being present. Those
   * controls sit on a pointer-events island above the canvas, so they never
   * reached the renderer's own input handlers — a visitor could search for the
   * ISS, tap the hit, and have the attract cycle throw it away a second later
   * because its 30s countdown had been running the whole time. */
  const poke = () => pokeRef.current?.()

  /**
   * Where the card sits.
   *
   * It must not chase the map — the thing you are moving is the map, and having
   * the readout follow your finger across the screen is what made it feel
   * broken — and it must not end up sitting on the route, which is what happens
   * if it never moves at all: pan far enough and the flight path slides under
   * it. So: it is placed when the selection changes, and after that it moves
   * only when the map has been STILL for a moment AND the spot it is in has
   * become a bad one. During a drag or a zoom it does not move at all.
   */
  const [placed, setPlaced] = useState<React.CSSProperties>({})
  /** False until the card has a final home, so it is never drawn mid-decision. */
  const [settled, setSettled] = useState(false)
  const placedRef = useRef<Placement | null>(null)
  const anchorRef = useRef<SelectionAnchor | null>(null)
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openedAt = useRef(0)

  const apply = (p: Placement) => {
    placedRef.current = p
    setPlaced(p.style)
    setSettled(true)
  }

  useEffect(() => {
    placedRef.current = null
    openedAt.current = Date.now()
    setSettled(false)
    if (!state.selected) setPlaced({})
    // A geostationary satellite barely moves, so its anchor may not fire again
    // for a while — without this the card would wait forever for a route that
    // is never coming.
    const t = setTimeout(() => {
      const a = anchorRef.current
      if (a && !placedRef.current) apply(placeCard(a))
    }, ROUTE_WAIT_MS + 50)
    return () => clearTimeout(t)
  }, [state.selected])

  useEffect(() => {
    anchorRef.current = anchor
    if (!anchor) return
    // No placement yet for this selection. Hold off until the route has landed
    // — an anchor that already carries the line is the signal — or until the
    // wait runs out, which is how a route-less aircraft still gets a card.
    if (!placedRef.current) {
      const hasLine = anchor.avoid.length > 0
      if (hasLine || Date.now() - openedAt.current > ROUTE_WAIT_MS) apply(placeCard(anchor))
      return
    }
    // Otherwise wait for the map to stop moving, then only move if we have to.
    if (settleRef.current) clearTimeout(settleRef.current)
    settleRef.current = setTimeout(() => {
      const a = anchorRef.current
      const cur = placedRef.current
      if (!a || !cur) return
      // Is where it is STILL clear, against the route as it is now? Only if not
      // does it get to move, and only to somewhere better.
      if (stillClear(a, cur.rect)) return
      const next = placeCard(a)
      if (next.hidden > 0) return // nowhere better to go
      apply(next)
    }, SETTLE_MS)
    return () => {
      if (settleRef.current) clearTimeout(settleRef.current)
    }
  }, [anchor])
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
        onAnchor={setAnchor}
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
          {isWeather ? 'RainViewer · 10분마다 갱신' : isSat ? '위성 궤도 · 실시간 계산' : statusText}
        </div>

        {/* Layer tabs — aircraft or satellites. */}
        <div className="feed-tabs" role="tablist" aria-label="화면">
          <button
            role="tab"
            aria-selected={!isSat}
            className={'feed-tab' + (!isSat ? ' on' : '')}
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

      {/* The card sits BESIDE whatever was tapped, not in a fixed corner: on a
          touchscreen the answer should appear where the finger is, and a corner
          panel meant a child pressed a dot on the left and the reply arrived a
          metre away. Falls back to the corner when the object is off screen.
          Keyed by icao24 so it re-mounts and replays the pop-up on every new
          selection. */}
      <div className="sheet" style={sheetStyle} hidden={!settled}>
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
