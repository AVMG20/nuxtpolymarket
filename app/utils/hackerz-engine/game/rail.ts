import type * as THREE from 'three'
import { randomChance, randomFloat } from '../rng'
import type { HackerzWeaponId, HackerzWeaponRuntime } from '#shared/utils/gamelogic/hackerz'
import type { FirewallSoundEvent } from '../../firewall-sounds'
import { FIELD_DEPTH, FIELD_SCALE, RAIL_U, GUN_Z } from '../constants'
import { clamp } from '../math'
import type { ModelRig } from '../models'
import { MOTION, easeRailKick, railKickFor, turnToward } from '../rig-motion'
import { fieldToWorld } from '../scene'
import type { AmmoRack } from '../ammo-rack'
import type { EnemyEntity, ShotSpec } from '../types'
import { PER_WORLD, LEAK_D, _v, _w, MUZZLE_Y, MUZZLE_D, RAIL_TRACK } from './tuning'
import { enemyCentreY } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** How fast the Longbore glides along its track: quick enough to keep up with a cursor sweeping the lane. */
const RAIL_GLIDE = 2400

/** Rounds the Tarpit Grid burns from the gun's magazine each second it is biting. */
const TARPIT_ROUNDS_PER_S = 1

/** The sound each gun makes firing. */
const SHOT_SOUND: Partial<Record<HackerzWeaponId, FirewallSoundEvent>> = {
    rail: 'shoot-rail', flak: 'shoot-flak', arc: 'shoot-arc', missile: 'shoot-missile', sniper: 'shoot-sniper'
}

/**
 * The player's gun on the wall: where it aims, what it fires, its
 * magazine and reload, and the Tarpit Grid that runs off it.
 */
export class Rail {
    constructor(private readonly game: HackerzGame) {}

    railRig: ModelRig | null = null
    ammoRack: AmmoRack | null = null
    weapon: HackerzWeaponRuntime | null = null
    mag = 10
    magSize = 10
    fireTimer = 0
    reloadTimer = 0
    /** Rounds the Tarpit Grid has drawn from the magazine but not yet spent a whole round of. */
    tarpitDrain = 0
    railHeading = Math.PI
    /** Where the rail gun stands along the wall: the middle, or wherever a railgun has glided to on its track. */
    railU = RAIL_U
    /** The railgun's track across the deck, shown while the Longbore is on. */
    railTrack: THREE.Object3D | null = null
    railKick = 0

    // ── Aim: read anywhere, changed only through the methods below ──
    private locked: EnemyEntity | null = null
    private trigger = false
    private spot: { u: number, d: number, y: number } | null = null
    /** A press always fires once, even if the button is up again before the next frame. */
    private queuedShot = false
    private cursorU = 0
    private cursorD = FIELD_DEPTH * 0.5

    /** The hostile the rail is locked on: tracked while the trigger stays held. */
    get target() { return this.locked }
    /** The trigger is held: the rail fires, at `target`, else at `lockSpot`, else at the cursor. */
    get holding() { return this.trigger }
    /** Where a lag spike or the dark left the rail firing when the lock slipped. */
    get lockSpot() { return this.spot }
    /** The cursor (or the spot auto-play or a demo aims at), on the field. */
    get aimU() { return this.cursorU }
    get aimD() { return this.cursorD }

    /**
     * Locks on a hostile, or lets go with null; the trigger and any `lockSpot` are
     * left as they are. Player input wants `press`, `hold` or `release` instead.
     */
    lock(target: EnemyEntity | null) {
        this.locked = target
    }

    /** Lets go of `enemy` if the rail is locked on it: it died, turned, burrowed or forked. */
    drop(enemy: EnemyEntity) {
        if (this.locked === enemy) this.locked = null
    }

    /** The lock slips (a lag spike, the dark): the rail keeps firing where it last saw its target. */
    slip() {
        const target = this.locked
        if (!target) return
        this.spot = { u: target.u, d: target.d, y: enemyCentreY(target) }
        this.locked = null
    }

    /** The fire button goes down: on `target`, or on the cursor with null; it fires at least once. */
    press(target: EnemyEntity | null) {
        this.spot = null
        this.locked = target
        this.trigger = true
        this.queuedShot = true
    }

