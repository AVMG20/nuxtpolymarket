// Void Runner — effects. Three batched systems carry almost every visual:
//
//  • Particles  — soft additive points (fire, sparks, glows, halos)
//  • Smoke      — soft alpha-blended points
//  • Lines      — camera-facing glowing quads between two points (bolts,
//                 beams, spark streaks, engine trails, telegraphs)
//
// Each is a single draw call, refilled every frame. Anything else (shock
// rings, shields, flames, debris) is a small pool of meshes.

import * as THREE from 'three'

const _v = new THREE.Vector3()
const _c = new THREE.Color()

// ─── Particles ─────────────────────────────────────────────────────────────

const POINT_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
uniform float uScale;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 512.0);
    vColor = aColor;
    vAlpha = aAlpha;
}`

const POINT_FRAG_ADD = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float core = exp(-r * r * 6.0);
    float halo = max(0.0, 1.0 - r) * 0.35;
    float a = (core + halo * halo) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
}`

const POINT_FRAG_SMOKE = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float a = smoothstep(1.0, 0.1, r) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
}`

export interface ParticleOpts {
    life: number
    size: number
    sizeEnd?: number
    color: THREE.ColorRepresentation
    colorEnd?: THREE.ColorRepresentation
    intensity?: number
    alpha?: number
    drag?: number
}

export class ParticleSystem {
    readonly points: THREE.Points
    private capacity: number
    private count = 0
    private staticCount = 0
    private pos: Float32Array
    private col: Float32Array
    private size: Float32Array
    private alpha: Float32Array
    private vel: Float32Array
    private life: Float32Array
    private maxLife: Float32Array
    private drag: Float32Array
    private size0: Float32Array
    private size1: Float32Array
    private col0: Float32Array
    private col1: Float32Array
    private alpha0: Float32Array
    private glowCap = 3000
    private gPos = new Float32Array(3000 * 3)
    private gCol = new Float32Array(3000 * 3)
    private gSize = new Float32Array(3000)
    private gAlpha = new Float32Array(3000)
    private geometry: THREE.BufferGeometry
    readonly material: THREE.ShaderMaterial

    constructor(capacity: number, additive: boolean) {
        this.capacity = capacity
        this.pos = new Float32Array(capacity * 3)
        this.col = new Float32Array(capacity * 3)
        this.size = new Float32Array(capacity)
        this.alpha = new Float32Array(capacity)
        this.vel = new Float32Array(capacity * 3)
        this.life = new Float32Array(capacity)
        this.maxLife = new Float32Array(capacity)
        this.drag = new Float32Array(capacity)
        this.size0 = new Float32Array(capacity)
        this.size1 = new Float32Array(capacity)
        this.col0 = new Float32Array(capacity * 3)
        this.col1 = new Float32Array(capacity * 3)
        this.alpha0 = new Float32Array(capacity)
        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
        this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
        this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
        this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
        this.material = new THREE.ShaderMaterial({
            uniforms: { uScale: { value: 400 } },
            vertexShader: POINT_VERT,
            fragmentShader: additive ? POINT_FRAG_ADD : POINT_FRAG_SMOKE,
            transparent: true,
            depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            toneMapped: false
        })
        this.points = new THREE.Points(this.geometry, this.material)
        this.points.frustumCulled = false
        this.points.renderOrder = additive ? 20 : 10
    }

    setViewportHeight(h: number, fov: number) {
        this.material.uniforms.uScale!.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
    }

    emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: ParticleOpts) {
        if (this.count >= this.capacity) return
        const i = this.count++
        const i3 = i * 3
        this.pos[i3] = x
        this.pos[i3 + 1] = y
        this.pos[i3 + 2] = z
        this.vel[i3] = vx
        this.vel[i3 + 1] = vy
        this.vel[i3 + 2] = vz
        this.life[i] = o.life
        this.maxLife[i] = o.life
        this.drag[i] = o.drag ?? 1.5
        this.size0[i] = o.size
        this.size1[i] = o.sizeEnd ?? o.size
        this.alpha0[i] = o.alpha ?? 1
        const k = o.intensity ?? 1
        _c.set(o.color).multiplyScalar(k)
        this.col0[i3] = _c.r
        this.col0[i3 + 1] = _c.g
        this.col0[i3 + 2] = _c.b
        _c.set(o.colorEnd ?? o.color).multiplyScalar(k)
        this.col1[i3] = _c.r
        this.col1[i3 + 1] = _c.g
        this.col1[i3 + 2] = _c.b
        this.size[i] = o.size
        this.alpha[i] = this.alpha0[i]! * 0.7
        this.col[i3] = this.col0[i3]!
        this.col[i3 + 1] = this.col0[i3 + 1]!
        this.col[i3 + 2] = this.col0[i3 + 2]!
    }

    update(dt: number) {
        let n = 0
        for (let i = 0; i < this.count; i++) {
            const life = this.life[i]! - dt
            if (life <= 0) continue
            const i3 = i * 3
            const n3 = n * 3
            const d = Math.exp(-this.drag[i]! * dt)
            const vx = this.vel[i3]! * d
            const vy = this.vel[i3 + 1]! * d
            const vz = this.vel[i3 + 2]! * d
            this.pos[n3] = this.pos[i3]! + vx * dt
            this.pos[n3 + 1] = this.pos[i3 + 1]! + vy * dt
            this.pos[n3 + 2] = this.pos[i3 + 2]! + vz * dt
            this.vel[n3] = vx
            this.vel[n3 + 1] = vy
            this.vel[n3 + 2] = vz
            this.life[n] = life
            this.maxLife[n] = this.maxLife[i]!
            this.drag[n] = this.drag[i]!
            this.size0[n] = this.size0[i]!
            this.size1[n] = this.size1[i]!
            this.alpha0[n] = this.alpha0[i]!
            for (let k = 0; k < 3; k++) {
                this.col0[n3 + k] = this.col0[i3 + k]!
                this.col1[n3 + k] = this.col1[i3 + k]!
            }
            const t = 1 - life / this.maxLife[n]!
            this.size[n] = this.size0[n]! + (this.size1[n]! - this.size0[n]!) * t
            // Quick fade in, long fade out.
            this.alpha[n] = this.alpha0[n]! * Math.min(1, 0.6 + t * 10) * (1 - t) * (1 - t * 0.3)
            for (let k = 0; k < 3; k++) this.col[n3 + k] = this.col0[n3 + k]! + (this.col1[n3 + k]! - this.col0[n3 + k]!) * t
            n++
        }
        this.count = n
    }

    /** A particle that lives for exactly one frame — halos and glows on moving things. */
    glow(x: number, y: number, z: number, color: THREE.Color, size: number, alpha = 1) {
        const i = this.staticCount
        if (i >= this.glowCap) return
        this.staticCount++
        const i3 = i * 3
        this.gPos[i3] = x
        this.gPos[i3 + 1] = y
        this.gPos[i3 + 2] = z
        this.gCol[i3] = color.r
        this.gCol[i3 + 1] = color.g
        this.gCol[i3 + 2] = color.b
        this.gSize[i] = size
        this.gAlpha[i] = alpha
    }

    flush() {
        // One-frame glows go after the live particles; the next update only
        // walks the live range, so they vanish on their own.
        const glows = Math.min(this.staticCount, this.capacity - this.count)
        this.pos.set(this.gPos.subarray(0, glows * 3), this.count * 3)
        this.col.set(this.gCol.subarray(0, glows * 3), this.count * 3)
        this.size.set(this.gSize.subarray(0, glows), this.count)
        this.alpha.set(this.gAlpha.subarray(0, glows), this.count)
        const total = this.count + glows
        this.staticCount = 0
        this.geometry.setDrawRange(0, total)
        for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
            const attr = this.geometry.attributes[name] as THREE.BufferAttribute
            attr.clearUpdateRanges()
            attr.addUpdateRange(0, total * attr.itemSize)
            attr.needsUpdate = true
        }
    }

    clear() {
        this.count = 0
        this.staticCount = 0
    }
}

// ─── Lines ─────────────────────────────────────────────────────────────────

const LINE_VERT = /* glsl */`
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aColor;
attribute vec2 aWidth;
varying vec4 vColor;
varying vec2 vUv;
void main() {
    vec4 s = modelViewMatrix * vec4(aStart, 1.0);
    vec4 e = modelViewMatrix * vec4(aEnd, 1.0);
    // Clip the segment a few metres in front of the lens: anything closer
    // projects into a streak across the whole screen.
    float near = -5.0;
    if (s.z > near && e.z > near) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    if (s.z > near) s = mix(e, s, (e.z - near) / (e.z - s.z));
    if (e.z > near) e = mix(s, e, (s.z - near) / (s.z - e.z));
    vec3 dir = e.xyz - s.xyz;
    float len = length(dir);
    dir = len > 0.0001 ? dir / len : vec3(0.0, 0.0, -1.0);
    vec3 p = mix(s.xyz, e.xyz, position.x);
    // World-space width, but never wider than a sliver of the view: a trail
    // brushing past the lens must not paint the whole screen.
    float w = min(mix(aWidth.x, aWidth.y, position.x), max(0.0, -p.z) * 0.012);
    vec3 toCam = normalize(-p);
    vec3 side = cross(dir, toCam);
    float sideLen = length(side);
    // Segments pointing straight at the camera have no side vector; fall back
    // to screen-right instead of normalising zero into NaN (which the bloom
    // then smears across the whole screen).
    side = sideLen > 1e-4 ? side / sideLen : vec3(1.0, 0.0, 0.0);
    // Rounded ends: push the end vertices out along the segment by the width.
    p += dir * (position.x * 2.0 - 1.0) * w;
    p += side * position.y * w;
    gl_Position = projectionMatrix * vec4(p, 1.0);
    vColor = aColor;
    vColor.a *= smoothstep(5.0, 16.0, -p.z);
    vUv = vec2(position.x, position.y);
}`

const LINE_FRAG = /* glsl */`
varying vec4 vColor;
varying vec2 vUv;
void main() {
    float across = 1.0 - abs(vUv.y);
    float core = pow(across, 6.0) * 1.6 + pow(across, 1.6) * 0.5;
    float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
    float a = core * vColor.a * mix(0.6, 1.0, ends);
    if (!(a >= 0.003)) discard;
    gl_FragColor = vec4(vColor.rgb * a, 1.0);
}`

export class LineBatch {
    readonly mesh: THREE.Mesh
    private capacity: number
    private count = 0
    private start: Float32Array
    private end: Float32Array
    private color: Float32Array
    private width: Float32Array
    private geometry: THREE.InstancedBufferGeometry
    private attrs: THREE.InstancedBufferAttribute[]

    constructor(capacity: number) {
        this.capacity = capacity
        const geo = new THREE.InstancedBufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3))
        geo.setIndex([0, 1, 2, 0, 2, 3])
        this.start = new Float32Array(capacity * 3)
        this.end = new Float32Array(capacity * 3)
        this.color = new Float32Array(capacity * 4)
        this.width = new Float32Array(capacity * 2)
        const a = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage)
        this.attrs = [a(this.start, 3), a(this.end, 3), a(this.color, 4), a(this.width, 2)]
        geo.setAttribute('aStart', this.attrs[0]!)
        geo.setAttribute('aEnd', this.attrs[1]!)
        geo.setAttribute('aColor', this.attrs[2]!)
        geo.setAttribute('aWidth', this.attrs[3]!)
        geo.instanceCount = 0
        this.geometry = geo
        const mat = new THREE.ShaderMaterial({
            vertexShader: LINE_VERT,
            fragmentShader: LINE_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false
        })
        this.mesh = new THREE.Mesh(geo, mat)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 30
    }

    /** color is HDR (components may exceed 1). */
    push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: THREE.Color, alpha: number, widthA: number, widthB = widthA) {
        if (this.count >= this.capacity || alpha <= 0.002) return
        const i = this.count++
        this.start[i * 3] = ax
        this.start[i * 3 + 1] = ay
        this.start[i * 3 + 2] = az
        this.end[i * 3] = bx
        this.end[i * 3 + 1] = by
        this.end[i * 3 + 2] = bz
        this.color[i * 4] = color.r
        this.color[i * 4 + 1] = color.g
        this.color[i * 4 + 2] = color.b
        this.color[i * 4 + 3] = alpha
        this.width[i * 2] = widthA
        this.width[i * 2 + 1] = widthB
    }

    pushV(a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color, alpha: number, widthA: number, widthB = widthA) {
        this.push(a.x, a.y, a.z, b.x, b.y, b.z, color, alpha, widthA, widthB)
    }

    flush() {
        this.geometry.instanceCount = this.count
        for (const attr of this.attrs) {
            attr.clearUpdateRanges()
            attr.addUpdateRange(0, this.count * attr.itemSize)
            attr.needsUpdate = true
        }
        this.count = 0
    }
}

// ─── Streak sparks (simulated, drawn through the line batch) ───────────────

export class SparkSystem {
    private n = 0
    private data: Float32Array
    private cap: number
    private tmpColor = new THREE.Color()

    constructor(capacity: number) {
        this.cap = capacity
        // x y z vx vy vz life maxLife r g b width
        this.data = new Float32Array(capacity * 12)
    }

    emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color, width: number) {
        if (this.n >= this.cap) return
        const o = this.n++ * 12
        const d = this.data
        d[o] = x
        d[o + 1] = y
        d[o + 2] = z
        d[o + 3] = vx
        d[o + 4] = vy
        d[o + 5] = vz
        d[o + 6] = life
        d[o + 7] = life
        d[o + 8] = color.r
        d[o + 9] = color.g
        d[o + 10] = color.b
        d[o + 11] = width
    }

    update(dt: number, lines: LineBatch) {
        const d = this.data
        let w = 0
        const drag = Math.exp(-2.2 * dt)
        for (let i = 0; i < this.n; i++) {
            const o = i * 12
            const life = d[o + 6]! - dt
            if (life <= 0) continue
            const t = life / d[o + 7]!
            const vx = d[o + 3]! * drag
            const vy = d[o + 4]! * drag
            const vz = d[o + 5]! * drag
            const x = d[o]! + vx * dt
            const y = d[o + 1]! + vy * dt
            const z = d[o + 2]! + vz * dt
            const tail = 0.045
            this.tmpColor.setRGB(d[o + 8]!, d[o + 9]!, d[o + 10]!)
            lines.push(x, y, z, x - vx * tail, y - vy * tail, z - vz * tail, this.tmpColor, t, d[o + 11]! * (0.4 + t * 0.6), d[o + 11]! * 0.2)
            const q = w * 12
            d[q] = x
            d[q + 1] = y
            d[q + 2] = z
            d[q + 3] = vx
            d[q + 4] = vy
            d[q + 5] = vz
            d[q + 6] = life
            d[q + 7] = d[o + 7]!
            d[q + 8] = d[o + 8]!
            d[q + 9] = d[o + 9]!
            d[q + 10] = d[o + 10]!
            d[q + 11] = d[o + 11]!
            w++
        }
        this.n = w
    }

    clear() {
        this.n = 0
    }
}

// ─── Trails ────────────────────────────────────────────────────────────────

export class Trail {
    private points: THREE.Vector3[] = []
    private head = 0
    private filled = 0
    private timer = 0
    color: THREE.Color

    constructor(private length: number, color: THREE.ColorRepresentation, public width: number, private interval = 0.02) {
        this.color = new THREE.Color(color)
        for (let i = 0; i < length; i++) this.points.push(new THREE.Vector3())
    }

    reset(p: THREE.Vector3) {
        for (const pt of this.points) pt.copy(p)
        this.filled = 0
    }

    update(dt: number, p: THREE.Vector3) {
        this.timer += dt
        if (this.timer >= this.interval || this.filled === 0) {
            this.timer = 0
            this.head = (this.head + 1) % this.length
            this.points[this.head]!.copy(p)
            this.filled = Math.min(this.length, this.filled + 1)
        }
    }

    draw(lines: LineBatch, current: THREE.Vector3, intensity: number) {
        if (this.filled < 2 || intensity <= 0.01) return
        let prev = current
        for (let i = 0; i < this.filled - 1; i++) {
            const idx = (this.head - i + this.length) % this.length
            const p = this.points[idx]!
            const t0 = i / (this.filled - 1)
            const t1 = (i + 1) / (this.filled - 1)
            const a = (1 - t0) * (1 - t0) * intensity
            lines.push(prev.x, prev.y, prev.z, p.x, p.y, p.z, this.color, a, this.width * (1 - t0 * 0.8), this.width * (1 - t1 * 0.8))
            prev = p
        }
    }
}

// ─── Shock rings ───────────────────────────────────────────────────────────

const RING_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uProgress;
uniform float uThickness;
varying vec2 vUv;
void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float edge = uProgress;
    float band = smoothstep(edge - uThickness, edge, r) * (1.0 - smoothstep(edge, edge + 0.02, r));
    float inner = smoothstep(edge - uThickness * 3.0, edge, r) * 0.25 * step(r, edge);
    float a = (band + inner) * (1.0 - uProgress) * (1.0 - uProgress);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
}`

