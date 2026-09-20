// Void Runner — sector events. Every few minutes the sector throws something
// at the pilot that is worth changing course for: a smuggler freighter making
// a run for the edge, a meteor shower full of rich ore, or a sealed derelict
// vault that wakes a guard wing when you crack it open.

import * as THREE from 'three'
import { randomFloat } from '#shared/utils/random'
import type { VoidResourceId } from '#shared/utils/gamelogic/void'
import type { VoidEngine } from './engine'
import { killEnemy, spawnEnemy, spawnPatrol } from './enemies'
import { explosion } from './fx'
import type { Enemy } from './types'

export type SectorEventKind = 'freighter' | 'meteors' | 'vault'

export interface ActiveEvent {
    kind: SectorEventKind
    title: string
    time: number
    duration: number
    target: Enemy | null
    anchor: THREE.Vector3
    triggered: boolean
    spawned: number
    done: boolean
}

const _v = new THREE.Vector3()
const _c = new THREE.Color()

function randDir(flatten = 0.3) {
    return new THREE.Vector3(randomFloat() - 0.5, (randomFloat() - 0.5) * flatten, randomFloat() - 0.5).normalize()
}

export class EventDirector {
    active: ActiveEvent | null = null
    private timer = 100 + randomFloat() * 60

    constructor(private engine: VoidEngine) {}

    get marker(): { pos: THREE.Vector3, label: string } | null {
        const a = this.active
        if (!a || a.done) return null
        if (a.kind === 'meteors') return { pos: a.anchor, label: 'METEORS' }
        if (a.target?.alive) return { pos: a.target.pos, label: a.kind === 'freighter' ? 'SMUGGLER' : 'VAULT' }
        return null
    }

    view(): { text: string, progress?: string } | null {
        const a = this.active
        if (!a || a.done) return null
        const left = Math.max(0, Math.ceil(a.duration - a.time))
        if (a.kind === 'freighter') return { text: 'Destroy the smuggler freighter', progress: `${left}s` }
        if (a.kind === 'meteors') return { text: 'Mine the meteor shower', progress: `${left}s` }
        return { text: a.triggered ? 'Crack the vault' : 'Reach the derelict vault', progress: a.triggered ? `${Math.ceil((a.target?.hp ?? 0) / Math.max(1, a.target?.maxHp ?? 1) * 100)}%` : undefined }
    }

    update(dt: number, suppressed: boolean) {
        const e = this.engine
        const p = e.player
        if (!p?.alive) return
        if (!this.active) {
            if (suppressed) return
            this.timer -= dt
            if (this.timer <= 0) this.start()
            return
        }
        const a = this.active
        a.time += dt
        switch (a.kind) {
            case 'freighter': this.updateFreighter(a, dt); break
            case 'meteors': this.updateMeteors(a, dt); break
            case 'vault': this.updateVault(a); break
        }
        if (a.done || a.time > a.duration + 5) {
            this.active = null
            this.timer = 120 + randomFloat() * 90
        }
    }

    private start() {
        const e = this.engine
        const p = e.player!
        const roll = randomFloat()
        const kind: SectorEventKind = roll < 0.4 ? 'freighter' : roll < 0.7 ? 'meteors' : 'vault'
        const tier = e.config!.sector.tier
        if (kind === 'freighter') {
            const from = p.pos.clone().add(randDir().multiplyScalar(650))
            const target = spawnEnemy(e, 'freighter', from, { aggro: false, warpIn: true })
            target.hp = target.maxHp = 1400 * e.config!.sector.threat
            const exit = from.clone().negate().setLength(2900).add(randDir(0.2).multiplyScalar(400))
            target.wander.copy(exit)
            for (let i = 0; i < 2 + Math.min(3, tier); i++) {
                const escort = spawnEnemy(e, 'raider', from.clone().add(randDir(0.6).multiplyScalar(25)), { aggro: false })
                escort.data.escortOf = target.id
                escort.anchor.copy(from)
            }
            this.active = { kind, title: 'Smuggler freighter', time: 0, duration: 110, target, anchor: from, triggered: false, spawned: 0, done: false }
            e.events.toast('A smuggler freighter is running for the edge. Its hold is full.', 'warn')
        } else if (kind === 'meteors') {
            const anchor = p.pos.clone().add(randDir().multiplyScalar(260))
            this.active = { kind, title: 'Meteor shower', time: 0, duration: 45, target: null, anchor, triggered: false, spawned: 0, done: false }
            e.events.toast('Meteor shower incoming. The fragments are rich in ore.', 'info')
        } else {
            let at = p.pos.clone().add(randDir().multiplyScalar(800))
            if (at.length() > 2300) at = at.setLength(2000)
            const target = spawnEnemy(e, 'vault', at, {})
            target.hp = target.maxHp = 600 * (1 + (tier - 1) * 0.6)
            this.active = { kind, title: 'Derelict vault', time: 0, duration: 240, target, anchor: at, triggered: false, spawned: 0, done: false }
            e.events.toast('Derelict vault signal detected. Expect company.', 'info')
        }
        e.audio.play('wardenAlert', { volume: 0.4 })
    }

