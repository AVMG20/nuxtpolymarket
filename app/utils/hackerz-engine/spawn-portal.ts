import * as THREE from 'three'
import { hdr } from './models'
import { emblemTextures } from './lane-props'
import { randRange } from './math'

/**
 * Where the intrusion comes through: an angry red gate with electricity
 * crackling along its frame, a churning haze in the opening, and the
 * attackers' tags and progress messages drifting through it. Purely
 * cosmetic — nothing here decides an outcome.
 *
 * Every light here fades rather than flashes: the crackle is many short,
 * thin, fading arcs, never a full-bright strobe.
 */

const SENTENCES = [
    'BYPASSING GATES', 'DEPLOYING BACKDOOR', 'INJECTING PAYLOAD', 'ESCALATING PRIVILEGES',
    'DISABLING FIREWALL', 'SPOOFING CERTIFICATES', 'BRUTE-FORCING KEYS', 'EXFILTRATING DATA',
    'OVERWRITING KERNEL', 'ROOT ACCESS GRANTED', 'rm -rf /core', 'sudo su -'
]

const HAZE_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

/** Rising red smoke with glitch bands sliding through it. */
const HAZE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 p = vec2(vUv.x * 6.0, vUv.y * 2.5 - uTime * 0.25);
    float smoke = fbm(p + fbm(p * 1.7 + uTime * 0.1));
    // Glitch bands: thin horizontal slices drifting slowly up the opening.
    float band = step(0.93, fract(vUv.y * 7.0 - uTime * 0.18 + floor(vUv.x * 5.0) * 0.13));
    // Brighter toward the frame, so the opening reads as a field held in place.
    vec2 e = min(vUv, 1.0 - vUv);
    float edge = 1.0 - smoothstep(0.0, 0.12, min(e.x * 0.45, e.y));
    vec3 col = vec3(1.0, 0.08, 0.06) * (0.18 + smoke * 0.55) + vec3(1.0, 0.25, 0.4) * band * 0.25 + vec3(2.0, 0.2, 0.15) * edge * 0.6;
    float a = clamp(0.25 + smoke * 0.45 + edge * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
`

/**
 * Arrival cables: thin power lines that run out across the opening from where
 * a unit came through, each ending at a small icon of the attackers' tooling.
 * Dim on purpose — in the dark they are the only sign anything arrived.
 */
const CABLE_HEX = 0xffd2b0
const CABLE_OPACITY = 0.6
/** Seconds to draw out, and to be gone altogether. */
const CABLE_GROW = 0.5
const CABLE_LIFE = 1.8
const CABLES_MAX = 24
const ICONS = ['terminal', 'folder', 'file', 'database', 'lock', 'gear'] as const
const iconGeometry = new THREE.PlaneGeometry(0.9, 0.9)

interface Cable {
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    icon: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    points: number
    age: number
}

let iconSet: THREE.CanvasTexture[] | null = null

/** Small line-art icons, white on transparent, tinted by the material. */
function iconTextures() {
    if (iconSet) return iconSet
    iconSet = ICONS.map((kind) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 64
        const ctx = canvas.getContext('2d')!
        ctx.strokeStyle = '#fff'
        ctx.fillStyle = '#fff'
        ctx.lineWidth = 4
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        if (kind === 'terminal') {
            ctx.strokeRect(6, 10, 52, 44)
            ctx.beginPath()
            ctx.moveTo(16, 24); ctx.lineTo(26, 32); ctx.lineTo(16, 40)
            ctx.moveTo(30, 42); ctx.lineTo(46, 42)
            ctx.stroke()
        } else if (kind === 'folder') {
            ctx.beginPath()
            ctx.moveTo(6, 18); ctx.lineTo(24, 18); ctx.lineTo(30, 24); ctx.lineTo(58, 24)
            ctx.lineTo(58, 52); ctx.lineTo(6, 52); ctx.closePath()
            ctx.stroke()
        } else if (kind === 'file') {
            ctx.beginPath()
            ctx.moveTo(14, 6); ctx.lineTo(40, 6); ctx.lineTo(52, 18); ctx.lineTo(52, 58); ctx.lineTo(14, 58); ctx.closePath()
            ctx.moveTo(22, 30); ctx.lineTo(44, 30); ctx.moveTo(22, 40); ctx.lineTo(44, 40)
            ctx.stroke()
        } else if (kind === 'database') {
            for (const y of [14, 32, 50]) {
                ctx.beginPath()
                ctx.ellipse(32, y, 22, 7, 0, 0, Math.PI * 2)
                ctx.stroke()
            }
        } else if (kind === 'lock') {
            ctx.strokeRect(12, 28, 40, 28)
            ctx.beginPath()
            ctx.arc(32, 28, 13, Math.PI, 0)
            ctx.stroke()
        } else {
            ctx.beginPath()
            ctx.arc(32, 32, 12, 0, Math.PI * 2)
            for (let i = 0; i < 8; i++) {
                const a = i / 8 * Math.PI * 2
                ctx.moveTo(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16)
                ctx.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24)
            }
            ctx.stroke()
        }
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        return texture
    })
    return iconSet
}

interface Floater {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    velocity: THREE.Vector2
    age: number
    life: number
}

interface Arc {
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    life: number
    maxLife: number
}

let sentenceTextures: THREE.CanvasTexture[] | null = null

function sentences() {
    if (sentenceTextures) return sentenceTextures
    sentenceTextures = SENTENCES.map((text) => {
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = 64
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.font = '700 38px ui-monospace, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`> ${text}`, 256, 34)
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        return texture
    })
    return sentenceTextures
}

export class SpawnPortal {
    readonly group = new THREE.Group()
    private hazeMaterial: THREE.ShaderMaterial
    private floaters: Floater[] = []
    private arcs: Arc[] = []
    private nextArc = 0
    private time = 0
    private cables: Cable[] = []

    /** `z` is the gate's plane; it spans ±`halfWidth` and stands `height` tall. */
    constructor(z: number, private halfWidth: number, private height: number) {
        this.group.position.z = z
        const frame = new THREE.MeshBasicMaterial({ color: hdr(0xff2222, 2.4), toneMapped: false })
        const trim = new THREE.MeshBasicMaterial({ color: hdr(0xff5533, 1.4), toneMapped: false })
        for (const x of [-halfWidth, halfWidth]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, height, 0.6), frame)
            post.position.set(x, height / 2, 0)
            const inner = new THREE.Mesh(new THREE.BoxGeometry(0.12, height - 1, 0.12), trim)
            inner.position.set(x - Math.sign(x) * 0.7, height / 2, 0.2)
            this.group.add(post, inner)
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 0.6, 0.5, 0.5), frame)
        beam.position.set(0, height, 0)
        const innerBeam = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 - 1.4, 0.12, 0.12), trim)
        innerBeam.position.set(0, height - 0.7, 0.2)
        const sill = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2, 0.08, 0.3), frame)
        sill.position.set(0, 0.05, 0)
        this.group.add(beam, innerBeam, sill)

        this.hazeMaterial = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: HAZE_VERTEX,
            fragmentShader: HAZE_FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false
        })
        const haze = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth * 2, height), this.hazeMaterial)
        haze.position.set(0, height / 2, 0)
        this.group.add(haze)

        for (let i = 0; i < 16; i++) {
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 1),
                new THREE.MeshBasicMaterial({
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                    toneMapped: false,
                    opacity: 0
                })
            )
            this.group.add(mesh)
            const floater = { mesh, velocity: new THREE.Vector2(), age: 0, life: 0 }
            this.respawn(floater, randRange(0, 1))
            this.floaters.push(floater)
        }

        for (let i = 0; i < 8; i++) {
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(Array.from({ length: 9 }, () => new THREE.Vector3())),
                new THREE.LineBasicMaterial({ color: hdr(0xffb0a0, 3), toneMapped: false, transparent: true, opacity: 0 })
            )
            line.frustumCulled = false
            this.group.add(line)
            this.arcs.push({ line, life: 0, maxLife: 1 })
        }
    }

    /** A new tag or message somewhere in the opening; `head` starts it partway through its life. */
    private respawn(floater: Floater, head = 0) {
        const material = floater.mesh.material
        const isText = Math.random() < 0.45
        if (isText) {
            const set = sentences()
            material.map = set[Math.floor(Math.random() * set.length)]!
            const width = randRange(6, 9)
            floater.mesh.scale.set(width, width / 8, 1)
            material.color.copy(hdr(0xff4a3a, 1.6))
        } else {
            const sets = emblemTextures()
            const pool = Math.random() < 0.7 ? sets.theirs : sets.contested
            material.map = pool[Math.floor(Math.random() * pool.length)]!
            floater.mesh.scale.setScalar(randRange(1.6, 3))
            material.color.copy(hdr(Math.random() < 0.7 ? 0xff2a2a : 0xff7a2a, 1.8))
        }
        material.needsUpdate = true
        floater.mesh.position.set(
            randRange(-this.halfWidth + 3, this.halfWidth - 3),
            randRange(1.2, this.height - 1.2),
            randRange(0.2, 1.2)
        )
        floater.velocity.set(randRange(-1.2, 1.2), randRange(-0.3, 0.6))
        floater.life = randRange(2.5, 4.5)
        floater.age = floater.life * head
    }

    /** A crackle along a stretch of the frame, or out from a corner into the haze. */
    private strike(arc: Arc) {
        const w = this.halfWidth
        const h = this.height
        const edges: [THREE.Vector3, THREE.Vector3][] = [
            [new THREE.Vector3(-w, 0, 0), new THREE.Vector3(-w, h, 0)],
            [new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, h, 0)],
            [new THREE.Vector3(-w, h, 0), new THREE.Vector3(w, h, 0)]
        ]
        const [a, b] = edges[Math.floor(Math.random() * edges.length)]!
        const t0 = Math.random()
        const span = randRange(0.08, 0.3)
        const from = a.clone().lerp(b, t0)
        const into = Math.random() < 0.35
        const to = into
            ? new THREE.Vector3(randRange(-w * 0.7, w * 0.7), randRange(1, h - 1), 0.3)
            : a.clone().lerp(b, Math.min(1, t0 + span))
        const positions = arc.line.geometry.getAttribute('position') as THREE.BufferAttribute
        const steps = positions.count - 1
        for (let p = 0; p <= steps; p++) {
            const point = from.clone().lerp(to, p / steps)
            if (p > 0 && p < steps) point.add(new THREE.Vector3(randRange(-0.6, 0.6), randRange(-0.6, 0.6), randRange(0, 0.8)))
            positions.setXYZ(p, point.x, point.y, point.z)
        }
        positions.needsUpdate = true
        arc.maxLife = arc.life = randRange(0.15, 0.32)
    }

    /**
     * Something came through at world x (relative to the gate's centre): two
     * or three power lines run out across the opening from low down there.
     */
    arrival(x: number) {
        const count = 2 + (Math.random() < 0.5 ? 1 : 0)
        for (let i = 0; i < count && this.cables.length < CABLES_MAX; i++) this.layCable(x)
    }

    /**
     * One power line out of the entry point: light-cycle turns up and across
     * the opening, ending at a small icon — a terminal, a folder, a file —
     * as if the arrival just plugged into the attackers' tooling.
     */
    private layCable(x: number) {
        const w = this.halfWidth - 1.2
        const points: THREE.Vector3[] = []
        let px = THREE.MathUtils.clamp(x, -w, w)
        let py = 0.35
        const z = 0.45
        points.push(new THREE.Vector3(px, py, z))
        const turns = 2 + Math.floor(Math.random() * 3)
        for (let t = 0; t < turns; t++) {
            // Up a stretch, then across a stretch: never back down.
            py = Math.min(this.height - 1.4, py + randRange(1, 3))
            points.push(new THREE.Vector3(px, py, z))
            px = THREE.MathUtils.clamp(px + randRange(2.5, 7) * (Math.random() < 0.5 ? -1 : 1), -w, w)
            points.push(new THREE.Vector3(px, py, z))
        }
        // Resampled into short steps, so the line can grow smoothly.
        const path: THREE.Vector3[] = [points[0]!]
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1]!
            const b = points[i]!
            const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.25))
            for (let s = 1; s <= steps; s++) path.push(a.clone().lerp(b, s / steps))
        }
        // Additive, so a line glows on top of the haze rather than cutting a
        // dark seam through it.
        const material = new THREE.LineBasicMaterial({
            color: hdr(CABLE_HEX, 1.4),
            toneMapped: false,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), material)
        line.geometry.setDrawRange(0, 0)
        line.frustumCulled = false
        const iconMaterial = new THREE.MeshBasicMaterial({
            map: iconTextures()[Math.floor(Math.random() * ICONS.length)]!,
            color: hdr(CABLE_HEX, 1.6),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            opacity: 0
        })
        const icon = new THREE.Mesh(iconGeometry, iconMaterial)
        icon.position.copy(path[path.length - 1]!).add(new THREE.Vector3(0, 0.55, 0.05))
        this.group.add(line, icon)
        this.cables.push({ line, icon, points: path.length, age: 0 })
    }

    private updateCables(dt: number) {
        for (let i = this.cables.length - 1; i >= 0; i--) {
            const cable = this.cables[i]!
            cable.age += dt
            const grow = Math.min(1, cable.age / CABLE_GROW)
            cable.line.geometry.setDrawRange(0, Math.ceil(grow * cable.points))
            // Lit while it runs, then a slow fade: a trace cooling, not a flash.
            const fade = 1 - THREE.MathUtils.smoothstep(cable.age, CABLE_GROW, CABLE_LIFE)
            cable.line.material.opacity = CABLE_OPACITY * fade
            const iconIn = THREE.MathUtils.smoothstep(cable.age, CABLE_GROW * 0.85, CABLE_GROW + 0.2)
            cable.icon.material.opacity = CABLE_OPACITY * iconIn * fade
            if (cable.age < CABLE_LIFE) continue
            cable.line.geometry.dispose()
            cable.line.material.dispose()
            cable.icon.material.dispose()
            cable.line.removeFromParent()
            cable.icon.removeFromParent()
            this.cables.splice(i, 1)
        }
    }

    update(dt: number) {
        this.time += dt
        this.hazeMaterial.uniforms.uTime!.value = this.time
        this.updateCables(dt)

        for (const floater of this.floaters) {
            floater.age += dt
            if (floater.age >= floater.life) this.respawn(floater)
            const t = floater.age / floater.life
            floater.mesh.material.opacity = Math.sin(Math.PI * t) * 0.9
            floater.mesh.position.x += floater.velocity.x * dt
            floater.mesh.position.y += floater.velocity.y * dt
        }

        this.nextArc -= dt
        while (this.nextArc <= 0) {
            this.nextArc += randRange(0.05, 0.16)
            const arc = this.arcs.find(a => a.life <= 0) ?? this.arcs[0]!
            this.strike(arc)
        }
        for (const arc of this.arcs) {
            arc.life = Math.max(0, arc.life - dt)
            arc.line.material.opacity = arc.life / arc.maxLife
        }
    }
}