const BASIC_UV_VERT = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

interface Ring {
    mesh: THREE.Mesh
    material: THREE.ShaderMaterial
    life: number
    maxLife: number
    size: number
    billboard: boolean
}

export class RingPool {
    private rings: Ring[] = []
    readonly group = new THREE.Group()
    private geo = new THREE.PlaneGeometry(2, 2)

    constructor(size: number) {
        for (let i = 0; i < size; i++) {
            const material = new THREE.ShaderMaterial({
                uniforms: { uColor: { value: new THREE.Color() }, uProgress: { value: 0 }, uThickness: { value: 0.12 } },
                vertexShader: BASIC_UV_VERT,
                fragmentShader: RING_FRAG,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                toneMapped: false
            })
            const mesh = new THREE.Mesh(this.geo, material)
            mesh.visible = false
            mesh.frustumCulled = false
            mesh.renderOrder = 25
            this.group.add(mesh)
            this.rings.push({ mesh, material, life: 0, maxLife: 1, size: 1, billboard: true })
        }
    }

    spawn(pos: THREE.Vector3, size: number, color: THREE.ColorRepresentation, life = 0.6, intensity = 2, normal?: THREE.Vector3, thickness = 0.12) {
        const ring = this.rings.find(r => r.life <= 0) ?? this.rings[0]!
        ring.life = life
        ring.maxLife = life
        ring.size = size
        ring.billboard = !normal
        ring.mesh.position.copy(pos)
        if (normal) ring.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, 1), normal)
        ring.material.uniforms.uColor!.value.set(color).multiplyScalar(intensity)
        ring.material.uniforms.uThickness!.value = thickness
        ring.mesh.visible = true
    }

    update(dt: number, camera: THREE.Camera) {
        for (const r of this.rings) {
            if (r.life <= 0) continue
            r.life -= dt
            if (r.life <= 0) {
                r.mesh.visible = false
                continue
            }
            const t = 1 - r.life / r.maxLife
            const eased = 1 - Math.pow(1 - t, 3)
            r.material.uniforms.uProgress!.value = 0.05 + eased * 0.93
            r.mesh.scale.setScalar(r.size)
            if (r.billboard) r.mesh.quaternion.copy(camera.quaternion)
        }
    }
}

