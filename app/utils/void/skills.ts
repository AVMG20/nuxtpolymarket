// Void Runner — pilot skills in flight. One skill rides on Q and right mouse;
// its tree nodes arrive as a flat param bag (see void-skills.ts) and this
// file turns them into missiles, pulses, wingmen and orbital fire.

import * as THREE from 'three'
import { randomFloat } from '#shared/utils/random'
import { voidShip } from '#shared/utils/gamelogic/void'
import { voidSkill, voidSkillCooldown, voidSkillParams, type VoidSkillId } from '#shared/utils/gamelogic/void-skills'
import type { Asteroid } from './asteroids'
import { damageEnemy, enemyRayHit } from './enemies'
import { explosion, hitSpark, Trail } from './fx'
import { buildShip } from './ships'
import type { VoidEngine } from './engine'
import type { Enemy, Projectile } from './types'

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _c1 = new THREE.Color()
const FORWARD = new THREE.Vector3(0, 0, -1)

/** Skill hits on a warden are scaled and capped so nothing deletes a boss. */
const WARDEN_SKILL_MULT = 0.5
const WARDEN_SKILL_CAP = 0.025

interface Wingman {
    group: THREE.Group
    pos: THREE.Vector3
    vel: THREE.Vector3
    slot: number
    cooldown: number
    guard: number
    target: Enemy | null
    retarget: number
    trail: Trail
    /** Seconds left in a kamikaze dive, or 0. */
    dive: number
}

interface Strike {
    pos: THREE.Vector3
    timer: number
    delay: number
    damage: number
    radius: number
}

interface Field {
    pos: THREE.Vector3
    life: number
    radius: number
    dps: number
}

export interface SkillHud {
    id: VoidSkillId
    name: string
    color: string
    ready: number
    active: boolean
    activeFrac: number
    stacks: number
}

export class SkillRunner {
    readonly id: VoidSkillId
    readonly name: string
    readonly color: number
    readonly params: Record<string, number>
    readonly cooldownMax: number
    cooldown = 1.5
    uses = 0
    /** Seconds left on a timed effect (berserk, overdrive, wingmen). */
    active = 0
    private activeMax = 1
    private wingmen: Wingman[] = []
    strikes: Strike[] = []
    private fields: Field[] = []
    private aftershock = -1
    private aftershockPos = new THREE.Vector3()
    private frenzy = 0
    private extended = 0
    private lockTime = 0
    private auraTimer = 0
    shieldCap = 0

    constructor(private engine: VoidEngine, skill: { id: VoidSkillId, nodes: string[] }) {
        const def = voidSkill(skill.id)
        this.id = def.id
        this.name = def.name
        this.color = def.color
        this.params = voidSkillParams(def.id, skill.nodes)
        // Tactical Link perk trims every skill's recharge.
        this.cooldownMax = voidSkillCooldown(this.params) * (1 - (engine.config?.perks?.link ?? 0) * 0.08)
    }

    private get p() {
        return this.engine.player!
    }

    private get stats() {
        return this.engine.config!.stats
    }

    /** Base damage unit for skills: scales with the hull's gun and the Weapons Core. */
    private get power() {
        return this.stats.gun * this.stats.damageMult
    }

    private pct(key: string) {
        return 1 + (this.params[key] ?? 0)
    }

    // ─── Hooks the engine calls ────────────────────────────────────────────

    /** Extra multiplier on every player weapon's damage. */
    get outgoingMult() {
        if (this.id !== 'berserk' || this.active <= 0) return 1
        const glass = this.params.glass ? 1.5 : 1
        return 1 + (this.params.damagePct ?? 0) * glass + this.frenzy * 0.04
    }

    get rateMult() {
        if (this.id !== 'berserk' || this.active <= 0) return 1
        return 1 + (this.params.ratePct ?? 0) * (this.params.glass ? 1.5 : 1)
    }

