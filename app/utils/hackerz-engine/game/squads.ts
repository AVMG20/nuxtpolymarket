import * as THREE from 'three'
import {
    HACKERZ_HACKER_ID, hackerzEnemy, hackerzIsAirborne, type HackerzEnemyId
} from '#shared/utils/gamelogic/hackerz'
import { FIELD_HALF_WIDTH, RAIL_U } from '../constants'
import { clamp, randRange } from '../math'
import type { PathChip } from '../path-chips'
import { fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { HACK_REACH, PER_WORLD, _v, _w, CROWD_GAP, MUZZLE_D } from './tuning'
import { enemyWorld, footprint } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/**
 * What a rider is doing: pressing on, healing in red, falling back to it,
 * holding to cover one that is, guarding a held node, or sheltering beside a
 * shield bearer.
 */
type Tactic = 'advance' | 'recover' | 'retreat' | 'cover' | 'guard' | 'shelter'

/**
 * Shield bearers: the Bulwark is the shield unit. A dark zone sends this many,
 * up to this many on the field, to stand this far in front of the frontier
 * nodes (the nearest this many to the fence), this far apart; the wounded
 * shelter this far behind them.
 */
const BEARER_ID = 'brute'
const BEARERS_PER_ZONE = 3
const BEARERS_MAX = 6
const BEARER_FRONT = 2
const BEARER_AHEAD = 80

/** A hacked node draws its defender from units within this far of it. */
const DEFEND_RADIUS = 300

/** How far in front of its node (toward the fence) a defender stands. */
const DEFEND_AHEAD = 50

/** From this wave each hacker brings a bodyguard, and from the second wave listed, two. */
const ESCORT_FROM_WAVE = 10
const ESCORT_DOUBLE_WAVE = 20

/** A free unit this close to an unguarded hacker is drafted; failing that, the portal sends one. */
const ESCORT_REACH = 600
const ESCORT_ID: HackerzEnemyId = 'grunt'
const ESCORT_RESPAWN_MS = 900

/** A ranged unit will not set up closer than this to a node, so it never reads as the node's guard. */
const RANGED_CHIP_CLEAR = 130
const BEARER_SPACING = 55
const SHELTER_BEHIND = 70

/** The wounded only make for a shield wall this close; sheltering this close behind a bearer heals. */
const SHELTER_REACH = 350
const SHELTER_RADIUS = 110

const BEARER_RESPAWN_MS = 1500

/** A weakling below this share of health holds in red to heal, until it is back above `RECOVERED`. */
const RETREAT_BELOW = 0.5
const RECOVERED = 0.9

const COVER_RADIUS = 170
const COVER_HOLD_MS = 900

/**
 * Hostiles working together: shield walls, node defenders, bodyguards,
 * and the tactics that send the wounded back to heal.
 */
export class Squads {
    constructor(private readonly game: HackerzGame) {}

    /** Ms until the portal may send the next shield bearer. */
    private bearerTimer = 0

    private escortTimer = 0

    /** A dark zone calls up the shield wall; `maintainBearers` sends the bulwarks. */
    sendShieldBearers() {
        this.bearerTimer = 0
        const front = this.frontierChips()[0]
        if (front) {
            this.game.callbacks.onNotice('A shield wall is moving up to guard their nodes.', 'bad')
            this.game.sysLog.shieldWall(front.id)
        }
    }

    /**
     * While a dark zone stands, the portal keeps its shield wall manned:
     * `BEARERS_PER_ZONE` bulwarks per zone (up to `BEARERS_MAX`), each slain
     * one replaced, a beat apart. Top-ups like the hackers: half the credits,
     * no coins.
     */
    maintainBearers(dtMs: number) {
        this.bearerTimer -= dtMs
        // Nothing to shield on a locked board: its nodes cannot be taken back.
        if (this.bearerTimer > 0 || this.game.pathChips?.locked) return
        const zones = this.game.territory.darkZones.filter(zone => zone.on).length
        const wanted = Math.min(BEARERS_MAX, zones * BEARERS_PER_ZONE)
        if (!wanted || !this.frontierChips().length) return
        if (this.game.enemies.filter(e => e.bearer).length >= wanted) return
        this.bearerTimer = BEARER_RESPAWN_MS
        this.game.spawn(hackerzEnemy(BEARER_ID), true)
        const bearer = this.game.enemies[this.game.enemies.length - 1]
        if (!bearer) return
        bearer.bearer = true
        bearer.targetChip = this.leastGuardedFrontier()
    }

    /**
     * Every hacked node keeps one defender in front of it: the least tanky
     * unit nearby that is not a hacker. A defender keeps the post until it
     * dies, the node is taken back, or the final push sends everything in;
     * then the next weakest nearby steps up.
     */
    maintainDefenders() {
        const chips = this.game.pathChips?.chips ?? []
        // A locked board's nodes cannot be taken back, so nobody guards them;
        // and a bonus round is a rush besides.
        const holding = !this.game.finalPush && !this.game.bonus && !this.game.pathChips?.locked
        for (const enemy of this.game.enemies) {
            if (enemy.defending && (!holding || enemy.defending.state !== 'hacked')) enemy.defending = null
        }
        if (!holding) return
        for (const chip of chips) {
            if (chip.state !== 'hacked') continue
            if (this.game.enemies.some(e => e.defending === chip)) continue
            let pick: EnemyEntity | null = null
            for (const enemy of this.game.enemies) {
                if (!this.canDefend(enemy)) continue
                if (Math.hypot(enemy.u - chip.u, enemy.d - chip.d) > DEFEND_RADIUS) continue
                if (!pick || enemy.maxHp < pick.maxHp) pick = enemy
            }
            if (!pick) continue
            pick.defending = chip
            this.game.sight('defender')
        }
    }

    /**
     * Late in the run every hacker brings bodyguards: weak walkers that keep
     * themselves between it and the rail and soak the fire meant for it. A
     * guard that falls is replaced by the nearest free weakling, or, with none
     * to hand, by a fresh one from the portal — a top-up like the hackers
     * themselves: half the credits, no coins.
     */
    maintainEscorts(dtMs: number) {
        this.escortTimer -= dtMs
        const perHacker = this.game.wave >= ESCORT_DOUBLE_WAVE ? 2 : this.game.wave >= ESCORT_FROM_WAVE ? 1 : 0
        const wanted = (hacker: EnemyEntity) => this.game.bonus ? 0 : Math.max(perHacker, this.isVanguard(hacker) ? 1 : 0)
        const live = new Set(this.game.enemies)
        for (const enemy of this.game.enemies) {
            const charge = enemy.escorting
            if (charge && (!live.has(charge) || charge.hp <= 0 || !wanted(charge))) enemy.escorting = null
        }
        if (this.game.bonus) return
        for (const hacker of this.game.enemies) {
            if (hacker.def.id !== HACKERZ_HACKER_ID || hacker.decoy) continue
            const want = wanted(hacker)
            let guards = this.game.enemies.filter(e => e.escorting === hacker).length
            if (guards > 0) this.game.sight('bodyguard')
            while (guards < want) {
                // A hacker pushing past the gate drags one of the node
                // defenders along as its shield before it drafts anyone else.
                const hostage = this.isVanguard(hacker) && guards === 0 ? this.nearestDefender(hacker) : null
                if (hostage) {
                    hostage.defending = null
                    hostage.escorting = hacker
                    guards++
                    this.game.sysLog.hostage(hacker.def.id, hostage.def.id)
                    continue
                }
                const recruit = this.nearestFreeEscort(hacker)
                if (recruit) {
                    recruit.escorting = hacker
                    guards++
                    continue
                }
                if (this.escortTimer > 0) return
                this.escortTimer = ESCORT_RESPAWN_MS
                this.game.spawn(hackerzEnemy(ESCORT_ID), true)
                const fresh = this.game.enemies[this.game.enemies.length - 1]
                if (fresh) fresh.escorting = hacker
                return
            }
        }
    }

    /**
     * A hacker that found the first node's terminals all taken and pushed on
     * to one further forward, while that first node still stands.
     */
    private isVanguard(hacker: EnemyEntity) {
        const gate = this.game.pathChips?.ordered[0]
        const pick = hacker.targetChip
        return !!gate && gate.state !== 'hacked' && !!pick && pick !== gate && pick.state !== 'hacked'
    }

    /** The nearest unit within reach standing guard at a node, to be taken along as a shield. */
    private nearestDefender(hacker: EnemyEntity) {
        let best: EnemyEntity | null = null
        let bestDistance = ESCORT_REACH
        for (const enemy of this.game.enemies) {
            if (!enemy.defending || enemy.escorting) continue
            const distance = Math.hypot(enemy.u - hacker.u, enemy.d - hacker.d)
            if (distance >= bestDistance) continue
            best = enemy
            bestDistance = distance
        }
        return best
    }

    /** The closest unit within reach that is free to bodyguard: a plain, unarmoured walker. */
    private nearestFreeEscort(hacker: EnemyEntity) {
        let best: EnemyEntity | null = null
        let bestDistance = ESCORT_REACH
        for (const enemy of this.game.enemies) {
            if (enemy.escorting || enemy.defending || enemy.bearer || enemy.turned || enemy.decoy || enemy.def.boss || enemy.def.armored) continue
            if (enemy.def.kind !== 'walker' || enemy.def.id === HACKERZ_HACKER_ID || enemy.def.cloaked || enemy.burrowMs > 0) continue
            const distance = Math.hypot(enemy.u - hacker.u, enemy.d - hacker.d)
            if (distance >= bestDistance) continue
            best = enemy
            bestDistance = distance
        }
        return best
    }

    /**
     * Where a bodyguard stands: on the line from its hacker to the rail, a
     * step in front, the second one a step further — so a round fired at the
     * hacker meets them first.
     */
    private escortPost(enemy: EnemyEntity) {
        const hacker = enemy.escorting
        if (!hacker) return null
        const rank = Math.max(0, this.game.enemies.filter(e => e.escorting === hacker).indexOf(enemy))
        const du = RAIL_U - hacker.u
        const dd = MUZZLE_D - hacker.d
        const length = Math.hypot(du, dd) || 1
        // Bodies are solid: the guard stands clear of its hacker's nose, and a
        // second guard clear of the first — by their real size along the line.
        const reach = (e: EnemyEntity) => {
            const foot = footprint(e)
            return Math.abs(du / length) * foot.u + Math.abs(dd / length) * foot.d
        }
        const depth = reach(enemy)
        const ahead = reach(hacker) + depth + CROWD_GAP + rank * (depth * 2 + CROWD_GAP)
        return { u: hacker.u + du / length * ahead, d: Math.max(20, hacker.d + dd / length * ahead) }
    }

    /** Who may stand guard at a node: any free walker but the hackers, the bearers, the bosses and the turned. */
    private canDefend(enemy: EnemyEntity) {
        return !enemy.defending && !enemy.escorting && !enemy.bearer && !enemy.turned && !enemy.decoy && !enemy.def.boss && !enemy.demoPath
            && enemy.def.id !== HACKERZ_HACKER_ID && !hackerzIsAirborne(enemy.def) && enemy.burrowMs <= 0
    }

    /** Where a defender stands: square in front of its node, toward the fence. */
    private defenderPost(enemy: EnemyEntity) {
        const chip = enemy.defending
        if (!chip || chip.state !== 'hacked') return null
        // In front of the hackers working the node, not among them: past the
        // furthest a hacker stands to work it, by the defender's own depth.
        const ahead = Math.max(DEFEND_AHEAD, HACK_REACH + footprint(enemy).d + CROWD_GAP)
        return { u: chip.u, d: Math.max(30, chip.d - ahead) }
    }

    /** The frontier node with the fewest bearers on it. */
    private leastGuardedFrontier() {
        const front = this.frontierChips()
        const guards = (chip: PathChip) => this.game.enemies.filter(e => e.bearer && e.targetChip === chip).length
        return front.reduce<PathChip | null>((best, chip) => !best || guards(chip) < guards(best) ? chip : best, null)
    }

    /**
     * A bearer's chip: it follows the frontier as it moves, and when the node it
     * guards is taken back it has nothing left to stand for — it disintegrates.
     * True when the bearer is gone.
     */
    keepBearerPost(enemy: EnemyEntity, index: number) {
        const chip = enemy.targetChip
        if (!chip || chip.state !== 'hacked') {
            this.disintegrate(index)
            return true
        }
        if (!this.frontierChips().includes(chip)) enemy.targetChip = this.leastGuardedFrontier() ?? chip
        return false
    }

    /** A bearer short-circuits: it shorts into the floor and is gone, paying nothing. */
    private disintegrate(index: number) {
        const enemy = this.game.enemies[index]
        if (!enemy) return
        const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.game.particles.burst(at, enemy.def.hex, 40, 10, { size: 0.3, life: 0.7 })
        const ground = fieldToWorld(enemy.u, enemy.d, 0.05, new THREE.Vector3())
        for (let b = 0; b < 4; b++) {
            this.game.transient?.bolt(at, ground.clone().add(_w.set(randRange(-1, 1), 0, randRange(-1, 1))), enemy.def.hex)
        }
        this.game.view?.addSurge(ground.x, ground.z, enemy.def.hex, 1)
        this.game.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'DISINTEGRATED', enemy.def.hex, 1)
        this.game.combat.removeEnemy(index, true)
    }

    /**
     * The frontier: the hacked nodes nearest the fence, the ones the player is
     * most likely to try and take back.
     */
    private frontierChips() {
        return (this.game.pathChips?.chips ?? [])
            .filter(chip => chip.state === 'hacked')
            .sort((a, b) => a.d - b.d)
            .slice(0, BEARER_FRONT)
    }

    /**
     * Where a bearer stands: in front of a frontier node, toward the fence,
     * shoulder to shoulder with the others guarding it. Null when there is no
     * node left to guard.
     */
    private bearerPost(enemy: EnemyEntity) {
        const chip = enemy.targetChip
        if (!chip || chip.state !== 'hacked') return null
        // Its place in the wall: how many bearers on the same node came before it.
        const rank = this.game.enemies.filter(e => e.bearer && e.targetChip === chip).indexOf(enemy)
        const side = rank % 2 === 0 ? 1 : -1
        const offset = rank === 0 ? 0 : side * Math.ceil(rank / 2) * BEARER_SPACING
        return { u: clamp(chip.u + offset, -FIELD_HALF_WIDTH + 30, FIELD_HALF_WIDTH - 30), d: Math.max(30, chip.d - BEARER_AHEAD) }
    }

    /**
     * Where a wounded unit shelters: just behind the nearest posted bearer, on
     * the portal side, out of the line of fire. Null with no bearer posted.
     */
    private shelterSpot(enemy: EnemyEntity) {
        let best: { u: number, d: number } | null = null
        let bestDistance = Infinity
        for (const other of this.game.enemies) {
            if (!other.bearer) continue
            const post = this.bearerPost(other)
            if (!post) continue
            const distance = Math.hypot(post.u - enemy.u, post.d - enemy.d)
            // A wall too far off is no shelter: the walk there would finish it.
            if (distance > SHELTER_REACH) continue
            if (distance < bestDistance) {
                bestDistance = distance
                best = { u: post.u + (enemy.hackReach - 0.5) * 50, d: post.d + SHELTER_BEHIND }
            }
        }
        return best
    }

    /**
     * A ranged unit that has set up within reach of a node picks a firing spot
     * to one side of it instead, clear of every node, and parks there. True
     * when it has just been sent to step aside.
     */
    parkAside(enemy: EnemyEntity) {
        if (enemy.def.kind !== 'ranged' || enemy.parked) return false
        const chips = this.game.pathChips?.chips ?? []
        const blocking = chips.find(chip => Math.hypot(chip.u - enemy.u, chip.d - enemy.d) < RANGED_CHIP_CLEAR)
        if (!blocking) return false
        const clear = (u: number) => Math.abs(u) <= FIELD_HALF_WIDTH - 30
            && chips.every(chip => Math.hypot(chip.u - u, chip.d - enemy.d) >= RANGED_CHIP_CLEAR)
        // Its own side of the node first, then the other.
        const side = Math.sign(enemy.u - blocking.u) || 1
        for (const s of [side, -side]) {
            for (let step = 1; step <= 4; step++) {
                const u = blocking.u + s * (RANGED_CHIP_CLEAR + 10) * step
                if (!clear(u)) continue
                enemy.parked = { u, d: enemy.d }
                return true
            }
        }
        return false
    }

    /** A parked gun walks to its firing spot; it has arrived once it is there. */
    walkToPark(enemy: EnemyEntity, spot: { u: number, d: number }, dt: number) {
        const moved = this.game.movement.walkTo(enemy, spot.u, spot.d, dt)
        return { moved, arrived: moved === 0 }
    }

    /** Whether a unit stands close behind a shield bearer (portal side), in the cover of the wall. */
    isSheltered(enemy: EnemyEntity) {
        if (enemy.bearer) return false
        return this.game.enemies.some(other => other.bearer && other.d < enemy.d
            && Math.hypot(other.u - enemy.u, other.d - enemy.d) <= SHELTER_RADIUS)
    }

    /** Armored units and bosses: the only ones that will walk into blue ground. */
    private isTanky(enemy: EnemyEntity) {
        return enemy.def.armored || !!enemy.def.boss
    }

    /**
     * The weaker rank and file: they hold back from blue ground and fall back
     * to heal. Hackers and sappers each have one job and do it regardless.
     */
    private isSkirmisher(enemy: EnemyEntity) {
        return !this.isTanky(enemy) && enemy.def.kind !== 'bomber' && enemy.def.id !== HACKERZ_HACKER_ID && !enemy.decoy
    }

    /** Whether a unit stops at the edge of blue ground: skirmishers, until the final push sends everything in. */
    keepsOutOfBlue(enemy: EnemyEntity) {
        return this.game.running && !this.game.finalPush && !this.game.bonus && this.isSkirmisher(enemy)
    }

    /**
     * What a rider does this.game frame. A skirmisher under half health falls back
     * toward red ground and, once there, holds and heals until it is nearly
     * whole. A healthy unit asked to cover holds where it is for a moment.
     * The final push overrides it all.
     */
    tactics(enemy: EnemyEntity, dtMs: number): Tactic {
        if (enemy.coverMs > 0) enemy.coverMs -= dtMs
        // Bearers hold their wall through everything, the final push included.
        if (enemy.bearer && this.game.running && !this.game.purging) return this.bearerPost(enemy) ? 'guard' : 'advance'
        // A node's defender holds its post until it is relieved.
        if (enemy.defending && this.game.running && !this.game.purging && this.defenderPost(enemy)) return 'guard'
        // A bodyguard sticks to its hacker through everything, the final push included.
        if (enemy.escorting && this.game.running && !this.game.purging) return 'guard'
        // Bonus rounds are a rush: nobody falls back or holds to cover.
        if (!this.game.running || this.game.purging || this.game.finalPush || this.game.bonus || enemy.def.boss) {
            enemy.recovering = false
            return 'advance'
        }
        if (this.isSkirmisher(enemy)) {
            const share = enemy.hp / enemy.maxHp
            if (share >= RECOVERED) enemy.recovering = false
            else if (share < RETREAT_BELOW) enemy.recovering = true
            // With a shield wall up, the wounded make for cover behind it.
            if (enemy.recovering && this.shelterSpot(enemy)) return 'shelter'
            if (enemy.recovering) return this.game.territory.zoneOf(enemy.u, enemy.d) === 'theirs' ? 'recover' : 'retreat'
        }
        return enemy.coverMs > 0 ? 'cover' : 'advance'
    }

    /** Carries out a non-advancing tactic. Returns the distance moved. */
    holdBack(enemy: EnemyEntity, tactic: Tactic, dt: number) {
        if (tactic === 'guard') {
            const post = enemy.bearer
                ? this.bearerPost(enemy)
                : enemy.escorting ? this.escortPost(enemy) : this.defenderPost(enemy)
            return post ? this.game.movement.walkTo(enemy, post.u, post.d, dt) : 0
        }
        if (tactic === 'shelter') {
            const spot = this.shelterSpot(enemy)
            return spot ? this.game.movement.walkTo(enemy, spot.u, spot.d, dt) : 0
        }
        if (tactic === 'retreat') {
            this.callCover(enemy)
            return this.game.movement.fallBack(enemy, dt)
        }
        if (tactic === 'recover') {
            // In red: make for a node they hold, if the line runs past one
            // nearby, and gather round it — it heals twice as fast there, and
            // the crowd stands between the player's rounds and the node. A
            // locked board's nodes cannot be taken, so nobody gathers there.
            if (this.game.pathChips?.locked) return 0
            const guard = this.game.pathChips?.chips.find(chip => chip.state === 'hacked'
                && Math.hypot(chip.u - enemy.u, chip.d - enemy.d) < 320
                && this.game.movement.routeAheadPasses(enemy, chip.u, chip.d, 70))
            if (!guard) return 0
            const reach = 55 + enemy.hackReach * 45
            return this.game.movement.ride(enemy, { stopD: enemy.standoff, near: (u, d) => Math.hypot(u - guard.u, d - guard.d) <= reach }, dt).moved
        }
        return 0
    }

    /**
     * Healthier units between a retreating one and the fence hold their
     * ground for a moment, so the player's fire meets them first.
     */
    private callCover(retreating: EnemyEntity) {
        for (const other of this.game.enemies) {
            if (other === retreating || other.def.id === HACKERZ_HACKER_ID || other.def.kind === 'bomber') continue
            if (other.hp / other.maxHp < 0.7 || other.d >= retreating.d || other.d <= other.standoff + 20) continue
            if (Math.hypot(other.u - retreating.u, other.d - retreating.d) > COVER_RADIUS) continue
            other.coverMs = COVER_HOLD_MS
        }
    }
}
