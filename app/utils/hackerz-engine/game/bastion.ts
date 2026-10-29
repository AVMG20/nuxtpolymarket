import { HACKERZ_BONUS_PASS_INTEGRITY, HACKERZ_SHIELD_DELAY_MS } from '#shared/utils/gamelogic/hackerz'
import { FENCE_HEIGHT } from '../constants'
import { clamp } from '../math'
import { RED, fieldToWorld } from '../scene'
import { _v } from './tuning'
import type { HackerzGame } from '../hackerz-game'

/**
 * The wall and its ICE Barrier: what they take, how they mend, and the
 * bonus-round sandbox that hands the wall back afterwards.
 */
export class Bastion {
    constructor(private readonly game: HackerzGame) {}

    /** The wall as it stood before a bonus round, put back afterwards. */
    bonusStartHp = 0

    bonusStartShield = 0

    bonusFailed = false

    wallHp = 1000

    wallMaxHp = 1000

    shield = 0

    shieldMax = 0

    msSinceWallHit = 99_999

    wallFlash = 0

    shieldHit = 0

    /** Wall health left, as a whole percentage. */
    integrityPercent() {
        return this.wallMaxHp > 0 ? Math.round(100 * this.wallHp / this.wallMaxHp) : 100
    }

    /**
     * `quiet` is a drain rather than a blow (a memory leak): it does not count as
     * a leak, keep the barrier from recharging or break the chain, and it lands
     * without the jolt and the alarm.
     */
    damageWall(amount: number, sourceU: number, quiet = false) {
        if (this.game.gameOver) return
        if (!quiet) {
            this.msSinceWallHit = 0
            this.game.scoring.breakChain()
        }

        let remaining = amount
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, remaining)
            this.shield -= absorbed
            remaining -= absorbed
            // The barrier lights up where it was struck, which is the only thing
            // that distinguishes a soaked hit from one the wall took.
            this.shieldHit = Math.min(1, this.shieldHit + (absorbed > 40 ? 0.7 : 0.35))
            this.game.particles.burst(fieldToWorld(sourceU, 26, 3, _v), 0x67e8f9, 6, 6, { size: 0.25, life: 0.3, gravity: 0 })
            if (this.shield <= 0) {
                this.game.view?.flash(0x67e8f9, 0.18)
                this.game.callbacks.onNotice('ICE Barrier collapsed.', 'bad')
            }
        }
        if (remaining > 0) {
            this.wallHp = Math.max(0, this.wallHp - remaining)
            this.wallFlash = Math.min(1, this.wallFlash + 0.15 + remaining / 220)
            this.game.overlay.floatText(fieldToWorld(sourceU, 0, FENCE_HEIGHT + 1.2, _v), `-${Math.round(remaining)}`, RED, quiet ? 0.75 : 1)
            this.game.particles.burst(fieldToWorld(sourceU, 2, FENCE_HEIGHT * 0.6, _v), RED, 4, 7, { size: 0.22, life: 0.35 })
        }
        this.emitWall()
        if (!quiet) {
            this.game.addShake(clamp(amount * 0.16, 1.5, 12))
            this.game.callbacks.onSound?.('wall-hurt')
            if (remaining > 0) this.game.sysLog.wallHit(this.integrityPercent())
        }

        if (this.game.bonus) {
            // A bonus round can be lost, never the run: dropping under the line
            // ends the round on the spot, and the sandbox gives the wall back.
            this.wallHp = Math.max(1, this.wallHp)
            if (!this.bonusFailed && this.wallMaxHp > 0 && this.wallHp / this.wallMaxHp < HACKERZ_BONUS_PASS_INTEGRITY) {
                this.bonusFailed = true
                this.game.overlay.banner('BONUS FAILED', RED, 'integrity under the line')
                this.game.view?.flash(RED, 0.3)
                if (this.game.running && !this.game.purging) this.game.beginPurge()
            }
            return
        }
        if (this.wallHp > 0) return
        // A demo board's wall is only scenery.
        if (this.game.demo) this.wallHp = this.wallMaxHp
        else this.game.endRun()
    }

    updateBastion(dt: number, dtMs: number) {
        const loadout = this.game.loadout
        if (!loadout) return

        this.msSinceWallHit += dtMs
        this.wallFlash = Math.max(0, this.wallFlash - dt * 2.4)
        this.shieldHit = Math.max(0, this.shieldHit - dt * 2)

        if (this.game.running && !this.game.purging) {
            if (loadout.repairPerSec > 0 && this.wallHp < this.wallMaxHp) {
                this.wallHp = Math.min(this.wallMaxHp, this.wallHp + loadout.repairPerSec * dt)
                this.emitWall()
            }
            if (this.shieldMax > 0 && this.shield < this.shieldMax && this.msSinceWallHit > HACKERZ_SHIELD_DELAY_MS) {
                this.shield = Math.min(this.shieldMax, this.shield + loadout.shieldRegenPerSec * dt)
                this.emitWall()
            }
        }
    }

    emitWall() {
        this.game.callbacks.onWall(Math.round(this.wallHp), this.wallMaxHp, Math.round(this.shield), this.shieldMax)
    }
}