    /** Holds the trigger on `target`, or lets go of it with null (auto-play). */
    hold(target: EnemyEntity | null) {
        this.locked = target
        this.spot = null
        this.trigger = !!target
    }

    /** Holds the trigger on a spot rather than a hostile: firing blind into the dark. */
    holdOn(spot: { u: number, d: number, y: number }) {
        this.locked = null
        this.spot = spot
        this.trigger = true
    }

    /**
     * Pulls or lets go of the trigger, the lock left as it is (a demo board's
     * script). Player input wants `press`, `hold` or `release` instead.
     */
    setTrigger(on: boolean) {
        this.trigger = on
    }

    /** The fire button comes up: no trigger, no lock, no spot. */
    release() {
        this.trigger = false
        this.locked = null
        this.spot = null
    }

    /** Stops firing and lets go of the lock, as a wave ends or the run stops. */
    ceaseFire() {
        this.trigger = false
        this.locked = null
    }

    /** Points the rail's aim at a field spot. */
    aimAt(u: number, d: number) {
        this.cursorU = u
        this.cursorD = d
    }

    /** The Tarpit Grid has power while the gun has rounds in it and is not reloading. */
    get tarpitPowered() {
        return this.reloadTimer <= 0 && this.mag > 0
    }

    /**
     * The Tarpit Grid draws its power from the gun: while it is biting it
     * burns through the magazine at a steady rate, on top of whatever the gun
     * fires, and an empty magazine sends the gun to reload — the grid going
     * dark with it until the reload is done.
     */
    drainTarpit(dt: number) {
        this.tarpitDrain += TARPIT_ROUNDS_PER_S * dt
        if (this.tarpitDrain < 1) return
        const rounds = Math.min(this.mag, Math.floor(this.tarpitDrain))
        this.tarpitDrain -= rounds
        this.mag -= rounds
        this.emitAmmo()
        if (this.mag <= 0) {
            this.tarpitDrain = 0
            this.beginReload()
        }
    }

    /** Puts a gun on the rail with a full magazine, ready to fire. Its reload is the caller's. */
    load(weapon: HackerzWeaponRuntime) {
        this.weapon = weapon
        this.ammoRack?.setColour(weapon.hex)
        this.magSize = Math.round(weapon.magazine)
        this.mag = this.magSize
        this.fireTimer = 0
    }

    /**
     * Where the rail is pointing this frame: the locked target, else the spot a
     * lag spike left it firing at (while the button stays down), else the cursor.
     */
    private railAim() {
        const target = this.target
        if (target) return { u: target.u, d: target.d, y: enemyCentreY(target) }
        if (this.lockSpot && this.holding) return this.lockSpot
        return { u: this.aimU, d: this.aimD, y: 0 }
    }

    /** The Longbore is a railgun: it cannot turn, and fires straight down the lane from wherever it stands on its rail. */
    private get straightShot() {
        return this.weapon?.projectile === 'slug'
    }

    updateRail(dt: number) {
        const rig = this.railRig
        if (!rig) return
        const aim = this.railAim()
        const straight = this.straightShot
        // A railgun glides along its track under the cursor (or its locked
        // target); every other gun sits back in the middle and turns to aim.
        const home = straight ? clamp(aim.u, -RAIL_TRACK, RAIL_TRACK) : RAIL_U
        const gap = home - this.railU
        this.railU += Math.sign(gap) * Math.min(Math.abs(gap), RAIL_GLIDE * dt)
        rig.root.position.x = this.railU * FIELD_SCALE
        this.ammoRack?.follow(this.railU * FIELD_SCALE)
        if (this.railTrack) this.railTrack.visible = straight
        const desired = straight ? Math.PI : Math.atan2((aim.u - this.railU) * FIELD_SCALE, -aim.d * FIELD_SCALE - GUN_Z)
        this.railHeading = straight ? Math.PI : turnToward(this.railHeading, desired, dt * MOTION.railTurn)
        if (rig.yaw) rig.yaw.rotation.y = this.railHeading
        this.railKick = easeRailKick(rig, this.railKick, dt)
        for (const spinner of rig.spins) spinner.rotation.y += dt
    }

