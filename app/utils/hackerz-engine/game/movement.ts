import { randomFloat } from '../rng'
import { hackerzIsAirborne } from '#shared/utils/gamelogic/hackerz'
import type { PathChip } from '../path-chips'
import type { Hold } from '../deployables'
import { nearestOnNetwork, tracePassesNear, type DataNetwork, type LinePoint, type Trace } from '../data-lines'
import { ENEMY_PACE, SAPPER_SPEED, THEIR_GROUND_SPEED, turnToward } from '../rig-motion'
import { RED } from '../scene'
import type { EnemyEntity, RouteGoal } from '../types'
import { _v, _w, CROWD_GAP, LANE_SLACK, YAW_DOWN } from './tuning'
import { enemyWorld, footprint, sinkInto } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** A honeypot pulls in riders whose next trace passes this close to it. */
const LURE_TRACE_RADIUS = 120

/** Facing for a rider running across, along a rung, either way. */
const YAW_RIGHT = Math.PI / 2
const YAW_LEFT = -Math.PI / 2

/** A bodyguard outpaces its charge by this much, so it can get back in front. */
const ESCORT_CATCH_UP = 1.3

/** Bearers plod: their rules speed, without the field pace or their ground's boost. */
const BEARER_PACE = 1

/** A unit falls back at this share of its pace. */
const RETREAT_SPEED = 0.8
/** Facing for a rider backing up its line, toward the portal. */
const YAW_UP = Math.PI

/** PACKET LOSS: when a spike clears, hostiles surge this many times faster (for `LAG_CATCH_UP_MS`). */
const LAG_CATCH_UP_SPEED = 4

/** The share of its speed at which a rider stood off its line eases back onto it, when there is room. */
const LANE_RETURN = 0.5

/** How close to its stop line a demo unit counts as there: `walkTo` settles within 3. */
const PUPPET_SETTLE = 4

/**
 * How hostiles get about: riding the data lines light-cycle style,
 * flying straight in, and walking open ground to a post.
 */
export class Movement {
    constructor(private readonly game: HackerzGame) {}

    /** The data lines ground hostiles ride. Rebuilt each run. */
    network: DataNetwork = { nodes: [], traces: [] }

    /**
     * Walks a unit straight over open ground toward a point. Bearers plod at
     * their own slow pace; anything else moves as it would on the lines.
     * Returns the distance covered.
     */
    walkTo(enemy: EnemyEntity, u: number, d: number, dt: number) {
        const du = u - enemy.u
        const dd = d - enemy.d
        const distance = Math.hypot(du, dd)
        if (distance < 3) {
            enemy.yaw = turnToward(enemy.yaw, YAW_DOWN, dt * 8)
            return 0
        }
        const pace = enemy.bearer ? BEARER_PACE : ENEMY_PACE * this.groundSpeed(enemy)
        // A bodyguard keeps up with its hacker, however slow it is itself.
        const speed = enemy.escorting ? Math.max(enemy.speed, enemy.escorting.speed * ESCORT_CATCH_UP) : enemy.speed
        const step = Math.min(distance, speed * pace * dt)
        enemy.u += du / distance * step
        enemy.d += dd / distance * step
        enemy.yaw = turnToward(enemy.yaw, Math.atan2(du, -dd), dt * 10)
        return step
    }

    /**
     * A demo unit walks the waypoints its script gave it instead of thinking
     * for itself, but the board still has its say: a honeypot in range draws
     * it in, a proxy wall stops it at its line, and the fence stops it at its
     * standoff. Arrived once it is where its blows land.
     */
    puppetStep(enemy: EnemyEntity, goal: RouteGoal, hold: Hold | null, dt: number) {
        // Held at a proxy wall's line, the crowd behind cannot shove it through.
        if (hold && hold.target.kind !== 'honeypot') enemy.d = Math.max(enemy.d, goal.stopD)
        // `walkTo` settles a step short of its mark, so the line counts from just behind it.
        if (goal.near?.(enemy.u, enemy.d) || enemy.d <= goal.stopD + PUPPET_SETTLE) return { moved: 0, arrived: true }
        if (hold?.target.kind === 'honeypot') return { moved: this.walkTo(enemy, hold.target.u, hold.target.d, dt), arrived: false }
        const path = enemy.demoPath!
        while (path.length > 1 && Math.hypot(path[0]!.u - enemy.u, path[0]!.d - enemy.d) < 3) path.shift()
        const next = path[0]
        if (!next) return { moved: 0, arrived: false }
        return { moved: this.walkTo(enemy, next.u, Math.max(next.d, goal.stopD), dt), arrived: false }
    }

