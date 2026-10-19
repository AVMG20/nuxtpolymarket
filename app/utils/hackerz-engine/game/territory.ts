import * as THREE from 'three'
import { FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE, SPIKE_BAND } from '../constants'
import type { PathChip } from '../path-chips'
import { DARK_ZONES, FRONT_COLUMNS, ISLANDS, RED, fieldToWorld } from '../scene'
import { zoneAt } from '../lane-props'
import type { EnemyEntity } from '../types'
import { ZONE_TICK_MS, BLACKOUT_LIGHT_D, PER_WORLD, _v, _w } from './tuning'
import type { HackerzGame } from '../hackerz-game'

/** Their ground always covers the portal: the red line never pulls back past this. */
const PORTAL_GROUND = FIELD_DEPTH - 30

/**
 * Dark zones: this many hacked nodes, each within `DARK_LINK` of another, put
 * the lights out over themselves and this much ground around them.
 */
const DARK_CLUSTER = 3

/** Nodes are scattered at least ~250 apart, so "close" has to reach a little past that. */
const DARK_LINK = 400
const DARK_MARGIN = 140

/** Island radii, field units: a node taken out of turn, and one being hacked away from the front. */
const RED_ISLAND = 150
const ORANGE_ISLAND = 170

/** Red ground's gifts to anything standing in it: a one-hit shield, recharging, and a heal per tick. */
const RED_SHIELD_RECHARGE_MS = 3000

/** Units this close to a node they hold heal twice as fast, and stand guard over it. */
const GUARD_RADIUS = 140

/** How soon a shield re-forms on a unit stepping back into red. */
const RED_SHIELD_REFORM_MS = 500
const RED_HEAL_SHARE = 0.02
const RED_HEAL_BOSS_SHARE = 0.005

/** How fast their red ground pours toward a node they have taken, in field units a second. */
const RED_FLOW_SPEED = 150

/** How fast disputed ground swarms out from their line, in field units a second. */
const SWARM_SPEED = 260

/** An island's radius toward its goal: swelling at `ISLAND_FLOW`, draining a little slower. */
function swell(current: number, goal: number, dt: number) {
    return goal > current
        ? Math.min(goal, current + ISLAND_FLOW * dt)
        : Math.max(goal, current - ISLAND_FLOW * 0.6 * dt)
}

/** How fast an island swells, in field units of radius a second. */
const ISLAND_FLOW = 160

/**
 * Who holds the ground: their red lines and islands, the disputed orange,
 * the dark zones over clustered nodes, and what each ground does to the
 * units standing on it.
 */
export class Territory {
    constructor(private readonly game: HackerzGame) {}

    /** How far the ground behind the fence has turned orange (0–1), eased toward whether every node is theirs. */
    overrun = 0

    /** Dark-zone slots over clusters of hacked nodes; field units, strength eased 0–1. */
    darkZones = Array.from({ length: DARK_ZONES }, () => ({ u: 0, d: 0, r: 0, strength: 0, on: false }))

    /** Island radii per path node (outermost first), eased; field units. */
    islands: { red: number, orange: number }[] = []

    /** BLACKOUT dimming, eased 0 → 1. */
    darkness = 0

