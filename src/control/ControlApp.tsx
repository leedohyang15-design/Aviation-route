import { useMemo, useState } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { categoryKey, type CategoryKey } from '../common/flightClass'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { SatelliteDetailCard } from '../common/SatelliteDetailCard'
import type { OrbitClass, Satellite } from '@shared/types'
import { MapView } from './MapView'
import { SatelliteSearch } from './SatelliteSearch'

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
    const next = hiddenOrbits.includes(o) ? hiddenOrbits.filter((x) => x !== o) : [...hiddenOrbits, o]
    send({ type: 'setHiddenOrbits', orbits: next })
  }
  /** Jump to a searched satellite. Starlink is hidden by default (it is two
   * thirds of the sky), so a search that lands in a hidden class has to unhide
   * it — otherwise the selection would point at something not on screen. */
  const pickSatellite = (s: Satellite) => {
    if (hiddenOrbits.includes(s.orbit)) {
      send({ type: 'setHiddenOrbits', orbits: hiddenOrbits.filter((x) => x !== s.orbit) })
    }
    send({ type: 'select', icao24: s.id })
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

  // Category filter (also serves as the color legend). hiddenCategories lists
  // the categories to hide; clicking a chip toggles it.
  const hidden = state.filter.hiddenCategories ?? []
  const toggleCat = (cat: string) => {
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
            onClick={() => send({ type: 'setMode', mode: 'flight' })}
          >
            ✈ 비행기
          </button>
          <button
            role="tab"
            aria-selected={isSat}
            className={'feed-tab' + (isSat ? ' on' : '')}
            onClick={() => send({ type: 'setMode', mode: 'satellite' })}
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
        </div>
        )}
      </div>

      {/* Bottom sheet: the card slides up on selection. Keyed by icao24 so it
          re-mounts and replays the pop-up animation on every new selection. */}
      <div className="sheet">
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
