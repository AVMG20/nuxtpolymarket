// Billboard particle pools for Voxel Arena: additive glow sprites (sparks,
// flashes, fire, energy) and alpha-blended smoke. Everything is simulated on
// the CPU into flat arrays and drawn as a single instanced quad per pool.
// Purely cosmetic, so Math.random is fine here.
import * as THREE from 'three'

export type SpriteShape = 'soft' | 'spark' | 'ring' | 'star'

export interface EmitOpts {
    x: number
    y: number
    z: number
    vx?: number
    vy?: number
    vz?: number
    life: number
    /** Start size (world units, full quad width). */
    size: number
    /** End size; defaults to `size`. */
    sizeEnd?: number
    color: number | THREE.Color
    /** Colour to fade towards; defaults to `color`. */
    colorEnd?: number | THREE.Color
    alpha?: number
    gravity?: number
    /** Per-second velocity damping (0 = none, 4 = strong). */
    drag?: number
    shape?: SpriteShape
    /** Initial roll in radians (ignored for stretched sprites). */
    rot?: number
    spin?: number
    /** >0 aligns the quad with its velocity and stretches it by speed × factor. */
    stretch?: number
    /** Fraction of the life spent fading in. */
    fadeIn?: number
    /** Bounce off the floor (y = 0) with this restitution. */
    bounce?: number
}

const SHAPE_UV: Record<SpriteShape, [number, number]> = {
    soft: [0, 0.5],
    spark: [0.5, 0.5],
    ring: [0, 0],
    star: [0.5, 0]
}

let atlas: THREE.Texture | null = null

/** A 2×2 atlas: soft glow, hard spark, ring, four-point star. */
function spriteAtlas(): THREE.Texture {
    if (atlas) return atlas
    const size = 256
    const cell = size / 2
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
    const radial = (cx: number, cy: number, stops: [number, string][]) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell / 2)
        for (const [o, c] of stops) g.addColorStop(o, c)
        ctx.fillStyle = g
        ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell)
    }
    // soft glow (top-left)
    radial(cell / 2, cell / 2, [[0, '#fff'], [0.25, '#fff'], [0.55, '#666'], [1, '#000']])
    // hard spark (top-right)
    radial(cell + cell / 2, cell / 2, [[0, '#fff'], [0.35, '#fff'], [0.5, '#444'], [0.7, '#000']])
    // ring (bottom-left)
    radial(cell / 2, cell + cell / 2, [[0, '#000'], [0.6, '#000'], [0.75, '#fff'], [0.85, '#fff'], [1, '#000']])
    // star (bottom-right): a soft core with four thin rays
    const sx = cell + cell / 2
    const sy = cell + cell / 2
    radial(sx, sy, [[0, '#fff'], [0.2, '#ddd'], [0.45, '#222'], [1, '#000']])
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 4; i++) {
        const g = ctx.createLinearGradient(sx, sy, sx + Math.cos(i * Math.PI / 2) * cell / 2, sy + Math.sin(i * Math.PI / 2) * cell / 2)
        g.addColorStop(0, '#fff')
        g.addColorStop(0.5, '#888')
        g.addColorStop(1, '#000')
        ctx.strokeStyle = g
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + Math.cos(i * Math.PI / 2) * cell / 2, sy + Math.sin(i * Math.PI / 2) * cell / 2)
        ctx.stroke()
    }
    atlas = new THREE.CanvasTexture(canvas)
    atlas.colorSpace = THREE.NoColorSpace
    atlas.minFilter = THREE.LinearMipmapLinearFilter
    atlas.magFilter = THREE.LinearFilter
    atlas.generateMipmaps = true
    return atlas
}

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec2 iSize;
attribute float iRot;
attribute vec4 iColor;
attribute vec2 iUv;
attribute vec3 iDir;
varying vec2 vUv;
varying vec4 vColor;
void main() {
    vec4 vp = modelViewMatrix * vec4(iPos, 1.0);
    float rot = iRot;
    vec2 size = iSize;
    if (dot(iDir, iDir) > 0.0) {
        vec3 vd = mat3(modelViewMatrix) * iDir;
        rot = atan(vd.y, vd.x);
    }
    float c = cos(rot);
    float s = sin(rot);
    vec2 p = position.xy * size;
    vp.xy += vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    gl_Position = projectionMatrix * vp;
    vUv = iUv + uv * 0.5;
    vColor = iColor;
    // fade out anything about to pass through the camera so it never fills the screen
    vColor.a *= clamp((-vp.z - 0.25) / 0.35, 0.0, 1.0);
}`

const FRAG = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
    float m = texture2D(map, vUv).r;
    gl_FragColor = vec4(vColor.rgb, vColor.a * m);
}`