    trigger() {
        const p = this.engine.player
        if (!p?.alive) return false
        if (this.cooldown > 0 || (this.active > 0 && this.id !== 'wingmen')) {
            this.engine.audio.play('uiError', { volume: 0.5 })
            return false
        }
        this.cooldown = this.cooldownMax
        this.uses++
        this.engine.objectives?.onAbility()
        switch (this.id) {
            case 'seeker': this.fireSeekers()
                break
            case 'shockwave': this.pulse(p.pos, 1)
                break
            case 'berserk': this.startBerserk()
                break
            case 'wingmen': this.launchWingmen()
                break
            case 'overdrive': this.startOverdrive()
                break
            case 'strike': this.callStrike()
                break
        }
        return true
    }

    /** Applies skill damage with the boss rules. */
    hit(e: Enemy, amount: number, point: THREE.Vector3) {
        if (!e.alive || amount <= 0) return
        if (e.kind === 'warden') amount = Math.min(amount * WARDEN_SKILL_MULT, e.maxHp * WARDEN_SKILL_CAP)
        damageEnemy(this.engine, e, amount, point, 'skill')
    }

    onKill(e: Enemy) {
        if (this.id !== 'berserk' || this.active <= 0 || !e.hostile) return
        const p = this.p
        if (this.params.killExtend && this.extended < 3) {
            const add = Math.min(this.params.killExtend, 3 - this.extended)
            this.extended += add
            this.active += add
            this.activeMax += add
        }
        if (this.params.killHeal) {
            p.hull = Math.min(this.stats.hull, p.hull + this.stats.hull * this.params.killHeal)
            this.engine.addFloat(_v1.copy(p.pos).add(_v2.set(0, 3, 0)), `+${Math.round(this.stats.hull * this.params.killHeal)}`, '#7dff9a', 13)
        }
        if (this.params.frenzy) this.frenzy = Math.min(10, this.frenzy + 1)
    }

    /**
     * Called before the player takes a hit. Returns the damage that should
     * still land (thorns, invulnerability and Glass Cannon live here).
     */
    onPlayerHit(amount: number, from: THREE.Vector3) {
        if (this.active <= 0) return amount
        if (this.id === 'berserk' && this.params.glass) return amount * 1.35
        if (this.id !== 'overdrive') return amount
        if (this.lockTime > 0) {
            this.p.shieldBubble.impact(_v1.subVectors(from, this.p.pos).normalize().multiplyScalar(this.p.radius))
            return 0
        }
        const thorns = this.params.thorns ?? 0
        if (thorns > 0) {
            let best: Enemy | null = null
            let bestD = 90 * 90
            for (const e of this.engine.enemies) {
                if (!e.alive || !e.hostile) continue
                const d = e.pos.distanceToSquared(from)
                if (d < bestD) {
                    bestD = d
                    best = e
                }
            }
            if (best) {
                this.hit(best, amount * thorns * 2, best.pos)
                this.engine.tracers.push({ a: this.p.pos.clone(), b: best.pos.clone(), color: new THREE.Color(this.color).multiplyScalar(4), life: 0.25, maxLife: 0.25, width: 0.35 })
            }
        }
        return amount
    }

    /** Honour Guard: a wingman can shoot a hostile shot out of the air. */
    intercept(pr: Projectile) {
        if (this.id !== 'wingmen' || !this.params.guard || !this.wingmen.length) return false
        const p = this.p
        if (pr.pos.distanceToSquared(p.pos) > 55 * 55) return false
        const w = this.wingmen.find(x => x.guard <= 0 && x.dive <= 0)
        if (!w) return false
        w.guard = 0.5
        this.engine.tracers.push({ a: w.pos.clone(), b: pr.pos.clone(), color: new THREE.Color(this.color).multiplyScalar(4), life: 0.18, maxLife: 0.18, width: 0.2 })
        hitSpark(this.engine.fx, pr.pos, _v1.subVectors(w.pos, pr.pos).normalize(), this.color, 0.8)
        return true
    }

    // ─── Per frame ─────────────────────────────────────────────────────────

    update(dt: number) {
        const p = this.engine.player
        if (!p) return
        this.cooldown = Math.max(0, this.cooldown - dt)
        if (this.active > 0) {
            this.active -= dt
            this.tickActive(dt)
            if (this.active <= 0) this.endActive()
        }
        if (this.aftershock >= 0) {
            this.aftershock -= dt
            if (this.aftershock < 0) this.pulse(this.aftershockPos, 0.6)
        }
        this.updateWingmen(dt)
        this.updateStrikes(dt)
        this.updateFields(dt)
    }

