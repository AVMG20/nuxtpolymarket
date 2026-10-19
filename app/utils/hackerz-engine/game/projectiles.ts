import * as THREE from 'three'
import { randomBetween, randomChance } from '../rng'
import { HACKERZ_HACKER_ID } from '#shared/utils/gamelogic/hackerz'
import { BULLET_LIFE_MS, BULLET_RADIUS, DESPAWN_DEPTH, FIELD_SCALE, SPIT_GRAVITY, WALL_HALF_LENGTH } from '../constants'
import { segSegDist } from '../math'
import type { PathChip } from '../path-chips'
import { turnToward } from '../rig-motion'
import { fieldToWorld } from '../scene'
import { makeProjectile } from '../fx'
import type { BulletEntity, EnemyEntity, SpitEntity } from '../types'
import { LEAK_D, _v, _w, halfExtents, WALL_HIT_Y, type ShotSpec, MUZZLE_D, PACKET_LOSS, LONGBORE_FLARE } from './tuning'
import { enemyCentreY, enemyWorld, reachOf } from './bodies'
import type { HackerzGame } from '../hackerz-game'

const BLACK_ICE_SLOW = 0.45

const PUNCH_HOLD_MS = 70
const PUNCH_PUSH = 480

/** How long a round fired blind into the dark lights up what it hits. */
const HIT_LIGHT_MS = 450

/** How long a blast leaves a unit glitching, and over how much of the end it eases out. */
const GLITCH_MS = 650

/**
 * Everything in flight: the player's rounds (with their splash, arcs and
 * homing) and the hostiles' spit at the wall.
 */
export class Projectiles {
    constructor(private readonly game: HackerzGame) {}

    bullets: BulletEntity[] = []

    spits: SpitEntity[] = []

    /**
     * Whether a round's step this.game frame touched a unit. The unit's footprint is
     * its model's: a capsule as long and as wide as the model, never smaller
     * than the body radius the rules give it.
     */
    private roundHits(bullet: BulletEntity, enemy: EnemyEntity) {
        if (this.game.combat.untouchable(enemy)) return false
        // A rider turned onto a rung lies across the lane rather than along it.
        const sideways = Math.abs(Math.sin(enemy.yaw)) > 0.7
        const { x: across, z: along } = halfExtents(enemy.rig.box)
        const halfU = sideways ? along : across
        const halfD = sideways ? across : along
        const reach = Math.max(enemy.radius, halfU + BULLET_RADIUS)
        const spine = Math.max(0, halfD - halfU)
        return segSegDist(
            bullet.prevU, bullet.prevD, bullet.u, bullet.d,
            enemy.u, enemy.d - spine, enemy.u, enemy.d + spine
        ) <= reach
    }

    /**
     * A round on the ground plane: `angle` is measured from straight out (+d)
     * toward +u. Its rendered height eases from the muzzle to `toY` over the
     * ground distance to the aim point, so a locked shot visibly meets the body.
     */
    spawnBullet(u: number, d: number, fromY: number, angle: number, spec: ShotSpec, toY: number, aimAt: EnemyEntity | null) {
        const mesh = makeProjectile(spec.projectile, spec.hex, spec.crit, spec.fromTurret)
        this.game.fieldRoot.add(mesh)
        const span = aimAt ? Math.max(40, Math.hypot(aimAt.u - u, aimAt.d - d)) : Math.max(40, Math.hypot(this.game.rail.aimU - u, this.game.rail.aimD - d))
        const bullet: BulletEntity = {
            mesh,
            u,
            d,
            y: fromY,
            prevU: u,
            prevD: d,
            vu: Math.sin(angle) * spec.speed,
            vd: Math.cos(angle) * spec.speed,
            damage: spec.damage,
            pierce: spec.pierce,
            hit: new Set(),
            // Missiles are slow and steer, so they need a far longer leash.
            lifeMs: BULLET_LIFE_MS * (spec.homing ? 3.5 : 1),
            crit: spec.crit,
            fromTurret: spec.fromTurret,
            damageType: spec.damageType,
            splashRadius: spec.splashRadius,
            splashDamage: spec.splashDamage,
            homing: spec.homing,
            target: spec.homing ? (aimAt ?? this.pickHomingTarget(u, d)) : null,
            chain: spec.chain,
            chainFalloff: spec.chainFalloff,
            hex: spec.hex,
            projectile: spec.projectile,
            fromY,
            toY,
            span,
            flown: 0
        }
        if (this.game.bonus === 'packetloss' && randomChance(PACKET_LOSS)) {
            bullet.lostAt = randomBetween(0.25, 0.85) * span
        }
        this.orientBullet(bullet)
        this.bullets.push(bullet)
    }

