import { randomFloat } from '../rng'
import {
    HACKERZ_BONUS_MS, HACKERZ_BOSS_EVERY, HACKERZ_HACKER_ID, hackerzHackerField, HACKERZ_SPIDER_INJECT_MS,
    HACKERZ_REINFORCEMENT_BOUNTY, HACKERZ_SPAWN_WINDOW_MS, hackerzBossFor, hackerzBountyMultiplier, hackerzCoinValue,
    hackerzDamageMultiplier, hackerzEnemy, hackerzHpMultiplier, hackerzWaveEnemyDamage, hackerzWaveEnemyHp,
    hackerzIsAirborne, hackerzIsBossWave, hackerzWaveBudget, hackerzSpawnWeight, hackerzWavePool,
    type HackerzEnemyDefinition
} from '#shared/utils/gamelogic/hackerz'
import { BULLET_RADIUS, FIELD_DEPTH, FIELD_HALF_WIDTH, MODEL_HEIGHT_SCALE, SPAWN_SPREAD } from '../constants'
import { clamp, randRange } from '../math'
import { buildRig } from '../models'
import { MOTION } from '../rig-motion'
import { RED, fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { unitSize, FINAL_PUSH_MS, _v, PACKET_LOSS } from './tuning'
import { placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** A spawn the wave scheduler has already decided on. */
interface ScheduledSpawn {
    atMs: number
    def: HackerzEnemyDefinition
    /** Extra health multiplier, for a DDoS surge that hit its unit cap. */
    hpScale?: number
}

/**
 * How hard spawns bunch toward the end of the window: 1 is even, higher packs
 * more of the wave into its closing seconds.
 */
const SPAWN_RAMP = 1.8

/**
 * While the intrusion is still fighting for its first few nodes, sappers pour
 * in to pull the player's fire off the hackers: one this often, up to this many
 * at a time. Top-ups like the hackers — half the credits, no coins.
 */
const DISTRACT_NODES = 3
const DISTRACT_MS = 1400
const DISTRACT_MAX = 8

/** The decoys hold off until the first boss is down: a fresh run cannot shoot both them and the hackers. */
const DISTRACT_FROM_WAVE = HACKERZ_BOSS_EVERY + 1

/**
 * DDoS surge: the final push adds enough cheap units to outlast the player's
 * firepower — this many seconds of their damage per second, times this much
 * over — capped so the frame rate survives.
 */
const DDOS_SURGE_OVERKILL = 1.4
const DDOS_SURGE_CAP = 140

/** Gap between top-up hackers leaving the portal. */
const HACKER_RESPAWN_MS = 600

/** With more than this many hackers short, they come out this quickly one after another. */
const HACKER_BURST_FROM = 3
const HACKER_BURST_GAP_MS = 150

/** PACKET LOSS: the round's health against what the player's battery can clear in it, and the most extra units it adds. */
const PACKET_LOSS_OVERKILL = 2
const PACKET_LOSS_SWARM_CAP = 120

/**
 * What comes through the portal: the wave's schedule, the hackers and
 * decoys kept topped up, and each unit as it is brought onto the field.
 */
export class Spawner {
    constructor(private readonly game: HackerzGame) {}

    schedule: ScheduledSpawn[] = []

    scheduleIndex = 0

    /** Ms until the portal may send the next top-up hacker. */
    hackerTimer = 0

    private distractTimer = 0

    /** The hacker pack size last seen this.game wave, to announce a second contingent. */
    hackerField = 0

    decoysLogged = false

    /** Hostile types and bonus rounds already reported this.game session (see `sight`). */
    private sighted = new Set<string>()

    /** Reports a hostile type or bonus round the first time it turns up; a demo board never does. */
    sight(id: string) {
        if (this.game.demo || this.sighted.has(id)) return
        this.sighted.add(id)
        this.game.callbacks.onSighted?.(id)
    }

    /**
     * Spends the wave's budget up front and spreads the result over the spawn
     * window. Deciding the whole wave at once is what lets the HUD promise a
     * hostile count the wave actually delivers.
     */
    buildSchedule(wave: number): ScheduledSpawn[] {
        const difficulty = this.game.loadout?.difficulty
        if (!difficulty) return []
        // DDoS floods the lane with the cheap half of the roster; every event
        // packs its budget into the shorter bonus window.
        const fullPool = hackerzWavePool(wave)
        const pool = this.game.bonus === 'ddos'
            ? [...fullPool].sort((a, b) => a.cost - b.cost).slice(0, Math.max(1, Math.ceil(fullPool.length / 2)))
            : fullPool
        // DDoS sends a standard wave's worth before the final push, and saves
        // its surge for the push itself (see `ddosSurge`).
        let budget = hackerzWaveBudget(wave, difficulty) * (this.game.bonus && this.game.bonus !== 'ddos' ? 0.85 : 1)
        const window = this.game.bonus === 'ddos'
            ? this.game.waveMs - FINAL_PUSH_MS
            : this.game.bonus ? HACKERZ_BONUS_MS - 6000 : HACKERZ_SPAWN_WINDOW_MS
        const picks: HackerzEnemyDefinition[] = []

        let guard = 900
        while (budget > 0 && guard-- > 0) {
            const affordable = pool.filter(def => def.cost <= budget)
            if (!affordable.length) break
            const totalWeight = affordable.reduce((sum, def) => sum + hackerzSpawnWeight(def, wave), 0)
            let roll = randomFloat() * totalWeight
            let chosen = affordable[affordable.length - 1] as HackerzEnemyDefinition
            for (const def of affordable) {
                roll -= hackerzSpawnWeight(def, wave)
                if (roll <= 0) {
                    chosen = def
                    break
                }
            }
            picks.push(chosen)
            budget -= chosen.cost
        }

        // Spread across the window, thin at first and thickening toward the end so
        // the pressure builds, then jitter so the rhythm is not metronomic.
        const spawns: ScheduledSpawn[] = picks.map((def, index) => {
            const f = picks.length <= 1 ? 0 : index / (picks.length - 1)
            const slot = (1 - Math.pow(1 - f, SPAWN_RAMP)) * window
            const jitter = (randomFloat() * 2 - 1) * 1400
            return { atMs: clamp(slot + jitter, 0, window), def }
        })

        if (!this.game.bonus && hackerzIsBossWave(wave)) {
            // The boss walks in early — it is slow, and a boss purged before it
            // reached the wall would be a wave with no climax.
            spawns.push({ atMs: 900, def: hackerzEnemy(hackerzBossFor(wave)) })
        }
        if (this.game.bonus === 'ddos') spawns.push(...this.ddosSurge(wave, pool))
        if (this.game.bonus === 'packetloss') spawns.push(...this.packetLossSwarm(wave, pool, picks, window))

        return spawns.sort((a, b) => a.atMs - b.atMs)
    }

    /**
     * What the player can put out a second, near enough: the rail (with its
     * crits) plus every mounted turret, splash counted once.
     */
    private firepower() {
        const loadout = this.game.loadout
        if (!loadout) return 0
        const weapon = loadout.weapon
        const crit = 1 + loadout.critChance * (loadout.critMultiplier - 1)
        let dps = (weapon.damage * weapon.pellets + weapon.splashDamage) * crit / (weapon.fireIntervalMs / 1000)
        for (const turret of loadout.turrets) dps += (turret.damage + turret.splashDamage) / (turret.intervalMs / 1000)
        return dps
    }

    /**
     * A DDoS earns its name in the final push: on top of the standard flood,
     * enough cheap units pour out to carry more health than the player's whole
     * battery can clear in the push — so no build simply outguns it.
     */
    private ddosSurge(wave: number, pool: HackerzEnemyDefinition[]): ScheduledSpawn[] {
        const difficulty = this.game.loadout?.difficulty
        if (!difficulty || !pool.length) return []
        const needed = this.firepower() * (FINAL_PUSH_MS / 1000) * DDOS_SURGE_OVERKILL
        const start = this.game.waveMs - FINAL_PUSH_MS
        const end = this.game.waveMs - 1500
        const totalWeight = pool.reduce((sum, def) => sum + hackerzSpawnWeight(def, wave), 0)
        const surge: ScheduledSpawn[] = []
        let health = 0
        while (health < needed && surge.length < DDOS_SURGE_CAP) {
            let roll = randomFloat() * totalWeight
            let def = pool[pool.length - 1]!
            for (const candidate of pool) {
                roll -= hackerzSpawnWeight(candidate, wave)
                if (roll <= 0) {
                    def = candidate
                    break
                }
            }
            // As `spawn` sizes it: wave and difficulty scaling, halved for the flood.
            health += def.hp * hackerzHpMultiplier(wave) * hackerzWaveEnemyHp(difficulty, wave) * 0.5
            surge.push({ atMs: start + randomFloat() * (end - start), def })
        }
        // At the cap the units get tougher instead of more numerous, so even a
        // battery past what the cap can answer still meets its match.
        if (health > 0 && health < needed) {
            const hpScale = needed / health
            for (const spawn of surge) spawn.hpScale = hpScale
        }
        return surge
    }

    /**
     * PACKET LOSS fields a light swarm: every light unit the wave rolled comes
     * twice, and more light units are added until the whole round carries more
     * health than the player's battery — a quarter of its rounds lost — can
     * clear in the spawn window. Past the cap they get tougher instead.
     */
    private packetLossSwarm(wave: number, pool: HackerzEnemyDefinition[], picks: HackerzEnemyDefinition[], window: number): ScheduledSpawn[] {
        const difficulty = this.game.loadout?.difficulty
        const light = pool.filter(def => !this.isHeavy(def))
        if (!difficulty || !light.length) return []
        const health = (def: HackerzEnemyDefinition) => def.hp * hackerzHpMultiplier(wave) * hackerzWaveEnemyHp(difficulty, wave)
        const at = () => randomFloat() * window
        const swarm: ScheduledSpawn[] = picks.filter(def => !this.isHeavy(def)).map(def => ({ atMs: at(), def }))
        const total = [...picks, ...swarm.map(s => s.def)].reduce((sum, def) => sum + health(def), 0)
        const needed = this.firepower() * (1 - PACKET_LOSS) * (window / 1000) * PACKET_LOSS_OVERKILL
        const totalWeight = light.reduce((sum, def) => sum + hackerzSpawnWeight(def, wave), 0)
        const added: ScheduledSpawn[] = []
        let addedHealth = 0
        while (total + addedHealth < needed && added.length < PACKET_LOSS_SWARM_CAP) {
            let roll = randomFloat() * totalWeight
            let def = light[light.length - 1]!
            for (const candidate of light) {
                roll -= hackerzSpawnWeight(candidate, wave)
                if (roll <= 0) {
                    def = candidate
                    break
                }
            }
            addedHealth += health(def)
            added.push({ atMs: at(), def })
        }
        // At the cap the extra units carry the shortfall between them.
        if (addedHealth > 0 && total + addedHealth < needed) {
            const hpScale = (needed - total) / addedHealth
            for (const spawn of added) spawn.hpScale = hpScale
        }
        return [...swarm, ...added]
    }

    /** Armour and bosses: what the light swarms leave out. */
    isHeavy(def: HackerzEnemyDefinition) {
        return def.armored || !!def.boss
    }

    releaseScheduled() {
        while (this.scheduleIndex < this.schedule.length
            && (this.schedule[this.scheduleIndex] as ScheduledSpawn).atMs <= this.game.waveElapsed) {
            const next = this.schedule[this.scheduleIndex] as ScheduledSpawn
            this.spawn(next.def, false, next.hpScale ?? 1)
            this.scheduleIndex++
        }
    }

    /**
     * While any path node can still be taken, the portal keeps a pack of
     * hackers on the field (`hackerzHackerField`): each one that falls is
     * replaced, one at a time, a beat apart so they come out in a line rather
     * than a heap. A whole contingent arriving at once — late waves send a
     * second one a few seconds in — pours out in a quick stagger instead.
     */
    maintainHackers(dtMs: number) {
        this.hackerTimer -= dtMs
        if (this.hackerTimer > 0) return
        if (!this.game.pathChips?.chips.some(chip => chip.state !== 'hacked')) return
        const alive = this.game.enemies.filter(e => e.def.id === HACKERZ_HACKER_ID && !e.decoy).length
        const field = hackerzHackerField(this.game.wave, this.game.waveElapsed)
        if (this.hackerField > 0 && field > this.hackerField) this.game.sysLog.hackerSurge(field - this.hackerField)
        this.hackerField = field
        const missing = field - alive
        if (missing <= 0) return
        this.hackerTimer = missing > HACKER_BURST_FROM ? HACKER_BURST_GAP_MS : HACKER_RESPAWN_MS
        this.spawn(hackerzEnemy(HACKERZ_HACKER_ID), true)
    }

    /**
     * While the hackers are still fighting for the first few nodes, sappers
     * pour in after the fence to draw the player's fire off them — the cover
     * that gives a hack the time it needs. Once those nodes fall the stream
     * stops; the wave's own sappers still come.
     */
    maintainDistraction(dtMs: number) {
        this.distractTimer -= dtMs
        if (this.distractTimer > 0 || this.game.bonus) return
        const chips = this.game.pathChips
        if (!chips || chips.conquered >= DISTRACT_NODES || this.game.movement.allNodesTaken) return
        const sapper = hackerzEnemy('sapper')
        if (Math.max(sapper.fromWave, DISTRACT_FROM_WAVE) > this.game.wave) return
        if (this.game.enemies.filter(e => e.def.id === sapper.id).length >= DISTRACT_MAX) return
        this.distractTimer = DISTRACT_MS * (0.75 + randomFloat() * 0.5)
        this.spawn(sapper, true)
        if (!this.decoysLogged) {
            this.decoysLogged = true
            this.game.sysLog.decoys()
        }
    }

    /**
     * Brings a unit onto the field. `at` sets it down mid-field instead (a
     * spiderling hatching): it takes the nearest line from there, and the
     * portal shows nothing of it. `reinforcement` is a top-up hacker: half
     * the credits, and no coins.
     */
    spawn(def: HackerzEnemyDefinition, reinforcement = false, hpScale = 1, at: { u: number, d: number } | null = null) {
        const loadout = this.game.loadout
        if (!loadout) return
        const difficulty = loadout.difficulty
        // Flyers pick any lane over the board; ground units come out of one of
        // the portal's sockets and are put on a trace below.
        const u = at ? at.u : def.boss ? 0 : (randomFloat() * 2 - 1) * (FIELD_HALF_WIDTH - 40)
        const d = at ? at.d : FIELD_DEPTH + randomFloat() * SPAWN_SPREAD

        this.sight(def.id)
        const size = unitSize(def)
        const height = size * MODEL_HEIGHT_SCALE
        const rig = buildRig(def.id, def.hex, height, { shrouded: true })
        this.game.fieldRoot.add(rig.root)

        // A hard difficulty phases in over the run (see `HACKERZ_DIFFICULTY_FULL_WAVE`).
        const maxHp = def.hp * hackerzHpMultiplier(this.game.wave) * hackerzWaveEnemyHp(difficulty, this.game.wave) * (this.game.bonus === 'ddos' ? 0.5 : 1) * hpScale
        const bounty = def.bounty * hackerzBountyMultiplier(this.game.wave) * (this.game.bonus === 'ddos' ? 0.6 : 1)
            * (reinforcement ? HACKERZ_REINFORCEMENT_BOUNTY : 1)

        const enemy: EnemyEntity = {
            def,
            rig,
            u,
            d,
            altitude: (def.altitude ?? 0) * 0.9,
            hp: maxHp,
            maxHp,
            speed: def.speed * (0.92 + randomFloat() * 0.16),
            damage: def.damage * hackerzDamageMultiplier(this.game.wave) * hackerzWaveEnemyDamage(difficulty, this.game.wave),
            bounty,
            // Bonus rounds pay credits only: coins are the site economy, and a
            // replayable sprint must never be a way to farm them.
            coinValue: this.game.bonus || reinforcement ? 0 : hackerzCoinValue(bounty, this.game.wave, difficulty, loadout.coinMultiplier),
            armored: def.armored,
            stride: randRange(0, Math.PI * 2),
            attackTimer: 0,
            burstLeft: 0,
            pushVd: 0,
            hover: randRange(0, Math.PI * 2),
            flashMs: 0,
            // A drainer closes in until its fangs are in the fence.
            standoff: def.range ?? (def.drain ? size * 0.9 : size * 0.3 + 10),
            radius: size * 0.22 + BULLET_RADIUS,
            age: 0,
            pingDelay: -1,
            revealMs: 0,
            decloaked: false,
            decoy: false,
            bossTimer: def.id === 'titan' ? 6000 : def.id === 'leviathan' ? 7000 : 0,
            burrowMs: 0,
            splits: 0,
            hackReach: randomFloat(),
            pulseTimer: randomFloat() * MOTION.hackPulseMs,
            hacking: false,
            route: null,
            routeSeg: 0,
            routeTo: -1,
            routeFrom: -1,
            yaw: 0,
            zoneTick: 0,
            targetChip: null,
            zapCooldown: 0,
            redShield: false,
            redShieldMs: 0,
            healTick: 0,
            recovering: false,
            zoneTicks: 0,
            coverMs: 0,
            bearer: false,
            defending: null,
            escorting: null,
            parked: null,
            recoil: 0,
            strike: 0,
            heave: 0,
            heaveDrain: 0,
            carry: null,
            healing: null,
            healRetargetMs: 0,
            kamikaze: false,
            turned: false,
            guard: def.guard ? maxHp * def.guard : 0,
            hexShield: null,
            ribbon: null,
            ribbonMs: 0,
            storm: null,
            inject: 0,
            broodMs: HACKERZ_SPIDER_INJECT_MS,
            drainPower: 1,
            wound: null,
            riseMs: 0
        }
        if (this.game.movement.ridesNetwork(enemy)) {
            if (at) this.game.movement.attachToNetwork(enemy)
            else this.game.movement.enterFromPortal(enemy)
        }
        placeEnemy(enemy)
        // Arrivals take the clearest socket (see `enterFromPortal`); one that
        // still lands on a body — every socket backed up — waits inside the
        // portal until the way is clear.
        if (!at && !def.boss && !hackerzIsAirborne(def) && this.game.crowd.crowdedAt(enemy)) {
            enemy.gateHold = true
            enemy.rig.root.visible = false
        }
        this.game.enemies.push(enemy)
        this.game.transient?.ring(fieldToWorld(u, d, 0.1, _v), def.hex, def.boss ? 6 : 1.6, 0.5)
        // Coming through the gate sends power lines out across it from the entry
        // point — in the dark, the only sign that anything arrived.
        if (!at) this.game.view?.portalArrival(enemy.u)

        if (def.boss) {
            this.game.callbacks.onBoss(def.name)
            this.game.sysLog.boss(def.id, def.name)
            this.game.callbacks.onSound?.('boss-spawn')
            this.game.overlay.banner(def.name, RED, 'kernel-level intrusion')
            this.game.addShake(10)
        }
    }
}