    /**
     * The territory follows the path nodes. Their ground runs from the portal
     * down to the last node they hold in an unbroken run, and while a wave is
     * on, disputed ground swarms out ahead of it to the next node they are
     * going for — or, with nothing left to take, all the way to the fence.
     * Each line reaches furthest at its node and trails back across the lane,
     * so it points at what it is fighting over. Between waves the dispute
     * draws back into their ground.
     */
    updateTerritory(dt: number) {
        const view = this.game.view
        const chips = this.game.pathChips
        if (!view || !chips) return
        const ordered = chips.ordered
        // The lines follow the unbroken run of nodes taken from the portal down;
        // a node taken out of turn, or fought over away from the front, gets
        // an island of its own instead.
        let run = 0
        while (run < ordered.length && ordered[run]!.state === 'hacked') run++
        const connected = ordered.slice(0, run)
        const next = ordered[run] ?? null
        const disputed = this.game.running && !this.game.purging
        // With every node gone the gate itself is disputed — unless the grid
        // trap is live, which keeps the band in front of the fence theirs to fear.
        const gateD = (this.game.loadout?.spikeDps ?? 0) > 0 ? SPIKE_BAND : -20
        for (let c = 0; c < FRONT_COLUMNS; c++) {
            const u = -FIELD_HALF_WIDTH + (c / (FRONT_COLUMNS - 1)) * FIELD_HALF_WIDTH * 2
            const redTarget = Math.min(PORTAL_GROUND, ...connected.map(chip => chip.d - 60 + Math.abs(u - chip.u) * 0.3))
            let orangeTarget = redTarget
            if (disputed) {
                // Disputed ground reaches just past the next node in line, and
                // runs on to the gate once there is no node left.
                orangeTarget = next
                    ? Math.min(redTarget, next.d - 90 + Math.abs(u - next.u) * 0.3)
                    : Math.min(redTarget, gateD)
            }
            // Both lines pour rather than jump: they advance at a capped creep
            // that varies across the lane, like liquid finding its way, and
            // ebb back more gently still.
            const creep = 0.7 + 0.3 * Math.sin(c * 1.7 + this.game.elapsedTotal * 0.0011)
            view.redLine[c] = this.flowToward(view.redLine[c]!, redTarget, RED_FLOW_SPEED * creep, dt)
            view.orangeLine[c] = this.flowToward(view.orangeLine[c]!, orangeTarget, SWARM_SPEED * creep, dt)
        }
        // A little surface tension: each column is drawn toward its neighbours,
        // so the edges round off and a front spreads sideways as it advances.
        this.relaxLine(view.redLine, dt)
        this.relaxLine(view.orangeLine, dt)
        this.updateDarkZones(dt)
        // Disputed ground never sits behind their own.
        for (let c = 0; c < FRONT_COLUMNS; c++) view.orangeLine[c] = Math.min(view.orangeLine[c]!, view.redLine[c]!)

        // Islands swell around isolated nodes like the lines pour: a red pool
        // round a node they took out of turn, an orange one round a node
        // being hacked away from the front. When the run reaches an island it
        // drains as the main ground flows in over it.
        for (let i = 0; i < ISLANDS; i++) {
            const chip = ordered[i]
            const island = this.islands[i] ??= { red: 0, orange: 0 }
            const isolated = !!chip && i > run
            const redGoal = chip && isolated && chip.state === 'hacked' ? RED_ISLAND : 0
            const orangeGoal = chip && disputed && isolated && chip.state !== 'hacked' && chip.alert
                ? ORANGE_ISLAND * (0.6 + 0.4 * chip.hack)
                : 0
            island.red = swell(island.red, redGoal, dt)
            island.orange = swell(island.orange, orangeGoal, dt)
            const at = chip ?? { u: 0, d: 0 }
            view.redIslands[i]!.set(at.u * FIELD_SCALE, -at.d * FIELD_SCALE, island.red * FIELD_SCALE, 0)
            view.orangeIslands[i]!.set(at.u * FIELD_SCALE, -at.d * FIELD_SCALE, island.orange * FIELD_SCALE, 0)
        }
    }