// ─── Shields ───────────────────────────────────────────────────────────────

const SHIELD_VERT = /* glsl */`
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
void main() {
    vLocal = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
}`

const SHIELD_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uStrength;
uniform float uHit;
uniform vec3 uHitDir;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
void main() {
    float fres = pow(1.0 - abs(dot(vNormal, vView)), 2.5);
    float hex = abs(sin(vLocal.x * 24.0 + uTime) * sin(vLocal.y * 24.0) * sin(vLocal.z * 24.0 - uTime));
    float d = distance(vLocal, uHitDir);
    float ripple = uHit * smoothstep(0.9, 0.0, d) * (0.6 + 0.4 * sin(d * 30.0 - uTime * 20.0));
    float a = fres * uStrength * (0.5 + hex * 0.5) + ripple * 1.8;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
}`

export class ShieldBubble {
    readonly mesh: THREE.Mesh
    private material: THREE.ShaderMaterial
    hit = 0
    strength = 0

    constructor(radius: number, color: THREE.ColorRepresentation) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(color).multiplyScalar(1.6) },
                uStrength: { value: 0 },
                uHit: { value: 0 },
                uHitDir: { value: new THREE.Vector3(0, 0, -1) },
                uTime: { value: 0 }
            },
            vertexShader: SHIELD_VERT,
            fragmentShader: SHIELD_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        })
        this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 3), this.material)
        this.mesh.renderOrder = 24
    }

    /** `localDir` is the hit direction in the bubble's local space. */
    impact(localDir: THREE.Vector3) {
        this.hit = 1
        this.material.uniforms.uHitDir!.value.copy(localDir).normalize()
    }

    update(dt: number, time: number, idle: number) {
        this.hit = Math.max(0, this.hit - dt * 2.5)
        const u = this.material.uniforms
        u.uHit!.value = this.hit
        u.uTime!.value = time
        u.uStrength!.value = idle + this.hit * 0.6 + this.strength
        this.mesh.visible = u.uStrength!.value > 0.01
    }

    setColor(color: THREE.ColorRepresentation, intensity = 1.6) {
        this.material.uniforms.uColor!.value.set(color).multiplyScalar(intensity)
    }
}

// ─── Engine flames ─────────────────────────────────────────────────────────

const FLAME_VERT = /* glsl */`
varying float vT;
varying vec3 vNormal;
varying vec3 vView;
uniform float uTime;
uniform float uSeed;
void main() {
    vT = uv.y;
    vec3 p = position;
    float flicker = 1.0 + sin(uTime * 45.0 + uSeed * 10.0) * 0.06 + sin(uTime * 71.0 + uSeed) * 0.05;
    p.z *= flicker;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
}`

const FLAME_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uPower;
varying float vT;
varying vec3 vNormal;
varying vec3 vView;
void main() {
    // vT: 1 at the nozzle, 0 at the tip.
    float t = clamp(vT, 0.0, 1.0);
    // Faces seen edge-on fade out, so the cone reads as a soft plume, not a spike.
    float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
    vec3 hot = mix(uColor, vec3(1.0), smoothstep(0.7, 1.0, t) * 0.55);
    float a = pow(t, 2.2) * uPower * facing;
    gl_FragColor = vec4(hot * a * 1.25, 1.0);
}`

