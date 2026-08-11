/**
 * The path a rover has actually driven, at its own scale.
 *
 * It cannot go on the globe and this is not a compromise, it is arithmetic:
 * Curiosity's wanderings span about 21km, which is 1.6 pixels at world view and
 * 16 at the deepest zoom the map allows. Reaching 600 would take 364x, and at
 * that magnification one pixel of the 23,040-wide Mars map covers 26 screen
 * pixels — the line would be real and the ground under it would be mush.
 *
 * So the traverse gets its own frame, with no basemap at all. That is not a
 * shortcut either: every published traverse map is drawn this way, because at
 * this scale the shape of the path IS the information. Where a rover doubled
 * back, where it circled something for a month, how far it has crept from the
 * spot it landed on — none of that needs a photograph behind it, and all of it
 * disappears if you try to show it on a planet.
 */

/** Mars, for turning degrees into kilometres. */
const R_KM = 3396.2

export function TraverseMap({
  path,
  drivenKm,
  className
}: {
  /** [lon, lat] in renderer degrees, landing site first. */
  path: [number, number][]
  drivenKm: number | null
  className?: string
}): JSX.Element | null {
  if (!path || path.length < 2) return null

  const W = 264
  const H = 150
  const PAD = 14

  /*
   * Degrees are not square, so the path is projected to kilometres first.
   *
   * A degree of longitude at Curiosity's latitude is very nearly a degree of
   * latitude, but at Perseverance's 18°N it is 5% shorter, and at a lander near
   * the pole it would be a fraction — plotting raw degrees would stretch the
   * track sideways by exactly that much. Kilometres from the first point costs
   * one cosine and is right everywhere.
   */
  const lon0 = path[0][0]
  const lat0 = path[0][1]
  const kx = (Math.PI / 180) * R_KM * Math.cos((lat0 * Math.PI) / 180)
  const ky = (Math.PI / 180) * R_KM
  const pts = path.map(([lon, lat]) => [(lon - lon0) * kx, -(lat - lat0) * ky] as [number, number])

  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  // One scale for both axes, or the shape is a lie.
  const spanKm = Math.max(maxX - minX, maxY - minY, 0.01)
  const scale = (Math.min(W, H) - PAD * 2) / spanKm
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const sx = (v: number): number => W / 2 + (v - cx) * scale
  const sy = (v: number): number => H / 2 + (v - cy) * scale

  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join('')

  // A round number about a third of the frame wide, so the bar is a figure
  // somebody can hold rather than "37.4 km".
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
  const target = spanKm / 3
  const barKm = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), nice[0])
  const barPx = barKm * scale

  const last = pts[pts.length - 1]

  return (
    <figure className={'traverse ' + (className ?? '')}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="탐사차가 다닌 길">
        <path d={d} className="track" />
        {/* Where it came down, and where it is now. Two ends of one line is the
            whole story; anything more is decoration on a 260-pixel picture. */}
        <circle cx={sx(0)} cy={sy(0)} r={4} className="start" />
        <circle cx={sx(last[0])} cy={sy(last[1])} r={4.5} className="now" />
        <g className="bar" transform={`translate(${PAD} ${H - PAD})`}>
          <line x1={0} y1={0} x2={barPx} y2={0} />
          <line x1={0} y1={-3} x2={0} y2={3} />
          <line x1={barPx} y1={-3} x2={barPx} y2={3} />
          <text x={barPx / 2} y={-6}>
            {barKm < 1 ? `${barKm * 1000} m` : `${barKm} km`}
          </text>
        </g>
      </svg>
      <figcaption>
        <span className="k start">내린 곳</span>
        <span className="k now">지금</span>
        {drivenKm != null && <span className="total">모두 {drivenKm.toFixed(1)} km를 달렸어요</span>}
      </figcaption>
    </figure>
  )
}
