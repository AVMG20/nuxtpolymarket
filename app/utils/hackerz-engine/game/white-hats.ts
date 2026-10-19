import * as THREE from 'three'
import { hackerzIsAirborne } from '#shared/utils/gamelogic/hackerz'
import { hdr } from '../models'
import type { EnemyEntity } from '../types'
import { _v } from './tuning'
import { bodyPoint } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/**
 * Turned units: a White Hat's converts hunt the hostiles, and a hostile
 * with one in its face fights it.
 */
export class WhiteHats {
    constructor(private readonly game: HackerzGame) {}

    /** A hostile a White Hat can take: not a boss, not a copy, not one already ours, not one out of reach. */
    turnable(enemy: EnemyEntity) {
        return !enemy.def.boss && !enemy.decoy && !enemy.turned && enemy.hp > 0 && !this.game.combat.untargetable(enemy)
    }

    /** It switches sides: drops whatever job it had, and is marked white. */
    turnEnemy(enemy: EnemyEntity) {
        enemy.turned = true
        if (enemy.hacking) this.game.hacking.stopHacking(enemy)
        // Every job it had for them is dropped: no more guarding, escorting or shield-bearing.
        enemy.escorting = null
        enemy.defending = null
        enemy.bearer = false
        enemy.parked = null
        enemy.healing = null
        if (this.game.rail.target === enemy) this.game.rail.target = null
        const halo = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: hdr(0xffffff, 2), toneMapped: false, transparent: true, opacity: 0.8, depthWrite: false }))
        halo.scale.setScalar(Math.max(0.6, enemy.rig.height * 0.4))
        halo.position.y = 0.05
        enemy.rig.root.add(halo)
        const at = bodyPoint(enemy, 0.5, new THREE.Vector3())
        this.game.particles.burst(at, 0xffffff, 24, 8, { size: 0.26, life: 0.6 })
        this.game.transient?.ring(at, 0xffffff, 3, 0.4)
        this.game.overlay.floatText(bodyPoint(enemy, 1, _v, 20), 'WHITE HAT', 0xffffff, 1.1)
    }

    /** What a turned unit, or a hostile it is brawling with, hits for: its own heft, not its wall damage. */
    private brawlHit(enemy: EnemyEntity) {
        return enemy.maxHp * 0.12 + enemy.damage * 3
    }

    /** The hostile a turned unit goes for: the nearest one it can reach. */
    private turnedFoe(enemy: EnemyEntity) {
        let best: EnemyEntity | null = null
        let bestDistance = Infinity
        for (const other of this.game.enemies) {
            if (other === enemy || other.turned || other.hp <= 0 || other.burrowMs > 0) continue
            // A turned unit on foot cannot reach a flyer.
            if (hackerzIsAirborne(other.def) && !hackerzIsAirborne(enemy.def)) continue
            const distance = Math.hypot(other.u - enemy.u, other.d - enemy.d)
            if (distance < bestDistance) {
                best = other
                bestDistance = distance
            }
        }
        return best
    }

    /** A turned unit's move: after the nearest hostile, and a blow every attack beat once it is there. */
    turnedStep(enemy: EnemyEntity, dt: number, dtMs: number) {
        const foe = this.turnedFoe(enemy)
        if (!foe) return { moved: 0, arrived: false }
        const du = foe.u - enemy.u
        const dd = foe.d - enemy.d
        const dist = Math.hypot(du, dd)
        const reach = enemy.radius + foe.radius + 10
        let moved = 0
        if (dist > reach) {
            moved = Math.min(dist - reach, enemy.speed * this.game.pushSpeed * dt)
            enemy.u += du / dist * moved
            enemy.d += dd / dist * moved
            enemy.yaw = Math.atan2(du, -dd)
        } else {
            enemy.attackTimer -= dtMs
            if (enemy.attackTimer <= 0) {
                enemy.attackTimer = enemy.def.attackMs
                enemy.strike = 1
                this.game.combat.damageEnemy(foe, this.brawlHit(enemy), 'kinetic', true, true)
                const at = bodyPoint(foe, 0.5, new THREE.Vector3())
                this.game.particles.burst(at, 0xffffff, 8, 6, { size: 0.22, life: 0.3 })
            }
        }
        return { moved, arrived: false }
    }

    /**
     * A hostile with a turned unit in its face fights it instead of pressing on:
     * stands, and hits it every attack beat. Null when none is close enough.
     */
    brawlStep(enemy: EnemyEntity, dtMs: number) {
        if (enemy.turned || enemy.def.boss) return null
        let foe: EnemyEntity | null = null
        for (const other of this.game.enemies) {
            if (!other.turned || other.hp <= 0) continue
            if (Math.hypot(other.u - enemy.u, other.d - enemy.d) <= enemy.radius + other.radius + 12) {
                foe = other
                break
            }
        }
        if (!foe) return null
        enemy.attackTimer -= dtMs
        if (enemy.attackTimer <= 0) {
            enemy.attackTimer = enemy.def.attackMs
            enemy.strike = 1
            this.game.combat.damageEnemy(foe, this.brawlHit(enemy), 'kinetic', true, false)
        }
        return { moved: 0, arrived: false }
    }
}
