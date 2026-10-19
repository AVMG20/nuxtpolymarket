import * as THREE from 'three'
import { randomChance, randomFloat } from '../rng'
import { HACKERZ_HACKER_ID } from '#shared/utils/gamelogic/hackerz'
import { FIELD_DEPTH, FIELD_HALF_WIDTH } from '../constants'
import { clamp, segPointDist } from '../math'
import { CHIP_HIT_RADIUS, type PathChip } from '../path-chips'
import { zapTarget, type Trace } from '../data-lines'
import { hdr } from '../models'
import { MOTION, turnToward } from '../rig-motion'
import { CYAN, RED, fieldToWorld } from '../scene'
import type { BulletEntity, EnemyEntity } from '../types'
import { PER_WORLD, _w, CROWD_GAP, HACK_TEAM, YAW_DOWN } from './tuning'
import { enemyWorld, halfExtents, placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** How many open nodes the hackers split across at once. */
const HACK_FRONTS = 2

/** Hacker zap-dodge: how far ahead a round is seen, the odds of dodging it, the jump range, and the recharge. */
const ZAP_SIGHT = 150
const ZAP_CHANCE = 0.55
const ZAP_MIN = 45
const ZAP_MAX = 170
const ZAP_COOLDOWN_MS = 2600

/**
 * Hackers park side by side in a row behind a node (portal side), facing
 * the fence: the row this far behind it, this many slots either side of the
 * middle. One within this distance of its node leaves the line to park.
 */
const HACK_ROW_BACK = 70
const HACK_SLOT_SIDE = 2
const HACK_PARK_FROM = 280

/** How much of a node a hack pulse takes (how often they fly is `MOTION.hackPulseMs`). */
const HACK_PULSE_AMOUNT = 0.09

/**
 * Nodes out by the portal are poorly defended and fall fast; the closer to the
 * fence, the longer one holds out. A pulse's take is scaled from the first
 * figure (right at the portal: a third of the old hack time) down to the second
 * (at the fence: the old hack time, and never slower).
 */
const HACK_EASE_FAR = 1.5
const HACK_EASE_NEAR = 0.5

/**
 * The blue pulse a round knocks out of a hacked node: strength it loses per
 * field unit on each kind of ground (it starts at 1), how many nodes on it can
 * fan out through, and the most that may run at once.
 */
const LINE_PULSE_FADE = { held: 1 / 1400, contested: 1 / 550, theirs: 1 / 170 }
const LINE_PULSE_HOPS = 1
const LINE_PULSE_MAX = 24

/**
 * The fight over the path nodes: which node a hacker goes for, how it
 * parks and hacks it, and the player taking nodes back.
 */
export class Hacking {
    constructor(private readonly game: HackerzGame) {}

    /** Hack pulses in flight from a terminal to its node: they count when they land. */
    private hackPulses: { chip: PathChip, from: THREE.Vector3, to: THREE.Vector3, t: number, mesh: THREE.Mesh }[] = []

    private pulseGeometry = new THREE.OctahedronGeometry(0.34, 0)

    private pulseMaterial = new THREE.MeshBasicMaterial({ color: hdr(0xff3b3b, 3), toneMapped: false })

    /**
     * The parking row's measures, from a hacker's own size: how far apart
     * the slots are (room to swing round between two parked neighbours), and
     * how far behind the row the lane runs (room to drive past them, and to
     * turn in).
     */
    private parkingRow(enemy: EnemyEntity) {
        const { x: halfX, z: halfZ } = halfExtents(enemy.rig.box)
        // Half its extent at its widest, mid-turn.
        const swing = Math.SQRT1_2 * (halfX + halfZ)
        return { spacing: swing + halfX + CROWD_GAP * 2, lane: halfZ + swing + CROWD_GAP * 3 }
    }

    /** Where parking slot `index` (−HACK_SLOT_SIDE … HACK_SLOT_SIDE) behind a node lies. */
    private slotAt(enemy: EnemyEntity, node: PathChip, index: number) {
        return { u: node.u + index * this.parkingRow(enemy).spacing, d: node.d + HACK_ROW_BACK }
    }

    /**
     * A hacker's slot at its node: kept once taken. The first to arrive takes
     * the slot nearest it; each after takes the free slot next to one already
     * taken, nearest it — so they park side by side. Null with none free.
     */
    private hackSlotFor(enemy: EnemyEntity, node: PathChip) {
        if (enemy.hackSlot?.chip === node) return enemy.hackSlot
        const taken = new Set(this.game.enemies.filter(e => e !== enemy && e.hackSlot?.chip === node).map(e => e.hackSlot!.index))
        let best: number | null = null
        let bestDistance = Infinity
        for (let index = -HACK_SLOT_SIDE; index <= HACK_SLOT_SIDE; index++) {
            if (taken.has(index)) continue
            if (taken.size && !taken.has(index - 1) && !taken.has(index + 1)) continue
            const spot = this.slotAt(enemy, node, index)
            if (Math.abs(spot.u) > FIELD_HALF_WIDTH - 20) continue
            const distance = Math.hypot(spot.u - enemy.u, spot.d - enemy.d)
            if (distance < bestDistance) {
                bestDistance = distance
                best = index
            }
        }
        enemy.hackSlot = best === null ? null : { chip: node, index: best, stage: 'lane' }
        return enemy.hackSlot
    }

    /**
     * A hacker near its node parks in its slot, smoothly and from behind:
     * onto the lane behind the row (round the end of the row if it is in
     * front of it), along the lane past the ones already parked to its slot,
     * then it turns to face the fence and pulls straight in. Null while it is
     * still too far off, or no slot is free.
     */
    parkStep(enemy: EnemyEntity, node: PathChip, dt: number) {
        const from = Math.hypot(enemy.u - node.u, enemy.d - node.d)
        // Thrown well clear (a zap, a shove) it gives the slot up and rides back on the lines.
        if (from > HACK_PARK_FROM + (enemy.hackSlot?.chip === node ? 80 : 0)) {
            enemy.hackSlot = null
            return null
        }
        const slot = this.hackSlotFor(enemy, node)
        if (!slot) return null
        const row = this.parkingRow(enemy)
        const spot = this.slotAt(enemy, node, slot.index)
        const laneD = spot.d + row.lane
        if (slot.stage === 'in') {
            if (Math.hypot(spot.u - enemy.u, spot.d - enemy.d) < 3) {
                enemy.yaw = turnToward(enemy.yaw, YAW_DOWN, dt * 8)
                return { moved: 0, arrived: true }
            }
            return { moved: this.game.movement.walkTo(enemy, spot.u, spot.d, dt), arrived: false }
        }
        if (slot.stage === 'turn') {
            enemy.yaw = turnToward(enemy.yaw, YAW_DOWN, dt * 6)
            if (Math.abs(Math.atan2(Math.sin(enemy.yaw - YAW_DOWN), Math.cos(enemy.yaw - YAW_DOWN))) < 0.03) slot.stage = 'in'
            return { moved: 0, arrived: false }
        }
        // On the lane, level with its slot: turn in.
        if (Math.abs(enemy.u - spot.u) < 3 && Math.abs(enemy.d - laneD) < 3) {
            slot.stage = 'turn'
            return { moved: 0, arrived: false }
        }
        // Level with the row or in front of it: round the end of the row
        // first, never through it. Between the row and the lane: back onto the lane.
        const rowEnd = (HACK_SLOT_SIDE + 1) * row.spacing
        if (enemy.d < spot.d + row.lane / 2) {
            const side = Math.sign(enemy.u - node.u) || 1
            if (Math.abs(enemy.u - node.u) < rowEnd - 3) {
                return { moved: this.game.movement.walkTo(enemy, node.u + side * rowEnd, enemy.d, dt), arrived: false }
            }
            return { moved: this.game.movement.walkTo(enemy, enemy.u, laneD, dt), arrived: false }
        }
        // Behind it: down onto the lane, then along it to the slot.
        if (enemy.d > laneD + 3) return { moved: this.game.movement.walkTo(enemy, enemy.u, laneD, dt), arrived: false }
        return { moved: this.game.movement.walkTo(enemy, spot.u, laneD, dt), arrived: false }
    }

    /** ×1.25 on speed and damage for a hostile inside a hacked node's aura. */
    chipBuff(enemy: EnemyEntity) {
        return this.game.pathChips?.buffedAt(enemy.u, enemy.d) ? 1.25 : 1
    }

    /**
     * Who goes for the path nodes: the green hackers, and only them. They keep
     * at it through the final push — there is always someone on the nodes —
     * while everything else heads for the fence.
     */
    canHack(enemy: EnemyEntity) {
        return this.game.running && !this.game.purging && enemy.def.id === HACKERZ_HACKER_ID && !enemy.decoy && !enemy.demoPath
            && enemy.burrowMs <= 0 && enemy.age > 0.4
    }

    /**
     * The node a hacker works on. Hackers spread over the two nearest nodes
     * still open ahead of them, each picking whichever has fewer hackers on
     * it, and stick with their pick until it falls — so the swarm splits into
     * two fronts instead of piling onto one.
     */
    hackTarget(enemy: EnemyEntity) {
        const chips = this.game.pathChips
        if (!chips) return null
        // While the first node still stands it blocks the whole board, and the
        // hackers throw in on it together, a few at a time (`HACK_TEAM`). One
        // that finds every terminal taken pushes on to a node further forward
        // instead — taking a hostage along as a shield (see `maintainEscorts`) —
        // and sticks with it.
        const gate = chips.ordered[0]
        if (gate && gate.state !== 'hacked' && this.game.movement.chipAhead(enemy, gate)) {
            const pick = enemy.targetChip
            if (pick && pick !== gate && pick.state !== 'hacked' && this.game.movement.chipAhead(enemy, pick)) return pick
            const team = this.game.enemies.filter(e => e !== enemy && e.hacking && e.targetChip === gate).length
            if (enemy.hacking || team < HACK_TEAM) {
                enemy.targetChip = gate
                return gate
            }
            const forward = chips.ordered.find(chip => chip !== gate && chip.state !== 'hacked' && this.game.movement.chipAhead(enemy, chip))
            enemy.targetChip = forward ?? gate
            return enemy.targetChip
        }
        const open = chips.ordered
            .filter(chip => chip.state !== 'hacked' && this.game.movement.chipAhead(enemy, chip))
            .slice(0, HACK_FRONTS)
        if (!open.length) {
            enemy.targetChip = null
            return null
        }
        if (enemy.targetChip && open.includes(enemy.targetChip)) return enemy.targetChip
        const crowd = (chip: PathChip) => this.game.enemies.filter(e => e !== enemy && e.targetChip === chip).length
        enemy.targetChip = open.reduce((best, chip) => crowd(chip) < crowd(best) ? chip : best)
        return enemy.targetChip
    }

    /**
     * A hacker about to take one of the player's rounds may zap sideways onto
     * another data line — never further from the fence — with a green arc
     * marking the jump. It cannot do it again for a while, and does not always
     * see the round coming.
     */
    dodge(enemy: EnemyEntity, dtMs: number) {
        enemy.zapCooldown -= dtMs
        if (enemy.zapCooldown > 0 || this.game.combat.untouchable(enemy)) return
        const threatened = this.game.projectiles.bullets.some((bullet) => {
            if (bullet.fromTurret || bullet.hit.has(enemy)) return false
            const speed = Math.hypot(bullet.vu, bullet.vd)
            if (speed < 1) return false
            const ru = enemy.u - bullet.u
            const rd = enemy.d - bullet.d
            const along = (ru * bullet.vu + rd * bullet.vd) / speed
            if (along < 0 || along > ZAP_SIGHT) return false
            return Math.abs(ru * bullet.vd - rd * bullet.vu) / speed < enemy.radius + 24
        })
        if (!threatened) return
        if (!randomChance(ZAP_CHANCE)) {
            // Saw it too late: no second guess on the same round.
            enemy.zapCooldown = 700
            return
        }
        const to = zapTarget(this.game.movement.network, enemy.u, enemy.d, ZAP_MIN, ZAP_MAX)
        if (!to) return
        const from = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        if (enemy.hacking) this.stopHacking(enemy)
        enemy.u = to.u
        enemy.d = to.d
        enemy.route = to.trace.points
        enemy.routeSeg = to.seg
        enemy.routeTo = to.trace.to
        enemy.routeFrom = to.trace.from
        enemy.zapCooldown = ZAP_COOLDOWN_MS
        const landed = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.game.transient?.bolt(from, landed, enemy.def.hex)
        this.game.particles.burst(from, enemy.def.hex, 12, 6, { size: 0.24, life: 0.35 })
        this.game.particles.burst(landed, enemy.def.hex, 16, 7, { size: 0.26, life: 0.4 })
        placeEnemy(enemy)
    }

    /** A unit in reach of a node hacks it: a terminal opens beside it and fires pulses into the node. */
    hackAt(enemy: EnemyEntity, node: PathChip, dtMs: number) {
        const terminal = this.game.terminals?.open(enemy)
        enemy.hacking = true
        if (terminal) {
            // The panel floats above the unit, staggered by its reach so a
            // queue's terminals do not stack into one.
            enemyWorld(enemy, enemy.rig.height * PER_WORLD + 40 + enemy.hackReach * 24, terminal.position)
            terminal.position.x += (enemy.u >= node.u ? 1 : -1) * 1.2
            // A terminal glowing in the dark would give its hacker away.
            terminal.visible = enemy.rig.root.visible && this.game.territory.shroudOf(enemy) < 0.5
        }
        enemy.pulseTimer -= dtMs
        if (enemy.pulseTimer <= 0) {
            enemy.pulseTimer = MOTION.hackPulseMs * (0.85 + randomFloat() * 0.3)
            if (terminal?.visible) this.fireHackPulse(node, terminal.position)
            else this.landPulse(node)
        }
    }

    stopHacking(enemy: EnemyEntity) {
        enemy.hacking = false
        this.game.terminals?.close(enemy)
    }

    /** A pulse leaves a terminal for its node; it counts when it arrives. */
    private fireHackPulse(node: PathChip, from: THREE.Vector3) {
        const mesh = new THREE.Mesh(this.pulseGeometry, this.pulseMaterial)
        mesh.position.copy(from)
        this.game.fieldRoot.add(mesh)
        this.hackPulses.push({ chip: node, from: from.clone(), to: fieldToWorld(node.u, node.d, 0.5, new THREE.Vector3()), t: 0, mesh })
        this.game.particles.burst(from, 0xff3b3b, 3, 3, { size: 0.16, life: 0.2, gravity: 0 })
    }

    updateHackPulses(dt: number) {
        for (let i = this.hackPulses.length - 1; i >= 0; i--) {
            const pulse = this.hackPulses[i]!
            pulse.t += dt / MOTION.hackPulseFlight
            if (pulse.t >= 1) {
                pulse.mesh.removeFromParent()
                this.hackPulses.splice(i, 1)
                this.game.particles.burst(pulse.to, 0xff3b3b, 4, 5, { size: 0.18, life: 0.25 })
                this.landPulse(pulse.chip)
                continue
            }
            // A shallow arc, spinning as it goes.
            pulse.mesh.position.lerpVectors(pulse.from, pulse.to, pulse.t)
            pulse.mesh.position.y += Math.sin(pulse.t * Math.PI) * MOTION.hackPulseArc
            pulse.mesh.rotation.y += dt * 12
            if (randomChance(dt * 30)) this.game.particles.emit(pulse.mesh.position, _w.set(0, 0, 0), 0xff3b3b, { size: 0.12, life: 0.18, gravity: 0 })
        }
    }

    /** A pulse lands. The one that takes the node is announced. */
    private landPulse(node: PathChip) {
        const chips = this.game.pathChips
        if (!chips) return
        const wasAlert = node.alert
        const depth = clamp(node.d / FIELD_DEPTH, 0, 1)
        const taken = chips.landPulse(node, HACK_PULSE_AMOUNT * (HACK_EASE_NEAR + (HACK_EASE_FAR - HACK_EASE_NEAR) * depth))
        if (!taken) {
            if (!wasAlert && node.alert) {
                this.game.sysLog.chipUnderAttack(node.id, this.game.enemies.filter(e => e.hacking && e.targetChip === node).length || 1)
            }
            return
        }
        const next = chips.ordered.find(chip => chip.state !== 'hacked')
        this.game.sysLog.chipCaptured(node.id, next ? next.id : null)
        const at = fieldToWorld(node.u, node.d, 0.3, new THREE.Vector3())
        this.game.view?.addSurge(at.x, at.z, RED, 1.6)
        this.game.transient?.ring(at, RED, 6, 0.55)
        this.game.particles.burst(at, RED, 40, 10, { size: 0.32, life: 0.7 })
        this.game.overlay.floatText(at, 'NODE COMPROMISED', RED, 1.3)
        this.game.addShake(4)
        this.game.callbacks.onNotice('A path node was hacked — shoot it to reclaim it.', 'bad')
        // A logic bomb wired onto it goes off under the crew that just took it.
        for (const blast of this.game.deployables?.detonateOnChip(node.id) ?? []) this.game.deployer.detonateBlast(blast)
        // The units on it re-target on their next step and march on to the next node.
    }

    clearHacking() {
        this.game.terminals?.clear()
        for (const pulse of this.hackPulses) pulse.mesh.removeFromParent()
        this.hackPulses = []
        for (const enemy of this.game.enemies) enemy.hacking = false
    }

    /**
     * A player round that reaches a hacked node strikes it and is spent there:
     * it chips away at the node, and knocks a blue pulse out along every data
     * line the node is wired to. True when the round struck one.
     */
    roundThroughChips(bullet: BulletEntity) {
        const chips = this.game.pathChips
        if (!chips) return false
        for (const chip of chips.chips) {
            if (chip.state !== 'hacked' || bullet.chipsHit?.has(chip.id)) continue
            if (segPointDist(bullet.prevU, bullet.prevD, bullet.u, bullet.d, chip.u, chip.d) > CHIP_HIT_RADIUS) continue
            ;(bullet.chipsHit ??= new Set()).add(chip.id)
            const at = fieldToWorld(chip.u, chip.d, 0.4, new THREE.Vector3())
            // A DDoS-locked node shrugs the round off in red: there is no taking it back.
            this.game.particles.burst(at, chips.locked ? RED : CYAN, 6, 7, { size: 0.22, life: 0.3 })
            this.pulseFromChip(chip)
            if (chips.hit(chip)) this.chipReclaimed(chip)
            return true
        }
        return false
    }

    /** A hacked node came back to us: it pays, and shows it. */
    chipReclaimed(chip: PathChip) {
        const at = fieldToWorld(chip.u, chip.d, 0.4, new THREE.Vector3())
        const reward = 15 + this.game.wave * 8
        this.game.scoring.waveCredits += reward
        this.game.callbacks.onCredits(reward, 'kill')
        this.game.view?.addSurge(at.x, at.z, CYAN, 1.6)
        this.game.transient?.ring(at, CYAN, 6, 0.55)
        this.game.particles.burst(at, CYAN, 34, 10, { size: 0.32, life: 0.7 })
        this.game.overlay.floatText(at, `RECLAIMED +${reward}`, CYAN, 1.3)
        this.game.sysLog.chipReclaimed(chip.id)
        this.game.callbacks.onSound?.('coin-pickup')
    }

    /**
     * Sends blue pulses out of a struck node along every line wired to it, in
     * and out. A pulse that still has strength when it reaches the next node
     * fans out once more from there.
     */
    pulseFromChip(chip: PathChip) {
        const pulses = this.game.linePulses
        if (!pulses) return
        const nodes = this.game.movement.network.nodes
        const index = nodes.findIndex(node => node.kind === 'node' && Math.abs(node.u - chip.u) < 1 && Math.abs(node.d - chip.d) < 1)
        if (index < 0) return
        const fan = (from: number, strength: number, hops: number, cameBy: Trace | null) => {
            for (const trace of this.game.movement.network.traces) {
                if (trace === cameBy || pulses.count >= LINE_PULSE_MAX) continue
                const outward = trace.from === from
                if (!outward && trace.to !== from) continue
                const path = outward ? trace.points : [...trace.points].reverse()
                const next = outward ? trace.to : trace.from
                pulses.send(path, strength, hops > 0 && nodes[next]?.kind === 'node'
                    ? (left: number) => fan(next, left, hops - 1, trace)
                    : null)
            }
        }
        fan(index, 1, LINE_PULSE_HOPS, null)
    }

    /** How much a line pulse fades per field unit: little in our blue, more in orange, most in red. */
    pulseFade(u: number, d: number) {
        const zone = this.game.territory.zoneOf(u, d)
        return zone === 'held' ? LINE_PULSE_FADE.held : zone === 'contested' ? LINE_PULSE_FADE.contested : LINE_PULSE_FADE.theirs
    }
}
