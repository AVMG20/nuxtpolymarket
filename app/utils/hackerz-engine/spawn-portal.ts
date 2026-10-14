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

/** Entry ripples the haze can show at once; the oldest is recycled. */
const RIPPLES = 8
/** How fast an entry ripple spreads across the opening (world units a second), and how long it lasts. */
const RIPPLE_SPEED = 26
const RIPPLE_LIFE = 1.4

/** Rising red smoke with glitch bands sliding through it, rippling where something comes through. */
const HAZE_FRAGMENT = /* glsl */ `
#define RIPPLES ${RIPPLES}
uniform float uTime;
uniform vec2 uSize;
// x, y in world units across the opening; z the ripple's age in seconds (< 0 when idle).
uniform vec3 uRipples[RIPPLES];
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
    // Entry ripples: a soft ring spreading out from where a unit came through,
    // dimming as it widens and fading out entirely — a swell, never a flash.
    vec2 w = vUv * uSize;
    float ripple = 0.0;
    for (int i = 0; i < RIPPLES; i++) {
        vec3 r = uRipples[i];
        if (r.z < 0.0) continue;
        float radius = r.z * ${RIPPLE_SPEED.toFixed(1)};
        float ring = 1.0 - smoothstep(0.0, 1.6, abs(length(w - r.xy) - radius));
        float fade = 1.0 - clamp(r.z / ${RIPPLE_LIFE.toFixed(1)}, 0.0, 1.0);
        ripple += ring * fade * fade;
    }
    ripple = min(ripple, 1.2);
    vec3 col = vec3(1.0, 0.08, 0.06) * (0.18 + smoke * 0.55) + vec3(1.0, 0.25, 0.4) * band * 0.25 + vec3(2.0, 0.2, 0.15) * edge * 0.6
        + vec3(2.2, 0.55, 0.3) * ripple * (0.5 + smoke * 0.5);
    float a = clamp(0.25 + smoke * 0.45 + edge * 0.5 + ripple * 0.4, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
}
`

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
    private ripples: THREE.Vector3[]
    private rippleCursor = 0

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

        this.ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector3(0, 0, -1))
        this.hazeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: new THREE.Vector2(halfWidth * 2, height) },
                uRipples: { value: this.ripples }
            },
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
     * Something came through at world x (relative to the gate's centre): a
     * ripple spreads from low in the opening there across the rest of it.
     */
    ripple(x: number) {
        const slot = this.ripples[this.rippleCursor]!
        this.rippleCursor = (this.rippleCursor + 1) % RIPPLES
        slot.set(THREE.MathUtils.clamp(x + this.halfWidth, 0, this.halfWidth * 2), 1.2, 0)
    }

    update(dt: number) {
        this.time += dt
        this.hazeMaterial.uniforms.uTime!.value = this.time
        for (const ripple of this.ripples) {
            if (ripple.z < 0) continue
            ripple.z += dt
            if (ripple.z > RIPPLE_LIFE) ripple.z = -1
        }

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
