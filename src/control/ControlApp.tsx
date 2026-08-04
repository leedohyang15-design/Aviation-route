import { useEffect, useMemo, useRef, useState } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { categoryKey, type CategoryKey } from '../common/flightClass'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { SatelliteDetailCard } from '../common/SatelliteDetailCard'
import type { Aircraft, OrbitClass, Satellite } from '@shared/types'
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
/** How long after a selection the placement stays live — long enough for the
 * route to arrive, short enough that it never chases a pan. */
const PLACE_WINDOW_MS = 1600


/**
 * Pick a spot for the card that covers as little of the route as possible.
 *
 * "Put it on the side the route isn't on" was too crude: a flight whose path
 * runs off both sides of the aircraft has no free side, and the card landed on
 * the destination — the one thing the visitor tapped the aircraft to find out.
 * So the renderer sends the route's actual screen footprint and this tries a
 * handful of slots and scores them by how many of those points they'd hide.
 */
function placeCard(a: SelectionAnchor): React.CSSProperties {
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
  for (const s of slots) {
    let hidden = 0
    for (const p of avoid) {
      if (p.x > s.x - 8 && p.x < s.x + W + 8 && p.y > s.y - 8 && p.y < s.y + H + 8) hidden++
    }
    // The object itself must never end up under the card either.
    if (a.x > s.x && a.x < s.x + W && a.y > s.y && a.y < s.y + H) hidden += 100
    // Among equally clear slots, take the least awkward, then the nearest.
    const cost =
      hidden * 1000 + s.bias * 20 + Math.hypot(s.x + W / 2 - a.x, s.y + H / 2 - a.y) / 100
    if (cost < bestCost) {
      bestCost = cost
      best = s
    }
  }
  return {
    left: best.x,
    top: best.y,
    right: 'auto',
    bottom: 'auto',
    width: SHEET_W,
    transform: `scale(${scale})`,
    transformOrigin: 'top left'
  }
}

export function ControlApp(): JSX.Element {
  const { send, aircraft, state, connected, source, credentials, route, detail, satellites, satDetail } =
    useHub('control')
  const isSat = state.mode === 'satellite'
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
   * Where the card sits, decided ONCE per selection and then left alone.
   *
   * It used to track the object every frame, so panning the map dragged the
   * card along behind your finger — the thing you are moving is the map, and
   * having the readout chase you across the screen is what made it feel
   * broken. The anchor is still live for a moment after a selection (the route
   * arrives a beat later and the placement depends on it), then it locks.
   */
  const [placed, setPlaced] = useState<React.CSSProperties>({})
  const lockRef = useRef<{ id: string | null; until: number }>({ id: null, until: 0 })

  useEffect(() => {
    lockRef.current = { id: state.selected, until: Date.now() + PLACE_WINDOW_MS }
    if (!state.selected) setPlaced({})
  }, [state.selected])

  useEffect(() => {
    if (!anchor) return
    const lock = lockRef.current
    if (lock.id !== state.selected) return
    if (Date.now() > lock.until) return
    setPlaced(placeCard(anchor))
  }, [anchor, state.selected])
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
          {isSat ? (
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
        <div className={'src ' + (isSat || live ? 'ok' : 'pending')}>
          {isSat ? '위성 궤도 · 실시간 계산' : statusText}
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
        </div>
        {/* The simulation/live tabs are gone: the exhibit picks for itself. It
            runs live whenever OpenSky is answering and falls back to simulation
            on its own when it isn't, so the choice was one an operator never
            needed to make — and one a visitor could make by accident. FEED=mock
            in .env still pins simulation for a demo. */}
        {isSat ? (
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
        {isSat
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
          🖐 지구를 돌리고, {isSat ? '위성을' : '비행기를'} 눌러보세요!
        </div>
      )}
    </div>
  )
}