    /**
     * Backs a rider up its own line, toward the portal: the one time a unit
     * moves away from the fence. It stops where its line began.
     */
    fallBack(enemy: EnemyEntity, dt: number) {
        const route = enemy.route
        if (!route) return 0
        let budget = enemy.speed * ENEMY_PACE * RETREAT_SPEED * dt
        let moved = 0
        let facing = YAW_UP
        for (let corner = 0; corner < 6 && budget > 1e-4; corner++) {
            const back = route[enemy.routeSeg]
            if (!back) break
            const du = back.u - enemy.u
            const dd = back.d - enemy.d
            if (Math.abs(du) + Math.abs(dd) < 0.01) {
                if (enemy.routeSeg === 0) break
                enemy.routeSeg--
                continue
            }
            const across = Math.abs(du) > Math.abs(dd)
            facing = across ? (du > 0 ? YAW_RIGHT : YAW_LEFT) : YAW_UP
            const step = Math.min(Math.abs(across ? du : dd), budget)
            if (across) enemy.u += Math.sign(du) * step
            else enemy.d += Math.sign(dd) * step
            budget -= step
            moved += step
        }
        enemy.yaw = turnToward(enemy.yaw, facing, dt * 16)
        return moved
    }

    /**
     * Ground units ride the data lines; flyers and a burrowed ROOTKIT do not.
     * Once every node is theirs the lines no longer matter: everything charges
     * straight over their ground for the wall.
     */
    ridesNetwork(enemy: EnemyEntity) {
        // Packet loss keeps the light units on the lines: the lag is the threat
        // there, not a charge. The heavies are too big for the corners and go straight.
        return !hackerzIsAirborne(enemy.def) && enemy.burrowMs <= 0 && !enemy.demoPath
            && (!this.allNodesTaken || (this.game.bonus === 'packetloss' && !this.game.spawner.isHeavy(enemy.def)))
    }

    /** Whether a rider stands on the segment of its route it thinks it is on. */
    private onRoute(enemy: EnemyEntity) {
        const a = enemy.route?.[enemy.routeSeg]
        if (!a) return false
        const b = enemy.route![enemy.routeSeg + 1] ?? a
        // Within the slack a rider may stand off its line (see `LANE_SLACK`).
        const slack = LANE_SLACK + 1
        return enemy.u >= Math.min(a.u, b.u) - slack && enemy.u <= Math.max(a.u, b.u) + slack
            && enemy.d >= Math.min(a.d, b.d) - slack && enemy.d <= Math.max(a.d, b.d) + slack
    }

    /** Every path node is in their hands. */
    get allNodesTaken() {
        const chips = this.game.pathChips?.chips ?? []
        return chips.length > 0 && chips.every(chip => chip.state === 'hacked')
    }

    /** The network layer of a path node: 1 for the outermost. */
    private chipLayer(chip: PathChip) {
        return (this.game.pathChips?.ordered.indexOf(chip) ?? -1) + 1
    }

    /** Whether a path node is still ahead of a rider: at or past the node its line runs to. */
    chipAhead(enemy: EnemyEntity, chip: PathChip) {
        const node = this.network.nodes[enemy.routeTo]
        if (!enemy.route || !node) return true
        return this.chipLayer(chip) >= node.layer
    }

    /** Whether the rest of a rider's line passes within `radius` of a point. */
    routeAheadPasses(enemy: EnemyEntity, u: number, d: number, radius: number) {
        if (!enemy.route) return false
        const ahead = [{ u: enemy.u, d: enemy.d }, ...enemy.route.slice(enemy.routeSeg + 1)]
        return tracePassesNear({ points: ahead, from: -1, to: -1 }, u, d, radius)
    }