const FRAG_SMOKE = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
    float m = texture2D(map, vUv).r;
    gl_FragColor = vec4(vColor.rgb, vColor.a * m);
    if (gl_FragColor.a < 0.004) discard;
}`

const _c = new THREE.Color()

export class SpritePool {
    readonly mesh: THREE.Mesh
    private readonly max: number
    private count = 0
    private readonly px: Float32Array
    private readonly py: Float32Array
    private readonly pz: Float32Array
    private readonly vx: Float32Array
    private readonly vy: Float32Array
    private readonly vz: Float32Array
    private readonly life: Float32Array
    private readonly maxLife: Float32Array
    private readonly size0: Float32Array
    private readonly size1: Float32Array
    private readonly col0: Float32Array
    private readonly col1: Float32Array
    private readonly alpha: Float32Array
    private readonly gravity: Float32Array
    private readonly drag: Float32Array
    private readonly rot: Float32Array
    private readonly spin: Float32Array
    private readonly stretch: Float32Array
    private readonly fadeIn: Float32Array
    private readonly bounce: Float32Array
    private readonly uvx: Float32Array
    private readonly uvy: Float32Array
    private readonly aPos: THREE.InstancedBufferAttribute
    private readonly aSize: THREE.InstancedBufferAttribute
    private readonly aRot: THREE.InstancedBufferAttribute
    private readonly aColor: THREE.InstancedBufferAttribute
    private readonly aUv: THREE.InstancedBufferAttribute
    private readonly aDir: THREE.InstancedBufferAttribute
    private readonly geometry: THREE.InstancedBufferGeometry
    private readonly material: THREE.ShaderMaterial

    constructor(max: number, readonly additive: boolean) {
        this.max = max
        const f = () => new Float32Array(max)
        this.px = f()
        this.py = f()
        this.pz = f()
        this.vx = f()
        this.vy = f()
        this.vz = f()
        this.life = f()
        this.maxLife = f()
        this.size0 = f()
        this.size1 = f()
        this.col0 = new Float32Array(max * 3)
        this.col1 = new Float32Array(max * 3)
        this.alpha = f()
        this.gravity = f()
        this.drag = f()
        this.rot = f()
        this.spin = f()
        this.stretch = f()
        this.fadeIn = f()
        this.bounce = f()
        this.uvx = f()
        this.uvy = f()

        const plane = new THREE.PlaneGeometry(1, 1)
        const geo = new THREE.InstancedBufferGeometry()
        geo.index = plane.index
        geo.setAttribute('position', plane.getAttribute('position'))
        geo.setAttribute('uv', plane.getAttribute('uv'))
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
        this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2)
        this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1)
        this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4)
        this.aUv = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2)
        this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
        for (const a of [this.aPos, this.aSize, this.aRot, this.aColor, this.aUv, this.aDir]) a.setUsage(THREE.DynamicDrawUsage)
        geo.setAttribute('iPos', this.aPos)
        geo.setAttribute('iSize', this.aSize)
        geo.setAttribute('iRot', this.aRot)
        geo.setAttribute('iColor', this.aColor)
        geo.setAttribute('iUv', this.aUv)
        geo.setAttribute('iDir', this.aDir)
        geo.instanceCount = 0
        this.geometry = geo
        this.material = new THREE.ShaderMaterial({
            uniforms: { map: { value: spriteAtlas() } },
            vertexShader: VERT,
            fragmentShader: additive ? FRAG : FRAG_SMOKE,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            side: THREE.DoubleSide
        })
        this.mesh = new THREE.Mesh(geo, this.material)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = additive ? 20 : 10
    }

    get active(): number {
        return this.count
    }

    emit(o: EmitOpts): void {
        if (this.count >= this.max) {
            // recycle the oldest so heavy scenes degrade instead of stalling
            this.remove(0)
        }
        const i = this.count++
        this.px[i] = o.x
        this.py[i] = o.y
        this.pz[i] = o.z
        this.vx[i] = o.vx ?? 0
        this.vy[i] = o.vy ?? 0
        this.vz[i] = o.vz ?? 0
        this.life[i] = o.life
        this.maxLife[i] = o.life
        this.size0[i] = o.size
        this.size1[i] = o.sizeEnd ?? o.size
        _c.set(o.color)
        this.col0[i * 3] = _c.r
        this.col0[i * 3 + 1] = _c.g
        this.col0[i * 3 + 2] = _c.b
        if (o.colorEnd !== undefined) _c.set(o.colorEnd)
        this.col1[i * 3] = _c.r
        this.col1[i * 3 + 1] = _c.g
        this.col1[i * 3 + 2] = _c.b
        this.alpha[i] = o.alpha ?? 1
        this.gravity[i] = o.gravity ?? 0
        this.drag[i] = o.drag ?? 0
        this.rot[i] = o.rot ?? 0
        this.spin[i] = o.spin ?? 0
        this.stretch[i] = o.stretch ?? 0
        this.fadeIn[i] = o.fadeIn ?? 0
        this.bounce[i] = o.bounce ?? 0
        const uv = SHAPE_UV[o.shape ?? 'soft']
        this.uvx[i] = uv[0]
        this.uvy[i] = uv[1]
    }

    private remove(i: number): void {
        const last = --this.count
        if (i === last) return
        this.px[i] = this.px[last]!
        this.py[i] = this.py[last]!
        this.pz[i] = this.pz[last]!
        this.vx[i] = this.vx[last]!
        this.vy[i] = this.vy[last]!
        this.vz[i] = this.vz[last]!
        this.life[i] = this.life[last]!
        this.maxLife[i] = this.maxLife[last]!
        this.size0[i] = this.size0[last]!
        this.size1[i] = this.size1[last]!
        for (let k = 0; k < 3; k++) {
            this.col0[i * 3 + k] = this.col0[last * 3 + k]!
            this.col1[i * 3 + k] = this.col1[last * 3 + k]!
        }
        this.alpha[i] = this.alpha[last]!
        this.gravity[i] = this.gravity[last]!
        this.drag[i] = this.drag[last]!
        this.rot[i] = this.rot[last]!
        this.spin[i] = this.spin[last]!
        this.stretch[i] = this.stretch[last]!
        this.fadeIn[i] = this.fadeIn[last]!
        this.bounce[i] = this.bounce[last]!
        this.uvx[i] = this.uvx[last]!
        this.uvy[i] = this.uvy[last]!
    }

    clear(): void {
        this.count = 0
        this.geometry.instanceCount = 0
    }

    update(dt: number): void {
        const pos = this.aPos.array as Float32Array
        const size = this.aSize.array as Float32Array
        const rot = this.aRot.array as Float32Array
        const color = this.aColor.array as Float32Array
        const uv = this.aUv.array as Float32Array
        const dir = this.aDir.array as Float32Array
        for (let i = 0; i < this.count; i++) {
            const nl = this.life[i]! - dt
            if (nl <= 0) {
                this.remove(i)
                i--
                continue
            }
            this.life[i] = nl
            const t = 1 - nl / this.maxLife[i]!
            let vx = this.vx[i]!
            let vy = this.vy[i]! - this.gravity[i]! * dt
            let vz = this.vz[i]!
            const drag = this.drag[i]!
            if (drag > 0) {
                const k = Math.max(0, 1 - drag * dt)
                vx *= k
                vy *= k
                vz *= k
            }
            const x = this.px[i]! + vx * dt
            let y = this.py[i]! + vy * dt
            const z = this.pz[i]! + vz * dt
            const bounce = this.bounce[i]!
            if (bounce > 0 && y < 0.05 && vy < 0) {
                y = 0.05
                vy = -vy * bounce
                vx *= 0.6
                vz *= 0.6
            }
            this.vx[i] = vx
            this.vy[i] = vy
            this.vz[i] = vz
            this.px[i] = x
            this.py[i] = y
            this.pz[i] = z
            this.rot[i] = this.rot[i]! + this.spin[i]! * dt

            // eased size, colour crossfade and a fade curve with an optional ramp in
            const s = this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t
            const fi = this.fadeIn[i]!
            let a = this.alpha[i]! * (1 - t) * (1 - t * 0.35)
            if (fi > 0 && t < fi) a *= t / fi
            const stretch = this.stretch[i]!
            pos[i * 3] = x
            pos[i * 3 + 1] = y
            pos[i * 3 + 2] = z
            if (stretch > 0) {
                const speed = Math.hypot(vx, vy, vz)
                size[i * 2] = s * (1 + speed * stretch)
                size[i * 2 + 1] = s
                const inv = speed > 1e-4 ? 1 / speed : 0
                dir[i * 3] = vx * inv
                dir[i * 3 + 1] = vy * inv
                dir[i * 3 + 2] = vz * inv
            } else {
                size[i * 2] = s
                size[i * 2 + 1] = s
                dir[i * 3] = 0
                dir[i * 3 + 1] = 0
                dir[i * 3 + 2] = 0
            }
            rot[i] = this.rot[i]!
            color[i * 4] = this.col0[i * 3]! + (this.col1[i * 3]! - this.col0[i * 3]!) * t
            color[i * 4 + 1] = this.col0[i * 3 + 1]! + (this.col1[i * 3 + 1]! - this.col0[i * 3 + 1]!) * t
            color[i * 4 + 2] = this.col0[i * 3 + 2]! + (this.col1[i * 3 + 2]! - this.col0[i * 3 + 2]!) * t
            color[i * 4 + 3] = a
            uv[i * 2] = this.uvx[i]!
            uv[i * 2 + 1] = this.uvy[i]!
        }
        this.geometry.instanceCount = this.count
        if (this.count > 0) {
            this.aPos.addUpdateRange(0, this.count * 3)
            this.aSize.addUpdateRange(0, this.count * 2)
            this.aRot.addUpdateRange(0, this.count)
            this.aColor.addUpdateRange(0, this.count * 4)
            this.aUv.addUpdateRange(0, this.count * 2)
            this.aDir.addUpdateRange(0, this.count * 3)
            for (const a of [this.aPos, this.aSize, this.aRot, this.aColor, this.aUv, this.aDir]) a.needsUpdate = true
        }
    }

    dispose(): void {
        this.geometry.dispose()
        this.material.dispose()
    }
}

/** Uniform direction inside a cone around `dir` (half-angle in radians). */
export function coneDir(out: THREE.Vector3, dir: THREE.Vector3, halfAngle: number): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2
    const cosMin = Math.cos(halfAngle)
    const cz = cosMin + Math.random() * (1 - cosMin)
    const sz = Math.sqrt(Math.max(0, 1 - cz * cz))
    // build a basis around dir
    const up = Math.abs(dir.y) < 0.9 ? UP : RIGHT
    _t1.crossVectors(dir, up).normalize()
    _t2.crossVectors(_t1, dir)
    return out.copy(dir).multiplyScalar(cz).addScaledVector(_t1, Math.cos(a) * sz).addScaledVector(_t2, Math.sin(a) * sz)
}

const UP = new THREE.Vector3(0, 1, 0)
const RIGHT = new THREE.Vector3(1, 0, 0)
const _t1 = new THREE.Vector3()
const _t2 = new THREE.Vector3()
