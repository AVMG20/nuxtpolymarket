import * as THREE from 'three'
import { HACKERZ_HACKER_ID, hackerzIsAirborne } from '#shared/utils/gamelogic/hackerz'
import { FIELD_HALF_WIDTH } from '../constants'
import { clamp } from '../math'
import type { EnemyEntity } from '../types'
import { PER_WORLD, GLITCH_FADE_MS, halfExtents, CROWD_GAP, LANE_SLACK } from './tuning'
import { enemyWorld, footprint, outweighs, sinkInto } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** How long a body may stand blocked before a jam is broken, and how long it then backs off to break it. */
const JAM_MS = 2500
const YIELD_MS = 700

/** The most two overlapping bodies are pushed apart in one tick (field units). */
const SEPARATE_STEP = 4

/**
 * A hacker passing through another body tears at full strength (kept topped
 * up past the fade while they overlap), with a puff of corrupted blocks this
 * often per frame — but none of a blast's skips. Cosmetic.
 */
const PHASE_GLITCH_MS = GLITCH_FADE_MS + 100
const PHASE_CLOUD_CHANCE = 0.08

/**
 * Bodies on the ground are solid: they part, queue, sidestep and barge,
 * and never walk through one another (hackers excepted).
 */
export class Crowd {
    constructor(private readonly game: HackerzGame) {}

    /**
     * Pushes overlapping enemies apart. Without it a wave stacks into a single
     * column at the wall and reads as one enemy taking sixty hits.
     */
    separate() {
        for (let i = 0; i < this.game.enemies.length; i++) {
            const a = this.game.enemies[i] as EnemyEntity
            for (let j = i + 1; j < this.game.enemies.length; j++) {
                const b = this.game.enemies[j] as EnemyEntity
                // Flyers pass over the walkers; only things on the same level collide,
                // nothing still waiting inside the portal, and nothing passes for
                // solid while it hacks or guards a chip.
                if (hackerzIsAirborne(a.def) !== hackerzIsAirborne(b.def) || a.gateHold || b.gateHold) continue
                // Each body's real footprint, turned the way it faces: a Siege
                // Tank is long, not round, so a circle would let two in a line
                // sit half inside each other.
                const fa = footprint(a)
                const fb = footprint(b)
                const du = b.u - a.u
                const dd = b.d - a.d
                const overlapU = fa.u + fb.u + CROWD_GAP - Math.abs(du)
                const overlapD = fa.d + fb.d + CROWD_GAP - Math.abs(dd)
                if (overlapU <= 0 || overlapD <= 0) continue
                // A body others pass through (a hacker at work, a guard on a
                // chip), or a hacker slipping through a heavy: no push. The
                // hacker in it glitches for as long as they are inside each
                // other; the body it passes through does not.
                if (this.permeable(a) || this.permeable(b) || this.slipsPast(a, b) || this.slipsPast(b, a)) {
                    if (overlapU > CROWD_GAP && overlapD > CROWD_GAP) {
                        for (const body of [a, b]) {
                            if (body.def.id !== HACKERZ_HACKER_ID) continue
                            // A warhead's glitch without the skips: torn bands and a
                            // flicker of corrupted blocks around it, as it passes through.
                            body.phaseMs = Math.max(body.phaseMs ?? 0, PHASE_GLITCH_MS)
                            if (Math.random() < PHASE_CLOUD_CHANCE) {
                                this.game.glitchClouds?.burst(enemyWorld(body, body.rig.height * PER_WORLD * 0.5, new THREE.Vector3()), body.rig.height * 0.7, body.def.hex)
                            }
                        }
                    }
                    continue
                }
                // Push them clear along whichever way they overlap least, never
                // into a third body: in a queue the one behind gives way, side by
                // side they part, which widens the front rather than slowing it.
                // Riders part the same way: their line only guides them.
                // A little each tick, so a deep overlap (a long body swinging
                // round) eases apart over a few frames instead of jumping.
                // A heavy body gives way less: the lighter one takes the push.
                const heavy = outweighs(a, b) ? a : outweighs(b, a) ? b : null
                const light = heavy === a ? b : a
                const back = heavy ? light : a.d > b.d ? a : b
                const side = du === 0 ? (i % 2 ? 1 : -1) : Math.sign(du)
                const pushD = Math.min(overlapD, SEPARATE_STEP)
                const pushU = Math.min(heavy ? overlapU : overlapU / 2, SEPARATE_STEP)
                const queue = () => this.shove([[back, back.u, back.d + (heavy ? Math.sign(light.d - heavy.d || 1) : 1) * pushD]])
                const part = () => heavy
                    ? this.shove([[light, clamp(light.u + Math.sign(light.u - heavy.u || 1) * pushU, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH), light.d]])
                    : this.shove([
                        [a, clamp(a.u - side * pushU, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH), a.d],
                        [b, clamp(b.u + side * pushU, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH), b.d]
                    ])
                if (overlapD < overlapU) {
                    if (!queue()) part()
                } else if (!part()) {
                    queue()
                }
            }
        }
    }

