// Void Runner — sector hazards. Each sector has one environmental rule that
// makes it feel different to fly: Cinder Reach is mined, the Long Dark is
// dark, the Xenite Womb's rocks hatch, and the Abyss bends space.

import * as THREE from 'three'
import { randomFloat } from '#shared/utils/random'
import type { VoidEngine } from './engine'
import { spawnEnemy } from './enemies'
import { ModelBuilder, ico, ring } from './models'

export interface GravityWell {
    pos: THREE.Vector3
    radius: number
    group: THREE.Group
    disk: THREE.Object3D
}

const _v = new THREE.Vector3()
const _c = new THREE.Color()

function randDir(flatten = 0.3) {
    return new THREE.Vector3(randomFloat() - 0.5, (randomFloat() - 0.5) * flatten, randomFloat() - 0.5).normalize()
}

export class SectorHazards {
    wells: GravityWell[] = []
    private tier: number

    constructor(private engine: VoidEngine) {
        this.tier = engine.config!.sector.tier
    }

    /** Called once while the sector is generated. */
    setup() {
        const e = this.engine
        if (this.tier === 2) {
            // Old minefields drift around the war wrecks.
            for (let f = 0; f < 8; f++) {
                const center = randDir().multiplyScalar(500 + randomFloat() * 1700)
                for (let i = 0; i < 7; i++) {
                    const mine = spawnEnemy(e, 'mine', center.clone().add(randDir(0.8).multiplyScalar(20 + randomFloat() * 60)), { aggro: true })
                    mine.data.arm = 0
                    mine.data.field = 1
                }
            }
        }
        if (this.tier === 3) {
            e.scene.fog = new THREE.FogExp2(0x0a0614, 0.0011)
        }
        if (this.tier === 5) {
            for (let i = 0; i < 4; i++) {
                let pos = randDir(0.25).multiplyScalar(700 + randomFloat() * 1500)
                if (pos.distanceTo(e.lair) < 500) pos = pos.negate()
                this.wells.push(this.buildWell(pos, 160 + randomFloat() * 60))
            }
        }
    }

    private buildWell(pos: THREE.Vector3, radius: number): GravityWell {
        const e = this.engine
        const core = new ModelBuilder()
        core.solid(ico(12, 3), 0x000000)
        const coreModel = core.build()
        const diskB = new ModelBuilder()
        const layers: [number, number, number, number][] = [
            [17, 2.2, 0xffd0a0, 2.2], [21, 2.0, 0xff9a4d, 1.8], [26, 1.8, 0xff4f8f, 1.5], [30, 1.6, 0xc07bff, 1.3], [38, 1.0, 0x6f5cff, 0.8], [48, 0.5, 0x6f5cff, 0.5]
        ]
        for (const [r, t, color, k] of layers) diskB.glow(ring(r, t, 3, 64), color, k, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.25])
        diskB.glow(ring(13, 0.35, 6, 48), 0xffc0e0, 2.2)
        const disk = diskB.build().group
        const group = new THREE.Group()
        group.add(coreModel.group, disk)
        group.position.copy(pos)
        group.rotation.set(randomFloat() * 0.6, 0, randomFloat() * 0.6)
        e.scene.add(group)
        return { pos, radius, group, disk }
    }

    update(dt: number) {
        const e = this.engine
        const p = e.player
        for (const w of this.wells) {
            w.disk.rotation.y += dt * 0.8
            const camD = w.pos.distanceTo(e.camera.position)
            e.particles.glow(w.pos.x, w.pos.y, w.pos.z, _c.set(0xff6fa8).multiplyScalar(0.4), 110 + camD * 0.02, 0.12)
            if (Math.random() < dt * 30) {
                const a = Math.random() * Math.PI * 2
                const r = 40 + Math.random() * 60
                const at = _v.set(Math.cos(a) * r, (Math.random() - 0.5) * 4, Math.sin(a) * r).applyEuler(w.group.rotation).add(w.pos)
                const toward = at.clone().sub(w.pos).multiplyScalar(-1.2)
                e.particles.emit(at.x, at.y, at.z, toward.x, toward.y, toward.z, { life: 0.8, size: 2.2, sizeEnd: 0.2, color: _c.set(0xff7ab0), intensity: 2, drag: 0 })
            }
            if (p?.alive && e.phase === 'flying') {
                const to = _v.subVectors(w.pos, p.pos)
                const d = to.length()
                if (d < w.radius) {
                    const pull = (1 - d / w.radius) * 70
                    p.vel.addScaledVector(to.normalize(), pull * dt)
                    if (d < 14) e.damagePlayer(80 * dt, w.pos)
                    e.trauma = Math.max(e.trauma, (1 - d / w.radius) * 0.35)
                }
            }
            for (const pk of e.pickups) {
                const d = pk.pos.distanceTo(w.pos)
                if (d < w.radius) pk.vel.addScaledVector(_v.subVectors(w.pos, pk.pos).normalize(), (1 - d / w.radius) * 60 * dt)
                if (d < 8) pk.life = 0
            }
        }
    }

    /** Xenite Womb: some broken rocks hatch a brood. */
    onRockBroken(pos: THREE.Vector3) {
        if (this.tier !== 4 || randomFloat() > 0.3) return
        const e = this.engine
        const count = 2 + Math.floor(randomFloat() * 3)
        for (let i = 0; i < count; i++) spawnEnemy(e, 'mite', pos.clone().add(randDir(1).multiplyScalar(6)), { aggro: true })
        e.events.toast('The rock was a nest.', 'warn')
    }

    dispose() {
        for (const w of this.wells) w.group.parent?.remove(w.group)
        this.wells = []
        this.engine.scene.fog = null
    }
}
