// Void Runner — hostile abilities you dodge with the stick, not with a shield.
//
// Storm rocket: a big, slow, poorly turning rocket. It hurts if it lands, and
// wherever it bursts it leaves a static storm that burns anything that stays in it.
// Lance strike: a marked sphere of space that detonates a moment later. Fly out of it.

import * as THREE from 'three'
import { randomFloat } from '#shared/utils/random'
import type { VoidEngine } from './engine'
import { explosion } from './fx'
import type { Enemy } from './types'

interface Rocket {
    pos: THREE.Vector3
    vel: THREE.Vector3
    life: number
    damage: number
    color: number
}

interface Storm {
    pos: THREE.Vector3
    radius: number
    life: number
    dps: number
    color: number
    tick: number
    arc: number
}

interface Strike {
    pos: THREE.Vector3
    from: Enemy
    /** Where the targeting line starts when it is not the hostile's centre: a capital's emitter. */
    origin?: THREE.Vector3
    radius: number
    fuse: number
    damage: number
    color: number
    pulse: number
}

const ROCKET_SPEED = 92
const ROCKET_TURN = 0.85
const STORM_RADIUS = 58
const STORM_LIFE = 10
const STRIKE_RADIUS = 40
const STRIKE_FUSE = 2.1

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _c = new THREE.Color()

export class EnemyThreats {
    private rockets: Rocket[] = []
    private storms: Storm[] = []
    private strikes: Strike[] = []

    constructor(private engine: VoidEngine) {}

    /** Seconds until this hostile may use its special again. */
    ready(e: Enemy, dt: number) {
        e.data.threatCd = (e.data.threatCd ?? 4 + randomFloat() * 6) - dt
        return e.data.threatCd <= 0
    }

    launchRocket(e: Enemy, from: THREE.Vector3, dir: THREE.Vector3, damage: number, cooldown: number) {
        e.data.threatCd = cooldown * (0.85 + randomFloat() * 0.3)
        const color = e.glow.getHex()
        this.rockets.push({ pos: from.clone(), vel: dir.clone().normalize().multiplyScalar(ROCKET_SPEED * 0.5).add(e.vel), life: 9, damage, color })
        this.engine.rings.spawn(from, 14, color, 0.45, 3, dir.clone())
        this.engine.audio.play('missile', { distance: from.distanceTo(this.engine.camera.position) * 0.4, pan: this.engine.panOf(from), pitch: 0.5, volume: 1.5 })
        this.engine.audio.play('warning', { volume: 0.7 })
    }

    callStrike(e: Enemy, target: THREE.Vector3, targetVel: THREE.Vector3, damage: number, cooldown: number, origin?: THREE.Vector3) {
        e.data.threatCd = cooldown * (0.85 + randomFloat() * 0.3)
        // Marked a little ahead of the ship, so flying straight on is the wrong answer.
        const pos = target.clone().addScaledVector(targetVel, 0.9)
        this.strikes.push({ pos, from: e, origin, radius: STRIKE_RADIUS, fuse: STRIKE_FUSE, damage, color: e.glow.getHex(), pulse: 0 })
        this.engine.audio.play('charge', { distance: 40, pitch: 0.8, volume: 1.2 })
        this.engine.audio.play('warning', { volume: 0.7 })
    }