export function createFlame(radius: number, color: THREE.ColorRepresentation) {
    const geo = new THREE.ConeGeometry(radius * 0.8, radius * 3.6, 12, 1, true)
    // Cone tip at +Z (behind the ship), base at the nozzle.
    geo.rotateX(Math.PI / 2)
    geo.translate(0, 0, radius * 1.7)
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uPower: { value: 1 },
            uTime: { value: 0 },
            uSeed: { value: Math.random() * 10 }
        },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
    })
    const mesh = new THREE.Mesh(geo, material)
    mesh.renderOrder = 22
    return { mesh, material }
}

// ─── Debris ────────────────────────────────────────────────────────────────

interface Chunk {
    life: number
    maxLife: number
    pos: THREE.Vector3
    vel: THREE.Vector3
    rot: THREE.Euler
    spin: THREE.Vector3
    scale: number
    hot: boolean
}

export class DebrisSystem {
    readonly mesh: THREE.InstancedMesh
    private chunks: Chunk[] = []
    private matrix = new THREE.Matrix4()
    private quat = new THREE.Quaternion()
    private scaleV = new THREE.Vector3()
    private emberColor = new THREE.Color(0xff8a3d).multiplyScalar(3)

    constructor(private cap: number) {
        const geo = new THREE.TetrahedronGeometry(1, 0)
        const mat = new THREE.MeshStandardMaterial({ color: 0x8a8580, metalness: 0.2, roughness: 0.8, flatShading: true })
        this.mesh = new THREE.InstancedMesh(geo, mat, cap)
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.mesh.count = 0
        this.mesh.frustumCulled = false
    }

