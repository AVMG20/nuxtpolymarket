// Call of Xeno — pooled visual effects.
//
// Everything here is allocated once in the constructor and recycled. A round
// 30 firefight must not create or dispose meshes, materials or typed arrays.
// Each effect family renders through one or two draw calls:
//
//   glowStreaks   additive streak quads: sparks, tracers, arcs, acid droplets
//   dropStreaks   alpha-blended streak quads: blood droplets
//   smoke / glow / fire   instanced camera-facing sprites (procedural noise atlas)
//   rings         ground shockwave rings
//   holes / splats / scorch   pooled instanced decals
//   chunks / casings          instanced lit meshes with real floor bounces
//   dust / spores             GPU-driven point motes wrapped around the camera
//
// Streaks and points keep a minimum on-screen width (they dim by the area they
// gain), and every shader input that feeds a division or root is clamped, so a
// 1440p Windows monitor behaves like a Retina Mac.
//
// Colours are passed as hex (sRGB) and converted to linear once at spawn.
// Textures are generated with typed arrays (no canvas), so nothing here needs
// the DOM at import time.

import * as THREE from 'three'

const TAU = Math.PI * 2
const rr = (a: number, b: number) => a + Math.random() * (b - a) // cosmetic randomness only
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const smooth = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

/** Dark arterial red. */
export const ICHOR_RED = 0x8c0f14
/** Glowing xeno acid green. */
export const ICHOR_ACID = 0x7dff3a

const tmpColor = new THREE.Color()

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
    let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177)) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
}

function vnoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = x - ix
    const fy = y - iy
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const a = hash2(ix, iy, seed)
    const b = hash2(ix + 1, iy, seed)
    const c = hash2(ix, iy + 1, seed)
    const d = hash2(ix + 1, iy + 1, seed)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
    let amp = 0.5
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
        sum += amp * vnoise(x * freq, y * freq, seed + o * 17)
        norm += amp
        amp *= 0.5
        freq *= 2
    }
    return sum / norm
}

interface Px { r: number, g: number, b: number, a: number }
type PixelFn = (nx: number, ny: number, o: Px) => void

/** 2x2 atlas of `cell`-sized tiles, painted per pixel in [-1, 1] space. */
function buildAtlas(cell: number, factory: (index: number) => PixelFn): Uint8Array {
    const size = cell * 2
    const data = new Uint8Array(size * size * 4)
    const o: Px = { r: 0, g: 0, b: 0, a: 0 }
    for (let index = 0; index < 4; index++) {
        const fn = factory(index)
        const ox = (index % 2) * cell
        const oy = Math.floor(index / 2) * cell
        for (let y = 0; y < cell; y++) {
            for (let x = 0; x < cell; x++) {
                o.r = 0; o.g = 0; o.b = 0; o.a = 0
                fn(((x + 0.5) / cell) * 2 - 1, ((y + 0.5) / cell) * 2 - 1, o)
                const i = ((oy + y) * size + ox + x) * 4
                data[i] = clamp(o.r, 0, 1) * 255
                data[i + 1] = clamp(o.g, 0, 1) * 255
                data[i + 2] = clamp(o.b, 0, 1) * 255
                data[i + 3] = clamp(o.a, 0, 1) * 255
            }
        }
    }
    return data
}

function over(o: Px, r: number, g: number, b: number, a: number) {
    const oa = a + o.a * (1 - a)
    if (oa > 0.0001) {
        o.r = (r * a + o.r * o.a * (1 - a)) / oa
        o.g = (g * a + o.g * o.a * (1 - a)) / oa
        o.b = (b * a + o.b * o.a * (1 - a)) / oa
    }
    o.a = oa
}

const smokePaint = (index: number): PixelFn => {
    const off = index * 13.7
    return (nx, ny, o) => {
        const r = Math.hypot(nx, ny)
        const warp = fbm(nx * 1.6 + off, ny * 1.6 + off * 0.5, 11, 4)
        const dens = 1 - smooth(0.22, 0.98, r + (warp - 0.5) * 0.95)
        const detail = fbm(nx * 4.2 + off, ny * 4.2 + 7, 23, 3)
        const a = dens * (0.5 + 0.95 * detail) * (1 - smooth(0.82, 1, r))
        const lit = 0.5 + 0.5 * fbm(nx * 2.4 + off + 5, ny * 2.4, 37, 3)
        const shade = lit * (1 - 0.35 * r) + 0.18 * (-nx - ny) * 0.5
        o.r = shade
        o.g = shade
        o.b = shade
        o.a = a
    }
}

const splatPaint = (index: number): PixelFn => {
    const blobs: { x: number, y: number, r2: number }[] = [{ x: 0, y: 0, r2: 0 }]
    const main = rr(0.2, 0.28)
    blobs[0]!.r2 = main * main
    for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU
        const d = rr(0.05, 0.22)
        const r = rr(0.1, 0.19)
        blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r2: r * r })
    }
    for (let i = 0; i < 13; i++) {
        const a = Math.random() * TAU
        const d = rr(0.32, 0.86)
        const r = rr(0.02, 0.075) * (1.25 - d)
        blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r2: r * r })
        // A short tail behind some drops reads as a directional streak.
        if (Math.random() < 0.5) {
            const r2 = r * 0.6
            blobs.push({ x: Math.cos(a) * (d - r * 1.6), y: Math.sin(a) * (d - r * 1.6), r2: r2 * r2 })
        }
    }
    const seed = 50 + index * 9
    return (nx, ny, o) => {
        const r = Math.hypot(nx, ny)
        const wx = nx + (fbm(nx * 2.2 + index * 4, ny * 2.2, seed, 3) - 0.5) * 0.2
        const wy = ny + (fbm(nx * 2.2, ny * 2.2 + index * 4, seed + 1, 3) - 0.5) * 0.2
        let field = 0
        for (const blob of blobs) {
            const dx = wx - blob.x
            const dy = wy - blob.y
            field += blob.r2 / (dx * dx + dy * dy + 0.0006)
        }
        const a = smooth(0.85, 1.1, field) * (1 - smooth(0.9, 1, r))
        const shade = 0.72 + 0.4 * (1 - smooth(1, 3, field))
        o.r = shade
        o.g = shade
        o.b = shade
        o.a = a
    }
}

const holePaint = (index: number): PixelFn => {
    const cracks: { dx: number, dy: number, len: number }[] = []
    for (let i = 0; i < 5; i++) {
        const a = Math.random() * TAU
        cracks.push({ dx: Math.cos(a), dy: Math.sin(a), len: rr(0.22, 0.55) })
    }
    const seed = 71 + index * 5
    return (nx, ny, o) => {
        const r = Math.hypot(nx, ny)
        const ang = Math.atan2(ny, nx)
        const jag = vnoise(Math.cos(ang) * 2.2 + 5, Math.sin(ang) * 2.2 + 5, seed) - 0.5
        // soft dark smudge, pale chipped rim, hairline cracks, black hole
        over(o, 0.04, 0.04, 0.045, (1 - smooth(0.08, 0.98, r)) * 0.3)
        const rim = smooth(0.1, 0.14, r + jag * 0.05) * (1 - smooth(0.16, 0.36, r + jag * 0.16))
        over(o, 0.55, 0.53, 0.5, rim * 0.5)
        for (const c of cracks) {
            const proj = nx * c.dx + ny * c.dy
            if (proj > 0.06 && proj < c.len) {
                const perp = Math.abs(nx * c.dy - ny * c.dx)
                over(o, 0.03, 0.03, 0.03, (1 - smooth(0.006, 0.02, perp)) * 0.55 * (1 - proj / c.len))
            }
        }
        over(o, 0.008, 0.008, 0.01, 1 - smooth(0.07, 0.115, r + jag * 0.035))
        o.a *= 1 - smooth(0.9, 1, r)
    }
}

const scorchPaint = (index: number): PixelFn => {
    const off = index * 5
    return (nx, ny, o) => {
        const r = Math.hypot(nx, ny)
        const ang = Math.atan2(ny, nx)
        const n = fbm(nx * 2.4 + off, ny * 2.4, 90, 4)
        const rad = r + (n - 0.5) * 0.6
        let a = 1 - smooth(0.05, 0.95, rad)
        a = a * a * (0.7 + 0.6 * vnoise(ang * 3 + off, 4, 95))
        o.r = 0.03 + 0.03 * n
        o.g = 0.028 + 0.025 * n
        o.b = 0.03
        o.a = a * (1 - smooth(0.9, 1, r))
    }
}

const atlasData: Record<string, Uint8Array> = {}

