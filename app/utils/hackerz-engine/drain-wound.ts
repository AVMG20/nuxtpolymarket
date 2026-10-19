import * as THREE from 'three'
import { hdr } from './models'

/**
 * Where a spiderling's fangs go in: a red stain spilled across the surface it
 * drains (the fence, the barrier, a placed obstacle), about its own size. Each
 * draw runs a pulse in from the stain's ragged edge to the bite, and on up the
 * fangs into the spiderling as a bead of red. The board and the database
 * turntable both draw it through this.
 */

/** How long the stain takes to spill, a pulse to run in, the bead to climb, and the stain to fade once left alone. */
const SPILL_S = 0.45
const PULSE_S = 0.35
const BEAD_S = 0.2
const IDLE_S = 1.6
const FADE_S = 0.6

const disc = new THREE.CircleGeometry(0.5, 40)
const bead = new THREE.SphereGeometry(1, 10, 8)

const vertexShader = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`

const fragmentShader = /* glsl */`
    uniform vec3 uColor;
    uniform float uSpill;
    uniform float uPulse;
    uniform float uSeed;
    varying vec2 vUv;
    void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        // A ragged spill, not a neat disc.
        float rim = (0.78 + 0.12 * sin(a * 5.0 + uSeed) + 0.07 * sin(a * 11.0 - uSeed * 2.0)) * uSpill;
        if (r > rim) discard;
        float body = 0.35 * (1.0 - r / max(rim, 0.001)) + 0.12;
        // The draw: a bright ring running in from the edge to the bite.
        float ringAt = rim * (1.0 - uPulse);
        float ring = uPulse < 1.0 ? exp(-pow((r - ringAt) * 14.0, 2.0)) * 1.4 : 0.0;
        float core = exp(-r * r * 30.0) * 0.6;
        gl_FragColor = vec4(uColor * (body + ring + core), 1.0);
    }`

export class DrainWound {
    readonly group = new THREE.Group()
    private readonly stain: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>
    private readonly drop: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
    private spill = 0
    private pulse = 1
    private beadT = 1
    private idle = 0
    private readonly into = new THREE.Vector3()
    private size = 1

    constructor(parent: THREE.Object3D, hex = 0xfb7185) {
        this.stain = new THREE.Mesh(disc, new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: hdr(hex, 1.6) },
                uSpill: { value: 0 },
                uPulse: { value: 1 },
                uSeed: { value: Math.random() * 10 }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -2
        }))
        this.drop = new THREE.Mesh(bead, new THREE.MeshBasicMaterial({ color: hdr(hex, 3), toneMapped: false }))
        this.drop.visible = false
        this.group.add(this.stain)
        parent.add(this.group, this.drop)
        this.group.visible = false
    }

    /**
     * Lays the stain at `at` on a surface facing `normal` (both in the
     * parent's space), `size` across; it spills out from nothing.
     */
    place(at: THREE.Vector3, normal: THREE.Vector3, size: number) {
        if (!this.group.visible || this.group.position.distanceTo(at) > size * 0.6) this.spill = 0
        this.size = size
        this.group.position.copy(at)
        this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize())
        this.stain.scale.setScalar(size)
        this.group.visible = true
        this.idle = 0
    }

    /** One draw: a pulse in from the edge, then a bead up the fangs into `into` (the parent's space). */
    draw(into: THREE.Vector3) {
        this.pulse = 0
        this.beadT = -1
        this.into.copy(into)
        this.idle = 0
    }

    update(dt: number) {
        if (!this.group.visible) return
        this.idle += dt
        this.spill = Math.min(1, this.spill + dt / SPILL_S)
        // Left alone (its spiderling gone, or shoved off), the stain fades.
        const fade = this.idle < IDLE_S ? 1 : Math.max(0, 1 - (this.idle - IDLE_S) / FADE_S)
        const u = this.stain.material.uniforms
        u.uSpill!.value = this.spill * fade
        if (this.pulse < 1) {
            this.pulse = Math.min(1, this.pulse + dt / PULSE_S)
            if (this.pulse >= 1) this.beadT = 0
        }
        u.uPulse!.value = this.pulse
        if (this.beadT >= 0 && this.beadT < 1) {
            this.beadT = Math.min(1, this.beadT + dt / BEAD_S)
            this.drop.visible = this.beadT < 1
            this.drop.position.lerpVectors(this.group.position, this.into, this.beadT)
            this.drop.scale.setScalar(this.size * 0.1 * (1 - this.beadT * 0.5))
        } else this.drop.visible = false
        if (fade <= 0) this.group.visible = false
    }

    dispose() {
        this.group.removeFromParent()
        this.drop.removeFromParent()
        this.stain.material.dispose()
        this.drop.material.dispose()
    }
}
