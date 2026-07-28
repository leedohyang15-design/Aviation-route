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
import { projectNorm, wrapLon, splitAtAntimeridian, nearestRouteIndex } from '@shared/projection'
import { EARTH_TEXTURE_URL } from '@shared/config'
import { PLANE_DATA_URI } from '@shared/plane'

const CAPACITY = 16000 // max aircraft instances

/** Screen-space heading (radians) for the icon: on equirectangular a great
 * circle is curved, so the on-screen tangent differs from the geographic
 * bearing — 1/cos(lat) stretches longitude. This keeps icons aligned to motion. */
function screenAngle(headingRad: number, latDeg: number): number {
  const cosLat = Math.max(0.05, Math.cos((latDeg * Math.PI) / 180))
  const dx = Math.sin(headingRad) / cosLat
  const dy = Math.cos(headingRad)
  return Math.atan2(-dx, dy)
}

/** A CanvasTexture of a single emoji (for origin/destination markers). */
function emojiTexture(emoji: string): THREE.CanvasTexture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.font = `${size * 0.8}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, size / 2, size / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function altitudeColor(alt: number | null): THREE.Color {
  // Low = warm, high = cool. Mirrors typical flight-tracker palettes.
  const a = Math.max(0, Math.min(1, (alt ?? 0) / 12000))
  const c = new THREE.Color()
  c.setHSL(0.08 + a * 0.5, 0.9, 0.55)
  return c
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
  /** Base on-screen size of the airplane sprite (world units), scaled by zoom. */
  private planeBaseScale = 1
  private routeGroup = new THREE.Group()
  private routePoints: GeoPoint[] | null = null
  private lastRouteIdx = -1
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
  private viewRect = { left: 0, right: 1, top: 1, bottom: 0 }
  private targetRect = { left: 0, right: 1, top: 1, bottom: 0 }
  private targetSpan = 1

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x000000, 1)
    this.scene.add(this.routeGroup)

    // --- Background ---
    this.bgUniforms = {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uLonOffset: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uShowDayNight: { value: 1 }, // day/night is always on (auto, real-time)
      uShowGrid: { value: 1 },
      uBrightness: { value: 1.5 }, // lift the dark satellite photo
      uSaturation: { value: 1.25 } // boost vividness (was over-desaturated)
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
        uniform vec3 uSunDir; uniform float uShowDayNight; uniform float uShowGrid;
        uniform float uBrightness; uniform float uSaturation;
        void main() {
          float texU = fract(vUv.x - uLonOffset / 360.0);
          vec2 uv = vec2(texU, vUv.y);
          vec3 col = uHasMap > 0.5 ? texture2D(uMap, uv).rgb : vec3(0.05, 0.12, 0.22);
          // Brightness + saturation grade on the earth image.
          float luma = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(luma), col, uSaturation) * uBrightness;
          float lon = uv.x * 360.0 - 180.0;
          float lat = vUv.y * 180.0 - 90.0;
          if (uShowGrid > 0.5) {
            float glon = abs(fract(lon / 30.0 + 0.5) - 0.5);
            float glat = abs(fract(lat / 30.0 + 0.5) - 0.5);
            float line = min(glon, glat);
            float grid = smoothstep(0.015, 0.0, line);
            col = mix(col, vec3(0.4, 0.6, 0.85), grid * 0.3);
          }
          if (uShowDayNight > 0.5) {
            float la = radians(lat); float lo = radians(lon);
            vec3 n = vec3(cos(la) * cos(lo), cos(la) * sin(lo), sin(la));
            float d = dot(n, normalize(uSunDir));
            float night = smoothstep(0.12, -0.12, d);
            col *= mix(1.0, 0.55, night);
          }
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

    // --- Origin / destination markers on the selected route ---
    const marker = (emoji: string): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.03, 0.03),
        new THREE.MeshBasicMaterial({ map: emojiTexture(emoji), transparent: true })
      )
      m.visible = false
      m.position.z = 0.65
      m.frustumCulled = false
      this.scene.add(m)
      return m
    }
    this.originMarker = marker('🚩')
    this.destMarker = marker('📍')

    this.tryLoadEarth()
    this.resize()
  }

  /** Try to swap in a real photographic earth if the asset is present. */
  private tryLoadEarth(): void {
    new THREE.TextureLoader().load(
      EARTH_TEXTURE_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = THREE.RepeatWrapping
        this.bgUniforms.uMap.value = tex
        this.bgUniforms.uHasMap.value = 1
      },
      undefined,
      () => {
        /* no asset — keep procedural ocean + graticule */
      }
    )
  }

  /** Set the equirectangular view (center + zoom); the camera eases toward it. */
  setView(view: ViewState): void {
    const s = Math.max(0.02, Math.min(1, view.span))
    const uc = (view.centerLon + 180) / 360
    const yc = (view.centerLat + 90) / 180 // worldY center (y-up)
    const clamp = (c: number): [number, number] => {
      if (s >= 1) return [0, 1]
      let lo = c - s / 2
      let hi = c + s / 2
      if (lo < 0) {
        hi -= lo
        lo = 0
      }
      if (hi > 1) {
        lo -= hi - 1
        hi = 1
      }
      return [Math.max(0, lo), Math.min(1, hi)]
    }
    const [left, right] = clamp(uc)
    const [bottom, top] = clamp(yc)
    this.targetRect = { left, right, top, bottom }
    this.targetSpan = s
  }

  setOverlays(overlays: Record<OverlayKey, boolean>): void {
    // Day/night is always on and driven by the real-time sun position.
    this.bgUniforms.uShowGrid.value = overlays.grid ? 1 : 0
  }

  setSelected(icao24: string | null): void {
    this.selected = icao24
    this.selectedPlane.visible = false
  }

  /** Update aircraft targets; new ids appear, missing ids fade out (removed). */
  setAircraft(list: Aircraft[]): void {
    const seen = new Set<string>()
    for (const a of list) {
      seen.add(a.icao24)
      const color = altitudeColor(a.altitude)
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

  setRoute(points: GeoPoint[] | null): void {
    this.routePoints = points && points.length >= 2 ? points : null
    this.lastRouteIdx = -1
    this.routeGroup.clear()
    // Place origin/destination markers at the route ends.
    const pts = this.routePoints
    if (pts) {
      const a = projectNorm(pts[0].lon, pts[0].lat, 0)
      const b = projectNorm(pts[pts.length - 1].lon, pts[pts.length - 1].lat, 0)
      this.originMarker.position.set(a.u, 1 - a.v, 0.65)
      this.destMarker.position.set(b.u, 1 - b.v, 0.65)
      this.originMarker.visible = true
      this.destMarker.visible = true
    } else {
      this.originMarker.visible = false
      this.destMarker.visible = false
    }
  }

  /** Add antimeridian-split fat (Line2) segments for a polyline. */
  private addRouteLines(points: GeoPoint[], mat: LineMaterial): void {
    for (const seg of splitAtAntimeridian(points)) {
      if (seg.length < 2) continue
      const positions: number[] = []
      for (const p of seg) {
        const { u, v } = projectNorm(p.lon, p.lat, 0)
        positions.push(u, 1 - v, 0.2)
      }
      const geo = new LineGeometry()
      geo.setPositions(positions)
      const line = new Line2(geo, mat)
      line.frustumCulled = false
      this.routeGroup.add(line)
    }
  }

  /** Rebuild the route split at `idx`: flown (origin→now) red, remaining faint. */
  private buildRoute(idx: number): void {
    this.routeGroup.clear()
    const pts = this.routePoints
    if (!pts) return
    const remaining = pts.slice(idx)
    const flown = pts.slice(0, idx + 1)
    if (remaining.length >= 2) this.addRouteLines(remaining, this.remainMat)
    if (flown.length >= 2) this.addRouteLines(flown, this.flownMat)
  }

  private updateSunDir(): void {
    // Subsolar point from UTC time (low-precision, good enough for a terminator).
    const now = new Date()
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60
    const subLon = -(utcHours - 12) * 15
    const dayOfYear =
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        Date.UTC(now.getUTCFullYear(), 0, 0)) /
      86400000
    const decl = 23.44 * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180)
    const la = (decl * Math.PI) / 180
    const lo = (subLon * Math.PI) / 180
    ;(this.bgUniforms.uSunDir.value as THREE.Vector3).set(
      Math.cos(la) * Math.cos(lo),
      Math.cos(la) * Math.sin(lo),
      Math.sin(la)
    )
  }

  private frame = (now: number): void => {
    // Time step (seconds), capped so a backgrounded tab doesn't teleport planes.
    const dt = this.lastFrame ? Math.min(0.5, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now

    // Keep dot/icon on-screen size roughly constant across zoom levels.
    this.planeBaseScale += (this.targetSpan - this.planeBaseScale) * 0.15

    // Dead reckoning: advance each plane along its heading at its ground speed,
    // then gently correct toward the latest snapshot. This keeps motion smooth
    // even when real updates are 15–60s apart (OpenSky credit budget).
    const correct = 0.08
    let i = 0
    for (const id of this.order) {
      const e = this.eased.get(id)
      if (!e) continue
      if (e.speed > 0 && dt > 0) {
        const cosLat = Math.max(0.05, Math.cos((e.lat * Math.PI) / 180))
        e.lat += ((e.speed * Math.cos(e.heading)) / M_PER_DEG) * dt
        e.lon += ((e.speed * Math.sin(e.heading)) / (M_PER_DEG * cosLat)) * dt
      }
      e.lon = wrapLon(e.lon + wrapLon(e.tLon - e.lon) * correct)
      e.lat += (e.tLat - e.lat) * correct
      e.heading += ((((e.tHeading - e.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI) -
        Math.PI) *
        0.1
      const { u, v } = projectNorm(e.lon, e.lat, 0)
      const angle = screenAngle(e.heading, e.lat) // align icon to on-screen motion
      const isSel = id === this.selected
      this.dummy.position.set(u, 1 - v, 0)
      this.dummy.rotation.z = angle
      this.dummy.scale.set(this.planeBaseScale, this.planeBaseScale, 1)
      this.dummy.updateMatrix()
      this.planes.setMatrixAt(i, this.dummy.matrix)
      // Dim every other plane while one is selected so it stands out.
      this.scratchColor.copy(e.color)
      if (this.selected && !isSel) this.scratchColor.multiplyScalar(0.28)
      this.planes.setColorAt(i, this.scratchColor)
      if (isSel) {
        this.selectedPlane.position.set(u, 1 - v, 0.7)
        this.selectedPlane.rotation.z = angle
        const ps = this.planeBaseScale
        this.selectedPlane.scale.set(ps, ps, 1)
        this.selectedPlane.visible = true
        this.originMarker.scale.set(ps, ps, 1)
        this.destMarker.scale.set(ps, ps, 1)
        // Split the route at the plane's current position: flown red, rest faint.
        if (this.routePoints) {
          const idx = nearestRouteIndex(this.routePoints, { lon: e.lon, lat: e.lat })
          if (idx !== this.lastRouteIdx) {
            this.buildRoute(idx)
            this.lastRouteIdx = idx
          }
        }
      }
      i++
    }
    this.planes.count = i
    this.planes.instanceMatrix.needsUpdate = true
    if (this.planes.instanceColor) this.planes.instanceColor.needsUpdate = true
    if (this.selected && !this.eased.has(this.selected)) this.selectedPlane.visible = false

    // Ease the camera toward the target view (zoom/pan) and keep icon size
    // constant on screen by scaling geometry with the view span.
    const vk = 0.15
    this.viewRect.left += (this.targetRect.left - this.viewRect.left) * vk
    this.viewRect.right += (this.targetRect.right - this.viewRect.right) * vk
    this.viewRect.top += (this.targetRect.top - this.viewRect.top) * vk
    this.viewRect.bottom += (this.targetRect.bottom - this.viewRect.bottom) * vk
    this.camera.left = this.viewRect.left
    this.camera.right = this.viewRect.right
    this.camera.top = this.viewRect.top
    this.camera.bottom = this.viewRect.bottom
    this.camera.updateProjectionMatrix()

    this.updateSunDir()
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
    // Keep an exact 2:1 frame, letterboxed inside whatever the window gives us.
    const w = parent.clientWidth
    const h = parent.clientHeight
    let rw = w
    let rh = w / 2
    if (rh > h) {
      rh = h
      rw = h * 2
    }
    const pr = Math.min(window.devicePixelRatio, 2)
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
    this.renderer.dispose()
  }
}
