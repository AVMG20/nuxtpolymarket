import { randomBetween } from '../rng'
import { HACKERZ_HACKER_ID, HACKERZ_MAX_SLOTS } from '#shared/utils/gamelogic/hackerz'
import { FIELD_SCALE, GUN_Z, WALL_HEIGHT, mountPosition } from '../constants'
import { buildRig, disposeRig } from '../models'
import { MOTION, easeTurretKick, spinTurret, turnToward } from '../rig-motion'
import { fieldToWorld } from '../scene'
import { turretProjectile } from '../fx'
import type { EnemyEntity, TurretMount } from '../types'
import { PER_WORLD, _v, _w, MUZZLE_Y } from './tuning'
import { enemyCentreY } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** Half the width of a turret's own lane, in field units: mounts sit about twice this apart. */
const TURRET_LANE = 75

/** How often a turret holding a target looks again for one it would rather shoot. */
const TURRET_RETARGET_MS = 400

/**
 * The turrets on the wall: built to match the loadout, each keeping its
 * target until it drops out, and thawed when BLACK ICE freezes one.
 */
export class Turrets {
    constructor(private readonly game: HackerzGame) {}

    turrets: TurretMount[] = []

    /** Rebuilds the mounted turrets to match what the uplink installed. */
    syncTurrets() {
        const view = this.game.view
        if (!view) return
        const wanted = this.game.loadout?.turrets ?? []
        const same = wanted.length === this.turrets.length
            && wanted.every((runtime, i) => this.turrets[i]?.runtime.id === runtime.id && this.turrets[i]?.runtime.slot === runtime.slot)
        if (same) {
            // Same hardware, new numbers (Firmware, Foundry): keep the rigs.
            wanted.forEach((runtime, i) => { this.turrets[i]!.runtime = runtime })
        } else {
            for (const mount of this.turrets) disposeRig(mount.rig)
            this.turrets = []
            for (const runtime of wanted) {
                const anchor = mountPosition(runtime.slot)
                const rig = buildRig(`turret-${runtime.id}`, runtime.hex, 1.3)
                const z = GUN_Z + anchor.z
                rig.root.position.set(anchor.u * FIELD_SCALE, WALL_HEIGHT + 0.1 + anchor.rise, z)
                view.scene.add(rig.root)
                this.turrets.push({
                    runtime,
                    rig,
                    u: anchor.u,
                    z,
                    muzzleD: -z * PER_WORLD,
                    muzzleLift: anchor.rise * PER_WORLD,
                    cooldown: randomBetween(0, 400),
                    kick: 0,
                    heading: Math.PI,
                    frozenMs: 0,
                    ice: null,
                    target: null,
                    retargetMs: 0
                })
            }
        }
        const installed = Array.from({ length: HACKERZ_MAX_SLOTS }, (_, slot) => wanted.some(t => t.slot === slot))
        view.setMountsUsed(this.game.slots, installed)
    }

    /** Thaws a frozen turret, early by a click or on its own when the ice runs out. */
    thaw(mount: TurretMount) {
        mount.frozenMs = 0
        if (mount.ice) mount.ice.visible = false
        const at = mount.rig.root.position.clone().add(_w.set(0, 1, 0))
        this.game.particles.burst(at, 0xbfe9ff, 30, 9, { size: 0.3, life: 0.6 })
        this.game.transient?.ring(at, 0xbfe9ff, 2.4, 0.35)
    }

    /** The frozen turret under the cursor, if any: thawing beats firing for that click. */
    pickFrozenTurret(x: number, y: number) {
        const view = this.game.view
        if (!view) return null
        const screen = { x: 0, y: 0 }
        for (const mount of this.turrets) {
            if (mount.frozenMs <= 0) continue
            if (!view.project(mount.rig.root.position.clone().add(_w.set(0, 0.9, 0)), screen)) continue
            if (Math.hypot(screen.x - x, screen.y - y) <= 34) return mount
        }
        return null
    }