function atlasTexture(key: string, cell: number, factory: (index: number) => PixelFn): THREE.DataTexture {
    if (!atlasData[key]) atlasData[key] = buildAtlas(cell, factory)
    const size = cell * 2
    const texture = new THREE.DataTexture(atlasData[key]!, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
}

// ---------------------------------------------------------------------------
// Shared environment + helpers
// ---------------------------------------------------------------------------

interface Env {
    groundAt: ((x: number, z: number, y: number) => number) | null
}

const floorOf = (env: Env, x: number, z: number, y: number) => (env.groundAt ? env.groundAt(x, z, y) : 0)

const sizeScratch = new THREE.Vector2()

/** Streaks and points size themselves in pixels, so they need the target height. */
function bindViewport(object: THREE.Object3D, uniform: THREE.IUniform<number>) {
    object.onBeforeRender = (renderer) => {
        const target = renderer.getRenderTarget()
        uniform.value = target ? target.height : renderer.getDrawingBufferSize(sizeScratch).y
    }
}

const fogUniforms = () => THREE.UniformsUtils.merge([THREE.UniformsLib.fog])

// ---------------------------------------------------------------------------
// Sprite billboards (smoke / glow / fire)
// ---------------------------------------------------------------------------

const BILLBOARD_VERT = /* glsl */`
    attribute vec4 iPos;
    attribute vec4 iCol;
    attribute vec4 iAux;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying vec4 vCol;
    varying vec2 vAux;
    varying float vNear;
    #include <fog_pars_vertex>
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);
        float c = cos(iAux.x);
        float s = sin(iAux.x);
        vec2 q = position.xy;
        mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iPos.w;
        gl_Position = projectionMatrix * mvPosition;
        vec2 origin = vec2(mod(iAux.y, 2.0), floor(iAux.y / 2.0)) * 0.5;
        vUv = origin + (uv * 0.94 + 0.03) * 0.5;
        vLocal = q * 2.0;
        vCol = iCol;
        vAux = iAux.zw;
        vNear = smoothstep(0.12, 0.8, -mvPosition.z);
        #include <fog_vertex>
    }
`

const SMOKE_FRAG = /* glsl */`
    uniform sampler2D map;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying vec4 vCol;
    varying vec2 vAux;
    varying float vNear;
    #include <fog_pars_fragment>
    void main() {
        vec4 t = texture2D(map, vUv);
        float a = t.a * vCol.a * vNear;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol.rgb * (0.45 + 0.9 * t.r), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
    }
`

const GLOW_FRAG = /* glsl */`
    uniform sampler2D map;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying vec4 vCol;
    varying vec2 vAux;
    varying float vNear;
    #include <fog_pars_fragment>
    void main() {
        vec4 t = texture2D(map, vUv);
        float d = min(length(vLocal), 1.0);
        float shape = (1.0 - d);
        shape = shape * shape * (0.8 + 0.4 * t.r);
        float a = shape * vCol.a * vNear;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol.rgb * vAux.y, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`

const FIRE_FRAG = /* glsl */`
    uniform sampler2D map;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying vec4 vCol;
    varying vec2 vAux;
    varying float vNear;
    #include <fog_pars_fragment>
    void main() {
        vec4 t = texture2D(map, vUv);
        float k = clamp(vAux.x, 0.0, 1.0);
        float heat = t.a * (0.25 + 1.15 * k);
        float a = smoothstep(0.06, 0.4, t.a * (0.35 + 0.9 * k)) * vCol.a * vNear;
        if (a < 0.004) discard;
        vec3 hot = vec3(1.0, 0.93, 0.75);
        vec3 col = mix(vCol.rgb * 0.25, vCol.rgb, smoothstep(0.1, 0.55, heat));
        col = mix(col, hot, smoothstep(0.6, 1.0, heat));
        col *= (0.5 + 2.0 * heat) * vAux.y;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`

type BillboardKind = 'smoke' | 'glow' | 'fire'

interface BillboardSpawn {
    x: number, y: number, z: number
    vx?: number, vy?: number, vz?: number
    size: number
    /** End size. Defaults to `size`. */
    size2?: number
    life: number
    r: number, g: number, b: number
    /** End colour. Defaults to the start colour. */
    r2?: number, g2?: number, b2?: number
    alpha?: number
    hdr?: number
    gravity?: number
    drag?: number
    spin?: number
}

interface BillboardItem {
    life: number, maxLife: number
    x: number, y: number, z: number
    vx: number, vy: number, vz: number
    size: number, size2: number
    r: number, g: number, b: number
    r2: number, g2: number, b2: number
    alpha: number, hdr: number
    gravity: number, drag: number
    rot: number, spin: number, cell: number
}

class BillboardPool {
    readonly mesh: THREE.Mesh
    /** Constant drift applied to every particle (smoke follows the draft). */
    windX = 0
    windZ = 0
    private geometry: THREE.InstancedBufferGeometry
    private material: THREE.ShaderMaterial
    private items: BillboardItem[]
    private cursor = 0
    private aPos: THREE.InstancedBufferAttribute
    private aCol: THREE.InstancedBufferAttribute
    private aAux: THREE.InstancedBufferAttribute
    private holdUntil: number

    constructor(count: number, texture: THREE.Texture, kind: BillboardKind) {
        this.items = Array.from({ length: count }, () => ({
            life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, size2: 1,
            r: 1, g: 1, b: 1, r2: 1, g2: 1, b2: 1, alpha: 1, hdr: 1, gravity: 0, drag: 0, rot: 0, spin: 0, cell: 0
        }))
        // Smoke lingers at full density before thinning; flares and fire go out immediately.
        this.holdUntil = kind === 'smoke' ? 0.35 : kind === 'fire' ? 0.2 : 0

        this.geometry = new THREE.InstancedBufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3))
        this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
        this.geometry.setIndex([0, 1, 2, 0, 2, 3])
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
        this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
        this.aAux = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
        for (const attr of [this.aPos, this.aCol, this.aAux]) attr.setUsage(THREE.DynamicDrawUsage)
        this.geometry.setAttribute('iPos', this.aPos)
        this.geometry.setAttribute('iCol', this.aCol)
        this.geometry.setAttribute('iAux', this.aAux)
        this.geometry.instanceCount = 0

        this.material = new THREE.ShaderMaterial({
            uniforms: { ...fogUniforms(), map: { value: texture } },
            vertexShader: BILLBOARD_VERT,
            fragmentShader: kind === 'smoke' ? SMOKE_FRAG : kind === 'glow' ? GLOW_FRAG : FIRE_FRAG,
            transparent: true,
            depthWrite: false,
            blending: kind === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
            fog: kind === 'smoke',
            side: THREE.DoubleSide
        })
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.frustumCulled = false
        this.mesh.visible = false
    }

    spawn(o: BillboardSpawn) {
        const it = this.items[this.cursor]!
        this.cursor = (this.cursor + 1) % this.items.length
        it.life = o.life
        it.maxLife = o.life
        it.x = o.x; it.y = o.y; it.z = o.z
        it.vx = o.vx ?? 0; it.vy = o.vy ?? 0; it.vz = o.vz ?? 0
        it.size = o.size
        it.size2 = o.size2 ?? o.size
        it.r = o.r; it.g = o.g; it.b = o.b
        it.r2 = o.r2 ?? o.r; it.g2 = o.g2 ?? o.g; it.b2 = o.b2 ?? o.b
        it.alpha = o.alpha ?? 1
        it.hdr = o.hdr ?? 1
        it.gravity = o.gravity ?? 0
        it.drag = o.drag ?? 0
        it.rot = Math.random() * TAU
        it.spin = o.spin ?? rr(-0.6, 0.6)
        it.cell = Math.floor(Math.random() * 4)
    }

    update(dt: number) {
        let n = 0
        const pos = this.aPos.array as Float32Array
        const col = this.aCol.array as Float32Array
        const aux = this.aAux.array as Float32Array
        for (const it of this.items) {
            if (it.life <= 0) continue
            it.life -= dt
            if (it.life <= 0) continue
            it.vy -= it.gravity * dt
            const damp = Math.max(0, 1 - it.drag * dt)
            it.vx *= damp
            it.vy *= damp
            it.vz *= damp
            it.x += (it.vx + this.windX) * dt
            it.y += it.vy * dt
            it.z += (it.vz + this.windZ) * dt
            it.rot += it.spin * dt

            const k = clamp(it.life / it.maxLife, 0, 1)
            const t = 1 - k
            const grow = 1 - k * k
            const fadeIn = smooth(0, 0.1, t)
            const fadeOut = this.holdUntil > 0
                ? 1 - smooth(this.holdUntil, 1, t)
                : k * k
            const alpha = it.alpha * fadeIn * fadeOut
            const mix = smooth(0, 0.6, t)
            const i4 = n * 4
            pos[i4] = it.x
            pos[i4 + 1] = it.y
            pos[i4 + 2] = it.z
            pos[i4 + 3] = it.size + (it.size2 - it.size) * grow
            col[i4] = it.r + (it.r2 - it.r) * mix
            col[i4 + 1] = it.g + (it.g2 - it.g) * mix
            col[i4 + 2] = it.b + (it.b2 - it.b) * mix
            col[i4 + 3] = alpha
            aux[i4] = it.rot
            aux[i4 + 1] = it.cell
            aux[i4 + 2] = k
            aux[i4 + 3] = it.hdr
            n++
        }
        this.commit(n)
    }

    private commit(n: number) {
        this.geometry.instanceCount = n
        this.mesh.visible = n > 0
        if (n === 0) return
        for (const attr of [this.aPos, this.aCol, this.aAux]) {
            attr.clearUpdateRanges()
            attr.addUpdateRange(0, n * 4)
            attr.needsUpdate = true
        }
    }

    clear() {
        for (const it of this.items) it.life = 0
        this.commit(0)
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
    }
}

// ---------------------------------------------------------------------------
// Ground shockwave rings
// ---------------------------------------------------------------------------

const RING_VERT = /* glsl */`
    attribute vec4 iPos;
    attribute vec4 iCol;
    attribute vec4 iAux;
    varying vec2 vLocal;
    varying vec4 vCol;
    varying float vThick;
    void main() {
        vec3 world = iPos.xyz + vec3(position.x, 0.0, position.y) * 2.0 * iPos.w;
        vLocal = position.xy * 2.0;
        vCol = iCol;
        vThick = iAux.x;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
`

const RING_FRAG = /* glsl */`
    varying vec2 vLocal;
    varying vec4 vCol;
    varying float vThick;
    void main() {
        float r = length(vLocal);
        if (r >= 1.0) discard;
        float th = clamp(vThick, 0.03, 0.6);
        float ring = smoothstep(1.0 - th, 1.0 - th * 0.2, r) * (1.0 - smoothstep(1.0 - th * 0.15, 1.0, r));
        float disc = 1.0 - r;
        disc = disc * disc * 0.12;
        gl_FragColor = vec4(vCol.rgb * (ring * 2.2 + disc), vCol.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`

interface RingItem { life: number, maxLife: number, x: number, y: number, z: number, radius: number, r: number, g: number, b: number }

class RingPool {
    readonly mesh: THREE.Mesh
    private geometry: THREE.InstancedBufferGeometry
    private material: THREE.ShaderMaterial
    private items: RingItem[]
    private cursor = 0
    private aPos: THREE.InstancedBufferAttribute
    private aCol: THREE.InstancedBufferAttribute
    private aAux: THREE.InstancedBufferAttribute

    constructor(count: number) {
        this.items = Array.from({ length: count }, () => ({ life: 0, maxLife: 1, x: 0, y: 0, z: 0, radius: 1, r: 1, g: 1, b: 1 }))
        this.geometry = new THREE.InstancedBufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3))
        this.geometry.setIndex([0, 1, 2, 0, 2, 3])
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
        this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
        this.aAux = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
        this.geometry.setAttribute('iPos', this.aPos)
        this.geometry.setAttribute('iCol', this.aCol)
        this.geometry.setAttribute('iAux', this.aAux)
        this.geometry.instanceCount = 0
        this.material = new THREE.ShaderMaterial({
            vertexShader: RING_VERT,
            fragmentShader: RING_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.frustumCulled = false
        this.mesh.visible = false
    }

    spawn(x: number, y: number, z: number, radius: number, life: number, r: number, g: number, b: number) {
        const it = this.items[this.cursor]!
        this.cursor = (this.cursor + 1) % this.items.length
        it.life = life; it.maxLife = life
        it.x = x; it.y = y; it.z = z
        it.radius = radius
        it.r = r; it.g = g; it.b = b
    }

    update(dt: number) {
        let n = 0
        const pos = this.aPos.array as Float32Array
        const col = this.aCol.array as Float32Array
        const aux = this.aAux.array as Float32Array
        for (const it of this.items) {
            if (it.life <= 0) continue
            it.life -= dt
            if (it.life <= 0) continue
            const t = 1 - it.life / it.maxLife
            const expand = 1 - (1 - t) * (1 - t) * (1 - t)
            const i4 = n * 4
            pos[i4] = it.x
            pos[i4 + 1] = it.y
            pos[i4 + 2] = it.z
            pos[i4 + 3] = Math.max(0.05, it.radius * expand)
            col[i4] = it.r
            col[i4 + 1] = it.g
            col[i4 + 2] = it.b
            col[i4 + 3] = (1 - t) * (1 - t)
            aux[i4] = 0.32 * (1 - t) + 0.06
            n++
        }
        this.geometry.instanceCount = n
        this.mesh.visible = n > 0
        if (n === 0) return
        for (const attr of [this.aPos, this.aCol, this.aAux]) {
            attr.clearUpdateRanges()
            attr.addUpdateRange(0, n * 4)
            attr.needsUpdate = true
        }
    }

    clear() {
        for (const it of this.items) it.life = 0
        this.geometry.instanceCount = 0
        this.mesh.visible = false
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
    }
}