    /**
     * Moves each body to its spot unless that would sink any of them deeper
     * into a body outside the move (riders kept near their line). All or
     * nothing. True when applied.
     */
    private shove(moves: [EnemyEntity, number, number][]) {
        const was = moves.map(([e]) => [e.u, e.d] as const)
        if (moves.some(([e, u, d], k) => this.game.ridesNetwork(e) && !this.nearLine(e, u, d, was[k]![0], was[k]![1]))) return false
        for (const [e, u, d] of moves) {
            e.u = u
            e.d = d
        }
        const ok = moves.every(([e], k) => !this.game.enemies.some((o) => {
            if (moves.some(([m]) => m === o) || !this.solidPair(e, o)) return false
            const now = sinkInto(e, e.u, e.d, o)
            return now > 0.5 && now > sinkInto(e, was[k]![0], was[k]![1], o) + 0.01
        }))
        if (!ok) moves.forEach(([e], k) => ([e.u, e.d] = was[k]!))
        return ok
    }

    /** The stretch of line a rider is on: whether it runs along `d` (down, or up on a detour) or across. */
    legOf(enemy: EnemyEntity) {
        const from = enemy.route?.[enemy.routeSeg]
        if (!from) return null
        const to = enemy.route![enemy.routeSeg + 1] ?? from
        return { from, to, vertical: Math.abs(to.u - from.u) < 0.01 }
    }

    /**
     * Whether (u, d) is within `LANE_SLACK` of the stretch of line a rider is
     * on, or no further off it than (fromU, fromD) was: a move may not carry
     * a rider further from its line than the slack allows.
     */
    private nearLine(enemy: EnemyEntity, u: number, d: number, fromU: number, fromD: number) {
        const leg = this.legOf(enemy)
        // A hacker parking at its node has left the lines for good.
        if (!leg || enemy.hackSlot) return true
        const off = (pu: number, pd: number) => Math.max(
            Math.min(leg.from.u, leg.to.u) - pu, pu - Math.max(leg.from.u, leg.to.u),
            Math.min(leg.from.d, leg.to.d) - pd, pd - Math.max(leg.from.d, leg.to.d), 0)
        const now = off(u, d)
        return now <= LANE_SLACK || now <= off(fromU, fromD)
    }

    /** Whether standing at (u, d) would sink `enemy` deeper into any other ground body than it is now. */
    sinksDeeper(enemy: EnemyEntity, u: number, d: number) {
        return this.game.enemies.some((o) => {
            if (!this.solidPair(enemy, o)) return false
            const then = sinkInto(enemy, u, d, o)
            return then > 0.5 && then > sinkInto(enemy, enemy.u, enemy.d, o) + 0.01
        })
    }

    /**
     * A rider blocked by a body ahead steps round it: sideways off its line
     * to whichever side clears the body (the side it already leans to
     * first), at no more than its walking pace, and only as far as
     * `LANE_SLACK` allows. Returns where it can stand, or null to wait.
     */
    private sidestep(enemy: EnemyEntity, fromU: number, fromD: number, toU: number, toD: number, wall: EnemyEntity,
        blocked: (u: number, d: number) => boolean) {
        const leg = this.legOf(enemy)
        if (!leg) return null
        const fa = footprint(enemy)
        const fb = footprint(wall)
        const vertical = leg.vertical
        const at = vertical ? fromU : fromD
        const them = vertical ? wall.u : wall.d
        const line = vertical ? leg.from.u : leg.from.d
        const clear = (vertical ? fa.u + fb.u : fa.d + fb.d) + CROWD_GAP + 0.5
        const pace = Math.max(Math.hypot(toU - fromU, toD - fromD), 0.5)
        const lean = Math.sign(at - them) || Math.sign(line - them) || (this.game.enemies.indexOf(enemy) % 2 ? 1 : -1)
        for (const side of [lean, -lean]) {
            const target = them + side * clear
            if (Math.abs(target - line) > LANE_SLACK) continue
            const shift = clamp(target - at, -pace, pace)
            // Step aside while going on if there is room, else step aside on the spot.
            const spots = vertical
                ? [[fromU + shift, toD], [fromU + shift, fromD]]
                : [[toU, fromD + shift], [fromU, fromD + shift]]
            for (const [u, d] of spots as [number, number][]) {
                if (Math.abs(u) > FIELD_HALF_WIDTH) continue
                if (!blocked(u, d)) return { u, d }
            }
        }
        return null
    }

