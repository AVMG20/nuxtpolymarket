import type * as THREE from 'three'
import { randomFloat } from '../rng'
import { FIELD_SCALE } from '../constants'
import { fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { _v } from './tuning'
import { bodyPoint, enemyCentreY, placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** PACKET LOSS: how long the board's picture freezes, and the gap between freezes, give or take. */
const LAG_FREEZE_MS = 1400
const LAG_GAP_MS = 1800

/** How long the catch-up surge after a lag spike lasts. */
const LAG_CATCH_UP_MS = 500

/**
 * Lag spikes: the board's picture freezes while everything on it carries
 * on, then jumps to catch up (PACKET LOSS, or BLACK ICE on the rail).
 */
export class PacketLoss {
    constructor(private readonly game: HackerzGame) {}

    /** Packet loss: ms left on the current board-wide lag spike, and ms until the next. */
    boardLagMs = 0

    private boardLagTimer = LAG_GAP_MS

    /** Ms left on the catch-up surge that follows a lag spike. */
    lagCatchUpMs = 0

    /**
     * Where a unit appears to be: normally where it is, but during a
     * packet-loss spike where its frozen picture still stands.
     */
    seenAt(enemy: EnemyEntity) {
        if (this.boardLagMs <= 0) return { u: enemy.u, d: enemy.d }
        const p = enemy.rig.root.position
        return { u: p.x / FIELD_SCALE, d: -p.z / FIELD_SCALE }
    }

    /**
     * Packet loss: every so often the whole board's picture stops updating for
     * a fraction of a second, then catches up in one glitchy jump. Purely what
     * is seen: nothing on the field ever stops. While a spike lasts, no
     * sparks, flashes or floating numbers show until it catches up.
     */
    muteFx(on: boolean) {
        this.game.particles.muted = on
        if (this.game.transient) this.game.transient.muted = on
        this.game.overlay.muted = on
    }

    /**
     * The board's lag spikes: PACKET LOSS throws them on its own timer, and a
     * glob of BLACK ICE on the rail throws one any time (see `lagSpike`).
     */
    updateBoardLag(dtMs: number) {
        const packetLoss = this.game.bonus === 'packetloss'
        if (!this.game.running || (!packetLoss && this.boardLagMs <= 0 && this.lagCatchUpMs <= 0)) {
            this.boardLagMs = 0
            this.lagCatchUpMs = 0
            return
        }
        if (this.lagCatchUpMs > 0) this.lagCatchUpMs -= dtMs
        if (this.boardLagMs > 0) {
            this.boardLagMs -= dtMs
            if (this.boardLagMs > 0) return
            // Caught up: everything jumps to where it really was all along.
            this.muteFx(false)
            for (const enemy of this.game.enemies) {
                placeEnemy(enemy)
                this.game.particles.burst(bodyPoint(enemy, 0.5, _v), 0xe879f9, 6, 4, { size: 0.22, life: 0.3 })
            }
            for (const bullet of this.game.projectiles.bullets) this.game.projectiles.orientBullet(bullet)
            for (const spit of this.game.projectiles.spits) fieldToWorld(spit.u, spit.d, spit.y * FIELD_SCALE, spit.mesh.position)
            this.game.view?.flash(0xe879f9, 0.08)
            this.boardLagTimer = LAG_GAP_MS * (0.6 + randomFloat() * 0.8)
            this.lagCatchUpMs = LAG_CATCH_UP_MS
            return
        }
        if (!packetLoss) return
        this.boardLagTimer -= dtMs
        if (this.boardLagTimer > 0) return
        this.lagSpike()
    }

    /** The picture freezes: the board holds while everything on it carries on, then jumps to catch up. */
    lagSpike() {
        if (this.boardLagMs > 0) return
        this.boardLagMs = LAG_FREEZE_MS * (0.6 + randomFloat() * 0.8)
        this.game.sysLog.lagSpike()
        // The spike drops the lock: the rail keeps firing at the last spot it
        // saw its target, while the target walks on out of it.
        if (this.game.rail.target) {
            this.game.rail.lockSpot = { u: this.game.rail.target.u, d: this.game.rail.target.d, y: enemyCentreY(this.game.rail.target) }
            this.game.rail.target = null
        }
    }

    /** Like `enemyWorld`, but where the unit is seen: its frozen picture during a packet-loss spike. */
    seenWorld(enemy: EnemyEntity, lift: number, out: THREE.Vector3) {
        const seen = this.seenAt(enemy)
        return fieldToWorld(seen.u, seen.d, (enemy.altitude + lift) * FIELD_SCALE, out)
    }
}