    spawn(pos: THREE.Vector3, baseVel: THREE.Vector3, count: number, size: number, speed: number, rng: () => number) {
        for (let i = 0; i < count; i++) {
            if (this.chunks.length >= this.cap) this.chunks.shift()
            const dir = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
            this.chunks.push({
                life: 2 + rng() * 2.5,
                maxLife: 4.5,
                pos: pos.clone().addScaledVector(dir, size * 0.5),
                vel: baseVel.clone().multiplyScalar(0.6).addScaledVector(dir, speed * (0.3 + rng())),
                rot: new THREE.Euler(rng() * 6, rng() * 6, rng() * 6),
                spin: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(8),
                scale: size * (0.06 + rng() * 0.12),
                hot: rng() < 0.6
            })
        }
    }

    update(dt: number, particles: ParticleSystem) {
        let n = 0
        const drag = Math.exp(-0.4 * dt)
        this.chunks = this.chunks.filter(c => (c.life -= dt) > 0)
        for (const c of this.chunks) {
            c.vel.multiplyScalar(drag)
            c.pos.addScaledVector(c.vel, dt)
            c.rot.x += c.spin.x * dt
            c.rot.y += c.spin.y * dt
            c.rot.z += c.spin.z * dt
            this.quat.setFromEuler(c.rot)
            const s = c.scale * Math.min(1, c.life * 1.5)
            this.scaleV.setScalar(s)
            this.matrix.compose(c.pos, this.quat, this.scaleV)
            this.mesh.setMatrixAt(n++, this.matrix)
            if (c.hot && c.life > c.maxLife - 2.2 && Math.random() < 0.5) {
                particles.emit(c.pos.x, c.pos.y, c.pos.z, 0, 0, 0, { life: 0.5, size: s * 2.2, sizeEnd: 0, color: this.emberColor, colorEnd: 0x551100, drag: 0 })
            }
        }
        this.mesh.count = n
        this.mesh.instanceMatrix.needsUpdate = true
    }