// ---------------------------------------------------------------------------
// Streaks: velocity-stretched quads with a minimum pixel width
// ---------------------------------------------------------------------------

const STREAK_VERT = /* glsl */`
    attribute vec4 iA;
    attribute vec4 iB;
    attribute vec4 iCol;
    attribute vec4 iExt;
    uniform float uViewH;
    uniform float uMinPx;
    varying vec2 vUv;
    varying vec4 vCol;
    varying float vHot;
    varying float vTaper;
    varying float vDim;
    void main() {
        vec3 a = (modelViewMatrix * vec4(iA.xyz, 1.0)).xyz;
        vec3 b = (modelViewMatrix * vec4(iB.xyz, 1.0)).xyz;
        float nearZ = -0.08;
        if (a.z > nearZ && b.z > nearZ) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
        if (a.z > nearZ) a = mix(a, b, (nearZ - a.z) / (b.z - a.z));
        if (b.z > nearZ) b = mix(b, a, (nearZ - b.z) / (a.z - b.z));
        vec3 dir = a - b;
        float len = length(dir);
        vec3 d = len > 1e-5 ? dir / len : vec3(0.0, 1.0, 0.0);
        vec3 pt = mix(b, a, position.y);
        vec3 view = normalize(pt);
        vec3 side = cross(d, view);
        float sl = length(side);
        side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
        float depth = max(0.05, -pt.z);
        float pxWorld = 2.0 * depth / (max(1.0, uViewH) * max(0.1, projectionMatrix[1][1]));
        float wMin = max(1e-5, uMinPx * pxWorld);
        float w = max(iA.w, wMin);
        vDim = clamp(iA.w / wMin, 0.2, 1.0);
        pt += side * (position.x * 0.5 * w) + d * ((position.y * 2.0 - 1.0) * 0.5 * w);
        gl_Position = projectionMatrix * vec4(pt, 1.0);
        vUv = position.xy;
        vCol = vec4(iCol.rgb, iB.w);
        vHot = iCol.w;
        vTaper = iExt.x;
    }
`

const STREAK_FRAG = /* glsl */`
    varying vec2 vUv;
    varying vec4 vCol;
    varying float vHot;
    varying float vTaper;
    varying float vDim;
    void main() {
        float ax = min(abs(vUv.x), 1.0);
        float y = clamp(vUv.y, 0.0, 1.0);
        float body = 1.0 - ax;
        body = body * body;
        float core = 1.0 - smoothstep(0.0, 0.45, ax);
        float flat = 1.0 - smoothstep(0.5, 1.0, ax);
        float shape = vHot > 0.001 ? body : flat;
        float tail = mix(1.0, smoothstep(0.0, 0.85, y), vTaper);
        float alpha = shape * tail * vCol.a * vDim;
        if (alpha < 0.003) discard;
        vec3 col = vCol.rgb;
        if (vHot > 0.001) {
            col = mix(col * (1.0 + vHot * 0.5), vec3(1.0, 0.97, 0.88) * (1.0 + vHot), core);
        }
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`

class StreakPool {
    readonly mesh: THREE.Mesh
    private geometry: THREE.InstancedBufferGeometry
    private material: THREE.ShaderMaterial
    private aA: THREE.InstancedBufferAttribute
    private aB: THREE.InstancedBufferAttribute
    private aCol: THREE.InstancedBufferAttribute
    private aExt: THREE.InstancedBufferAttribute
    private n = 0
    private cap: number

    constructor(cap: number, additive: boolean, minPx = 1.75) {
        this.cap = cap
        this.geometry = new THREE.InstancedBufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3))
        this.geometry.setIndex([0, 1, 2, 0, 2, 3])
        this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
        this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
        this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
        this.aExt = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
        this.geometry.setAttribute('iA', this.aA)
        this.geometry.setAttribute('iB', this.aB)
        this.geometry.setAttribute('iCol', this.aCol)
        this.geometry.setAttribute('iExt', this.aExt)
        this.geometry.instanceCount = 0
        const uViewH: THREE.IUniform<number> = { value: 1080 }
        this.material = new THREE.ShaderMaterial({
            uniforms: { uViewH, uMinPx: { value: minPx } },
            vertexShader: STREAK_VERT,
            fragmentShader: STREAK_FRAG,
            transparent: true,
            depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            side: THREE.DoubleSide
        })
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.frustumCulled = false
        this.mesh.visible = false
        bindViewport(this.mesh, uViewH)
    }

    begin() {
        this.n = 0
    }

    /** `a` is the bright head, `b` the tail. `hot` > 0 adds a white-hot core (HDR). */
    push(
        ax: number, ay: number, az: number, width: number,
        bx: number, by: number, bz: number, alpha: number,
        r: number, g: number, b: number, hot: number, taper: number
    ) {
        if (this.n >= this.cap || alpha <= 0.002) return
        const i = this.n * 4
        const A = this.aA.array as Float32Array
        const B = this.aB.array as Float32Array
        const C = this.aCol.array as Float32Array
        const E = this.aExt.array as Float32Array
        A[i] = ax; A[i + 1] = ay; A[i + 2] = az; A[i + 3] = width
        B[i] = bx; B[i + 1] = by; B[i + 2] = bz; B[i + 3] = alpha
        C[i] = r; C[i + 1] = g; C[i + 2] = b; C[i + 3] = hot
        E[i] = taper
        this.n++
    }

    end() {
        this.geometry.instanceCount = this.n
        this.mesh.visible = this.n > 0
        if (this.n === 0) return
        for (const attr of [this.aA, this.aB, this.aCol, this.aExt]) {
            attr.clearUpdateRanges()
            attr.addUpdateRange(0, this.n * 4)
            attr.needsUpdate = true
        }
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
    }
}

interface StreakItem {
    life: number, maxLife: number
    x: number, y: number, z: number
    vx: number, vy: number, vz: number
    width: number
    r: number, g: number, b: number
    alpha: number, hot: number
    gravity: number, drag: number
    /** < 0: report landing and die. 0: die on the floor. > 0: bounce restitution. */
    bounce: number
    lenT: number
    glow: number
}

interface StreakSpawn {
    x: number, y: number, z: number
    vx: number, vy: number, vz: number
    width: number
    life: number
    r: number, g: number, b: number
    alpha?: number, hot?: number
    gravity?: number, drag?: number
    bounce?: number
    lenT?: number
    glow?: number
}

/** Ballistic streak particles: sparks, embers, blood droplets. */
class StreakParticles {
    onLand: ((x: number, z: number, item: StreakItem) => void) | null = null
    private items: StreakItem[]
    private cursor = 0
    private env: Env

    constructor(count: number, env: Env) {
        this.env = env
        this.items = Array.from({ length: count }, () => ({
            life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, width: 0.01,
            r: 1, g: 1, b: 1, alpha: 1, hot: 0, gravity: 0, drag: 0, bounce: 0, lenT: 0.03, glow: 0
        }))
    }

    spawn(o: StreakSpawn) {
        const it = this.items[this.cursor]!
        this.cursor = (this.cursor + 1) % this.items.length
        it.life = o.life; it.maxLife = o.life
        it.x = o.x; it.y = o.y; it.z = o.z
        it.vx = o.vx; it.vy = o.vy; it.vz = o.vz
        it.width = o.width
        it.r = o.r; it.g = o.g; it.b = o.b
        it.alpha = o.alpha ?? 1
        it.hot = o.hot ?? 0
        it.gravity = o.gravity ?? 0
        it.drag = o.drag ?? 0
        it.bounce = o.bounce ?? 0
        it.lenT = o.lenT ?? 0.03
        it.glow = o.glow ?? 0
    }

    update(dt: number, pool: StreakPool) {
        for (const it of this.items) {
            if (it.life <= 0) continue
            it.life -= dt
            if (it.life <= 0) continue
            it.vy -= it.gravity * dt
            const damp = Math.max(0, 1 - it.drag * dt)
            it.vx *= damp
            it.vy *= damp
            it.vz *= damp
            it.x += it.vx * dt
            it.y += it.vy * dt
            it.z += it.vz * dt
            const floor = floorOf(this.env, it.x, it.z, it.y)
            if (it.y < floor) {
                if (it.bounce < 0) {
                    this.onLand?.(it.x, it.z, it)
                    it.life = 0
                    continue
                }
                if (it.bounce === 0) {
                    it.life = 0
                    continue
                }
                it.y = floor
                it.vy = -it.vy * it.bounce
                it.vx *= 0.7
                it.vz *= 0.7
            }
            const speed = Math.sqrt(it.vx * it.vx + it.vy * it.vy + it.vz * it.vz)
            const len = Math.min(0.9, Math.max(it.width * 1.4, speed * it.lenT))
            let dx = 0
            let dy = 1
            let dz = 0
            if (speed > 1e-4) {
                dx = it.vx / speed
                dy = it.vy / speed
                dz = it.vz / speed
            }
            const t = it.life / it.maxLife
            pool.push(
                it.x, it.y, it.z, it.width * (0.55 + 0.45 * t),
                it.x - dx * len, it.y - dy * len, it.z - dz * len,
                it.alpha * Math.min(1, t * 2.5),
                it.r, it.g, it.b, it.hot, 1
            )
        }
    }

    clear() {
        for (const it of this.items) it.life = 0
    }
}

// ---------------------------------------------------------------------------
// Decals
// ---------------------------------------------------------------------------

const DECAL_VERT = /* glsl */`
    attribute vec4 iTint;
    attribute vec2 iTex;
    varying vec2 vUv;
    varying vec4 vTint;
    varying float vGlow;
    #include <fog_pars_vertex>
    void main() {
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vec2 origin = vec2(mod(iTex.x, 2.0), floor(iTex.x / 2.0)) * 0.5;
        vUv = origin + (uv * 0.96 + 0.02) * 0.5;
        vTint = iTint;
        vGlow = iTex.y;
        #include <fog_vertex>
    }
`

const DECAL_FRAG = /* glsl */`
    uniform sampler2D map;
    uniform float uLight;
    varying vec2 vUv;
    varying vec4 vTint;
    varying float vGlow;
    #include <fog_pars_fragment>
    void main() {
        vec4 t = texture2D(map, vUv);
        float a = t.a * vTint.a;
        if (a < 0.004) discard;
        vec3 col = t.rgb * vTint.rgb * (uLight + vGlow * 1.6);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
    }
`

interface DecalItem {
    used: boolean
    life: number
    fadeOut: number
    alpha: number
    /** 0..1 age-rank fade so the oldest decals dissolve before being recycled. */
    rank: number
}

const Z_AXIS = new THREE.Vector3(0, 0, 1)
const decalQuat = new THREE.Quaternion()
const decalSpin = new THREE.Quaternion()
const decalPos = new THREE.Vector3()
const decalScale = new THREE.Vector3()
const decalMatrix = new THREE.Matrix4()
const decalNormal = new THREE.Vector3()

