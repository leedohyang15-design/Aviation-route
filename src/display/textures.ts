// Pure canvas-texture + geometry helpers for the Globe renderer. These are
// stateless (no scene/class dependencies), so they live apart from the main
// engine file to keep globe.ts focused on rendering state.
import * as THREE from 'three'
import type { CategoryKey } from '../common/flightClass'

/** Screen-space heading (radians) for the icon: on equirectangular a great
 * circle is curved, so the on-screen tangent differs from the geographic
 * bearing — 1/cos(lat) stretches longitude. This keeps icons aligned to motion. */
export function screenAngle(headingRad: number, latDeg: number): number {
  const cosLat = Math.max(0.05, Math.cos((latDeg * Math.PI) / 180))
  const dx = Math.sin(headingRad) / cosLat
  const dy = Math.cos(headingRad)
  return Math.atan2(-dx, dy)
}

/** A round dot with a white ring — the origin/departure marker. */
export function dotTexture(color: string): THREE.CanvasTexture {
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = s * 0.09
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** A teardrop location pin (tip at bottom-center) — the destination marker. */
export function pinTexture(color: string): THREE.CanvasTexture {
  const W = 64
  const H = 96
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const cx = W / 2
  const cy = W * 0.46
  const r = W * 0.34
  ctx.fillStyle = color
  // Stalk from the head down to the tip.
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.72, cy + r * 0.4)
  ctx.lineTo(cx + r * 0.72, cy + r * 0.4)
  ctx.lineTo(cx, H - 3)
  ctx.closePath()
  ctx.fill()
  // Round head.
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = W * 0.06
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  // White hole in the middle.
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * A soft halo, drawn additively behind the selected object so it reads as lit
 * once the map goes dark. Two stops rather than one: a bright small core that
 * looks like a lamp, and a wide faint falloff that lifts the map around it.
 */
export function glowTexture(): THREE.CanvasTexture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.12, 'rgba(255,255,255,0.75)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The lights an object carries in the dark, drawn as soft dots on a transparent
 * quad — an aircraft's two wingtip lights, a satellite's single beacon on its
 * nose. Drawn white and tinted where it's used, and only ever for the selected
 * object: this marks what the operator has targeted, so it says "this one"
 * rather than decorating the whole swarm.
 *
 * Spots are in icon-relative coordinates, where the icon spans -1..1 in both
 * axes (y down, since that is how the silhouettes are drawn). The quad is
 * larger than the icon by LIGHT_QUAD_SCALE so the glow can bloom past the
 * silhouette the way a real light does; the icon still maps to the middle of
 * it, so a spot lands exactly where it was placed whatever that scale is.
 */
export function lightTexture(spots: readonly { x: number; y: number }[]): THREE.CanvasTexture {
  const S = 160
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const half = S / 2 / LIGHT_QUAD_SCALE // half-width of the icon inside this quad
  for (const spot of spots) {
    const cx = S / 2 + spot.x * half
    const cy = S / 2 + spot.y * half
    const r = S * 0.13
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Where the lights sit on each icon, read off the silhouettes themselves:
 * PLANE_SVG's wings reach x=5.5 and 58.5 of a 64 box at y=42, and
 * satelliteTexture's dish sits at the top of the body, at y=-24 of 128.
 */
export const LIGHT_SPOTS = {
  aircraft: [
    { x: -(32 - 5.5) / 32, y: (42 - 32) / 32 },
    { x: (32 - 5.5) / 32, y: (42 - 32) / 32 }
  ],
  satellite: [{ x: 0, y: -24 / 64 }]
} as const

/** How much larger the light quad is than the icon it rides on. */
export const LIGHT_QUAD_SCALE = 1.7

/** A CanvasTexture of a text label (white with dark outline). Returns aspect w/h. */
export function textTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const fontSize = 44
  const pad = 12
  const c = document.createElement('canvas')
  let ctx = c.getContext('2d')!
  ctx.font = `bold ${fontSize}px sans-serif`
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = fontSize + pad * 2
  c.width = w
  c.height = h
  ctx = c.getContext('2d')!
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, w / 2, h / 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, w / 2, h / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, aspect: w / h }
}

// ---------------------------------------------------------------------------
// The dome callout.
//
// The projected frame carries ONE piece of text now, and it is the only thing
// on it a visitor across the room can read: how long until the aircraft lands,
// or until the satellite is overhead. The full instrument card moved to the
// control screen, where an operator is close enough to read six rows of
// figures; on the dome those rows were detail nobody could resolve, competing
// with the thing they were actually watching.
//
// Dark type on a light plate, because that is the contrast that survives a
// projector. Laid out in DESIGN UNITS and rasterized at SS x, as the card was.
// ---------------------------------------------------------------------------

const PAPER = '#f7f5f0'
const INK = '#14120f'
const ACCENT = '#e8590c'

const MONO = `'Consolas','SFMono-Regular',ui-monospace,monospace`
const SANS = `'Pretendard',system-ui,-apple-system,'Segoe UI',sans-serif`

const SS = 3 // supersample: canvas pixels per design unit
/** Design units spanning the frame height. Smaller number, bigger callout. */
const CALLOUT_FRAME_H = 780

const CALLOUT_H = 50
/** Height of the name line above the figure. */
const TITLE_H = 27
const CALLOUT_PAD = 17
const EDGE_W = 5 // accent bar down the leading edge

type Ctx = CanvasRenderingContext2D

/**
 * The plate the dome carries.
 *
 * A title line naming the object — "KE902  인천 → 파리" — over the one figure a
 * visitor wants from across a room: "도착까지 [11시간 37분] 남음", with the
 * figure set large and in the accent colour and the words around it smaller.
 *
 * The title is what the dome was missing. The countdown alone told thirty
 * people watching that something arrives in three hours without ever saying
 * what, or where from — that answer only existed on the operator's screen.
 */
export function calloutTexture(
  title: string,
  prefix: string,
  value: string,
  suffix: string,
  /** Draw it smaller. A satellite's countdown runs to "12시간 1분" and reads as
   * shouting at the size the flight ETA needs; the aircraft plate is the one
   * people read across the room, so only this one shrinks. */
  compact = false
): { tex: THREE.CanvasTexture; aspect: number; screenH: number } {
  const measuring = document.createElement('canvas').getContext('2d') as Ctx
  const valueFont = `700 ${27 * SS}px ${MONO}`
  const wordFont = `600 ${19 * SS}px ${SANS}`
  const titleFont = `700 ${16 * SS}px ${SANS}`
  measuring.font = wordFont
  const preW = prefix ? measuring.measureText(prefix).width / SS : 0
  const sufW = suffix ? measuring.measureText(suffix).width / SS : 0
  measuring.font = valueFont
  const valW = value ? measuring.measureText(value).width / SS : 0
  measuring.font = titleFont
  const titleW = title ? measuring.measureText(title).width / SS : 0
  const gap = 9
  const gaps = (prefix && value ? gap : 0) + (value && suffix ? gap : 0)
  const lineW = preW + valW + sufW + gaps
  const hasLine = lineW > 0
  const W = EDGE_W + CALLOUT_PAD + Math.max(lineW, titleW) + CALLOUT_PAD
  const titleH = title ? TITLE_H : 0
  const lineH = hasLine ? CALLOUT_H : 0
  const H = titleH + lineH

  const c = document.createElement('canvas')
  c.width = Math.ceil(W * SS)
  c.height = Math.ceil(H * SS)
  const g = c.getContext('2d') as Ctx

  const r = 6 * SS
  g.beginPath()
  g.moveTo(r, 0)
  g.arcTo(c.width, 0, c.width, c.height, r)
  g.arcTo(c.width, c.height, 0, c.height, r)
  g.arcTo(0, c.height, 0, 0, r)
  g.arcTo(0, 0, c.width, 0, r)
  g.closePath()
  g.fillStyle = PAPER
  g.fill()
  g.save()
  g.clip()
  g.fillStyle = ACCENT
  g.fillRect(0, 0, EDGE_W * SS, c.height)
  g.restore()

  const left = (EDGE_W + CALLOUT_PAD) * SS
  if (title) {
    g.font = titleFont
    g.fillStyle = INK
    g.fillText(title, left, 20 * SS)
    if (hasLine) {
      // Hairline between the name and the figure, inset from the accent bar.
      g.fillStyle = 'rgba(20,18,15,0.16)'
      g.fillRect(left, titleH * SS - SS, c.width - left - CALLOUT_PAD * SS, SS)
    }
  }
  let x = left
  const baseline = (titleH + 33.5) * SS
  if (prefix) {
    g.font = wordFont
    g.fillStyle = INK
    g.fillText(prefix, x, baseline)
    x += (preW + gap) * SS
  }
  if (value) {
    g.font = valueFont
    g.fillStyle = ACCENT
    g.fillText(value, x, baseline)
    x += (valW + gap) * SS
  }
  if (suffix) {
    g.font = wordFont
    g.fillStyle = INK
    g.fillText(suffix, x, baseline)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, aspect: W / H, screenH: (H / CALLOUT_FRAME_H) * (compact ? 0.72 : 1) }
}

// Icon color by flight category: passenger cyan, cargo amber, military green,
// unidentifiable grey.
const CAT_COLOR: Record<CategoryKey, THREE.Color> = {
  passenger: new THREE.Color('#35c1ff'),
  cargo: new THREE.Color('#f5a623'),
  military: new THREE.Color('#74d16a'),
  other: new THREE.Color('#93a4b8')
}
export function categoryColor(cat: CategoryKey): THREE.Color {
  return CAT_COLOR[cat] ?? CAT_COLOR.passenger
}

/** Colour per orbit class, so the shells read apart at a glance: low orbit
 * cyan, the Starlink shells violet (they're most of the sky), navigation gold,
 * geostationary a warm red that sits still over the equator.
 *
 * Shared constants, like CAT_COLOR — this used to parse a hex string per call,
 * and the call is per satellite per refresh, so a drag over a sixteen-thousand
 * object catalogue spent whole frames building Colors that were then only ever
 * read (frame() copies into a scratch before scaling, and never mutates these). */
const ORBIT_COLOR: Record<string, THREE.Color> = {
  starlink: new THREE.Color('#b48cff'),
  meo: new THREE.Color('#ffd166'),
  geo: new THREE.Color('#ff7b6b'),
  leo: new THREE.Color('#5ce1e6')
}
export function orbitColor(orbit: string): THREE.Color {
  return ORBIT_COLOR[orbit] ?? ORBIT_COLOR.leo
}

/** A plain filled dot — what unselected satellites are drawn as. Sixteen
 * thousand icons overlap into noise, whereas dots read as a swarm, which is
 * what a satellite constellation actually looks like.
 *
 * The disc is solid out to 80% of its radius and only feathers over the last
 * sliver. An earlier version faded from the very centre outwards, which at the
 * ten-or-so screen pixels a dot actually occupies left no solid core at all —
 * every dot came out a grey smudge. */
export function plainDotTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const r = s * 0.46
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.8, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)') // just enough to antialias the rim
  g.fillStyle = grad
  g.beginPath()
  g.arc(s / 2, s / 2, r, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** The selected satellite: a body with two solar panels, drawn white so the
 * per-object colour tints it. Unmistakably not an aeroplane, which is the whole
 * point — only one is ever on screen, so the detail costs nothing. */
export function satelliteTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.translate(s / 2, s / 2)
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#ffffff'
  g.lineCap = 'round'

  // Body.
  g.fillRect(-13, -18, 26, 36)
  // Booms out to each panel.
  g.lineWidth = 5
  g.beginPath()
  g.moveTo(-13, 0)
  g.lineTo(-24, 0)
  g.moveTo(13, 0)
  g.lineTo(24, 0)
  g.stroke()
  // Solar panels, with a gap so the cells read at a glance.
  for (const dir of [-1, 1]) {
    const x = dir === -1 ? -56 : 24
    g.fillRect(x, -20, 32, 17)
    g.fillRect(x, 3, 32, 17)
  }
  // Dish on top.
  g.beginPath()
  g.arc(0, -24, 8, 0, Math.PI * 2)
  g.fill()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