    private tickActive(dt: number) {
        const p = this.p
        const e = this.engine
        if (this.id === 'berserk') {
            if (Math.random() < dt * 40) {
                const d = _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(p.radius * 1.3)
                e.particles.emit(p.pos.x + d.x, p.pos.y + d.y, p.pos.z + d.z, p.vel.x + d.x * 2, p.vel.y + d.y * 2 + 3, p.vel.z + d.z * 2, { life: 0.5, size: 1.4, sizeEnd: 0, color: 0xff3b5c, colorEnd: 0xff9a3d, intensity: 2.2, drag: 1 })
            }
        }
        if (this.id === 'overdrive') {
            this.lockTime = Math.max(0, this.lockTime - dt)
            p.shieldDelay = 0
            if (this.params.aura) {
                this.auraTimer -= dt
                if (this.auraTimer <= 0) {
                    this.auraTimer = 0.5
                    const radius = 35 + p.radius
                    for (const en of e.enemies) {
                        if (!en.alive || !en.hostile || en.pos.distanceTo(p.pos) > radius + en.radius) continue
                        this.hit(en, this.power * 1.2, en.pos)
                        e.tracers.push({ a: p.pos.clone(), b: en.pos.clone(), color: new THREE.Color(0x9fdcff).multiplyScalar(4), life: 0.15, maxLife: 0.15, width: 0.25 })
                    }
                }
            }
        }
    }

    private endActive() {
        const p = this.p
        const e = this.engine
        if (this.id === 'berserk') {
            this.frenzy = 0
            this.extended = 0
            p.shieldBubble.setColor(0x6fd8ff, 1.6)
        }
        if (this.id === 'overdrive') {
            const leftover = Math.max(0, p.shield - this.stats.shield)
            if (this.params.discharge && leftover > 0) {
                const radius = 60
                e.rings.spawn(p.pos, radius, this.color, 0.6, 3)
                e.flashes.flash(p.pos, this.color, 60, 140)
                e.audio.play('explosionLarge', { volume: 0.8 })
                for (const en of e.enemies) {
                    if (!en.alive || !en.hostile) continue
                    const d = en.pos.distanceTo(p.pos)
                    if (d < radius + en.radius) this.hit(en, leftover * 1.5 * (1 - 0.5 * d / (radius + en.radius)), en.pos)
                }
            }
            p.shield = Math.min(p.shield, this.stats.shield)
            this.shieldCap = 0
            p.shieldBubble.setColor(0x6fd8ff, 1.6)
        }
        if (this.id === 'wingmen') {
            for (const w of this.wingmen) {
                if (this.params.kamikaze) {
                    w.dive = 2.5
                    w.target = this.nearestHostile(w.pos, 400)
                } else {
                    this.removeWingman(w, false)
                }
            }
            if (!this.params.kamikaze) this.wingmen = []
        }
    }

    hud(): SkillHud {
        return {
            id: this.id,
            name: this.name,
            color: `#${this.color.toString(16).padStart(6, '0')}`,
            ready: this.cooldownMax > 0 ? 1 - this.cooldown / this.cooldownMax : 1,
            active: this.active > 0,
            activeFrac: this.active > 0 ? this.active / Math.max(0.01, this.activeMax) : 0,
            stacks: this.frenzy
        }
    }

    dispose() {
        for (const w of this.wingmen) w.group.parent?.remove(w.group)
        this.wingmen = []
        this.strikes = []
        this.fields = []
    }

    private nearestHostile(from: THREE.Vector3, range: number) {
        let best: Enemy | null = null
        let bestD = range * range
        for (const e of this.engine.enemies) {
            if (!e.alive || !e.hostile || e.kind === 'mine') continue
            const d = e.pos.distanceToSquared(from)
            if (d < bestD) {
                bestD = d
                best = e
            }
        }
        return best
    }

    // ─── Seeker Missiles ───────────────────────────────────────────────────