class DecalPool {
    readonly mesh: THREE.InstancedMesh
    private geometry: THREE.PlaneGeometry
    private material: THREE.ShaderMaterial
    private items: DecalItem[]
    private cursor = 0
    private filled = 0
    private tint: THREE.InstancedBufferAttribute
    private tex: THREE.InstancedBufferAttribute
    private dirty = false
    private rankSpan: number

    constructor(count: number, texture: THREE.Texture, light: number, rankSpan = 12) {
        this.rankSpan = rankSpan
        this.items = Array.from({ length: count }, () => ({ used: false, life: 0, fadeOut: 0, alpha: 1, rank: 1 }))
        this.geometry = new THREE.PlaneGeometry(1, 1)
        this.tint = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
        this.tex = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)
        this.geometry.setAttribute('iTint', this.tint)
        this.geometry.setAttribute('iTex', this.tex)
        this.material = new THREE.ShaderMaterial({
            uniforms: { ...fogUniforms(), map: { value: texture }, uLight: { value: light } },
            vertexShader: DECAL_VERT,
            fragmentShader: DECAL_FRAG,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            fog: true
        })
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count)
        this.mesh.count = 0
        this.mesh.frustumCulled = false
        this.mesh.visible = false
    }

    setLight(v: number) {
        this.material.uniforms.uLight!.value = v
    }

    /**
     * Places a decal at `p` facing `n` (any length). `life` is seconds until it
     * has faded out completely; pass Infinity to keep it until it is recycled.
     */
    spawn(
        px: number, py: number, pz: number,
        nx: number, ny: number, nz: number,
        size: number, r: number, g: number, b: number,
        alpha: number, life: number, glow = 0, stretch = 1
    ) {
        const idx = this.cursor
        this.cursor = (this.cursor + 1) % this.items.length
        this.filled = Math.min(this.items.length, this.filled + 1)
        const it = this.items[idx]!
        it.used = true
        it.life = life
        it.fadeOut = Number.isFinite(life) ? Math.min(6, life * 0.5) : 0
        it.alpha = alpha
        it.rank = 1

        decalNormal.set(nx, ny, nz)
        if (decalNormal.lengthSq() < 1e-6) decalNormal.set(0, 1, 0)
        decalNormal.normalize()
        decalQuat.setFromUnitVectors(Z_AXIS, decalNormal)
        decalSpin.setFromAxisAngle(Z_AXIS, Math.random() * TAU)
        decalQuat.multiply(decalSpin)
        decalPos.set(px, py, pz).addScaledVector(decalNormal, 0.012)
        decalScale.set(size * stretch, size, 1)
        decalMatrix.compose(decalPos, decalQuat, decalScale)
        this.mesh.setMatrixAt(idx, decalMatrix)
        this.mesh.instanceMatrix.needsUpdate = true

        const t = this.tint.array as Float32Array
        t[idx * 4] = r
        t[idx * 4 + 1] = g
        t[idx * 4 + 2] = b
        t[idx * 4 + 3] = alpha
        const x = this.tex.array as Float32Array
        x[idx * 2] = Math.floor(Math.random() * 4)
        x[idx * 2 + 1] = glow

        // The next few slots to be recycled are the oldest: dissolve them.
        if (this.filled === this.items.length) {
            for (let k = 0; k < this.rankSpan; k++) {
                const j = (this.cursor + k) % this.items.length
                const old = this.items[j]!
                old.rank = (k + 1) / (this.rankSpan + 1)
                t[j * 4 + 3] = old.alpha * old.rank * Math.min(1, old.fadeOut > 0 ? Math.max(0, old.life) / old.fadeOut : 1)
            }
        }
        this.tint.needsUpdate = true
        this.tex.needsUpdate = true
        this.mesh.count = this.filled
        this.mesh.visible = true
    }

    update(dt: number) {
        if (this.filled === 0) return
        const t = this.tint.array as Float32Array
        let changed = false
        for (let i = 0; i < this.items.length; i++) {
            const it = this.items[i]!
            if (!it.used || !Number.isFinite(it.life)) continue
            it.life -= dt
            if (it.life <= 0) {
                it.used = false
                t[i * 4 + 3] = 0
                changed = true
                continue
            }
            if (it.life < it.fadeOut) {
                t[i * 4 + 3] = it.alpha * it.rank * (it.life / it.fadeOut)
                changed = true
            }
        }
        if (changed) this.tint.needsUpdate = true
    }

    clear() {
        const t = this.tint.array as Float32Array
        for (let i = 0; i < this.items.length; i++) {
            this.items[i]!.used = false
            t[i * 4 + 3] = 0
        }
        this.filled = 0
        this.cursor = 0
        this.mesh.count = 0
        this.mesh.visible = false
        this.tint.needsUpdate = true
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
        this.mesh.dispose()
    }
}

// ---------------------------------------------------------------------------
// Chunks (gore, rubble) and casings: small lit instanced meshes with bounces
// ---------------------------------------------------------------------------

interface BodyItem {
    life: number
    x: number, y: number, z: number
    vx: number, vy: number, vz: number
    q: THREE.Quaternion
    ax: number, ay: number, az: number, w: number
    sx: number, sy: number, sz: number
    /** Half-height above the floor when resting. */
    rest: number
    resting: boolean
    cooldown: number
    shown: boolean
}

const bodyAxis = new THREE.Vector3()
const bodyDq = new THREE.Quaternion()
const bodyPos = new THREE.Vector3()
const bodyScale = new THREE.Vector3()
const bodyMatrix = new THREE.Matrix4()
const bodyColor = new THREE.Color()
const bodyDir = new THREE.Vector3()
const bodyFlat = new THREE.Quaternion()
const IDENTITY_Q = new THREE.Quaternion()
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0)

function makeBodies(count: number): BodyItem[] {
    return Array.from({ length: count }, () => ({
        life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, q: new THREE.Quaternion(),
        ax: 0, ay: 1, az: 0, w: 0, sx: 1, sy: 1, sz: 1, rest: 0.02, resting: false, cooldown: 0, shown: false
    }))
}

class ChunkSystem {
    readonly mesh: THREE.InstancedMesh
    onLand: ((x: number, y: number, z: number, strength: number) => void) | null = null
    private geometry: THREE.IcosahedronGeometry
    private material: THREE.MeshStandardMaterial
    private items: BodyItem[]
    private cursor = 0
    private env: Env

    constructor(count: number, env: Env) {
        this.env = env
        this.items = makeBodies(count)
        this.geometry = new THREE.IcosahedronGeometry(0.5, 0)
        this.material = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.02, flatShading: true })
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count)
        this.mesh.frustumCulled = false
        bodyColor.setRGB(1, 1, 1)
        for (let i = 0; i < count; i++) {
            this.mesh.setColorAt(i, bodyColor)
            this.mesh.setMatrixAt(i, ZERO_MATRIX)
        }
        this.mesh.visible = false
    }

    spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, hex: number, life: number) {
        const idx = this.cursor
        this.cursor = (this.cursor + 1) % this.items.length
        const it = this.items[idx]!
        it.life = life
        it.x = x; it.y = y; it.z = z
        it.vx = vx; it.vy = vy; it.vz = vz
        it.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        bodyAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        it.ax = bodyAxis.x; it.ay = bodyAxis.y; it.az = bodyAxis.z
        it.w = rr(6, 18)
        it.sx = size * rr(0.7, 1.4)
        it.sy = size * rr(0.5, 1.1)
        it.sz = size * rr(0.7, 1.4)
        it.rest = Math.min(it.sx, it.sy, it.sz) * 0.4
        it.resting = false
        it.cooldown = 0
        it.shown = true
        bodyColor.setHex(hex)
        // Slight per-chunk value variation so gore reads as gore, not a palette.
        bodyColor.multiplyScalar(rr(0.75, 1.15))
        this.mesh.setColorAt(idx, bodyColor)
        this.mesh.instanceColor!.needsUpdate = true
        this.mesh.visible = true
    }

    update(dt: number) {
        let live = false
        let touched = false
        for (let i = 0; i < this.items.length; i++) {
            const it = this.items[i]!
            if (!it.shown) continue
            live = true
            it.life -= dt
            if (it.life <= 0) {
                it.shown = false
                this.mesh.setMatrixAt(i, ZERO_MATRIX)
                touched = true
                continue
            }
            if (!it.resting) {
                it.vy -= 13 * dt
                it.x += it.vx * dt
                it.y += it.vy * dt
                it.z += it.vz * dt
                if (it.w > 0.01) {
                    bodyAxis.set(it.ax, it.ay, it.az)
                    bodyDq.setFromAxisAngle(bodyAxis, it.w * dt)
                    it.q.premultiply(bodyDq)
                }
                const floor = floorOf(this.env, it.x, it.z, it.y) + it.rest
                if (it.y < floor) {
                    it.y = floor
                    const impact = -it.vy
                    if (impact > 1.1 && it.cooldown <= 0) {
                        this.onLand?.(it.x, it.y, it.z, Math.min(1, impact / 6))
                        it.cooldown = 0.08
                    }
                    it.vy = impact * 0.32
                    it.vx *= 0.6
                    it.vz *= 0.6
                    it.w *= 0.5
                    if (it.vy < 0.7 && it.vx * it.vx + it.vz * it.vz < 0.25) {
                        it.resting = true
                        it.vx = 0; it.vy = 0; it.vz = 0
                    }
                }
                it.cooldown -= dt
            }
            const k = it.life < 0.7 ? it.life / 0.7 : 1
            bodyPos.set(it.x, it.y, it.z)
            bodyScale.set(it.sx * k, it.sy * k, it.sz * k)
            bodyMatrix.compose(bodyPos, it.q, bodyScale)
            this.mesh.setMatrixAt(i, bodyMatrix)
            touched = true
        }
        if (touched) this.mesh.instanceMatrix.needsUpdate = true
        this.mesh.visible = live
    }

    clear() {
        for (let i = 0; i < this.items.length; i++) {
            this.items[i]!.shown = false
            this.mesh.setMatrixAt(i, ZERO_MATRIX)
        }
        this.mesh.instanceMatrix.needsUpdate = true
        this.mesh.visible = false
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
        this.mesh.dispose()
    }
}

class CasingSystem {
    readonly mesh: THREE.InstancedMesh
    onBounce: ((x: number, y: number, z: number, strength: number) => void) | null = null
    private geometry: THREE.CylinderGeometry
    private material: THREE.MeshStandardMaterial
    private items: BodyItem[]
    private cursor = 0
    private env: Env
    private radius = 0.013

