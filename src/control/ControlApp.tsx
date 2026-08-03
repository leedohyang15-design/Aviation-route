import { useMemo, useState } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { MapView } from './MapView'

export function ControlApp(): JSX.Element {
  const { send, aircraft, state, connected, source, credentials, route, detail } = useHub('control')
  const visible = useMemo(
    () => applyFilter(aircraft, state.filter, state.selected),
    [aircraft, state.filter, state.selected]
  )
  const sel = state.selected ? visible.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null
  // Total aircraft actually airborne worldwide (before the category/known filter).
  const airborne = useMemo(
    () => aircraft.reduce((n, a) => (a.onGround ? n : n + 1), 0),
    [aircraft]
  )
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

  // "Scheduled only" toggle: off by default (everything shows, including
  // route-unknown planes); on → keep only scheduled airline/cargo callsigns,
  // which is what actually resolves a route.
  const scheduledOnly = state.filter.scheduledOnly ?? false
  const toggleScheduled = () => {
    send({ type: 'setFilter', filter: { ...state.filter, scheduledOnly: !scheduledOnly } })
  }

  // "Route known only": hides aircraft confirmed to have no published route, so
  // visitors don't land on a plane that can't draw one. On by default.
  const routeOnly = state.filter.routeOnly ?? false
  const toggleRouteOnly = () => {
    send({ type: 'setFilter', filter: { ...state.filter, routeOnly: !routeOnly } })
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
          지금 하늘에 ✈ <b>{airborne.toLocaleString()}</b>대
        </div>
        <div className={'src ' + (live ? 'ok' : 'warn')}>{statusText}</div>
        {/* Data source tabs — live by default, simulation on demand. */}
        <div className="feed-tabs" role="tablist" aria-label="데이터 소스">
          <button
            role="tab"
            aria-selected={feedMode === 'auto'}
            className={'feed-tab' + (feedMode === 'auto' ? ' on' : '')}
            onClick={() => send({ type: 'setFeedMode', mode: 'auto' })}
            title="OpenSky 실시간 데이터 (끊기면 자동으로 시뮬레이션)"
          >
            📡 실시간
          </button>
          <button
            role="tab"
            aria-selected={feedMode === 'mock'}
            className={'feed-tab' + (feedMode === 'mock' ? ' on' : '')}
            onClick={() => send({ type: 'setFeedMode', mode: 'mock' })}
            title="시뮬레이션 데이터 (인터넷·크레딧 없이도 동작)"
          >
            🎮 시뮬레이션
          </button>
        </div>
        <div className="legend">
          <button
            className={'leg' + (hidden.includes('passenger') ? ' off' : '')}
            onClick={() => toggleCat('passenger')}
          >
            <i style={{ background: '#35c1ff' }} />
            여객기
          </button>
          <button
            className={'leg' + (hidden.includes('cargo') ? ' off' : '')}
            onClick={() => toggleCat('cargo')}
          >
            <i style={{ background: '#f5a623' }} />
            화물기
          </button>
          <button
            className={'leg' + (hidden.includes('military') ? ' off' : '')}
            onClick={() => toggleCat('military')}
          >
            <i style={{ background: '#74d16a' }} />
            군용기
          </button>
        </div>
        <div className="legend">
          <button
            className={'leg toggle' + (scheduledOnly ? ' on' : '')}
            onClick={toggleScheduled}
            title="식별되는 항공기(여객·화물·군용)만 표시 / 끄면 전체"
          >
            {scheduledOnly ? '✓ 여객·화물·군용만' : '전체 표시'}
          </button>
          <button
            className={'leg toggle' + (routeOnly ? ' on' : '')}
            onClick={toggleRouteOnly}
            title="경로가 확인된 항공기만 표시 / 끄면 경로 없는 것도 보임"
          >
            {routeOnly ? '✓ 경로 있는 것만' : '경로 없어도 표시'}
          </button>
        </div>
      </div>

      {/* Bottom sheet: the card slides up on selection. Keyed by icao24 so it
          re-mounts and replays the pop-up animation on every new selection. */}
      <div className="sheet">
        {sel && (
          <div className="sheet-card" key={state.selected ?? ''}>
            <FlightDetailCard aircraft={sel} detail={d} />
          </div>
        )}
      </div>

      {/* Touch hint (bottom-center) — invites visitors to interact; hidden once
          a plane is selected so it doesn't fight the boarding-pass card. */}
      {(!state.selected || attract) && (
        <div className="touch-hint">🖐 지구를 돌리고, 비행기를 눌러보세요!</div>
      )}
    </div>
  )
}