    private fireSeekers() {
        const e = this.engine
        const p = this.p
        const hell = this.params.hellstorm ? 3 : 1
        const count = Math.round((this.params.count ?? 2) * hell)
        const damage = (this.params.damage ?? 5) * this.power * this.pct('damagePct') * (this.params.hellstorm ? 0.4 : 1)
        const targets = e.enemies.filter(en => en.alive && en.hostile && en.kind !== 'mine' && en.pos.distanceTo(p.pos) < 450)
            .sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))
        if (e.focus?.alive && e.focus.hostile) {
            targets.splice(targets.indexOf(e.focus), 1)
            targets.unshift(e.focus)
        }
        let rocks: Asteroid[] = []
        if (!targets.length && this.params.mining) {
            e.asteroids?.query(p.pos, 260, (r) => {
                if (r.ore) rocks.push(r)
            })
            rocks = rocks.sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))
        }
        const size = voidShip(e.config!.shipId).size
        for (let i = 0; i < count; i++) {
            const target = targets.length ? targets[i % targets.length]! : null
            const rock = rocks.length ? rocks[i % rocks.length]! : null
            const side = i % 2 ? 1 : -1
            const dir = new THREE.Vector3(side * (0.7 + Math.random() * 0.4), 0.3 + Math.random() * 0.5, -0.5).applyQuaternion(p.quat).normalize()
            const vel = dir.multiplyScalar(55 * this.pct('speedPct'))
            if (!target && rock) vel.lerp(_v1.subVectors(rock.pos, p.pos).normalize().multiplyScalar(90), 0.6)
            else if (!target) vel.addScaledVector(_v1.copy(FORWARD).applyQuaternion(e.aimQuat), 80)
            e.projectiles.push({
                pos: p.pos.clone().addScaledVector(dir.clone().normalize(), size * 0.4),
                vel: vel.add(p.vel),
                life: 5,
                damage,
                hostile: false,
                color: new THREE.Color(this.color).multiplyScalar(3),
                width: 0.5,
                length: 2,
                splash: (this.params.radius ?? 12) * this.pct('radiusPct'),
                homing: target,
                kind: 'missile',
                mining: this.params.mining ? 3 : 0.5,
                source: 'skill',
                cluster: this.params.cluster ? 4 : 0,
                turn: this.pct('speedPct')
            })
        }
        e.audio.play('missile', { volume: 1.3, pitch: 1.15 })
    }

    // ─── Shockwave ─────────────────────────────────────────────────────────

    private pulse(center: THREE.Vector3, strength: number) {
        const e = this.engine
        const radius = (this.params.radius ?? 65) * this.pct('radiusPct')
        const damage = (this.params.damage ?? 7) * this.power * this.pct('damagePct') * strength
        const implode = !!this.params.implosion
        const knock = (this.params.knock ?? 60) * this.pct('knockPct')
        e.rings.spawn(center, radius, this.color, 0.55, 3)
        e.rings.spawn(center, radius * 0.55, 0xffffff, 0.4, 2)
        e.flashes.flash(center, this.color, 50 * strength, radius * 2)
        e.trauma = Math.min(1, e.trauma + 0.35 * strength)
        e.audio.play('explosionLarge', { volume: 0.7 * strength, pitch: implode ? 0.7 : 1.2 })
        e.audio.play('blink', { volume: 0.6, pitch: 0.5 })
        for (let i = 0; i < 50; i++) {
            const d = _v1.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize()
            const speed = radius * (implode ? -1 : 1.6)
            const start = implode ? _v2.copy(center).addScaledVector(d, radius) : _v2.copy(center)
            e.sparks.emit(start.x, start.y, start.z, d.x * speed, d.y * speed, d.z * speed, 0.55, _c1.set(this.color).multiplyScalar(3), 0.25)
        }
        for (const en of e.enemies) {
            if (!en.alive || !en.hostile) continue
            const to = _v1.subVectors(en.pos, center)
            const d = to.length()
            if (d > radius + en.radius) continue
            const near = 1 - 0.5 * d / (radius + en.radius)
            this.hit(en, damage * (implode ? 0.6 + near * 0.7 : near), en.pos)
            if (en.kind !== 'warden') {
                to.normalize()
                en.vel.addScaledVector(to, (implode ? -0.8 : 1) * knock * (en.kind === 'carrier' || en.kind === 'bulwark' ? 0.3 : 1))
                if (this.params.stun) en.cooldown = Math.max(en.cooldown, this.params.stun)
            }
        }
        e.asteroids?.query(center, radius, (rock) => {
            if (!rock.ore) return
            e.damageRock(rock, damage * 2.5 * this.stats.miningMult, rock.pos)
        })
        const reach = radius * (this.params.magnet ? 2 : 1)
        for (const pk of e.pickups) {
            if (!pk.pulled && pk.pos.distanceTo(center) < reach) {
                pk.pulled = true
                pk.pullTime = 0
            }
        }
        if (strength >= 1 && this.params.aftershock) {
            this.aftershock = 0.8
            this.aftershockPos.copy(center)
        }
    }

    // ─── Berserker ─────────────────────────────────────────────────────────

    private startBerserk() {
        const p = this.p
        const e = this.engine
        this.active = this.activeMax = this.params.duration ?? 6
        this.frenzy = 0
        this.extended = 0
        p.shieldBubble.setColor(0xff3b5c, 1.2)
        e.rings.spawn(p.pos, 26, this.color, 0.5, 2.5)
        e.flashes.flash(p.pos, this.color, 40, 60)
        e.trauma = Math.min(1, e.trauma + 0.25)
        e.audio.play('charge', { volume: 1.2, pitch: 1.4 })
    }

    // ─── Wingmen ───────────────────────────────────────────────────────────

    private launchWingmen() {
        const e = this.engine
        const p = this.p
        for (const w of this.wingmen) this.removeWingman(w, false)
        this.wingmen = []
        const count = Math.round(this.params.count ?? 2)
        this.active = this.activeMax = (this.params.duration ?? 15) * this.pct('durationPct')
        const scale = THREE.MathUtils.clamp(voidShip(e.config!.shipId).size / 5, 0.55, 1.3)
        for (let i = 0; i < count; i++) {
            const model = buildShip('wasp')
            const group = new THREE.Group()
            model.group.scale.setScalar(scale * 0.8)
            group.add(model.group)
            const slot = i
            const offset = this.slotOffset(slot, count)
            group.position.copy(offset).applyQuaternion(p.quat).add(p.pos).addScaledVector(_v1.copy(FORWARD).applyQuaternion(p.quat), -40)
            group.quaternion.copy(p.quat)
            e.scene.add(group)
            const w: Wingman = {
                group, pos: group.position, vel: p.vel.clone(), slot, cooldown: randomFloat() * 0.3, guard: 0,
                target: null, retarget: 0, trail: new Trail(8, this.color, 0.3, 0.03), dive: 0
            }
            w.trail.reset(w.pos)
            this.wingmen.push(w)
            e.rings.spawn(w.pos, 10, this.color, 0.5, 2)
        }
        e.audio.play('undock', { volume: 0.7, pitch: 1.3 })
    }

    private slotOffset(slot: number, count: number) {
        const size = voidShip(this.engine.config!.shipId).size
        const side = slot % 2 === 0 ? -1 : 1
        const rank = Math.floor(slot / 2) + 1
        return _v2.set(side * (size * 0.9 + 7 * rank), 2 + rank, size * 0.6 + 5 * rank + (count > 2 ? 2 : 0))
    }

    private updateWingmen(dt: number) {
        if (!this.wingmen.length) return
        const e = this.engine
        const p = this.p
        const damage = (this.params.damage ?? 0.8) * this.power * this.pct('damagePct')
        const rate = (this.params.rate ?? 3) * this.pct('ratePct')
        if (this.active > 0 && this.params.shieldRegen && p.alive) {
            const cap = Math.max(this.stats.shield, this.shieldCap)
            p.shield = Math.min(cap, p.shield + this.stats.shield * this.params.shieldRegen * dt)
        }
        const keep: Wingman[] = []
        for (const w of this.wingmen) {
            w.guard = Math.max(0, w.guard - dt)
            if (w.dive > 0) {
                w.dive -= dt
                if (w.target && !w.target.alive) w.target = this.nearestHostile(w.pos, 300)
                const goal = w.target?.pos ?? _v1.copy(w.pos).addScaledVector(w.vel, 1)
                const want = _v1.subVectors(goal, w.pos).normalize().multiplyScalar(170)
                w.vel.lerp(want, 1 - Math.exp(-4 * dt))
                w.pos.addScaledVector(w.vel, dt)
                w.group.lookAt(_v2.copy(w.pos).add(w.vel))
                w.trail.update(dt, w.pos)
                w.trail.draw(e.lines, w.pos, 1)
                const hitTarget = w.target && w.pos.distanceTo(w.target.pos) < w.target.radius + 3
                if (hitTarget || w.dive <= 0 || !w.target) {
                    const radius = 18
                    explosion(e.fx, w.pos, w.vel, 1.4, this.color, false)
                    e.audio.play('explosionSmall', { distance: w.pos.distanceTo(e.camera.position), pan: e.panOf(w.pos) })
                    for (const en of e.enemies) {
                        if (!en.alive || !en.hostile) continue
                        const d = en.pos.distanceTo(w.pos)
                        if (d < radius + en.radius) this.hit(en, 7 * this.power * this.pct('damagePct') * (1 - 0.5 * d / (radius + en.radius)), en.pos)
                    }
                    this.removeWingman(w, true)
                    continue
                }
                keep.push(w)
                continue
            }

            w.retarget -= dt
            if (w.retarget <= 0) {
                w.retarget = 0.5
                const t = e.focus?.alive && e.focus.hostile && e.focus.pos.distanceTo(p.pos) < 260 ? e.focus : this.nearestHostile(p.pos, 240)
                w.target = t
            }
            if (w.target && !w.target.alive) w.target = null
            const home = _v1.copy(this.slotOffset(w.slot, this.wingmen.length)).applyQuaternion(p.quat).add(p.pos)
            let goal = home
            if (w.target) {
                // Swing out toward the target but stay loosely in formation.
                const a = e.time * 1.4 + w.slot * 2.1
                goal = _v2.copy(w.target.pos).add(_v1.set(Math.cos(a) * 30, 8, Math.sin(a) * 30)).lerp(home, 0.35)
            }
            const desired = _v1.subVectors(goal, w.pos).multiplyScalar(2.2).add(w.target ? _v2.set(0, 0, 0) : p.vel)
            w.vel.lerp(desired, 1 - Math.exp(-3.5 * dt))
            w.pos.addScaledVector(w.vel, dt)
            const look = w.target ? w.target.pos : _v2.copy(w.pos).addScaledVector(_v1.copy(FORWARD).applyQuaternion(p.quat), 10)
            _m.lookAt(w.pos, look, _up)
            _q.setFromRotationMatrix(_m)
            // lookAt on a matrix points -z at the target, which matches the hull's nose.
            w.group.quaternion.slerp(_q, 1 - Math.exp(-6 * dt))
            w.trail.update(dt, w.pos)
            w.trail.draw(e.lines, w.pos, 0.7)

            w.cooldown -= dt
            if (w.target && w.cooldown <= 0 && w.pos.distanceTo(w.target.pos) < 230) {
                w.cooldown = 1 / rate
                const dir = _v1.subVectors(w.target.pos, w.pos).addScaledVector(w.target.vel, w.pos.distanceTo(w.target.pos) / 420).normalize()
                e.projectiles.push({
                    pos: w.pos.clone(),
                    vel: dir.multiplyScalar(420).add(w.vel),
                    life: 0.7,
                    damage,
                    hostile: false,
                    color: new THREE.Color(this.color).multiplyScalar(3),
                    width: 0.25,
                    length: 4,
                    splash: 0,
                    homing: null,
                    kind: 'bolt',
                    mining: 1,
                    source: 'wingman'
                })
                if (Math.random() < 0.35) e.audio.play('pulse', { distance: w.pos.distanceTo(e.camera.position) * 0.5, volume: 0.35, pitch: 1.25 })
            }
            keep.push(w)
        }
        this.wingmen = keep
    }

    private removeWingman(w: Wingman, exploded: boolean) {
        const e = this.engine
        if (!exploded) {
            e.rings.spawn(w.pos, 8, this.color, 0.4, 2)
            for (let i = 0; i < 16; i++) e.particles.emit(w.pos.x, w.pos.y, w.pos.z, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, { life: 0.4, size: 1.5, sizeEnd: 0, color: this.color, intensity: 2 })
        }
        w.group.parent?.remove(w.group)
    }

    // ─── Shield Overdrive ──────────────────────────────────────────────────

    private startOverdrive() {
        const p = this.p
        const e = this.engine
        this.active = this.activeMax = this.params.duration ?? 6
        const over = (this.params.overcharge ?? 0.5) * (this.params.lock ? 0.5 : 1)
        this.shieldCap = this.stats.shield * (1 + over)
        p.shield = this.shieldCap
        this.lockTime = this.params.lock ?? 0
        this.auraTimer = 0
        if (this.params.hullRepair) {
            const heal = this.stats.hull * this.params.hullRepair
            p.hull = Math.min(this.stats.hull, p.hull + heal)
            e.addFloat(_v1.copy(p.pos).add(_v2.set(0, 3, 0)), `+${Math.round(heal)}`, '#7dff9a', 14)
        }
        p.shieldBubble.setColor(this.lockTime > 0 ? 0xffffff : this.color, 2.4)
        e.rings.spawn(p.pos, voidShip(e.config!.shipId).size * 2.5, this.color, 0.6, 3)
        e.flashes.flash(p.pos, this.color, 40, 70)
        e.audio.play('shieldHit', { volume: 1.2, pitch: 0.6 })
        e.audio.play('charge', { volume: 0.8, pitch: 1.8 })
    }

    // ─── Orbital Strike ────────────────────────────────────────────────────

    private callStrike() {
        const e = this.engine
        const p = this.p
        const range = (this.params.range ?? 320) * this.pct('rangePct')
        const delay = (this.params.delay ?? 1.2) * this.pct('delayPct')
        const radius = (this.params.radius ?? 40) * this.pct('radiusPct')
        const damage = (this.params.damage ?? 16) * this.power * this.pct('damagePct')
        const aimDir = _v1.copy(FORWARD).applyQuaternion(e.aimQuat).normalize()

        let center: THREE.Vector3
        if (e.focus?.alive && e.focus.pos.distanceTo(p.pos) < range) {
            center = e.focus.pos.clone().addScaledVector(e.focus.vel, delay * 0.7)
        } else {
            const hit = e.asteroids?.raycast(p.pos, _v2.copy(p.pos).addScaledVector(aimDir, range), 0)
            center = hit ? p.pos.clone().addScaledVector(aimDir, hit.t) : p.pos.clone().addScaledVector(aimDir, Math.min(range, 160))
        }

        if (this.params.carpet) {
            const start = Math.max(30, radius)
            const end = Math.max(start + 60, Math.min(range, center.distanceTo(p.pos) + 60))
            for (let i = 0; i < 6; i++) {
                const at = p.pos.clone().addScaledVector(aimDir, start + (end - start) * (i / 5))
                this.strikes.push({ pos: at, timer: delay + i * 0.12, delay: delay + i * 0.12, damage: damage * 0.4, radius: radius * 0.75 })
            }
        } else {
            const count = Math.round(this.params.count ?? 1)
            for (let i = 0; i < count; i++) {
                const at = center.clone()
                if (i > 0) {
                    const a = (i / count) * Math.PI * 2 + randomFloat()
                    at.add(_v2.set(Math.cos(a), (randomFloat() - 0.5) * 0.3, Math.sin(a)).multiplyScalar(radius * 0.9))
                }
                this.strikes.push({ pos: at, timer: delay + i * 0.2, delay: delay + i * 0.2, damage, radius })
            }
        }
        e.audio.play('warning', { volume: 0.6, pitch: 1.4 })
    }

    private updateStrikes(dt: number) {
        if (!this.strikes.length) return
        const e = this.engine
        const next: Strike[] = []
        for (const s of this.strikes) {
            s.timer -= dt
            const k = 1 - Math.max(0, s.timer) / s.delay
            // A beam of light narrows onto the mark from far above.
            const top = _v1.copy(s.pos).add(_v2.set(0, 600, 0))
            e.lines.pushV(top, s.pos, _c1.set(this.color).multiplyScalar(1 + k * 3), 0.25 + k * 0.6, 0.3 + (1 - k) * s.radius * 0.3, 0.2 + k * 0.6)
            e.particles.glow(s.pos.x, s.pos.y, s.pos.z, _c1.set(this.color).multiplyScalar(2 + k * 2), 4 + k * 8)
            if (this.params.singularity && s.timer > 0) {
                const pull = s.radius * 2.2
                for (const en of e.enemies) {
                    if (!en.alive || !en.hostile || en.kind === 'warden') continue
                    const to = _v2.subVectors(s.pos, en.pos)
                    const d = to.length()
                    if (d < pull && d > 2) en.vel.lerp(to.normalize().multiplyScalar(90), 1 - Math.exp(-3 * dt))
                }
                for (const pk of e.pickups) {
                    if (pk.pos.distanceTo(s.pos) < pull) pk.pos.lerp(s.pos, 1 - Math.exp(-3 * dt))
                }
            }
            if (s.timer > 0) {
                next.push(s)
                continue
            }
            this.detonate(s)
        }
        this.strikes = next
    }

    private detonate(s: Strike) {
        const e = this.engine
        const p = this.p
        explosion(e.fx, s.pos, _v1.set(0, 0, 0), Math.max(2, s.radius / 12), this.color)
        e.rings.spawn(s.pos, s.radius, this.color, 0.6, 3)
        e.rings.spawn(s.pos, s.radius * 0.5, 0xffffff, 0.35, 2)
        e.flashes.flash(s.pos, this.color, 90, s.radius * 4)
        const dist = s.pos.distanceTo(e.camera.position)
        e.trauma = Math.min(1, e.trauma + Math.max(0, 0.5 - dist / 600))
        e.audio.play('explosionLarge', { distance: dist * 0.5, pan: e.panOf(s.pos) })
        for (const en of e.enemies) {
            if (!en.alive || !en.hostile) continue
            const d = en.pos.distanceTo(s.pos)
            if (d < s.radius + en.radius) this.hit(en, s.damage * (1 - 0.5 * d / (s.radius + en.radius)), en.pos)
        }
        e.asteroids?.query(s.pos, s.radius, (rock) => {
            if (rock.ore) e.damageRock(rock, s.damage * this.stats.miningMult, rock.pos)
        })
        // Your own ordnance does not hurt you, but it does shove.
        if (p.alive && p.pos.distanceTo(s.pos) < s.radius) p.vel.addScaledVector(_v1.subVectors(p.pos, s.pos).normalize(), 30)
        if (this.params.burn) this.fields.push({ pos: s.pos.clone(), life: 4, radius: s.radius * 0.8, dps: s.damage * 0.12 })
    }

    private updateFields(dt: number) {
        if (!this.fields.length) return
        const e = this.engine
        this.fields = this.fields.filter((f) => {
            f.life -= dt
            if (f.life <= 0) return false
            for (let i = 0; i < 3; i++) {
                const a = Math.random() * Math.PI * 2
                const r = Math.sqrt(Math.random()) * f.radius
                e.particles.emit(f.pos.x + Math.cos(a) * r, f.pos.y + (Math.random() - 0.5) * 6, f.pos.z + Math.sin(a) * r, 0, 4 + Math.random() * 6, 0, { life: 0.6, size: 3, sizeEnd: 0.5, color: 0xffa23d, colorEnd: 0xff3b1a, intensity: 2, drag: 0.5 })
            }
            for (const en of e.enemies) {
                if (!en.alive || !en.hostile) continue
                if (en.pos.distanceTo(f.pos) < f.radius + en.radius) this.hit(en, f.dps * dt, en.pos)
            }
            return true
        })
    }

    /** Where to draw strike markers on the overlay. */
    markers() {
        return this.strikes.map(s => ({ pos: s.pos, radius: s.radius, k: 1 - Math.max(0, s.timer) / s.delay }))
    }

    /** Segment test used by the lance-style hitscan helpers. */
    static rayHits(from: THREE.Vector3, dir: THREE.Vector3, e: Enemy, length: number) {
        const t = enemyRayHit(e, from, dir, length)
        return t !== null && t < length
    }
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