    constructor(count: number, env: Env) {
        this.env = env
        this.items = makeBodies(count)
        // Slightly oversized versus a real 5.56 case so it reads from the first-person view.
        this.geometry = new THREE.CylinderGeometry(this.radius, this.radius * 0.85, 0.056, 8, 1)
        this.material = new THREE.MeshStandardMaterial({
            color: 0xc9a227, metalness: 0.55, roughness: 0.32, emissive: 0x2a1c05, emissiveIntensity: 0.6
        })
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count)
        this.mesh.frustumCulled = false
        for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, ZERO_MATRIX)
        this.mesh.visible = false
    }

    eject(ox: number, oy: number, oz: number, rx: number, rz: number) {
        const idx = this.cursor
        this.cursor = (this.cursor + 1) % this.items.length
        const it = this.items[idx]!
        it.life = 7
        it.x = ox; it.y = oy; it.z = oz
        it.vx = rx * rr(1.4, 2.4) + rr(-0.4, 0.4)
        it.vy = rr(1.4, 2.4)
        it.vz = rz * rr(1.4, 2.4) + rr(-0.4, 0.4)
        it.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        bodyAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        it.ax = bodyAxis.x; it.ay = bodyAxis.y; it.az = bodyAxis.z
        it.w = rr(20, 38) * (Math.random() < 0.5 ? -1 : 1)
        it.sx = 1; it.sy = 1; it.sz = 1
        it.rest = this.radius
        it.resting = false
        it.cooldown = 0
        it.shown = true
        this.mesh.visible = true
    }

    update(dt: number) {
        let live = false
        let touched = false
        for (let i = 0; i < this.items.length; i++) {
            const it = this.items[i]!
            if (!it.shown) continue
            live = true
            it.life -= dt
            if (it.life <= 0) {
                it.shown = false
                this.mesh.setMatrixAt(i, ZERO_MATRIX)
                touched = true
                continue
            }
            if (!it.resting) {
                it.vy -= 11 * dt
                it.x += it.vx * dt
                it.y += it.vy * dt
                it.z += it.vz * dt
                if (Math.abs(it.w) > 0.05) {
                    bodyAxis.set(it.ax, it.ay, it.az)
                    bodyDq.setFromAxisAngle(bodyAxis, it.w * dt)
                    it.q.premultiply(bodyDq)
                }
                const floor = floorOf(this.env, it.x, it.z, it.y) + it.rest
                if (it.y <= floor) {
                    it.y = floor
                    const impact = -it.vy
                    if (impact > 0.8 && it.cooldown <= 0) {
                        this.onBounce?.(it.x, it.y, it.z, Math.min(1, impact / 4.5))
                        it.cooldown = 0.05
                    }
                    it.vy = impact * 0.38
                    it.vx *= 0.62
                    it.vz *= 0.62
                    it.w *= 0.55
                    // Settle onto its side: pull the case axis towards the horizontal.
                    bodyDir.set(0, 1, 0).applyQuaternion(it.q)
                    const flatY = bodyDir.y
                    if (Math.abs(flatY) > 0.02) {
                        const len = Math.hypot(bodyDir.x, bodyDir.z)
                        bodyAxis.set(len > 1e-4 ? bodyDir.x / len : 1, 0, len > 1e-4 ? bodyDir.z / len : 0)
                        bodyFlat.setFromUnitVectors(bodyDir, bodyAxis)
                        bodyDq.copy(IDENTITY_Q).slerp(bodyFlat, 0.55)
                        it.q.premultiply(bodyDq)
                    }
                    if (impact < 0.5) {
                        it.vy = 0
                        it.vx *= 0.9
                        it.vz *= 0.9
                        if (it.vx * it.vx + it.vz * it.vz < 0.02) {
                            it.resting = true
                            it.vx = 0; it.vz = 0
                        }
                    }
                }
                it.cooldown -= dt
            }
            const k = it.life < 0.5 ? it.life / 0.5 : 1
            bodyPos.set(it.x, it.y, it.z)
            bodyScale.set(k, k, k)
            bodyMatrix.compose(bodyPos, it.q, bodyScale)
            this.mesh.setMatrixAt(i, bodyMatrix)
            touched = true
        }
        if (touched) this.mesh.instanceMatrix.needsUpdate = true
        this.mesh.visible = live
    }

    clear() {
        for (let i = 0; i < this.items.length; i++) {
            this.items[i]!.shown = false
            this.mesh.setMatrixAt(i, ZERO_MATRIX)
        }
        this.mesh.instanceMatrix.needsUpdate = true
        this.mesh.visible = false
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
        this.mesh.dispose()
    }
}

// ---------------------------------------------------------------------------
// Tracers and electric arcs (built on the streak pool)
// ---------------------------------------------------------------------------

interface TracerItem {
    life: number, maxLife: number
    ax: number, ay: number, az: number
    dx: number, dy: number, dz: number
    length: number, trail: number, width: number
    r: number, g: number, b: number
}

const ARC_SEGMENTS = 12
const ARC_BRANCHES = 3
const ARC_BRANCH_SEGMENTS = 4

interface ArcItem {
    life: number, maxLife: number
    fx: number, fy: number, fz: number
    tx: number, ty: number, tz: number
    r: number, g: number, b: number
    width: number
    amp: number
    /** Time until the jitter is rerolled (arcs crawl at ~25 Hz). */
    reroll: number
    pts: Float32Array
    branchAt: number[]
    branchPts: Float32Array
}

// ---------------------------------------------------------------------------
// Ambient motes (dust in the air, bio-spores)
// ---------------------------------------------------------------------------

const MOTE_VERT = /* glsl */`
    attribute vec4 aSeed;
    uniform float uTime;
    uniform vec3 uBox;
    uniform vec3 uDrift;
    uniform float uSize;
    uniform float uMinPx;
    uniform float uViewH;
    uniform float uAlpha;
    uniform float uPulse;
    varying float vAlpha;
    void main() {
        vec3 base = position * uBox;
        vec3 wobble = vec3(
            sin(uTime * 0.31 * aSeed.z + aSeed.x * 6.2831),
            sin(uTime * 0.23 * aSeed.w + aSeed.y * 6.2831),
            cos(uTime * 0.27 * aSeed.z + aSeed.w * 6.2831)
        ) * 0.35;
        vec3 p = base + uDrift * uTime * (0.4 + aSeed.z) + wobble;
        vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 world = cameraPosition + rel;
        world.y = max(world.y, 0.08);
        vec4 mv = viewMatrix * vec4(world, 1.0);
        float depth = max(0.1, -mv.z);
        float projScale = 0.5 * max(1.0, uViewH) * max(0.1, projectionMatrix[1][1]);
        float natural = uSize * (0.6 + 0.8 * aSeed.y) * projScale / depth;
        float px = max(uMinPx, natural);
        gl_PointSize = px;
        gl_Position = projectionMatrix * mv;
        float dim = clamp(natural / uMinPx, 0.3, 1.0);
        float twinkle = 1.0 - uPulse + uPulse * (0.5 + 0.5 * sin(uTime * (1.0 + aSeed.w * 2.5) + aSeed.x * 6.2831));
        float edge = 1.0 - smoothstep(0.32, 0.5, length(rel.xz) / max(1.0, uBox.x));
        float pool = 0.35 + 0.65 * smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(world.x * 0.45 + 1.3) * sin(world.z * 0.38 + 0.7));
        vAlpha = uAlpha * dim * twinkle * edge * pool * smoothstep(0.35, 1.6, depth);
    }
`

const MOTE_FRAG = /* glsl */`
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
        float d = min(length(gl_PointCoord - 0.5) * 2.0, 1.0);
        float a = 1.0 - d;
        a = a * a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`

interface MoteOptions {
    enabled?: boolean
    intensity?: number
    color?: number
}

class MoteField {
    readonly points: THREE.Points
    private geometry: THREE.BufferGeometry
    private material: THREE.ShaderMaterial
    private baseAlpha: number
    private hdr: number

    constructor(count: number, box: [number, number, number], size: number, minPx: number, alpha: number, color: number, drift: [number, number, number], hdr: number, pulse: number) {
        this.baseAlpha = alpha
        this.hdr = hdr
        const positions = new Float32Array(count * 3)
        const seeds = new Float32Array(count * 4)
        for (let i = 0; i < count; i++) {
            positions[i * 3] = Math.random()
            positions[i * 3 + 1] = Math.random()
            positions[i * 3 + 2] = Math.random()
            seeds[i * 4] = Math.random()
            seeds[i * 4 + 1] = Math.random()
            seeds[i * 4 + 2] = Math.random()
            seeds[i * 4 + 3] = Math.random()
        }
        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
        const uViewH: THREE.IUniform<number> = { value: 1080 }
        tmpColor.setHex(color)
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uBox: { value: new THREE.Vector3(...box) },
                uDrift: { value: new THREE.Vector3(...drift) },
                uSize: { value: size },
                uMinPx: { value: minPx },
                uViewH,
                uAlpha: { value: alpha },
                uPulse: { value: pulse },
                uColor: { value: new THREE.Vector3(tmpColor.r * hdr, tmpColor.g * hdr, tmpColor.b * hdr) }
            },
            vertexShader: MOTE_VERT,
            fragmentShader: MOTE_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
        this.points = new THREE.Points(this.geometry, this.material)
        this.points.frustumCulled = false
        bindViewport(this.points, uViewH)
    }

    configure(opts: MoteOptions) {
        if (opts.enabled !== undefined) this.points.visible = opts.enabled
        if (opts.intensity !== undefined) this.material.uniforms.uAlpha!.value = this.baseAlpha * opts.intensity
        if (opts.color !== undefined) {
            tmpColor.setHex(opts.color)
            ;(this.material.uniforms.uColor!.value as THREE.Vector3).set(tmpColor.r * this.hdr, tmpColor.g * this.hdr, tmpColor.b * this.hdr)
        }
    }

    update(dt: number) {
        this.material.uniforms.uTime!.value += dt
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
    }
}

// ---------------------------------------------------------------------------
// The effects hub
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0)
const AXIS_X = new THREE.Vector3(1, 0, 0)
const nrm = new THREE.Vector3()
const tan1 = new THREE.Vector3()
const tan2 = new THREE.Vector3()

interface BoomLight { light: THREE.PointLight, life: number, maxLife: number, peak: number }

export class CallOfXenoEffects {
    /**
     * Optional floor height query so blood, casings and gore land on the upper
     * floor as well as the ground. Defaults to y = 0 everywhere.
     */
    groundAt: ((x: number, z: number, y: number) => number) | null = null
    /** A brass casing hit the floor. `strength` 0..1. Map to a tinkle sound. */
    onCasingBounce: ((x: number, y: number, z: number, strength: number) => void) | null = null
    /** A gore chunk hit the floor. `strength` 0..1. Map to a wet splat. */
    onGibLand: ((x: number, y: number, z: number, strength: number) => void) | null = null
    /** Fired at the start of every explosion so the caller can kick the post-processing flash. */
    onExplosion: ((x: number, y: number, z: number, radius: number) => void) | null = null

    private scene: THREE.Scene
    private env: Env
    private textures: THREE.Texture[] = []

    private glowStreaks: StreakPool
    private dropStreaks: StreakPool
    private sparks: StreakParticles
    private glowDrops: StreakParticles
    private drops: StreakParticles

    private smoke: BillboardPool
    private glow: BillboardPool
    private fire: BillboardPool
    private rings: RingPool

    private holes: DecalPool
    private splats: DecalPool
    private scorch: DecalPool

    private chunks: ChunkSystem
    private casings: CasingSystem

    private tracers: TracerItem[]
    private tracerCursor = 0
    private arcs: ArcItem[]
    private arcCursor = 0

