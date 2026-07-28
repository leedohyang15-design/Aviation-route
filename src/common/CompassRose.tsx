// A fixed 8-point compass rose. The equirectangular display never rotates
// (north is always up), so this is a static screen reference that stays put
// while the view pans/zooms.

const DIRS: { label: string; angle: number; major: boolean }[] = [
  { label: 'N', angle: 0, major: true },
  { label: 'NE', angle: 45, major: false },
  { label: 'E', angle: 90, major: true },
  { label: 'SE', angle: 135, major: false },
  { label: 'S', angle: 180, major: true },
  { label: 'SW', angle: 225, major: false },
  { label: 'W', angle: 270, major: true },
  { label: 'NW', angle: 315, major: false }
]

export function CompassRose(): JSX.Element {
  const C = 60
  const R = 44
  const pt = (angle: number, r: number) => {
    const a = ((angle - 90) * Math.PI) / 180
    return [C + r * Math.cos(a), C + r * Math.sin(a)]
  }
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%">
      <circle cx={C} cy={C} r={R + 8} fill="rgba(10,16,30,0.55)" stroke="rgba(127,212,255,0.35)" />
      {/* 8 spokes */}
      {DIRS.map((d) => {
        const [x, y] = pt(d.angle, R)
        return (
          <line
            key={`l${d.label}`}
            x1={C}
            y1={C}
            x2={x}
            y2={y}
            stroke={d.major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)'}
            strokeWidth={d.major ? 1.4 : 1}
          />
        )
      })}
      {/* North needle */}
      <polygon points={`${C},${C - R} ${C - 5},${C} ${C + 5},${C}`} fill="#ff3b30" opacity="0.9" />
      {/* Labels */}
      {DIRS.map((d) => {
        const [x, y] = pt(d.angle, R + 0)
        return (
          <text
            key={`t${d.label}`}
            x={x}
            y={y}
            fontSize={d.major ? 13 : 9}
            fontWeight={d.major ? 800 : 600}
            fill={d.label === 'N' ? '#ff6b60' : '#dfe8f5'}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {d.label}
          </text>
        )
      })}
    </svg>
  )
}