    clear() {
        this.chunks = []
        this.mesh.count = 0
    }
}

// ─── Point light flashes ───────────────────────────────────────────────────

export class FlashLights {
    private lights: { light: THREE.PointLight, life: number, maxLife: number, peak: number }[] = []
    readonly group = new THREE.Group()

    constructor(count: number) {
        for (let i = 0; i < count; i++) {
            const light = new THREE.PointLight(0xffffff, 0, 60, 1.6)
            this.group.add(light)
            this.lights.push({ light, life: 0, maxLife: 1, peak: 0 })
        }
    }

    flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, range: number, life = 0.35) {
        const slot = this.lights.reduce((a, b) => (a.life < b.life ? a : b))
        slot.light.position.copy(pos)
        slot.light.color.set(color)
        slot.light.distance = range
        slot.peak = intensity
        slot.life = life
        slot.maxLife = life
    }

    update(dt: number) {
        for (const l of this.lights) {
            if (l.life <= 0) {
                l.light.intensity = 0
                continue
            }
            l.life -= dt
            const t = Math.max(0, l.life / l.maxLife)
            l.light.intensity = l.peak * t * t
        }
    }
}

// ─── Explosion recipes ─────────────────────────────────────────────────────

export interface FxContext {
    particles: ParticleSystem
    smoke: ParticleSystem
    sparks: SparkSystem
    rings: RingPool
    debris: DebrisSystem
    lights: FlashLights
}