    private dust: MoteField
    private spores: MoteField
    private lights: BoomLight[] = []
    private group = new THREE.Group()

    constructor(scene: THREE.Scene) {
        this.scene = scene
        this.env = { groundAt: null }
        // The env holds a getter so `groundAt` can be assigned after construction.
        Object.defineProperty(this.env, 'groundAt', { get: () => this.groundAt })

        const smokeTex = atlasTexture('smoke', 128, smokePaint)
        const splatTex = atlasTexture('splat', 128, splatPaint)
        const holeTex = atlasTexture('hole', 128, holePaint)
        const scorchTex = atlasTexture('scorch', 128, scorchPaint)
        this.textures.push(smokeTex, splatTex, holeTex, scorchTex)

        this.glowStreaks = new StreakPool(720, true, 1.75)
        this.dropStreaks = new StreakPool(420, false, 1.5)
        this.sparks = new StreakParticles(360, this.env)
        this.glowDrops = new StreakParticles(120, this.env)
        this.drops = new StreakParticles(320, this.env)
        this.drops.onLand = (x, z, it) => this.dropLanded(x, z, it, false)
        this.glowDrops.onLand = (x, z, it) => this.dropLanded(x, z, it, true)

        this.smoke = new BillboardPool(360, smokeTex, 'smoke')
        this.glow = new BillboardPool(96, smokeTex, 'glow')
        this.fire = new BillboardPool(64, smokeTex, 'fire')
        this.rings = new RingPool(4)

        this.holes = new DecalPool(150, holeTex, 0.6, 20)
        this.splats = new DecalPool(120, splatTex, 0.55, 12)
        this.scorch = new DecalPool(24, scorchTex, 0.8, 4)

        this.chunks = new ChunkSystem(96, this.env)
        this.chunks.onLand = (x, y, z, s) => {
            this.onGibLand?.(x, y, z, s)
            if (Math.random() < 0.5 && this.lastGoreGlow < 0.5) this.splatAt(x, floorOf(this.env, x, z, y), z, rr(0.12, 0.26), this.lastGoreR, this.lastGoreG, this.lastGoreB, 0)
        }
        this.casings = new CasingSystem(48, this.env)
        this.casings.onBounce = (x, y, z, s) => this.onCasingBounce?.(x, y, z, s)

        this.tracers = Array.from({ length: 40 }, () => ({
            life: 0, maxLife: 1, ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 1, length: 1, trail: 1, width: 0.02, r: 1, g: 1, b: 1
        }))
        this.arcs = Array.from({ length: 8 }, () => ({
            life: 0, maxLife: 1, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, r: 1, g: 1, b: 1, width: 0.02, amp: 0.2, reroll: 0,
            pts: new Float32Array((ARC_SEGMENTS + 1) * 3),
            branchAt: Array.from({ length: ARC_BRANCHES }, () => 0),
            branchPts: new Float32Array(ARC_BRANCHES * (ARC_BRANCH_SEGMENTS + 1) * 3)
        }))

        this.dust = new MoteField(260, [18, 7, 18], 0.011, 1.6, 0.42, 0xffe2b0, [0.02, -0.012, 0.015], 1.0, 0.35)
        this.spores = new MoteField(90, [16, 6, 16], 0.03, 2.2, 0.55, 0x66ffcc, [0.01, 0.16, 0.01], 1.6, 0.8)
        this.spores.points.visible = false

        for (let i = 0; i < 2; i++) {
            const light = new THREE.PointLight(0xffa040, 0, 20, 2)
            this.lights.push({ light, life: 0, maxLife: 1, peak: 0 })
            this.group.add(light)
        }

        // Draw order among transparents: decals under everything, flares on top.
        this.holes.mesh.renderOrder = 1
        this.splats.mesh.renderOrder = 1
        this.scorch.mesh.renderOrder = 1
        this.dust.points.renderOrder = 3
        this.smoke.mesh.renderOrder = 5
        this.dropStreaks.mesh.renderOrder = 6
        this.fire.mesh.renderOrder = 7
        this.rings.mesh.renderOrder = 7
        this.glow.mesh.renderOrder = 8
        this.spores.points.renderOrder = 8
        this.glowStreaks.mesh.renderOrder = 9

        this.group.add(
            this.holes.mesh, this.splats.mesh, this.scorch.mesh,
            this.chunks.mesh, this.casings.mesh,
            this.dust.points, this.spores.points,
            this.smoke.mesh, this.dropStreaks.mesh, this.fire.mesh, this.rings.mesh,
            this.glow.mesh, this.glowStreaks.mesh
        )
        scene.add(this.group)
    }

    // -- configuration ------------------------------------------------------

    /** Horizontal draft that smoke drifts along, in m/s. */
    setWind(x: number, z: number) {
        this.smoke.windX = x
        this.smoke.windZ = z
    }

    /** How brightly decals are drawn (0.3 in a dark room, 0.8 in a lit one). */
    setDecalLight(value: number) {
        this.holes.setLight(value)
        this.splats.setLight(value)
        this.scorch.setLight(value * 1.2)
    }

    /** Floating dust motes wrapped around the camera. On by default. */
    ambientDust(opts: MoteOptions = {}) {
        this.dust.configure(opts)
    }

    /** Glowing bioluminescent spores drifting upward. Off by default. */
    bioSpores(opts: MoteOptions = {}) {
        this.spores.configure({ enabled: true, ...opts })
    }

    // -- helpers --------------------------------------------------------------

    private lastGoreR = 0.25
    private lastGoreG = 0.01
    private lastGoreB = 0.012
    private lastGoreGlow = 0

    private setIchor(color: number | undefined) {
        const hex = color ?? ICHOR_RED
        tmpColor.setHex(hex)
        this.lastGoreR = tmpColor.r
        this.lastGoreG = tmpColor.g
        this.lastGoreB = tmpColor.b
        // Green-dominant ichor is acid: it glows.
        this.lastGoreGlow = tmpColor.g > tmpColor.r * 1.4 && tmpColor.g > 0.3 ? 1 : 0
    }

    private splatAt(x: number, y: number, z: number, size: number, r: number, g: number, b: number, glow: number) {
        this.splats.spawn(x, y, z, 0, 1, 0, size, r, g, b, 0.88, 55, glow, rr(0.85, 1.25))
    }

    private dropLanded(x: number, z: number, it: StreakItem, glowing: boolean) {
        if (Math.random() > 0.6) return
        const size = 0.09 + it.width * rr(5, 10)
        this.splats.spawn(x, floorOf(this.env, x, z, it.y), z, 0, 1, 0, size, it.r, it.g, it.b, 0.85, 50, glowing ? 1 : 0, rr(0.85, 1.3))
    }

    private basis(nx: number, ny: number, nz: number) {
        nrm.set(nx, ny, nz)
        if (nrm.lengthSq() < 1e-6) nrm.set(0, 1, 0)
        nrm.normalize()
        tan1.crossVectors(nrm, Math.abs(nrm.y) < 0.9 ? UP : AXIS_X).normalize()
        tan2.crossVectors(nrm, tan1)
    }

    private takeLight(): BoomLight {
        let best = this.lights[0]!
        for (const l of this.lights) if (l.life < best.life) best = l
        return best
    }

    // -- tracers ----------------------------------------------------------------

