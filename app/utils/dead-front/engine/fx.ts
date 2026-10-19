import * as THREE from 'three'
import type { Vec3 } from '#shared/utils/dead-front/types'
import type { DfFx, DfFxOpts, DfFxPreset } from '../context'

// The Dead Front particle / tracer / lightning / decal / light-flash system.
// Everything is pooled and preallocated: bursts write into fixed typed arrays,
// lights come from a fixed pool (never added or removed at runtime) and the
// per-frame update allocates nothing.

export interface DfFxEngine extends DfFx {
    update(dt: number, time: number): void
    /** Ground height lookup for bouncing debris (feet height at or below y). */
    setGround(fn: (x: number, z: number, y: number) => number): void
    /** Physical pixels of the drawing buffer and the renderer pixel ratio. */
    resize(bufferHeight: number, pixelRatio: number): void
    /** Camera shake offset in radians for this frame. */
    readonly shakeYaw: number
    readonly shakePitch: number
    readonly shakeRoll: number
    dispose(): void
}

type V3 = Vec3 | THREE.Vector3

// ---------------------------------------------------------------- particles

const SHAPE = { glow: 0, smoke: 1, streak: 2, chunk: 3, ring: 4, drop: 5, splinter: 6, twinkle: 7 } as const

// Every particle is a little cube: blood chips, splinters, sparks (cubes
// stretched along their velocity), smoke puffs (big soft cubes), debris. The
// cube turns about a per-particle axis and keeps a minimum on-screen size.
const PARTICLE_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iMisc; // size, rotation, shape, stretch
attribute vec2 iExtra; // seed, age 0..1
uniform float uPxScale;
uniform float uMinPx;
varying vec4 vColor;
varying vec3 vNormal;
varying float vShape;
varying vec2 vExtra;
mat3 dfAxisAngle(vec3 a, float t) {
    float c = cos(t);
    float s = sin(t);
    float k = 1.0 - c;
    return mat3(
        c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
        a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
        a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k
    );
}
void main() {
    int shape = int(iMisc.z + 0.5);
    vec4 mvc = modelViewMatrix * vec4(iPos, 1.0);
    float depth = max(-mvc.z, 0.01);
    float size = iMisc.x;
    // soft shapes become chunky cubes: a cube covers more screen than a soft puff
    if (shape == 1) size *= 0.5;
    else if (shape == 0 || shape == 7) size *= 0.45;
    float px = size * uPxScale / depth;
    float boost = max(1.0, uMinPx / max(px, 1e-4));
    size *= boost;
    // gained area is paid back in brightness so tiny sparks don't flicker
    float dim = 1.0 / (boost * boost);
    mat3 R;
    vec3 scl = vec3(size);
    float l = length(iVel);
    if (iMisc.w > 0.0 && l > 1e-4) {
        // streak: x along the velocity
        vec3 d = iVel / l;
        vec3 up = abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 b = normalize(cross(up, d));
        vec3 c = cross(d, b);
        R = mat3(d, b, c);
        scl.x = size + iMisc.w * l;
    } else {
        float sd = iExtra.x * 61.0;
        vec3 ax = normalize(vec3(sin(sd), cos(sd * 1.7), sin(sd * 2.3) + 0.2));
        R = dfAxisAngle(ax, iMisc.y);
        if (shape == 4) scl = vec3(size, size * 0.05, size);
        if (shape == 6) scl = vec3(size * 2.6, size * 0.6, size * 0.6);
    }
    if (shape == 4) R = mat3(1.0);
    vec3 p = R * (position * scl);
    vNormal = normalize(normalMatrix * (R * normal));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + p, 1.0);
    float nearFade = clamp((depth - 0.12) * 3.0, 0.0, 1.0);
    vColor = vec4(iColor.rgb, iColor.a * dim * nearFade);
    vShape = iMisc.z;
    vExtra = iExtra;
}
`

const PARTICLE_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uTint;
uniform float uLit;
varying vec4 vColor;
varying vec3 vNormal;
varying float vShape;
varying vec2 vExtra;
void main() {
    int s = int(vShape + 0.5);
    vec3 col = vColor.rgb;
    float a = vColor.a;
    // flat cube shading: a fixed view-space key so faces read as blocks
    vec3 n = normalize(vNormal);
    float lit = 0.62 + 0.38 * clamp(dot(n, normalize(vec3(0.35, 0.85, 0.4))), 0.0, 1.0);
    col *= mix(1.0, lit, uLit);
    if (s == 1) a *= 0.85;
    if (s == 7) a *= 0.5 + 0.5 * sin(uTime * 23.0 + vExtra.x * 60.0);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * uTint, a);
}
`

class ParticleSystem {
    readonly cap: number
    count = 0
    readonly mesh: THREE.Mesh
    private readonly geo: THREE.InstancedBufferGeometry
    readonly mat: THREE.ShaderMaterial
    private readonly aPos: THREE.InstancedBufferAttribute
    private readonly aVel: THREE.InstancedBufferAttribute
    private readonly aColor: THREE.InstancedBufferAttribute
    private readonly aMisc: THREE.InstancedBufferAttribute
    private readonly aExtra: THREE.InstancedBufferAttribute
    // simulation state (struct of arrays)
    readonly p: Float32Array // x y z
    readonly v: Float32Array // x y z
    readonly c: Float32Array // r0 g0 b0 r1 g1 b1
    readonly f: Float32Array // age life s0 s1 grav drag rot spin stretch alpha fadeIn fadePow shape seed floor bounce
    static readonly F = 16

