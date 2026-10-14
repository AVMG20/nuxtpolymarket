import * as THREE from 'three'
import type { HackerzProjectile } from '#shared/utils/gamelogic/hackerz'
import { hdr } from './models'
import { randRange } from './math'

/**
 * Cosmetic systems. Nothing in here decides an outcome, which is why it may use
 * `Math.random` (through `randRange`) freely.
 */

// ─── Particles ──────────────────────────────────────────────────────────────

const PARTICLE_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
uniform float uScale;
void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Never smaller than ~2 px, or a far spark flickers into a dot.
    gl_PointSize = max(2.0, aSize * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
}
`

const PARTICLE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec2 p = gl_PointCoord - 0.5;
    // Square sparks: this world has no round things in it.
    float d = max(abs(p.x), abs(p.y));
    float a = smoothstep(0.5, 0.2, d) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
}
`

/** A fixed-capacity additive point cloud, simulated on the CPU. */
export class ParticleSystem {
    readonly points: THREE.Points
    private positions: Float32Array
    private colors: Float32Array
    private sizes: Float32Array
    private alphas: Float32Array
    private velocity: Float32Array
    private life: Float32Array
    private maxLife: Float32Array
    private gravity: Float32Array
    private drag: Float32Array
    private baseSize: Float32Array
    private cursor = 0
    readonly material: THREE.ShaderMaterial
    /** While set, nothing new is emitted: a packet-loss spike shows no fresh sparks. */
    muted = false

    constructor(private capacity: number) {
        this.positions = new Float32Array(capacity * 3)
        this.colors = new Float32Array(capacity * 3)
        this.sizes = new Float32Array(capacity)
        this.alphas = new Float32Array(capacity)
        this.velocity = new Float32Array(capacity * 3)
        this.life = new Float32Array(capacity)
        this.maxLife = new Float32Array(capacity)
        this.gravity = new Float32Array(capacity)
        this.drag = new Float32Array(capacity)
        this.baseSize = new Float32Array(capacity)

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage))
        geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage))
        this.material = new THREE.ShaderMaterial({
            uniforms: { uScale: { value: 300 } },
            vertexShader: PARTICLE_VERTEX,
            fragmentShader: PARTICLE_FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        })
        this.points = new THREE.Points(geometry, this.material)
        this.points.frustumCulled = false
    }

    /** Point size scales with the viewport so sparks keep their size across screens. */
    setViewportHeight(pixels: number) {
        this.material.uniforms.uScale!.value = pixels * 0.42
    }

    emit(
        pos: THREE.Vector3, vel: THREE.Vector3, hex: number,
        opts: { size?: number, life?: number, gravity?: number, drag?: number, intensity?: number } = {}
    ) {
        if (this.muted) return
        const i = this.cursor
        this.cursor = (this.cursor + 1) % this.capacity
        const colour = hdr(hex, opts.intensity ?? 2.4)
        this.positions.set([pos.x, pos.y, pos.z], i * 3)
        this.velocity.set([vel.x, vel.y, vel.z], i * 3)
        this.colors.set([colour.r, colour.g, colour.b], i * 3)
        this.baseSize[i] = opts.size ?? 0.25
        this.life[i] = this.maxLife[i] = opts.life ?? 0.5
        this.gravity[i] = opts.gravity ?? 14
        this.drag[i] = opts.drag ?? 1.5
    }

    burst(pos: THREE.Vector3, hex: number, count: number, speed: number, opts: Parameters<ParticleSystem['emit']>[3] = {}) {
        const vel = new THREE.Vector3()
        for (let n = 0; n < count; n++) {
            vel.set(randRange(-1, 1), randRange(-0.2, 1), randRange(-1, 1)).normalize().multiplyScalar(speed * randRange(0.4, 1))
            this.emit(pos, vel, hex, { ...opts, life: (opts.life ?? 0.5) * randRange(0.6, 1.2) })
        }
    }

    update(dt: number) {
        for (let i = 0; i < this.capacity; i++) {
            if (this.life[i]! <= 0) {
                this.alphas[i] = 0
                continue
            }
            this.life[i]! -= dt
            const k = i * 3
            const drag = Math.max(0, 1 - this.drag[i]! * dt)
            this.velocity[k]! *= drag
            this.velocity[k + 1] = this.velocity[k + 1]! * drag - this.gravity[i]! * dt
            this.velocity[k + 2]! *= drag
            this.positions[k]! += this.velocity[k]! * dt
            this.positions[k + 1] = Math.max(0.05, this.positions[k + 1]! + this.velocity[k + 1]! * dt)
            this.positions[k + 2]! += this.velocity[k + 2]! * dt
            const t = Math.max(0, this.life[i]! / this.maxLife[i]!)
            this.alphas[i] = Math.min(1, t * 2)
            this.sizes[i] = this.baseSize[i]! * (0.5 + t * 0.5)
        }
        const geometry = this.points.geometry
        for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
            (geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true
        }
    }

    clear() {
        this.life.fill(0)
        this.alphas.fill(0)
    }
}

