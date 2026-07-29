// Equirectangular display engine (three.js). Renders a 2:1 frame that the
// sphere-projection software wraps onto the physical globe:
//   - background: earth texture (or procedural ocean) + graticule and a
//     real-time day/night terminator;
//   - aircraft: unselected as altitude-colored dots (an InstancedMesh), the
//     selected one as an airplane sprite rotated by heading; positions eased and
//     dead-reckoned between polls for smooth motion;
//   - the selected aircraft's great-circle route (flown red, remaining faint).
//
// Coordinate convention: an orthographic camera over the [0,1]×[0,1] earth
// (x = (lon+180)/360, worldY = (lat+90)/180). The camera rect is the zoom/pan
// view, eased toward the target set by setView() (driven by the control map).

import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { Aircraft, GeoPoint, OverlayKey, ViewState } from '@shared/types'
import { projectNorm, wrapLon, nearestRouteIndex } from '@shared/projection'
import { EARTH_TEXTURE_URL, EARTH_NIGHT_URL } from '@shared/config'
import { PLANE_DATA_URI } from '@shared/plane'
import { flightCategory, type FlightCategory } from '../common/flightClass'

const CAPACITY = 16000 // max aircraft instances
const MIN_SPAN = 0.4 // most the control map may zoom in (≈2.5×) — a gentle range

/** Screen-space heading (radians) for the icon: on equirectangular a great
 * circle is curved, so the on-screen tangent differs from the geographic
 * bearing — 1/cos(lat) stretches longitude. This keeps icons aligned to motion. */
function screenAngle(headingRad: number, latDeg: number): number {
  const cosLat = Math.max(0.05, Math.cos((latDeg * Math.PI) / 180))
  const dx = Math.sin(headingRad) / cosLat
  const dy = Math.cos(headingRad)
  return Math.atan2(-dx, dy)
}