    constructor(cap: number, additive: boolean, uniforms: Record<string, THREE.IUniform>) {
        this.cap = cap
        this.p = new Float32Array(cap * 3)
        this.v = new Float32Array(cap * 3)
        this.c = new Float32Array(cap * 6)
        this.f = new Float32Array(cap * ParticleSystem.F)
        const cube = new THREE.BoxGeometry(1, 1, 1)
        const geo = new THREE.InstancedBufferGeometry()
        geo.index = cube.index
        geo.setAttribute('position', cube.getAttribute('position'))
        geo.setAttribute('normal', cube.getAttribute('normal'))
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
        this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
        this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
        this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
        this.aExtra = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage)
        geo.setAttribute('iPos', this.aPos)
        geo.setAttribute('iVel', this.aVel)
        geo.setAttribute('iColor', this.aColor)
        geo.setAttribute('iMisc', this.aMisc)
        geo.setAttribute('iExtra', this.aExtra)
        geo.instanceCount = 0
        this.geo = geo
        this.mat = new THREE.ShaderMaterial({
            uniforms: {
                ...uniforms,
                uTint: { value: additive ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(0.7, 0.7, 0.74) },
                uLit: { value: additive ? 0.25 : 1 }
            },
            vertexShader: PARTICLE_VERT,
            fragmentShader: PARTICLE_FRAG,
            transparent: true,
            depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
        })
        this.mesh = new THREE.Mesh(geo, this.mat)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = additive ? 11 : 10
    }

    /** Returns the slot index for a new particle (recycles the oldest when full). */
    alloc(): number {
        if (this.count < this.cap) return this.count++
        // full: overwrite a random live one rather than refusing (keeps fresh bursts visible)
        return Math.floor(Math.random() * this.cap)
    }

    update(dt: number): void {
        const { p, v, c, f } = this
        const F = ParticleSystem.F
        const pos = this.aPos.array as Float32Array
        const vel = this.aVel.array as Float32Array
        const col = this.aColor.array as Float32Array
        const misc = this.aMisc.array as Float32Array
        const ext = this.aExtra.array as Float32Array
        let i = 0
        while (i < this.count) {
            const o = i * F
            const age = f[o]! + dt
            const life = f[o + 1]!
            if (age >= life) {
                this.kill(i)
                continue
            }
            f[o] = age
            const t = age / life
            const i3 = i * 3
            const grav = f[o + 4]!
            const drag = f[o + 5]!
            const damp = 1 / (1 + drag * dt)
            let vx = v[i3]! * damp
            let vy = (v[i3 + 1]! - grav * dt) * damp
            let vz = v[i3 + 2]! * damp
            const px = p[i3]! + vx * dt
            let py = p[i3 + 1]! + vy * dt
            const pz = p[i3 + 2]! + vz * dt
            const floor = f[o + 14]!
            if (py < floor) {
                py = floor
                const bounce = f[o + 15]!
                if (bounce > 0 && vy < -0.6) {
                    vy = -vy * bounce
                    vx *= 0.55
                    vz *= 0.55
                    f[o + 7] = f[o + 7]! * 0.5
                } else {
                    vy = 0
                    vx *= 0.2
                    vz *= 0.2
                    f[o + 7] = 0
                    // drops splat and vanish quickly; settled debris lingers
                    if (f[o + 12] === SHAPE.drop && life - age > 0.12) f[o + 1] = age + 0.12
                }
            }
            p[i3] = px
            p[i3 + 1] = py
            p[i3 + 2] = pz
            v[i3] = vx
            v[i3 + 1] = vy
            v[i3 + 2] = vz
            const rot = f[o + 6]! + f[o + 7]! * dt
            f[o + 6] = rot
            const e = 1 - (1 - t) * (1 - t)
            const size = f[o + 2]! + (f[o + 3]! - f[o + 2]!) * e
            const fadeIn = f[o + 10]!
            const fadePow = f[o + 11]!
            const fin = fadeIn > 0 ? Math.min(1, t / fadeIn) : 1
            const left = 1 - t
            const fout = fadePow === 1 ? left : fadePow === 2 ? left * left : Math.sqrt(left)
            const alpha = f[o + 9]! * fin * fout
            const i6 = i * 6
            const i4 = i * 4
            pos[i3] = px
            pos[i3 + 1] = py
            pos[i3 + 2] = pz
            vel[i3] = vx
            vel[i3 + 1] = vy
            vel[i3 + 2] = vz
            col[i4] = c[i6]! + (c[i6 + 3]! - c[i6]!) * t
            col[i4 + 1] = c[i6 + 1]! + (c[i6 + 4]! - c[i6 + 1]!) * t
            col[i4 + 2] = c[i6 + 2]! + (c[i6 + 5]! - c[i6 + 2]!) * t
            col[i4 + 3] = alpha
            misc[i4] = size
            misc[i4 + 1] = rot
            misc[i4 + 2] = f[o + 12]!
            misc[i4 + 3] = f[o + 8]!
            ext[i * 2] = f[o + 13]!
            ext[i * 2 + 1] = t
            i++
        }
        this.geo.instanceCount = this.count
        const n = this.count
        if (n > 0) {
            for (const [a, size] of [[this.aPos, 3], [this.aVel, 3], [this.aColor, 4], [this.aMisc, 4], [this.aExtra, 2]] as const) {
                a.clearUpdateRanges()
                a.addUpdateRange(0, n * size)
                a.needsUpdate = true
            }
        }
    }

    private kill(i: number): void {
        const last = --this.count
        if (i === last) return
        const F = ParticleSystem.F
        this.p.copyWithin(i * 3, last * 3, last * 3 + 3)
        this.v.copyWithin(i * 3, last * 3, last * 3 + 3)
        this.c.copyWithin(i * 6, last * 6, last * 6 + 6)
        this.f.copyWithin(i * F, last * F, last * F + F)
    }

    clear(): void {
        this.count = 0
        this.geo.instanceCount = 0
    }

    dispose(): void {
        this.geo.dispose()
        this.mat.dispose()
    }
}

/** Scratch spawn description, filled by the presets and written by `emit`. */
const S = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    life: 1, s0: 0.1, s1: 0.1, grav: 0, drag: 0, rot: 0, spin: 0, stretch: 0,
    alpha: 1, fadeIn: 0, fadePow: 1, shape: 0, floor: -1e9, bounce: 0,
    c0: new THREE.Color(), c1: new THREE.Color()
}

function emit(sys: ParticleSystem): void {
    const i = sys.alloc()
    const F = ParticleSystem.F
    const o = i * F
    const i3 = i * 3
    sys.p[i3] = S.x
    sys.p[i3 + 1] = S.y
    sys.p[i3 + 2] = S.z
    sys.v[i3] = S.vx
    sys.v[i3 + 1] = S.vy
    sys.v[i3 + 2] = S.vz
    const i6 = i * 6
    sys.c[i6] = S.c0.r
    sys.c[i6 + 1] = S.c0.g
    sys.c[i6 + 2] = S.c0.b
    sys.c[i6 + 3] = S.c1.r
    sys.c[i6 + 4] = S.c1.g
    sys.c[i6 + 5] = S.c1.b
    const f = sys.f
    f[o] = 0
    f[o + 1] = Math.max(0.01, S.life)
    f[o + 2] = S.s0
    f[o + 3] = S.s1
    f[o + 4] = S.grav
    f[o + 5] = S.drag
    f[o + 6] = S.rot
    f[o + 7] = S.spin
    f[o + 8] = S.stretch
    f[o + 9] = S.alpha
    f[o + 10] = S.fadeIn
    f[o + 11] = S.fadePow
    f[o + 12] = S.shape
    f[o + 13] = Math.random()
    f[o + 14] = S.floor
    f[o + 15] = S.bounce
}

function rnd(a: number, b: number): number {
    return a + Math.random() * (b - a)
}

// ---------------------------------------------------------------- segments (tracers + lightning)

const SEG_VERT = /* glsl */`
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aColor;
attribute vec2 aParams; // world width, tail fade
uniform vec2 uRes;
uniform float uPxScale;
uniform float uMinPx;
varying float vSide;
varying float vAlpha;
varying vec3 vColor;
void main() {
    vec4 a = modelViewMatrix * vec4(aA, 1.0);
    vec4 b = modelViewMatrix * vec4(aB, 1.0);
    const float NEAR = -0.06;
    if (a.z > NEAR && b.z > NEAR) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vAlpha = 0.0;
        vSide = 0.0;
        vColor = vec3(0.0);
        return;
    }
    if (a.z > NEAR) a = mix(a, b, (a.z - NEAR) / (a.z - b.z));
    if (b.z > NEAR) b = mix(b, a, (b.z - NEAR) / (b.z - a.z));
    vec4 ca = projectionMatrix * a;
    vec4 cb = projectionMatrix * b;
    vec2 sa = ca.xy / ca.w * uRes * 0.5;
    vec2 sb = cb.xy / cb.w * uRes * 0.5;
    vec2 d = sb - sa;
    float dl = length(d);
    d = dl > 1e-4 ? d / dl : vec2(1.0, 0.0);
    vec2 n = vec2(-d.y, d.x);
    float t = position.x + 0.5;
    vec4 c = mix(ca, cb, t);
    float depth = max(-mix(a.z, b.z, t), 0.01);
    float wpx = aParams.x * uPxScale / depth;
    float w = max(wpx, uMinPx);
    // a line thinner than the minimum keeps its energy: dim by the width gained
    float dim = clamp(wpx / uMinPx, 0.15, 1.0);
    // the quad is 4x the core width to fit the soft glow
    float halfW = w * 2.0;
    vec2 offPx = n * position.y * 2.0 * halfW + d * (t * 2.0 - 1.0) * w;
    c.xy += offPx / (uRes * 0.5) * c.w;
    gl_Position = c;
    vSide = position.y * 2.0;
    vAlpha = aColor.a * dim * mix(1.0 - aParams.y, 1.0, t);
    vColor = aColor.rgb;
}
`

const SEG_FRAG = /* glsl */`
varying float vSide;
varying float vAlpha;
varying vec3 vColor;
void main() {
    float s = clamp(vSide, -1.0, 1.0);
    float s2 = s * s;
    float core = exp(-s2 * 40.0);
    float glow = exp(-s2 * 5.0) * 0.35;
    float a = (core + glow) * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * (1.0 + core * 0.8), a);
}
`

class SegmentRenderer {
    readonly cap: number
    count = 0
    readonly mesh: THREE.Mesh
    private readonly geo: THREE.InstancedBufferGeometry
    readonly mat: THREE.ShaderMaterial
    private readonly aA: THREE.InstancedBufferAttribute
    private readonly aB: THREE.InstancedBufferAttribute
    private readonly aColor: THREE.InstancedBufferAttribute
    private readonly aParams: THREE.InstancedBufferAttribute