    /**
     * Three or more hacked nodes close together put the lights out around
     * them: the ground goes dark, and anything inside can only be seen — and
     * hit — while a radar ping lights it. Zones fade in and out; a new one is
     * announced where it falls.
     */
    private updateDarkZones(dt: number) {
        const view = this.game.view
        const chips = this.game.pathChips
        if (!view || !chips) return
        // Group hacked nodes that sit within reach of one another. A bonus
        // round's locked board is a sandbox and puts no lights out.
        const hacked = chips.locked ? [] : chips.chips.filter(chip => chip.state === 'hacked')
        const groups: PathChip[][] = []
        const placed = new Set<PathChip>()
        for (const seed of hacked) {
            if (placed.has(seed)) continue
            const group = [seed]
            placed.add(seed)
            for (let i = 0; i < group.length; i++) {
                for (const other of hacked) {
                    if (placed.has(other)) continue
                    if (Math.hypot(other.u - group[i]!.u, other.d - group[i]!.d) > DARK_LINK) continue
                    placed.add(other)
                    group.push(other)
                }
            }
            if (group.length >= DARK_CLUSTER) groups.push(group)
        }
        const targets = groups.slice(0, DARK_ZONES).map((group) => {
            const u = group.reduce((sum, chip) => sum + chip.u, 0) / group.length
            const d = group.reduce((sum, chip) => sum + chip.d, 0) / group.length
            const r = Math.max(...group.map(chip => Math.hypot(chip.u - u, chip.d - d))) + DARK_MARGIN
            return { u, d, r }
        })
        // Keep each zone in its slot as it shifts, so it fades rather than jumps.
        const free = new Set(targets)
        this.darkZones.forEach((zone, slot) => {
            const match = [...free].find(t => Math.hypot(t.u - zone.u, t.d - zone.d) < 200)
            if (match) {
                free.delete(match)
                Object.assign(zone, { u: match.u, d: match.d, r: match.r, on: true })
            } else {
                if (zone.on && this.game.running) this.game.sysLog.lightsBack(slot)
                zone.on = false
            }
        })
        for (const target of free) {
            const slot = this.darkZones.find(zone => !zone.on && zone.strength < 0.05)
            if (!slot) break
            Object.assign(slot, { u: target.u, d: target.d, r: target.r, on: true })
            if (this.game.running) {
                this.game.overlay.floatText(fieldToWorld(target.u, target.d, 4, _v), 'LIGHTS OUT', RED, 1.5)
                this.game.sysLog.darkZone(this.darkZones.indexOf(slot))
                this.game.sendShieldBearers()
            }
        }
        this.darkZones.forEach((zone, i) => {
            zone.strength += ((zone.on ? 1 : 0) - zone.strength) * Math.min(1, dt * 1.2)
            view.darkZones[i]!.set(zone.u * FIELD_SCALE, -zone.d * FIELD_SCALE, zone.r * FIELD_SCALE, zone.strength)
        })
    }

    /**
     * How hidden a unit is, 0 seen to 1 unseen: the CPU twin of the shroud in
     * its shader (`shroudAt` in models), for overlays that must not give it away.
     */
    shroudOf(enemy: EnemyEntity) {
        let k = 0
        for (const zone of this.darkZones) {
            if (zone.r <= 0 || zone.strength <= 0) continue
            const distance = Math.hypot(enemy.u - zone.u, enemy.d - zone.d)
            k = Math.max(k, zone.strength * (1 - THREE.MathUtils.smoothstep(distance, zone.r * 0.6, zone.r)))
        }
        const band = 2 / FIELD_SCALE
        k = Math.max(k, this.darkness * THREE.MathUtils.smoothstep(enemy.d, BLACKOUT_LIGHT_D - band, BLACKOUT_LIGHT_D + band))
        return k * (1 - enemy.rig.reveal.value)
    }

    /** Whether a point lies inside a dark zone that is mostly out. */
    inDarkZone(u: number, d: number) {
        return this.darkZones.some(zone => zone.strength > 0.5 && Math.hypot(u - zone.u, d - zone.d) < zone.r * 0.85)
    }

