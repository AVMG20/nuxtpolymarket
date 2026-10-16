import * as THREE from 'three'
import type { LinePoint } from './data-lines'
import type { ParticleSystem } from './fx'
import { hdr } from './models'
import { fieldToWorld } from './scene'

/**
 * Blue pulses the player's rounds knock out of a hacked node: each one runs
 * outward along a data line, shedding sparks, and fades as it goes. How fast it
 * fades is up to the ground under it, which the engine reports per step — it
 * carries a long way through the firewall's own blue, less through disputed
 * orange, and barely gets started in red.
 */

/** Field units a pulse covers a second. */
const PULSE_SPEED = 900
/** Below this strength a pulse is spent. */
const SPENT = 0.06
/** Height the pulse rides at, in world units: just above the trace. */
const RIDE_Y = 0.12
const PULSE_HEX = 0x38bdf8

interface Pulse {
    path: LinePoint[]
    /** Index of the segment it is on: between `path[seg]` and `path[seg + 1]`. */
    seg: number
    /** Distance along that segment, in field units. */
    along: number
    strength: number
    head: THREE.Mesh
    material: THREE.MeshBasicMaterial
    /** Called with the pulse's remaining strength when it reaches the end of its path. */
    onEnd: ((strength: number) => void) | null
}

const headGeometry = new THREE.SphereGeometry(0.42, 10, 8)

export class LinePulses {
    readonly group = new THREE.Group()
    private pulses: Pulse[] = []
    private readonly at = new THREE.Vector3()

    constructor(private particles: ParticleSystem) {}

    get count() {
        return this.pulses.length
    }

    /** Starts a pulse at `path[0]`, running to its end. */
    send(path: LinePoint[], strength: number, onEnd: ((strength: number) => void) | null = null) {
        if (path.length < 2 || strength < SPENT) return
        const material = new THREE.MeshBasicMaterial({ color: hdr(PULSE_HEX, 4.5), toneMapped: false, transparent: true })
        const head = new THREE.Mesh(headGeometry, material)
        this.group.add(head)
        const pulse: Pulse = { path, seg: 0, along: 0, strength, head, material, onEnd }
        this.pulses.push(pulse)
        this.place(pulse)
    }

    /**
     * Moves every pulse on. `fadePerUnit(u, d)` is how much strength a pulse
     * loses for each field unit it travels at that spot.
     */
    update(dt: number, fadePerUnit: (u: number, d: number) => number) {
        if (dt <= 0) return
        for (let i = this.pulses.length - 1; i >= 0; i--) {
            const pulse = this.pulses[i]!
            let budget = PULSE_SPEED * dt
            let ended = false
            while (budget > 0) {
                const a = pulse.path[pulse.seg]!
                const b = pulse.path[pulse.seg + 1]
                if (!b) {
                    ended = true
                    break
                }
                const length = Math.hypot(b.u - a.u, b.d - a.d)
                const step = Math.min(budget, length - pulse.along)
                const f = length > 0 ? (pulse.along + step / 2) / length : 0
                pulse.strength -= step * fadePerUnit(a.u + (b.u - a.u) * f, a.d + (b.d - a.d) * f)
                pulse.along += step
                budget -= step
                if (pulse.along >= length - 1e-6) {
                    pulse.seg++
                    pulse.along = 0
                }
                if (pulse.strength < SPENT) break
            }
            if (pulse.strength < SPENT || ended) {
                if (ended && pulse.strength >= SPENT) pulse.onEnd?.(pulse.strength)
                this.remove(i)
                continue
            }
            this.place(pulse)
            // A short glowing tail along the line behind the head.
            this.particles.emit(this.at, new THREE.Vector3(0, 0.4, 0), PULSE_HEX, {
                size: 0.26 + 0.3 * pulse.strength,
                life: 0.5,
                intensity: 1.5 + 2.5 * pulse.strength
            })
        }
    }

    clear() {
        for (let i = this.pulses.length - 1; i >= 0; i--) this.remove(i)
    }

    private place(pulse: Pulse) {
        const a = pulse.path[pulse.seg]!
        const b = pulse.path[pulse.seg + 1] ?? a
        const length = Math.hypot(b.u - a.u, b.d - a.d)
        const f = length > 0 ? pulse.along / length : 0
        fieldToWorld(a.u + (b.u - a.u) * f, a.d + (b.d - a.d) * f, RIDE_Y, this.at)
        pulse.head.position.copy(this.at)
        pulse.head.scale.setScalar(0.5 + pulse.strength)
        pulse.material.opacity = Math.min(1, pulse.strength * 1.4)
    }

    private remove(index: number) {
        const pulse = this.pulses[index]!
        pulse.head.removeFromParent()
        pulse.material.dispose()
        this.pulses.splice(index, 1)
    }
}
