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
/** How still the map has to be before the card is allowed to reconsider. */
const SETTLE_MS = 700


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

/** How much a card at this rect would hide, given the current keep-out set. */
function hiddenBy(
  rect: { x: number; y: number; w: number; h: number },
  avoid: { x: number; y: number }[],
  a: SelectionAnchor
): number {
  let hidden = 0
  for (const p of avoid) {
    if (p.x > rect.x - 8 && p.x < rect.x + rect.w + 8 && p.y > rect.y - 8 && p.y < rect.y + rect.h + 8) {
      hidden++
    }
  }
  // The object itself must never end up under the card either.
  if (a.x > rect.x && a.x < rect.x + rect.w && a.y > rect.y && a.y < rect.y + rect.h) hidden += 100
  return hidden
}

/** Whether a card sitting where it is would still be a clean placement — asked
 * fresh against the CURRENT route position, not against the count that was
 * true when it was placed. That stale count was the bug: the card was put
 * somewhere clear, the visitor panned the route underneath it, and the check
 * kept answering "still clear" from a number taken minutes earlier. */
function stillClear(a: SelectionAnchor, rect: Placement['rect']): boolean {
  return hiddenBy(rect, keepOut(a), a) === 0
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
  const beside = clampY(a.y - H / 2)
  // Beside the object first, then the corners — a corner is further from what
  // it describes, but a card that hides the flight path is worse than one that
  // is a hand's width away from it.
  // `bias` ranks otherwise-equal slots: beside the object first, then the two
  // bottom corners, then the top ones — the top of the frame carries the title
  // block, the chips and the search on the left and the compass and the zoom
  // controls on the right, and a card up there hides those instead.
  const slots = [
    { x: clampX(a.x + gap), y: beside, bias: 0 },
    { x: clampX(a.x - gap - W), y: beside, bias: 0 },
    { x: vw - W - M, y: vh - H - M, bias: 2 },
    { x: M, y: vh - H - M, bias: 2 },
    { x: vw - W - M, y: M, bias: 6 },
    { x: M, y: M, bias: 6 }
  ]

  let best = slots[0]
  let bestCost = Infinity
  let bestHidden = 0
  for (const s of slots) {
    const hidden = hiddenBy({ x: s.x, y: s.y, w: W, h: H }, avoid, a)
    // Among equally clear slots, take the least awkward, then the nearest.
    const cost =
      hidden * 1000 + s.bias * 20 + Math.hypot(s.x + W / 2 - a.x, s.y + H / 2 - a.y) / 100
    if (cost < bestCost) {
      bestCost = cost
      best = s
      bestHidden = hidden
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
  const placedRef = useRef<Placement | null>(null)
  const anchorRef = useRef<SelectionAnchor | null>(null)
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = (p: Placement) => {
    placedRef.current = p
    setPlaced(p.style)
  }

  useEffect(() => {
    placedRef.current = null
    if (!state.selected) setPlaced({})
  }, [state.selected])

  useEffect(() => {
    anchorRef.current = anchor
    if (!anchor) return
    // No placement yet for this selection: place it now.
    if (!placedRef.current) {
      apply(placeCard(anchor))
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
      if (next.hidden >= hiddenBy(cur.rect, keepOut(a), a)) return
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
      <div className="sheet" style={sheetStyle}>
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