/** A round dot with a white ring — the origin/departure marker. */
function dotTexture(color: string): THREE.CanvasTexture {
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
function pinTexture(color: string): THREE.CanvasTexture {
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
function textTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
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
function infoTexture(lines: string[]): { tex: THREE.CanvasTexture; aspect: number } {
  const styles = [
    { size: 46, color: '#ffb020', weight: '800' },
    { size: 34, color: '#ffffff', weight: '700' },
    { size: 26, color: '#cfe0f5', weight: '600' }
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
function categoryColor(cat: FlightCategory): THREE.Color {
  return cat === 'military' ? CAT_COLOR.military : cat === 'cargo' ? CAT_COLOR.cargo : CAT_COLOR.passenger
}

interface Eased {
  lon: number // current rendered position
  lat: number
  heading: number // radians
  speed: number // ground speed, m/s (for dead reckoning)
  tLon: number // latest snapshot position (correction target)
  tLat: number
  tHeading: number
  color: THREE.Color
}

const M_PER_DEG = 111_320 // metres per degree of latitude

export class Globe {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10)
  private bg: THREE.Mesh
  private bgUniforms: Record<string, THREE.IUniform>
  private planes: THREE.InstancedMesh
  private selectedPlane: THREE.Mesh
  private originMarker!: THREE.Mesh
  private destMarker!: THREE.Mesh
  private originLabel!: THREE.Mesh
  private destLabel!: THREE.Mesh
  private infoLabel!: THREE.Mesh
  private originFlag!: THREE.Mesh
  private destFlag!: THREE.Mesh
  private flagCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>()
  /** Base on-screen size of the airplane sprite (world units), scaled by zoom. */
  private planeBaseScale = 1
  private routeGroup = new THREE.Group()
  private routePoints: GeoPoint[] | null = null
  private lastRouteIdx = -1
  private lastRouteOffset = NaN
  private flownMat = new LineMaterial({ color: 0xff3b30, linewidth: 5, transparent: true })
  private remainMat = new LineMaterial({
    color: 0xffe08a,
    linewidth: 3,
    transparent: true,
    opacity: 0.4
  })
  private raf = 0
  private lastFrame = 0

  private eased = new Map<string, Eased>()
  private order: string[] = [] // stable instance ordering
  private selected: string | null = null
  private dummy = new THREE.Object3D()
  private scratchColor = new THREE.Color()
  // Camera view rect in normalized [0,1] coords: current (eased) + target.
  // Horizontal pan is done via lonOffset (so it wraps seamlessly); the camera x
  // stays centered on 0.5. The camera y handles vertical pan + zoom.
  private viewRect = { left: 0, right: 1, top: 1, bottom: 0 }
  private targetRect = { left: 0, right: 1, top: 1, bottom: 0 }
  private targetSpan = 1
  private lonOffset = 0 // eased longitude offset (= -centerLon)
  private targetLonOffset = 0
  // The projected display never zooms: it always shows the whole world. The only
  // freedom is the horizontal spin (longitude offset). When a route is selected
  // we lock the spin so origin+destination sit symmetrically around center;
  // otherwise the control map's pan drives it.
  private controlCenterLon = 0
  private routeCenterLon: number | null = null
  private pendingRecenter = false // center on the route once, on selection only
  private hasEarthTexture = false
  private nightHourOverride: number | null = null // null = live time

  // Interactive (control) mode: the operator drives the camera locally with
  // drag/wheel and clicks to select, emitting view/selection back to the hub.
  private interactive = false
  onViewChange: ((v: ViewState) => void) | null = null
  onSelectChange: ((icao24: string | null) => void) | null = null
  private iCenterLon = 127.5
  private iCenterLat = 37.5
  private iSpan = 1
  private lastViewEmit = 0
  private viewEmitTimer: ReturnType<typeof setTimeout> | null = null
  private dragging = false
  private lastPX = 0
  private lastPY = 0
  private movedDuringDrag = false
  private inputCleanup: (() => void) | null = null
  // Attract mode: after 30s with no operator input, auto-select a random flight
  // (and keep cycling every 30s) so the exhibit demos itself when unattended.
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly idleMs = 30000
  // Active pointers (for pinch-zoom) and the pinch anchor.
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchStartDist = 0
  private pinchStartSpan = 1
  // If set, the canvas renders at this exact pixel size (top-left), rest black —
  // for a projector that expects the equirect frame in a fixed region.
  private fixedSize: { w: number; h: number } | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { interactive?: boolean; fixedSize?: { w: number; h: number } } = {}
  ) {
    this.interactive = !!opts.interactive
    this.fixedSize = opts.fixedSize ?? null
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x000000, 1)
    this.scene.add(this.routeGroup)

    // --- Background ---
    this.bgUniforms = {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uNightMap: { value: null },
      uHasNight: { value: 0 },
      uLonOffset: { value: 0 },
      uNight: { value: 0 }, // 0 = full day, 1 = full night (from Korea time)
      uShowGrid: { value: 1 },
      uBrightness: { value: 1.0 }, // neutral — show the image faithfully
      uSaturation: { value: 1.0 } // neutral — keep the source photo's saturation
    }
    const bgMat = new THREE.ShaderMaterial({
      uniforms: this.bgUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uMap; uniform float uHasMap; uniform float uLonOffset;
        uniform sampler2D uNightMap; uniform float uHasNight; uniform float uNight;
        uniform float uShowGrid; uniform float uBrightness; uniform float uSaturation;
        void main() {
          // No fract(): let RepeatWrapping tile the texture. fract() creates a
          // huge UV derivative at the wrap, which picks the wrong mip level and
          // draws a vertical seam when the map wraps around.
          vec2 uv = vec2(vUv.x - uLonOffset / 360.0, vUv.y);
          vec3 day = uHasMap > 0.5 ? texture2D(uMap, uv).rgb : vec3(0.05, 0.12, 0.22);
          // Brightness + saturation grade on the daytime image.
          float luma = dot(day, vec3(0.299, 0.587, 0.114));
          day = mix(vec3(luma), day, uSaturation) * uBrightness;

          if (uShowGrid > 0.5) {
            float lon = uv.x * 360.0 - 180.0;
            float lat = vUv.y * 180.0 - 90.0;
            float glon = abs(fract(lon / 30.0 + 0.5) - 0.5);
            float glat = abs(fract(lat / 30.0 + 0.5) - 0.5);
            float grid = smoothstep(0.015, 0.0, min(glon, glat));
            day = mix(day, vec3(0.4, 0.6, 0.85), grid * 0.3);
          }

          // Whole-screen day↔night by Korea time. Night = darkened earth + city
          // lights (from the night texture) glowing.
          vec3 nightBase = day * 0.10;
          vec3 lights = uHasNight > 0.5 ? texture2D(uNightMap, uv).rgb * 1.6 : vec3(0.0);
          vec3 night = nightBase + lights;
          vec3 col = mix(day, night, uNight);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    })
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat)
    this.bg.position.set(0.5, 0.5, -1)
    this.scene.add(this.bg)

    // --- Aircraft: every plane is a small airplane icon, colored by altitude ---
    const planeTex = new THREE.TextureLoader().load(PLANE_DATA_URI)
    planeTex.colorSpace = THREE.SRGBColorSpace
    const quad = new THREE.PlaneGeometry(0.011, 0.011)
    this.planes = new THREE.InstancedMesh(
      quad,
      new THREE.MeshBasicMaterial({ map: planeTex, transparent: true, alphaTest: 0.35 }),
      CAPACITY
    )
    this.planes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // Base geometry sits at the origin (a corner of the [0,1] view), so its
    // bounding sphere would frustum-cull the whole mesh — disable culling.
    this.planes.frustumCulled = false
    this.planes.count = 0
    this.scene.add(this.planes)

    // --- Selected aircraft: a larger, bright airplane icon ---
    this.selectedPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.032, 0.032),
      new THREE.MeshBasicMaterial({ map: planeTex, transparent: true })
    )
    this.selectedPlane.visible = false
    this.selectedPlane.position.z = 0.7
    this.selectedPlane.frustumCulled = false
    this.scene.add(this.selectedPlane)

    // --- Origin (dot) / destination (pin) markers on the selected route ---
    const mkMarker = (tex: THREE.Texture, w: number, h: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
      )
      m.visible = false
      m.position.z = 0.65
      m.frustumCulled = false
      this.scene.add(m)
      return m
    }
    this.originMarker = mkMarker(dotTexture('#33c1ff'), 0.016, 0.016)
    this.destMarker = mkMarker(pinTexture('#ff3b30'), 0.02, 0.03)

    // Origin / destination place-name labels (created empty; text set on select).
    const label = (): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, depthTest: false })
      )
      m.visible = false
      m.renderOrder = 10
      m.frustumCulled = false
      this.scene.add(m)
      return m
    }
    this.originLabel = label()
    this.destLabel = label()
    this.infoLabel = label() // flight info chip next to the selected plane
    this.originFlag = label() // country flag above the origin marker
    this.destFlag = label() // country flag above the destination marker

    this.tryLoadEarth()
    this.resize()
    if (this.interactive) {
      this.attachInput()
      this.applyInteractiveView()
      this.startAttractTimer()
    }
  }

  /** Apply crisp filtering (mipmaps + anisotropy) to reduce shimmer/blur. */
  private tuneTexture(tex: THREE.Texture): void {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    tex.needsUpdate = true
  }

  /** Try to swap in a real photographic earth if the asset is present. */
  private tryLoadEarth(): void {
    const loader = new THREE.TextureLoader()
    loader.load(
      EARTH_TEXTURE_URL,
      (tex) => {
        this.tuneTexture(tex)
        this.bgUniforms.uMap.value = tex
        this.bgUniforms.uHasMap.value = 1
        // Photographic maps carry their own graticule — drop the procedural grid.
        this.bgUniforms.uShowGrid.value = 0
        this.hasEarthTexture = true
        console.log(`[earth] loaded day texture "${EARTH_TEXTURE_URL}"`)
      },
      undefined,
      () => {
        console.warn(
          `[earth] no/invalid texture at "${EARTH_TEXTURE_URL}" — using procedural ocean+grid. ` +
            `Put a 2:1 image at public/${EARTH_TEXTURE_URL}.`
        )
      }
    )
    // Optional night-lights texture (city lights) for the KST night effect.
    loader.load(
      EARTH_NIGHT_URL,
      (tex) => {
        this.tuneTexture(tex)
        this.bgUniforms.uNightMap.value = tex
        this.bgUniforms.uHasNight.value = 1
        console.log(`[earth] loaded night texture "${EARTH_NIGHT_URL}"`)
      },
      undefined,
      () => {
        /* no night texture — night side just dims globally */
      }
    )
  }

  /** The control map's viewport. On the projected display we only take the
   * horizontal center (the spin) and ignore zoom/vertical entirely — the sphere
   * always shows the whole world so nothing is ever cropped on the dome. In
   * interactive mode the operator's own camera is authoritative, so this is a
   * no-op (feeding the hub's echoed view back in would fight the input). */
  setView(view: ViewState): void {
    if (this.interactive) return
    this.controlCenterLon = view.centerLon
    this.applyViewTarget()
  }

  /** Display mode camera target: always full-world (no zoom). When a route is
   * selected, center the spin on the midpoint longitude between origin and
   * destination so both endpoints sit as close to center as possible; otherwise
   * follow the control map's horizontal pan. */
  private applyViewTarget(): void {
    const center = this.routeCenterLon ?? this.controlCenterLon
    this.targetLonOffset = -center
    this.targetRect = { left: 0, right: 1, top: 1, bottom: 0 }
    this.targetSpan = 1
  }

  /** Interactive mode camera target from the operator's intent (drag/wheel).
   * Horizontal via lonOffset (wraps); vertical + zoom via the camera y-rect,
   * clamped so the rect never leaves the [0,1] background plane. */
  private applyInteractiveView(): void {
    const s = Math.max(MIN_SPAN, Math.min(1, this.iSpan))
    this.targetLonOffset = -this.iCenterLon
    let vCenter = (this.iCenterLat + 90) / 180
    vCenter = Math.max(s / 2, Math.min(1 - s / 2, vCenter))
    this.iCenterLat = vCenter * 180 - 90 // reflect the clamp back so drag stays consistent
    this.targetRect = {
      left: 0.5 - s / 2,
      right: 0.5 + s / 2,
      top: vCenter + s / 2,
      bottom: vCenter - s / 2
    }
    this.targetSpan = s
  }

  /** Reset the interactive view to the home (whole-world, Korea-centered) view
   * and clear the selection. Wired to the "🌏 전체 보기" button. */
  home(): void {
    this.iCenterLon = 127.5
    this.iCenterLat = 37.5
    this.iSpan = 1
    this.applyInteractiveView()
    this.emitView()
    this.onSelectChange?.(null)
  }

  /** (Re)start the 30s attract countdown. Any operator input calls this. */
  private startAttractTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.autoPick(), this.idleMs)
  }

  /** Auto-select a random flight, then keep cycling every 30s until a real
   * interaction resets the countdown. */
  private autoPick(): void {
    const ids = [...this.eased.keys()]
    if (ids.length) this.onSelectChange?.(ids[Math.floor(Math.random() * ids.length)])
    this.idleTimer = setTimeout(() => this.autoPick(), this.idleMs)
  }

  /** Any operator activity (incl. the reset button) resets the attract countdown. */
  pokeActivity(): void {
    if (this.interactive) this.startAttractTimer()
  }

  /** Programmatic zoom for the on-screen +/− buttons (factor <1 zooms in). */
  zoomBy(factor: number): void {
    this.clearTarget() // zooming = exploring → drop the tracked target
    this.iSpan = Math.max(MIN_SPAN, Math.min(1, this.iSpan * factor))
    this.applyInteractiveView()
    this.emitView()
    this.startAttractTimer()
  }

  /** Screen (client) pixel → world coords in the renderer's [0,1] frame, using
   * the current eased camera rect. Uses the canvas's own rect (the letterboxed
   * 2:1 area), not the parent. Returns world x (= u) / world y (= 1 - v). */
  private screenToWorld(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect()
    const W = r.width || 1
    const H = r.height || 1
    const { left: L, right: R, top: T, bottom: B } = this.viewRect
    const worldX = L + ((clientX - r.left) / W) * (R - L)
    const worldY = T - ((clientY - r.top) / H) * (T - B)
    return { worldX, worldY, W, H, L, R, T, B }
  }

  /** Pick the aircraft nearest the click within a pixel threshold (or null). */
  private selectAt(clientX: number, clientY: number): void {
    const { worldX, worldY, W, H, L, R, T, B } = this.screenToWorld(clientX, clientY)
    const spanX = R - L || 1
    const spanY = T - B || 1
    let best: string | null = null
    let bestPx = 14 // pixel threshold (zoom-independent)
    for (const [id, e] of this.eased) {
      const { u, v } = projectNorm(e.lon, e.lat, this.lonOffset)
      const py = 1 - v
      let du = u - worldX
      if (du > 0.5) du -= 1
      else if (du < -0.5) du += 1
      const dxPx = (du / spanX) * W
      const dyPx = ((py - worldY) / spanY) * H
      const px = Math.hypot(dxPx, dyPx)
      if (px < bestPx) {
        bestPx = px
        best = id
      }
    }
    // A click shows the plane and resets the 30s attract countdown (pointerdown
    // already re-armed it), so the clicked plane holds for 30s and then the
    // auto-cycle resumes with a fresh random pick.
    this.onSelectChange?.(best)
  }

  /** Attach drag-pan / wheel-zoom / click-select handlers (interactive mode). */
  private attachInput(): void {
    const canvas = this.canvas
    canvas.style.cursor = 'grab'
    const onDown = (ev: PointerEvent) => {
      this.startAttractTimer() // operator is here — postpone the auto-demo
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      canvas.setPointerCapture?.(ev.pointerId)
      if (this.pointers.size >= 2) {
        // Two fingers → pinch-zoom; record the initial finger distance + span.
        const [a, b] = [...this.pointers.values()]
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        this.pinchStartSpan = this.iSpan
        this.dragging = false
      } else {
        this.dragging = true
        this.movedDuringDrag = false
        this.lastPX = ev.clientX
        this.lastPY = ev.clientY
        canvas.style.cursor = 'grabbing'
      }
    }
    const onMove = (ev: PointerEvent) => {
      const p = this.pointers.get(ev.pointerId)
      if (p) {
        p.x = ev.clientX
        p.y = ev.clientY
      }
      if (this.pointers.size >= 2) {
        // Pinch: span scales with the inverse of the finger-distance change.
        const [a, b] = [...this.pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        this.iSpan = Math.max(MIN_SPAN, Math.min(1, this.pinchStartSpan * (this.pinchStartDist / dist)))
        this.movedDuringDrag = true
        this.clearTarget()
        this.applyInteractiveView()
        this.emitView()
        return
      }
      if (!this.dragging) return
      const r = canvas.getBoundingClientRect()
      const W = r.width || 1
      const H = r.height || 1
      const spanX = this.viewRect.right - this.viewRect.left
      const spanY = this.viewRect.top - this.viewRect.bottom
      const dx = ev.clientX - this.lastPX
      const dy = ev.clientY - this.lastPY
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        this.movedDuringDrag = true
        this.clearTarget() // a manual pan drops the tracked target
      }
      // Horizontal: keep the grabbed point under the cursor → centerLon shifts opposite.
      const du = (dx / W) * spanX
      this.iCenterLon = wrapLon(this.iCenterLon - 360 * du)
      // Vertical: dragging content down reveals the north → center latitude rises.
      const dv = (dy / H) * spanY
      this.iCenterLat += dv * 180
      this.lastPX = ev.clientX
      this.lastPY = ev.clientY
      this.applyInteractiveView()
      this.emitView()
    }
    const onUp = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId)
      canvas.releasePointerCapture?.(ev.pointerId)
      if (this.pointers.size === 1) {
        // One finger remains after a pinch → resume single-finger drag from it.
        const [only] = [...this.pointers.values()]
        this.lastPX = only.x
        this.lastPY = only.y
        this.dragging = true
        this.movedDuringDrag = true // not a tap
        return
      }
      if (this.pointers.size === 0) {
        if (this.dragging && !this.movedDuringDrag) this.selectAt(ev.clientX, ev.clientY)
        this.dragging = false
        canvas.style.cursor = 'grab'
        this.emitView()
      }
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      this.startAttractTimer() // operator is here — postpone the auto-demo
      this.clearTarget() // zooming = exploring → drop the tracked target
      this.iSpan = Math.max(MIN_SPAN, Math.min(1, this.iSpan * Math.exp(ev.deltaY * 0.0015)))
      this.applyInteractiveView()
      this.emitView()
    }
    // Tab / Shift+Tab step through the planes (arrows work too). Manual, so it
    // resets the attract countdown.
    const onKey = (ev: KeyboardEvent) => {
      const fwd = ev.key === 'Tab' || ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
      const back = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || (ev.key === 'Tab' && ev.shiftKey)
      if (!fwd && !back) return
      ev.preventDefault()
      const order = this.order
      if (!order.length) return
      const dir = back ? -1 : 1
      const cur = this.selected ? order.indexOf(this.selected) : -1
      const next = order[(((cur + dir) % order.length) + order.length) % order.length]
      this.startAttractTimer()
      this.onSelectChange?.(next)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    this.inputCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      this.pointers.clear()
    }
  }

  /** Emit the current interactive view to the hub, throttled (~100ms) with a
   * trailing flush so a continuous drag/zoom doesn't flood the broadcast. */
  private emitView(): void {
    const cb = this.onViewChange
    if (!cb) return
    const fire = () =>
      cb({
        centerLon: wrapLon(this.iCenterLon),
        centerLat: this.iCenterLat,
        span: Math.max(0.02, Math.min(1, this.iSpan))
      })
    const now = performance.now()
    const wait = 100 - (now - this.lastViewEmit)
    if (wait <= 0) {
      this.lastViewEmit = now
      if (this.viewEmitTimer) {
        clearTimeout(this.viewEmitTimer)
        this.viewEmitTimer = null
      }
      fire()
    } else if (!this.viewEmitTimer) {
      this.viewEmitTimer = setTimeout(() => {
        this.lastViewEmit = performance.now()
        this.viewEmitTimer = null
        fire()
      }, wait)
    }
  }

  setOverlays(overlays: Record<OverlayKey, boolean>): void {
    // Day/night is always on. Grid only when there's no photographic earth
    // (a photo carries its own graticule — avoid doubling).
    this.bgUniforms.uShowGrid.value = !this.hasEarthTexture && overlays.grid ? 1 : 0
  }

  setSelected(icao24: string | null): void {
    if (icao24 !== this.selected) {
      // Selection changed → drop the previous route/markers/labels/flags right
      // away so nothing from the old plane lingers (or gets drawn through the new
      // plane) while the new detail is fetched.
      this.routePoints = null
      this.lastRouteOffset = NaN
      this.disposeRouteGroup()
      for (const m of [
        this.originMarker,
        this.destMarker,
        this.originLabel,
        this.destLabel,
        this.originFlag,
        this.destFlag
      ]) {
        m.visible = false
      }
    }
    this.selected = icao24
    this.selectedPlane.visible = false
    if (icao24) {
      // Request a one-shot camera align on the plane — done in frame() the moment
      // the selected plane is rendered, so it works with OR without a route and
      // never misses (route timing / off-route drops no longer matter).
      this.pendingRecenter = true
    } else {
      // Deselected → release the spin back to the control's pan.
      this.routeCenterLon = null
      this.pendingRecenter = false
      if (!this.interactive) this.applyViewTarget()
    }
  }

  /** Center the camera once on the selected plane (called from frame() when it is
   * first rendered). Works for routed and route-less planes alike. */
  private recenterOnPlane(lon: number, lat: number): void {
    if (this.interactive) {
      this.iCenterLon = lon
      this.iCenterLat = lat
      // A moderate span (not full zoom-out): at span 1 the vertical center is
      // pinned to the equator, so a plane away from lat 0 could never actually
      // be centered — that was the "centering sometimes fails" bug. Zooming in a
      // little gives room to center the plane vertically as well as horizontally.
      this.iSpan = Math.min(this.iSpan, 0.6)
      this.applyInteractiveView()
      this.emitView()
    } else {
      this.routeCenterLon = lon
      this.applyViewTarget()
    }
    this.pendingRecenter = false
  }

  /** Turn the current target off. Called when the operator pans/zooms — a manual
   * camera move means "I'm exploring, drop the tracked plane". */
  private clearTarget(): void {
    if (this.selected != null) {
      this.selected = null
      this.selectedPlane.visible = false
      this.onSelectChange?.(null)
    }
  }

  /** Update aircraft targets; new ids appear, missing ids fade out (removed). */
  setAircraft(list: Aircraft[]): void {
    const seen = new Set<string>()
    for (const a of list) {
      seen.add(a.icao24)
      const color = categoryColor(flightCategory(a.callsign))
      const h = ((a.heading ?? 0) * Math.PI) / 180
      const speed = a.onGround ? 0 : a.velocity ?? 0
      const cur = this.eased.get(a.icao24)
      if (cur) {
        cur.tLon = a.lon
        cur.tLat = a.lat
        cur.tHeading = h
        cur.speed = speed
        cur.color = color
      } else {
        this.eased.set(a.icao24, {
          lon: a.lon,
          lat: a.lat,
          heading: h,
          speed,
          tLon: a.lon,
          tLat: a.lat,
          tHeading: h,
          color
        })
        this.order.push(a.icao24)
      }
    }
    // Drop aircraft no longer reported.
    for (const id of [...this.eased.keys()]) {
      if (!seen.has(id)) {
        this.eased.delete(id)
      }
    }
    this.order = this.order.filter((id) => this.eased.has(id))
  }

  /** Set origin/destination place-name labels (null clears them). */
  setEndpointLabels(originCity: string | null, destCity: string | null): void {
    const apply = (mesh: THREE.Mesh, text: string | null) => {
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      if (text) {
        const { tex, aspect } = textTexture(text)
        mat.map = tex
        mat.needsUpdate = true
        mesh.userData.aspect = aspect
        mesh.visible = true
      } else {
        mat.map = null
        mesh.visible = false
      }
    }
    apply(this.originLabel, originCity)
    apply(this.destLabel, destCity)
  }

  /** Country flags above the origin/destination markers (ISO2 code, or null). */
  setEndpointFlags(originCode: string | null, destCode: string | null): void {
    const set = (mesh: THREE.Mesh, code: string | null) => {
      if (code) {
        this.loadFlag(code, mesh)
      } else {
        ;(mesh.material as THREE.MeshBasicMaterial).map = null
        mesh.visible = false
      }
    }
    set(this.originFlag, originCode)
    set(this.destFlag, destCode)
  }

  /** Load a flag SVG (public/flags/<code>.svg) into a canvas texture (cached). */
  private loadFlag(code: string, mesh: THREE.Mesh): void {
    const apply = (tex: THREE.CanvasTexture, aspect: number) => {
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.map = tex
      mat.needsUpdate = true
      mesh.userData.aspect = aspect
    }
    const cached = this.flagCache.get(code)
    if (cached) {
      apply(cached.tex, cached.aspect)
      return
    }
    const img = new Image()
    img.onload = () => {
      const w = 128
      const h = 96
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 5
      ctx.strokeRect(2.5, 2.5, w - 5, h - 5)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const entry = { tex, aspect: w / h }
      this.flagCache.set(code, entry)
      apply(tex, entry.aspect)
    }
    img.onerror = () => {
      /* no flag for this country — leave the mesh hidden */
    }
    img.src = `flags/${code}.svg`
  }

  /** Compact info chip shown next to the selected plane (null clears it). */
  setInfoLabel(lines: string[] | null): void {
    const mat = this.infoLabel.material as THREE.MeshBasicMaterial
    mat.map?.dispose()
    if (lines && lines.length) {
      const { tex, aspect } = infoTexture(lines)
      mat.map = tex
      mat.needsUpdate = true
      this.infoLabel.userData.aspect = aspect
    } else {
      mat.map = null
      this.infoLabel.visible = false
    }
  }

  /** Free the route lines' GPU geometries before clearing (they are rebuilt on
   * pan/progress; without disposal the buffers leak over a long session). */
  private disposeRouteGroup(): void {
    for (const child of this.routeGroup.children) {
      const line = child as Line2
      line.geometry?.dispose()
    }
    this.routeGroup.clear()
  }

  setRoute(points: GeoPoint[] | null): void {
    const next = points && points.length >= 2 ? points : null
    // The hub re-sends the route every snapshot to keep ETA/progress fresh. Skip
    // the rebuild + re-center when the endpoints are unchanged — only a new
    // selection or a re-route actually changes the line. Rebuilding every few
    // seconds would flicker the line and jitter the camera.
    const cur = this.routePoints
    const same =
      !!next &&
      !!cur &&
      next[0].lon === cur[0].lon &&
      next[0].lat === cur[0].lat &&
      next[next.length - 1].lon === cur[cur.length - 1].lon &&
      next[next.length - 1].lat === cur[cur.length - 1].lat
    if (same) return

    this.routePoints = next
    this.lastRouteIdx = -1
    this.lastRouteOffset = NaN // force a rebuild next frame
    this.disposeRouteGroup()
    const on = !!this.routePoints
    this.originMarker.visible = on
    this.destMarker.visible = on
    // Camera alignment on selection is handled in frame() (recenterOnPlane), so it
    // works with or without a route and can't miss due to route timing.
  }

  /** Add fat (Line2) segments for a polyline, split at the actual display seam.
   * The seam (where projected u wraps 0↔1) depends on the pan offset, NOT on
   * geographic ±180, so we project first and cut where u jumps — otherwise the
   * line breaks mid-screen whenever the map is panned off the prime meridian. */
  private addRouteLines(points: GeoPoint[], mat: LineMaterial): void {
    let positions: number[] = []
    let prevU = NaN
    const flush = () => {
      if (positions.length >= 6) {
        const geo = new LineGeometry()
        geo.setPositions(positions)
        const line = new Line2(geo, mat)
        line.frustumCulled = false
        this.routeGroup.add(line)
      }
      positions = []
    }
    for (const p of points) {
      const { u, v } = projectNorm(p.lon, p.lat, this.lonOffset)
      if (!Number.isNaN(prevU) && Math.abs(u - prevU) > 0.5) flush() // wrapped the seam
      positions.push(u, 1 - v, 0.2)
      prevU = u
    }
    flush()
  }

  /** Rebuild the route split at `idx`: flown (origin→now) red, remaining faint. */
  private buildRoute(idx: number): void {
    this.disposeRouteGroup()
    const pts = this.routePoints
    if (!pts) return
    const remaining = pts.slice(idx)
    const flown = pts.slice(0, idx + 1)
    if (remaining.length >= 2) this.addRouteLines(remaining, this.remainMat)
    if (flown.length >= 2) this.addRouteLines(flown, this.flownMat)
  }

  /** Override the day/night clock (KST hour 0–24), or null for live time. */
  setNightHour(hour: number | null): void {
    this.nightHourOverride = hour
  }

  private updateNight(): void {
    if (this.nightHourOverride != null) {
      // Manual override (hour 0–24): 1 at midnight, 0 at noon.
      this.bgUniforms.uNight.value = 0.5 + 0.5 * Math.cos((this.nightHourOverride / 24) * 2 * Math.PI)
      return
    }
    // Exhibit auto-cycle: a full day↔night sweep every ~6 minutes (≈3 min day,
    // ≈3 min night). Both windows read the same wall clock, so they stay in sync
    // without any hub traffic. phase 0 = day, 0.5 = night.
    const PERIOD_MS = 6 * 60 * 1000
    const phase = (Date.now() % PERIOD_MS) / PERIOD_MS
    this.bgUniforms.uNight.value = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
  }

  private frame = (now: number): void => {
    // Time step (seconds), capped so a backgrounded tab doesn't teleport planes.
    const dt = this.lastFrame ? Math.min(0.5, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now

    // Keep dot/icon on-screen size roughly constant across zoom levels.
    this.planeBaseScale += (this.targetSpan - this.planeBaseScale) * 0.28

    // Ease the horizontal offset (wrap-aware) — this pans the world seamlessly.
    this.lonOffset += wrapLon(this.targetLonOffset - this.lonOffset) * 0.28
    this.bgUniforms.uLonOffset.value = this.lonOffset

    // Dead reckoning: advance each plane along its heading at its ground speed,
    // then gently correct toward the latest snapshot. This keeps motion smooth
    // even when real updates are up to 90s apart (OpenSky credit budget).
    const correct = 0.1
    // Only dim others when the selected plane is actually on screen (else a
    // filtered-out/dropped selection would darken the whole map).
    const selVisible = this.selected != null && this.eased.has(this.selected)
    let i = 0
    for (const id of this.order) {
      if (i >= CAPACITY) break // never write past the instance buffer
      const e = this.eased.get(id)
      if (!e) continue
      if (e.speed > 0 && dt > 0) {
        const cosLat = Math.max(0.05, Math.cos((e.lat * Math.PI) / 180))
        const dLat = ((e.speed * Math.cos(e.heading)) / M_PER_DEG) * dt
        const dLon = ((e.speed * Math.sin(e.heading)) / (M_PER_DEG * cosLat)) * dt
        e.lat += dLat
        e.lon += dLon
        // Advance the correction target too, so it tracks the plane's real
        // motion instead of dragging it back toward a snapshot that may be up to
        // 90s old. Without this the dead reckoning and the pull-back cancel out,
        // the plane barely moves between polls, then jumps a whole interval's
        // worth when the next snapshot lands. The snapshot resets the target to
        // truth; `correct` only smooths the small residual — no jump.
        e.tLat += dLat
        e.tLon += dLon
      }
      e.lon = wrapLon(e.lon + wrapLon(e.tLon - e.lon) * correct)
      e.lat += (e.tLat - e.lat) * correct
      e.heading += ((((e.tHeading - e.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI) -
        Math.PI) *
        0.1
      const { u, v } = projectNorm(e.lon, e.lat, this.lonOffset)
      const angle = screenAngle(e.heading, e.lat) // align icon to on-screen motion
      const isSel = id === this.selected
      this.dummy.position.set(u, 1 - v, 0)
      this.dummy.rotation.z = angle
      this.dummy.scale.set(this.planeBaseScale, this.planeBaseScale, 1)
      this.dummy.updateMatrix()
      this.planes.setMatrixAt(i, this.dummy.matrix)
      // Dim every other plane while one is selected so it stands out.
      this.scratchColor.copy(e.color)
      if (selVisible && !isSel) this.scratchColor.multiplyScalar(0.28)
      this.planes.setColorAt(i, this.scratchColor)
      if (isSel) {
        // First frame the selected plane is rendered → center the camera on it.
        if (this.pendingRecenter) this.recenterOnPlane(e.lon, e.lat)
        this.selectedPlane.position.set(u, 1 - v, 0.7)
        this.selectedPlane.rotation.z = angle
        const ps = this.planeBaseScale
        this.selectedPlane.scale.set(ps, ps, 1)
        this.selectedPlane.visible = true
        // Info chip next to the plane (flips to the left near the right edge).
        const infoMat = this.infoLabel.material as THREE.MeshBasicMaterial
        if (infoMat.map) {
          const lh = 0.06 * ps
          const asp = (this.infoLabel.userData.aspect as number) || 3
          const lw = lh * asp
          const right = u + 0.018 + lw < 1
          const cx = right ? u + 0.018 + lw / 2 : u - 0.018 - lw / 2
          this.infoLabel.scale.set(lw, lh, 1)
          this.infoLabel.position.set(cx, 1 - v, 0.75)
          this.infoLabel.visible = true
        }
        // Reposition origin/destination markers (they move with the pan offset).
        if (this.routePoints) {
          const o = this.routePoints[0]
          const de = this.routePoints[this.routePoints.length - 1]
          const op = projectNorm(o.lon, o.lat, this.lonOffset)
          const dp = projectNorm(de.lon, de.lat, this.lonOffset)
          this.originMarker.position.set(op.u, 1 - op.v, 0.65)
          // Lift the pin so its bottom tip (not center) sits on the coordinate.
          this.destMarker.position.set(dp.u, 1 - dp.v + 0.015 * ps, 0.65)
          this.originMarker.scale.set(ps, ps, 1)
          this.destMarker.scale.set(ps, ps, 1)
          this.originMarker.visible = true
          this.destMarker.visible = true
          // Lay out each endpoint's name + flag as a stack that extends OUTWARD
          // along the route, away from the OTHER endpoint. Because the two stacks
          // point in opposite directions, they can never overlap each other — for
          // any geometry, including short, near-vertical, or coincident endpoints
          // (that was the recurring "flag detached / labels piled up" bug). The
          // marker stays on its true coordinate; the name sits just outside it,
          // the flag just beyond the name.
          const oy = 1 - op.v
          const dy0 = 1 - dp.v
          let dirX = op.u - dp.u
          if (dirX > 0.5) dirX -= 1
          else if (dirX < -0.5) dirX += 1
          let dirY = oy - dy0
          let dlen = Math.hypot(dirX, dirY)
          if (dlen < 1e-4) {
            dirX = 0
            dirY = 1
            dlen = 1
          }
          dirX /= dlen
          dirY /= dlen
          const gName = 0.034 * ps // name distance out from its marker
          const gFlag = 0.066 * ps // flag distance out from its marker (beyond name)
          const lblH = 0.018 * ps
          const placeLabel = (lbl: THREE.Mesh, mu: number, my: number, sign: number) => {
            const asp = (lbl.userData.aspect as number) || 4
            lbl.scale.set(lblH * asp, lblH, 1)
            lbl.position.set(mu + sign * dirX * gName, my + sign * dirY * gName, 0.68)
          }
          placeLabel(this.originLabel, op.u, oy, 1)
          placeLabel(this.destLabel, dp.u, dy0, -1)
          const placeFlag = (flag: THREE.Mesh, mu: number, my: number, sign: number) => {
            if (!(flag.material as THREE.MeshBasicMaterial).map) {
              flag.visible = false
              return
            }
            const fh = 0.02 * ps
            const asp = (flag.userData.aspect as number) || 1.33
            flag.scale.set(fh * asp, fh, 1)
            flag.position.set(mu + sign * dirX * gFlag, my + sign * dirY * gFlag, 0.66)
            flag.visible = true
          }
          placeFlag(this.originFlag, op.u, oy, 1)
          placeFlag(this.destFlag, dp.u, dy0, -1)
          // Split the route at the plane's nearest point; rebuild when that split
          // or the pan offset changed so the line stays aligned to the earth.
          const idx = nearestRouteIndex(this.routePoints, { lon: e.lon, lat: e.lat })
          // Snap the selected plane ONTO its route: draw the icon at the nearest
          // route point (the flown/remaining split) pointing along the line,
          // instead of at its raw position. Real aircraft deviate from the drawn
          // great circle (airways, wind), which would otherwise float the plane
          // off its own line — this pulls it back on, exactly as requested.
          const snap = this.routePoints[idx]
          const sp = projectNorm(snap.lon, snap.lat, this.lonOffset)
          const a2 = this.routePoints[Math.min(idx + 1, this.routePoints.length - 1)]
          const a1 = this.routePoints[Math.max(idx - 1, 0)]
          const φ1 = (a1.lat * Math.PI) / 180
          const φ2 = (a2.lat * Math.PI) / 180
          const Δλ = ((a2.lon - a1.lon) * Math.PI) / 180
          const bearing = Math.atan2(
            Math.sin(Δλ) * Math.cos(φ2),
            Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
          )
          this.selectedPlane.position.set(sp.u, 1 - sp.v, 0.7)
          this.selectedPlane.rotation.z = screenAngle(bearing, snap.lat)
          if (idx !== this.lastRouteIdx || this.lonOffset !== this.lastRouteOffset) {
            this.buildRoute(idx)
            this.lastRouteIdx = idx
            this.lastRouteOffset = this.lonOffset
          }
        }
      }
      i++
    }
    this.planes.count = i
    this.planes.instanceMatrix.needsUpdate = true
    if (this.planes.instanceColor) this.planes.instanceColor.needsUpdate = true
    // If the selected plane vanished (filtered out / dropped), hide its overlays.
    if (!this.selected || !this.eased.has(this.selected)) {
      this.selectedPlane.visible = false
      this.originMarker.visible = false
      this.destMarker.visible = false
      this.originLabel.visible = false
      this.destLabel.visible = false
      this.infoLabel.visible = false
      this.originFlag.visible = false
      this.destFlag.visible = false
    }

    // Ease the camera toward the target view (zoom/pan) and keep icon size
    // constant on screen by scaling geometry with the view span.
    const vk = 0.28
    this.viewRect.left += (this.targetRect.left - this.viewRect.left) * vk
    this.viewRect.right += (this.targetRect.right - this.viewRect.right) * vk
    this.viewRect.top += (this.targetRect.top - this.viewRect.top) * vk
    this.viewRect.bottom += (this.targetRect.bottom - this.viewRect.bottom) * vk
    this.camera.left = this.viewRect.left
    this.camera.right = this.viewRect.right
    this.camera.top = this.viewRect.top
    this.camera.bottom = this.viewRect.bottom
    this.camera.updateProjectionMatrix()

    this.updateNight()
    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(this.frame)
  }

  start(): void {
    this.lastFrame = 0
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    let rw: number
    let rh: number
    if (this.fixedSize) {
      // Exact projector frame (top-left); the rest of the window stays black.
      rw = this.fixedSize.w
      rh = this.fixedSize.h
    } else {
      // Keep an exact 2:1 frame, letterboxed inside whatever the window gives us.
      const w = parent.clientWidth
      const h = parent.clientHeight
      rw = w
      rh = w / 2
      if (rh > h) {
        rh = h
        rw = h * 2
      }
    }
    const pr = Math.min(window.devicePixelRatio, 3) // higher cap → sharper output
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(rw, rh, true)
    this.canvas.style.width = `${rw}px`
    this.canvas.style.height = `${rh}px`
    // Fat lines need the drawing-buffer resolution in pixels.
    this.flownMat.resolution.set(rw * pr, rh * pr)
    this.remainMat.resolution.set(rw * pr, rh * pr)
  }

  dispose(): void {
    this.stop()
    this.inputCleanup?.()
    this.inputCleanup = null
    if (this.viewEmitTimer) {
      clearTimeout(this.viewEmitTimer)
      this.viewEmitTimer = null
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.renderer.dispose()
  }
}
