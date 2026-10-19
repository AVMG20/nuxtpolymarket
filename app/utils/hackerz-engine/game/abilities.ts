import * as THREE from 'three'
import { HACKERZ_PORTSCAN_REPING_MS } from '#shared/utils/gamelogic/hackerz'
import { FIELD_DEPTH, FIELD_SCALE, PULSE_KNOCKBACK, PULSE_RADIUS, RAIL_U } from '../constants'
import { clamp } from '../math'
import type { PathChip } from '../path-chips'
import { AMBER, CYAN, LIME, fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { PING_COOLDOWN_MS, _v, MUZZLE_D } from './tuning'
import type { HackerzGame } from '../hackerz-game'

const PING_SPEED = 1500

/**
 * The rail's abilities: the radar ping, the ICE pulse and the overclock,
 * their charge, and the Portscan that keeps the radar sweeping.
 */
export class Abilities {
    constructor(private readonly game: HackerzGame) {}

    pulseCharge = 0

    overclockCharge = 0

    overclockLeft = 0

    pingCharge = PING_COOLDOWN_MS

    /** A Portscan's sweep left (ms), and the countdown to its next ping once the contacts fade. */
    portscanLeft = 0

    rescanMs = 0

    /**
     * The Portscan keeps the radar sweeping: whenever the last contacts have
     * faded, it pings again a moment later, until it runs out.
     */
    private updatePortscan(dtMs: number) {
        if (this.portscanLeft <= 0) return
        this.portscanLeft = Math.max(0, this.portscanLeft - dtMs)
        if (this.portscanLeft <= 0) return
        const lit = this.game.enemies.some(e => e.revealMs > 0 || e.pingDelay >= 0)
        if (lit) {
            this.rescanMs = HACKERZ_PORTSCAN_REPING_MS
            return
        }
        this.rescanMs -= dtMs
        if (this.rescanMs > 0) return
        this.rescanMs = HACKERZ_PORTSCAN_REPING_MS
        this.firePing(true)
    }

    get overclockRate() {
        return this.game.loadout?.overclockMultiplier ?? 1
    }

    /**
     * Right click: a radar ring sweeps out from the rail and lights every contact
     * as the wavefront reaches it; the highlight fades as the wave moves on.
     * `free`: a Portscan's own sweep, which neither needs nor spends the radar's charge.
     */
    firePing(free = false) {
        if (!this.game.running || this.game.purging || this.game.paused || (!free && this.pingCharge < PING_COOLDOWN_MS)) return
        if (!free) {
            this.pingCharge = 0
            this.emitPing()
        }
        const reach = (FIELD_DEPTH + 300) * FIELD_SCALE
        this.game.transient?.ring(fieldToWorld(RAIL_U, MUZZLE_D, 0.15, _v), LIME, reach, reach / (PING_SPEED * FIELD_SCALE), 1.6)
        for (const enemy of this.game.enemies) {
            enemy.pingDelay = Math.hypot(enemy.u - RAIL_U, enemy.d - MUZZLE_D) / PING_SPEED * 1000
        }
        this.game.sysLog.ping(this.game.enemies.length)
        this.game.callbacks.onSound?.('weapon-swap')
    }

    private emitPing() {
        this.game.callbacks.onPing?.(this.pingCharge, PING_COOLDOWN_MS)
    }

    updateAbilities(dtMs: number) {
        const loadout = this.game.loadout
        if (!loadout) return
        this.updatePortscan(dtMs)

        if (this.pingCharge < PING_COOLDOWN_MS) {
            // In a BLACKOUT the radar is the only light, so it recharges twice as fast.
            this.pingCharge = Math.min(PING_COOLDOWN_MS, this.pingCharge + dtMs * (this.game.bonus === 'blackout' ? 2 : 1))
            this.emitPing()
        }

        if (loadout.pulseUnlocked) {
            this.pulseCharge = Math.min(loadout.pulseCooldownMs, this.pulseCharge + dtMs)
            this.emitPulse()
        }
        if (loadout.overclockUnlocked) {
            if (this.overclockLeft > 0) {
                this.overclockLeft = Math.max(0, this.overclockLeft - dtMs)
            } else {
                this.overclockCharge = Math.min(loadout.overclockCooldownMs, this.overclockCharge + dtMs)
            }
            this.emitOverclock()
        }
    }

    firePulse() {
        const loadout = this.game.loadout
        if (!loadout?.pulseUnlocked || !this.game.running || this.game.purging || this.game.paused) return
        if (this.pulseCharge < loadout.pulseCooldownMs) return
        this.pulseCharge = 0
        this.emitPulse()
        this.game.callbacks.onSound?.('ability-pulse')

        this.game.transient?.ring(fieldToWorld(0, 0, 0.2, _v), CYAN, PULSE_RADIUS * FIELD_SCALE, 0.7, 3)
        this.game.view?.flash(0x22d3ee, 0.4)
        this.game.addShake(16)

        for (let i = this.game.enemies.length - 1; i >= 0; i--) {
            const enemy = this.game.enemies[i] as EnemyEntity
            const falloff = clamp(1 - enemy.d / PULSE_RADIUS, 0.25, 1)
            // The pulse is kinetic: it is the panic button, and the thing you
            // panic about is a plated wave already inside the trap band.
            this.game.combat.damageEnemy(enemy, loadout.pulseDamage * falloff, 'kinetic', true, true, false)
            enemy.pushVd += PULSE_KNOCKBACK * falloff * (enemy.def.boss ? 0.25 : 1)
            if (enemy.hp <= 0) this.game.combat.killEnemy(i, 1)
        }
        // The hacked nodes nearest the wall wash back toward us, the front one
        // whole. A defender throws itself in the way: the wash breaks on its
        // node, and it does not survive it.
        const defenderOf = (chip: PathChip) => this.game.enemies.findIndex(enemy => enemy.defending === chip && enemy.hp > 0)
        const wash = this.game.pathChips?.icePulse(chip => defenderOf(chip) >= 0)
        for (const chip of wash?.reclaimed ?? []) {
            this.game.pulseFromChip(chip)
            this.game.chipReclaimed(chip)
        }
        if (wash?.brokeOn) {
            const at = fieldToWorld(wash.brokeOn.u, wash.brokeOn.d, 0.4, new THREE.Vector3())
            this.game.transient?.ring(at, CYAN, 7, 0.6)
            this.game.particles.burst(at, 0xe0f2fe, 40, 12, { size: 0.3, life: 0.8 })
            for (let i = defenderOf(wash.brokeOn); i >= 0; i = defenderOf(wash.brokeOn)) {
                const defender = this.game.enemies[i] as EnemyEntity
                defender.hp = 0
                this.game.combat.killEnemy(i, 1)
            }
        }
        this.game.callbacks.onNotice('ICE pulse discharged.', 'info')
    }

    /** Q — a burst of fire rate across the rail and every mounted turret. */
    fireOverclock() {
        const loadout = this.game.loadout
        if (!loadout?.overclockUnlocked || !this.game.running || this.game.purging || this.game.paused) return
        if (this.overclockLeft > 0 || this.overclockCharge < loadout.overclockCooldownMs) return
        this.overclockCharge = 0
        this.overclockLeft = loadout.overclockMs
        this.emitOverclock()
        this.game.callbacks.onSound?.('ability-overclock')
        this.game.view?.flash(0xf97316, 0.28)
        this.game.overlay.banner('OVERCLOCK', AMBER)
        this.game.callbacks.onNotice('Overclock engaged.', 'good')
    }

    emitPulse() {
        this.game.callbacks.onPulse(this.pulseCharge, this.game.loadout?.pulseCooldownMs ?? 1)
    }

    emitOverclock() {
        this.game.callbacks.onOverclock(
            this.overclockCharge,
            this.game.loadout?.overclockCooldownMs ?? 1,
            this.overclockLeft
        )
    }
}