    /**
     * Which side holds a field point: the lines, then the islands on top —
     * a red island is theirs, an orange one disputed unless it lies in red.
     */
    zoneOf(u: number, d: number): 'held' | 'contested' | 'theirs' {
        const view = this.game.view
        if (!view || d < 0) return 'held'
        const ordered = this.game.pathChips?.ordered ?? []
        let orangeIsland = false
        for (let i = 0; i < ISLANDS; i++) {
            const chip = ordered[i]
            const island = this.islands[i]
            if (!chip || !island) continue
            const distance = Math.hypot(u - chip.u, d - chip.d)
            if (distance < island.red) return 'theirs'
            if (distance < island.orange) orangeIsland = true
        }
        const line = zoneAt(view.redLine, view.orangeLine, u, d)
        if (line === 'theirs') return 'theirs'
        return orangeIsland ? 'contested' : line
    }

    /** Advances toward the fence at up to `speed` a second; recedes at a slower, easing pace. */
    private flowToward(current: number, target: number, speed: number, dt: number) {
        if (target < current) return Math.max(target, current - speed * dt)
        return Math.min(target, current + Math.max(speed * 0.35 * dt, (target - current) * Math.min(1, dt * 0.9)))
    }

    /** Blends each column a little toward its neighbours' average. */
    private relaxLine(line: number[], dt: number) {
        const k = Math.min(0.5, dt * 2.5)
        let previous = line[0]!
        for (let c = 0; c < line.length; c++) {
            const here = line[c]!
            const next = line[c + 1] ?? here
            line[c] = here + ((previous + next) / 2 - here) * k
            previous = here
        }
    }

    /** Whether a unit stands in the firewall's own blue ground. */
    inHeldGround(enemy: EnemyEntity) {
        if (enemy.burrowMs > 0) return false
        return this.zoneOf(enemy.u, enemy.d) === 'held'
    }

    /**
     * Red ground looks after its own: anything standing in it grows a shield
     * that eats the next hit (and comes back a few seconds after it pops), and
     * heals a little every tick. Both belong to the ground: a unit that steps
     * out of red loses its shield there and then.
     */
    redGround(enemy: EnemyEntity, dtMs: number) {
        const live = this.game.running && !this.game.purging && enemy.burrowMs <= 0
        const inRed = live && this.zoneOf(enemy.u, enemy.d) === 'theirs'
        // Sheltering behind a shield bearer heals as red ground does, wherever the wall stands.
        const sheltered = live && !inRed && this.game.isSheltered(enemy)
        if (!inRed && enemy.redShield) {
            this.setRedShield(enemy, false)
            // Not a break, just out of reach: it comes back quickly in red.
            enemy.redShieldMs = RED_SHIELD_REFORM_MS
        }
        if (!inRed && !sheltered) {
            enemy.healTick = 0
            return
        }
        if (inRed && !enemy.redShield) {
            enemy.redShieldMs -= dtMs
            if (enemy.redShieldMs <= 0) this.setRedShield(enemy, true)
        }
        enemy.healTick += dtMs
        if (enemy.healTick < ZONE_TICK_MS) return
        enemy.healTick -= ZONE_TICK_MS
        if (enemy.hp >= enemy.maxHp) return
        // Gathered round a node they hold, it heals twice as fast — unless the
        // board is locked: an untakeable node needs no guard.
        const chips = this.game.pathChips
        const guarding = !!chips && !chips.locked && chips.chips.some(chip => chip.state === 'hacked'
            && Math.hypot(chip.u - enemy.u, chip.d - enemy.d) <= GUARD_RADIUS)
        const share = (enemy.def.boss ? RED_HEAL_BOSS_SHARE : RED_HEAL_SHARE) * (guarding ? 2 : 1)
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * share)
        if (!this.game.untargetable(enemy)) {
            this.game.particles.emit(this.game.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.6, _v), _w.set(0, 2.4, 0), RED,
                { size: 0.2, life: 0.5, gravity: 0 })
        }
    }

    /**
     * The shield is a sheen on the unit's own plating (see the body shader's
     * `uShield`), eased in and out each frame by `easeSheen` (rig-motion).
     */
    setRedShield(enemy: EnemyEntity, on: boolean) {
        enemy.redShield = on
        if (!on) enemy.redShieldMs = RED_SHIELD_RECHARGE_MS
    }
}