    update(dt: number) {
        const engine = this.engine
        const p = engine.player
        const live = !!p?.alive && engine.phase === 'flying'

        this.rockets = this.rockets.filter((r) => {
            r.life -= dt
            if (live) {
                const to = _v1.subVectors(p!.pos, r.pos)
                const dist = to.length()
                if (dist < Math.max(6, p!.radius + 5)) {
                    engine.damagePlayer(r.damage, r.pos)
                    this.burst(r)
                    return false
                }
                // A wide turning circle: break across its path late and it sails past.
                r.vel.lerp(to.normalize().multiplyScalar(ROCKET_SPEED), 1 - Math.exp(-ROCKET_TURN * dt))
            }
            r.vel.setLength(Math.min(ROCKET_SPEED, r.vel.length() + dt * 70))
            const hitRock = engine.asteroids?.raycast(r.pos, _v2.copy(r.pos).addScaledVector(r.vel, dt), 2)
            r.pos.addScaledVector(r.vel, dt)
            if (r.life <= 0 || hitRock) {
                this.burst(r)
                return false
            }
            // A fat, bright body with a dirty trail, readable from a long way off.
            engine.particles.glow(r.pos.x, r.pos.y, r.pos.z, _c.set(r.color).multiplyScalar(2), 5, 0.8)
            engine.particles.emit(r.pos.x, r.pos.y, r.pos.z, -r.vel.x * 0.1, -r.vel.y * 0.1, -r.vel.z * 0.1, { life: 0.5, size: 3.2, sizeEnd: 0.4, color: r.color, colorEnd: 0xff5a1a, intensity: 3, drag: 0.5 })
            engine.smoke.emit(r.pos.x, r.pos.y, r.pos.z, 0, 0, 0, { life: 1.6, size: 1.6, sizeEnd: 6, color: 0x6a6470, alpha: 0.28, drag: 0.2 })
            if (Math.random() < dt * 6) engine.lightning(r.pos, _v1.copy(r.pos).add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14)), r.color)
            return true
        })

        this.storms = this.storms.filter((s) => {
            s.life -= dt
            if (s.life <= 0) return false
            const fade = Math.min(1, s.life / 1.5)
            s.arc -= dt
            if (s.arc <= 0) {
                s.arc = 0.07
                // Arcs jump between points on the shell, so the edge of the storm is what you see.
                const a = _v1.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5).normalize().multiplyScalar(s.radius * (0.55 + Math.random() * 0.45)).add(s.pos)
                const b = _v2.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5).normalize().multiplyScalar(s.radius * 0.5).add(a)
                if (Math.random() < fade) engine.lightning(a.clone(), b.clone(), s.color)
                engine.particles.emit(a.x, a.y, a.z, 0, 0, 0, { life: 0.9, size: 5, sizeEnd: 0, color: s.color, intensity: 1.6 * fade, drag: 0 })
            }
            s.tick -= dt
            if (s.tick <= 0) {
                s.tick = 0.5
                engine.rings.spawn(s.pos, s.radius, s.color, 0.9, 1.2 * fade, new THREE.Vector3(0, 1, 0), 0.05)
                engine.particles.glow(s.pos.x, s.pos.y, s.pos.z, _c.set(s.color).multiplyScalar(0.35 * fade), s.radius * 0.8, 0.5)
                if (live && p!.pos.distanceTo(s.pos) < s.radius + p!.radius) {
                    engine.damagePlayer(s.dps * 0.5, s.pos)
                    engine.lightning(s.pos.clone(), p!.pos.clone(), s.color)
                }
            }
            return true
        })

        this.strikes = this.strikes.filter((s) => {
            s.fuse -= dt
            const k = 1 - Math.max(0, s.fuse) / STRIKE_FUSE
            s.pulse -= dt
            if (s.pulse <= 0) {
                // The rings close in on the mark and quicken as the fuse runs down.
                s.pulse = 0.34 - k * 0.22
                const facing = _v1.subVectors(engine.camera.position, s.pos).normalize()
                engine.rings.spawn(s.pos, s.radius * (1.05 - k * 0.5), s.color, 0.4, 2 + k * 3, facing.clone(), 0.06)
                engine.rings.spawn(s.pos, s.radius, 0xffffff, 0.3, 0.8, new THREE.Vector3(0, 1, 0), 0.03)
                if (s.from.alive) engine.tracers.push({ a: (s.origin ?? s.from.pos).clone(), b: s.pos.clone(), color: new THREE.Color(s.color).multiplyScalar(1 + k * 3), life: 0.2, maxLife: 0.2, width: 0.15 + k * 0.5 })
            }
            engine.particles.glow(s.pos.x, s.pos.y, s.pos.z, _c.set(s.color).multiplyScalar(0.3 + k * 1.2), 4 + k * 7, 0.7)
            if (s.fuse > 0) return true
            explosion(engine.fx, s.pos, _v1.set(0, 0, 0), 3.2, s.color, false)
            engine.rings.spawn(s.pos, s.radius * 1.6, s.color, 0.7, 4)
            engine.flashes.flash(s.pos, s.color, 80, s.radius * 5)
            const dist = s.pos.distanceTo(engine.camera.position)
            engine.audio.play('explosionLarge', { distance: dist * 0.4, pan: engine.panOf(s.pos) })
            if (live && p!.pos.distanceTo(s.pos) < s.radius + p!.radius) {
                engine.damagePlayer(s.damage, s.pos)
                engine.trauma = Math.min(1, engine.trauma + 0.5)
            }
            return false
        })
    }

    private burst(r: Rocket) {
        const engine = this.engine
        explosion(engine.fx, r.pos, _v1.set(0, 0, 0), 2.6, r.color, false)
        engine.rings.spawn(r.pos, STORM_RADIUS, r.color, 0.8, 3.5)
        engine.flashes.flash(r.pos, r.color, 70, 220)
        engine.audio.play('explosionLarge', { distance: r.pos.distanceTo(engine.camera.position) * 0.4, pan: engine.panOf(r.pos) })
        engine.audio.play('tesla', { distance: r.pos.distanceTo(engine.camera.position) * 0.4, pan: engine.panOf(r.pos), volume: 1.3 })
        this.storms.push({ pos: r.pos.clone(), radius: STORM_RADIUS, life: STORM_LIFE, dps: r.damage * 0.35, color: r.color, tick: 0, arc: 0 })
    }

    clear() {
        this.rockets = []
        this.storms = []
        this.strikes = []
    }
}
