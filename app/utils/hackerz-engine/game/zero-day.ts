import * as THREE from 'three'
import { randomBetween, randomChance } from '../rng'
import { FIELD_HALF_WIDTH } from '../constants'
import { clamp, randRange } from '../math'
import { buildRig } from '../models'
import type { EnemyEntity } from '../types'
import { PER_WORLD, _w } from './tuning'
import { bodyPoint, enemyWorld, placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/**
 * ZERO DAY: it forks into decoys as it is worn down, and only the real
 * one bleeds data.
 */
export class ZeroDay {
    constructor(private readonly game: HackerzGame) {}

    /**
     * ZERO DAY splits as it is worn down, at three quarters, a half and a quarter
     * of its health: two decoys each time, and it trades places with one of them.
     * The tell: only the real one bleeds data — a steady drip of falling green
     * glyph-bits. Decoys are fragile and pay nothing.
     */
    updateZeroDay(enemy: EnemyEntity, dt: number) {
        if (Math.random() < dt * 28) {
            const at = enemyWorld(enemy, randRange(0.3, 0.9) * enemy.rig.height * PER_WORLD, new THREE.Vector3())
            at.x += randRange(-0.6, 0.6)
            this.game.particles.emit(at, _w.set(randRange(-0.4, 0.4), -0.5, randRange(-0.4, 0.4)), 0x86efac,
                { size: 0.2, life: 0.9, gravity: 3, drag: 0.5, intensity: 2.2 })
        }
        const threshold = 1 - 0.25 * (enemy.splits + 1)
        if (enemy.splits >= 3 || enemy.hp / enemy.maxHp > threshold) return
        enemy.splits++
        const decoys = [this.spawnDecoy(enemy, -1), this.spawnDecoy(enemy, 1)]
        // Swap places with one copy, so the player has to find the tell again.
        const swap = decoys[randomChance(0.5) ? 0 : 1]!
        const u = enemy.u
        const d = enemy.d
        enemy.u = swap.u
        enemy.d = swap.d
        swap.u = u
        swap.d = d
        if (this.game.movement.ridesNetwork(enemy)) {
            this.game.movement.attachToNetwork(enemy)
            this.game.movement.attachToNetwork(swap)
        }
        if (this.game.rail.target === enemy) this.game.rail.target = null
        const at = bodyPoint(enemy, 0.5, new THREE.Vector3())
        this.game.transient?.ring(at, enemy.def.hex, 10, 0.5)
        this.game.overlay.banner('ZERO DAY FORKED', enemy.def.hex, 'find the one that bleeds data')
        this.game.addShake(10)
    }

    private spawnDecoy(real: EnemyEntity, side: number): EnemyEntity {
        const rig = buildRig(real.def.id, real.def.hex, real.rig.height, { shrouded: true })
        this.game.fieldRoot.add(rig.root)
        const decoy: EnemyEntity = {
            ...real,
            rig,
            // Its own footprint memo: sharing the original's would let one overwrite the other's.
            foot: undefined,
            route: null,
            redShield: false,
            recovering: false,
            u: clamp(real.u + side * randomBetween(110, 170), -FIELD_HALF_WIDTH + 40, FIELD_HALF_WIDTH - 40),
            d: real.d + randomBetween(-50, 50),
            hp: real.maxHp * 0.05,
            maxHp: real.maxHp * 0.05,
            damage: real.damage * 0.5,
            bounty: 0,
            coinValue: 0,
            decoy: true,
            age: 0,
            pingDelay: -1,
            revealMs: 0,
            splits: 3
        }
        // A ground copy lands on whichever data line is nearest.
        if (this.game.movement.ridesNetwork(decoy)) this.game.movement.attachToNetwork(decoy)
        placeEnemy(decoy)
        this.game.enemies.push(decoy)
        return decoy
    }
}
