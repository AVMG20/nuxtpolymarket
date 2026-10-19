import * as THREE from 'three'
import { HACKERZ_TYPE_HEX, hackerzTypeMultiplier, type HackerzDamageType } from '#shared/utils/gamelogic/hackerz'
import { randRange } from '../math'
import { HexShield } from '../hex-shield'
import { disposeRig, type ModelRig } from '../models'
import { MOTION } from '../rig-motion'
import { LIME, RED, fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { PER_WORLD, _v, _w, BLACKOUT_LIGHT_D } from './tuning'
import { enemyWorld, placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/**
 * Hitting hostiles: what reaches them, what a hit does, and what a kill
 * pays and leaves behind.
 */
export class Combat {
    constructor(private readonly game: HackerzGame) {}

    /** Killed units still shorting out on the field: cosmetic only, already paid out. */
    dying: { rig: ModelRig, age: number, life: number, hex: number }[] = []

    /**
     * Applies damage. There is no resistance term — a source that is not the type
     * an enemy is weak to deals full damage, and one that is deals a quarter more.
     * The number is coloured by the damage type and the bonus hit is drawn larger,
     * so the mechanic is legible from the field without a tooltip.
     */
    damageEnemy(
        enemy: EnemyEntity,
        amount: number,
        damageType: HackerzDamageType,
        flash: boolean,
        showNumber: boolean,
        crit = false,
        /** False for damage over time (trap, held ground): it does not count as a hit on a shield. */
        shieldable = true
    ) {
        // Red ground's shield eats one whole hit and breaks, the sheen flaring
        // across the plating as it takes the impact.
        if (shieldable && enemy.redShield && amount > 0) {
            this.game.territory.setRedShield(enemy, false)
            enemy.rig.body.uniforms.uShieldHit!.value = 1
            const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
            this.game.particles.burst(at, 0xff3b3b, 14, 7, { size: 0.24, life: 0.35 })
            if (showNumber) this.game.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'BLOCKED', 0xff6b6b, 0.95)
            if (flash) enemy.flashMs = MOTION.hitFlashMs
            return
        }
        const bonus = hackerzTypeMultiplier(damageType, enemy.armored)
        const dealt = amount * bonus
        // A carried shield (the Warden's) takes the hit until it breaks; the
        // bubble flashes round the unit from the shield back.
        const blocked = Math.min(enemy.guard, dealt)
        if (blocked > 0) {
            enemy.guard -= blocked
            if (shieldable) (enemy.hexShield ??= new HexShield(enemy.rig)).pulse()
            if (enemy.guard <= 0) this.breakGuard(enemy)
        }
        enemy.hp -= dealt - blocked
        if (flash) enemy.flashMs = MOTION.hitFlashMs
        if (showNumber) {
            const effective = bonus > 1
            this.game.overlay.floatText(
                enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v),
                crit ? `${Math.round(dealt)}!` : effective ? `${Math.round(dealt)}+` : `${Math.round(dealt)}`,
                crit ? 0xfde047 : HACKERZ_TYPE_HEX[damageType],
                crit ? 1.5 : effective ? 1.2 : 0.95
            )
        }
    }

    /** The shield gives: it shatters off the unit, and hits land on the unit from now on. */
    private breakGuard(enemy: EnemyEntity) {
        enemy.guard = 0
        placeEnemy(enemy)
        this.game.shrapnel?.burst(enemy.rig, 0xffffff, enemy.rig.guardParts)
        for (const part of enemy.rig.guardParts) part.visible = false
        const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.game.particles.burst(at, 0xffffff, 18, 9, { size: 0.24, life: 0.45 })
        this.game.transient?.ring(at, 0xffffff, 3, 0.35)
        this.game.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'SHIELD DOWN', 0xffffff, 1.1)
    }

    /** Removes an enemy and pays out. `payout` scales it (the purge pays less). */
    killEnemy(index: number, payout: number) {
        const enemy = this.game.enemies[index]
        if (!enemy) return
        // A kill the player earned extends the chain; the purge's sweep does not.
        if (payout >= 1) this.game.scoring.extendChain()
        const credits = Math.round(enemy.bounty * payout * (payout >= 1 ? this.game.scoring.chainMultiplier : 1))
        const coins = Math.round(enemy.coinValue * payout)

        const centre = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.45, new THREE.Vector3())
        // A ZERO DAY copy dies as what it is: a fake, with none of the boss's fanfare.
        const bossDeath = !!enemy.def.boss && !enemy.decoy
        // The purge writes its own summary; only kills the player made get a line.
        if (payout >= 1 && !enemy.decoy) this.game.sysLog.kill(enemy.def.id, enemy.def.name, bossDeath, !!enemy.def.cloaked)
        if (enemy.decoy) this.game.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'DECOY', 0x94a3b8, 1.2)
        this.game.particles.burst(centre, enemy.def.hex, bossDeath ? 120 : 22, bossDeath ? 22 : 11,
            { size: bossDeath ? 0.5 : 0.3, life: 0.8, gravity: 18 })
        // The discharge: bolts arc from the body into the floor, and the charge
        // runs out along the circuit traces from where it grounded.
        const ground = fieldToWorld(enemy.u, enemy.d, 0.05, new THREE.Vector3())
        const bolts = bossDeath ? 9 : 4
        for (let b = 0; b < bolts; b++) {
            const reach = enemy.rig.height * (bossDeath ? 0.8 : 0.9) + 0.6
            this.game.transient?.bolt(centre, _v.set(ground.x + randRange(-reach, reach), 0.05, ground.z + randRange(-reach, reach)).clone(), enemy.def.hex)
        }
        this.game.view?.addSurge(ground.x, ground.z, enemy.def.hex, bossDeath ? 2.4 : payout < 1 ? 0.6 : 1)
        this.game.transient?.ring(fieldToWorld(enemy.u, enemy.d, 0.1, _v), enemy.def.hex, bossDeath ? 14 : 2.4, 0.4)
        if (credits > 0) {
            this.game.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 34, _v), `+${credits}`, LIME, 1.1)
        }
        if (coins > 0) this.game.scoring.dropCoins(enemy, coins)
        if (bossDeath) {
            this.game.transient?.ring(centre, RED, 30, 0.8)
            this.game.view?.flash(0xffffff, 0.35)
            this.game.addShake(18)
            this.game.callbacks.onNotice(`${enemy.def.name} purged.`, 'good')
        }

        this.removeEnemy(index, true)
        this.game.callbacks.onSound?.(bossDeath ? 'boss-death' : 'enemy-death')
        this.game.scoring.waveKills++
        this.game.scoring.totalKills++
        if (credits > 0) {
            this.game.scoring.waveCredits += credits
            this.game.callbacks.onCredits(credits, payout < 1 ? 'purge' : 'kill')
        }
    }

    /**
     * Takes an enemy off the field. A killed one leaves its body behind for a
     * beat, shorting out (see `updateDying`); anything else just goes.
     */
    removeEnemy(index: number, shortOut = false) {
        const enemy = this.game.enemies[index]
        if (!enemy) return
        if (this.game.target === enemy) this.game.target = null
        for (const mount of this.game.turrets) {
            if (mount.target === enemy) mount.target = null
        }
        for (const other of this.game.enemies) {
            if (other.healing === enemy) other.healing = null
        }
        this.game.terminals?.close(enemy)
        // A block still in its hands goes down with it.
        enemy.carry?.dispose()
        enemy.carry = null
        enemy.hexShield?.dispose()
        enemy.hexShield = null
        enemy.ribbon?.dispose()
        enemy.ribbon = null
        // Whole again for its death, whatever state it was in.
        enemy.storm?.dispose()
        enemy.storm = null
        enemy.wound?.dispose()
        enemy.wound = null
        if (shortOut) this.dying.push({ rig: enemy.rig, age: 0, life: enemy.def.boss ? 0.9 : 0.4, hex: enemy.def.hex })
        else disposeRig(enemy.rig)
        this.game.enemies.splice(index, 1)
    }

    /**
     * A dead unit flares white-hot and is pulled down into the grid. Driven by
     * its age alone, so a paused game holds it still; no strobing — a fast
     * flash is a photosensitivity hazard, not an effect.
     */
    updateDying(dt: number) {
        for (let i = this.dying.length - 1; i >= 0; i--) {
            const corpse = this.dying[i]!
            corpse.age += dt
            const t = corpse.age / corpse.life
            if (t >= 1) {
                disposeRig(corpse.rig)
                this.dying.splice(i, 1)
                continue
            }
            corpse.rig.body.uniforms.uFlash!.value = 1.1 * (1 - t)
            corpse.rig.root.scale.set(1, Math.max(0.02, 1 - t * t), 1)
            if (dt > 0 && Math.random() < dt * 25) {
                this.game.particles.emit(
                    corpse.rig.root.position.clone().add(_w.set(randRange(-0.6, 0.6), corpse.rig.height * (1 - t) * Math.random(), randRange(-0.6, 0.6))),
                    _v.set(randRange(-3, 3), randRange(1, 5), randRange(-3, 3)), corpse.hex, { size: 0.22, life: 0.25, gravity: 4 }
                )
            }
        }
    }

    /**
     * Whether a unit is out of reach: a cloaked one nobody has pinged, or a
     * ROOTKIT underground. Nothing targets, hits or splashes an untouchable unit.
     */
    untouchable(enemy: EnemyEntity) {
        // A White Hat's convert is on our side now: nothing of ours shoots it.
        if (enemy.turned) return true
        // Still waiting inside the portal: not on the board yet.
        if (enemy.gateHold) return true
        if (enemy.burrowMs > 0) return true
        return !!enemy.def.cloaked && !enemy.decloaked && enemy.revealMs <= 0
    }

    /**
     * Whether a unit stands unseen in the dark: out past the light in a
     * BLACKOUT, or inside a dark zone, with no ping on it. Rounds fired blind
     * still hit it, but nothing can lock on.
     */
    inTheDark(enemy: EnemyEntity) {
        if (enemy.revealMs > 0) return false
        if (this.game.bonus === 'blackout' && this.game.running && enemy.d > BLACKOUT_LIGHT_D) return true
        return this.game.territory.inDarkZone(enemy.u, enemy.d)
    }

    /** Whether nothing can pick a unit out to aim at: untouchable, or unseen in the dark. */
    untargetable(enemy: EnemyEntity) {
        return this.untouchable(enemy) || this.inTheDark(enemy)
    }
}
