import * as THREE from 'three'
import { hdr } from './models'

/**
 * A Phantom's attack: crystals stream out of its chest, swing round it on two
 * crossing orbits, and are fired off the front of the orbit in a steady line
 * at the target, more coming out of the chest all the while to feed it. The
 * board and the database turntable both draw it through this.
 */

/** The units whose attack is a crystal ribbon. */
export const CRYSTAL_RIBBON_IDS: readonly string[] = ['phantom']

/** Seconds between crystals, time on the orbit and turns made (ending at the front), and the orbits' tilt either way. */
const SPAWN_GAP = 0.055
const ORBIT_S = 0.8
const ORBIT_TURNS = 1.5
const TILT = 0.7
/** Orbit radius and crystal length per unit of the unit's height; flight speed in heights a second. */
const ORBIT_RADIUS = 0.42
const CRYSTAL_SIZE = 0.09
const FLIGHT_SPEED = 5
/** How far off the line a crystal may strike, per unit of height. */
const SPREAD = 0.12

const geometry = new THREE.OctahedronGeometry(1, 0)

interface Crystal {
    mesh: THREE.Mesh
    age: number
    /** Which of the two orbits it rides: +1 or -1. */
    orbit: number
    /** Set once it leaves the orbit: where from, and how long its flight takes. */
    launched: boolean
    from: THREE.Vector3
    to: THREE.Vector3
    flight: number
}

const _up = new THREE.Vector3()
const _side = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _b = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _prev = new THREE.Vector3()

export class CrystalRibbon {
    private crystals: Crystal[] = []
    private spawnTimer = 0
    private flip = 1
    private readonly material: THREE.MeshBasicMaterial

    /**
     * `size` is the unit's height (in the parent's units); `onArrive` is told
     * where each crystal strikes home, for a spark.
     */
    constructor(private readonly parent: THREE.Object3D, hex: number, private readonly size: number,
        private readonly onArrive?: (at: THREE.Vector3) => void) {
        this.material = new THREE.MeshBasicMaterial({ color: hdr(hex, 2.4), toneMapped: false })
    }

    /**
     * Moves the ribbon on. While `active` new crystals keep coming out of
     * `chest`; `forward` (unit length) is the way it faces, and `target` where
     * the stream is fired at. All in the parent's space.
     */
    update(dt: number, active: boolean, chest: THREE.Vector3, forward: THREE.Vector3, target: THREE.Vector3) {
        if (active) {
            this.spawnTimer -= dt
            while (this.spawnTimer <= 0) {
                this.spawnTimer += SPAWN_GAP
                this.spawn(chest)
            }
        }
        // The orbits: round the chest, tilted either way about the forward line.
        _up.set(0, 1, 0).addScaledVector(forward, -forward.y).normalize()
        _side.crossVectors(forward, _up).normalize()
        const radius = this.size * ORBIT_RADIUS
        for (let i = this.crystals.length - 1; i >= 0; i--) {
            const c = this.crystals[i]!
            c.age += dt
            _prev.copy(c.mesh.position)
            if (c.age < ORBIT_S) {
                const t = c.age / ORBIT_S
                // Starts behind, comes round 1.5 turns, and ends at the front.
                const theta = Math.PI + t * Math.PI * 2 * ORBIT_TURNS
                _quat.setFromAxisAngle(forward, TILT * c.orbit)
                _normal.copy(_up).applyQuaternion(_quat)
                _b.crossVectors(_normal, forward).normalize()
                // Out of the chest onto the orbit over its first fifth.
                const r = radius * Math.min(1, t * 5)
                c.mesh.position.copy(chest)
                    .addScaledVector(forward, Math.cos(theta) * r)
                    .addScaledVector(_b, Math.sin(theta) * r)
            } else {
                if (!c.launched) {
                    // Fired at the target as it stands now, a touch off the line so the stream has body.
                    c.launched = true
                    c.from.copy(c.mesh.position)
                    const spread = this.size * SPREAD
                    c.to.copy(target).add(_b.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread))
                    c.flight = Math.max(0.05, c.from.distanceTo(c.to) / (FLIGHT_SPEED * this.size))
                }
                const t = (c.age - ORBIT_S) / c.flight
                if (t >= 1) {
                    this.onArrive?.(c.to.clone())
                    c.mesh.removeFromParent()
                    this.crystals.splice(i, 1)
                    continue
                }
                c.mesh.position.lerpVectors(c.from, c.to, t)
            }
            // Nose along its line of travel.
            if (c.mesh.position.distanceToSquared(_prev) > 1e-8) {
                _b.copy(c.mesh.position).sub(_prev).normalize()
                c.mesh.quaternion.setFromUnitVectors(_side.set(0, 0, 1), _b)
                _side.crossVectors(forward, _up).normalize()
            }
        }
    }

    private spawn(chest: THREE.Vector3) {
        const mesh = new THREE.Mesh(geometry, this.material)
        const s = this.size * CRYSTAL_SIZE
        mesh.scale.set(s * 0.4, s * 0.4, s)
        mesh.position.copy(chest)
        this.parent.add(mesh)
        this.flip = -this.flip
        this.crystals.push({ mesh, age: 0, orbit: this.flip, launched: false, from: new THREE.Vector3(), to: new THREE.Vector3(), flight: 1 })
    }

    get busy() {
        return this.crystals.length > 0
    }

    clear() {
        for (const c of this.crystals) c.mesh.removeFromParent()
        this.crystals = []
    }

    dispose() {
        this.clear()
        this.material.dispose()
    }
}
