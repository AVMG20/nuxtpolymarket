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
const WHITE_HOT = new THREE.Color(1, 0.95, 0.85)

// ─── Particles ─────────────────────────────────────────────────────────────

const POINT_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
uniform float uScale;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSize * uScale / max(0.1, -mv.z);
    // A sprite under a couple of pixels cannot show its falloff: the GPU
    // fills whole pixels at full core brightness, so far glows turn into
    // hard white dots. Draw it at a minimum size and dim it by the area
    // it gained, which keeps its light and its colour.
    float drawn = clamp(size, 2.0, 512.0);
    gl_PointSize = drawn;
    vColor = aColor;
    vAlpha = aAlpha * min(1.0, (size * size) / (drawn * drawn));
    vShape = aShape;
}`

// Sprites are procedural. aShape packs kind * 100 + floor(age * 62) + seed:
// kind 0 is a clean glow, 1 a fire puff that cools down a blackbody ramp,
// 2 a turbulent puff that keeps its own colour.
const POINT_NOISE = /* glsl */`
float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Returns (density, noise) of a billowing puff that frays as it ages.
vec2 puff(vec2 d, float r, float age, float seed) {
    float ang = seed * 6.2831 + age * 2.0 * (seed - 0.5);
    float c = cos(ang);
    float s = sin(ang);
    vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    float n = vn(q * 4.5 + seed * 40.0) * 0.62 + vn(q * 10.0 - seed * 23.0 + age * 1.5) * 0.38;
    float density = (1.0 - r) + (n - 0.5) * (0.7 + age * 1.1);
    return vec2(smoothstep(0.0, 0.5, density) * smoothstep(1.0, 0.78, r), n);
}`

const POINT_FRAG_ADD = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
${POINT_NOISE}
vec3 blackbody(float t) {
    vec3 c = mix(vec3(0.06, 0.012, 0.006), vec3(0.5, 0.07, 0.015), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3(1.0, 0.36, 0.07), smoothstep(0.18, 0.48, t));
    c = mix(c, vec3(1.0, 0.78, 0.32), smoothstep(0.45, 0.75, t));
    return mix(c, vec3(1.25, 1.15, 0.95), smoothstep(0.72, 1.0, t));
}
void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    vec3 col = vColor;
    float a;
    if (vShape < 0.5) {
        float core = exp(-r * r * 7.0);
        float halo = max(0.0, 1.0 - r);
        a = (core + halo * halo * halo * 0.22) * vAlpha;
    } else {
        float kind = floor(vShape * 0.01);
        float pk = vShape - kind * 100.0;
        float age = floor(pk) / 62.0;
        vec2 p = puff(d, r, age, fract(pk));
        a = p.x * vAlpha;
        if (kind < 1.5) {
            float heat = (1.0 - age) * (0.35 + 0.65 * p.x * (0.55 + 0.45 * p.y)) + exp(-r * r * 5.0) * (1.0 - age) * 0.3;
            col *= blackbody(clamp(heat, 0.0, 1.0));
        } else {
            col *= 0.55 + 0.75 * p.y;
        }
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * a, 1.0);
}`

const POINT_FRAG_SMOKE = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
${POINT_NOISE}
void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float pk = vShape - floor(vShape * 0.01) * 100.0;
    vec2 p = puff(d, r, floor(pk) / 62.0, fract(pk));
    float a = p.x * vAlpha;
    if (a < 0.003) discard;
    // A little shape: lit from the upper left, darker in the folds.
    float light = clamp(0.85 - (d.x * 0.7 + d.y * 1.1), 0.45, 1.4) * (0.65 + 0.6 * p.y);
    gl_FragColor = vec4(vColor * light, a);
}`

const PARTICLE_ATTRS = ['position', 'aColor', 'aSize', 'aAlpha', 'aShape'] as const

export interface ParticleOpts {
    life: number
    size: number
    sizeEnd?: number
    color: THREE.ColorRepresentation
    colorEnd?: THREE.ColorRepresentation
    intensity?: number
    alpha?: number
    drag?: number
    /** Sprite look. `fire` cools down a blackbody ramp (colour acts as a tint), `puff` keeps its colour. Smoke is always a puff. */
    shape?: 'glow' | 'fire' | 'puff'
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
    private shape: Float32Array
    private shape0: Float32Array
    private additive: boolean
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
        this.shape = new Float32Array(capacity)
        this.shape0 = new Float32Array(capacity)
        this.additive = additive
        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
        this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
        this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
        this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
        this.geometry.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage))
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
        const kind = !this.additive || o.shape === 'puff' ? 2 : o.shape === 'fire' ? 1 : 0
        this.shape0[i] = kind ? kind * 100 + 0.01 + Math.random() * 0.98 : 0
        this.shape[i] = this.shape0[i]!
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
            this.shape0[n] = this.shape0[i]!
            for (let k = 0; k < 3; k++) {
                this.col0[n3 + k] = this.col0[i3 + k]!
                this.col1[n3 + k] = this.col1[i3 + k]!
            }
            const t = 1 - life / this.maxLife[n]!
            this.shape[n] = this.shape0[n]! > 0 ? this.shape0[n]! + Math.floor(t * 62) : 0
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
        this.shape.fill(0, this.count, this.count + glows)
        const total = this.count + glows
        this.staticCount = 0
        this.geometry.setDrawRange(0, total)
        for (const name of PARTICLE_ATTRS) {
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
uniform float uPxScale;
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
    // Under a pixel wide the line only catches some pixels and breaks into
    // dots. Keep it about a pixel and a half wide and dim it by the width it
    // gained, so its brightness stays the same.
    float minW = 0.75 * max(0.0, -p.z) / uPxScale;
    float drawn = max(w, minW);
    float thin = drawn > 0.0 ? w / drawn : 0.0;
    w = drawn;
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
    vColor.a *= smoothstep(5.0, 16.0, -p.z) * thin;
    vUv = vec2(position.x, position.y);
}`

