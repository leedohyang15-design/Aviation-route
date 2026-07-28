import { useMemo } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { MapView } from './MapView'

export function ControlApp(): JSX.Element {
  const { send, aircraft, state, connected, source, route, detail } = useHub('control')
  const visible = useMemo(() => applyFilter(aircraft, state.filter), [aircraft, state.filter])
  const sel = state.selected ? visible.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null

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
      </div>

      {/* Bottom sheet: the boarding-pass card slides up when a plane is selected. */}
      <div className={'sheet' + (sel ? ' open' : '')}>
        {sel && <FlightDetailCard aircraft={sel} detail={d} />}
      </div>
    </div>
  )
}
