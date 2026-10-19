import * as THREE from 'three'
import { COIN_FLIGHT_MS, RAIL_U, FENCE_HEIGHT, GUN_Z, WALL_HEIGHT } from '../constants'
import { randRange } from '../math'
import { AMBER, LIME, RED, fieldToWorld } from '../scene'
import { makeCoin } from '../fx'
import type { CoinEntity, EnemyEntity } from '../types'
import { PER_WORLD, _v } from './tuning'
import { enemyWorld } from './bodies'
import type { HackerzGame } from '../hackerz-game'

const COIN_BANK = new THREE.Vector3(0, WALL_HEIGHT + 1.2, GUN_Z + 0.4)

/** Chain lengths that earn a banner. */
const CHAIN_MILESTONES = [10, 25, 50, 100]

/**
 * The run's takings: the wave's kills, credits and coins, the coins in
 * flight to the wall, and the exploit chain that multiplies credits.
 */
export class Scoring {
    constructor(private readonly game: HackerzGame) {}

    waveKills = 0

    waveCredits = 0

    waveCoins = 0

    totalKills = 0

    /**
     * Exploit chain: kills since the last leak. It multiplies run credits only —
     * coins, and so the site economy, never see it.
     */
    chain = 0

    coins: CoinEntity[] = []

    /**
     * Sheds an enemy's coin value as physical coins that fly to the wall. Split
     * across a few discs so a boss reads as a payday, but capped hard.
     */
    dropCoins(enemy: EnemyEntity, total: number) {
        const count = enemy.def.boss ? 7 : total > 400 ? 3 : total > 80 ? 2 : 1
        const share = Math.floor(total / count)
        for (let i = 0; i < count; i++) {
            // The last coin carries the rounding remainder, so the drop always
            // banks exactly what the kill was worth.
            const value = i === count - 1 ? total - share * (count - 1) : share
            const mesh = makeCoin(enemy.def.boss ? 1.5 : 1)
            const from = enemyWorld(enemy, enemy.rig.height * PER_WORLD * randRange(0.3, 0.8), new THREE.Vector3())
            from.x += randRange(-0.6, 0.6)
            mesh.position.copy(from)
            this.game.fieldRoot.add(mesh)
            this.coins.push({ mesh, from, apex: Math.max(from.y, COIN_BANK.y) + randRange(3, 7), t: -i * 0.12, value })
        }
    }

    updateCoins(dtMs: number) {
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const coin = this.coins[i] as CoinEntity
            coin.t += dtMs / COIN_FLIGHT_MS
            if (coin.t < 0) continue
            if (coin.t >= 1) {
                this.bankCoin(coin)
                this.coins.splice(i, 1)
                continue
            }
            // Quadratic bezier through the apex — one lerp pair, no physics.
            const t = coin.t
            const inv = 1 - t
            const p = coin.mesh.position
            p.x = inv * inv * coin.from.x + 2 * inv * t * ((coin.from.x + COIN_BANK.x) / 2) + t * t * COIN_BANK.x
            p.z = inv * inv * coin.from.z + 2 * inv * t * ((coin.from.z + COIN_BANK.z) / 2) + t * t * COIN_BANK.z
            p.y = inv * inv * coin.from.y + 2 * inv * t * coin.apex + t * t * COIN_BANK.y
            coin.mesh.rotation.y = t * Math.PI * 6
        }
    }

    private bankCoin(coin: CoinEntity) {
        coin.mesh.removeFromParent()
        this.game.particles.burst(COIN_BANK, AMBER, 3, 4, { size: 0.2, life: 0.3, gravity: 0 })
        this.waveCoins += coin.value
        this.game.callbacks.onCoins(coin.value)
        this.game.callbacks.onSound?.('coin-pickup')
    }

    /** Banks everything still in flight — called when a wave settles. */
    flushCoins() {
        for (const coin of this.coins) this.bankCoin(coin)
        this.coins = []
    }

    /** ×1 at no chain, +2% a link, capped at ×2 so a long chain is a bonus rather than the economy. */
    get chainMultiplier() {
        return 1 + Math.min(this.chain, 50) * 0.02
    }

    extendChain() {
        this.chain++
        if (CHAIN_MILESTONES.includes(this.chain)) {
            this.game.sysLog.chain(this.chain)
            this.game.overlay.banner(`EXPLOIT CHAIN ×${this.chain}`, LIME, `credits ×${this.chainMultiplier.toFixed(2)}`)
            this.game.callbacks.onSound?.('wave-start')
            if (this.game.rail.railRig) this.game.particles.burst(this.game.rail.railRig.root.position, LIME, 40, 9, { size: 0.3, life: 0.7 })
        }
        this.emitChain()
    }

    /** A leak shatters the chain: the loss is what makes holding it worth something. */
    breakChain() {
        if (this.chain >= 5) {
            this.game.overlay.floatText(fieldToWorld(RAIL_U, 0, FENCE_HEIGHT + 3, _v), `CHAIN BROKEN · ${this.chain}`, RED, 1.4)
            if (this.game.rail.railRig) this.game.particles.burst(this.game.rail.railRig.root.position, RED, 24, 7, { size: 0.26, life: 0.5 })
        }
        this.chain = 0
        this.emitChain()
    }

    emitChain() {
        this.game.callbacks.onChain?.(this.chain, this.chainMultiplier)
    }
}