    /** `frozen`: a packet-loss spike — the turrets still fire, but are not seen to move. */
    updateTurrets(dtMs: number, frozen = false) {
        const overclocked = this.game.abilities.overclockLeft > 0
        const dt = frozen ? 0 : dtMs / 1000
        for (const mount of this.turrets) {
            if (mount.frozenMs > 0) {
                mount.frozenMs -= dtMs
                if (mount.frozenMs <= 0) this.thaw(mount)
                continue
            }
            const target = this.turretTarget(mount, dtMs)
            // Turrets aim at what they can see — during a packet-loss spike,
            // the stale picture rather than where the unit really is.
            const seen = target ? this.game.lag.seenAt(target) : null
            if (target && seen) {
                const desired = Math.atan2((seen.u - mount.u) * FIELD_SCALE, -seen.d * FIELD_SCALE - mount.z)
                mount.heading = turnToward(mount.heading, desired, dt * MOTION.turretTurn)
            }
            if (mount.rig.yaw) mount.rig.yaw.rotation.y = mount.heading
            spinTurret(mount.rig, dt)

            if (!frozen) mount.kick = easeTurretKick(mount.rig, mount.kick, dtMs)

            if (!this.game.running || this.game.purging) continue
            mount.cooldown -= dtMs * (overclocked ? this.game.abilities.overclockRate : 1)
            if (!target || !seen || mount.cooldown > 0) continue
            mount.cooldown = mount.runtime.intervalMs

            const isMissile = mount.runtime.splashRadius > 0
            const angle = Math.atan2(seen.u - mount.u, seen.d - mount.muzzleD)
            this.game.projectiles.spawnBullet(mount.u, mount.muzzleD, MUZZLE_Y * 0.92 + mount.muzzleLift, angle, {
                damage: mount.runtime.damage,
                pierce: mount.runtime.pierce,
                damageType: mount.runtime.damageType,
                splashRadius: mount.runtime.splashRadius,
                splashDamage: mount.runtime.splashDamage,
                // A missile can only home on a signal it has; mid-spike it flies blind.
                homing: isMissile && this.game.lag.boardLagMs <= 0,
                chain: 0,
                chainFalloff: 0,
                speed: isMissile ? 780 : 1700,
                hex: mount.runtime.hex,
                projectile: turretProjectile(mount.runtime),
                crit: false,
                fromTurret: true
            }, enemyCentreY(target), target)
            const muzzle = fieldToWorld(mount.u + Math.sin(angle) * 30, mount.muzzleD + Math.cos(angle) * 30, (MUZZLE_Y * 0.92 + mount.muzzleLift) * FIELD_SCALE, _v)
            this.game.transient?.flash(muzzle, mount.runtime.hex, 0.35)
            mount.kick = MOTION.turretKick
            if (mount.runtime.id === 'gun') this.game.callbacks.onSound?.('turret-gun')
            else if (mount.runtime.id === 'needler') this.game.callbacks.onSound?.('turret-needler')
            else if (mount.runtime.id === 'warhead') this.game.callbacks.onSound?.('turret-warhead')
            else if (mount.runtime.id === 'lance') this.game.callbacks.onSound?.('turret-lance')
        }
    }

    /**
     * What a turret shoots, in order of preference:
     *
     * 1. Anything but a hacker: the hackers are the rail's job, and a battery
     *    that ignores them while there is armour about gives them a chance.
     * 2. Its own lane — the strip of field in front of its mount — then the
     *    lanes beside it, then anything in range, so a battery spreads its fire
     *    instead of every barrel chasing one unit.
     * 3. The tankiest: the most health it started with.
     * 4. Whatever is closest to the fence.
     *
     * Range is measured straight out from the wall, which is what the balance
     * sim assumes.
     */
    private pickTurretTarget(mount: TurretMount) {
        let best: EnemyEntity | null = null
        let bestHacker = 0
        let bestTier = 0
        for (const enemy of this.game.enemies) {
            if (enemy.d > mount.runtime.range || this.game.combat.untargetable(enemy)) continue
            const hacker = enemy.def.id === HACKERZ_HACKER_ID ? 1 : 0
            const off = Math.abs(enemy.u - mount.u)
            const tier = off <= TURRET_LANE ? 0 : off <= TURRET_LANE * 3 ? 1 : 2
            if (best && (hacker > bestHacker || (hacker === bestHacker && (tier > bestTier
                || (tier === bestTier && (enemy.maxHp < best.maxHp
                    || (enemy.maxHp === best.maxHp && enemy.d >= best.d))))))) continue
            best = enemy
            bestHacker = hacker
            bestTier = tier
        }
        return best
    }

    /**
     * A turret keeps shooting what it picked until that drops out of range or
     * out of sight, and only now and then looks again for something better —
     * the full search above runs a few times a second, not every frame.
     */
    private turretTarget(mount: TurretMount, dtMs: number) {
        mount.retargetMs -= dtMs
        const kept = mount.target
        if (kept && mount.retargetMs > 0 && kept.d <= mount.runtime.range && !this.game.combat.untargetable(kept)) return kept
        mount.target = this.pickTurretTarget(mount)
        mount.retargetMs = TURRET_RETARGET_MS
        return mount.target
    }
}