    /**
     * A body others pass straight through: a hacker at work on its node, or a
     * guard standing over a chip (a defender, a shield bearer). They hold
     * their ground, but never block anyone's way.
     */
    private permeable(enemy: EnemyEntity) {
        return enemy.hacking || !!enemy.defending || enemy.bearer
    }

    /**
     * Whether two bodies can collide at all: both on the ground, both on the
     * board, neither one others pass through — and never a hacker: hackers
     * glitch through every other body to reach their nodes, or a column of
     * tanks would keep them off the board.
     */
    private solidPair(a: EnemyEntity, b: EnemyEntity) {
        if (a === b || a.hp <= 0 || b.hp <= 0 || a.gateHold || b.gateHold || a.burrowMs > 0 || b.burrowMs > 0) return false
        if (hackerzIsAirborne(a.def) || hackerzIsAirborne(b.def) || this.permeable(a) || this.permeable(b)) return false
        return !this.slipsPast(a, b) && !this.slipsPast(b, a)
    }

    /** A hacker passes through every other body on the ground (glitching as it does, see `separate`). */
    private slipsPast(hacker: EnemyEntity, other: EnemyEntity) {
        return hacker !== other && hacker.def.id === HACKERZ_HACKER_ID
    }

    /**
     * A heavy body moving from (fromU, fromD) to (toU, toD) into a lighter
     * one, `other`, shoves it out of the way: aside,
     * off the line of the move (to whichever side it already stands), or
     * failing that on ahead of it. At most its own pace, never into a third
     * body. True when the lighter one moved.
     */
    private barge(other: EnemyEntity, fromU: number, fromD: number, toU: number, toD: number) {
        const mu = toU - fromU
        const md = toD - fromD
        const length = Math.hypot(mu, md)
        if (length < 1e-3) return false
        const pace = Math.max(length * 1.5, SEPARATE_STEP)
        // Across the move, to the side the lighter one already stands on.
        const pu = -md / length
        const pd = mu / length
        const side = Math.sign((other.u - fromU) * pu + (other.d - fromD) * pd) || 1
        const edge = (u: number) => clamp(u, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH)
        return this.shove([[other, edge(other.u + pu * side * pace), other.d + pd * side * pace]])
            || this.shove([[other, edge(other.u + mu / length * pace), other.d + md / length * pace]])
    }

    /** Whether any other body on the ground stands where this.game one is. */
    crowdedAt(enemy: EnemyEntity) {
        return this.game.enemies.some(o => o !== enemy && !o.gateHold && o.hp > 0 && !hackerzIsAirborne(o.def)
            && sinkInto(enemy, enemy.u, enemy.d, o) > 1)
    }