    /**
     * A new ground unit comes out of one of the portal's sockets and takes a
     * line from it. Bodies are solid, so it takes the socket where it can
     * stand clear closest to the field: an empty one if there is one, else it
     * falls in behind the last body queued at the least backed-up socket.
     */
    enterFromPortal(enemy: EnemyEntity) {
        const sources = this.network.nodes.map((node, index) => ({ node, index })).filter(s => s.node.kind === 'source')
        if (!sources.length) return
        const wanted = enemy.d
        const clearAt = (u: number, from: number) => {
            let d = from
            // Step back past whatever stands on this column, until it is clear.
            for (let guard = 0; guard < 40; guard++) {
                enemy.u = u
                enemy.d = d
                const blocker = this.game.enemies.find(o => !hackerzIsAirborne(o.def) && o.hp > 0 && sinkInto(enemy, u, d, o) > 0)
                if (!blocker) return d
                d = blocker.d + footprint(blocker).d + footprint(enemy).d + CROWD_GAP
            }
            return d
        }
        // A random first pick, so ties spread across the sockets.
        const start = Math.floor(randomFloat() * sources.length)
        let best: { node: typeof sources[number]['node'], index: number, d: number } | null = null
        for (let k = 0; k < sources.length; k++) {
            const source = sources[(start + k) % sources.length]!
            const d = clearAt(source.node.u, Math.max(wanted, source.node.d))
            if (!best || d < best.d) best = { ...source, d }
        }
        const { node, index } = best!
        enemy.u = node.u
        enemy.d = best!.d
        enemy.route = [{ u: node.u, d: enemy.d }, { u: node.u, d: node.d }]
        enemy.routeSeg = 0
        enemy.routeTo = index
        enemy.routeFrom = index
    }

    /**
     * Puts a unit back on the nearest line, riding on toward that line's end.
     * It walks there — across, then along — rather than snapping onto it:
     * bodies are solid, and the line may have someone on it.
     */
    attachToNetwork(enemy: EnemyEntity) {
        const on = nearestOnNetwork(this.network, enemy.u, enemy.d)
        if (!on) {
            enemy.route = null
            enemy.routeTo = -1
            return
        }
        enemy.route = [
            { u: enemy.u, d: enemy.d },
            { u: on.u, d: enemy.d },
            { u: on.u, d: on.d },
            ...on.trace.points.slice(on.seg + 1)
        ]
        enemy.routeSeg = 0
        enemy.routeTo = on.trace.to
        enemy.routeFrom = on.trace.from
    }

    /**
     * At the end of a line: pick the next trace out of the node. A live
     * honeypot on one of them wins; otherwise the one that gets nearest the
     * node this unit is after without passing it, and any of them when it is
     * after nothing. The route runs across the node's face from the pin it
     * came in on to the pin the new trace leaves from.
     */
    private chooseNext(enemy: EnemyEntity) {
        const node = this.network.nodes[enemy.routeTo]
        const out = node?.out ?? []
        const here: LinePoint = { u: enemy.u, d: enemy.d }
        if (!node || !out.length) {
            // Off the end of the board: straight on for the fence.
            enemy.route = [here, { u: enemy.u, d: 0 }]
            enemy.routeSeg = 0
            enemy.routeTo = -1
            enemy.routeFrom = -1
            return
        }
        const random = (list: Trace[]) => list[Math.floor(randomFloat() * list.length)]!
        const pots = this.game.deployables?.items.filter(item => item.kind === 'honeypot' && item.hp > 0) ?? []
        const lured = out.filter(trace => pots.some(pot => tracePassesNear(trace, pot.u, pot.d, LURE_TRACE_RADIUS)))
        let trace: Trace
        if (lured.length) {
            trace = random(lured)
        } else {
            const ordered = this.game.pathChips?.ordered ?? []
            // A hacker heads for its own pick; failing that, the next open node.
            const own = enemy.targetChip
            const picked = own && own.state !== 'hacked' && this.chipLayer(own) > node.layer ? own : undefined
            const target = this.game.hacking.canHack(enemy)
                ? picked ?? ordered.find((chip, i) => i + 1 > node.layer && chip.state !== 'hacked')
                : undefined
            const limit = target ? this.chipLayer(target) : Infinity
            const fits = out.filter(t => (this.network.nodes[t.to]?.layer ?? 0) <= limit)
            const best = Math.max(...fits.map(t => this.network.nodes[t.to]?.layer ?? 0))
            trace = fits.length && target ? random(fits.filter(t => this.network.nodes[t.to]?.layer === best)) : random(out)
        }
        const exit = trace.points[0]!
        enemy.route = node.kind === 'node'
            ? [here, { u: here.u, d: node.d }, { u: exit.u, d: node.d }, ...trace.points]
            : [here, ...trace.points]
        enemy.routeSeg = 0
        enemy.routeFrom = enemy.routeTo
        enemy.routeTo = trace.to
    }