    /**
     * Fast, bright tracer from muzzle to impact: a hot white core with a soft
     * coloured halo whose head races along the path. `radius` is the beam
     * radius in metres; `life` how long the whole streak lingers.
     */
    tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, radius: number, life = 0.07) {
        const dx = to.x - from.x
        const dy = to.y - from.y
        const dz = to.z - from.z
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (length < 0.001) return
        const it = this.tracers[this.tracerCursor]!
        this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length
        it.life = life
        it.maxLife = life
        it.ax = from.x; it.ay = from.y; it.az = from.z
        it.dx = dx / length; it.dy = dy / length; it.dz = dz / length
        it.length = length
        it.trail = Math.min(length, Math.max(3, length * 0.3))
        it.width = radius * 3.2
        tmpColor.setHex(color)
        it.r = tmpColor.r; it.g = tmpColor.g; it.b = tmpColor.b
    }

    private updateTracers(dt: number) {
        for (const it of this.tracers) {
            if (it.life <= 0) continue
            it.life -= dt
            if (it.life <= 0) continue
            const u = 1 - it.life / it.maxLife
            const travel = 0.45
            let head: number
            let tail: number
            if (u < travel) {
                head = (u / travel) * it.length
                tail = Math.max(0, head - it.trail)
            } else {
                head = it.length
                const from = Math.max(0, it.length - it.trail)
                tail = from + (it.length - from) * ((u - travel) / (1 - travel))
            }
            const fade = u < travel ? 1 : 1 - (u - travel) / (1 - travel)
            this.glowStreaks.push(
                it.ax + it.dx * head, it.ay + it.dy * head, it.az + it.dz * head, it.width,
                it.ax + it.dx * tail, it.ay + it.dy * tail, it.az + it.dz * tail,
                0.95 * fade, it.r, it.g, it.b, 2.6, 1
            )
        }
    }

    // -- wall impacts -------------------------------------------------------------

    /** Spark shower, dust puff and a persistent bullet-hole decal. `scale` grows the whole effect. */
    wallImpact(point: THREE.Vector3, normal: THREE.Vector3, scale = 1) {
        this.basis(normal.x, normal.y, normal.z)
        const nx = nrm.x
        const ny = nrm.y
        const nz = nrm.z
        const px = point.x
        const py = point.y
        const pz = point.z

        const count = Math.round(10 * scale)
        for (let i = 0; i < count; i++) {
            const a = Math.random() * TAU
            const spread = rr(0.8, 4.6)
            const out = rr(1.2, 5)
            const cs = Math.cos(a) * spread
            const sn = Math.sin(a) * spread
            this.sparks.spawn({
                x: px + nx * 0.02, y: py + ny * 0.02, z: pz + nz * 0.02,
                vx: nx * out + tan1.x * cs + tan2.x * sn,
                vy: ny * out + tan1.y * cs + tan2.y * sn + 0.6,
                vz: nz * out + tan1.z * cs + tan2.z * sn,
                width: rr(0.007, 0.014),
                life: rr(0.2, 0.5),
                r: 1, g: rr(0.4, 0.8), b: rr(0.06, 0.2),
                hot: 1.4, gravity: 9, drag: 0.7, bounce: 0.32, lenT: 0.045
            })
        }
        this.glow.spawn({ x: px + nx * 0.05, y: py + ny * 0.05, z: pz + nz * 0.05, size: 0.24 * scale, size2: 0.34 * scale, life: 0.07, r: 1, g: 0.75, b: 0.4, alpha: 0.9, hdr: 2.6 })
        for (let i = 0; i < 2; i++) {
            const a = Math.random() * TAU
            const lat = rr(0.05, 0.3)
            this.smoke.spawn({
                x: px + nx * 0.04, y: py + ny * 0.04, z: pz + nz * 0.04,
                vx: nx * rr(0.3, 0.9) + (tan1.x * Math.cos(a) + tan2.x * Math.sin(a)) * lat,
                vy: ny * rr(0.3, 0.9) + (tan1.y * Math.cos(a) + tan2.y * Math.sin(a)) * lat + 0.15,
                vz: nz * rr(0.3, 0.9) + (tan1.z * Math.cos(a) + tan2.z * Math.sin(a)) * lat,
                size: 0.07 * scale, size2: rr(0.3, 0.52) * scale, life: rr(0.7, 1.15),
                r: 0.46, g: 0.44, b: 0.4, r2: 0.3, g2: 0.3, b2: 0.3,
                alpha: 0.26, drag: 1.4
            })
        }
        this.holes.spawn(px, py, pz, nx, ny, nz, rr(0.08, 0.13) * scale, 1, 1, 1, 0.95, Infinity)
    }

    // -- blood ---------------------------------------------------------------------

    /**
     * Xeno ichor spray behind a hit. `direction` is the way the round was
     * travelling; `amount` scales how hard it hit. `color` defaults to dark red;
     * pass `ICHOR_ACID` (or any green-dominant hex) for glowing acid.
     */
    bloodBurst(point: THREE.Vector3, direction: THREE.Vector3, amount = 1, color?: number) {
        this.setIchor(color)
        const glowing = this.lastGoreGlow > 0
        const r = this.lastGoreR
        const g = this.lastGoreG
        const b = this.lastGoreB
        const spray = glowing ? this.glowDrops : this.drops
        const count = clamp(Math.round(8 * amount), 3, 26)
        for (let i = 0; i < count; i++) {
            const back = i < 3
            const s = back ? -0.5 : 1
            const speed = rr(2, 7) * (back ? 0.5 : 1)
            spray.spawn({
                x: point.x, y: point.y, z: point.z,
                vx: direction.x * speed * s + rr(-1, 1) * 1.4,
                vy: direction.y * speed * s * 0.5 + rr(0.2, 2.6),
                vz: direction.z * speed * s + rr(-1, 1) * 1.4,
                width: rr(0.012, 0.03), life: rr(0.5, 1.1),
                r, g, b, alpha: 0.92, hot: glowing ? 0.7 : 0,
                gravity: 9.5, drag: 0.35, bounce: -1, lenT: 0.03, glow: glowing ? 1 : 0
            })
        }
        this.smoke.spawn({
            x: point.x, y: point.y, z: point.z,
            vx: direction.x * 1.2, vy: 0.3, vz: direction.z * 1.2,
            size: 0.14, size2: 0.5 * Math.min(1.6, 0.6 + amount * 0.5), life: rr(0.45, 0.8),
            r: r * 3, g: g * 3, b: b * 3, alpha: glowing ? 0.2 : 0.3, drag: 2.2
        })
        if (glowing) {
            this.glow.spawn({ x: point.x, y: point.y, z: point.z, size: 0.3, size2: 0.55, life: 0.22, r: 0.35, g: 1, b: 0.1, alpha: 0.75, hdr: 1.6 })
        }
    }

    /**
     * Gore burst when an enemy dies: droplets, mist, tumbling chunks and a big
     * floor pool that stays. `color` as in `bloodBurst`. `scale` for big enemies.
     */
    deathBurst(point: THREE.Vector3, color?: number, scale = 1) {
        this.setIchor(color)
        const glowing = this.lastGoreGlow > 0
        const r = this.lastGoreR
        const g = this.lastGoreG
        const b = this.lastGoreB
        const spray = glowing ? this.glowDrops : this.drops
        const floor = floorOf(this.env, point.x, point.z, point.y)

        const count = Math.round(26 * scale)
        for (let i = 0; i < count; i++) {
            const a = Math.random() * TAU
            const speed = rr(1.5, 5.5) * scale
            spray.spawn({
                x: point.x, y: point.y + 0.4, z: point.z,
                vx: Math.cos(a) * speed, vy: rr(1.5, 5.5), vz: Math.sin(a) * speed,
                width: rr(0.014, 0.036), life: rr(0.7, 1.3),
                r, g, b, alpha: 0.92, hot: glowing ? 0.7 : 0,
                gravity: 9.5, drag: 0.3, bounce: -1, lenT: 0.03, glow: glowing ? 1 : 0
            })
        }
        for (let i = 0; i < 4; i++) {
            this.smoke.spawn({
                x: point.x + rr(-0.2, 0.2), y: point.y + rr(0.2, 0.7), z: point.z + rr(-0.2, 0.2),
                vx: rr(-0.8, 0.8), vy: rr(0.3, 1.1), vz: rr(-0.8, 0.8),
                size: 0.25 * scale, size2: rr(0.8, 1.3) * scale, life: rr(0.8, 1.4),
                r: r * 3, g: g * 3, b: b * 3, r2: r * 1.4, g2: g * 1.4, b2: b * 1.4,
                alpha: glowing ? 0.24 : 0.36, drag: 1.5, gravity: -0.1
            })
        }
        if (glowing) {
            this.glow.spawn({ x: point.x, y: point.y + 0.5, z: point.z, size: 0.9 * scale, size2: 1.5 * scale, life: 0.4, r: 0.3, g: 1, b: 0.1, alpha: 0.8, hdr: 1.8 })
        }
        // Chunks: mostly meat, a little bone.
        const chunkCount = Math.round(9 * scale)
        for (let i = 0; i < chunkCount; i++) {
            const a = Math.random() * TAU
            const speed = rr(1.5, 4.5)
            const bone = Math.random() < 0.18
            const hex = bone ? 0xc8bba0 : glowing ? (Math.random() < 0.5 ? 0x2c4a17 : 0x4f7a1e) : (Math.random() < 0.5 ? 0x5a0d10 : 0x7a1a1c)
            this.chunks.spawn(
                point.x, point.y + 0.45, point.z,
                Math.cos(a) * speed, rr(2, 5.2), Math.sin(a) * speed,
                rr(0.05, 0.13) * scale, hex, rr(6, 9)
            )
        }
        this.splatAt(point.x, floor, point.z, rr(1, 1.5) * scale, r, g, b, this.lastGoreGlow)
        for (let i = 0; i < 3; i++) {
            const a = Math.random() * TAU
            const d = rr(0.4, 0.9) * scale
            this.splatAt(point.x + Math.cos(a) * d, floor, point.z + Math.sin(a) * d, rr(0.25, 0.5) * scale, r, g, b, this.lastGoreGlow)
        }
    }

    // -- energy / trails ---------------------------------------------------------------

    /** Energy discharge for the wonder weapon. */
    energyBurst(point: THREE.Vector3, color: number) {
        tmpColor.setHex(color)
        const r = tmpColor.r
        const g = tmpColor.g
        const b = tmpColor.b
        this.glow.spawn({ x: point.x, y: point.y, z: point.z, size: 0.35, size2: 0.9, life: 0.2, r, g, b, alpha: 0.9, hdr: 2.2 })
        for (let i = 0; i < 16; i++) {
            this.sparks.spawn({
                x: point.x, y: point.y, z: point.z,
                vx: rr(-1, 1) * 5, vy: rr(-1, 1) * 5, vz: rr(-1, 1) * 5,
                width: rr(0.01, 0.02), life: rr(0.25, 0.6), r, g, b,
                hot: 1.6, drag: 3.2, lenT: 0.05
            })
        }
    }

    /** Thin wisp behind a flying round. Call it every frame or two while the round flies. */
    trailSmoke(point: THREE.Vector3) {
        this.smoke.spawn({
            x: point.x, y: point.y, z: point.z,
            vx: rr(-0.15, 0.15), vy: rr(0.15, 0.5), vz: rr(-0.15, 0.15),
            size: 0.1, size2: rr(0.35, 0.55), life: rr(0.8, 1.3),
            r: 0.62, g: 0.55, b: 0.48, r2: 0.34, g2: 0.34, b2: 0.35,
            alpha: 0.24, drag: 0.9
        })
    }

    /** A puff of gun smoke at the muzzle. `dir` is the barrel direction. Call once per shot. */
    muzzleSmoke(point: THREE.Vector3, dir: THREE.Vector3) {
        for (let i = 0; i < 2; i++) {
            const sp = rr(0.5, 1.5)
            this.smoke.spawn({
                x: point.x + dir.x * 0.06 * i, y: point.y + dir.y * 0.06 * i, z: point.z + dir.z * 0.06 * i,
                vx: dir.x * sp + rr(-0.12, 0.12), vy: dir.y * sp + rr(0.15, 0.4), vz: dir.z * sp + rr(-0.12, 0.12),
                size: 0.05, size2: rr(0.22, 0.42), life: rr(0.7, 1.3),
                r: 0.6, g: 0.58, b: 0.55, r2: 0.34, g2: 0.34, b2: 0.35,
                alpha: 0.17, drag: 1.7, gravity: -0.05
            })
        }
    }

    /**
     * Crackling lightning between two points for the wonder weapon. It re-rolls
     * its jagged path ~25 times a second for `life` seconds. `width` scales it.
     */
    electricArc(from: THREE.Vector3, to: THREE.Vector3, color: number, life = 0.18, width = 1) {
        const it = this.arcs[this.arcCursor]!
        this.arcCursor = (this.arcCursor + 1) % this.arcs.length
        it.life = life
        it.maxLife = life
        it.fx = from.x; it.fy = from.y; it.fz = from.z
        it.tx = to.x; it.ty = to.y; it.tz = to.z
        tmpColor.setHex(color)
        it.r = tmpColor.r; it.g = tmpColor.g; it.b = tmpColor.b
        it.width = 0.022 * width
        const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
        it.amp = Math.min(0.7, 0.05 + length * 0.07)
        it.reroll = 0
        for (const p of [from, to]) {
            this.glow.spawn({ x: p.x, y: p.y, z: p.z, size: 0.4 * width, size2: 0.7 * width, life: 0.16, r: it.r, g: it.g, b: it.b, alpha: 0.85, hdr: 2.4 })
            for (let i = 0; i < 4; i++) {
                this.sparks.spawn({
                    x: p.x, y: p.y, z: p.z,
                    vx: rr(-1, 1) * 3, vy: rr(-0.4, 1) * 3, vz: rr(-1, 1) * 3,
                    width: 0.01, life: rr(0.15, 0.35), r: it.r, g: it.g, b: it.b, hot: 1.6, drag: 2.5, lenT: 0.05
                })
            }
        }
    }

    private rerollArc(it: ArcItem) {
        const dx = it.tx - it.fx
        const dy = it.ty - it.fy
        const dz = it.tz - it.fz
        for (let i = 0; i <= ARC_SEGMENTS; i++) {
            const t = i / ARC_SEGMENTS
            const env = Math.sin(t * Math.PI)
            const o = i * 3
            it.pts[o] = it.fx + dx * t + rr(-1, 1) * it.amp * env
            it.pts[o + 1] = it.fy + dy * t + rr(-1, 1) * it.amp * env
            it.pts[o + 2] = it.fz + dz * t + rr(-1, 1) * it.amp * env
        }
        for (let k = 0; k < ARC_BRANCHES; k++) {
            it.branchAt[k] = 2 + Math.floor(Math.random() * (ARC_SEGMENTS - 4))
            const o = k * (ARC_BRANCH_SEGMENTS + 1) * 3
            const bx = rr(-1, 1)
            const by = rr(-1, 1)
            const bz = rr(-1, 1)
            for (let j = 0; j <= ARC_BRANCH_SEGMENTS; j++) {
                const f = (j / ARC_BRANCH_SEGMENTS) * it.amp * 2.2
                it.branchPts[o + j * 3] = bx * f + rr(-1, 1) * 0.05
                it.branchPts[o + j * 3 + 1] = by * f + rr(-1, 1) * 0.05
                it.branchPts[o + j * 3 + 2] = bz * f + rr(-1, 1) * 0.05
            }
        }
    }

    private updateArcs(dt: number) {
        for (const it of this.arcs) {
            if (it.life <= 0) continue
            it.life -= dt
            if (it.life <= 0) continue
            it.reroll -= dt
            if (it.reroll <= 0) {
                this.rerollArc(it)
                it.reroll = 0.04
            }
            const fade = Math.min(1, (it.life / it.maxLife) * 3)
            const p = it.pts
            for (let i = 0; i < ARC_SEGMENTS; i++) {
                const o = i * 3
                // A wide soft halo under a thin white-hot core.
                this.glowStreaks.push(p[o + 3]!, p[o + 4]!, p[o + 5]!, it.width * 5, p[o]!, p[o + 1]!, p[o + 2]!, 0.4 * fade, it.r, it.g, it.b, 0.4, 0)
                this.glowStreaks.push(p[o + 3]!, p[o + 4]!, p[o + 5]!, it.width, p[o]!, p[o + 1]!, p[o + 2]!, fade, it.r, it.g, it.b, 2.4, 0)
            }
            for (let k = 0; k < ARC_BRANCHES; k++) {
                const at = it.branchAt[k]! * 3
                const ox = p[at]!
                const oy = p[at + 1]!
                const oz = p[at + 2]!
                const bo = k * (ARC_BRANCH_SEGMENTS + 1) * 3
                const bp = it.branchPts
                for (let j = 0; j < ARC_BRANCH_SEGMENTS; j++) {
                    const o = bo + j * 3
                    this.glowStreaks.push(
                        ox + bp[o + 3]!, oy + bp[o + 4]!, oz + bp[o + 5]!, it.width * 0.55,
                        ox + bp[o]!, oy + bp[o + 1]!, oz + bp[o + 2]!,
                        0.7 * fade * (1 - j / ARC_BRANCH_SEGMENTS), it.r, it.g, it.b, 1.6, 0
                    )
                }
            }
        }
    }

    // -- explosions ------------------------------------------------------------------------

    /**
     * A detonation: white flash, expanding animated fireball, ground shockwave,
     * a smoke column that lingers and drifts, embers, debris, a scorch mark and
     * a short dynamic light. `color` tints the fire (0xffa040 orange, 0x44ffcc
     * for the ray gun); `radius` is the blast radius in metres.
     */
    explosion(point: THREE.Vector3, color: number, radius: number) {
        const s = clamp(radius / 3.2, 0.5, 3)
        tmpColor.setHex(color)
        const cr = tmpColor.r
        const cg = tmpColor.g
        const cb = tmpColor.b
        const floor = floorOf(this.env, point.x, point.z, point.y)
        const low = point.y - floor < 2.2
        const px = point.x
        const py = point.y
        const pz = point.z

        this.onExplosion?.(px, py, pz, radius)

        // Flash: a broad warm bloom and a tiny white core.
        this.glow.spawn({ x: px, y: py + 0.2, z: pz, size: radius * 1.5, size2: radius * 2.1, life: 0.16, r: cr * 0.8 + 0.4, g: cg * 0.8 + 0.3, b: cb * 0.8 + 0.2, alpha: 1, hdr: 2.4 })
        this.glow.spawn({ x: px, y: py + 0.2, z: pz, size: radius * 0.6, size2: radius * 0.9, life: 0.09, r: 1, g: 1, b: 0.95, alpha: 1, hdr: 4.5 })

        // Fireball: overlapping animated billboards that swell and rise.
        for (let i = 0; i < 10; i++) {
            const ry = Math.abs(rr(-1, 1)) * 0.8 + 0.2
            nrm.set(rr(-1, 1), ry, rr(-1, 1)).normalize()
            this.fire.spawn({
                x: px + nrm.x * radius * 0.16, y: py + 0.2 + nrm.y * radius * 0.16, z: pz + nrm.z * radius * 0.16,
                vx: nrm.x * rr(2, 5) * s, vy: nrm.y * rr(2, 5) * s + 1, vz: nrm.z * rr(2, 5) * s,
                size: radius * rr(0.3, 0.5), size2: radius * rr(0.85, 1.35),
                life: rr(0.55, 0.95), r: cr, g: cg, b: cb, alpha: 0.95, hdr: 1.5, drag: 2.4, gravity: -1.2
            })
        }

        // Shockwave along the floor (or at the burst height when it is airborne).
        this.rings.spawn(px, low ? floor + 0.06 : py, pz, radius * 1.6, 0.5, cr * 0.7 + 0.35, cg * 0.7 + 0.3, cb * 0.7 + 0.25)

        // Smoke column: hot and orange for a moment, then a dark drifting stem.
        for (let i = 0; i < 14; i++) {
            const a = Math.random() * TAU
            const d = rr(0, radius * 0.25)
            this.smoke.spawn({
                x: px + Math.cos(a) * d, y: py + rr(0.1, 0.5), z: pz + Math.sin(a) * d,
                vx: Math.cos(a) * rr(0.2, 1.2), vy: rr(1.2, 2.8) * s, vz: Math.sin(a) * rr(0.2, 1.2),
                size: radius * 0.24, size2: radius * rr(0.8, 1.4), life: rr(3.5, 6),
                r: cr * 0.55 + 0.1, g: cg * 0.3 + 0.08, b: cb * 0.2 + 0.06, r2: 0.09 + cr * 0.03, g2: 0.09 + cg * 0.03, b2: 0.1 + cb * 0.03,
                alpha: rr(0.55, 0.7), drag: 0.55, gravity: -0.18, spin: rr(-0.3, 0.3)
            })
        }
        // Low ground dust rolling outward.
        for (let i = 0; i < 8; i++) {
            const a = Math.random() * TAU
            const sp = rr(3, 6.5) * s
            this.smoke.spawn({
                x: px, y: floor + 0.3, z: pz,
                vx: Math.cos(a) * sp, vy: rr(0.2, 0.7), vz: Math.sin(a) * sp,
                size: 0.5 * s, size2: rr(1.4, 2.2) * s, life: rr(1.2, 2.2),
                r: 0.36, g: 0.32, b: 0.27, r2: 0.2, g2: 0.19, b2: 0.18,
                alpha: 0.42, drag: 2.4
            })
        }

        // Embers.
        const embers = Math.round(28 * Math.min(1.6, s))
        for (let i = 0; i < embers; i++) {
            nrm.set(rr(-1, 1), rr(0.1, 1), rr(-1, 1)).normalize()
            const sp = rr(5, 14) * s
            this.sparks.spawn({
                x: px, y: py + 0.2, z: pz,
                vx: nrm.x * sp, vy: nrm.y * sp, vz: nrm.z * sp,
                width: rr(0.02, 0.045), life: rr(0.5, 1.3),
                r: cr, g: cg * 0.8 + 0.1, b: cb * 0.5, hot: 1.5, gravity: 9, drag: 0.5, bounce: 0.3, lenT: 0.04
            })
        }
        // Debris.
        for (let i = 0; i < 8; i++) {
            const a = Math.random() * TAU
            const sp = rr(3, 8) * s
            this.chunks.spawn(px, py + 0.3, pz, Math.cos(a) * sp, rr(3, 8), Math.sin(a) * sp, rr(0.06, 0.2), Math.random() < 0.5 ? 0x2a2926 : 0x55524c, rr(4, 7))
        }
        if (low) this.scorch.spawn(px, floor, pz, 0, 1, 0, radius * 1.5, 1, 1, 1, 0.85, 90)

        const boom = this.takeLight()
        boom.light.position.set(px, py + 0.6, pz)
        boom.light.color.setRGB(cr * 0.7 + 0.35, cg * 0.7 + 0.3, cb * 0.7 + 0.2)
        boom.light.distance = 10 + radius * 4
        boom.peak = 45 + radius * 14
        boom.life = 0.5
        boom.maxLife = 0.5
        boom.light.intensity = boom.peak
    }

    // -- casings -----------------------------------------------------------------------------

    /** Brass out of the ejection port. It falls, bounces and settles on the floor. */
    ejectCasing(origin: THREE.Vector3, right: THREE.Vector3) {
        this.casings.eject(origin.x, origin.y, origin.z, right.x, right.z)
    }

    // -- frame ------------------------------------------------------------------------------------

    update(dt: number) {
        dt = clamp(dt, 0, 0.05)
        this.glowStreaks.begin()
        this.dropStreaks.begin()
        this.sparks.update(dt, this.glowStreaks)
        this.glowDrops.update(dt, this.glowStreaks)
        this.drops.update(dt, this.dropStreaks)
        this.updateTracers(dt)
        this.updateArcs(dt)
        this.glowStreaks.end()
        this.dropStreaks.end()

        this.smoke.update(dt)
        this.glow.update(dt)
        this.fire.update(dt)
        this.rings.update(dt)
        this.chunks.update(dt)
        this.casings.update(dt)
        this.holes.update(dt)
        this.splats.update(dt)
        this.scorch.update(dt)
        this.dust.update(dt)
        this.spores.update(dt)

        for (const l of this.lights) {
            if (l.life <= 0) continue
            l.life -= dt
            const k = Math.max(0, l.life / l.maxLife)
            l.light.intensity = l.life > 0 ? l.peak * k * k : 0
        }
    }

    /** Drops every live effect (persistent decals included) — called when a run restarts. */
    clear() {
        this.sparks.clear()
        this.glowDrops.clear()
        this.drops.clear()
        for (const it of this.tracers) it.life = 0
        for (const it of this.arcs) it.life = 0
        this.glowStreaks.begin()
        this.glowStreaks.end()
        this.dropStreaks.begin()
        this.dropStreaks.end()
        this.smoke.clear()
        this.glow.clear()
        this.fire.clear()
        this.rings.clear()
        this.holes.clear()
        this.splats.clear()
        this.scorch.clear()
        this.chunks.clear()
        this.casings.clear()
        for (const l of this.lights) {
            l.life = 0
            l.light.intensity = 0
        }
    }

    dispose() {
        this.clear()
        this.scene.remove(this.group)
        this.glowStreaks.dispose()
        this.dropStreaks.dispose()
        this.smoke.dispose()
        this.glow.dispose()
        this.fire.dispose()
        this.rings.dispose()
        this.holes.dispose()
        this.splats.dispose()
        this.scorch.dispose()
        this.chunks.dispose()
        this.casings.dispose()
        this.dust.dispose()
        this.spores.dispose()
        for (const texture of this.textures) texture.dispose()
        for (const l of this.lights) l.light.dispose()
    }
}
