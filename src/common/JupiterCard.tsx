import { GALILEO_PROBE, moonPeriodDays, type JupiterMoon } from '@shared/jupiter'
import { MoonOrrery } from './MoonOrrery'
import { useAutoScroll } from './useAutoScroll'

/**
 * The two things you can tap on the Jupiter tab, as two cards that share a
 * shape.
 *
 * They reuse .probe-card because a visitor arriving here from Mars should not
 * have to learn a second card — the panel, the status pill, the coloured rule
 * and the scrolling body all mean what they meant one tab ago. What changes is
 * the figure each one leads with, and that is the point of each card: a moon
 * leads with the length of its day, and the probe with how long it lasted.
 */

/** 3,643 km against something a child has a size for. */
const MOON_KM = 3475

export function MoonCard({ moon, now }: { moon: JupiterMoon; now: number }): JSX.Element {
  const scroller = useAutoScroll<HTMLDivElement>()
  const days = moonPeriodDays(moon)
  const hours = days * 24
  const vsMoon = moon.diameterKm / MOON_KM

  return (
    <div className="probe-card jupiter">
      <div className="probe-edge" style={{ background: moon.color }} />
      <div className="probe-head">
        <div className="probe-name">
          {moon.name}
          <span className="probe-sub">{moon.subtitle}</span>
        </div>
        <div className="probe-state">목성의 달</div>
      </div>

      <div className="future-scroll" ref={scroller}>
        <div className="probe-where">
          <b>{moon.headline}</b>
        </div>

        <div className="probe-facts three">
          {/*
           * The year, not the day. These four are tidally locked, so one trip
           * round Jupiter IS one of their days — and Io's is under two of ours,
           * which is the fact that makes the orrery below worth watching: come
           * back after lunch and it has moved.
           */}
          <div>
            <b>{days < 5 ? `${hours.toFixed(0)}시간` : `${days.toFixed(1)}일`}</b>
            <span>한 바퀴 도는 데</span>
          </div>
          <div>
            <b>{(moon.distanceKm / 10000).toFixed(0)}만 km</b>
            <span>목성과의 거리</span>
          </div>
          <div>
            <b>{moon.diameterKm.toLocaleString()} km</b>
            {/* "1.0배" is an odd way to say "the same size", and Io is within
                5% of our moon. Say it in words at that range. */}
            <span>
              {Math.abs(vsMoon - 1) < 0.1
                ? '우리 달과 거의 같아요'
                : `우리 달의 ${vsMoon.toFixed(1)}배`}
            </span>
          </div>
        </div>

        <MoonOrrery now={now} selected={moon.id} />
        {/* The map shows the same thing flattened out, and a visitor who has
            just tapped a chip needs telling which dot moved. */}
        <p className="future-note">
          지도 위의 {moon.name} 점은 지금 목성 둘레의 어느 쪽에 있는지를 보여줘요. 실제로는
          목성에서 {(moon.distanceKm / 10000).toFixed(0)}만 km 떨어져 있어요.
        </p>

        <ol className="probe-timeline">
          {moon.facts.map((f, i) => (
            <li key={i} className={i === 0 ? 'landing' : ''}>
              <span className="what">{f}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export function ProbeEntryCard({ now }: { now: number }): JSX.Element {
  const scroller = useAutoScroll<HTMLDivElement>()
  const p = GALILEO_PROBE
  const mins = Math.floor(p.lastedSec / 60)
  const secs = p.lastedSec % 60
  const years = Math.floor((now - Date.parse(p.entered + 'T00:00:00Z')) / (365.2425 * 86400000))

  return (
    <div className="probe-card jupiter">
      <div className="probe-edge" style={{ background: p.color }} />
      <div className="probe-head">
        <div className="probe-name">
          {p.name}
          <span className="probe-sub">{p.subtitle}</span>
        </div>
        <div className="probe-state">딱 한 번 있었던 일</div>
      </div>

      <div className="future-scroll" ref={scroller}>
        <div className="probe-where">
          <b>
            {p.lat}°N {p.lonWest}°W
          </b>
          <span>{years}년 전, 지도 위의 저 점</span>
        </div>
        <p className="future-note">
          사람이 만든 것 중에 목성 안으로 들어간 건 이것 하나뿐이에요.
        </p>

        <div className="probe-facts three">
          <div>
            <b>
              {mins}분 {secs}초
            </b>
            <span>버틴 시간</span>
          </div>
          <div>
            <b>{p.bar}배</b>
            <span>땅 위 공기 압력의</span>
          </div>
          <div>
            <b>{p.entered.slice(0, 4)}년</b>
            <span>들어간 해</span>
          </div>
        </div>

        <ol className="probe-timeline">
          <li className="landing">
            <span className="when">1995년 12월 7일</span>
            <span className="what">
              시속 17만 km로 목성 구름 속에 뛰어들었어요. 태양계에서 가장 빠른 진입이었어요.
            </span>
          </li>
          <li>
            <span className="when">57분 36초</span>
            <span className="what">
              낙하산을 펴고 내려가면서 바람과 구름과 번개를 재서 보냈어요.
            </span>
          </li>
          <li className="end">
            <span className="when">마지막</span>
            <span className="what">
              공기 압력이 {p.bar}배까지 올라가자 신호가 끊겼어요. 바닷속 {p.bar * 10} m에서 받는
              압력과 비슷해요.
            </span>
          </li>
          <li>
            <span className="what">
              그 아래로는 아무도 가본 적이 없어요. 목성엔 발 디딜 땅이 없거든요.
            </span>
          </li>
        </ol>
      </div>
    </div>
  )
}