    /**
     * A hacker with no open node left ahead on its lines goes looking for one
     * instead of heading for the fence: back along its own line to where it
     * started, then trace by trace — either way along a trace, up as readily
     * as down — to the nearest node still open. The fence's end-points are
     * dead ends and never part of the way. True when a route was laid.
     */
    planDetour(enemy: EnemyEntity, target: PathChip) {
        const network = this.network
        const goal = network.nodes.findIndex(n => n.kind === 'node' && n.u === target.u && n.d === target.d)
        const start = enemy.routeFrom
        if (goal < 0 || start < 0 || !enemy.route) return false
        const via = new Map<number, { node: number, trace: Trace, forward: boolean }>()
        const seen = new Set([start])
        const queue = [start]
        while (queue.length && !seen.has(goal)) {
            const at = queue.shift()!
            for (const trace of network.traces) {
                const forward = trace.from === at
                const next = forward ? trace.to : trace.to === at ? trace.from : -1
                if (next < 0 || seen.has(next)) continue
                if (network.nodes[next]?.kind === 'sink') continue
                seen.add(next)
                via.set(next, { node: at, trace, forward })
                queue.push(next)
            }
        }
        if (!seen.has(goal)) return false
        const steps: { node: number, trace: Trace, forward: boolean }[] = []
        for (let at = goal; at !== start;) {
            const step = via.get(at)!
            steps.unshift(step)
            at = step.node
        }
        // Back down its own line to where it began, then the found way.
        const points: LinePoint[] = [{ u: enemy.u, d: enemy.d }]
        for (let s = enemy.routeSeg; s >= 0; s--) points.push(enemy.route[s]!)
        for (const step of steps) {
            const line = step.forward ? step.trace.points : [...step.trace.points].reverse()
            const last = points[points.length - 1]!
            const first = line[0]!
            // Across the node's face, from where it stands to where the next trace leaves.
            const node = network.nodes[step.node]!
            if (last.u !== first.u || last.d !== first.d) points.push({ u: last.u, d: node.d }, { u: first.u, d: node.d })
            points.push(...line)
        }
        enemy.route = points
        enemy.routeSeg = 0
        enemy.routeFrom = steps.length ? steps[steps.length - 1]!.node : start
        enemy.routeTo = goal
        return true
    }

