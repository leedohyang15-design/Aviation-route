/*
 * The settings screen.
 *
 * Reached by a LONG PRESS on the gear in the corner, not by a tab. The control
 * screen is a touchscreen in front of children, and a settings tab sitting in
 * the same row as 비행기 and 화성 would be pressed within the hour — probably
 * during a school visit, certainly by somebody who has no idea what a poll
 * interval is. A one-and-a-half second hold is nothing to an operator who knows
 * it is there and is not something a visitor arrives at by accident.
 *
 * Everything here shows what the HUB holds, not what was typed. Edits are sent
 * up, the hub clamps or refuses them, and the answer comes back down and
 * redraws these fields — so a refused edit visibly snaps back instead of
 * leaving somebody believing a change that never happened.
 */
import { useEffect, useRef, useState } from 'react'
import type { ClientMessage, LogLine, Settings, SettingsView } from '@shared/types'
import { SETTINGS_NEED_RESTART } from '@shared/types'
import { LogView } from './LogView'
import './settings.css'

interface Props {
  view: SettingsView | null
  send: (msg: ClientMessage) => void
  onClose: () => void
  /** The operator log, streamed only while this panel is open. */
  log: LogLine[]
  watchLog: (on: boolean) => void
}

/** How a duration is typed in: whole seconds or whole minutes, never ms. Nobody
 *  should be counting zeroes on a touchscreen. */
type Unit = { label: string; per: number; step: number; decimals?: number }
const SEC: Unit = { label: '초', per: 1000, step: 1 }
const MIN: Unit = { label: '분', per: 60_000, step: 1 }
const DEG: Unit = { label: '°', per: 1, step: 0.5, decimals: 1 }
const RATIO: Unit = { label: '', per: 1, step: 0.01, decimals: 2 }

interface NumField {
  key: keyof Settings
  label: string
  hint: string
  unit: Unit
  min: number
  max: number
}

/* The four groups mirror the handover note's table, in the order somebody
   reaches for them: data first, picture second, connection last. */
const DATA_FIELDS: NumField[] = [
  {
    key: 'openskyPollMs',
    label: '비행기 갱신 주기',
    hint: 'OpenSky 크레딧이 이 주기에 맞춰져 있습니다. 짧게 하면 하루치가 일찍 바닥나 하늘이 빕니다.',
    unit: SEC,
    min: 30,
    max: 600
  },
  {
    key: 'satTickMs',
    label: '위성 위치 계산 주기',
    hint: '궤도 정보는 하루 한 번 받고, 위치는 이 주기로 다시 계산합니다.',
    unit: SEC,
    min: 0.5,
    max: 30
  },
  {
    key: 'weatherPollMs',
    label: '날씨 확인 주기',
    hint: '기상 모델은 한 시간에 한 번 갱신됩니다. 이보다 자주 확인해도 새 그림은 없습니다.',
    unit: MIN,
    min: 1,
    max: 60
  },
  {
    key: 'weatherMaxAgeMs',
    label: '날씨 영상 유효 시간',
    hint: '이보다 오래된 그림은 아예 띄우지 않고 "불러오는 중"을 보여줍니다. 오전 하늘을 오후에 보여주지 않기 위한 값입니다.',
    unit: MIN,
    min: 10,
    max: 1440
  }
]

const SCREEN_FIELDS: NumField[] = [
  {
    key: 'jupiterMapLatLimit',
    label: '목성 지도 위도 범위',
    hint: '목성 지도가 실제로 그림을 갖고 있는 범위. 공개된 지도는 대개 60° 부근에서 끊기고, 그보다 1~2° 안쪽으로 잡습니다. 극지방까지 있는 지도라면 90.',
    unit: DEG,
    min: 20,
    max: 90
  },
  {
    key: 'jupiterDayPeriodMs',
    label: '목성 자전 한 바퀴',
    hint: '화면상의 하루. 실제로는 9시간 55분이지만 관람객이 보는 몇 분 안에는 움직이지 않아 압축했습니다. 0이면 멈춥니다.',
    unit: MIN,
    min: 0,
    max: 60
  },
  {
    key: 'marsLift',
    label: '화성 밝기',
    hint: '중간 밝기만 끌어올립니다. 1이면 원본 그대로. 프로젝터가 어두우면 올리세요.',
    unit: RATIO,
    min: 0.4,
    max: 2.5
  }
]

