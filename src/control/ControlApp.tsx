import { useMemo } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { MapView } from './MapView'

export function ControlApp(): JSX.Element {
  const { send, aircraft, state, connected, source, route, detail } = useHub('control')
  const visible = useMemo(
    () => applyFilter(aircraft, state.filter, state.selected),
    [aircraft, state.filter, state.selected]
  )
  const sel = state.selected ? visible.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null

  // Category filter (also serves as the color legend). hiddenCategories lists
  // the categories to hide; clicking a chip toggles it.
  const hidden = state.filter.hiddenCategories ?? []
  const toggleCat = (cat: string) => {
    const next = hidden.includes(cat) ? hidden.filter((c) => c !== cat) : [...hidden, cat]
    send({ type: 'setFilter', filter: { ...state.filter, hiddenCategories: next } })
  }

  return (
    <div className="control-root">
      <MapView
        aircraft={visible}
        selected={state.selected}
        route={route.points}
        onSelect={(icao24) => send({ type: 'select', icao24 })}
        onView={(view) => send({ type: 'setView', view })}
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
          <b>{visible.length.toLocaleString()}</b> 대 비행 중
        </div>
        <div className={connected ? 'ok' : 'warn'}>
          {source === 'mock' ? '시뮬레이션 데이터' : 'OpenSky Network'} ·{' '}
          {connected ? '연결됨' : '재연결 중…'}
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
    </div>
  )
}