// ─── Transient meshes ───────────────────────────────────────────────────────

interface Transient {
    object: THREE.Object3D
    age: number
    life: number
    update: (t: number) => void
}

const ringGeometry = new THREE.RingGeometry(0.92, 1, 48)
const sphereGeometry = new THREE.IcosahedronGeometry(1, 0)
const additive = (hex: number, intensity: number, opacity = 1) => new THREE.MeshBasicMaterial({
    color: hdr(hex, intensity),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide
})

/** Rings, bolts, flashes and the purge sweep — each lives a fixed time, then goes. */
export class TransientFx {
    private items: Transient[] = []
    /** While set, combat flashes are dropped: a packet-loss spike shows nothing new. The purge sweep still runs. */
    muted = false

    constructor(private scene: THREE.Scene) {}

    private add(object: THREE.Object3D, life: number, update: (t: number) => void) {
        this.scene.add(object)
        this.items.push({ object, age: 0, life, update })
    }

    /** A flat shockwave on the ground (or at height), expanding to `radius` world units. */
    ring(pos: THREE.Vector3, hex: number, radius: number, life = 0.45, intensity = 2.2) {
        if (this.muted) return
        const material = additive(hex, intensity)
        const mesh = new THREE.Mesh(ringGeometry, material)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.copy(pos)
        mesh.position.y = Math.max(0.08, pos.y)
        this.add(mesh, life, (t) => {
            const r = 0.2 + radius * (1 - (1 - t) * (1 - t))
            mesh.scale.setScalar(r)
            material.opacity = 1 - t
        })
    }

    /** A brief glowing ball — muzzle flashes and impact pops. */
    flash(pos: THREE.Vector3, hex: number, size: number, life = 0.09, intensity = 3) {
        if (this.muted) return
        const material = additive(hex, intensity)
        const mesh = new THREE.Mesh(sphereGeometry, material)
        mesh.position.copy(pos)
        this.add(mesh, life, (t) => {
            mesh.scale.setScalar(size * (1 - t * 0.6))
            material.opacity = 1 - t
        })
    }

    /** Chain lightning: a jagged polyline that flickers out. */
    bolt(from: THREE.Vector3, to: THREE.Vector3, hex: number) {
        if (this.muted) return
        const points: THREE.Vector3[] = []
        const steps = 7
        for (let i = 0; i <= steps; i++) {
            const p = from.clone().lerp(to, i / steps)
            if (i > 0 && i < steps) p.add(new THREE.Vector3(randRange(-0.5, 0.5), randRange(-0.4, 0.4), randRange(-0.5, 0.5)))
            points.push(p)
        }
        const material = new THREE.LineBasicMaterial({ color: hdr(hex, 4), transparent: true, toneMapped: false })
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material)
        this.add(line, 0.18, (t) => { material.opacity = 1 - t })
    }

    /** A straight beam — the Longbore and the Lance draw their whole path for a beat. */
    beam(from: THREE.Vector3, to: THREE.Vector3, hex: number, life = 0.14) {
        if (this.muted) return
        const material = new THREE.LineBasicMaterial({ color: hdr(hex, 4), transparent: true, toneMapped: false })
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material)
        this.add(line, life, (t) => { material.opacity = 1 - t })
    }

    /** A column of light rising where something died. */
    pillar(pos: THREE.Vector3, hex: number, height: number) {
        if (this.muted) return
        const material = additive(hex, 2.2, 0.8)
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), material)
        mesh.position.copy(pos)
        this.add(mesh, 0.5, (t) => {
            mesh.scale.set(1 - t, height * (0.3 + t), 1 - t)
            mesh.position.y = pos.y + height * (0.3 + t) / 2
            material.opacity = 0.8 * (1 - t)
        })
    }

    /** The end-of-wave purge: a wall of light moving out from the wall. */
    sweep(width: number, height: number, from: number, to: number, ms: number, onFront: (z: number) => void, onDone: () => void) {
        const material = additive(0xffffff, 2.4, 0.9)
        const group = new THREE.Group()
        const blade = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
        blade.position.y = height / 2
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(width, height * 0.6), additive(0x22d3ee, 1.6, 0.4))
        halo.position.set(0, height * 0.3, 1.5)
        group.add(blade, halo)
        group.position.z = from
        let done = false
        this.add(group, ms / 1000, (t) => {
            const eased = t * t
            group.position.z = from + (to - from) * eased
            onFront(group.position.z)
            if (t >= 1 && !done) {
                done = true
                onDone()
            }
        })
    }

    update(dt: number) {
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i]!
            item.age += dt
            const t = Math.min(1, item.age / item.life)
            item.update(t)
            if (t >= 1) {
                this.dispose(item)
                this.items.splice(i, 1)
            }
        }
    }

    clear() {
        for (const item of this.items) this.dispose(item)
        this.items = []
    }

    private dispose(item: Transient) {
        item.object.removeFromParent()
        item.object.traverse((node) => {
            const mesh = node as THREE.Mesh
            const material = mesh.material as THREE.Material | undefined
            material?.dispose()
            // Shared geometries are module-level and stay; one-offs are freed.
            if (mesh.geometry && mesh.geometry !== ringGeometry && mesh.geometry !== sphereGeometry) mesh.geometry.dispose()
        })
    }
}