const LINE_FRAG = /* glsl */`
varying vec4 vColor;
varying vec2 vUv;
void main() {
    // With MSAA the GPU can shade a thin line at a pixel centre outside the
    // quad, extrapolating vUv past the edge. Unclamped, pow() then gets a
    // negative base: Metal returns NaN (dropped), but D3D takes its absolute
    // value, so those pixels blew up to white and bloomed on Windows.
    float across = clamp(1.0 - abs(vUv.y), 0.0, 1.0);
    float core = pow(across, 6.0) * 1.6 + pow(across, 1.6) * 0.5;
    float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
    float a = core * vColor.a * mix(0.6, 1.0, ends);
    if (!(a >= 0.003)) discard;
#ifdef SOFT
    // Blended over the scene instead of added to it: a pixel never ends up
    // brighter than the line colour, so dust over a bright nebula stays
    // under the bloom threshold.
    a = min(a, 1.0);
    gl_FragColor = vec4(vColor.rgb * a, a);
#else
    gl_FragColor = vec4(vColor.rgb * a, 1.0);
#endif
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

    /** `soft` lines blend over the scene instead of adding light, so they never bloom. */
    constructor(capacity: number, soft = false) {
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
            uniforms: { uPxScale: { value: 1000 } },
            vertexShader: LINE_VERT,
            fragmentShader: LINE_FRAG,
            defines: soft ? { SOFT: '' } : {},
            transparent: true,
            depthWrite: false,
            ...(soft
                ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }
                : { blending: THREE.AdditiveBlending }),
            side: THREE.DoubleSide,
            toneMapped: false
        })
        this.mesh = new THREE.Mesh(geo, mat)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 30
    }

    /** Render-target height in pixels, so thin lines keep a minimum on-screen width. */
    setViewportHeight(h: number, fov: number) {
        (this.mesh.material as THREE.ShaderMaterial).uniforms.uPxScale!.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
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
            const tail = 0.05
            const r = d[o + 8]!
            const b = d[o + 10]!
            // Hot metal cools from white-yellow to a dull red; energy sparks keep their hue.
            const cool = r >= b ? t : 1
            this.tmpColor.setRGB(r, d[o + 9]! * (0.3 + 0.7 * cool), b * (0.08 + 0.92 * cool * cool))
            lines.push(x, y, z, x - vx * tail, y - vy * tail, z - vz * tail, this.tmpColor, Math.min(1, t * 1.6), d[o + 11]! * (0.35 + t * 0.65), d[o + 11]! * 0.08)
            const q = w * 12
            d[q] = x
            d[q + 1] = y
            d[q + 2] = z
            d[q + 3] = vx
            d[q + 4] = vy
            d[q + 5] = vz
            d[q + 6] = life
            d[q + 7] = d[o + 7]!
            d[q + 8] = r
            d[q + 9] = d[o + 9]!
            d[q + 10] = b
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
    private hot = new THREE.Color()
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
        const last = this.filled - 1
        // A soft coloured ribbon that thins out, with a short white-hot filament at the head.
        this.hot.copy(this.color).lerp(WHITE_HOT, 0.6).multiplyScalar(1.6)
        const hotSegments = Math.min(3, last)
        for (let i = 0; i < last; i++) {
            const idx = (this.head - i + this.length) % this.length
            const p = this.points[idx]!
            const t0 = i / last
            const t1 = (i + 1) / last
            const a = Math.pow(1 - t0, 2.4) * intensity
            lines.push(prev.x, prev.y, prev.z, p.x, p.y, p.z, this.color, a, this.width * (1 - t0 * 0.85), this.width * (1 - t1 * 0.85))
            if (i < hotSegments) {
                const h = 1 - i / hotSegments
                lines.push(prev.x, prev.y, prev.z, p.x, p.y, p.z, this.hot, a * h * 0.8, this.width * 0.38 * h, this.width * 0.38 * Math.max(0, h - 1 / hotSegments))
            }
            prev = p
        }
    }
}

// ─── Shock rings ───────────────────────────────────────────────────────────

const RING_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uProgress;
uniform float uThickness;
uniform float uSeed;
varying vec2 vUv;
void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);
    // A pressure front is never a perfect circle: wobble the edge, the
    // thickness and the brightness a little around the ring.
    float wob = sin(ang * 5.0 + uSeed) * 0.5 + sin(ang * 13.0 - uSeed * 2.3) * 0.3 + sin(ang * 31.0 + uSeed * 5.1) * 0.2;
    float edge = uProgress * (1.0 + wob * 0.014);
    float th = uThickness * (1.0 + wob * 0.4);
    float band = smoothstep(edge - th, edge, r) * (1.0 - smoothstep(edge, edge + 0.014, r));
    band *= band;
    float hotX = (r - edge + 0.004) / (th * 0.16 + 0.003);
    float hot = exp(-hotX * hotX);
    float wake = smoothstep(edge - th * 4.5, edge, r) * 0.16 * step(r, edge);
    float fade = (1.0 - uProgress) * (1.0 - uProgress);
    float breakup = 0.72 + 0.28 * sin(ang * 23.0 + uSeed * 3.0 + uProgress * 4.0) * sin(ang * 7.0 - uSeed);
    vec3 col = uColor * (band * breakup + wake) + mix(uColor, vec3(max(uColor.r, max(uColor.g, uColor.b))), 0.65) * hot * 0.7;
    col *= fade;
    if (max(col.r, max(col.g, col.b)) < 0.003) discard;
    gl_FragColor = vec4(col, 1.0);
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
        // Hidden rings cost nothing, and a fleet fight wants more than a couple of dozen at once.
        const count = Math.max(size, 48)
        for (let i = 0; i < count; i++) {
            const material = new THREE.ShaderMaterial({
                uniforms: { uColor: { value: new THREE.Color() }, uProgress: { value: 0 }, uThickness: { value: 0.12 }, uSeed: { value: 0 } },
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
        // A free ring, or failing that the one closest to fading out.
        let ring = this.rings[0]!
        for (const r of this.rings) {
            if (r.life <= 0) {
                ring = r
                break
            }
            if (r.life / r.maxLife < ring.life / ring.maxLife) ring = r
        }
        ring.life = life
        ring.maxLife = life
        ring.size = size
        ring.billboard = !normal
        ring.mesh.position.copy(pos)
        if (normal) ring.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, 1), normal)
        ring.material.uniforms.uColor!.value.set(color).multiplyScalar(intensity)
        ring.material.uniforms.uThickness!.value = thickness
        ring.material.uniforms.uSeed!.value = Math.random() * 40
        ring.material.uniforms.uProgress!.value = 0.05
        ring.mesh.scale.setScalar(size)
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
            // Blast waves leave fast and coast: most of the travel is over in the first third.
            const eased = 1 - Math.pow(1 - t, 3.4)
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

// The field is invisible until something touches it. An impact lights a
// small patch of hex cells around the hit point and sends one ripple through
// them; the rest of the bubble stays dark. Only abilities and elite auras
// (uStrength) draw the whole shell.
const SHIELD_FRAG = /* glsl */`
#define HITS 4
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uPatch;
uniform float uCells;
uniform vec4 uHits[HITS];
uniform float uHitPow[HITS];
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;