function fmt(value: number, unit: Unit): string {
  const v = value / unit.per
  return unit.decimals != null ? v.toFixed(unit.decimals) : String(Math.round(v * 100) / 100)
}

export function SettingsPanel({ view, send, onClose, log, watchLog }: Props): JSX.Element {
  const [tab, setTab] = useState<'settings' | 'log'>('settings')
  /*
   * Subscribe while this panel is open, and only while it is open.
   *
   * The log is a line every few seconds and each one is a React render; a
   * window showing the exhibit has no use for that. Asking here rather than at
   * the tab means the history is already loaded when somebody switches to 기록,
   * which is the difference between a tab that opens and a tab that loads.
   */
  useEffect(() => {
    watchLog(true)
    return () => watchLog(false)
  }, [watchLog])
  const problems = log.filter((l) => l.level !== 'info').length
  /* Typed-but-not-yet-sent text, per field. Held separately from the hub's copy
     so a half-typed "9" in a box does not get read as ninety milliseconds and
     sent on every keystroke. */
  const [draft, setDraft] = useState<Record<string, string>>({})
  /*
   * Clearing a draft means REMOVING the key, not setting it to ''.
   *
   * The fields read `draft[key] ?? liveValue`, and ?? only falls back on
   * null/undefined — so an empty-string draft is a value, it wins, and the box
   * goes blank at the exact moment the save succeeds. Which looks like the save
   * wiped the setting.
   */
  const clearDraft = (key: string): void =>
    setDraft((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const flash = (text: string): void => {
    setSaved(text)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(null), 2200)
  }

  if (!view) {
    return (
      <div className="settings-scrim" role="dialog" aria-label="설정">
        <div className="settings-panel">
          <p className="settings-empty">허브에 연결하는 중이에요…</p>
          <button className="settings-close" onClick={onClose}>닫기</button>
        </div>
      </div>
    )
  }

  const commit = (f: NumField, text: string): void => {
    const typed = Number(text)
    if (!Number.isFinite(typed)) {
      clearDraft(f.key)
      return
    }
    const clamped = Math.min(f.max, Math.max(f.min, typed))
    /*
     * Round only what is being converted INTO milliseconds.
     *
     * The rounding is there so "1.5 minutes" arrives as a whole number of
     * milliseconds rather than a fraction of one. Applied to the fields whose
     * unit is already the stored unit — the Mars lift, Jupiter's latitude — it
     * quietly threw the decimals away, and 2.2 was saved as 2.
     */
    const value = f.unit.per === 1 ? clamped : Math.round(clamped * f.unit.per)
    send({ type: 'setSettings', patch: { [f.key]: value } as Partial<Settings> })
    clearDraft(f.key)
    flash(`${f.label} 저장됨`)
  }

  const numberRow = (f: NumField): JSX.Element => {
    const live = view[f.key as keyof SettingsView] as number
    const shown = draft[f.key] ?? fmt(live, f.unit)
    const locked = view.source[f.key] === 'env'
    return (
      <div className={'set-row' + (locked ? ' locked' : '')} key={f.key}>
        <div className="set-label">
          <label htmlFor={`set-${f.key}`}>{f.label}</label>
          {view.source[f.key] === 'file' && <span className="set-badge changed">변경됨</span>}
          {locked && <span className="set-badge env">.env 고정</span>}
        </div>
        <div className="set-control">
          <input
            id={`set-${f.key}`}
            type="number"
            inputMode="decimal"
            step={f.unit.step}
            min={f.min}
            max={f.max}
            disabled={locked}
            value={shown}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            onBlur={(e) => {
              if (draft[f.key] != null && draft[f.key] !== '') commit(f, e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <span className="set-unit">{f.unit.label}</span>
          <span className="set-range">
            {f.min}–{f.max}
          </span>
        </div>
        <p className="set-hint">{f.hint}</p>
      </div>
    )
  }

  const secretRow = (
    key: 'openskyClientId' | 'openskyClientSecret' | 'maptilerKey',
    label: string,
    hint: string
  ): JSX.Element => {
    const st = view.secrets[key]
    return (
      <div className={'set-row' + (st.fromEnv ? ' locked' : '')} key={key}>
        <div className="set-label">
          <label htmlFor={`set-${key}`}>{label}</label>
          {st.set && <span className="set-badge ok">…{st.tail}</span>}
          {!st.set && <span className="set-badge missing">없음</span>}
          {st.fromEnv && <span className="set-badge env">.env 고정</span>}
        </div>
        <div className="set-control">
          <input
            id={`set-${key}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={st.fromEnv}
            placeholder={st.set ? '바꾸려면 새 값을 입력' : '값을 입력'}
            value={secretDraft[key] ?? ''}
            onChange={(e) => setSecretDraft((d) => ({ ...d, [key]: e.target.value }))}
          />
          <button
            className="set-apply"
            disabled={st.fromEnv || !(secretDraft[key] ?? '').trim()}
            onClick={() => {
              send({ type: 'setSettings', patch: { [key]: secretDraft[key]!.trim() } as Partial<Settings> })
              setSecretDraft((d) => ({ ...d, [key]: '' }))
              flash(`${label} 저장됨 · 다시 시작해야 적용됩니다`)
            }}
          >
            저장
          </button>
        </div>
        <p className="set-hint">{hint}</p>
      </div>
    )
  }

  const tint = view.marsTint
  const tintRow = (i: number, name: string): JSX.Element => (
    <div className="tint-cell" key={name}>
      <label htmlFor={`tint-${i}`}>{name}</label>
      <input
        id={`tint-${i}`}
        type="number"
        step={0.01}
        min={0.5}
        max={1.8}
        value={draft[`tint${i}`] ?? tint[i].toFixed(2)}
        disabled={view.source.marsTint === 'env'}
        onChange={(e) => setDraft((d) => ({ ...d, [`tint${i}`]: e.target.value }))}
        onBlur={() => {
          const next: [number, number, number] = [tint[0], tint[1], tint[2]]
          const raw = draft[`tint${i}`]
          if (raw == null || raw === '') return
          const typed = Number(raw)
          if (!Number.isFinite(typed)) return clearDraft(`tint${i}`)
          next[i] = Math.min(1.8, Math.max(0.5, typed))
          send({ type: 'setSettings', patch: { marsTint: next } })
          clearDraft(`tint${i}`)
          flash('화성 색조 저장됨')
        }}
      />
    </div>
  )

  return (
    <div className="settings-scrim" role="dialog" aria-modal="true" aria-label="설정">
      <div className="settings-panel">
        <header className="settings-head">
          <div>
            <h2>설정</h2>
            <p>바꾸면 바로 저장됩니다. 프로그램을 다시 설치할 필요는 없습니다.</p>
          </div>
          <button className="settings-close" onClick={onClose} aria-label="설정 닫기">
            닫기
          </button>
        </header>

        <div className="panel-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'settings'}
            className={'panel-tab' + (tab === 'settings' ? ' on' : '')}
            onClick={() => setTab('settings')}
          >
            설정
          </button>
          <button
            role="tab"
            aria-selected={tab === 'log'}
            className={'panel-tab' + (tab === 'log' ? ' on' : '')}
            onClick={() => setTab('log')}
          >
            기록
            {problems > 0 && <span className="tab-badge">{problems}</span>}
          </button>
        </div>

        {tab === 'log' && <LogView lines={log} path={view.logPath} />}

        {tab === 'settings' && view.restartPending && (
          <div className="settings-notice">
            다시 시작해야 적용되는 값이 바뀌었습니다. 전시를 껐다 켜 주세요.
          </div>
        )}

        {tab === 'settings' && (
        <div className="settings-body">
          <section>
            <h3>데이터 갱신</h3>
            {DATA_FIELDS.map(numberRow)}
          </section>

          <section>
            <h3>화면</h3>
            {SCREEN_FIELDS.map(numberRow)}
            <div className={'set-row' + (view.source.marsTint === 'env' ? ' locked' : '')}>
              <div className="set-label">
                <label>화성 색조</label>
                {view.source.marsTint === 'file' && <span className="set-badge changed">변경됨</span>}
                {view.source.marsTint === 'env' && <span className="set-badge env">.env 고정</span>}
              </div>
              <div className="set-control tint">
                {tintRow(0, '빨강')}
                {tintRow(1, '초록')}
                {tintRow(2, '파랑')}
              </div>
              <p className="set-hint">
                셋 다 1이면 원본 그대로입니다. 화성이 너무 붉으면 초록·파랑을 조금 올리세요 —
                채도를 낮추면 그냥 탁한 빨강이 됩니다.
              </p>
            </div>
          </section>

          <section>
            <h3>
              연결과 키
              <span className="sec-note">여기 값은 다시 시작해야 적용됩니다</span>
            </h3>
            {secretRow('openskyClientId', 'OpenSky 아이디', '비행기 데이터를 받는 계정입니다. 없으면 하늘이 빕니다.')}
            {secretRow('openskyClientSecret', 'OpenSky 비밀키', '입력한 값은 화면에도 로그에도 다시 나타나지 않습니다.')}
            {secretRow('maptilerKey', 'MapTiler 키', '비와 바람에 필요합니다. 구름은 이 키가 없어도 나옵니다.')}
            <div className="set-row">
              <div className="set-label">
                <label htmlFor="set-port">통신 포트</label>
                {view.source.hubPort === 'file' && <span className="set-badge changed">변경됨</span>}
              </div>
              <div className="set-control">
                <input
                  id="set-port"
                  type="number"
                  min={1024}
                  max={65535}
                  step={1}
                  disabled={view.source.hubPort === 'env'}
                  value={draft.hubPort ?? String(view.hubPort)}
                  onChange={(e) => setDraft((d) => ({ ...d, hubPort: e.target.value }))}
                  onBlur={(e) => {
                    if (!draft.hubPort) return
                    const v = Math.min(65535, Math.max(1024, Number(e.target.value) || 8787))
                    send({ type: 'setSettings', patch: { hubPort: v } })
                    clearDraft('hubPort')
                    flash('통신 포트 저장됨 · 다시 시작해야 적용됩니다')
                  }}
                />
                <span className="set-range">1024–65535</span>
              </div>
              <p className="set-hint">
                두 창과 데이터 수집기가 이 포트로 이야기합니다. 다른 프로그램과 겹칠 때만 바꾸세요.
              </p>
            </div>
          </section>

          <section>
            <h3>파일 위치</h3>
            <p className="set-path">{view.dataDir}</p>
            <p className="set-hint">
              기록(<code>aviation-route.log</code>), 설정, 그리고 위성·노선·날씨·화성 캐시가 모두
              이 폴더에 있습니다. 문제가 생기면 이 폴더의 기록 파일부터 보세요.
            </p>
          </section>

          <section>
            <h3>초기화</h3>
            <button
              className="set-reset"
              onClick={() => {
                send({ type: 'resetSettings' })
                flash('기본값으로 되돌렸습니다')
              }}
            >
              모든 설정을 기본값으로
            </button>
            <p className="set-hint">
              이 화면에서 바꾼 값만 지워집니다. <code>.env</code>로 고정한 값은 그대로 남습니다.
            </p>
          </section>
        </div>
        )}

        {tab === 'settings' && (
          <footer className="settings-foot">
            <span className="settings-saved">{saved}</span>
            <span className="settings-restart-list">
              다시 시작 필요: {SETTINGS_NEED_RESTART.length}개 항목 (키 3개, 포트)
            </span>
          </footer>
        )}
      </div>
    </div>
  )
}