// ─── Projectiles ────────────────────────────────────────────────────────────

/**
 * Rounds are long, fat streaks: seen from the deck a rail round crosses the
 * whole field in a third of a second, and anything thinner reads as no shot at all.
 */
const projectileGeometry = {
    rail: new THREE.BoxGeometry(0.26, 0.26, 3.2),
    pellet: new THREE.BoxGeometry(0.3, 0.3, 1.2),
    arc: new THREE.BoxGeometry(0.2, 0.4, 2.4),
    missile: new THREE.ConeGeometry(0.32, 1.3, 4).rotateX(Math.PI / 2),
    slug: new THREE.BoxGeometry(0.36, 0.36, 5)
} satisfies Record<HackerzProjectile, THREE.BufferGeometry>

const projectileMaterials = new Map<string, THREE.MeshBasicMaterial>()

/** A round in flight, oriented along +Z; the engine points it down its velocity. */
export function makeProjectile(kind: HackerzProjectile, hex: number, crit: boolean, fromTurret: boolean) {
    const key = `${hex}:${crit}:${fromTurret}`
    let material = projectileMaterials.get(key)
    if (!material) {
        material = new THREE.MeshBasicMaterial({
            color: hdr(crit ? 0xfde047 : hex, fromTurret ? 2.2 : crit ? 5 : 3.4),
            toneMapped: false
        })
        projectileMaterials.set(key, material)
    }
    const mesh = new THREE.Mesh(projectileGeometry[kind], material)
    if (fromTurret) mesh.scale.setScalar(0.75)
    return mesh
}

const spitGeometry = new THREE.OctahedronGeometry(0.3, 0)
const spitMaterials = new Map<number, THREE.MeshBasicMaterial>()

export function makeSpit(hex: number, heavy: boolean) {
    let material = spitMaterials.get(hex)
    if (!material) {
        material = new THREE.MeshBasicMaterial({ color: hdr(hex, 3.2), toneMapped: false })
        spitMaterials.set(hex, material)
    }
    const mesh = new THREE.Mesh(spitGeometry, material)
    if (heavy) mesh.scale.setScalar(1.7)
    return mesh
}

const coinGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 8).rotateX(Math.PI / 2)
const coinMaterial = new THREE.MeshBasicMaterial({ color: hdr(0xfbbf24, 2.6), toneMapped: false })

export function makeCoin(scale: number) {
    const mesh = new THREE.Mesh(coinGeometry, coinMaterial)
    mesh.scale.setScalar(scale)
    return mesh
}

// ─── Overlay ────────────────────────────────────────────────────────────────

interface FloatText {
    pos: THREE.Vector3
    text: string
    color: string
    scale: number
    age: number
}

interface Banner {
    text: string
    sub?: string
    color: string
    age: number
}

export interface HealthTag {
    pos: THREE.Vector3
    fraction: number
    color: string
    armored: boolean
    width: number
}

/** A unit a radar ping has lit, drawn as fading corner brackets. */
export interface RadarMarker {
    pos: THREE.Vector3
    size: number
    alpha: number
    cloaked: boolean
}

