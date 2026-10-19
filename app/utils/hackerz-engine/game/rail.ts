import type * as THREE from 'three'
import { randomChance, randomFloat } from '../rng'
import type { HackerzWeaponRuntime } from '#shared/utils/gamelogic/hackerz'
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

    /** The hostile the button was pressed on: tracked only while it stays held. */
    target: EnemyEntity | null = null

    /** Left button held: the rail fires, at `target` or else at the cursor. */
    holding = false

    /** Where a lag spike left the rail firing when it dropped the lock. */
    lockSpot: { u: number, d: number, y: number } | null = null

    /** A press always fires once, even if the button is up again before the next frame. */
    queuedShot = false

    aimU = 0

    aimD = FIELD_DEPTH * 0.5

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

    /**
     * Where the rail is pointing this.game frame: the locked target, else the spot a
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
        if (weapon.id === 'rail') this.game.callbacks.onSound?.('shoot-rail')
        else if (weapon.id === 'flak') this.game.callbacks.onSound?.('shoot-flak')
        else if (weapon.id === 'arc') this.game.callbacks.onSound?.('shoot-arc')
        else if (weapon.id === 'missile') this.game.callbacks.onSound?.('shoot-missile')
        else if (weapon.id === 'sniper') this.game.callbacks.onSound?.('shoot-sniper')

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