    /**
     * Moves a rider along its line toward `goal`, light-cycle style: straight
     * runs and hard turns, left, right or down — never up. A frame's movement
     * may take a corner, or a whole node, part-way through.
     */
    ride(enemy: EnemyEntity, goal: RouteGoal, dt: number) {
        const boost = this.groundSpeed(enemy) * (enemy.def.kind === 'bomber' ? SAPPER_SPEED : 1)
        let budget = enemy.speed * this.game.hacking.chipBuff(enemy) * this.game.pushSpeed * boost * dt
        // A skirmisher halts at the edge of blue ground rather than step into it.
        // One already standing in blue (the ground changed under it) carries on.
        const keepOut = this.game.squads.keepsOutOfBlue(enemy) && this.game.territory.zoneOf(enemy.u, enemy.d) !== 'held'
        // A boosted rider leaves a thin red trail, so the fast lane reads as one.
        if (boost > 1 && Math.random() < dt * 14) {
            this.game.particles.emit(enemyWorld(enemy, 3, _v), _w.set(0, 0.4, 0), RED, { size: 0.16, life: 0.35, gravity: 0 })
        }
        let moved = 0
        let arrived = false
        let facing = YAW_DOWN
        for (let guard = 0; guard < 12; guard++) {
            if (goal.near?.(enemy.u, enemy.d) || enemy.d <= goal.stopD) {
                arrived = true
                break
            }
            // No line yet, or knocked off it while the lines did not matter (a
            // node reclaimed after the charge began): drop onto the nearest one.
            if (!enemy.route || !this.onRoute(enemy)) {
                this.attachToNetwork(enemy)
                if (!enemy.route) break
            }
            const from = enemy.route[enemy.routeSeg]!
            const next = enemy.route[enemy.routeSeg + 1]
            if (!next) {
                this.chooseNext(enemy)
                continue
            }
            // Progress is measured along the stretch only: a rider standing off
            // its line (stepped round a body, or beside one) keeps that offset
            // and takes the corner where it is.
            const across = Math.abs(next.u - from.u) >= 0.01
            const way = across ? Math.sign(next.u - from.u) : Math.sign(next.d - from.d)
            const left = across ? (next.u - enemy.u) * way : (next.d - enemy.d) * way
            if (left < 0.01) {
                enemy.routeSeg++
                continue
            }
            // Lines run down toward the fence; only a hacker's detour climbs one.
            const down = !across && way < 0
            facing = across ? (way > 0 ? YAW_RIGHT : YAW_LEFT) : down ? YAW_DOWN : YAW_UP
            if (budget <= 1e-4) break
            let step = Math.min(left, budget)
            // Never run down past a stop: the fence's standoff, or a proxy wall.
            if (down) step = Math.min(step, Math.max(0, enemy.d - goal.stopD))
            if (step <= 0) {
                arrived = true
                break
            }
            if (keepOut) {
                const nu = across ? enemy.u + way * step : enemy.u
                const nd = across ? enemy.d : enemy.d + way * step
                if (this.game.territory.zoneOf(nu, nd) === 'held') break
            }
            if (across) enemy.u += way * step
            else enemy.d += way * step
            budget -= step
            moved += step
        }
        // Off its line, it eases back onto it whenever that does not walk it into anyone.
        const leg = this.game.crowd.legOf(enemy)
        if (leg && !arrived) {
            const off = leg.vertical ? enemy.u - leg.from.u : enemy.d - leg.from.d
            const back = Math.min(Math.abs(off), enemy.speed * this.game.pushSpeed * LANE_RETURN * dt) * Math.sign(off)
            if (back !== 0) {
                const u = leg.vertical ? enemy.u - back : enemy.u
                const d = leg.vertical ? enemy.d : enemy.d - back
                if (!this.game.crowd.sinksDeeper(enemy, u, d)) {
                    enemy.u = u
                    enemy.d = d
                    moved += Math.abs(back)
                }
            }
        }
        // The turn itself is fast but not instant, so a corner reads as a corner.
        enemy.yaw = turnToward(enemy.yaw, facing, dt * 16)
        return { moved, arrived }
    }

    /** Flyers (and a burrowed ROOTKIT) go straight for their stop, over the lines. */
    fly(enemy: EnemyEntity, goal: RouteGoal, dt: number) {
        enemy.yaw = turnToward(enemy.yaw, YAW_DOWN, dt * 16)
        if (goal.near?.(enemy.u, enemy.d)) return { moved: 0, arrived: true }
        const room = enemy.d - goal.stopD
        if (room <= 0) {
            enemy.d = goal.stopD
            return { moved: 0, arrived: true }
        }
        const step = Math.min(room, enemy.speed * this.game.hacking.chipBuff(enemy) * this.game.pushSpeed * this.groundSpeed(enemy)
            * (enemy.burrowMs > 0 ? 1.8 : 1) * (enemy.def.kind === 'bomber' ? SAPPER_SPEED : 1) * dt)
        // Flying skirmishers hold at the edge of blue ground too.
        if (this.game.squads.keepsOutOfBlue(enemy) && this.game.territory.zoneOf(enemy.u, enemy.d) !== 'held'
            && this.game.territory.zoneOf(enemy.u, enemy.d - step) === 'held') return { moved: 0, arrived: false }
        enemy.d -= step
        return { moved: step, arrived: false }
    }

    /**
     * Their own ground is a fast lane: once they hold a node, anything riding
     * through red ground — from the portal up to the nodes they have taken —
     * moves at double speed.
     */
    private groundSpeed(enemy: EnemyEntity) {
        // PACKET LOSS: straight after a spike everything surges to catch up.
        const surge = this.game.lag.lagCatchUpMs > 0 ? LAG_CATCH_UP_SPEED : 1
        const taken = this.game.pathChips?.chips.some(chip => chip.state === 'hacked')
        if (!taken || enemy.burrowMs > 0) return surge
        return (this.game.territory.zoneOf(enemy.u, enemy.d) === 'theirs' ? THEIR_GROUND_SPEED : 1) * surge
    }
}