export const hexCss = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`

const FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

/** Everything flat: numbers, banners, health bars and the target reticle. */
export class Overlay {
    private floats: FloatText[] = []
    private banners: Banner[] = []
    private _screen = { x: 0, y: 0 }
    /** While set, no new floating numbers appear: a packet-loss spike shows nothing new. Banners still do. */
    muted = false

    floatText(pos: THREE.Vector3, text: string, hex: number, scale = 1) {
        if (this.muted) return
        if (this.floats.length > 90) this.floats.shift()
        this.floats.push({ pos: pos.clone(), text, color: hexCss(hex), scale, age: 0 })
    }

    banner(text: string, hex: number, sub?: string) {
        this.banners.push({ text, sub, color: hexCss(hex), age: 0 })
    }

    clear() {
        this.floats = []
        this.banners = []
    }

    draw(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        dt: number,
        project: (p: THREE.Vector3, out: { x: number, y: number }) => { x: number, y: number } | null,
        health: HealthTag[],
        reticle: { pos: THREE.Vector3, size: number, color: string } | null,
        time: number,
        markers: RadarMarker[] = []
    ) {
        ctx.clearRect(0, 0, width, height)
        const s = this._screen

        // Radar contacts: four corner brackets, fading out with the ping.
        for (const marker of markers) {
            if (!project(marker.pos, s)) continue
            const r = marker.size
            const leg = Math.max(4, r * 0.35)
            ctx.save()
            ctx.globalAlpha = Math.max(0, Math.min(1, marker.alpha))
            ctx.strokeStyle = marker.cloaked ? '#f0abfc' : '#a3e635'
            ctx.lineWidth = 2
            ctx.shadowColor = ctx.strokeStyle
            ctx.shadowBlur = 6
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
                ctx.beginPath()
                ctx.moveTo(s.x + sx * r, s.y + sy * r - sy * leg)
                ctx.lineTo(s.x + sx * r, s.y + sy * r)
                ctx.lineTo(s.x + sx * r - sx * leg, s.y + sy * r)
                ctx.stroke()
            }
            ctx.restore()
        }

        for (const tag of health) {
            if (!project(tag.pos, s)) continue
            const w = tag.width
            ctx.fillStyle = 'rgba(0,0,0,0.6)'
            ctx.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, 5)
            ctx.fillStyle = tag.color
            ctx.fillRect(s.x - w / 2, s.y, w * Math.max(0, tag.fraction), 3)
            if (tag.armored) {
                ctx.strokeStyle = '#fbbf24'
                ctx.lineWidth = 1
                ctx.strokeRect(s.x - w / 2 - 1.5, s.y - 1.5, w + 3, 6)
            }
        }

        if (reticle && project(reticle.pos, s)) {
            const r = reticle.size
            const spin = time * 1.6
            ctx.save()
            ctx.translate(s.x, s.y)
            ctx.strokeStyle = reticle.color
            ctx.lineWidth = 2
            ctx.shadowColor = reticle.color
            ctx.shadowBlur = 8
            for (let i = 0; i < 4; i++) {
                const a = spin + i * Math.PI / 2
                ctx.beginPath()
                ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
                ctx.lineTo(Math.cos(a) * (r + 7), Math.sin(a) * (r + 7))
                ctx.stroke()
            }
            ctx.strokeRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4)
            ctx.restore()
        }

        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let i = this.floats.length - 1; i >= 0; i--) {
            const f = this.floats[i]!
            f.age += dt
            if (f.age > 0.75) {
                this.floats.splice(i, 1)
                continue
            }
            if (!project(f.pos, s)) continue
            const t = f.age / 0.75
            ctx.globalAlpha = 1 - t * t
            ctx.font = `700 ${Math.round(14 * f.scale)}px ${FONT}`
            ctx.fillStyle = 'rgba(0,0,0,0.75)'
            ctx.fillText(f.text, s.x + 1, s.y - t * 34 + 1)
            ctx.fillStyle = f.color
            ctx.fillText(f.text, s.x, s.y - t * 34)
        }
        ctx.globalAlpha = 1

        for (let i = this.banners.length - 1; i >= 0; i--) {
            const b = this.banners[i]!
            b.age += dt
            if (b.age > 2.1) {
                this.banners.splice(i, 1)
                continue
            }
            const alpha = b.age < 0.22 ? b.age / 0.22 : b.age > 1.6 ? 1 - (b.age - 1.6) / 0.5 : 1
            const grow = 1 + b.age * 0.04
            ctx.save()
            ctx.globalAlpha = Math.max(0, alpha)
            ctx.translate(width / 2, height * 0.3)
            ctx.scale(grow, grow)
            ctx.shadowColor = b.color
            ctx.shadowBlur = 18
            ctx.fillStyle = b.color
            ctx.font = `900 ${Math.round(Math.min(54, width / 18))}px ${FONT}`
            ctx.fillText(b.text.split('').join(' '), 0, 0)
            if (b.sub) {
                ctx.shadowBlur = 0
                ctx.fillStyle = '#94a3b8'
                ctx.font = `500 ${Math.round(Math.min(17, width / 52))}px ${FONT}`
                ctx.fillText(b.sub.toUpperCase(), 0, Math.min(44, width / 22))
            }
            ctx.restore()
        }
    }
}