    private updateFreighter(a: ActiveEvent, dt: number) {
        const e = this.engine
        const f = a.target!
        if (!f.alive) {
            a.done = true
            return
        }
        // Runs for the edge; faster once it notices it is being shot.
        const speed = f.hp < f.maxHp ? 42 : 26
        const dir = _v.subVectors(f.wander, f.pos)
        if (dir.length() < 60 || a.time > a.duration) {
            this.escape(f)
            a.done = true
            return
        }
        dir.normalize()
        f.vel.lerp(dir.multiplyScalar(speed), 1 - Math.exp(-0.6 * dt))
        f.pos.addScaledVector(f.vel, dt)
        const look = _v.copy(f.pos).add(f.vel)
        f.group.lookAt(look)
        f.group.rotateY(Math.PI)
        // Dumps mines behind it once damaged.
        if (f.hp < f.maxHp * 0.6 && randomFloat() < dt * 0.5) {
            const mine = spawnEnemy(e, 'mine', f.pos.clone().addScaledVector(f.vel, -0.25), { aggro: true })
            mine.data.arm = 1.5
            mine.damageMult = f.damageMult
        }
        for (const escort of e.enemies) {
            if (escort.data.escortOf !== f.id || !escort.alive) continue
            if (!escort.aggro) escort.anchor.copy(f.pos)
        }
    }

    private escape(f: Enemy) {
        const e = this.engine
        e.rings.spawn(f.pos, 40, 0xffc44d, 0.6, 2.5)
        e.events.toast('The smuggler jumped away.', 'bad')
        killEnemy(e, f, true)
    }

    private updateMeteors(a: ActiveEvent, dt: number) {
        const e = this.engine
        const p = e.player!
        if (a.time > a.duration) {
            a.done = true
            return
        }
        // Keep the shower centred loosely on where the pilot is fighting.
        a.anchor.lerp(p.pos, 1 - Math.exp(-0.05 * dt))
        if (randomFloat() < dt * 2.2) {
            const fall = randDir(0.6).multiplyScalar(-1)
            const start = a.anchor.clone().add(randDir(1).multiplyScalar(randomFloat() * 180)).addScaledVector(fall, -320)
            const m = spawnEnemy(e, 'meteor', start, { aggro: true })
            m.hp = m.maxHp = 40 * (1 + (e.config!.sector.tier - 1) * 0.5)
            m.vel.copy(fall).multiplyScalar(55 + randomFloat() * 40)
            m.data.spin = randomFloat() * 3
            a.spawned++
        }
    }

    private updateVault(a: ActiveEvent) {
        const e = this.engine
        const v = a.target!
        if (!v.alive) {
            a.done = true
            return
        }
        v.group.rotation.y += 0.002
        if (!a.triggered && v.pos.distanceTo(e.player!.pos) < 220) {
            a.triggered = true
            spawnPatrol(e, v.pos.clone().add(randDir().multiplyScalar(140)), true, 1 + Math.floor(e.config!.sector.tier / 2))
            e.events.toast('The vault woke its guards.', 'warn')
            e.audio.play('warning')
        }
    }
}

/** Per-frame behaviour for event entities that live in the enemy list. */
export function updateEventEntity(engine: VoidEngine, e: Enemy, dt: number) {
    if (e.kind === 'meteor') {
        e.pos.addScaledVector(e.vel, dt)
        e.group.rotation.x += dt * (e.data.spin ?? 1)
        e.group.rotation.y += dt * 0.7
        if (Math.random() < 0.9) {
            engine.particles.emit(e.pos.x, e.pos.y, e.pos.z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, { life: 0.7, size: 3.2, sizeEnd: 0.5, color: 0xffa040, colorEnd: 0x551000, intensity: 2.2, drag: 1 })
            engine.smoke.emit(e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, { life: 1.4, size: 2, sizeEnd: 6, color: 0x2a221e, alpha: 0.35, drag: 0.5 })
        }
        const p = engine.player
        if (p?.alive && e.pos.distanceTo(p.pos) < p.radius + e.radius) {
            engine.damagePlayer(28 * e.damageMult, e.pos, 'event')
            killEnemy(engine, e)
            return
        }
        if (e.stateTime > 14) killEnemy(engine, e, true)
    }
}

const ORE_ORDER: VoidResourceId[] = ['xenite', 'iridium', 'cobalt', 'ferrite']

/** Loot for event kills. Returns true when handled. */
export function eventLoot(engine: VoidEngine, e: Enemy) {
    const tier = engine.config!.sector.tier
    if (e.kind === 'freighter') {
        engine.dropLoot('alloy', 12, 22, e.pos)
        engine.dropLoot('scrap', 25, 40, e.pos)
        const best = ORE_ORDER.find(id => (engine.config!.sector.ores as Record<string, number>)[id]) ?? 'ferrite'
        engine.dropLoot(best, 15, 30, e.pos)
        if (tier >= 3) engine.dropLoot('core', 1, 1, e.pos, 0.5)
        explosion(engine.fx, e.pos, e.vel, 6, 0xffc44d)
        if (randomFloat() < 0.15) engine.dropRelic(e.pos)
        if (randomFloat() < 0.5) engine.dropFuel(e.pos)
        engine.events.toast('Smuggler down. Grab the cargo.', 'good')
        return true
    }
    if (e.kind === 'meteor') {
        const ores = ORE_ORDER.filter(id => (engine.config!.sector.ores as Record<string, number>)[id])
        engine.dropLoot(ores[0] ?? 'ferrite', 3, 7, e.pos)
        return true
    }
    if (e.kind === 'vault') {
        engine.dropLoot('alloy', 10, 18, e.pos)
        engine.dropLoot('scrap', 20, 35, e.pos)
        engine.dropLoot('core', 1, 1, e.pos, 0.15 + tier * 0.1)
        explosion(engine.fx, e.pos, _v.set(0, 0, 0), 4, 0x49e6ff)
        engine.rings.spawn(e.pos, 60, _c.set(0x49e6ff), 0.8, 2)
        if (randomFloat() < 0.4) engine.dropRelic(e.pos)
        engine.dropFuel(e.pos)
        if (randomFloat() < 0.25) engine.dropGear(e.pos)
        engine.events.toast('Vault cracked.', 'good')
        return true
    }
    return false
}
