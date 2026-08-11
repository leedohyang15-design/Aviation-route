import {
  MARS_PLAN,
  daysUntil,
  nextOpposition,
  nextTransferWindow,
  type MarsTarget
} from '@shared/mars-future'

/**
 * The other Mars card: a place nobody has been, and when somebody could go.
 *
 * Every other card in this exhibit reports something that already happened —
 * a plane in the air, a satellite overhead, a rover's odometer. This one is
 * the only forward-looking thing on any of the four tabs, and that is a
 * different kind of claim to make in a museum, so it is built on the part of
 * the future that is not a promise: the two planets' positions.
 *
 * The countdown at the top is arithmetic from shared/mars-future.ts and is
 * true regardless of what anybody builds. What a company intends is at the
 * BOTTOM, in small type, with the date it was said on — because that is the
 * part that goes stale, and a child should be able to see which half is which.
 */
export function MarsFutureCard({ target }: { target: MarsTarget }): JSX.Element {
  const now = Date.now()
  const win = nextTransferWindow(now)
  // The one after it, to price the cost of missing this one. Asked from a
  // month past the first departure so the search cannot find the same window.
  const after = nextTransferWindow(win.departMs + 30 * 86400000)
  const opp = nextOpposition(now)

  const left = daysUntil(win.departMs, now)
  const travel = Math.round(win.travelDays)
  const waitDays = Math.round((after.departMs - win.departMs) / 86400000)

  /*
   * The three dates, in the order they happen.
   *
   * They are not in a fixed order in principle — the closest approach falls
   * between departure and arrival for the windows around now, but the gap
   * between a launch and the opposition it chases drifts, so the list sorts
   * itself rather than assuming.
   */
  const events = [
    { at: win.departMs, what: '떠날 수 있는 날이에요. 이때를 놓치면 한참 기다려야 해요.', cls: 'landing' },
    {
      at: opp,
      what: '지구와 화성이 가장 가까워지는 날. 이날 밤하늘의 화성이 제일 크고 밝아요.',
      cls: ''
    },
    {
      at: win.arriveMs,
      // Months, because 265 days is not a length of time a child has a feel
      // for and one school year is.
      what: `${travel}일을 날아가면 도착해요. 학교 한 학년만큼 우주선 안에 있는 거예요.`,
      cls: 'live'
    }
  ].sort((a, b) => a.at - b.at)

  return (
    <div className="probe-card future">
      <div className="probe-edge" />
      <div className="probe-head">
        <div className="probe-name">
          {target.name}
          <span className="probe-sub">{target.subtitle}</span>
        </div>
        <div className="probe-state">아직 아무도 못 가봤어요</div>
      </div>
      <div className="probe-where">
        <b>{fmtCoord(target.lat, target.lonEast)}</b>
        <span>화성 북쪽의 낮은 벌판</span>
      </div>
      <p className="future-note">{target.note}</p>

      {/* Three figures, all of them time. Distance is the wrong number for this
          card: Mars is between 5,500만 and 4억 km away depending on the day,
          so "how far" has no single answer, while "how long you would be in
          the spaceship" has exactly one. */}
      <div className="probe-facts three">
        <div>
          <b>{left.toLocaleString()}일</b>
          <span>다음 출발까지</span>
        </div>
        <div>
          <b>{travel}일</b>
          <span>가는 데 걸리는 시간 · 약 {Math.round(travel / 30.44)}개월</span>
        </div>
        <div>
          <b>{monthsLabel(waitDays)}</b>
          <span>놓치면 기다리는 시간</span>
        </div>
      </div>

      <p className="future-why">
        지구는 1년, 화성은 1년 10개월 만에 해를 한 바퀴 돌아요. 그래서 둘이 나란히 서는 때가
        약 26개월에 한 번뿐이고, 로켓은 그때만 떠날 수 있어요.
      </p>

      <ol className="probe-timeline">
        {events.map((e) => (
          <li key={e.at} className={e.cls}>
            <span className="when">{fmtDate(e.at)}</span>
            <span className="what">{e.what}</span>
          </li>
        ))}
      </ol>

      {/* The perishable part, fenced off and dated. */}
      <div className="future-plan">
        <b>사람은 아직이에요</b>
        <p>
          {MARS_PLAN.who}는 {MARS_PLAN.what} {MARS_PLAN.why}
        </p>
        <em>{MARS_PLAN.asOf} 기준</em>
      </div>
    </div>
  )
}

/** "47.2°N 184.3°E", in the convention every Mars map uses today. */
function fmtCoord(lat: number, lonEast: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  return `${Math.abs(lat).toFixed(1)}°${ns} ${lonEast.toFixed(1)}°E`
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`
}

/** 762 days -> "2년 1개월". Years alone is too coarse at this cadence: every
 *  gap is "2년", and the point is that it is two years AND a bit. */
function monthsLabel(days: number): string {
  const months = Math.round(days / 30.44)
  const y = Math.floor(months / 12)
  const m = months % 12
  return m ? `${y}년 ${m}개월` : `${y}년`
}