const WHITE_HOT = new THREE.Color(1, 0.95, 0.85)
const tmpCol = new THREE.Color()

export function explosion(fx: FxContext, pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.ColorRepresentation, debris = true) {
    const r = Math.random
    const tint = new THREE.Color(color)
    fx.particles.emit(pos.x, pos.y, pos.z, 0, 0, 0, { life: 0.18, size: size * 9, sizeEnd: size * 14, color: WHITE_HOT, intensity: 3, drag: 0 })
    fx.particles.emit(pos.x, pos.y, pos.z, vel.x * 0.5, vel.y * 0.5, vel.z * 0.5, { life: 0.45, size: size * 6, sizeEnd: size * 10, color: tint, intensity: 2.2, drag: 2 })
    const fire = Math.round(10 + size * 5)
    for (let i = 0; i < fire; i++) {
        _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(size * (4 + r() * 9))
        fx.particles.emit(pos.x, pos.y, pos.z, vel.x * 0.4 + _v.x, vel.y * 0.4 + _v.y, vel.z * 0.4 + _v.z, {
            life: 0.4 + r() * 0.6, size: size * (1.5 + r() * 2), sizeEnd: size * (3 + r() * 3),
            color: r() < 0.5 ? 0xffc26b : 0xff7a2e, colorEnd: 0x5a0d05, intensity: 2.2, drag: 3
        })
    }
    const sparks = Math.round(12 + size * 8)
    tmpCol.set(0xffd89a).multiplyScalar(4)
    for (let i = 0; i < sparks; i++) {
        _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(size * (25 + r() * 45))
        fx.sparks.emit(pos.x, pos.y, pos.z, vel.x * 0.5 + _v.x, vel.y * 0.5 + _v.y, vel.z * 0.5 + _v.z, 0.25 + r() * 0.6, tmpCol, 0.12 + size * 0.05)
    }
    const puffs = Math.round(4 + size * 2)
    for (let i = 0; i < puffs; i++) {
        _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(size * (2 + r() * 4))
        const grey = 0.08 + r() * 0.08
        fx.smoke.emit(pos.x, pos.y, pos.z, vel.x * 0.3 + _v.x, vel.y * 0.3 + _v.y, vel.z * 0.3 + _v.z, {
            life: 1.4 + r() * 1.6, size: size * 3, sizeEnd: size * (8 + r() * 5), color: tmpCol.setRGB(grey, grey * 0.95, grey * 1.05), alpha: 0.55, drag: 1.2
        })
    }
    fx.rings.spawn(pos, size * 7, color, 0.55, 2.2)
    if (size > 1.6) fx.rings.spawn(pos, size * 12, 0xffffff, 0.9, 0.8, undefined, 0.05)
    if (debris) fx.debris.spawn(pos, vel, Math.round(3 + size * 2.5), size, size * 10, r)
    fx.lights.flash(pos, 0xffa050, 18 * size, 30 + size * 30)
}

export function hitSpark(fx: FxContext, pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation, scale = 1) {
    const r = Math.random
    const c = tmpCol.set(color).multiplyScalar(3)
    fx.particles.emit(pos.x, pos.y, pos.z, 0, 0, 0, { life: 0.12, size: 2.2 * scale, sizeEnd: 3.5 * scale, color: c, drag: 0 })
    for (let i = 0; i < 5; i++) {
        _v.set(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.2).add(normal).normalize().multiplyScalar(18 + r() * 30)
        fx.sparks.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, 0.12 + r() * 0.2, c, 0.08 * scale)
    }
}

export function muzzleFlash(fx: FxContext, pos: THREE.Vector3, color: THREE.ColorRepresentation, scale = 1) {
    fx.particles.emit(pos.x, pos.y, pos.z, 0, 0, 0, { life: 0.07, size: 1.6 * scale, sizeEnd: 0.4 * scale, color: tmpCol.set(color).multiplyScalar(3), drag: 0 })
}
