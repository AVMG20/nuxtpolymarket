import * as THREE from 'three'
import { FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE } from './constants'
import { hdr } from './models'
import { randRange } from './math'

/**
 * An electrified guardrail down both edges of the lane: the side hardware sits
 * behind it, out of the intrusion's reach. The rails glow in the colour of the
 * territory they run through, and arcs crackle between the posts — short,
 * thin and fading, never a flash.
 */

const POST_SPACING = 3.2
const ARCS = 10

interface Arc {
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    life: number
    maxLife: number
}

export class Guardrail {
    readonly group = new THREE.Group()
    private posts: THREE.Vector3[] = []
    private arcs: Arc[] = []
    private nextArc = 0

    constructor(zoneMaterial: (intensity: number, packets: number) => THREE.Material) {
        const x = FIELD_HALF_WIDTH * FIELD_SCALE + 1.6
        const near = -0.8
        const far = -(FIELD_DEPTH + 60) * FIELD_SCALE
        const length = near - far
        const postGeometry = new THREE.BoxGeometry(0.16, 1.1, 0.16)
        const postMaterial = new THREE.MeshBasicMaterial({ color: 0x0a1220 })
        const railMaterial = zoneMaterial(1.5, 0)
        const capMaterial = zoneMaterial(2.2, 0)

        for (const side of [-1, 1]) {
            for (const y of [0.4, 0.95]) {
                const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, length), railMaterial)
                rail.position.set(side * x, y, (near + far) / 2)
                this.group.add(rail)
            }
            for (let z = near; z >= far; z -= POST_SPACING) {
                const post = new THREE.Mesh(postGeometry, postMaterial)
                post.position.set(side * x, 0.55, z)
                const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.22), capMaterial)
                cap.position.y = 0.58
                post.add(cap)
                this.group.add(post)
                this.posts.push(new THREE.Vector3(side * x, 1.1, z))
            }
        }

        for (let i = 0; i < ARCS; i++) {
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(Array.from({ length: 7 }, () => new THREE.Vector3())),
                new THREE.LineBasicMaterial({ color: hdr(0xc8f0ff, 2.6), toneMapped: false, transparent: true, opacity: 0 })
            )
            line.frustumCulled = false
            this.group.add(line)
            this.arcs.push({ line, life: 0, maxLife: 1 })
        }
    }

    /** One crackle between a post and its neighbour along the same rail. */
    private strike(arc: Arc) {
        const index = Math.floor(Math.random() * (this.posts.length - 1))
        const from = this.posts[index]!
        const to = this.posts[index + 1]!
        if (Math.sign(from.x) !== Math.sign(to.x)) return
        const positions = arc.line.geometry.getAttribute('position') as THREE.BufferAttribute
        const steps = positions.count - 1
        for (let p = 0; p <= steps; p++) {
            const point = from.clone().lerp(to, p / steps)
            if (p > 0 && p < steps) point.add(new THREE.Vector3(randRange(-0.25, 0.25), randRange(-0.45, 0.25), randRange(-0.2, 0.2)))
            positions.setXYZ(p, point.x, point.y, point.z)
        }
        positions.needsUpdate = true
        arc.maxLife = arc.life = randRange(0.12, 0.26)
    }

    update(dt: number) {
        this.nextArc -= dt
        while (this.nextArc <= 0) {
            this.nextArc += randRange(0.06, 0.18)
            const arc = this.arcs.find(a => a.life <= 0) ?? this.arcs[0]!
            this.strike(arc)
        }
        for (const arc of this.arcs) {
            arc.life = Math.max(0, arc.life - dt)
            arc.line.material.opacity = arc.life / arc.maxLife
        }
    }
}
