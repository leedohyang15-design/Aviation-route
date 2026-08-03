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
 * Navigation lights at the wingtips, for the night side.
 *
 * Drawn white and tinted per instance, so one texture serves every aircraft and
 * the brightness can follow that aircraft's own local night. The positions come
 * from the plane silhouette itself (PLANE_SVG, a 64-unit box): its wings run out
 * to x=5 and x=59 at about y=42. The quad this lands on is drawn larger than the
 * aircraft icon, because a light seen at distance is bigger than the thing
 * carrying it — at world zoom the icon is barely a dozen pixels and lights
 * confined inside it would be invisible.
 */
export function wingLightTexture(): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  // The icon occupies the middle 1/WING_LIGHT_SCALE of this quad, so map the
  // silhouette's 64-unit box into that centred region.
  const inner = S / WING_LIGHT_SCALE
  const off = (S - inner) / 2
  const at = (sx: number, sy: number) => [off + (sx / 64) * inner, off + (sy / 64) * inner]
  for (const [sx, sy] of [
    [5.5, 42],
    [58.5, 42]
  ]) {
    const [x, y] = at(sx, sy)
    const r = S * 0.115
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** How much larger the wing-light quad is than the aircraft icon. */
export const WING_LIGHT_SCALE = 1.7

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
const CALLOUT_PAD = 17
const EDGE_W = 5 // accent bar down the leading edge

type Ctx = CanvasRenderingContext2D

/**
 * One line on a plate: "도착까지 [11시간 37분] 남음", with the figure set large
 * and in the accent colour and the words around it smaller.
 */
export function calloutTexture(
  prefix: string,
  value: string,
  suffix: string
): { tex: THREE.CanvasTexture; aspect: number; screenH: number } {
  const measuring = document.createElement('canvas').getContext('2d') as Ctx
  const valueFont = `700 ${27 * SS}px ${MONO}`
  const wordFont = `600 ${19 * SS}px ${SANS}`
  measuring.font = wordFont
  const preW = prefix ? measuring.measureText(prefix).width / SS : 0
  const sufW = suffix ? measuring.measureText(suffix).width / SS : 0
  measuring.font = valueFont
  const valW = value ? measuring.measureText(value).width / SS : 0
  const gap = 9
  const gaps = (prefix && value ? gap : 0) + (value && suffix ? gap : 0)
  const W = EDGE_W + CALLOUT_PAD + preW + valW + sufW + gaps + CALLOUT_PAD

  const c = document.createElement('canvas')
  c.width = Math.ceil(W * SS)
  c.height = Math.ceil(CALLOUT_H * SS)
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

  const baseline = 33.5 * SS
  let x = (EDGE_W + CALLOUT_PAD) * SS
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
  return { tex, aspect: W / CALLOUT_H, screenH: CALLOUT_H / CALLOUT_FRAME_H }
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
 * geostationary a warm red that sits still over the equator. */
export function orbitColor(orbit: string): THREE.Color {
  switch (orbit) {
    case 'starlink':
      return new THREE.Color('#b48cff')
    case 'meo':
      return new THREE.Color('#ffd166')
    case 'geo':
      return new THREE.Color('#ff7b6b')
    default:
      return new THREE.Color('#5ce1e6')
  }
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
