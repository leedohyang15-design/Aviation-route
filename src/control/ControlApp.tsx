import { useMemo } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { MapView } from './MapView'
import type { FlightFilter, OverlayKey } from '@shared/types'

export function ControlApp(): JSX.Element {
  const { send, aircraft, state, connected, source, route } = useHub('control')
  const visible = useMemo(() => applyFilter(aircraft, state.filter), [aircraft, state.filter])
  const sel = state.selected ? aircraft.find((a) => a.icao24 === state.selected) : null

  const countries = useMemo(() => {
    const set = new Set<string>()
    for (const a of aircraft) if (a.originCountry) set.add(a.originCountry)
    return [...set].sort()
  }, [aircraft])

  const patchFilter = (patch: Partial<FlightFilter>) =>
    send({ type: 'setFilter', filter: { ...state.filter, ...patch } })
  const toggleOverlay = (key: OverlayKey) => send({ type: 'toggleOverlay', key })

  return (
    <div className="control-root">
      <MapView
        aircraft={visible}
        selected={state.selected}
        route={route.points}
        onSelect={(icao24) => send({ type: 'select', icao24 })}
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
              <div className="callsign">{sel.callsign || sel.icao24.toUpperCase()}</div>
              <div className="row">
                <span>고도</span>
                <b>{sel.altitude != null ? `${Math.round(sel.altitude).toLocaleString()} m` : '—'}</b>
              </div>
              <div className="row">
                <span>속도</span>
                <b>{sel.velocity != null ? `${Math.round(sel.velocity * 3.6)} km/h` : '—'}</b>
              </div>
              <div className="row">
                <span>방위</span>
                <b>{sel.heading != null ? `${Math.round(sel.heading)}°` : '—'}</b>
              </div>
              <div className="row">
                <span>국적</span>
                <b>{sel.originCountry || '—'}</b>
              </div>
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

        <section>
          <h2>오버레이</h2>
          {(
            [
              ['grid', '위경도 격자'],
              ['stats', '통계 표시']
            ] as [OverlayKey, string][]
          ).map(([key, label]) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={!!state.overlays[key]}
                onChange={() => toggleOverlay(key)}
              />
              {label}
            </label>
          ))}
        </section>
      </aside>
    </div>
  )
}
