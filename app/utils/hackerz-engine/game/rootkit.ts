import * as THREE from 'three'
import {
    HACKERZ_SPIDER_CAP, HACKERZ_SPIDER_HATCH_MS, HACKERZ_SPIDER_INFECT_RADIUS, HACKERZ_SPIDER_INJECT_MS, hackerzEnemy
} from '#shared/utils/gamelogic/hackerz'
import { FIELD_HALF_WIDTH, SHIELD_D } from '../constants'
import { clamp, randRange } from '../math'
import { MOTION, fangTips } from '../rig-motion'
import { fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { PER_WORLD, _v, _w, ROOTKIT_BURROW_MS } from './tuning'
import { enemyWorld, underground } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** How many spiderlings scatter where ROOTKIT goes under. */
const ROOTKIT_BURROW_CLUTCH = 3

/**
 * ROOTKIT: it burrows, surfaces somewhere else, infects the nodes it
 * passes and breeds spiderlings.
 */
export class Rootkit {
    constructor(private readonly game: HackerzGame) {}

    /** Hacked nodes ROOTKIT has infected, and ms until each hatches its next spiderling. */
    infected = new Map<number, number>()

    /**
     * ROOTKIT goes to ground every few seconds while it is still far out: gone
     * from sight and from every gun, moving faster, its route given away only by
     * red surges running through the traces, until it erupts somewhere else.
     */
    updateRootkit(enemy: EnemyEntity, dt: number, dtMs: number) {
        // It halts with its head against the ICE Barrier while that stands,
        // and against the fence itself once the barrier is down.
        enemy.standoff = enemy.rig.box.max.z * PER_WORLD + 2 + (this.game.bastion.shield > 0 ? SHIELD_D : 0)
        if (enemy.riseMs > 0) enemy.riseMs = Math.max(0, enemy.riseMs - dtMs)
        if (enemy.burrowMs > 0) {
            const wasUp = !underground(enemy)
            enemy.burrowMs = Math.max(0, enemy.burrowMs - dtMs)
            // The moment it drills out of sight, a clutch of its brood scatters from the hole.
            if (wasUp && underground(enemy) && !enemy.decoy) {
                const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
                this.game.transient?.ring(at, enemy.def.hex, 6, 0.45)
                this.game.particles.burst(at, enemy.def.hex, 30, 10, { size: 0.3, life: 0.6 })
                for (let i = 0; i < ROOTKIT_BURROW_CLUTCH; i++) {
                    const a = (i / ROOTKIT_BURROW_CLUTCH) * Math.PI * 2
                    this.hatchSpider(enemy.u + Math.cos(a) * 40, enemy.d + Math.sin(a) * 40)
                }
            }
            // Melting in: the floor boils red round it as it goes under.
            if (!underground(enemy) && Math.random() < dt * 30) {
                const at = fieldToWorld(enemy.u + randRange(-30, 30), enemy.d + randRange(-30, 30), 0.05, _v)
                this.game.particles.emit(at, _w.set(0, 1.5, 0), enemy.def.hex, { size: 0.3, life: 0.5, gravity: 0 })
            }
            enemy.u = clamp(enemy.u + Math.sin(enemy.age * 1.6) * dt * 90, -FIELD_HALF_WIDTH + 60, FIELD_HALF_WIDTH - 60)
            if (Math.random() < dt * 5) {
                const at = fieldToWorld(enemy.u, enemy.d, 0, _v)
                this.game.view?.addSurge(at.x, at.z, enemy.def.hex, 0.8)
            }
            if (enemy.burrowMs === 0) {
                // It erupts onto the nearest data line and rides on from there.
                this.game.movement.attachToNetwork(enemy)
                enemy.age = 0
                // And climbs back out of the floor where it surfaced.
                enemy.riseMs = MOTION.burrowRiseMs
                const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
                this.game.transient?.ring(at, enemy.def.hex, 9, 0.5)
                this.game.particles.burst(at, enemy.def.hex, 50, 12, { size: 0.35, life: 0.7 })
                this.game.addShake(8)
            }
            return
        }
        this.rootkitBrood(enemy, dtMs)
        enemy.bossTimer -= dtMs
        if (enemy.bossTimer > 0 || enemy.d < enemy.standoff + 220) return
        enemy.bossTimer = 6000
        enemy.burrowMs = ROOTKIT_BURROW_MS
        const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
        this.game.transient?.ring(at, enemy.def.hex, 7, 0.45)
        this.game.particles.burst(at, enemy.def.hex, 40, 10, { size: 0.3, life: 0.6 })
        this.game.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD, _v), 'BURROWING', enemy.def.hex, 1.2)
        if (this.game.rail.target === enemy) this.game.rail.target = null
    }

    /** Spiderlings on the field. */
    private spiderCount() {
        let n = 0
        for (const e of this.game.enemies) if (e.def.id === 'spiderling') n++
        return n
    }

    /** A spiderling hatches at (u, d), if the brood is not already at its cap. */
    private hatchSpider(u: number, d: number) {
        if (this.spiderCount() >= HACKERZ_SPIDER_CAP) return
        // A reinforcement: half bounty and no coins, so the brood is never a farm.
        this.game.spawner.spawn(hackerzEnemy('spiderling'), true, 1, { u, d })
    }

    /**
     * ROOTKIT, surfaced: it infects the hacked nodes it passes, and every few
     * seconds its forelegs rear up to inject a pair of spiderlings.
     */
    private rootkitBrood(enemy: EnemyEntity, dtMs: number) {
        if (!this.game.running || this.game.purging || enemy.decoy) return
        for (const chip of this.game.pathChips?.chips ?? []) {
            if (chip.state !== 'hacked' || this.infected.has(chip.id)) continue
            if (Math.hypot(chip.u - enemy.u, chip.d - enemy.d) > HACKERZ_SPIDER_INFECT_RADIUS) continue
            this.infected.set(chip.id, HACKERZ_SPIDER_HATCH_MS * 0.5)
            const at = fieldToWorld(chip.u, chip.d, 0.3, new THREE.Vector3())
            this.game.transient?.ring(at, enemy.def.hex, 4, 0.5)
            this.game.particles.burst(at, enemy.def.hex, 24, 7, { size: 0.24, life: 0.6 })
            this.game.sysLog.infected(chip.id)
        }
        enemy.broodMs -= dtMs
        if (enemy.broodMs > 0 || enemy.inject > 0) return
        enemy.broodMs = HACKERZ_SPIDER_INJECT_MS
        if (this.spiderCount() < HACKERZ_SPIDER_CAP) enemy.inject = 1
    }

    /** The forelegs drive home: a spiderling out of each needle. */
    injectBrood(enemy: EnemyEntity) {
        for (const tip of fangTips(enemy.rig)) {
            this.game.particles.burst(tip, enemy.def.hex, 10, 5, { size: 0.2, life: 0.35 })
            this.hatchSpider(tip.x * PER_WORLD, -tip.z * PER_WORLD)
        }
    }

    /**
     * Infected nodes hatch a spiderling every tick, for as long as ROOTKIT
     * lives and the node stays theirs.
     */
    hatchInfected(dtMs: number) {
        if (!this.infected.size) return
        if (!this.game.enemies.some(e => e.def.id === 'titan' && !e.decoy)) {
            this.infected.clear()
            return
        }
        const chips = this.game.pathChips?.chips ?? []
        for (const [id, ms] of this.infected) {
            const chip = chips.find(c => c.id === id)
            if (!chip || chip.state !== 'hacked') {
                this.infected.delete(id)
                continue
            }
            const at = fieldToWorld(chip.u, chip.d, 0.3, _v)
            // A sick pulse on the node, so the player can see what is breeding there.
            if (Math.random() < dtMs / 1000 * 4) this.game.particles.emit(at, _w.set(randRange(-0.4, 0.4), 1.2, randRange(-0.4, 0.4)), 0xfb7185, { size: 0.2, life: 0.5, gravity: 0 })
            let left = ms - dtMs
            if (left <= 0) {
                left += HACKERZ_SPIDER_HATCH_MS
                this.game.transient?.ring(at, 0xfb7185, 2.4, 0.35)
                this.hatchSpider(chip.u, chip.d - 30)
            }
            this.infected.set(id, left)
        }
    }
}