    /**
     * Collision: bodies on the ground are solid. If this.game tick's move (a walk, a
     * ride, a shove) would carry `enemy` deeper into another body than it
     * stood before, the move is cut back to the furthest point short of that —
     * it stops at contact and waits, rather than walking through or being
     * shoved aside. Moving away from or along another body is always free.
     */
    collide(enemy: EnemyEntity, fromU: number, fromD: number, fromSeg: number, fromYaw: number, dtMs: number) {
        if (hackerzIsAirborne(enemy.def) || enemy.burrowMs > 0) return
        const toU = enemy.u
        const toD = enemy.d
        if (toU === fromU && toD === fromD && enemy.yaw === fromYaw) return
        // One hacking or guarding a chip walks through everyone, and everyone through it.
        if (this.permeable(enemy)) return
        const rides = this.game.ridesNetwork(enemy)
        // Only bodies it could touch this.game tick: every spot tried below (the
        // move, a sidestep, a back-off) lies within twice the move of where
        // it started, and no footprint, however turned, reaches past x + z.
        const self = halfExtents(enemy.rig.box)
        const range = self.x + self.z + 2 * Math.hypot(toU - fromU, toD - fromD) + 1
        const others = this.game.enemies.filter((o) => {
            const half = halfExtents(o.rig.box)
            const near = range + half.x + half.z
            return Math.abs(o.u - fromU) <= near && Math.abs(o.d - fromD) <= near && this.solidPair(enemy, o)
        })
        // How deep it sank into any other body before this.game tick, at its old spot and heading.
        const toYaw = enemy.yaw
        enemy.yaw = fromYaw
        const before = others.map(o => sinkInto(enemy, fromU, fromD, o))
        enemy.yaw = toYaw
        const blocker = (u: number, d: number) => others.find((o, k) => {
            const now = sinkInto(enemy, u, d, o)
            return now > 0.5 && now > before[k]! + 0.01
        })
        const blocked = (u: number, d: number) => !!blocker(u, d)
        // A jam (two blocking each other) cannot last, and nobody walks
        // through anybody: the one held longest backs off for a moment, so the
        // other can step round it.
        if (enemy.yieldMs && enemy.yieldMs > 0) {
            enemy.yieldMs -= dtMs
            enemy.yaw = fromYaw
            const from = enemy.yieldFrom
            const awayU = from ? fromU - from.u : 0
            const awayD = from ? fromD - from.d : 1
            const length = Math.hypot(awayU, awayD) || 1
            const pace = Math.max(Math.hypot(toU - fromU, toD - fromD), 0.5)
            const u = clamp(fromU + awayU / length * pace, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH)
            const d = fromD + awayD / length * pace
            const clear = !blocked(u, d) && (!rides || this.nearLine(enemy, u, d, fromU, fromD))
            enemy.u = clear ? u : fromU
            enemy.d = clear ? d : fromD
            enemy.routeSeg = fromSeg
            return
        }
        // A long body cannot swing round into a neighbour either: it keeps its
        // old heading until there is room to turn.
        const turnWall = toYaw !== fromYaw ? blocker(fromU, fromD) : undefined
        if (turnWall) {
            enemy.yaw = fromYaw
            // A hacker turning into its slot does not wait on a passer-by:
            // the passer-by is eased out of its way, a little each tick.
            if (enemy.hackSlot && !turnWall.hackSlot) {
                const du = turnWall.u - fromU
                const dd = turnWall.d - fromD
                const length = Math.hypot(du, dd) || 1
                this.shove([[turnWall, clamp(turnWall.u + du / length * SEPARATE_STEP, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH),
                    turnWall.d + dd / length * SEPARATE_STEP]])
            }
        }
        if (toU === fromU && toD === fromD) return
        let wall = blocker(toU, toD)
        // A heavy body does not queue behind a light one: it barges it aside.
        if (wall && outweighs(enemy, wall) && this.barge(wall, fromU, fromD, toU, toD)) wall = blocker(toU, toD)
        if (!wall) {
            enemy.blockedMs = 0
            enemy.blockedBy = null
            return
        }
        // A rider is not glued to its line: it steps round the body in its way.
        // One parking at its node keeps to its own way in, and waits.
        const round = rides && !enemy.hackSlot ? this.sidestep(enemy, fromU, fromD, toU, toD, wall, blocked) : null
        if (round) {
            enemy.u = round.u
            enemy.d = round.d
            enemy.blockedMs = 0
            enemy.blockedBy = null
            return
        }
        enemy.blockedBy = wall
        // The furthest point along the move that is still clear.
        let lo = 0
        let hi = 1
        for (let step = 0; step < 8; step++) {
            const t = (lo + hi) / 2
            if (blocked(fromU + (toU - fromU) * t, fromD + (toD - fromD) * t)) hi = t
            else lo = t
        }
        enemy.u = fromU + (toU - fromU) * lo
        enemy.d = fromD + (toD - fromD) * lo
        // Cut back before a corner it had just turned, it is still on the stretch before it.
        if (lo < 1 && enemy.routeSeg !== fromSeg) enemy.routeSeg = fromSeg
        // A shove into a body stops dead against it.
        enemy.pushVd = 0
        enemy.blockedMs = (enemy.blockedMs ?? 0) + dtMs
        // Only a true deadlock — two bodies each waiting on the other — is
        // broken, by this.game one backing off. A queue just waits its turn.
        if (enemy.blockedMs > JAM_MS && wall.blockedBy === enemy) {
            enemy.blockedMs = 0
            enemy.yieldMs = YIELD_MS
            enemy.yieldFrom = wall
        }
    }
}
