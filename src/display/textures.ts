// Pure canvas-texture + geometry helpers for the Globe renderer. These are
// stateless (no scene/class dependencies), so they live apart from the main
// engine file to keep globe.ts focused on rendering state.
import * as THREE from 'three'
import type { FlightCategory } from '../common/flightClass'

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

/** A compact multi-line info chip (dark rounded background) shown next to the
 * selected aircraft: line0 = flight no (amber), line1 = route, line2 = metrics. */
export function infoTexture(lines: string[]): { tex: THREE.CanvasTexture; aspect: number } {
  const styles = [
    { size: 46, color: '#ffb020', weight: '800' }, // 0: flight no (amber)
    { size: 32, color: '#ffffff', weight: '700' }, // 1: route (city → city)
    { size: 34, color: '#8fe3a0', weight: '800' }, // 2: arrival countdown (bright green)
    { size: 24, color: '#cfe0f5', weight: '600' } // 3: metrics (small)
  ]
  const st = (i: number) => styles[Math.min(i, styles.length - 1)]
  const padX = 22
  const padY = 16
  const gap = 8
  const c = document.createElement('canvas')
  let ctx = c.getContext('2d')!
  let w = 0
  let h = padY * 2
  lines.forEach((t, i) => {
    const s = st(i)
    ctx.font = `${s.weight} ${s.size}px sans-serif`
    w = Math.max(w, ctx.measureText(t).width)
    h += s.size + (i > 0 ? gap : 0)
  })
  c.width = Math.ceil(w + padX * 2)
  c.height = Math.ceil(h + 8) // extra room so descenders on the last line aren't clipped
  ctx = c.getContext('2d')!
  const r = 18
  const W = c.width
  const H = c.height
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(W, 0, W, H, r)
  ctx.arcTo(W, H, 0, H, r)
  ctx.arcTo(0, H, 0, 0, r)
  ctx.arcTo(0, 0, W, 0, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(8,12,24,0.74)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  let y = padY
  lines.forEach((t, i) => {
    const s = st(i)
    ctx.font = `${s.weight} ${s.size}px sans-serif`
    ctx.fillStyle = s.color
    ctx.fillText(t, padX, y)
    y += s.size + gap
  })
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, aspect: W / H }
}

// Icon color by flight category: passenger cyan, cargo amber, military green.
const CAT_COLOR = {
  passenger: new THREE.Color('#35c1ff'),
  cargo: new THREE.Color('#f5a623'),
  military: new THREE.Color('#74d16a')
} as const
export function categoryColor(cat: FlightCategory): THREE.Color {
  return cat === 'military' ? CAT_COLOR.military : cat === 'cargo' ? CAT_COLOR.cargo : CAT_COLOR.passenger
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