    constructor(cap: number, uniforms: Record<string, THREE.IUniform>) {
        this.cap = cap
        const cube = new THREE.BoxGeometry(1, 1, 1)
        const geo = new THREE.InstancedBufferGeometry()
        geo.index = cube.index
        geo.setAttribute('position', cube.getAttribute('position'))
        geo.setAttribute('normal', cube.getAttribute('normal'))
        this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
        this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
        this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
        this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage)
        geo.setAttribute('aA', this.aA)
        geo.setAttribute('aB', this.aB)
        geo.setAttribute('aColor', this.aColor)
        geo.setAttribute('aParams', this.aParams)
        geo.instanceCount = 0
        this.geo = geo
        this.mat = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: SEG_VERT,
            fragmentShader: SEG_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
        this.mesh = new THREE.Mesh(geo, this.mat)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 12
    }

    begin(): void {
        this.count = 0
    }

    push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number, alpha: number, width: number, tail: number): void {
        if (this.count >= this.cap) return
        const i = this.count++
        const A = this.aA.array as Float32Array
        const B = this.aB.array as Float32Array
        const C = this.aColor.array as Float32Array
        const P = this.aParams.array as Float32Array
        A[i * 3] = ax
        A[i * 3 + 1] = ay
        A[i * 3 + 2] = az
        B[i * 3] = bx
        B[i * 3 + 1] = by
        B[i * 3 + 2] = bz
        C[i * 4] = r
        C[i * 4 + 1] = g
        C[i * 4 + 2] = b
        C[i * 4 + 3] = alpha
        P[i * 2] = width
        P[i * 2 + 1] = tail
    }

    end(): void {
        const n = this.count
        this.geo.instanceCount = n
        if (n === 0) return
        for (const [a, size] of [[this.aA, 3], [this.aB, 3], [this.aColor, 4], [this.aParams, 2]] as const) {
            a.clearUpdateRanges()
            a.addUpdateRange(0, n * size)
            a.needsUpdate = true
        }
    }

    dispose(): void {
        this.geo.dispose()
        this.mat.dispose()
    }
}

interface Tracer {
    alive: boolean
    ax: number, ay: number, az: number
    dx: number, dy: number, dz: number
    dist: number
    head: number
    speed: number
    len: number
    r: number, g: number, b: number
}

const BOLT_MAX = 48
interface Bolt {
    alive: boolean
    age: number
    life: number
    jitter: number
    a: THREE.Vector3
    b: THREE.Vector3
    color: THREE.Color
    /** Segment endpoints: 6 floats each. */
    segs: Float32Array
    widths: Float32Array
    n: number
}

// ---------------------------------------------------------------- decals

const DECAL_VERT = /* glsl */`
attribute vec3 aDecal; // tile u, tile v, opacity
varying vec2 vUv;
varying float vOp;
void main() {
    vUv = (uv + aDecal.xy) * vec2(0.25, 0.5);
    vOp = aDecal.z;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`