// xy: position inside the cell, zw: cell id.
vec4 hexCell(vec2 uv) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec4 c = floor(vec4(uv, uv - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(uv - c.xy * s, uv - (c.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, c.xy) : vec4(h.zw, c.zw + 0.5);
}
// x: cell wall, y: random per cell.
vec2 hexWalls(vec2 uv) {
    vec4 h = hexCell(uv);
    vec2 p = abs(h.xy);
    float e = max(dot(p, vec2(0.5, 0.8660254)), p.x);
    return vec2(smoothstep(0.405, 0.49, e), fract(sin(dot(h.zw, vec2(12.9898, 78.233))) * 43758.5453));
}
void main() {
    vec3 n = normalize(vLocal);
    float a = 0.0;
    float white = 0.0;
    if (uStrength > 0.002) {
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.5);
        vec3 an = abs(n);
        vec2 uv = an.x > an.y && an.x > an.z ? n.yz / an.x : an.y > an.z ? n.xz / an.y : n.xy / an.z;
        vec2 w = hexWalls(uv * uCells * 0.8);
        float sweep = pow(0.5 + 0.5 * sin(n.y * 5.0 + n.x * 2.0 - uTime * 2.2), 4.0);
        float cell = step(0.8, fract(w.y + uTime * 0.35)) * (1.0 - w.x) * 0.1;
        a += uStrength * (fres * (0.5 + w.x * 1.1) + w.x * (0.05 + sweep * 0.22) + cell) * (gl_FrontFacing ? 1.0 : 0.35);
    }
    for (int i = 0; i < HITS; i++) {
        float age = uHits[i].w;
        if (age >= 1.0) continue;
        vec3 hd = uHits[i].xyz;
        float R = uPatch * uHitPow[i];
        float d = distance(n, hd);
        if (d > R * 1.3) continue;
        vec3 t1 = normalize(cross(hd, abs(hd.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 t2 = cross(hd, t1);
        vec2 w = hexWalls(vec2(dot(n, t1), dot(n, t2)) * uCells);
        float fade = (1.0 - age) * (1.0 - age);
        float front = R * (0.12 + 0.88 * (1.0 - pow(1.0 - age, 3.0)));
        float behind = smoothstep(front, front * 0.55, d);
        float rim = smoothstep(R * 1.25, R * 0.45, d);
        float flicker = step(0.45, fract(w.y + uTime * 4.0)) * (1.0 - w.x);
        float ringX = (d - front) / (R * 0.09);
        float ring = exp(-ringX * ringX);
        float core = exp(-d * d / (R * R * 0.025)) * pow(1.0 - age, 5.0);
        a += (behind * (w.x * 1.5 + 0.1 + flicker * 0.22) + ring * (0.35 + w.x * 1.6)) * fade * rim + core * 2.2;
        white += core * 1.5 + ring * w.x * fade * rim * 0.5;
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a + vec3(white), 1.0);
}`

const SHIELD_HITS = 4
const SHIELD_HIT_LIFE = 0.5

export class ShieldBubble {
    readonly mesh: THREE.Mesh
    private material: THREE.ShaderMaterial
    private hits: THREE.Vector4[] = []
    private hitPow: number[] = []
    private next = 0
    /** Freshness of the latest impact, 1 → 0. */
    hit = 0
    strength = 0

    constructor(radius: number, color: THREE.ColorRepresentation) {
        for (let i = 0; i < SHIELD_HITS; i++) {
            this.hits.push(new THREE.Vector4(0, 0, 1, 1))
            this.hitPow.push(1)
        }
        const cell = THREE.MathUtils.clamp(radius * 0.13, 0.42, 2.6)
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(color).multiplyScalar(1.6) },
                uStrength: { value: 0 },
                uTime: { value: 0 },
                // Chord radius of an impact patch on the unit sphere: a few metres, whatever the hull size.
                uPatch: { value: THREE.MathUtils.clamp(4.2 / radius, 0.2, 0.8) },
                uCells: { value: radius / cell },
                uHits: { value: this.hits },
                uHitPow: { value: this.hitPow }
            },
            vertexShader: SHIELD_VERT,
            fragmentShader: SHIELD_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false
        })
        this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 4), this.material)
        this.mesh.renderOrder = 24
        this.mesh.visible = false
    }

    /** `localDir` is the hit direction in the bubble's local space. `power` scales the patch. */
    impact(localDir: THREE.Vector3, power = 1) {
        this.hit = 1
        _v.copy(localDir).normalize()
        // Rapid fire on one spot refreshes that patch instead of burning through the slots.
        let slot = -1
        for (let i = 0; i < SHIELD_HITS; i++) {
            const h = this.hits[i]!
            if (h.w < 0.6 && h.x * _v.x + h.y * _v.y + h.z * _v.z > 0.97) slot = i
        }
        if (slot < 0) {
            slot = this.next
            this.next = (this.next + 1) % SHIELD_HITS
        }
        this.hits[slot]!.set(_v.x, _v.y, _v.z, 0)
        this.hitPow[slot] = THREE.MathUtils.clamp(power, 0.5, 2)
    }

    update(dt: number, time: number, idle: number) {
        this.hit = Math.max(0, this.hit - dt / SHIELD_HIT_LIFE)
        let active = false
        for (const h of this.hits) {
            if (h.w >= 1) continue
            h.w = Math.min(1, h.w + dt / SHIELD_HIT_LIFE)
            active = true
        }
        const u = this.material.uniforms
        u.uTime!.value = time
        u.uStrength!.value = idle + this.strength
        this.mesh.visible = active || u.uStrength!.value > 0.01
    }

    setColor(color: THREE.ColorRepresentation, intensity = 1.6) {
        this.material.uniforms.uColor!.value.set(color).multiplyScalar(intensity)
    }
}

// ─── Engine flames ─────────────────────────────────────────────────────────

const FLAME_VERT = /* glsl */`
attribute float aLayer;
varying float vT;
varying float vAngle;
varying float vLayer;
varying vec3 vNormal;
varying vec3 vView;
uniform float uTime;
uniform float uSeed;
uniform float uPower;
void main() {
    vT = uv.y;
    vAngle = uv.x;
    vLayer = aLayer;
    vec3 p = position;
    if (aLayer < 2.5) {
        // The plume breathes along its length and whips a little towards the tip.
        float flicker = 1.0 + sin(uTime * 47.0 + uSeed * 10.0) * 0.05 + sin(uTime * 73.0 + uSeed) * 0.04 + sin(uTime * 19.0 + uSeed * 3.0) * 0.03;
        p.z *= flicker;
        float whip = uv.y * uv.y;
        p.x += sin(uTime * 31.0 + uSeed * 7.0 + uv.y * 5.0) * whip * 0.05 * length(position.xy + 0.001);
        p.y += cos(uTime * 27.0 + uSeed * 4.0 + uv.y * 6.0) * whip * 0.05 * length(position.xy + 0.001);
        // A hard burn overexpands the exhaust just past the nozzle.
        p.xy *= 1.0 + (uPower - 0.8) * 0.18 * sin(min(1.0, uv.y * 4.0) * 3.14159);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
}`

// Layers: 0 white-hot core with shock diamonds, 1 coloured plume, 2 faint
// warm haze around and beyond it, 3 the glowing throat disc in the nozzle.
const FLAME_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uPower;
uniform float uTime;
uniform float uSeed;
varying float vT;
varying float vAngle;
varying float vLayer;
varying vec3 vNormal;
varying vec3 vView;
float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
    float t = clamp(vT, 0.0, 1.0);
    // Shells seen edge-on fade out, so stacked cones read as a soft volume
    // that is brightest through its middle.
    float nv = abs(dot(normalize(vNormal), normalize(vView)));
    float power = max(0.0, uPower);
    vec3 col;
    float a;
    if (vLayer > 2.5) {
        float r = t;
        a = (exp(-r * r * 5.0) * 1.5 + (1.0 - r) * 0.35) * (0.35 + power * 0.9) * smoothstep(1.0, 0.85, r);
        col = mix(uColor, vec3(1.0, 0.97, 0.92), exp(-r * r * 3.0) * 0.85);
    } else if (vLayer < 0.5) {
        // Standing shock diamonds: fixed in the flow, sharper and brighter the harder the burn.
        float wave = 0.5 + 0.5 * cos(t * 6.2831 * 4.5 + 0.6);
        float diamonds = mix(1.0, 0.35 + 1.5 * pow(wave, 2.5), smoothstep(0.35, 1.0, power) * (1.0 - t * 0.6));
        float streak = 0.85 + 0.3 * vn(vec2(vAngle * 12.0, t * 3.0 - uTime * 9.0 + uSeed));
        a = pow(1.0 - t, 1.3) * (0.3 + 0.7 * pow(nv, 1.3)) * diamonds * streak * power * 1.9;
        col = mix(uColor, vec3(1.0, 0.96, 0.9), 0.8 - t * 0.5);
    } else if (vLayer < 1.5) {
        float n = vn(vec2(vAngle * 8.0, t * 4.0 - uTime * 7.0 + uSeed)) * 0.6 + vn(vec2(vAngle * 16.0 + 3.0, t * 9.0 - uTime * 13.0 - uSeed)) * 0.4;
        float body = pow(1.0 - t, 1.8) * smoothstep(0.0, 0.03, t);
        // The tip tears into ragged tongues.
        body *= smoothstep(0.0, 0.5, n + (1.0 - t) * 1.6 - 0.55);
        a = body * (0.25 + 0.75 * pow(nv, 1.6)) * (0.65 + 0.7 * n) * power * 1.25;
        col = mix(uColor * 1.15, uColor * uColor * 1.3 + uColor * 0.2, smoothstep(0.1, 0.8, t));
        col = mix(col, vec3(1.0), smoothstep(0.25, 0.0, t) * 0.45);
    } else {
        float n = vn(vec2(vAngle * 5.0, t * 3.0 - uTime * 4.0 - uSeed * 2.0));
        a = pow(1.0 - t, 1.4) * smoothstep(0.0, 0.08, t) * pow(nv, 2.0) * (0.4 + 0.9 * n) * power * 0.16;
        col = mix(uColor, vec3(1.0, 0.42, 0.14), 0.55);
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * a, 1.0);
}`

/** One lathed shell of the plume, from the nozzle at z = 0 back to its tip at +Z. */
function pushPlumeShell(out: { pos: number[], nor: number[], uv: number[], layer: number[], idx: number[] }, layer: number, radius: number, length: number, bulge: number, radial: number, axial: number) {
    const base = out.pos.length / 3
    const profile = (t: number) => radius * Math.pow(1 - t, 0.75) * (1 + bulge * Math.sin(Math.min(1, t * 3.5) * Math.PI)) + radius * 0.015
    for (let j = 0; j <= axial; j++) {
        // Rings bunch up near the nozzle, where the shape changes fastest.
        const t = Math.pow(j / axial, 1.35)
        const r = profile(t)
        const slope = (profile(Math.min(1, t + 0.01)) - profile(Math.max(0, t - 0.01))) / (0.02 * length)
        for (let i = 0; i <= radial; i++) {
            const a = (i / radial) * Math.PI * 2
            const c = Math.cos(a)
            const s = Math.sin(a)
            out.pos.push(c * r, s * r, t * length)
            const inv = 1 / Math.hypot(1, slope)
            out.nor.push(c * inv, s * inv, -slope * inv)
            out.uv.push(i / radial, t)
            out.layer.push(layer)
        }
    }
    const row = radial + 1
    for (let j = 0; j < axial; j++) {
        for (let i = 0; i < radial; i++) {
            const a = base + j * row + i
            out.idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
        }
    }
}

export function createFlame(radius: number, color: THREE.ColorRepresentation) {
    const out = { pos: [] as number[], nor: [] as number[], uv: [] as number[], layer: [] as number[], idx: [] as number[] }
    pushPlumeShell(out, 2, radius * 1.35, radius * 5.6, 0.1, 10, 5)
    pushPlumeShell(out, 1, radius * 0.92, radius * 4.4, 0.22, 14, 9)
    pushPlumeShell(out, 0, radius * 0.5, radius * 3, 0.12, 10, 12)
    // Throat disc, just inside the nozzle and facing aft.
    const centre = out.pos.length / 3
    out.pos.push(0, 0, radius * 0.04)
    out.nor.push(0, 0, 1)
    out.uv.push(0, 0)
    out.layer.push(3)
    for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2
        out.pos.push(Math.cos(a) * radius * 1.05, Math.sin(a) * radius * 1.05, radius * 0.04)
        out.nor.push(0, 0, 1)
        out.uv.push(i / 16, 1)
        out.layer.push(3)
        if (i > 0) out.idx.push(centre, centre + i, centre + i + 1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2))
    geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(out.layer, 1))
    geo.setIndex(out.idx)
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

/** A torn hull fragment: a lumpy, faceted shard that non-uniform scaling turns into plates and spars. */
function shardGeometry() {
    const geo = new THREE.IcosahedronGeometry(1, 0)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        const y = pos.getY(i)
        const z = pos.getZ(i)
        // Hash on the position, so the copies of a shared corner move together.
        const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
        const k = 0.55 + (h - Math.floor(h)) * 0.75
        pos.setXYZ(i, x * k, y * k, z * k)
    }
    geo.computeVertexNormals()
    return geo
}

// pos3 vel3 rot3 spin3 scale3 life maxLife heat
const CHUNK = 18
// pos3 vel3 delay size
const POP = 8
const MAX_POPS = 48

export class DebrisSystem {
    readonly mesh: THREE.InstancedMesh
    private data: Float32Array
    private count = 0
    private cursor = 0
    private heat: THREE.InstancedBufferAttribute
    private pops = new Float32Array(MAX_POPS * POP)
    private popCount = 0
    private popFx: FxContext | null = null
    private matrix = new THREE.Matrix4()
    private quat = new THREE.Quaternion()
    private euler = new THREE.Euler()
    private posV = new THREE.Vector3()
    private scaleV = new THREE.Vector3()
    private emberColor = new THREE.Color(0xff8a3d).multiplyScalar(3)
    private glowColor = new THREE.Color()

    constructor(private cap: number) {
        this.data = new Float32Array(cap * CHUNK)
        const geo = shardGeometry()
        this.heat = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute
        geo.setAttribute('aHeat', this.heat)
        const mat = new THREE.MeshStandardMaterial({ color: 0x6f6b68, metalness: 0.55, roughness: 0.6, flatShading: true })
        // Freshly torn metal glows from within until it cools.
        mat.onBeforeCompile = (shader) => {
            shader.vertexShader = 'attribute float aHeat;\nvarying float vHeat;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n    vHeat = aHeat;')
            shader.fragmentShader = 'varying float vHeat;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n    totalEmissiveRadiance += mix(vec3(1.6, 0.16, 0.02), vec3(3.4, 1.5, 0.4), vHeat) * vHeat * vHeat;')
        }
        this.mesh = new THREE.InstancedMesh(geo, mat, cap)
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.mesh.count = 0
        this.mesh.frustumCulled = false
    }

    /** `hot` is the share of chunks that glow and trail embers. */
    spawn(pos: THREE.Vector3, baseVel: THREE.Vector3, count: number, size: number, speed: number, rng: () => number, hot = 0.6) {
        const d = this.data
        for (let i = 0; i < count; i++) {
            // Full: recycle the oldest slots in turn.
            let slot = this.count
            if (slot >= this.cap) {
                slot = this.cursor
                this.cursor = (this.cursor + 1) % this.cap
            } else {
                this.count++
            }
            const o = slot * CHUNK
            _v.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
            const v = speed * (0.3 + rng())
            d[o] = pos.x + _v.x * size * 0.5
            d[o + 1] = pos.y + _v.y * size * 0.5
            d[o + 2] = pos.z + _v.z * size * 0.5
            d[o + 3] = baseVel.x * 0.6 + _v.x * v
            d[o + 4] = baseVel.y * 0.6 + _v.y * v
            d[o + 5] = baseVel.z * 0.6 + _v.z * v
            d[o + 6] = rng() * 6
            d[o + 7] = rng() * 6
            d[o + 8] = rng() * 6
            const spin = 3 + rng() * 7
            d[o + 9] = (rng() - 0.5) * spin
            d[o + 10] = (rng() - 0.5) * spin
            d[o + 11] = (rng() - 0.5) * spin
            // Plates, spars and the odd solid lump.
            const s = size * (0.07 + rng() * 0.13)
            const form = rng()
            d[o + 12] = s * (form < 0.45 ? 1.5 : form < 0.8 ? 0.35 : 1)
            d[o + 13] = s * (form < 0.45 ? 0.22 : form < 0.8 ? 0.35 : 0.8)
            d[o + 14] = s * (form < 0.45 ? 1.1 : form < 0.8 ? 2.2 : 0.9)
            d[o + 15] = 2.4 + rng() * 2.6
            d[o + 16] = d[o + 15]!
            d[o + 17] = rng() < hot ? 1 : 0
        }
    }

    /** Queues a small secondary blast, as ammunition and fuel cook off in a dying hull. */
    schedulePop(fx: FxContext, x: number, y: number, z: number, vx: number, vy: number, vz: number, delay: number, size: number) {
        if (this.popCount >= MAX_POPS) return
        this.popFx = fx
        const o = this.popCount++ * POP
        const p = this.pops
        p[o] = x
        p[o + 1] = y
        p[o + 2] = z
        p[o + 3] = vx
        p[o + 4] = vy
        p[o + 5] = vz
        p[o + 6] = delay
        p[o + 7] = size
    }

    update(dt: number, particles: ParticleSystem) {
        this.updatePops(dt)
        const d = this.data
        const drag = Math.exp(-0.4 * dt)
        const heat = this.heat.array as Float32Array
        let n = 0
        for (let i = 0; i < this.count; i++) {
            const o = i * CHUNK
            const life = d[o + 15]! - dt
            if (life <= 0) continue
            const q = n * CHUNK
            if (q !== o) d.copyWithin(q, o, o + CHUNK)
            d[q + 15] = life
            d[q + 3] = d[q + 3]! * drag
            d[q + 4] = d[q + 4]! * drag
            d[q + 5] = d[q + 5]! * drag
            d[q] = d[q]! + d[q + 3]! * dt
            d[q + 1] = d[q + 1]! + d[q + 4]! * dt
            d[q + 2] = d[q + 2]! + d[q + 5]! * dt
            d[q + 6] = d[q + 6]! + d[q + 9]! * dt
            d[q + 7] = d[q + 7]! + d[q + 10]! * dt
            d[q + 8] = d[q + 8]! + d[q + 11]! * dt
            const shrink = Math.min(1, life * 1.5)
            this.posV.set(d[q]!, d[q + 1]!, d[q + 2]!)
            this.quat.setFromEuler(this.euler.set(d[q + 6]!, d[q + 7]!, d[q + 8]!))
            this.scaleV.set(d[q + 12]! * shrink, d[q + 13]! * shrink, d[q + 14]! * shrink)
            this.matrix.compose(this.posV, this.quat, this.scaleV)
            this.mesh.setMatrixAt(n, this.matrix)
            // Hot chunks cool over their first couple of seconds, shedding embers and a thread of smoke.
            const age = d[q + 16]! - life
            const h = d[q + 17]! > 0 ? Math.max(0, 1 - age / 2.4) : 0
            heat[n] = h
            if (h > 0) {
                const s = Math.max(d[q + 12]!, d[q + 14]!)
                particles.glow(d[q]!, d[q + 1]!, d[q + 2]!, this.glowColor.copy(this.emberColor).multiplyScalar(h * h * 0.5), s * 5, 0.7)
                if (Math.random() < dt * 28 * h) {
                    particles.emit(d[q]!, d[q + 1]!, d[q + 2]!, d[q + 3]! * 0.3, d[q + 4]! * 0.3, d[q + 5]! * 0.3, { life: 0.45 + h * 0.4, size: s * 1.5, sizeEnd: 0, color: this.emberColor, colorEnd: 0x551100, drag: 0.5 })
                }
                if (this.popFx && Math.random() < dt * 7 * h) {
                    this.popFx.smoke.emit(d[q]!, d[q + 1]!, d[q + 2]!, d[q + 3]! * 0.2, d[q + 4]! * 0.2, d[q + 5]! * 0.2, { life: 1.1, size: s * 1.2, sizeEnd: s * 5, color: 0x1c1917, alpha: 0.3, drag: 0.6 })
                }
            }
            n++
        }
        this.count = n
        if (this.cursor >= n) this.cursor = 0
        this.mesh.count = n
        this.mesh.instanceMatrix.needsUpdate = true
        this.heat.needsUpdate = true
    }

    private updatePops(dt: number) {
        const p = this.pops
        let n = 0
        for (let i = 0; i < this.popCount; i++) {
            const o = i * POP
            p[o] = p[o]! + p[o + 3]! * dt
            p[o + 1] = p[o + 1]! + p[o + 4]! * dt
            p[o + 2] = p[o + 2]! + p[o + 5]! * dt
            p[o + 6] = p[o + 6]! - dt
            if (p[o + 6]! <= 0) {
                if (this.popFx) burst(this.popFx, p[o]!, p[o + 1]!, p[o + 2]!, p[o + 3]!, p[o + 4]!, p[o + 5]!, p[o + 7]!)
                continue
            }
            if (n !== i) p.copyWithin(n * POP, o, o + POP)
            n++
        }
        this.popCount = n
    }

    clear() {
        this.count = 0
        this.cursor = 0
        this.popCount = 0
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
        // Steal the dimmest light, never one that is mid-flash on something bigger.
        let slot = this.lights[0]!
        for (const l of this.lights) if (l.light.intensity < slot.light.intensity) slot = l
        if (slot.light.intensity > intensity) return
        slot.light.position.copy(pos)
        slot.light.color.set(color)
        slot.light.distance = range
        slot.light.intensity = intensity
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

const tmpCol = new THREE.Color()
const tint = new THREE.Color()
const FIRE = new THREE.Color(1, 1, 1)
const SPARK_HOT = new THREE.Color(0xffdc9e).multiplyScalar(3.2)
const _n = new THREE.Vector3()
const _a = new THREE.Vector3()

/** Unit vector, uniformly random, written into `_v`. */
function randomUnit() {
    const u = Math.random() * 2 - 1
    const a = Math.random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    return _v.set(s * Math.cos(a), u, s * Math.sin(a))
}

/** A small secondary blast: flash, a knot of fire and a few sparks. */
function burst(fx: FxContext, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number) {
    const r = Math.random
    fx.particles.emit(x, y, z, vx, vy, vz, { life: 0.12, size: size * 7, sizeEnd: size * 10, color: WHITE_HOT, intensity: 3, drag: 0 })
    for (let i = 0; i < 6; i++) {
        randomUnit().multiplyScalar(size * (2 + r() * 6))
        fx.particles.emit(x, y, z, vx + _v.x, vy + _v.y, vz + _v.z, {
            life: 0.35 + r() * 0.45, size: size * (1.4 + r() * 1.4), sizeEnd: size * (3 + r() * 2.5), color: FIRE, intensity: 2.4, drag: 3, shape: 'fire'
        })
    }
    for (let i = 0; i < 7; i++) {
        randomUnit().multiplyScalar(18 + r() * 40 * Math.sqrt(size))
        fx.sparks.emit(x, y, z, vx + _v.x, vy + _v.y, vz + _v.z, 0.2 + r() * 0.45, SPARK_HOT, 0.08 + size * 0.04)
    }
    randomUnit().multiplyScalar(size * 2)
    fx.smoke.emit(x, y, z, vx + _v.x, vy + _v.y, vz + _v.z, { life: 1.2 + r(), size: size * 2.5, sizeEnd: size * 8, color: 0x3a261a, colorEnd: 0x0e0d0d, alpha: 0.42, drag: 1.2 })
}

/**
 * The full show, scaled by `size` from a mite pop (< 1) to a dying capital
 * ship (10+): flash, a fireball that cools from white through orange to
 * soot, jets that break the silhouette, streaking sparks, embers, a shock
 * front, tumbling hot debris, cook-off blasts and a light on nearby hulls.
 */
export function explosion(fx: FxContext, pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.ColorRepresentation, debris = true) {
    const r = Math.random
    // Counts follow a capped size, so a capital kill is bigger, not ten times busier.
    const k = Math.min(size, 8)
    const big = debris && size >= 1.5
    tint.set(color)
    const { x, y, z } = pos
    const vx = vel.x * 0.4
    const vy = vel.y * 0.4
    const vz = vel.z * 0.4

    // White-hot core, then the weapon- or faction-coloured bloom around it.
    fx.particles.emit(x, y, z, 0, 0, 0, { life: 0.1 + k * 0.012, size: size * 9, sizeEnd: size * 15, color: WHITE_HOT, intensity: 4, drag: 0 })
    fx.particles.emit(x, y, z, vx, vy, vz, { life: 0.22, size: size * 4, sizeEnd: size * 6, color: WHITE_HOT, intensity: 5, drag: 0 })
    fx.particles.emit(x, y, z, vx, vy, vz, { life: 0.5, size: size * 7, sizeEnd: size * 12, color: tint, intensity: 2, drag: 2 })

    // Fireball.
    const fire = Math.round(8 + k * 5)
    for (let i = 0; i < fire; i++) {
        randomUnit().multiplyScalar(size * (2.5 + r() * 9))
        const plasma = i % 5 === 4
        fx.particles.emit(x, y, z, vx + _v.x, vy + _v.y, vz + _v.z, {
            life: (0.45 + r() * 0.7) * (1 + k * 0.06), size: size * (1.4 + r() * 1.8), sizeEnd: size * (3.2 + r() * 3.2),
            color: plasma ? tint : FIRE, colorEnd: plasma ? tmpCol.copy(tint).multiplyScalar(0.12) : FIRE,
            intensity: plasma ? 1.8 : 2.6, drag: 3, shape: plasma ? 'puff' : 'fire'
        })
    }
    // Jets: fire thrown hard along a few axes, so no two blasts share an outline.
    const jets = size < 0.8 ? 0 : 2 + Math.round(r() * 2)
    for (let j = 0; j < jets; j++) {
        _a.copy(randomUnit())
        const reach = size * (9 + r() * 8)
        for (let i = 0; i < 5; i++) {
            const f = (i + 1) / 5
            randomUnit().multiplyScalar(size * 1.6).addScaledVector(_a, reach * f)
            fx.particles.emit(x, y, z, vx + _v.x, vy + _v.y, vz + _v.z, {
                life: 0.4 + f * 0.5 + r() * 0.2, size: size * (1.8 - f), sizeEnd: size * (3.4 - f * 1.4), color: FIRE, intensity: 2.8, drag: 2.6, shape: 'fire'
            })
        }
    }

    // Streaking sparks, and slower embers that outlive the fire.
    const sparks = Math.round(14 + k * 8)
    const reachS = Math.pow(size, 0.6)
    for (let i = 0; i < sparks; i++) {
        randomUnit().multiplyScalar(reachS * (28 + r() * 70))
        fx.sparks.emit(x, y, z, vel.x * 0.5 + _v.x, vel.y * 0.5 + _v.y, vel.z * 0.5 + _v.z, (0.3 + r() * 0.7) * (1 + k * 0.05), SPARK_HOT, Math.min(0.5, 0.1 + size * 0.045))
    }
    const embers = Math.round(4 + k * 3)
    for (let i = 0; i < embers; i++) {
        randomUnit().multiplyScalar(size * (3 + r() * 9))
        fx.particles.emit(x, y, z, vx + _v.x, vy + _v.y, vz + _v.z, {
            life: 1.2 + r() * 1.6, size: 0.35 + size * 0.12, sizeEnd: 0.1, color: 0xffb060, colorEnd: 0xc01a05, intensity: 3, drag: 1.1
        })
    }

    // Smoke starts lit by the fire inside it and cools to soot.
    const puffs = Math.round(4 + k * 2)
    for (let i = 0; i < puffs; i++) {
        randomUnit().multiplyScalar(size * (1.5 + r() * 4))
        const grey = 0.035 + r() * 0.05
        fx.smoke.emit(x, y, z, vel.x * 0.3 + _v.x, vel.y * 0.3 + _v.y, vel.z * 0.3 + _v.z, {
            life: 1.6 + r() * 1.8 + k * 0.12, size: size * 2.6, sizeEnd: size * (8 + r() * 6), color: 0x4a2a16, colorEnd: tmpCol.setRGB(grey, grey * 0.95, grey * 1.05), alpha: 0.55, drag: 1.2
        })
    }

    // Shock front: a coloured wave, a thin fast white one on bigger blasts,
    // and for real ship kills a flat ring on a random plane.
    fx.rings.spawn(pos, size * 7, color, 0.55, 2.2)
    if (size > 1.6) fx.rings.spawn(pos, size * 12, 0xffffff, 0.9, 0.8, undefined, 0.05)
    if (big && size >= 2.5) fx.rings.spawn(pos, size * 16, tmpCol.copy(tint).lerp(WHITE_HOT, 0.5), 1.1, 1.6, _n.copy(randomUnit()), 0.035)

    if (debris) fx.debris.spawn(pos, vel, Math.min(28, Math.round(3 + size * 2.5)), size, size * 10, r)
    if (big) {
        const pops = Math.min(6, Math.floor(size) + 1)
        for (let i = 0; i < pops; i++) {
            randomUnit().multiplyScalar(size * (0.8 + r() * 1.8))
            fx.debris.schedulePop(fx, x + _v.x, y + _v.y, z + _v.z, vx + _v.x * 1.5, vy + _v.y * 1.5, vz + _v.z * 1.5, 0.1 + r() * 0.2 + i * (0.09 + r() * 0.08), size * (0.3 + r() * 0.25))
        }
    }
    fx.lights.flash(pos, 0xffa858, Math.min(400, 24 * size), 30 + size * 30, 0.4 + k * 0.03)
}

/** Impact sparks thrown off a surface: they leave along `normal`, in a cone that hugs it. */
export function hitSpark(fx: FxContext, pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation, scale = 1) {
    const r = Math.random
    const c = tmpCol.set(color).multiplyScalar(2.4)
    const { x, y, z } = pos
    fx.particles.emit(x, y, z, 0, 0, 0, { life: 0.1, size: 2.4 * scale, sizeEnd: 3.8 * scale, color: c, drag: 0 })
    fx.particles.emit(x, y, z, 0, 0, 0, { life: 0.06, size: 1.1 * scale, sizeEnd: 0.6 * scale, color: WHITE_HOT, intensity: 4, drag: 0 })
    // A lick of vaporised plating standing off the surface.
    fx.particles.emit(x, y, z, normal.x * 7, normal.y * 7, normal.z * 7, { life: 0.22, size: 0.9 * scale, sizeEnd: 2.4 * scale, color: c, colorEnd: tint.copy(c).multiplyScalar(0.15), drag: 4, shape: 'puff' })
    for (let i = 0; i < 7; i++) {
        // Most sparks skim away close to the surface, a few fly straight off it.
        const lift = i < 2 ? 1.2 : 0.35
        randomUnit()
        _v.addScaledVector(normal, -_v.dot(normal)).multiplyScalar(1.1).addScaledVector(normal, lift).normalize().multiplyScalar(20 + r() * 42)
        fx.sparks.emit(x, y, z, _v.x, _v.y, _v.z, 0.12 + r() * 0.26, i % 3 === 0 ? SPARK_HOT : c, 0.08 * scale)
    }
}

/** `dir` (unit, optional) throws the flash forward as a cone; without it the flash is a starburst. */
export function muzzleFlash(fx: FxContext, pos: THREE.Vector3, color: THREE.ColorRepresentation, scale = 1, dir?: THREE.Vector3) {
    const r = Math.random
    const c = tmpCol.set(color).multiplyScalar(3)
    const { x, y, z } = pos
    fx.particles.emit(x, y, z, 0, 0, 0, { life: 0.07, size: 1.7 * scale, sizeEnd: 0.4 * scale, color: c, drag: 0 })
    fx.particles.emit(x, y, z, 0, 0, 0, { life: 0.045, size: 0.7 * scale, sizeEnd: 0.2 * scale, color: WHITE_HOT, intensity: 4, drag: 0 })
    if (dir) {
        // A tongue of fire ahead of the barrel, and sparks in a tight cone around it.
        for (let i = 1; i <= 3; i++) {
            const d = i * 0.55 * scale
            fx.particles.emit(x + dir.x * d, y + dir.y * d, z + dir.z * d, dir.x * 12, dir.y * 12, dir.z * 12, { life: 0.06, size: (1.3 - i * 0.3) * scale, sizeEnd: 0.2 * scale, color: c, drag: 0 })
        }
        for (let i = 0; i < 4; i++) {
            randomUnit().multiplyScalar(0.28).add(dir).normalize().multiplyScalar(50 + r() * 90)
            fx.sparks.emit(x, y, z, _v.x, _v.y, _v.z, 0.05 + r() * 0.07, c, 0.05 * scale)
        }
    } else {
        for (let i = 0; i < 3; i++) {
            randomUnit().multiplyScalar(30 + r() * 40)
            fx.sparks.emit(x, y, z, _v.x, _v.y, _v.z, 0.04 + r() * 0.04, c, 0.045 * scale)
        }
    }
}
