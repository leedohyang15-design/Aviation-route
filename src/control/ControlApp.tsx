import { useMemo } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { MapView } from './MapView'
import type { FlightFilter } from '@shared/types'

export function ControlApp(): JSX.Element {
  const { send, aircraft, state, connected, source, route, detail } = useHub('control')
  const visible = useMemo(() => applyFilter(aircraft, state.filter), [aircraft, state.filter])
  const sel = state.selected ? visible.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null

  const countries = useMemo(() => {
    const set = new Set<string>()
    for (const a of aircraft) if (a.originCountry) set.add(a.originCountry)
    return [...set].sort()
  }, [aircraft])

  const patchFilter = (patch: Partial<FlightFilter>) =>
    send({ type: 'setFilter', filter: { ...state.filter, ...patch } })

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

      <aside className="panel">
        <div className="brand">
          <h1>항공 경로 컨트롤</h1>
          <span className={`status ${connected ? 'ok' : 'warn'}`}>
            {source === 'mock' ? '시뮬레이션' : 'OpenSky'} · {connected ? '연결됨' : '재연결 중…'}
          </span>
        </div>

        <section>
          <h2>선택된 비행기</h2>
          {sel ? (
            <div className="selcard">
              <FlightDetailCard aircraft={sel} detail={d} />
              <button onClick={() => send({ type: 'select', icao24: null })}>선택 해제</button>
            </div>
          ) : (
            <p className="hint">지도에서 비행기를 클릭하세요.</p>
          )}
        </section>

        <section>
          <h2>필터 ({visible.length.toLocaleString()}대 표시)</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={!!state.filter.airborneOnly}
              onChange={(e) => patchFilter({ airborneOnly: e.target.checked })}
            />
            비행 중인 항공기만
          </label>
          <label className="field">
            국적
            <select
              value={state.filter.originCountry ?? ''}
              onChange={(e) => patchFilter({ originCountry: e.target.value || undefined })}
            >
              <option value="">전체</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            최소 고도: {(state.filter.minAltitude ?? 0).toLocaleString()} m
            <input
              type="range"
              min={0}
              max={12000}
              step={500}
              value={state.filter.minAltitude ?? 0}
              onChange={(e) => patchFilter({ minAltitude: Number(e.target.value) || undefined })}
            />
          </label>
        </section>
      </aside>
    </div>
  )
}