    updateWeapon(dtMs: number) {
        const weapon = this.weapon
        if (!weapon) return

        if (this.reloadTimer > 0) {
            this.reloadTimer -= dtMs
            if (this.reloadTimer <= 0) {
                this.reloadTimer = 0
                this.mag = this.magSize
            }
            this.emitAmmo()
        }

        this.fireTimer -= dtMs
        const firing = this.holding || this.queuedShot
        if (firing && this.reloadTimer <= 0 && this.fireTimer <= 0) {
            if (this.mag > 0) {
                this.shoot()
                this.queuedShot = false
                // Every reclaimed node on the path feeds the rail: +10% fire rate each.
                const nodes = 1 + 0.1 * (this.game.pathChips?.owned ?? 0)
                this.fireTimer = weapon.fireIntervalMs / (this.game.abilities.overclockLeft > 0 ? this.game.abilities.overclockRate : 1) / nodes
            } else {
                this.beginReload()
            }
        }
    }

    beginReload() {
        if (!this.weapon || this.reloadTimer > 0 || this.mag >= this.magSize) return
        if (!this.game.running || this.game.purging) return
        this.reloadTimer = this.weapon.reloadMs
        this.emitAmmo()
        this.game.callbacks.onSound?.('weapon-reload')
    }

    private shoot() {
        const weapon = this.weapon
        const loadout = this.game.loadout
        if (!weapon || !loadout) return
        this.mag--
        this.emitAmmo()
        const sound = SHOT_SOUND[weapon.id]
        if (sound) this.game.callbacks.onSound?.(sound)

        let aim = this.railAim()
        // Aimed down at a pile of leaked memory by the fence, the round goes for
        // the top of it, and is spent freeing a block.
        const leak = this.target ? null : this.game.memory.leakPileAt(aim.u, aim.d)
        if (leak) aim = { u: leak.u, d: LEAK_D, y: leak.stack.top(_w).y * PER_WORLD }
        // Lead the target by its walking speed over the round's flight, once —
        // a locked shot should land, but a pushed or turning target can still slip it.
        let aimD = aim.d
        const from = this.railU
        if (this.target && weapon.speed > 0) {
            const flight = Math.hypot(aim.u - from, aim.d - MUZZLE_D) / weapon.speed
            if (this.target.d > this.target.standoff) aimD = Math.max(this.target.standoff, aim.d - this.target.speed * flight)
        }
        // A railgun fires dead straight from where it stands on its rail.
        const angle = this.straightShot ? 0 : Math.atan2(aim.u - from, aimD - MUZZLE_D)

        const crit = randomChance(loadout.critChance)
        const overclocked = this.game.abilities.overclockLeft > 0
        const spec: ShotSpec = {
            damage: weapon.damage * (crit ? loadout.critMultiplier : 1) * (overclocked ? 1.25 : 1),
            pierce: weapon.pierce,
            damageType: weapon.damageType,
            splashRadius: weapon.splashRadius,
            splashDamage: weapon.splashDamage,
            homing: weapon.homing,
            chain: weapon.chain,
            chainFalloff: weapon.chainFalloff,
            speed: weapon.speed,
            hex: crit ? 0xfde047 : weapon.hex,
            projectile: weapon.projectile,
            crit,
            fromTurret: false
        }

        for (let i = 0; i < weapon.pellets; i++) {
            const spread = weapon.pellets > 1 ? (randomFloat() * 2 - 1) * weapon.spread : 0
            this.game.projectiles.spawnBullet(from, MUZZLE_D, MUZZLE_Y, angle + spread, spec, aim.y, this.target)
            if (leak) this.game.projectiles.bullets[this.game.projectiles.bullets.length - 1]!.leakU = leak.u
        }

        const muzzle = fieldToWorld(from + Math.sin(angle) * 36, MUZZLE_D + Math.cos(angle) * 36, MUZZLE_Y * FIELD_SCALE, _v)
        this.game.transient?.flash(muzzle, spec.hex, weapon.projectile === 'slug' ? 0.9 : 0.55)
        this.railKick = railKickFor(weapon.projectile)
        this.game.addShake(weapon.projectile === 'slug' ? 5 : crit ? 3 : 1.6)
    }

    emitAmmo() {
        const progress = this.reloadTimer > 0 && this.weapon
            ? 1 - this.reloadTimer / this.weapon.reloadMs
            : 1
        this.game.callbacks.onAmmo(this.mag, this.magSize, progress)
    }
}