    orientBullet(bullet: BulletEntity) {
        const p = fieldToWorld(bullet.u, bullet.d, bullet.y * FIELD_SCALE, bullet.mesh.position)
        _w.set(p.x + bullet.vu * FIELD_SCALE, p.y, p.z - bullet.vd * FIELD_SCALE)
        bullet.mesh.lookAt(_w)
    }

    /** Missiles lock the enemy closest to the wall — the one that matters. */
    private pickHomingTarget(u: number, d: number) {
        let best: EnemyEntity | null = null
        let bestScore = -Infinity
        for (const enemy of this.game.enemies) {
            if (this.game.combat.untargetable(enemy)) continue
            const score = -enemy.d - Math.hypot(enemy.u - u, enemy.d - d) * 0.25
            if (score > bestScore) {
                bestScore = score
                best = enemy
            }
        }
        return best
    }

    updateBullets(dt: number) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i] as BulletEntity

            // Punching through a body, a railgun round hangs there a beat before it carries on.
            if (bullet.holdMs) {
                bullet.holdMs = Math.max(0, bullet.holdMs - dt * 1000)
                continue
            }

            if (bullet.homing) this.steerMissile(bullet, dt)

            bullet.prevU = bullet.u
            bullet.prevD = bullet.d
            bullet.u += bullet.vu * dt
            bullet.d += bullet.vd * dt
            bullet.flown += Math.hypot(bullet.vu, bullet.vd) * dt
            const toY = bullet.homing && bullet.target ? enemyCentreY(bullet.target) : bullet.toY
            bullet.y = bullet.fromY + (toY - bullet.fromY) * Math.min(1, bullet.flown / bullet.span)
            bullet.lifeMs -= dt * 1000
            // Mid lag spike the round flies on, but its picture holds.
            if (this.game.lag.boardLagMs <= 0) this.orientBullet(bullet)

            if (bullet.lostAt !== undefined && bullet.flown >= bullet.lostAt) {
                const at = fieldToWorld(bullet.u, bullet.d, bullet.y * FIELD_SCALE, new THREE.Vector3())
                this.game.particles.burst(at, 0xe879f9, 10, 5, { size: 0.24, life: 0.4, gravity: 0 })
                this.game.overlay.floatText(at, 'LOST', 0xe879f9, 0.8)
                bullet.mesh.removeFromParent()
                this.bullets.splice(i, 1)
                continue
            }

            // Through a wall of black ice: the round drags on, slowed for good.
            if (!bullet.iced && this.game.blackIce.iceWalls.length && this.game.blackIce.throughIce(bullet.prevU, bullet.prevD, bullet.u, bullet.d)) {
                bullet.iced = true
                bullet.vu *= BLACK_ICE_SLOW
                bullet.vd *= BLACK_ICE_SLOW
                bullet.lifeMs /= BLACK_ICE_SLOW
                this.game.particles.burst(bullet.mesh.position, 0xa5b4fc, 6, 4, { size: 0.2, life: 0.3 })
            }

            // A round fired at leaked memory goes in low at the foot of the
            // fence, under the Daemons standing over it: it hits nothing on the
            // way, and is spent on the pile.
            if (bullet.leakU !== undefined) {
                if (bullet.d < LEAK_D) continue
                this.game.memory.shootLeak(bullet.leakU)
                bullet.mesh.removeFromParent()
                this.bullets.splice(i, 1)
                continue
            }

            let consumed = false
            for (let e = this.game.enemies.length - 1; e >= 0; e--) {
                const enemy = this.game.enemies[e]
                if (!enemy || bullet.hit.has(enemy)) continue
                if (!this.roundHits(bullet, enemy)) continue

                bullet.hit.add(enemy)
                // Caught by a bodyguard, the round spares the hacker behind it:
                // no splash and no arc jump reaches its charge.
                if (enemy.escorting) bullet.hit.add(enemy.escorting)
                this.game.combat.damageEnemy(enemy, bullet.damage, bullet.damageType, true, true, bullet.crit)
                // A round fired blind lights up what it hits, for a moment.
                if (this.game.combat.inTheDark(enemy)) enemy.litMs = HIT_LIGHT_MS
                this.game.callbacks.onSound?.('hit-enemy')
                const at = enemyWorld(enemy, enemyCentreY(enemy) - enemy.altitude, new THREE.Vector3())
                this.game.particles.burst(at, enemy.def.hex, bullet.crit ? 8 : 4, 9, { size: 0.22, life: 0.3 })
                if (bullet.projectile === 'slug' || bullet.pierce > 0) {
                    this.game.transient?.beam(fieldToWorld(bullet.prevU, bullet.prevD, bullet.y * FIELD_SCALE, new THREE.Vector3()), at, bullet.hex)
                }
                // A railgun round (the Longbore's, or a Rail Lance's) punching
                // through: it hangs in the body a beat, a shock ring bursts out
                // sideways, a gout of flame roars up out of it — the Longbore's
                // purple, a turret its own colour — and the body is driven back.
                if (bullet.projectile === 'slug') {
                    const flame = bullet.fromTurret ? bullet.hex : LONGBORE_FLARE
                    bullet.holdMs = PUNCH_HOLD_MS
                    this.game.transient?.flash(at, 0xffffff, 0.7, 0.1, 1.6)
                    this.game.transient?.shockRing(at, flame, Math.max(1.6, enemy.rig.height * 1.1), _w.set(bullet.vu, 0, -bullet.vd).normalize())
                    this.game.transient?.flame(at, flame, Math.max(6, enemy.rig.height * 3))
                    // The plated and the bosses only stagger; the light are hurled.
                    enemy.pushVd += PUNCH_PUSH * (enemy.def.boss ? 0.2 : enemy.armored ? 0.35 : 1)
                }

                if (bullet.splashRadius > 0) this.detonate(bullet, enemy)
                if (bullet.chain > 0) this.chainFrom(bullet, enemy)

                if (enemy.hp <= 0) {
                    const index = this.game.enemies.indexOf(enemy)
                    if (index >= 0) this.game.combat.killEnemy(index, 1)
                } else if (!enemy.def.boss) {
                    // A little shove on hit — the feedback that sells the shot
                    // even when the target survives it.
                    enemy.pushVd += bullet.fromTurret ? 12 : 30
                }

                // A warhead is spent on the first thing it touches, whatever its
                // pierce says; the splash is the multi-target part. A bodyguard
                // throws itself on the round: it goes no further either.
                if (bullet.pierce > 0 && bullet.splashRadius === 0 && !enemy.escorting) {
                    bullet.pierce--
                } else {
                    consumed = true
                    break
                }
            }

            if (!consumed && !bullet.fromTurret && this.game.roundThroughChips(bullet)) consumed = true

            const offField = Math.abs(bullet.u) > WALL_HALF_LENGTH + 200 || bullet.d > DESPAWN_DEPTH + 100 || bullet.d < MUZZLE_D - 60
            if (consumed || bullet.lifeMs <= 0 || offField) {
                bullet.mesh.removeFromParent()
                this.bullets.splice(i, 1)
            }
        }
    }

    /** Missiles turn at a fixed rate, so a bad lock is still a miss. */
    private steerMissile(bullet: BulletEntity, dt: number) {
        const target = bullet.target
        if (!target || target.hp <= 0 || !this.game.enemies.includes(target)) {
            bullet.target = this.pickHomingTarget(bullet.u, bullet.d)
            return
        }
        const speed = Math.hypot(bullet.vu, bullet.vd) || 1
        const desired = Math.atan2(target.u - bullet.u, target.d - bullet.d)
        const current = Math.atan2(bullet.vu, bullet.vd)
        const angle = turnToward(current, desired, 4.5 * dt)
        bullet.vu = Math.sin(angle) * speed
        bullet.vd = Math.cos(angle) * speed
        if (randomChance(dt * 30)) {
            this.game.particles.emit(bullet.mesh.position, _w.set(0, 0.5, 0), bullet.hex, { size: 0.25, life: 0.3, gravity: 0 })
        }
    }

    /**
     * Splash from a warhead. The direct target has already been hit. The blast
     * ripples out through the grid lines in the round's colour, exactly as far
     * as the splash reaches, and every hostile it catches shows the hit.
     */
    private detonate(bullet: BulletEntity, epicentre: EnemyEntity) {
        // It goes off on the unit it struck, not wherever the round happened to
        // be when it connected — a big target's far side would carry the blast
        // past its neighbours.
        const u = epicentre.u
        const d = epicentre.d
        const at = fieldToWorld(u, d, bullet.y * FIELD_SCALE, new THREE.Vector3())
        const ground = fieldToWorld(u, d, 0.1, new THREE.Vector3())
        // Kept dim: any brighter and the bloom washes the orange out to white.
        this.game.view?.addSurge(ground.x, ground.z, bullet.hex, 0.45, bullet.splashRadius * FIELD_SCALE)
        // The blast itself: a cloud of corrupted data scrambling the whole splash area.
        this.game.glitchClouds?.burst(fieldToWorld(u, d, 0, new THREE.Vector3()), bullet.splashRadius * FIELD_SCALE, bullet.hex)
        this.game.transient?.ring(ground, bullet.hex, bullet.splashRadius * FIELD_SCALE * 1.4, 0.38)
        this.game.particles.burst(at, bullet.hex, 14, 12, { size: 0.3, life: 0.45 })
        this.game.addShake(3)
        epicentre.glitchMs = GLITCH_MS
        // Hackers shrug splash off alone, but a crew working one node together
        // is hit as one: catch any of them, and the whole crew takes it.
        // The blast reaches a body if it reaches any of it, not just its middle:
        // two Bulwarks shoulder to shoulder stand further apart, centre to
        // centre, than a warhead's splash.
        const reached = (enemy: EnemyEntity) => enemy === epicentre || reachOf(enemy, u, d) <= bullet.splashRadius
        const crewNodes = new Set<PathChip>()
        for (const enemy of this.game.enemies) {
            if (enemy.def.id === HACKERZ_HACKER_ID && enemy.hacking && enemy.targetChip && reached(enemy)) crewNodes.add(enemy.targetChip)
        }
        const crew = new Set<EnemyEntity>()
        for (const chip of crewNodes) {
            const working = this.game.enemies.filter(e => e.def.id === HACKERZ_HACKER_ID && e.hacking && e.targetChip === chip && !this.game.combat.untouchable(e))
            if (working.length >= 2) for (const hacker of working) crew.add(hacker)
        }
        for (let e = this.game.enemies.length - 1; e >= 0; e--) {
            const enemy = this.game.enemies[e] as EnemyEntity
            if (enemy === epicentre || bullet.hit.has(enemy) || this.game.combat.untouchable(enemy)) continue
            if (crew.has(enemy)) {
                // A hacking crew: every member takes it, wherever on the node it works.
            } else if (enemy.def.id === HACKERZ_HACKER_ID || !reached(enemy)) {
                // A lone hacker shrugs splash off: picking one off takes a direct hit.
                continue
            }
            this.game.combat.damageEnemy(enemy, bullet.splashDamage, bullet.damageType, true, true, false)
            enemy.glitchMs = GLITCH_MS
            this.game.particles.burst(enemyWorld(enemy, enemyCentreY(enemy) - enemy.altitude, _w), bullet.hex, 6, 7, { size: 0.22, life: 0.3 })
            if (enemy.hp <= 0) this.game.combat.killEnemy(e, 1)
        }
    }

    /** Arc rounds jump to nearby enemies for a shrinking share of the damage. */
    private chainFrom(bullet: BulletEntity, source: EnemyEntity) {
        let from = source
        let damage = bullet.damage * bullet.chainFalloff

        for (let jump = 0; jump < bullet.chain; jump++) {
            let best: EnemyEntity | null = null
            let bestDist = 260
            for (const enemy of this.game.enemies) {
                // Hackers are grounded against arcs: only a direct hit lands on one.
                if (bullet.hit.has(enemy) || this.game.combat.untargetable(enemy) || enemy.def.id === HACKERZ_HACKER_ID) continue
                const d = Math.hypot(enemy.u - from.u, enemy.d - from.d)
                if (d < bestDist) {
                    bestDist = d
                    best = enemy
                }
            }
            if (!best) return
            // Electricity jumping body to body: a crackling bolt you can see,
            // and a spray of sparks where it lands.
            const start = enemyWorld(from, enemyCentreY(from) - from.altitude, new THREE.Vector3())
            const end = enemyWorld(best, enemyCentreY(best) - best.altitude, new THREE.Vector3())
            this.game.transient?.arc(start, end, bullet.hex)
            this.game.particles.burst(end, bullet.hex, 10, 9, { size: 0.22, life: 0.3 })
            this.game.particles.burst(end, 0xffffff, 4, 6, { size: 0.16, life: 0.2 })
            bullet.hit.add(best)
            this.game.combat.damageEnemy(best, damage, bullet.damageType, true, true, false)
            if (best.hp <= 0) {
                const index = this.game.enemies.indexOf(best)
                if (index >= 0) this.game.combat.killEnemy(index, 1)
            }
            from = best
            damage *= bullet.chainFalloff
        }
    }

    updateSpits(dt: number) {
        for (let i = this.spits.length - 1; i >= 0; i--) {
            const spit = this.spits[i] as SpitEntity
            spit.vy -= SPIT_GRAVITY * dt
            spit.d += spit.vd * dt
            spit.y += spit.vy * dt
            if (this.game.lag.boardLagMs <= 0) {
                fieldToWorld(spit.u, spit.d, spit.y * FIELD_SCALE, spit.mesh.position)
                spit.mesh.rotation.y += dt * 8
            }

            const landed = spit.d <= 0
            if (!landed && spit.y > -20) continue
            if (landed) {
                this.game.bastion.damageWall(spit.damage, spit.u)
                const at = fieldToWorld(spit.u, 0, WALL_HIT_Y * FIELD_SCALE, _v)
                this.game.particles.burst(at, spit.hex, spit.heavy ? 18 : 8, 10, { size: 0.28, life: 0.4 })
                if (spit.heavy) {
                    this.game.transient?.ring(at, spit.hex, 4, 0.4)
                    this.game.addShake(8)
                }
            }
            spit.mesh.removeFromParent()
            this.spits.splice(i, 1)
        }
    }
}
