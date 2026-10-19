import * as THREE from 'three'
import { randomInt } from '../rng'
import {
    HACKERZ_HACKER_ID,
    HACKERZ_PORTSCAN_REPING_MS,
    hackerzDeployable,
    hackerzDeployableStats,
    hackerzEmptyStock,
    hackerzIsAirborne,
    type HackerzDeployableId,
    type HackerzDeployableStock
} from '#shared/utils/gamelogic/hackerz'
import { FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE } from '../constants'
import { clamp } from '../math'
import type { PathChip } from '../path-chips'
import type { Blast } from '../deployables'
import { nearestOnNetwork } from '../data-lines'
import { CYAN, fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { _v } from './tuning'
import { bodyPoint } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** Deployables may only go down on this stretch of the lane. */
const DEPLOY_MIN_D = 60
const DEPLOY_MAX_D = FIELD_DEPTH * 0.85

/** A logic bomb dropped this close to a node that is not theirs is wired onto it. */
const BOMB_CHIP_SNAP = 110

/**
 * Deployables in play: arming one, where it goes down, the instant ones
 * (Portscan, Cosmic Blip, White Hat), Power Surges and the blasts.
 */
export class Deployer {
    constructor(private readonly game: HackerzGame) {}

    stock: HackerzDeployableStock = hackerzEmptyStock()

    /** Armed by Z/X/C: the next left click places it instead of firing. */
    armed: HackerzDeployableId | null = null

    /** Power Surges on the grid: where, how long left, and the countdowns to the next arc and the next ring. */
    surges: { u: number, d: number, leftMs: number, arcMs: number, ringMs: number }[] = []

    /** Where a deployable would land: the cursor, kept to the deployable stretch. */
    private get deployD() {
        return clamp(this.game.rail.aimD, DEPLOY_MIN_D, DEPLOY_MAX_D)
    }

    /** Arms a deployable for the next click, or disarms with null. Arming one you have none of does nothing. */
    arm(id: HackerzDeployableId | null) {
        if (id && (!this.game.running || this.game.purging || this.stock[id] <= 0)) {
            if (id && this.game.running && this.stock[id] <= 0) this.game.callbacks.onNotice(`No ${hackerzDeployable(id).name} left — buy them at the uplink.`, 'info')
            return
        }
        if (this.armed === id) return
        this.armed = id
        if (id) this.game.rail.lock(null)
        this.showGhost(id)
        this.game.callbacks.onArm?.(id)
    }

    /**
     * The node a logic bomb under the cursor would wire onto: the nearest one
     * still ours or still being fought over, within reach of the cursor.
     */
    private bombChip(): PathChip | null {
        let best: PathChip | null = null
        let bestDistance = BOMB_CHIP_SNAP
        for (const chip of this.game.pathChips?.chips ?? []) {
            if (chip.state === 'hacked') continue
            const distance = Math.hypot(chip.u - this.game.rail.aimU, chip.d - this.game.rail.aimD)
            if (distance > bestDistance) continue
            best = chip
            bestDistance = distance
        }
        return best
    }

    /** Where an armed deployable would go down, and the node it would wire onto, if any. */
    deploySpot(id: HackerzDeployableId) {
        if (id === 'bomb') {
            const chip = this.bombChip()
            if (chip) return { u: chip.u, d: chip.d, chip }
        }
        let u = clamp(this.game.rail.aimU, -FIELD_HALF_WIDTH + 30, FIELD_HALF_WIDTH - 30)
        let d = this.deployD
        // A honeypot sits on a data line, or nothing could ride to it.
        if (id === 'honeypot') {
            const on = nearestOnNetwork(this.game.movement.network, u, d)
            if (on) {
                u = on.u
                d = clamp(on.d, DEPLOY_MIN_D, DEPLOY_MAX_D)
            }
        }
        return { u, d, chip: null }
    }

    showGhost(id: HackerzDeployableId | null) {
        // A White Hat picks a hostile: no patch of ground to preview.
        if (!id || id === 'whitehat') {
            this.game.deployables?.setGhost(null)
            return
        }
        const spot = this.deploySpot(id)
        this.game.deployables?.setGhost(id, spot.u, spot.d, this.game.wave)
    }

    placeArmed() {
        const id = this.armed
        const deployables = this.game.deployables
        if (!id || !deployables || !this.game.running || this.game.purging || this.game.paused || this.stock[id] <= 0) return
        const { u, d, chip } = this.deploySpot(id)
        this.drop(id, u, d, chip)
        // One click, one drop: placing another means pressing the key again.
        this.arm(null)
    }

    /** Puts a deployable down at (u, d), wired onto `chip` if given, and spends one. */
    drop(id: HackerzDeployableId, u: number, d: number, chip: PathChip | null) {
        // A Power Surge is a field the engine runs; the rest are props the deployables keep.
        if (id === 'surge') this.placeSurge(u, d)
        else this.game.deployables?.place(id, u, d, this.game.wave, chip?.id ?? null)
        const hex = hackerzDeployable(id).hex
        this.stock[id]--
        this.game.callbacks.onDeploy?.(id, this.stock[id])
        this.game.sysLog.deploy(id, chip?.id ?? null)
        const at = fieldToWorld(u, d, 0.2, new THREE.Vector3())
        this.game.transient?.ring(at, hex, 4, 0.4)
        this.game.particles.burst(at, hex, 30, 9, { size: 0.3, life: 0.6 })
        this.game.view?.addSurge(at.x, at.z, hex, 1.2)
        this.game.callbacks.onSound?.('weapon-swap')
    }

    /**
     * A deployable with nothing to aim goes off the moment its key is pressed.
     * One that would do nothing right now (no node to flip back) is kept.
     */
    useInstant(id: HackerzDeployableId) {
        const loadout = this.game.loadout
        if (!loadout || !this.game.running || this.game.purging || this.game.paused) return
        if (this.stock[id] <= 0) {
            this.game.callbacks.onNotice(`No ${hackerzDeployable(id).name} left — buy them at the uplink.`, 'info')
            return
        }
        if (id === 'portscan') {
            this.game.abilities.portscanLeft = loadout.portscanMs
            this.game.abilities.rescanMs = HACKERZ_PORTSCAN_REPING_MS
            this.game.abilities.firePing(true)
            this.game.sysLog.deploy(id, null)
        } else if (id === 'blip') {
            if (!this.cosmicBlip(loadout.blipNodes)) return
        } else return
        this.stock[id]--
        this.game.callbacks.onDeploy?.(id, this.stock[id])
        this.game.callbacks.onSound?.('weapon-swap')
    }

    /** A Cosmic Blip: `count` hacked nodes, picked at random, flipped straight back to us. False when there are none. */
    private cosmicBlip(count: number) {
        const chips = this.game.pathChips
        const hacked = chips && !chips.locked ? chips.chips.filter(chip => chip.state === 'hacked') : []
        if (!hacked.length) {
            this.game.callbacks.onNotice(chips?.locked ? 'The flood holds every node — nothing for a blip to flip.' : 'No hacked node to flip back.', 'info')
            return false
        }
        let flipped = 0
        for (let n = 0; n < count && hacked.length; n++) {
            const chip = hacked.splice(randomInt(0, hacked.length - 1), 1)[0]!
            if (!chips!.reclaim(chip)) continue
            flipped++
            const at = fieldToWorld(chip.u, chip.d, 0.4, new THREE.Vector3())
            // Out of the sky: a white streak straight down onto the node.
            this.game.transient?.beam(fieldToWorld(chip.u, chip.d, 30, new THREE.Vector3()), at, 0xe0f2fe, 0.4)
            this.game.transient?.ring(at, CYAN, 6, 0.55)
            this.game.particles.burst(at, CYAN, 34, 10, { size: 0.32, life: 0.7 })
            this.game.view?.addSurge(at.x, at.z, CYAN, 1.6)
            this.game.hacking.pulseFromChip(chip)
        }
        this.game.sysLog.blip(flipped)
        return flipped > 0
    }

    /**
     * A White Hat: the hostile clicked (never a boss), and as many of the
     * nearest others as the Mainframe allows, switch sides for good.
     */
    useWhiteHat(picked: EnemyEntity | null) {
        const loadout = this.game.loadout
        if (!loadout || !this.game.running || this.game.purging || this.game.paused || this.stock.whitehat <= 0) return
        if (!picked || !this.game.whiteHats.turnable(picked)) {
            this.game.callbacks.onNotice(picked?.def.boss ? 'A boss cannot be turned.' : 'Click a hostile to turn it.', 'info')
            return
        }
        const turned = [picked]
        const others = this.game.enemies
            .filter(e => e !== picked && this.game.whiteHats.turnable(e))
            .sort((a, b) => Math.hypot(a.u - picked.u, a.d - picked.d) - Math.hypot(b.u - picked.u, b.d - picked.d))
        turned.push(...others.slice(0, loadout.whitehatTargets - 1))
        for (const enemy of turned) this.game.whiteHats.turnEnemy(enemy)
        this.stock.whitehat--
        this.game.callbacks.onDeploy?.('whitehat', this.stock.whitehat)
        this.game.sysLog.whiteHat(turned.length)
        this.game.callbacks.onSound?.('coin-pickup')
        this.arm(null)
    }

    /** A Power Surge laid on the grid at (u, d). */
    private placeSurge(u: number, d: number) {
        const loadout = this.game.loadout
        if (!loadout) return
        this.surges.push({ u, d, leftMs: loadout.surgeMs, arcMs: 0, ringMs: 0 })
    }

    /** Every Power Surge on the grid: arcs into the hostiles inside it, a few at a time, until it runs out. */
    updateSurges(dtMs: number) {
        if (!this.surges.length) return
        const stats = hackerzDeployableStats(this.game.wave).surge
        const hex = hackerzDeployable('surge').hex
        for (let i = this.surges.length - 1; i >= 0; i--) {
            const surge = this.surges[i]!
            surge.leftMs -= dtMs
            if (surge.leftMs <= 0) {
                this.surges.splice(i, 1)
                continue
            }
            // The field itself: a ring breathing on the grid, and stray sparks across it.
            surge.ringMs -= dtMs
            if (surge.ringMs <= 0) {
                surge.ringMs = 600
                this.game.transient?.ring(fieldToWorld(surge.u, surge.d, 0.08, _v), hex, stats.radius * FIELD_SCALE, 0.5, 0.6)
            }
            const centre = fieldToWorld(surge.u, surge.d, 0.3, new THREE.Vector3())
            if (Math.random() < dtMs / 1000 * 8) {
                const a = Math.random() * Math.PI * 2
                const r = Math.random() * stats.radius
                this.game.transient?.bolt(centre, fieldToWorld(surge.u + Math.cos(a) * r, surge.d + Math.sin(a) * r, 0.1, new THREE.Vector3()), hex)
            }
            surge.arcMs -= dtMs
            if (surge.arcMs > 0) continue
            surge.arcMs += stats.arcMs
            const inside = this.game.enemies.filter(e => !e.turned && e.hp > 0 && !this.game.combat.untouchable(e)
                && Math.hypot(e.u - surge.u, e.d - surge.d) <= stats.radius)
            for (let n = 0; n < stats.arcs && inside.length; n++) {
                const enemy = inside.splice(randomInt(0, inside.length - 1), 1)[0]!
                this.game.combat.damageEnemy(enemy, stats.damage, 'energy', true, true)
                const at = bodyPoint(enemy, 0.5, new THREE.Vector3())
                this.game.transient?.bolt(centre, at, hex)
                this.game.particles.burst(at, hex, 5, 6, { size: 0.2, life: 0.25 })
            }
        }
    }

    /** A honeypot or logic bomb goes off: everything in the radius takes it, falling off to half at the edge. */
    detonateBlast(blast: Blast) {
        const at = fieldToWorld(blast.u, blast.d, 0.4, new THREE.Vector3())
        this.game.transient?.ring(at, blast.hex, blast.radius * FIELD_SCALE, 0.5, 2)
        this.game.transient?.flash(at, blast.hex, 3, 0.3)
        this.game.particles.burst(at, blast.hex, 90, 18, { size: 0.42, life: 0.9, gravity: 10 })
        this.game.particles.burst(at, 0xffffff, 30, 12, { size: 0.3, life: 0.5 })
        this.game.view?.addSurge(at.x, at.z, blast.hex, 2.4)
        this.game.view?.flash(blast.hex, 0.18)
        this.game.addShake(12)
        this.game.callbacks.onSound?.('boss-death')
        let kills = 0
        for (let i = this.game.enemies.length - 1; i >= 0; i--) {
            const enemy = this.game.enemies[i] as EnemyEntity
            if (this.game.combat.untouchable(enemy)) continue
            const distance = Math.hypot(enemy.u - blast.u, enemy.d - blast.d)
            if (distance > blast.radius) continue
            this.game.combat.damageEnemy(enemy, blast.damage * (1 - 0.5 * distance / blast.radius), 'energy', true, true)
            if (!enemy.def.boss) enemy.pushVd += 160 * (1 - distance / blast.radius)
            if (enemy.hp <= 0) {
                this.game.combat.killEnemy(i, 1)
                kills++
            }
        }
        this.game.sysLog.blast(blast.kind, kills)
        const label = blast.kind === 'honeypot' ? 'HONEYPOT SPRUNG' : 'LOGIC BOMB'
        this.game.overlay.floatText(fieldToWorld(blast.u, blast.d, 3, _v), kills > 1 ? `${label} ×${kills}` : label, blast.hex, kills > 2 ? 1.7 : 1.3)
        if (kills >= 4) this.game.overlay.banner(`MULTI-KILL ×${kills}`, blast.hex)
    }

    updateDeployables(dt: number) {
        const deployables = this.game.deployables
        if (!deployables) return
        const ground = this.game.enemies
            .filter(e => !hackerzIsAirborne(e.def) && !this.game.combat.untouchable(e))
            .map(e => ({ u: e.u, d: e.d, hacker: e.def.id === HACKERZ_HACKER_ID }))
        const events = deployables.update(dt, ground)
        for (const blast of events.blasts) this.detonateBlast(blast)
        for (const broken of events.broken) {
            const at = fieldToWorld(broken.u, broken.d, 1, new THREE.Vector3())
            this.game.particles.burst(at, broken.hex, 50, 12, { size: 0.3, life: 0.6 })
            if (broken.hp <= 0) this.game.overlay.floatText(at, 'PROXY DOWN', broken.hex, 1.1)
        }
    }
}
