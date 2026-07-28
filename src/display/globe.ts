// Equirectangular display engine (three.js). Renders a 2:1 frame that the
// sphere-projection software wraps onto the physical globe:
//   - background: earth texture (or procedural ocean) + optional graticule and
//     day/night terminator, shifted horizontally by the longitude spin;
//   - aircraft: an InstancedMesh of heading-oriented triangles, colored by
//     altitude, positioned with the shared equirectangular projection and eased
//     between polls for smooth motion;
//   - the selected aircraft's great-circle route, split at the antimeridian.
//
// Coordinate convention: an orthographic camera with x∈[0,1] (left→right =
// −180→+180 after spin) and y∈[0,1] (bottom→top = −90→+90). worldY = 1 − v.

import * as THREE from 'three'
import type { Aircraft, GeoPoint, OverlayKey } from '@shared/types'
import { projectNorm, wrapLon, splitAtAntimeridian, nearestRouteIndex } from '@shared/projection'
import { EARTH_TEXTURE_URL } from '@shared/config'
import { PLANE_DATA_URI } from '@shared/plane'

const CAPACITY = 16000 // max aircraft instances

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
  /** Base on-screen size of the airplane sprite (world units), scaled by zoom. */
  private planeBaseScale = 1
  private routeGroup = new THREE.Group()
  private routePoints: GeoPoint[] | null = null
  private lastRouteIdx = -1
  private raf = 0
  private lastFrame = 0

  private eased = new Map<string, Eased>()
  private order: string[] = [] // stable instance ordering
  private lonOffset = 0
  private selected: string | null = null
  private dummy = new THREE.Object3D()

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
      uBrightness: { value: 1.4 }, // lift the dark satellite photo
      uSaturation: { value: 0.85 } // tame the high saturation
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
            col *= mix(1.0, 0.4, night);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `
    })
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat)
    this.bg.position.set(0.5, 0.5, -1)
    this.scene.add(this.bg)

    // --- Aircraft dots (unselected): small circles colored by altitude ---
    const dot = new THREE.CircleGeometry(0.004, 12)
    this.planes = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial(), CAPACITY)
    this.planes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // The base geometry sits at the origin (a corner of our [0,1] view), so its
    // bounding sphere makes three.js frustum-cull the whole mesh even though the
    // instances are spread across the frame. Disable culling for it.
    this.planes.frustumCulled = false
    this.planes.count = 0
    this.scene.add(this.planes)

    // --- Selected aircraft: an airplane icon sprite, rotated by heading ---
    const planeTex = new THREE.TextureLoader().load(PLANE_DATA_URI)
    planeTex.colorSpace = THREE.SRGBColorSpace
    this.selectedPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.03, 0.03),
      new THREE.MeshBasicMaterial({ map: planeTex, transparent: true })
    )
    this.selectedPlane.visible = false
    this.selectedPlane.position.z = 0.6
    this.selectedPlane.frustumCulled = false
    this.scene.add(this.selectedPlane)

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

  setLonOffset(deg: number): void {
    this.lonOffset = deg
    this.bgUniforms.uLonOffset.value = deg
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
  }

  /** Add antimeridian-split line segments for a polyline in one colour. */
  private addRouteLines(points: GeoPoint[], mat: THREE.LineBasicMaterial): void {
    for (const seg of splitAtAntimeridian(points)) {
      if (seg.length < 2) continue
      const geo = new THREE.BufferGeometry()
      const pos = new Float32Array(seg.length * 3)
      seg.forEach((p, i) => {
        const { u, v } = projectNorm(p.lon, p.lat, this.lonOffset)
        pos[i * 3] = u
        pos[i * 3 + 1] = 1 - v
        pos[i * 3 + 2] = 0.2
      })
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.routeGroup.add(new THREE.Line(geo, mat))
    }
  }

  /** Rebuild the route split at `idx`: flown (origin→now) red, remaining faint. */
  private buildRoute(idx: number): void {
    this.routeGroup.clear()
    const pts = this.routePoints
    if (!pts) return
    const flown = pts.slice(0, idx + 1)
    const remaining = pts.slice(idx)
    if (remaining.length >= 2) {
      this.addRouteLines(
        remaining,
        new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.28 })
      )
    }
    if (flown.length >= 2) {
      this.addRouteLines(
        flown,
        new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.95 })
      )
    }
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
      const { u, v } = projectNorm(e.lon, e.lat, this.lonOffset)
      // Unselected → a dot (no heading rotation). Selected → the airplane sprite.
      this.dummy.position.set(u, 1 - v, 0)
      this.dummy.rotation.z = 0
      this.dummy.scale.set(this.planeBaseScale, this.planeBaseScale, 1)
      this.dummy.updateMatrix()
      this.planes.setMatrixAt(i, this.dummy.matrix)
      this.planes.setColorAt(i, e.color)
      if (id === this.selected) {
        this.selectedPlane.position.set(u, 1 - v, 0.6)
        this.selectedPlane.rotation.z = -e.heading
        const ps = this.planeBaseScale
        this.selectedPlane.scale.set(ps, ps, 1)
        this.selectedPlane.visible = true
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(rw, rh, true)
    this.canvas.style.width = `${rw}px`
    this.canvas.style.height = `${rh}px`
  }

  dispose(): void {
    this.stop()
    this.renderer.dispose()
  }
}