const DECAL_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vOp;
void main() {
    vec4 t = texture2D(uAtlas, vUv);
    float a = t.a * vOp;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(vec3(1.0), t.rgb, a), 1.0);
}
`

function drawDecalAtlas(): HTMLCanvasElement {
    const W = 1024
    const H = 512
    const T = 256
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, W, H)
    const cell = (i: number) => ({ x: (i % 4) * T, y: Math.floor(i / 4) * T })
    // the canvas is drawn with v flipped relative to uv; tiles are symmetric enough

    const bullet = (i: number, wood: boolean) => {
        const { x, y } = cell(i)
        const cx = x + T / 2
        const cy = y + T / 2
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, T * 0.48)
        rg.addColorStop(0, 'rgba(8,6,5,1)')
        rg.addColorStop(0.14, 'rgba(14,11,9,1)')
        rg.addColorStop(0.2, wood ? 'rgba(70,48,30,0.9)' : 'rgba(60,55,50,0.85)')
        rg.addColorStop(0.45, 'rgba(70,64,58,0.35)')
        rg.addColorStop(1, 'rgba(90,80,70,0)')
        g.fillStyle = rg
        g.beginPath()
        g.arc(cx, cy, T * 0.48, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = 'rgba(20,16,12,0.7)'
        g.lineWidth = 3
        for (let k = 0; k < 7; k++) {
            const a = Math.random() * Math.PI * 2
            const r0 = T * 0.08
            const r1 = T * (0.2 + Math.random() * 0.22)
            g.beginPath()
            g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
            const mx = cx + Math.cos(a + 0.2) * (r0 + r1) * 0.5
            const my = cy + Math.sin(a + 0.2) * (r0 + r1) * 0.5
            g.quadraticCurveTo(mx, my, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
            g.stroke()
        }
    }
    const scorch = (i: number) => {
        const { x, y } = cell(i)
        const cx = x + T / 2
        const cy = y + T / 2
        for (let k = 0; k < 40; k++) {
            const a = Math.random() * Math.PI * 2
            const d = Math.random() * T * 0.3
            const r = T * (0.08 + Math.random() * 0.16)
            const px = cx + Math.cos(a) * d
            const py = cy + Math.sin(a) * d
            const rg = g.createRadialGradient(px, py, 0, px, py, r)
            rg.addColorStop(0, 'rgba(12,10,8,0.35)')
            rg.addColorStop(1, 'rgba(12,10,8,0)')
            g.fillStyle = rg
            g.beginPath()
            g.arc(px, py, r, 0, Math.PI * 2)
            g.fill()
        }
        // radial streaks of soot
        g.strokeStyle = 'rgba(10,8,6,0.25)'
        for (let k = 0; k < 26; k++) {
            const a = Math.random() * Math.PI * 2
            g.lineWidth = 2 + Math.random() * 6
            g.beginPath()
            g.moveTo(cx + Math.cos(a) * T * 0.12, cy + Math.sin(a) * T * 0.12)
            g.lineTo(cx + Math.cos(a) * T * (0.3 + Math.random() * 0.18), cy + Math.sin(a) * T * (0.3 + Math.random() * 0.18))
            g.stroke()
        }
    }
    const blood = (i: number) => {
        const { x, y } = cell(i)
        const cx = x + T / 2
        const cy = y + T / 2
        g.fillStyle = 'rgba(92,6,4,0.95)'
        g.beginPath()
        const pts = 22
        for (let k = 0; k <= pts; k++) {
            const a = (k / pts) * Math.PI * 2
            const r = T * (0.16 + Math.random() * 0.12)
            const px = cx + Math.cos(a) * r
            const py = cy + Math.sin(a) * r
            if (k === 0) g.moveTo(px, py)
            else g.lineTo(px, py)
        }
        g.fill()
        for (let k = 0; k < 18; k++) {
            const a = Math.random() * Math.PI * 2
            const d = T * (0.22 + Math.random() * 0.24)
            const r = T * (0.008 + Math.random() * 0.03)
            g.fillStyle = `rgba(${80 + Math.random() * 30},5,4,${0.7 + Math.random() * 0.3})`
            g.beginPath()
            g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2)
            g.fill()
        }
        // darker clotted core
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, T * 0.2)
        rg.addColorStop(0, 'rgba(40,2,2,0.8)')
        rg.addColorStop(1, 'rgba(40,2,2,0)')
        g.fillStyle = rg
        g.beginPath()
        g.arc(cx, cy, T * 0.2, 0, Math.PI * 2)
        g.fill()
    }
    bullet(0, false)
    bullet(1, false)
    scorch(2)
    scorch(3)
    blood(4)
    blood(5)
    blood(6)
    bullet(7, true)
    return cv
}

const DECAL_TILES: Record<'bullet' | 'scorch' | 'blood', number[]> = {
    bullet: [0, 1, 7],
    scorch: [2, 3],
    blood: [4, 5, 6]
}
const DECAL_LIFE: Record<'bullet' | 'scorch' | 'blood', number> = { bullet: 24, scorch: 40, blood: 30 }

// ---------------------------------------------------------------- the system

const PRESET_COLORS = {
    blood0: new THREE.Color(0.32, 0.015, 0.01),
    blood1: new THREE.Color(0.16, 0.005, 0.004),
    mist0: new THREE.Color(0.4, 0.03, 0.02),
    mist1: new THREE.Color(0.2, 0.01, 0.01),
    flesh: new THREE.Color(0.32, 0.12, 0.09),
    bone: new THREE.Color(0.62, 0.56, 0.45),
    cloth: new THREE.Color(0.2, 0.19, 0.13),
    spark0: new THREE.Color(4, 2.6, 1.1),
    spark1: new THREE.Color(2.2, 0.5, 0.06),
    dust0: new THREE.Color(0.55, 0.5, 0.42),
    dust1: new THREE.Color(0.42, 0.38, 0.32),
    grit: new THREE.Color(0.3, 0.27, 0.22),
    wood0: new THREE.Color(0.55, 0.4, 0.24),
    wood1: new THREE.Color(0.38, 0.26, 0.15),
    smoke0: new THREE.Color(0.42, 0.4, 0.37),
    smoke1: new THREE.Color(0.22, 0.21, 0.2),
    lsmoke: new THREE.Color(0.7, 0.68, 0.64),
    fire0: new THREE.Color(5, 3.4, 1.3),
    fire1: new THREE.Color(1.1, 0.18, 0.02),
    flash: new THREE.Color(6, 5, 3.2),
    ring: new THREE.Color(2.2, 1.2, 0.5),
    debris: new THREE.Color(0.18, 0.15, 0.12),
    elec0: new THREE.Color(3, 4, 6),
    elec1: new THREE.Color(0.4, 0.8, 3.5),
    ray0: new THREE.Color(2.4, 6, 2.2),
    ray1: new THREE.Color(0.1, 2.4, 0.5),
    pap0: new THREE.Color(4.2, 2.4, 6),
    pap1: new THREE.Color(1.4, 0.2, 3),
    gold0: new THREE.Color(4.4, 3.6, 1.4),
    gold1: new THREE.Color(1.8, 1.1, 0.2),
    gas0: new THREE.Color(0.5, 0.62, 0.18),
    gas1: new THREE.Color(0.3, 0.36, 0.1),
    soul0: new THREE.Color(1.8, 3.6, 5),
    soul1: new THREE.Color(0.3, 0.9, 2.6),
    ember0: new THREE.Color(4, 1.8, 0.4),
    ember1: new THREE.Color(1.6, 0.2, 0.02)
}

export function createDfFx(scene: THREE.Scene, camera: THREE.Camera, quality: 'low' | 'high'): DfFxEngine {
    const high = quality === 'high'
    const shared = {
        uPxScale: { value: 500 },
        uMinPx: { value: 1.6 },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1280, 720) }
    }
    const add = new ParticleSystem(high ? 3000 : 1400, true, shared)
    const alpha = new ParticleSystem(high ? 2000 : 900, false, shared)
    const segs = new SegmentRenderer(1400, shared)
    scene.add(add.mesh, alpha.mesh, segs.mesh)

    // tracers
    const tracers: Tracer[] = Array.from({ length: 96 }, () => ({ alive: false, ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 0, dist: 0, head: 0, speed: 0, len: 0, r: 0, g: 0, b: 0 }))
    let tracerNext = 0
    // lightning
    const bolts: Bolt[] = Array.from({ length: 16 }, () => ({
        alive: false, age: 0, life: 0, jitter: 0,
        a: new THREE.Vector3(), b: new THREE.Vector3(), color: new THREE.Color(),
        segs: new Float32Array(BOLT_MAX * 6), widths: new Float32Array(BOLT_MAX), n: 0
    }))
    let boltNext = 0

    // decals
    const DECALS = high ? 220 : 120
    // Decals are pixelated to match the voxels: the painted atlas is shrunk to
    // 16 texels per tile and drawn with nearest filtering.
    const full = drawDecalAtlas()
    const small = document.createElement('canvas')
    small.width = 64
    small.height = 32
    const sg = small.getContext('2d')!
    sg.imageSmoothingEnabled = true
    sg.drawImage(full, 0, 0, 64, 32)
    const atlas = new THREE.CanvasTexture(small)
    atlas.colorSpace = THREE.SRGBColorSpace
    atlas.magFilter = THREE.NearestFilter
    atlas.minFilter = THREE.NearestFilter
    atlas.generateMipmaps = false
    const decalGeo = new THREE.PlaneGeometry(1, 1)
    const decalAttr = new THREE.InstancedBufferAttribute(new Float32Array(DECALS * 3), 3).setUsage(THREE.DynamicDrawUsage)
    decalGeo.setAttribute('aDecal', decalAttr)
    const decalMat = new THREE.ShaderMaterial({
        uniforms: { uAtlas: { value: atlas } },
        vertexShader: DECAL_VERT,
        fragmentShader: DECAL_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        blending: THREE.CustomBlending,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor
    })
    const decals = new THREE.InstancedMesh(decalGeo, decalMat, DECALS)
    decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    decals.count = 0
    decals.frustumCulled = false
    decals.renderOrder = 5
    scene.add(decals)
    const decalAge = new Float32Array(DECALS)
    const decalLife = new Float32Array(DECALS)
    let decalNext = 0

    // light flashes from a fixed pool
    // every point light costs every lit fragment (even at zero intensity), so keep the pool small
    const LIGHTS = high ? 4 : 3
    const lights: { light: THREE.PointLight, age: number, life: number, peak: number }[] = []
    for (let i = 0; i < LIGHTS; i++) {
        const light = new THREE.PointLight(0xffffff, 0, 14, 2)
        light.castShadow = false
        scene.add(light)
        lights.push({ light, age: 1, life: 0, peak: 0 })
    }

    let ground: (x: number, z: number, y: number) => number = (_x, _z, y) => y - 50
    let trauma = 0
    let time = 0
    let shakeYaw = 0
    let shakePitch = 0
    let shakeRoll = 0
    let pixelRatio = 1

    const tmpV = new THREE.Vector3()
    const tmpN = new THREE.Vector3()
    const tmpQ = new THREE.Quaternion()
    const tmpQ2 = new THREE.Quaternion()
    const tmpM = new THREE.Matrix4()
    const tmpS = new THREE.Vector3()
    const Z = new THREE.Vector3(0, 0, 1)
    const camPos = new THREE.Vector3()
    const userColor = new THREE.Color()
    const userTail = new THREE.Color()
    const dir = { x: 0, y: 0, z: 0 }

    /** Random unit vector in a cone around (nx, ny, nz); spread 0 = exact, 1 = hemisphere-ish. */
    function cone(nx: number, ny: number, nz: number, spread: number): void {
        let rx = Math.random() * 2 - 1
        let ry = Math.random() * 2 - 1
        let rz = Math.random() * 2 - 1
        const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1
        rx /= rl
        ry /= rl
        rz /= rl
        let x = nx + rx * spread
        let y = ny + ry * spread
        let z = nz + rz * spread
        const l = Math.sqrt(x * x + y * y + z * z) || 1
        x /= l
        y /= l
        z /= l
        dir.x = x
        dir.y = y
        dir.z = z
    }

    function base(px: number, py: number, pz: number, floor: number): void {
        S.x = px
        S.y = py
        S.z = pz
        S.vx = 0
        S.vy = 0
        S.vz = 0
        S.grav = 0
        S.drag = 0
        S.rot = Math.random() * Math.PI * 2
        S.spin = 0
        S.stretch = 0
        S.alpha = 1
        S.fadeIn = 0
        S.fadePow = 1
        S.floor = floor
        S.bounce = 0
    }

    function vel(speed: number): void {
        S.vx = dir.x * speed
        S.vy = dir.y * speed
        S.vz = dir.z * speed
    }

    function flash(pos: V3, color: THREE.ColorRepresentation, intensity: number, seconds: number): void {
        let best = lights[0]!
        let bestLeft = Infinity
        for (const l of lights) {
            const left = l.life - l.age
            if (left <= 0) {
                best = l
                break
            }
            if (left < bestLeft) {
                bestLeft = left
                best = l
            }
        }
        best.light.position.set(pos.x, pos.y, pos.z)
        best.light.color.set(color)
        best.peak = intensity
        best.age = 0
        best.life = Math.max(0.02, seconds)
        best.light.intensity = intensity
    }

    function burst(preset: DfFxPreset, pos: V3, opts: DfFxOpts = {}): void {
        const sc = opts.scale ?? 1
        const q = high ? 1 : 0.55
        const n = opts.normal
        let nx = 0
        let ny = 1
        let nz = 0
        if (n) {
            const l = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1
            nx = n.x / l
            ny = n.y / l
            nz = n.z / l
        }
        const px = pos.x
        const py = pos.y
        const pz = pos.z
        const floor = ground(px, pz, py + 0.25)
        const custom = opts.color !== undefined ? userColor.set(opts.color) : null
        const cnt = (def: number) => Math.max(1, Math.round((opts.count ?? def) * q))

        switch (preset) {
            case 'blood': {
                for (let i = 0, c = cnt(16); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny + 0.25, nz, 0.75)
                    vel(rnd(1.2, 4.2) * sc)
                    S.grav = 9.8
                    S.drag = 0.6
                    S.life = rnd(0.45, 0.9)
                    S.s0 = S.s1 = rnd(0.018, 0.045) * sc
                    S.stretch = 0.022
                    S.shape = SHAPE.drop
                    S.c0.copy(custom ?? PRESET_COLORS.blood0)
                    S.c1.copy(PRESET_COLORS.blood1)
                    emit(alpha)
                }
                for (let i = 0; i < 3; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 0.6)
                    vel(rnd(0.3, 1.2))
                    S.drag = 3
                    S.grav = 0.4
                    S.life = rnd(0.35, 0.6)
                    S.s0 = 0.08 * sc
                    S.s1 = rnd(0.3, 0.5) * sc
                    S.alpha = 0.55
                    S.fadePow = 2
                    S.spin = rnd(-1, 1)
                    S.shape = SHAPE.smoke
                    S.c0.copy(PRESET_COLORS.mist0)
                    S.c1.copy(PRESET_COLORS.mist1)
                    emit(alpha)
                }
                break
            }
            case 'blood-mist': {
                for (let i = 0, c = cnt(14); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny + 0.2, nz, 1.4)
                    vel(rnd(0.4, 2.2) * sc)
                    S.drag = 2.8
                    S.grav = 0.8
                    S.life = rnd(0.5, 1.1)
                    S.s0 = 0.1 * sc
                    S.s1 = rnd(0.4, 0.8) * sc
                    S.alpha = 0.6
                    S.fadePow = 2
                    S.spin = rnd(-1.2, 1.2)
                    S.shape = SHAPE.smoke
                    S.c0.copy(custom ?? PRESET_COLORS.mist0)
                    S.c1.copy(PRESET_COLORS.mist1)
                    emit(alpha)
                }
                for (let i = 0, c = cnt(22); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny + 0.4, nz, 1.6)
                    vel(rnd(2, 5.5) * sc)
                    S.grav = 9.8
                    S.drag = 0.5
                    S.life = rnd(0.5, 1)
                    S.s0 = S.s1 = rnd(0.02, 0.05) * sc
                    S.stretch = 0.025
                    S.shape = SHAPE.drop
                    S.c0.copy(PRESET_COLORS.blood0)
                    S.c1.copy(PRESET_COLORS.blood1)
                    emit(alpha)
                }
                break
            }
            case 'gib': {
                for (let i = 0, c = cnt(12); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny + 0.6, nz, 1.2)
                    vel(rnd(2.5, 7) * sc)
                    S.grav = 11
                    S.drag = 0.25
                    S.bounce = 0.35
                    S.life = rnd(1.6, 3.2)
                    S.s0 = S.s1 = rnd(0.05, 0.13) * sc
                    S.spin = rnd(-14, 14)
                    S.fadeIn = 0
                    S.fadePow = 0.5
                    S.shape = SHAPE.chunk
                    const r = Math.random()
                    S.c0.copy(r < 0.6 ? PRESET_COLORS.flesh : r < 0.8 ? PRESET_COLORS.bone : PRESET_COLORS.cloth)
                    S.c1.copy(S.c0).multiplyScalar(0.6)
                    emit(alpha)
                }
                burst('blood-mist', pos, { normal: opts.normal, scale: sc * 1.2 })
                burst('blood', pos, { normal: opts.normal, scale: sc, count: 20 })
                break
            }
            case 'sparks': {
                for (let i = 0, c = cnt(16); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 0.9)
                    vel(rnd(3, 11) * sc)
                    S.grav = 9.8
                    S.drag = 1.2
                    S.bounce = 0.3
                    S.life = rnd(0.15, 0.5)
                    S.s0 = S.s1 = rnd(0.008, 0.016) * sc
                    S.stretch = 0.028
                    S.shape = SHAPE.streak
                    S.c0.copy(custom ?? PRESET_COLORS.spark0)
                    S.c1.copy(PRESET_COLORS.spark1)
                    emit(add)
                }
                base(px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02, floor)
                S.life = 0.06
                S.s0 = 0.28 * sc
                S.s1 = 0.12 * sc
                S.shape = SHAPE.glow
                S.c0.copy(PRESET_COLORS.flash)
                S.c1.copy(PRESET_COLORS.spark1)
                emit(add)
                for (let i = 0; i < 2; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 0.5)
                    vel(rnd(0.3, 0.8))
                    S.drag = 2
                    S.grav = -0.3
                    S.life = rnd(0.6, 1)
                    S.s0 = 0.05
                    S.s1 = 0.3 * sc
                    S.alpha = 0.3
                    S.fadeIn = 0.1
                    S.shape = SHAPE.smoke
                    S.c0.copy(PRESET_COLORS.smoke0)
                    S.c1.copy(PRESET_COLORS.smoke1)
                    emit(alpha)
                }
                break
            }
            case 'dust': {
                for (let i = 0, c = cnt(5); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 0.55)
                    vel(rnd(0.5, 1.8) * sc)
                    S.drag = 3.2
                    S.grav = 0.25
                    S.life = rnd(0.7, 1.4)
                    S.s0 = 0.06 * sc
                    S.s1 = rnd(0.35, 0.7) * sc
                    S.alpha = 0.5
                    S.fadeIn = 0.05
                    S.fadePow = 2
                    S.spin = rnd(-0.8, 0.8)
                    S.shape = SHAPE.smoke
                    S.c0.copy(custom ?? PRESET_COLORS.dust0)
                    S.c1.copy(PRESET_COLORS.dust1)
                    emit(alpha)
                }
                for (let i = 0, c = cnt(9); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 0.8)
                    vel(rnd(1.5, 4.5) * sc)
                    S.grav = 9.8
                    S.drag = 0.4
                    S.bounce = 0.2
                    S.life = rnd(0.4, 0.8)
                    S.s0 = S.s1 = rnd(0.008, 0.02) * sc
                    S.spin = rnd(-10, 10)
                    S.shape = SHAPE.chunk
                    S.c0.copy(PRESET_COLORS.grit)
                    S.c1.copy(PRESET_COLORS.grit)
                    emit(alpha)
                }
                break
            }
            case 'splinters': {
                for (let i = 0, c = cnt(11); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny + 0.15, nz, 0.85)
                    vel(rnd(2, 6.5) * sc)
                    S.grav = 9.8
                    S.drag = 0.6
                    S.bounce = 0.25
                    S.life = rnd(0.6, 1.3)
                    S.s0 = S.s1 = rnd(0.008, 0.016) * sc
                    S.stretch = 0.012
                    S.fadePow = 0.5
                    S.shape = SHAPE.splinter
                    S.c0.copy(custom ?? PRESET_COLORS.wood0)
                    S.c1.copy(PRESET_COLORS.wood1)
                    emit(alpha)
                }
                for (let i = 0; i < 3; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 0.5)
                    vel(rnd(0.4, 1.2))
                    S.drag = 3
                    S.life = rnd(0.6, 1)
                    S.s0 = 0.05
                    S.s1 = 0.4 * sc
                    S.alpha = 0.38
                    S.fadePow = 2
                    S.shape = SHAPE.smoke
                    S.c0.copy(PRESET_COLORS.wood0)
                    S.c1.copy(PRESET_COLORS.dust1)
                    emit(alpha)
                }
                break
            }
            case 'muzzle-smoke': {
                for (let i = 0, c = cnt(3); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 0.35)
                    vel(rnd(0.4, 1.4) * sc)
                    S.drag = 2.4
                    S.grav = -0.35
                    S.life = rnd(0.8, 1.5)
                    S.s0 = 0.04 * sc
                    S.s1 = rnd(0.25, 0.42) * sc
                    S.alpha = 0.22
                    S.fadeIn = 0.08
                    S.fadePow = 2
                    S.spin = rnd(-1, 1)
                    S.shape = SHAPE.smoke
                    S.c0.copy(custom ?? PRESET_COLORS.lsmoke)
                    S.c1.copy(PRESET_COLORS.smoke0)
                    emit(alpha)
                }
                break
            }
            case 'smoke': {
                for (let i = 0, c = cnt(8); i < c; i++) {
                    base(px + rnd(-0.3, 0.3) * sc, py, pz + rnd(-0.3, 0.3) * sc, floor)
                    cone(nx, ny, nz, 0.7)
                    vel(rnd(0.3, 1.1) * sc)
                    S.drag = 0.7
                    S.grav = -0.15
                    S.life = rnd(2.5, 4.2)
                    S.s0 = 0.4 * sc
                    S.s1 = rnd(1.8, 3) * sc
                    S.alpha = 0.45
                    S.fadeIn = 0.12
                    S.fadePow = 2
                    S.spin = rnd(-0.4, 0.4)
                    S.shape = SHAPE.smoke
                    S.c0.copy(custom ?? PRESET_COLORS.smoke0)
                    S.c1.copy(PRESET_COLORS.smoke1)
                    emit(alpha)
                }
                break
            }
            case 'explosion': {
                // flash core
                base(px, py, pz, floor)
                S.life = 0.14
                S.s0 = 3.4 * sc
                S.s1 = 1.6 * sc
                S.shape = SHAPE.glow
                S.c0.copy(PRESET_COLORS.flash)
                S.c1.copy(PRESET_COLORS.fire1)
                emit(add)
                // fireball
                for (let i = 0, c = cnt(16); i < c; i++) {
                    base(px, py + 0.2, pz, floor)
                    cone(0, 1, 0, 1.6)
                    vel(rnd(1.5, 6.5) * sc)
                    S.drag = 4.5
                    S.grav = -1.2
                    S.life = rnd(0.35, 0.75)
                    S.s0 = 0.5 * sc
                    S.s1 = rnd(1.4, 2.4) * sc
                    S.fadePow = 2
                    S.spin = rnd(-2, 2)
                    S.shape = SHAPE.smoke
                    S.c0.copy(custom ?? PRESET_COLORS.fire0)
                    S.c1.copy(PRESET_COLORS.fire1)
                    emit(add)
                }
                // shock ring
                base(px, py + 0.3, pz, floor)
                S.life = 0.38
                S.s0 = 0.6 * sc
                S.s1 = 7 * sc
                S.alpha = 0.7
                S.fadePow = 2
                S.shape = SHAPE.ring
                S.c0.copy(PRESET_COLORS.ring)
                S.c1.copy(PRESET_COLORS.fire1)
                emit(add)
                // sparks
                for (let i = 0, c = cnt(22); i < c; i++) {
                    base(px, py + 0.2, pz, floor)
                    cone(0, 1, 0, 1.3)
                    vel(rnd(5, 16) * sc)
                    S.grav = 9.8
                    S.drag = 0.9
                    S.bounce = 0.3
                    S.life = rnd(0.4, 1.1)
                    S.s0 = S.s1 = rnd(0.012, 0.025)
                    S.stretch = 0.03
                    S.shape = SHAPE.streak
                    S.c0.copy(PRESET_COLORS.spark0)
                    S.c1.copy(PRESET_COLORS.spark1)
                    emit(add)
                }
                // debris
                for (let i = 0, c = cnt(18); i < c; i++) {
                    base(px, py + 0.2, pz, floor)
                    cone(0, 1, 0, 1.1)
                    vel(rnd(4, 12) * sc)
                    S.grav = 12
                    S.drag = 0.2
                    S.bounce = 0.3
                    S.life = rnd(1.2, 2.4)
                    S.s0 = S.s1 = rnd(0.04, 0.12) * sc
                    S.spin = rnd(-16, 16)
                    S.fadePow = 0.5
                    S.shape = SHAPE.chunk
                    S.c0.copy(PRESET_COLORS.debris)
                    S.c1.copy(PRESET_COLORS.debris)
                    emit(alpha)
                }
                // lingering smoke column, fading in after the fireball
                for (let i = 0, c = cnt(10); i < c; i++) {
                    base(px + rnd(-0.6, 0.6) * sc, py + rnd(0.1, 0.8) * sc, pz + rnd(-0.6, 0.6) * sc, floor)
                    cone(0, 1, 0, 0.9)
                    vel(rnd(0.6, 2.2) * sc)
                    S.drag = 1.1
                    S.grav = -0.25
                    S.life = rnd(2.8, 4.8)
                    S.s0 = 0.8 * sc
                    S.s1 = rnd(2.6, 4) * sc
                    S.alpha = 0.55
                    S.fadeIn = 0.14
                    S.fadePow = 2
                    S.spin = rnd(-0.5, 0.5)
                    S.shape = SHAPE.smoke
                    S.c0.copy(PRESET_COLORS.smoke1)
                    S.c1.copy(PRESET_COLORS.smoke1)
                    emit(alpha)
                }
                // a low ring of dust rolling outward along the ground
                for (let i = 0, c = cnt(14); i < c; i++) {
                    const a = (i / c) * Math.PI * 2
                    base(px, Math.max(floor, py - 0.2) + 0.15, pz, floor)
                    S.vx = Math.cos(a) * rnd(4, 6) * sc
                    S.vz = Math.sin(a) * rnd(4, 6) * sc
                    S.vy = 0.3
                    S.drag = 2.2
                    S.life = rnd(1.2, 2)
                    S.s0 = 0.5 * sc
                    S.s1 = rnd(1.6, 2.4) * sc
                    S.alpha = 0.4
                    S.fadePow = 2
                    S.shape = SHAPE.smoke
                    S.c0.copy(PRESET_COLORS.dust0)
                    S.c1.copy(PRESET_COLORS.dust1)
                    emit(alpha)
                }
                flash(pos, 0xffa050, 60 * sc, 0.45)
                camera.getWorldPosition(camPos)
                const d = Math.sqrt((camPos.x - px) ** 2 + (camPos.y - py) ** 2 + (camPos.z - pz) ** 2)
                const k = Math.max(0, 1 - d / (22 * Math.max(0.6, sc)))
                if (k > 0) trauma = Math.min(1, trauma + 0.75 * k * k)
                break
            }
            case 'electric': {
                for (let i = 0, c = cnt(14); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 1.4)
                    vel(rnd(3, 9) * sc)
                    S.drag = 3
                    S.grav = 2
                    S.life = rnd(0.08, 0.26)
                    S.s0 = S.s1 = rnd(0.008, 0.014)
                    S.stretch = 0.03
                    S.shape = SHAPE.streak
                    S.c0.copy(custom ?? PRESET_COLORS.elec0)
                    S.c1.copy(PRESET_COLORS.elec1)
                    emit(add)
                }
                base(px, py, pz, floor)
                S.life = 0.12
                S.s0 = 0.7 * sc
                S.s1 = 0.4 * sc
                S.alpha = 0.8
                S.shape = SHAPE.glow
                S.c0.copy(PRESET_COLORS.elec0)
                S.c1.copy(PRESET_COLORS.elec1)
                emit(add)
                const boltColor = custom ?? PRESET_COLORS.elec0
                for (let i = 0; i < (high ? 3 : 1); i++) {
                    cone(nx, ny, nz, 1.6)
                    const l = rnd(0.5, 1.3) * sc
                    tmpV.set(px + dir.x * l, py + dir.y * l, pz + dir.z * l)
                    lightningImpl(pos, tmpV, boltColor, 0.16, 0.6)
                }
                flash(pos, 0x8ab8ff, 8 * sc, 0.12)
                break
            }
            case 'ray': {
                // A custom colour (X-Ray Pack-a-Punch tiers) tints every layer.
                const ray0 = custom ?? PRESET_COLORS.ray0
                const ray1 = custom ? userTail.copy(custom).multiplyScalar(0.4) : PRESET_COLORS.ray1
                base(px, py, pz, floor)
                S.life = 0.16
                S.s0 = 0.9 * sc
                S.s1 = 0.4 * sc
                S.shape = SHAPE.glow
                S.c0.copy(ray0)
                S.c1.copy(ray1)
                emit(add)
                base(px, py, pz, floor)
                S.life = 0.3
                S.s0 = 0.2 * sc
                S.s1 = 2.4 * sc
                S.alpha = 0.6
                S.fadePow = 2
                S.shape = SHAPE.ring
                S.c0.copy(ray0)
                S.c1.copy(ray1)
                emit(add)
                for (let i = 0, c = cnt(18); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 1.3)
                    vel(rnd(2, 8) * sc)
                    S.drag = 2
                    S.grav = 3
                    S.life = rnd(0.2, 0.55)
                    S.s0 = S.s1 = rnd(0.01, 0.02)
                    S.stretch = 0.03
                    S.shape = SHAPE.streak
                    S.c0.copy(ray0)
                    S.c1.copy(ray1)
                    emit(add)
                }
                for (let i = 0, c = cnt(6); i < c; i++) {
                    base(px, py, pz, floor)
                    cone(nx, ny, nz, 1)
                    vel(rnd(0.3, 1.2) * sc)
                    S.drag = 2.5
                    S.grav = -0.4
                    S.life = rnd(0.5, 0.9)
                    S.s0 = 0.15 * sc
                    S.s1 = rnd(0.6, 1) * sc
                    S.alpha = 0.35
                    S.fadePow = 2
                    S.shape = SHAPE.smoke
                    S.c0.copy(ray1)
                    S.c1.copy(ray1)
                    emit(add)
                }
                flash(pos, custom ?? 0x50ff70, 12 * sc, 0.25)
                break
            }
            case 'pap': {
                for (let i = 0, c = cnt(20); i < c; i++) {
                    base(px + rnd(-0.2, 0.2) * sc, py, pz + rnd(-0.2, 0.2) * sc, floor)
                    cone(nx, ny, nz, 1.1)
                    vel(rnd(0.6, 2.6) * sc)
                    S.drag = 1.6
                    S.grav = -0.6
                    S.life = rnd(0.6, 1.3)
                    S.s0 = S.s1 = rnd(0.012, 0.03)
                    S.stretch = 0.05
                    S.shape = SHAPE.streak
                    S.c0.copy(custom ?? PRESET_COLORS.pap0)
                    S.c1.copy(PRESET_COLORS.pap1)
                    emit(add)
                }
                for (let i = 0, c = cnt(6); i < c; i++) {
                    base(px + rnd(-0.25, 0.25) * sc, py + rnd(-0.1, 0.3), pz + rnd(-0.25, 0.25) * sc, floor)
                    S.vy = rnd(0.2, 0.6)
                    S.life = rnd(0.5, 1)
                    S.s0 = 0.06
                    S.s1 = 0.02
                    S.shape = SHAPE.twinkle
                    S.c0.copy(PRESET_COLORS.pap0)
                    S.c1.copy(PRESET_COLORS.pap1)
                    emit(add)
                }
                break
            }
            case 'powerup': {
                for (let i = 0, c = cnt(12); i < c; i++) {
                    const a = Math.random() * Math.PI * 2
                    const r = rnd(0.1, 0.45) * sc
                    base(px + Math.cos(a) * r, py + rnd(-0.2, 0.3), pz + Math.sin(a) * r, floor)
                    S.vx = -Math.sin(a) * 0.4
                    S.vz = Math.cos(a) * 0.4
                    S.vy = rnd(0.3, 0.9)
                    S.drag = 0.6
                    S.life = rnd(0.8, 1.6)
                    S.s0 = rnd(0.03, 0.07) * sc
                    S.s1 = 0.01
                    S.fadeIn = 0.2
                    S.shape = SHAPE.twinkle
                    S.c0.copy(custom ?? PRESET_COLORS.gold0)
                    S.c1.copy(PRESET_COLORS.gold1)
                    emit(add)
                }
                break
            }
            case 'gas': {
                for (let i = 0, c = cnt(7); i < c; i++) {
                    base(px + rnd(-0.6, 0.6) * sc, py + rnd(0, 0.6), pz + rnd(-0.6, 0.6) * sc, floor)
                    cone(0, 1, 0, 1.4)
                    vel(rnd(0.2, 0.8) * sc)
                    S.vy *= 0.4
                    S.drag = 0.8
                    S.grav = -0.05
                    S.life = rnd(2, 3.6)
                    S.s0 = 0.5 * sc
                    S.s1 = rnd(1.8, 2.8) * sc
                    S.alpha = 0.38
                    S.fadeIn = 0.15
                    S.fadePow = 2
                    S.spin = rnd(-0.4, 0.4)
                    S.shape = SHAPE.smoke
                    S.c0.copy(custom ?? PRESET_COLORS.gas0)
                    S.c1.copy(PRESET_COLORS.gas1)
                    emit(alpha)
                }
                break
            }
            case 'soul': {
                for (let i = 0, c = cnt(10); i < c; i++) {
                    const a = (i / c) * Math.PI * 2
                    base(px + Math.cos(a) * 0.15, py + rnd(0, 0.4), pz + Math.sin(a) * 0.15, floor)
                    S.vx = -Math.sin(a) * 0.9
                    S.vz = Math.cos(a) * 0.9
                    S.vy = rnd(0.8, 1.8)
                    S.drag = 1.2
                    S.life = rnd(0.6, 1.1)
                    S.s0 = rnd(0.08, 0.14) * sc
                    S.s1 = 0.02
                    S.fadeIn = 0.1
                    S.shape = SHAPE.glow
                    S.c0.copy(custom ?? PRESET_COLORS.soul0)
                    S.c1.copy(PRESET_COLORS.soul1)
                    emit(add)
                }
                break
            }
            case 'embers': {
                for (let i = 0, c = cnt(10); i < c; i++) {
                    base(px + rnd(-0.3, 0.3) * sc, py, pz + rnd(-0.3, 0.3) * sc, floor)
                    cone(0, 1, 0, 0.7)
                    vel(rnd(0.5, 1.8) * sc)
                    S.drag = 0.8
                    S.grav = -0.4
                    S.life = rnd(1, 2.6)
                    S.s0 = S.s1 = rnd(0.012, 0.03)
                    S.spin = rnd(-3, 3)
                    S.fadeIn = 0.1
                    S.shape = SHAPE.twinkle
                    S.c0.copy(custom ?? PRESET_COLORS.ember0)
                    S.c1.copy(PRESET_COLORS.ember1)
                    emit(add)
                }
                break
            }
        }
    }

    function tracer(from: V3, to: V3, color?: THREE.ColorRepresentation): void {
        const t = tracers[tracerNext]!
        tracerNext = (tracerNext + 1) % tracers.length
        const dx = to.x - from.x
        const dy = to.y - from.y
        const dz = to.z - from.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < 0.3) return
        t.alive = true
        t.ax = from.x
        t.ay = from.y
        t.az = from.z
        t.dx = dx / dist
        t.dy = dy / dist
        t.dz = dz / dist
        t.dist = dist
        t.head = 0
        t.speed = 320
        t.len = Math.min(7, dist * 0.6)
        userColor.set(color ?? 0xffc26a)
        t.r = userColor.r * 3.2
        t.g = userColor.g * 3.2
        t.b = userColor.b * 3.2
    }

    function genBolt(b: Bolt): void {
        const { a, b: e, segs, widths } = b
        const dx = e.x - a.x
        const dy = e.y - a.y
        const dz = e.z - a.z
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        // two perpendiculars
        tmpN.set(dx / len, dy / len, dz / len)
        tmpV.set(Math.abs(tmpN.y) < 0.9 ? 0 : 1, Math.abs(tmpN.y) < 0.9 ? 1 : 0, 0).cross(tmpN).normalize()
        const p1x = tmpV.x
        const p1y = tmpV.y
        const p1z = tmpV.z
        tmpS.copy(tmpN).cross(tmpV)
        const p2x = tmpS.x
        const p2y = tmpS.y
        const p2z = tmpS.z
        const steps = Math.min(22, Math.max(6, Math.round(len * 2.5)))
        const amp = len * 0.07 + 0.04
        let o1 = 0
        let o2 = 0
        let lx = a.x
        let ly = a.y
        let lz = a.z
        let n = 0
        for (let i = 1; i <= steps; i++) {
            const t = i / steps
            o1 = o1 * 0.45 + (Math.random() * 2 - 1) * amp
            o2 = o2 * 0.45 + (Math.random() * 2 - 1) * amp
            const pin = i === steps ? 0 : Math.sin(Math.PI * t)
            const x = a.x + dx * t + (p1x * o1 + p2x * o2) * pin
            const y = a.y + dy * t + (p1y * o1 + p2y * o2) * pin
            const z = a.z + dz * t + (p1z * o1 + p2z * o2) * pin
            segs[n * 6] = lx
            segs[n * 6 + 1] = ly
            segs[n * 6 + 2] = lz
            segs[n * 6 + 3] = x
            segs[n * 6 + 4] = y
            segs[n * 6 + 5] = z
            // Long bolts (sky strikes, mast-to-generator arcs) get thicker so they read at range.
            widths[n] = 0.022 + Math.min(0.1, len * 0.0022)
            n++
            // forks
            if (i < steps - 1 && n < BOLT_MAX - 6 && Math.random() < 0.18) {
                let bx = x
                let by = y
                let bz = z
                const fl = len * rnd(0.08, 0.2)
                const fdx = dx / len + (Math.random() * 2 - 1) * 0.9
                const fdy = dy / len + (Math.random() * 2 - 1) * 0.9
                const fdz = dz / len + (Math.random() * 2 - 1) * 0.9
                const fll = Math.sqrt(fdx * fdx + fdy * fdy + fdz * fdz) || 1
                for (let k = 0; k < 4 && n < BOLT_MAX; k++) {
                    const nx2 = bx + (fdx / fll) * fl / 4 + (Math.random() - 0.5) * fl * 0.3
                    const ny2 = by + (fdy / fll) * fl / 4 + (Math.random() - 0.5) * fl * 0.3
                    const nz2 = bz + (fdz / fll) * fl / 4 + (Math.random() - 0.5) * fl * 0.3
                    segs[n * 6] = bx
                    segs[n * 6 + 1] = by
                    segs[n * 6 + 2] = bz
                    segs[n * 6 + 3] = nx2
                    segs[n * 6 + 4] = ny2
                    segs[n * 6 + 5] = nz2
                    widths[n] = (0.012 + Math.min(0.05, len * 0.001)) * (1 - k / 5)
                    n++
                    bx = nx2
                    by = ny2
                    bz = nz2
                }
            }
            if (n >= BOLT_MAX) break
            lx = x
            ly = y
            lz = z
        }
        b.n = n
    }

    function lightningImpl(from: V3, to: V3, color: THREE.ColorRepresentation | THREE.Color, life: number, intensity: number): void {
        const b = bolts[boltNext]!
        boltNext = (boltNext + 1) % bolts.length
        b.alive = true
        b.age = 0
        b.life = life
        b.jitter = 0
        b.a.set(from.x, from.y, from.z)
        b.b.set(to.x, to.y, to.z)
        b.color.set(color).multiplyScalar(intensity * 3)
        genBolt(b)
    }

    function lightning(from: V3, to: V3, color?: THREE.ColorRepresentation): void {
        lightningImpl(from, to, color ?? 0x9fd0ff, 0.3, 1)
        if (high) lightningImpl(from, to, color ?? 0x9fd0ff, 0.22, 0.45)
        tmpV.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
        flash(tmpV, color ?? 0x9fd0ff, 14, 0.18)
    }

    function decal(pos: V3, normal: V3, kind: 'bullet' | 'scorch' | 'blood', scale = 1): void {
        const i = decalNext
        decalNext = (decalNext + 1) % DECALS
        if (decals.count < DECALS) decals.count = Math.max(decals.count, i + 1)
        tmpN.set(normal.x, normal.y, normal.z)
        if (tmpN.lengthSq() < 1e-6) tmpN.set(0, 1, 0)
        tmpN.normalize()
        tmpQ.setFromUnitVectors(Z, tmpN)
        tmpQ2.setFromAxisAngle(Z, Math.random() * Math.PI * 2)
        tmpQ.multiply(tmpQ2)
        const size = (kind === 'bullet' ? rnd(0.07, 0.1) : kind === 'scorch' ? rnd(2, 2.8) : rnd(0.5, 1.1)) * scale
        tmpS.set(size, size, size)
        tmpV.set(pos.x + tmpN.x * 0.012, pos.y + tmpN.y * 0.012, pos.z + tmpN.z * 0.012)
        tmpM.compose(tmpV, tmpQ, tmpS)
        decals.setMatrixAt(i, tmpM)
        decals.instanceMatrix.needsUpdate = true
        const tiles = DECAL_TILES[kind]
        const tile = tiles[Math.floor(Math.random() * tiles.length)]!
        const arr = decalAttr.array as Float32Array
        arr[i * 3] = tile % 4
        arr[i * 3 + 1] = 1 - Math.floor(tile / 4)
        arr[i * 3 + 2] = 1
        decalAge[i] = 0
        decalLife[i] = DECAL_LIFE[kind]
        decalAttr.needsUpdate = true
    }

    function update(dt: number, t: number): void {
        time = t
        shared.uTime.value = t % 1000
        add.update(dt)
        alpha.update(dt)

        segs.begin()
        for (const tr of tracers) {
            if (!tr.alive) continue
            tr.head += tr.speed * dt
            const tail = tr.head - tr.len
            if (tail >= tr.dist) {
                tr.alive = false
                continue
            }
            const h = Math.min(tr.head, tr.dist)
            const s = Math.max(0, tail)
            const fade = tr.head > tr.dist ? Math.max(0, 1 - (tr.head - tr.dist) / tr.len) : 1
            segs.push(
                tr.ax + tr.dx * s, tr.ay + tr.dy * s, tr.az + tr.dz * s,
                tr.ax + tr.dx * h, tr.ay + tr.dy * h, tr.az + tr.dz * h,
                tr.r, tr.g, tr.b, 0.9 * fade, 0.012, 0.95
            )
        }
        for (const b of bolts) {
            if (!b.alive) continue
            b.age += dt
            if (b.age >= b.life) {
                b.alive = false
                continue
            }
            b.jitter -= dt
            if (b.jitter <= 0) {
                b.jitter = 0.045
                genBolt(b)
            }
            const k = 1 - b.age / b.life
            const flicker = 0.6 + Math.random() * 0.4
            const a = k * flicker
            for (let i = 0; i < b.n; i++) {
                const o = i * 6
                segs.push(b.segs[o]!, b.segs[o + 1]!, b.segs[o + 2]!, b.segs[o + 3]!, b.segs[o + 4]!, b.segs[o + 5]!, b.color.r, b.color.g, b.color.b, a, b.widths[i]!, 0)
            }
        }
        segs.end()

        // decals fade over their last seconds
        if (decals.count > 0) {
            const arr = decalAttr.array as Float32Array
            let dirty = false
            for (let i = 0; i < decals.count; i++) {
                if (arr[i * 3 + 2]! <= 0) continue
                decalAge[i] = decalAge[i]! + dt
                const left = decalLife[i]! - decalAge[i]!
                const op = left <= 0 ? 0 : Math.min(1, left / 4)
                if (op !== arr[i * 3 + 2]) {
                    arr[i * 3 + 2] = op
                    dirty = true
                }
            }
            if (dirty) decalAttr.needsUpdate = true
        }

        for (const l of lights) {
            if (l.age >= l.life) {
                if (l.light.intensity !== 0) l.light.intensity = 0
                continue
            }
            l.age += dt
            const k = Math.max(0, 1 - l.age / l.life)
            l.light.intensity = l.peak * k * k
        }

        // noise-based shake from trauma
        trauma = Math.max(0, trauma - dt * 1.3)
        const s = trauma * trauma
        const tt = time * 23
        shakeYaw = s * 0.045 * (Math.sin(tt * 1.13) * 0.6 + Math.sin(tt * 2.71 + 1.3) * 0.4)
        shakePitch = s * 0.04 * (Math.sin(tt * 1.37 + 2.1) * 0.6 + Math.sin(tt * 3.07 + 0.4) * 0.4)
        shakeRoll = s * 0.035 * (Math.sin(tt * 0.91 + 4.2) * 0.6 + Math.sin(tt * 2.33 + 2.7) * 0.4)
    }

    return {
        burst,
        tracer,
        lightning,
        decal,
        flash,
        shake(amount: number) {
            trauma = Math.min(1, trauma + Math.max(0, amount))
        },
        update,
        setGround(fn) {
            ground = fn
        },
        resize(bufferHeight, pr) {
            pixelRatio = pr
            shared.uMinPx.value = 1.6 * Math.max(1, pixelRatio)
            const cam = camera as THREE.PerspectiveCamera
            shared.uPxScale.value = bufferHeight * 0.5 * (cam.projectionMatrix?.elements[5] ?? 1.7)
            shared.uRes.value.set(bufferHeight * ((cam.aspect ?? 1.77)), bufferHeight)
        },
        get shakeYaw() {
            return shakeYaw
        },
        get shakePitch() {
            return shakePitch
        },
        get shakeRoll() {
            return shakeRoll
        },
        dispose() {
            scene.remove(add.mesh, alpha.mesh, segs.mesh, decals)
            add.dispose()
            alpha.dispose()
            segs.dispose()
            decalGeo.dispose()
            decalMat.dispose()
            atlas.dispose()
            decals.dispose()
            for (const l of lights) {
                scene.remove(l.light)
                l.light.dispose()
            }
        }
    }
}
