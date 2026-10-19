import * as THREE from 'three'
import { randomChance, randomFloat, seededRng, withSeed } from './rng'
import type { DemoScript } from '../hackerz-demo-scripts'
import type { HackerzAutopilotView } from '#shared/utils/gamelogic/hackerz-autopilot'
import {
    HACKERZ_BONUS_MS, HACKERZ_BONUS_MULTIPLIER, HACKERZ_BOSS_EVERY, HACKERZ_DEPLOYABLE_MAX,
    HACKERZ_BONUS_PASS_INTEGRITY, HACKERZ_HACKER_ID, hackerzHackerField, HACKERZ_MAX_WAVE, HACKERZ_SPIDER_INJECT_MS,
    HACKERZ_REINFORCEMENT_BOUNTY, HACKERZ_PURGE_BOUNTY, HACKERZ_SPAWN_WINDOW_MS, HACKERZ_WAVE_MS, hackerzBossFor,
    hackerzBountyMultiplier, hackerzClearBonus, hackerzCoinValue, HACKERZ_DEPLOYABLES, hackerzDamageMultiplier,
    hackerzDeployable, hackerzEnemy, hackerzHpMultiplier, hackerzWaveEnemyDamage, hackerzWaveEnemyHp, hackerzIsAirborne,
    hackerzIsBossWave, hackerzNetworkEvent, hackerzWaveBudget, hackerzSpawnWeight, hackerzWavePool,
    type HackerzDeployableId, type HackerzEnemyDefinition, type HackerzEnemyId, type HackerzEventId,
    type HackerzLoadout, type HackerzWeaponRuntime
} from '#shared/utils/gamelogic/hackerz'
import {
    BULLET_RADIUS, DESPAWN_DEPTH, FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE, MAX_SHAKE, MODEL_HEIGHT_SCALE,
    PICK_SLACK_PX, PURGE_MS, PURGE_REACH, RAIL_U, SHAKE_DECAY, SPAWN_SPREAD, SPIKE_BAND, GUN_Z, WALL_HEIGHT
} from './constants'
import { clamp, randRange } from './math'
import { PathChips, type PathChip } from './path-chips'
import { Guardrail } from './guardrail'
import { Deployables, type Hold } from './deployables'
import { HackTerminals } from './hack-terminal'
import { LinePulses } from './line-pulses'
import { SysLog } from './sys-log'
import { Shrapnel } from './shrapnel'
import { GlitchClouds } from './glitch-cloud'
import {
    buildNetwork, nearestOnNetwork, segmentDirection, tracePassesNear, type DataNetwork, type LinePoint, type Trace
} from './data-lines'
import { buildRig, disposeRig, hdr, loadModels, modelClock, poseRig, shroud } from './models'
import {
    ENEMY_PACE, MOTION, SAPPER_SPEED, THEIR_GROUND_SPEED, easeRecoil, easeSheen, hitFlash, drainGrowth, gatherLegs,
    easeInject, easeStrike, injectLands, rollSpeedFor, strideFor, strikeLands, turnToward
} from './rig-motion'
import { AMBER, CYAN, HackerzScene, LIME, RED, fieldToWorld } from './scene'
import { AmmoRack } from './ammo-rack'
import { LaneProps } from './lane-props'
import { Overlay, ParticleSystem, TransientFx, hexCss, type HealthTag } from './fx'
import type { EnemyEntity, HackerzCallbacks, HackerzStartConfig } from './types'
import {
    HACK_TEAM, YAW_DOWN, PER_WORLD, _v, _w, ZONE_TICK_MS, BLACKOUT_LIGHT_D, GLITCH_FADE_MS, CROWD_GAP, LANE_SLACK,
    MUZZLE_D, PACKET_LOSS, LONGBORE_FLARE, RAIL_TRACK, PING_COOLDOWN_MS
} from './game/tuning'
import { Healers } from './game/healers'
import { Leaks } from './game/leaks'
import { Scoring } from './game/scoring'
import { Bastion } from './game/bastion'
import { PacketLoss } from './game/packet-loss'
import { Territory } from './game/territory'
import {
    burrowing, enemyCentreY, enemyWorld, footprint, glitchOf, placeEnemy, sinkInto, underground
} from './game/bodies'
import { Crowd } from './game/crowd'
import { Combat } from './game/combat'
import { WhiteHats } from './game/white-hats'
import { Assault } from './game/assault'
import { Rootkit } from './game/rootkit'
import { BlackIce } from './game/black-ice'
import { ZeroDay } from './game/zero-day'
import { Turrets } from './game/turrets'
import { Projectiles } from './game/projectiles'
import { Rail } from './game/rail'
import { Abilities } from './game/abilities'
import { Deployer } from './game/deployer'
import { Hacking } from './game/hacking'

/** A spawn the wave scheduler has already decided on. */
interface ScheduledSpawn {
    atMs: number
    def: HackerzEnemyDefinition
    /** Extra health multiplier, for a DDoS surge that hit its unit cap. */
    hpScale?: number
}

/**
 * What a rider is doing: pressing on, healing in red, falling back to it,
 * holding to cover one that is, guarding a held node, or sheltering beside a
 * shield bearer.
 */
type Tactic = 'advance' | 'recover' | 'retreat' | 'cover' | 'guard' | 'shelter'

/** Where a unit is headed this frame. */
interface RouteGoal {
    /** Depth to stop at: the fence's standoff, or a proxy wall. */
    stopD: number
    /** Arrived early: true once the unit is close enough to do its job from where it stands. */
    near?: (u: number, d: number) => boolean
}

/**
 * Units drawn smaller than their height in the rules says: ROOTKIT's legs
 * spread far wider than it is tall, so at full size it straddled half the
 * fence. Its body, hitbox, standoff, stride and spacing all shrink together.
 */
const UNIT_DISPLAY_SCALE: Partial<Record<HackerzEnemyId, number>> = { titan: 0.55 }

/** A unit's size on the board, in the rules' height units. */
function unitSize(def: HackerzEnemyDefinition) {
    return def.height * (UNIT_DISPLAY_SCALE[def.id] ?? 1)
}

const PING_REVEAL_MS = 2600

/**
 * How hard spawns bunch toward the end of the window: 1 is even, higher packs
 * more of the wave into its closing seconds.
 */
const SPAWN_RAMP = 1.8

/** The last stretch of a wave: everything drops what it is doing and charges the fence. */
const FINAL_PUSH_MS = 12_000
const FINAL_PUSH_SPEED = 1.35

const HACK_QUEUE_GAP = 70

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

/** A honeypot pulls in riders whose next trace passes this close to it. */
const LURE_TRACE_RADIUS = 120

/** Hackers get to work within this far of a node — a column over still counts. */
const HACK_REACH = 125

const YAW_RIGHT = Math.PI / 2
const YAW_LEFT = -Math.PI / 2

const ZONE_TICK_SHARE = 0.025
const ZONE_TICK_BOSS_SHARE = 0.006

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

/** A bodyguard outpaces its charge by this much, so it can get back in front. */
const ESCORT_CATCH_UP = 1.3

/** A ranged unit will not set up closer than this to a node, so it never reads as the node's guard. */
const RANGED_CHIP_CLEAR = 130
const BEARER_SPACING = 55
const SHELTER_BEHIND = 70

/** The wounded only make for a shield wall this close; sheltering this close behind a bearer heals. */
const SHELTER_REACH = 350
const SHELTER_RADIUS = 110

/** Bearers plod: their rules speed, without the field pace or their ground's boost. */
const BEARER_PACE = 1
const BEARER_RESPAWN_MS = 1500

/** A weakling below this share of health holds in red to heal, until it is back above `RECOVERED`. */
const RETREAT_BELOW = 0.5
const RECOVERED = 0.9

/** A unit falls back at this share of its pace; healthier units this close in front of it hold to cover it. */
const RETREAT_SPEED = 0.8
const COVER_RADIUS = 170
const COVER_HOLD_MS = 900
const YAW_UP = Math.PI

/** PACKET LOSS: the round's health against what the player's battery can clear in it, and the most extra units it adds. */
const PACKET_LOSS_OVERKILL = 2
const PACKET_LOSS_SWARM_CAP = 120

/** PACKET LOSS: when a spike clears, hostiles surge this many times faster for this long. */
const LAG_CATCH_UP_SPEED = 4

/** Where a demo board's camera sits relative to what it is looking at: well in from the game's own. */
const DEMO_CAMERA_OFFSET = new THREE.Vector3(0, 13, 16)

/** A demo board's fixed step, and the seed every loop of it starts from. */
const DEMO_STEP_MS = 1000 / 60
const DEMO_SEED = 0x5eed

const LANE_RETURN = 0.5

/** Auto-play offers Laya this many hostiles to choose between, and counts this close to the wall as near. */
const AUTOPILOT_CONTACTS = 5
const AUTOPILOT_NEAR = 250

/** Hostiles this close together count as one pack, for where auto-play puts a deployable. */
const AUTOPILOT_PACK_RADIUS = 140

/** How far ahead of a pack (toward the wall) auto-play puts each deployable that waits for it. */
const AUTOPILOT_DEPLOY_AHEAD: Partial<Record<HackerzDeployableId, number>> = { honeypot: 120, proxy: 90, bomb: 60, surge: 0 }

/** How fast a health bar's trail drains after a hit, in bar-lengths a second. */
const HP_TRAIL_DRAIN = 0.9

/** How close to its stop line a demo unit counts as there: `walkTo` settles within 3. */
const PUPPET_SETTLE = 4

const DEPLOY_KEYS: Record<string, HackerzDeployableId> = Object.fromEntries(HACKERZ_DEPLOYABLES.map(def => [def.key.toLowerCase(), def.id]))

export class HackerzGame {
    view: HackerzScene | null = null
    callbacks: HackerzCallbacks
    particles = new ParticleSystem(5000)
    transient: TransientFx | null = null
    overlay = new Overlay()
    fieldRoot = new THREE.Group()
    private laneProps: LaneProps | null = null
    pathChips: PathChips | null = null
    terminals: HackTerminals | null = null
    /** The data lines ground hostiles ride. Rebuilt each run. */
    network: DataNetwork = { nodes: [], traces: [] }
    private guardrail: Guardrail | null = null
    private resizeObserver: ResizeObserver | null = null
    private raf = 0
    private lastTime = 0

    // ── Lifecycle ──
    private destroyed = false
    private mounted = false
    /** A wave is live: enemies spawn, the clock runs, input fires. */
    running = false
    paused = false
    /** The end-of-wave sweep is playing; input is dead but the field still ticks. */
    purging = false
    gameOver = false

    // ── Run state ──
    loadout: HackerzLoadout | null = null
    slots = 2
    wave = 0
    private waveElapsed = 0
    private schedule: ScheduledSpawn[] = []
    private scheduleIndex = 0
    /** The wave's closing stretch is on: everything but the hackers charges. */
    private finalPush = false
    /** Ms until the portal may send the next top-up hacker. */
    private hackerTimer = 0
    /** Ms until the portal may send the next shield bearer. */
    private bearerTimer = 0
    private escortTimer = 0
    private distractTimer = 0

    // ── Bonus round ──
    /** The network event this round is, or null for an ordinary wave. */
    bonus: HackerzEventId | null = null
    /** Length of the round in flight: a wave, or the shorter bonus sprint. */
    private waveMs = HACKERZ_WAVE_MS
    /** The run's node states, set aside while a bonus round plays on a fresh board. */
    private bonusChips: ReturnType<PathChips['snapshot']> | null = null

    // ── Deployables ──
    deployables: Deployables | null = null
    linePulses: LinePulses | null = null
    shrapnel: Shrapnel | null = null
    /** Warhead blasts: clouds of corrupted data scrambling the splash area. */
    glitchClouds: GlitchClouds | null = null
    /** The firewall's syslog, for the terminal beside the board. */
    sysLog = new SysLog(line => this.callbacks.onLog?.(line))
    /** The hacker pack size last seen this wave, to announce a second contingent. */
    private hackerField = 0
    private decoysLogged = false

    // ── Entities ──
    enemies: EnemyEntity[] = []

    // ── Input ──
    private listeners: (() => void)[] = []
    private raycaster = new THREE.Raycaster()
    private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    // ── Camera ──
    private shake = 0
    elapsedTotal = 0
    /** The picture's clock: drives every shader animation, and stands still during a packet-loss spike. */
    private visualTime = 0

    /** Hostile types and bonus rounds already reported this session (see `sight`). */
    private sighted = new Set<string>()
    /** A Database demo board (see `mountDemo`), the spot its camera is held on, and whether it cuts there. */
    demo = false
    private demoFocus: { u: number, d: number } | null = null
    private demoSnap = true
    /** The demo's script, its seeded rolls, its clock, the next step due, and where its lines go. */
    private demoScript: DemoScript | null = null
    private demoRng: (() => number) | null = null
    private demoTime = 0
    private demoNext = 0
    private demoAccumMs = 0
    private demoSay: ((line: string) => void) | null = null
    /** How far the demo camera is pulled back, and what the script has the rail firing at. */
    private demoZoom = 1
    private demoFiring: 'lead' | 'node' | null = null

    // ── Systems: each owns its part of the game (see ./game) ──
    readonly healers = new Healers(this)
    readonly memory = new Leaks(this)
    readonly scoring = new Scoring(this)
    readonly bastion = new Bastion(this)
    readonly lag = new PacketLoss(this)
    readonly territory = new Territory(this)
    readonly crowd = new Crowd(this)
    readonly combat = new Combat(this)
    readonly whiteHats = new WhiteHats(this)
    readonly assault = new Assault(this)
    readonly rootkit = new Rootkit(this)
    readonly blackIce = new BlackIce(this)
    readonly zeroDay = new ZeroDay(this)
    readonly battery = new Turrets(this)
    readonly projectiles = new Projectiles(this)
    readonly rail = new Rail(this)
    readonly abilities = new Abilities(this)
    readonly deployer = new Deployer(this)
    readonly hacking = new Hacking(this)

    constructor(callbacks: HackerzCallbacks) {
        this.callbacks = callbacks
    }

    // ─── Mount / teardown ────────────────────────────────────────────────────

    async mount(host: HTMLDivElement) {
        // The engine outlives the page component, so a remount re-parents the
        // existing canvas rather than building a second renderer and loop.
        if (this.view) {
            host.appendChild(this.view.renderer.domElement)
            host.appendChild(this.view.overlay)
            this.view.resize()
            return
        }

        await loadModels()
        if (this.destroyed) return

        const view = new HackerzScene(host)
        this.view = view
        this.transient = new TransientFx(view.scene)
        view.scene.add(this.fieldRoot, this.particles.points)
        this.particles.setViewportHeight(view.height * view.renderer.getPixelRatio())

        this.rail.railRig = buildRig('turret-rail', CYAN, 1.8)
        this.rail.railRig.root.position.set(RAIL_U * FIELD_SCALE, WALL_HEIGHT, GUN_Z)
        view.scene.add(this.rail.railRig.root)

        // The magazine sits on the deck right behind the rail, cabled into it.
        this.rail.ammoRack = new AmmoRack(new THREE.Vector3(RAIL_U * FIELD_SCALE, WALL_HEIGHT + 0.25, GUN_Z + 0.7), CYAN)
        this.rail.ammoRack.group.position.set(RAIL_U * FIELD_SCALE, WALL_HEIGHT, GUN_Z + 3.3)
        // Big enough to read every capacitor and its trace from the camera.
        this.rail.ammoRack.group.scale.setScalar(1.3)
        this.rail.ammoRack.group.updateMatrixWorld(true)
        view.scene.add(this.rail.ammoRack.group)

        // The Longbore's track: a glowing rail across the deck it glides along, shown only while it is on.
        const trackLength = RAIL_TRACK * 2 * FIELD_SCALE + 1.6
        const track = new THREE.Group()
        const bar = new THREE.Mesh(
            new THREE.BoxGeometry(trackLength, 0.12, 0.3),
            new THREE.MeshBasicMaterial({ color: hdr(0x1a1030, 1), toneMapped: false })
        )
        track.add(bar)
        for (const side of [-1, 1]) {
            const lip = new THREE.Mesh(
                new THREE.BoxGeometry(trackLength, 0.05, 0.05),
                new THREE.MeshBasicMaterial({ color: hdr(LONGBORE_FLARE, 1.8), toneMapped: false })
            )
            lip.position.set(0, 0.07, side * 0.16)
            track.add(lip)
        }
        track.position.set(0, WALL_HEIGHT + 0.06, GUN_Z)
        track.visible = false
        this.rail.railTrack = track
        view.scene.add(track)

        // Chips and capacitors either side of the lane, marked by whoever holds their ground.
        this.laneProps = new LaneProps((intensity, packets) => view.territoryMaterial(intensity, packets))
        view.scene.add(this.laneProps.group)
        // The side hardware is fenced off; the nodes worth fighting over are on the path.
        this.guardrail = new Guardrail((intensity, packets) => view.territoryMaterial(intensity, packets))
        view.scene.add(this.guardrail.group)
        this.pathChips = new PathChips()
        this.pathChips.reset()
        this.network = buildNetwork(this.pathChips.ordered)
        view.setNetwork(this.network)
        view.scene.add(this.pathChips.group)
        this.linePulses = new LinePulses(this.particles)
        this.shrapnel = new Shrapnel(this.fieldRoot)
        this.glitchClouds = new GlitchClouds(this.fieldRoot)
        view.scene.add(this.linePulses.group)
        this.deployables = new Deployables()
        view.scene.add(this.deployables.group)
        this.terminals = new HackTerminals()
        view.scene.add(this.terminals.group)
        view.setMountsUsed(this.slots, [])

        this.resizeObserver = new ResizeObserver(() => {
            view.resize()
            this.particles.setViewportHeight(view.height * view.renderer.getPixelRatio())
        })
        this.resizeObserver.observe(host)

        if (!this.demo) this.attachInput()
        this.lastTime = performance.now()
        this.raf = requestAnimationFrame(this.loop)
        this.mounted = true
    }

    destroy() {
        this.destroyed = true
        this.running = false
        cancelAnimationFrame(this.raf)
        this.detachInput()
        this.resizeObserver?.disconnect()
        this.clearField()
        for (const mount of this.battery.turrets) disposeRig(mount.rig)
        this.battery.turrets = []
        if (this.rail.railRig) disposeRig(this.rail.railRig)
        this.transient?.clear()
        this.view?.dispose()
        this.view = null
    }

    /** Drops one enemy of a type onto the field: for tests, the demo boards and the debug menu. */
    debugSpawn(id: HackerzEnemyId, u?: number, d?: number) {
        this.spawn(hackerzEnemy(id))
        const enemy = this.enemies[this.enemies.length - 1]
        if (!enemy) return
        if (u !== undefined) enemy.u = u
        if (d !== undefined) enemy.d = d
        if (this.ridesNetwork(enemy)) this.attachToNetwork(enemy)
        enemy.age = 1
        placeEnemy(enemy)
    }

    // ─── Auto-play ───────────────────────────────────────────────────────────

    /**
     * The board as auto-play tells it to Laya (see `hackerz-autopilot`), with
     * the hostiles it may pick keyed `e0`, `e1`… in `contacts`: hackers at
     * work first, then whatever is closest to the wall. Nothing that cannot be
     * locked on is offered.
     */
    autopilotView(): { view: HackerzAutopilotView, contacts: Map<string, EnemyEntity> } {
        const loadout = this.loadout
        const chips = this.pathChips?.chips ?? []
        const live = this.enemies.filter(e => e.hp > 0 && !e.turned && !e.decoy && !this.combat.untargetable(e))
        live.sort((a, b) => Number(b.hacking) - Number(a.hacking) || Number(!!b.def.boss) - Number(!!a.def.boss) || a.d - b.d)
        const picked = live.slice(0, AUTOPILOT_CONTACTS)
        const contacts = new Map(picked.map((enemy, i) => [`e${i}`, enemy]))
        const hostile = this.enemies.filter(e => e.hp > 0 && !e.turned)
        return {
            contacts,
            view: {
                wave: this.wave,
                wall: this.bastion.wallMaxHp > 0 ? this.bastion.wallHp / this.bastion.wallMaxHp : 0,
                held: chips.filter(chip => chip.state === 'hacked').length,
                nodes: chips.length,
                contacts: picked.map((enemy, i) => ({
                    key: `e${i}`,
                    name: enemy.def.name,
                    boss: !!enemy.def.boss,
                    hacking: enemy.hacking,
                    hacker: enemy.def.id === HACKERZ_HACKER_ID,
                    d: enemy.d,
                    health: enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0,
                    plated: !!enemy.def.armored
                })),
                near: hostile.filter(e => e.d < AUTOPILOT_NEAR).length,
                hidden: hostile.filter(e => this.combat.inTheDark(e) || (!!e.def.cloaked && !e.decloaked && e.revealMs <= 0)).length,
                total: hostile.length,
                pulseReady: !!loadout?.pulseUnlocked && this.abilities.pulseCharge >= loadout.pulseCooldownMs,
                pingReady: this.abilities.pingCharge >= PING_COOLDOWN_MS,
                overclockReady: !!loadout?.overclockUnlocked && this.abilities.overclockLeft <= 0 && this.abilities.overclockCharge >= loadout.overclockCooldownMs
            }
        }
    }

    /** Auto-play locks the rail on `target` and holds the trigger, or lets go with none. */
    autopilotAim(target: EnemyEntity | null) {
        const live = !!target && target.hp > 0 && this.enemies.includes(target)
        this.rail.target = live ? target : null
        this.rail.lockSpot = null
        this.rail.holding = live
    }

    /**
     * The densest pack of ground hostiles: its centre, its size, the one in it
     * closest to the wall, and the one a White Hat would best turn. Null with
     * nothing on the ground.
     */
    private autopilotPack() {
        const best = densestGroup(this.enemies.filter(e => e.hp > 0 && !e.turned && !hackerzIsAirborne(e.def) && !this.combat.untouchable(e)))
        if (!best.length) return null
        const u = best.reduce((sum, e) => sum + e.u, 0) / best.length
        const d = best.reduce((sum, e) => sum + e.d, 0) / best.length
        const lead = best.reduce((top, e) => e.d < top.d ? e : top)
        const convert = best.filter(e => this.whiteHats.turnable(e)).sort((a, b) => b.maxHp - a.maxHp)[0] ?? null
        return { u, d, size: best.length, lead, convert }
    }

    /** Auto-play's deployable stock and the pack it would be used on. */
    autopilotStock() {
        const pack = this.autopilotPack()
        return {
            stock: { ...this.deployer.stock },
            pack: pack ? { size: pack.size, d: pack.d } : null,
            held: (this.pathChips?.chips ?? []).filter(chip => chip.state === 'hacked').length
        }
    }

    /**
     * Auto-play uses a deployable where it does the most: a Power Surge on the
     * densest pack, a Honeypot, Proxy Wall or Logic Bomb just ahead of it on
     * its way to the wall, a White Hat on the toughest hostile in it that can
     * be turned; Portscan and Cosmic Blip simply go off. True when one was spent.
     */
    autopilotDeploy(id: HackerzDeployableId) {
        if (!this.running || this.purging || this.paused || this.deployer.stock[id] <= 0) return false
        const before = this.deployer.stock[id]
        if (hackerzDeployable(id).instant) {
            this.deployer.useInstant(id)
            return this.deployer.stock[id] < before
        }
        const pack = this.autopilotPack()
        if (!pack) return false
        if (id === 'whitehat') {
            if (pack.convert) this.deployer.useWhiteHat(pack.convert)
            return this.deployer.stock[id] < before
        }
        this.rail.aimU = pack.u
        this.rail.aimD = pack.d - (AUTOPILOT_DEPLOY_AHEAD[id] ?? 0)
        const spot = this.deployer.deploySpot(id)
        this.deployer.drop(id, spot.u, spot.d, spot.chip)
        return true
    }

    /**
     * Auto-play fires blind: with nothing to lock on but hostiles hidden in
     * the dark, the rail holds its trigger on the middle of the densest of
     * them — where a player would spray. A cloaked unit is not aimed at: a
     * round passes through it. True when it is firing.
     */
    autopilotBlindFire() {
        const pack = densestGroup(this.enemies.filter(e => e.hp > 0 && !e.turned && !this.combat.untouchable(e) && this.combat.inTheDark(e)))
        if (!pack.length) return false
        const n = pack.length
        this.rail.target = null
        this.rail.lockSpot = {
            u: pack.reduce((sum, e) => sum + e.u, 0) / n,
            d: pack.reduce((sum, e) => sum + e.d, 0) / n,
            y: pack.reduce((sum, e) => sum + enemyCentreY(e), 0) / n
        }
        this.rail.holding = true
        return true
    }

    /** Auto-play fires an ability; each does nothing when it is not ready. */
    autopilotAbility(id: 'pulse' | 'ping' | 'overclock') {
        if (id === 'pulse') this.abilities.firePulse()
        else if (id === 'ping') this.abilities.firePing()
        else this.abilities.fireOverclock()
    }

    /** Advances the simulation by hand, in frames of `frameMs`. For a test harness only. */
    debugStep(ms: number, frameMs = 16.7) {
        for (let t = 0; t < ms; t += frameMs) this.tick(frameMs)
    }

    // ─── Database demo ───────────────────────────────────────────────────────

    /**
     * Mounts this engine as a Database demo: a quiet board that a script
     * drives. Nothing spawns on its own, the wave never ends, the wall never
     * falls, and no key or click reaches it — the real game may be running
     * underneath.
     */
    async mountDemo(host: HTMLDivElement, loadout: HackerzLoadout) {
        this.demo = true
        await this.mount(host)
        if (!this.mounted) return false
        this.startRun({ loadout })
        this.demoReset()
        return true
    }

    /**
     * Plays a script on the demo board, from the top and on a loop. `say`
     * hears each line it prints. Every loop is identical: the board, the
     * rolls and the clock all start over from the same seed.
     */
    demoPlay(script: DemoScript, loadout: HackerzLoadout, say: (line: string) => void) {
        if (!this.demo) return
        this.demoScript = script
        this.demoSay = say
        this.loadout = loadout
        this.demoReset()
    }

    /**
     * Fires the rail for the script: locked on the hostile nearest the fence
     * (and the next one when it falls), at the hacked node furthest out, or —
     * with null — not at all.
     */
    demoFire(at: 'lead' | 'node' | null) {
        if (!this.demo) return
        this.demoFiring = at
        this.rail.holding = at !== null
        if (!at) this.rail.target = null
    }

    /** Sets off one of the rail's abilities for the script, charged or not. */
    demoAbility(id: 'pulse' | 'overclock' | 'ping') {
        const loadout = this.loadout
        if (!this.demo || !loadout) return
        if (id === 'pulse') {
            this.abilities.pulseCharge = loadout.pulseCooldownMs
            this.abilities.firePulse()
        } else if (id === 'overclock') {
            this.abilities.overclockLeft = 0
            this.abilities.overclockCharge = loadout.overclockCooldownMs
            this.abilities.fireOverclock()
        } else {
            this.abilities.firePing(true)
        }
    }

    /**
     * Puts a hostile on the demo board that thinks for itself, as in a wave —
     * a hacker that goes for the nodes, a daemon that takes up a node's
     * guard. The board's seeded rolls keep what it decides the same every loop.
     */
    demoSpawnFree(id: HackerzEnemyId, u: number, d: number) {
        if (!this.demo) return
        this.debugSpawn(id, u, d)
        const enemy = this.enemies[this.enemies.length - 1]
        if (enemy) this.demoSettle(enemy)
    }

    /** Keeps the rail's lock for the script: on the next hostile when its mark falls, or on the outermost hacked node. */
    private demoAim() {
        if (this.demoFiring === 'lead') {
            if (this.rail.target && this.rail.target.hp > 0 && this.enemies.includes(this.rail.target)) return
            this.rail.target = this.enemies
                .filter(e => e.hp > 0 && !e.turned && !this.combat.untargetable(e))
                .sort((a, b) => a.d - b.d)[0] ?? null
        } else if (this.demoFiring === 'node') {
            const chip = this.pathChips?.ordered.find(c => c.state === 'hacked')
            this.rail.target = null
            if (chip) {
                this.rail.aimU = chip.u
                this.rail.aimD = chip.d
            }
        }
    }

    /** Puts the demo board back to a fresh, empty wave over the same seeded board: the script's loop point. */
    demoReset() {
        const loadout = this.loadout
        if (!this.demo || !loadout) return
        this.demoRng = seededRng(DEMO_SEED)
        withSeed(this.demoRng, () => {
            this.clearField()
            this.pathChips?.reset()
            this.network = buildNetwork(this.pathChips?.ordered ?? [])
            this.view?.setNetwork(this.network)
            this.territory.islands = []
            this.elapsedTotal = 0
            this.visualTime = 0
            this.startWave(1, loadout)
            this.schedule = []
            this.waveMs = Infinity
            // A wave carries the wall's damage over; a demo loop starts whole,
            // and so do the guns on it: no reload or aim left from the last loop.
            this.bastion.wallHp = this.bastion.wallMaxHp
            this.bastion.shield = this.bastion.shieldMax
            // The rail, the barrier's regen clock and the kill chain start fresh too.
            this.rail.railHeading = Math.PI
            this.rail.railU = RAIL_U
            this.rail.railKick = 0
            this.bastion.msSinceWallHit = 99_999
            this.bastion.shieldHit = 0
            this.scoring.chain = 0
            this.scoring.totalKills = 0
            this.abilities.pingCharge = PING_COOLDOWN_MS
            // Dark zones fade in and out: one lit in the last scene must not still be fading here.
            for (const zone of this.territory.darkZones) Object.assign(zone, { u: 0, d: 0, r: 0, strength: 0, on: false })
            this.territory.darkness = 0
            // Their ground pours rather than jumps, so it is poured back out to the portal: no red left over.
            this.view?.redLine.fill(FIELD_DEPTH)
            this.view?.orangeLine.fill(FIELD_DEPTH)
            // Reused or freshly built, every mount starts as a new one stands: facing home, ready to fire.
            for (const mount of this.battery.turrets) {
                mount.cooldown = 0
                mount.kick = 0
                mount.heading = Math.PI
                mount.frozenMs = 0
            }
        })
        this.overlay.clear()
        this.demoTime = 0
        this.demoNext = 0
        this.demoAccumMs = 0
        this.demoFocus = null
        this.demoZoom = 1
        this.demoSnap = true
        this.demoFire(null)
        this.demoSay?.('')
    }

    /**
     * A demo board steps at a fixed rate, whatever the display does, and its
     * script fires on that clock — so a slow frame never changes what happens.
     */
    private demoFrame(rawMs: number) {
        // The models' clock is shared with the game that may be running
        // underneath: the demo drives it on its own time while it steps (its
        // poses are part of what it replays), then hands the game's back.
        const gameClock = modelClock.value
        try {
            this.demoSteps(rawMs)
        } finally {
            modelClock.value = gameClock
        }
    }

    private demoSteps(rawMs: number) {
        this.demoAccumMs = Math.min(this.demoAccumMs + rawMs, DEMO_STEP_MS * 4)
        while (this.demoAccumMs >= DEMO_STEP_MS) {
            this.demoAccumMs -= DEMO_STEP_MS
            const script = this.demoScript
            if (script && this.demoTime >= script.length) this.demoReset()
            const rng = this.demoRng
            if (!rng) return
            withSeed(rng, () => {
                this.demoTime += DEMO_STEP_MS
                const steps = this.demoScript?.steps ?? []
                while (this.demoNext < steps.length && steps[this.demoNext]!.at <= this.demoTime) {
                    const step = steps[this.demoNext++]!
                    if (step.say !== undefined) this.demoSay?.(step.say)
                    step.run?.(this)
                }
                this.demoAim()
                this.tick(DEMO_STEP_MS)
            })
        }
    }

    /**
     * Points the demo camera at a spot on the board, or back to following the
     * hostiles with null. `zoom` above 1 pulls it back to take in more: the
     * fence and the guns on it, or a run of nodes.
     */
    demoLook(at: { u: number, d: number } | null, zoom = 1) {
        this.demoFocus = at
        this.demoZoom = zoom
    }

    /**
     * The demo's camera: in close behind whatever the script is showing — a
     * spot it named, or else the middle of the hostiles on the board — and
     * easing after it as they move.
     */
    private demoCamera(dt: number) {
        const view = this.view
        if (!view) return
        let u = 0
        let d = FIELD_DEPTH * 0.5
        const live = this.enemies.filter(e => e.hp > 0)
        if (this.demoFocus) {
            u = this.demoFocus.u
            d = this.demoFocus.d
        } else if (live.length) {
            u = live.reduce((sum, e) => sum + e.u, 0) / live.length
            d = live.reduce((sum, e) => sum + e.d, 0) / live.length
        }
        const aim = fieldToWorld(u, d, 0, _v)
        view.cameraTarget.lerp(aim, this.demoSnap ? 1 : 1 - Math.exp(-dt * 2.2))
        view.cameraHome.copy(view.cameraTarget).addScaledVector(DEMO_CAMERA_OFFSET, this.demoZoom)
        this.demoSnap = false
    }

    /**
     * Puts a hostile on the demo board at the first waypoint of `path`; it
     * walks the rest in order, off the network and out of its own judgement.
     */
    demoSpawn(id: HackerzEnemyId, path: { u: number, d: number }[]) {
        const start = path[0]
        if (!this.demo || !start) return
        // Set down where it stands, as a hatching spiderling is: it resolves out
        // of the dark on the spot, and the portal shows nothing of it.
        this.spawn(hackerzEnemy(id), false, 1, start)
        const enemy = this.enemies[this.enemies.length - 1]
        if (!enemy) return
        enemy.route = null
        enemy.demoPath = path.slice(1).map(point => ({ ...point }))
        this.demoSettle(enemy)
        placeEnemy(enemy)
    }

    /**
     * A spawn starts its walk cycle and a flyer its bob at a cosmetic random
     * phase; on a demo board those come from the seeded roll too — a flyer's
     * bob is where shots aim — so the replay matches.
     */
    private demoSettle(enemy: EnemyEntity) {
        enemy.stride = randomFloat() * Math.PI * 2
        enemy.hover = randomFloat() * Math.PI * 2
    }

    /** Hands the `count` outermost nodes to the intrusion. */
    demoHack(count: number) {
        const chips = this.pathChips
        if (!this.demo || !chips) return
        const taken = chips.ordered.slice(0, count)
        for (const chip of taken) chips.landPulse(chip, 1)
        if (taken.length) {
            this.demoLook({
                u: taken.reduce((sum, chip) => sum + chip.u, 0) / taken.length,
                d: taken.reduce((sum, chip) => sum + chip.d, 0) / taken.length
            })
        }
    }

    /**
     * Uses a deployable on the demo board as a player would: placed at (u, d),
     * fired on the spot when it has nothing to aim, or — a White Hat — put on
     * the hostile nearest (u, d). The demo's stock never runs out.
     */
    demoDeploy(id: HackerzDeployableId, u: number, d: number) {
        if (!this.demo) return
        this.deployer.stock[id] = HACKERZ_DEPLOYABLE_MAX
        if (hackerzDeployable(id).instant) {
            this.deployer.useInstant(id)
            return
        }
        if (id === 'whitehat') {
            const pick = this.enemies
                .filter(e => this.whiteHats.turnable(e))
                .sort((a, b) => Math.hypot(a.u - u, a.d - d) - Math.hypot(b.u - u, b.d - d))[0]
            this.deployer.useWhiteHat(pick ?? null)
            return
        }
        // Exactly where the script says: no snapping to a line or a node.
        this.deployer.drop(id, u, d, null)
    }

    private loop = (now: number) => {
        if (this.destroyed) return
        this.raf = requestAnimationFrame(this.loop)
        const rawMs = now - this.lastTime
        this.lastTime = now
        if (this.demo) this.demoFrame(rawMs)
        else this.tick(rawMs)
    }

    // ─── Input ───────────────────────────────────────────────────────────────

    private attachInput() {
        const view = this.view
        if (!view) return
        const canvas = view.renderer.domElement

        const local = (event: PointerEvent | MouseEvent) => {
            const rect = canvas.getBoundingClientRect()
            return { x: event.clientX - rect.left, y: event.clientY - rect.top }
        }

        // A second button pressed or let go while another is held does not
        // raise its own pointerdown/pointerup: it arrives as a pointermove with
        // `button` set. Firing with one hand and pinging with the other needs
        // both, so every button change goes through `press` and `lift`.
        const onPointerMove = (event: PointerEvent) => {
            const p = local(event)
            this.setAimFromScreen(p.x, p.y)
            canvas.style.cursor = !this.deployer.armed && this.pickEnemy(p.x, p.y) ? 'pointer' : 'crosshair'
            if (this.deployer.armed) this.deployer.showGhost(this.deployer.armed)
            if (event.button < 0) return
            if (event.buttons & (1 << buttonBit(event.button))) press(event)
            else lift(event)
        }
        const buttonBit = (button: number) => button === 1 ? 2 : button === 2 ? 1 : button
        const onPointerDown = (event: PointerEvent) => press(event)
        const press = (event: PointerEvent) => {
            if (event.button === 2) {
                // Right click puts an armed deployable away; otherwise it pings.
                if (this.deployer.armed) this.deployer.arm(null)
                else this.abilities.firePing()
                return
            }
            if (event.button !== 0) return
            const p = local(event)
            // A White Hat is aimed at a hostile, not at the ground.
            if (this.deployer.armed === 'whitehat') {
                this.deployer.useWhiteHat(this.pickEnemy(p.x, p.y))
                return
            }
            if (this.deployer.armed) {
                this.setAimFromScreen(p.x, p.y)
                this.deployer.placeArmed()
                return
            }
            const frozen = this.battery.pickFrozenTurret(p.x, p.y)
            if (frozen) {
                this.battery.thaw(frozen)
                return
            }
            this.setAimFromScreen(p.x, p.y)
            // Press fires; holding keeps firing. Pressed on a hostile, the rail
            // tracks it for as long as the button stays down — though not
            // through a packet-loss spike, which drops every lock.
            this.rail.lockSpot = null
            this.rail.target = this.lag.boardLagMs > 0 ? null : this.pickEnemy(p.x, p.y)
            this.rail.holding = true
            this.rail.queuedShot = true
        }
        const release = () => {
            this.rail.holding = false
            this.rail.target = null
            this.rail.lockSpot = null
        }
        // Only letting go of the fire button stops the fire: a ping released
        // mid-burst leaves it running.
        const lift = (event: PointerEvent) => {
            if (event.button === 0) release()
        }
        const onPointerUp = (event: PointerEvent) => lift(event)
        const onBlur = release
        const onContextMenu = (event: MouseEvent) => event.preventDefault()

        const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase()
            if (key === 'r') this.rail.beginReload()
            if (key === 'escape') {
                this.rail.target = null
                this.deployer.arm(null)
            }
            const deploy = DEPLOY_KEYS[key]
            // One with nothing to aim (a Portscan, a Cosmic Blip) goes off at once.
            if (deploy && hackerzDeployable(deploy).instant) this.deployer.useInstant(deploy)
            else if (deploy) this.deployer.arm(this.deployer.armed === deploy ? null : deploy)
            if (key === ' ') {
                // Space scrolls the page by default, which is fatal for a key
                // the player mashes under pressure.
                if (this.running) event.preventDefault()
                this.abilities.firePulse()
            }
            if (key === 'q') this.abilities.fireOverclock()
        }

        canvas.addEventListener('pointermove', onPointerMove)
        canvas.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('blur', onBlur)
        window.addEventListener('keydown', onKeyDown)
        canvas.addEventListener('contextmenu', onContextMenu)

        this.listeners = [
            () => canvas.removeEventListener('pointermove', onPointerMove),
            () => canvas.removeEventListener('pointerdown', onPointerDown),
            () => window.removeEventListener('pointerup', onPointerUp),
            () => window.removeEventListener('blur', onBlur),
            () => window.removeEventListener('keydown', onKeyDown),
            () => canvas.removeEventListener('contextmenu', onContextMenu)
        ]
    }

    private detachInput() {
        for (const off of this.listeners) off()
        this.listeners = []
    }

    /** Casts the cursor onto the ground plane and stores it as a field point. */
    private setAimFromScreen(x: number, y: number) {
        const view = this.view
        if (!view) return
        const ndc = new THREE.Vector2(x / view.width * 2 - 1, -(y / view.height) * 2 + 1)
        this.raycaster.setFromCamera(ndc, view.camera)
        const hit = this.raycaster.ray.intersectPlane(this.groundPlane, _v)
        if (!hit) return
        this.rail.aimU = hit.x * PER_WORLD
        this.rail.aimD = Math.max(20, -hit.z * PER_WORLD)
    }

    /**
     * The hostile under the cursor. Each unit's whole model bounding box is
     * projected to the screen and the cursor tested against that rectangle,
     * so a light cycle can be grabbed by its tail as well as its middle. Tiny
     * far-off units get a minimum target size: missing the click is not skill.
     * Where rectangles overlap, the unit nearest the fence wins.
     */
    private pickEnemy(x: number, y: number) {
        const view = this.view
        if (!view) return null
        let best: EnemyEntity | null = null
        const screen = { x: 0, y: 0 }
        for (const enemy of this.enemies) {
            // Nothing in the dark can be picked out to lock on: fire blind instead.
            if (this.combat.untargetable(enemy)) continue
            const root = enemy.rig.root
            root.updateMatrixWorld()
            const box = enemy.rig.box
            let minX = Infinity
            let minY = Infinity
            let maxX = -Infinity
            let maxY = -Infinity
            let visible = false
            for (let c = 0; c < 8; c++) {
                _v.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z)
                    .applyMatrix4(root.matrixWorld)
                if (!view.project(_v, screen)) continue
                visible = true
                minX = Math.min(minX, screen.x)
                maxX = Math.max(maxX, screen.x)
                minY = Math.min(minY, screen.y)
                maxY = Math.max(maxY, screen.y)
            }
            if (!visible) continue
            const pad = 6
            const cx = (minX + maxX) / 2
            const cy = (minY + maxY) / 2
            const halfW = Math.max(PICK_SLACK_PX, (maxX - minX) / 2 + pad)
            const halfH = Math.max(PICK_SLACK_PX, (maxY - minY) / 2 + pad)
            if (Math.abs(x - cx) > halfW || Math.abs(y - cy) > halfH) continue
            if (!best || enemy.d < best.d) best = enemy
        }
        return best
    }

    // ─── Run control ─────────────────────────────────────────────────────────

    /**
     * Wipes the field and the bastion back to the start of a run. `wallHp` and
     * `kills` are how a saved run comes back: the save is only written between
     * waves, so restoring one is restoring the bastion and the armoury.
     */
    startRun(config: HackerzStartConfig) {
        if (!this.mounted) return false
        const { loadout } = config
        this.clearField()
        this.sysLog.reset()
        this.loadout = loadout
        this.rail.weapon = loadout.weapon
        this.rail.ammoRack?.setColour(loadout.weapon.hex)
        this.wave = 0
        this.waveElapsed = 0
        this.scoring.totalKills = config.kills ?? 0
        this.scoring.chain = 0
        this.scoring.emitChain()
        // A fresh board each run: nodes first, then the lines laid around them.
        this.pathChips?.reset()
        this.network = buildNetwork(this.pathChips?.ordered ?? [])
        this.view?.setNetwork(this.network)
        this.territory.islands = []
        this.gameOver = false
        this.purging = false
        this.running = false
        this.bastion.wallMaxHp = loadout.wallMaxHp
        this.bastion.wallHp = clamp(config.wallHp ?? loadout.wallMaxHp, 1, loadout.wallMaxHp)
        this.bastion.shieldMax = loadout.shieldMax
        this.bastion.shield = loadout.shieldMax
        this.abilities.pulseCharge = loadout.pulseCooldownMs
        this.abilities.overclockCharge = loadout.overclockCooldownMs
        this.abilities.overclockLeft = 0
        this.rail.magSize = Math.round(loadout.weapon.magazine)
        this.rail.mag = this.rail.magSize
        this.rail.reloadTimer = 0
        this.rail.tarpitDrain = 0
        this.slots = loadout.slots
        this.battery.syncTurrets()
        this.bastion.emitWall()
        this.rail.emitAmmo()
        return true
    }

    /**
     * Applies the uplink's new loadout and releases the next wave. Max-health
     * upgrades are handed out as healing rather than headroom — buying Integrity
     * mid-run should feel like reinforcing the wall.
     */
    startWave(wave: number, loadout: HackerzLoadout, event: HackerzEventId | null = null) {
        if (!this.mounted || this.gameOver) return false
        // A bonus round is a sandbox for the board too: it is fought over fresh
        // nodes, and the run's own territory comes back untouched afterwards.
        if (event && !this.bonus) {
            this.bonusChips = this.pathChips?.snapshot() ?? null
            this.pathChips?.restore(null)
            // Every bonus round comes in over a board that is already theirs,
            // and locked: a 30-second round has no time for a fight over the
            // nodes, only for holding the wall. (A locked board puts no lights
            // out either — only the Blackout itself is dark.)
            if (this.pathChips) {
                this.pathChips.takeAll()
                this.pathChips.locked = true
            }
        }
        this.bonus = event
        if (event) this.sight(event)
        this.finalPush = false
        this.hackerTimer = 0
        this.hackerField = 0
        this.decoysLogged = false
        this.sysLog.clock = 0
        this.sysLog.waveStart(wave, event)
        this.waveMs = event ? HACKERZ_BONUS_MS : HACKERZ_WAVE_MS
        this.bastion.bonusFailed = false
        this.deployer.stock = { ...loadout.deployables }
        this.deployables?.clear()
        this.linePulses?.clear()
        this.deployer.arm(null)
        const previousMax = this.bastion.wallMaxHp
        this.loadout = loadout
        this.rail.weapon = loadout.weapon
        this.rail.ammoRack?.setColour(loadout.weapon.hex)
        this.bastion.wallMaxHp = loadout.wallMaxHp
        if (loadout.wallMaxHp > previousMax) this.bastion.wallHp += loadout.wallMaxHp - previousMax
        this.bastion.wallHp = clamp(this.bastion.wallHp, 1, this.bastion.wallMaxHp)
        this.bastion.shieldMax = loadout.shieldMax
        this.bastion.shield = loadout.shieldMax
        this.rail.magSize = Math.round(loadout.weapon.magazine)
        this.rail.mag = this.rail.magSize
        this.rail.reloadTimer = 0
        this.rail.tarpitDrain = 0
        this.rail.fireTimer = 0
        this.abilities.pulseCharge = loadout.pulseCooldownMs
        this.abilities.overclockCharge = loadout.overclockCooldownMs
        this.abilities.overclockLeft = 0
        this.slots = loadout.slots
        this.battery.syncTurrets()
        for (const mount of this.battery.turrets) if (mount.frozenMs > 0) this.battery.thaw(mount)

        this.wave = wave
        this.waveElapsed = 0
        this.scoring.waveKills = 0
        this.scoring.waveCredits = 0
        this.scoring.waveCoins = 0
        this.scheduleIndex = 0
        this.schedule = this.buildSchedule(wave)
        this.running = true
        this.purging = false
        this.paused = false
        this.rail.target = null
        // A bonus round is a sandbox: whatever it does to the wall is undone.
        this.bastion.bonusStartHp = this.bastion.wallHp
        this.bastion.bonusStartShield = this.bastion.shield

        if (event) {
            const def = hackerzNetworkEvent(event)
            this.overlay.banner(`BONUS · ${def.name}`, def.hex,
                `hold above ${Math.round(HACKERZ_BONUS_PASS_INTEGRITY * 100)}% for ×${HACKERZ_BONUS_MULTIPLIER} credits`)
        } else {
            const final = wave >= HACKERZ_MAX_WAVE
            this.overlay.banner(
                final ? 'FINAL WAVE' : `WAVE ${wave}`,
                final || hackerzIsBossWave(wave) ? RED : CYAN,
                `${this.schedule.length} hostiles queued`
            )
        }
        this.bastion.emitWall()
        this.rail.emitAmmo()
        this.abilities.emitPulse()
        this.abilities.emitOverclock()
        this.callbacks.onSound?.('wave-start')
        return true
    }

    /**
     * Hot-swaps the active weapon mid-wave. The magazine comes back full but the
     * swap costs a short reload, so switching is a decision rather than free.
     */
    swapWeapon(weapon: HackerzWeaponRuntime) {
        if (!this.loadout) return
        this.loadout = { ...this.loadout, weapon }
        this.rail.weapon = weapon
        this.rail.ammoRack?.setColour(weapon.hex)
        this.rail.magSize = Math.round(weapon.magazine)
        this.rail.mag = this.rail.magSize
        this.rail.reloadTimer = this.running ? Math.min(600, weapon.reloadMs) : 0
        this.rail.fireTimer = 0
        this.callbacks.onWeapon(weapon.id)
        this.rail.emitAmmo()
        this.callbacks.onSound?.('weapon-swap')
    }

    // ─── Deployables ─────────────────────────────────────────────────────────

    /** See `Deployer.arm`. */
    arm(id: HackerzDeployableId | null) {
        return this.deployer.arm(id)
    }

    // ─── Consumables: Portscan, Cosmic Blip, White Hat, Power Surge ──────────

    /** Reports a hostile type or bonus round the first time it turns up; a demo board never does. */
    private sight(id: string) {
        if (this.demo || this.sighted.has(id)) return
        this.sighted.add(id)
        this.callbacks.onSighted?.(id)
    }

    /** Uplink purchase — patches the wall back to full between waves. */
    repairWall() {
        this.bastion.wallHp = this.bastion.wallMaxHp
        this.bastion.emitWall()
    }

    pause() {
        this.paused = true
        this.rail.holding = false
    }

    resume() {
        this.paused = false
    }

    get isRunning() {
        return this.running
    }

    /** Current wall health, for a save written from the uplink. */
    get currentWallHp() {
        return Math.round(this.bastion.wallHp)
    }

    // ─── Wave scheduling ─────────────────────────────────────────────────────

    /**
     * Spends the wave's budget up front and spreads the result over the spawn
     * window. Deciding the whole wave at once is what lets the HUD promise a
     * hostile count the wave actually delivers.
     */
    private buildSchedule(wave: number): ScheduledSpawn[] {
        const difficulty = this.loadout?.difficulty
        if (!difficulty) return []
        // DDoS floods the lane with the cheap half of the roster; every event
        // packs its budget into the shorter bonus window.
        const fullPool = hackerzWavePool(wave)
        const pool = this.bonus === 'ddos'
            ? [...fullPool].sort((a, b) => a.cost - b.cost).slice(0, Math.max(1, Math.ceil(fullPool.length / 2)))
            : fullPool
        // DDoS sends a standard wave's worth before the final push, and saves
        // its surge for the push itself (see `ddosSurge`).
        let budget = hackerzWaveBudget(wave, difficulty) * (this.bonus && this.bonus !== 'ddos' ? 0.85 : 1)
        const window = this.bonus === 'ddos'
            ? this.waveMs - FINAL_PUSH_MS
            : this.bonus ? HACKERZ_BONUS_MS - 6000 : HACKERZ_SPAWN_WINDOW_MS
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

        if (!this.bonus && hackerzIsBossWave(wave)) {
            // The boss walks in early — it is slow, and a boss purged before it
            // reached the wall would be a wave with no climax.
            spawns.push({ atMs: 900, def: hackerzEnemy(hackerzBossFor(wave)) })
        }
        if (this.bonus === 'ddos') spawns.push(...this.ddosSurge(wave, pool))
        if (this.bonus === 'packetloss') spawns.push(...this.packetLossSwarm(wave, pool, picks, window))

        return spawns.sort((a, b) => a.atMs - b.atMs)
    }

    /**
     * What the player can put out a second, near enough: the rail (with its
     * crits) plus every mounted turret, splash counted once.
     */
    private firepower() {
        const loadout = this.loadout
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
        const difficulty = this.loadout?.difficulty
        if (!difficulty || !pool.length) return []
        const needed = this.firepower() * (FINAL_PUSH_MS / 1000) * DDOS_SURGE_OVERKILL
        const start = this.waveMs - FINAL_PUSH_MS
        const end = this.waveMs - 1500
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
        const difficulty = this.loadout?.difficulty
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
    private isHeavy(def: HackerzEnemyDefinition) {
        return def.armored || !!def.boss
    }

    // ─── Main loop ───────────────────────────────────────────────────────────

    private tick(rawMs: number) {
        const view = this.view
        if (this.destroyed || !view) return
        // A backgrounded tab hands back one enormous frame on return; stepping
        // physics by it teleports every enemy through the wall.
        const dtMs = Math.min(rawMs, 50)
        const dt = dtMs / 1000
        this.elapsedTotal += dtMs

        const live = !this.paused && !this.gameOver
        // PACKET LOSS: during a lag spike the whole picture holds — every
        // animation, every shader clock — while the game itself runs on.
        if (live) this.lag.updateBoardLag(dtMs)
        const frozen = live && this.lag.boardLagMs > 0
        this.lag.muteFx(frozen)
        const seen = frozen ? 0 : dt
        if (!frozen) this.visualTime += dtMs
        // The model clock is shared; a demo board hands it back after its own steps (see `demoFrame`).
        modelClock.value = this.visualTime / 1000
        if (live) {
            if (this.running && !this.purging) {
                // A lag spike stops the clock too, but not the hostiles: they
                // gain ground on the wave timer while the picture holds.
                if (!frozen) this.waveElapsed += dtMs
                this.sysLog.tick(this.waveElapsed, this.enemies.length)
                this.releaseScheduled()
                // A demo board brings on only what its script spawns.
                if (!this.demo) {
                    this.maintainHackers(dtMs)
                    this.maintainDistraction(dtMs)
                    this.maintainBearers(dtMs)
                    this.maintainEscorts(dtMs)
                }
                this.maintainDefenders()
                this.rootkit.hatchInfected(dtMs)
                this.rail.updateWeapon(dtMs)
                this.abilities.updateAbilities(dtMs)
                if (!this.finalPush && this.waveElapsed >= this.waveMs - FINAL_PUSH_MS) this.beginFinalPush()
                if (this.waveElapsed >= this.waveMs) this.beginPurge()
            }
            this.deployer.updateDeployables(dt)
            this.updateEnemies(dt, dtMs)
            this.projectiles.updateBullets(dt)
            this.projectiles.updateSpits(dt)
            this.blackIce.updateIce(dt)
            if (this.running && !this.purging) this.deployer.updateSurges(dtMs)
            this.battery.updateTurrets(dtMs, frozen)
            this.scoring.updateCoins(frozen ? 0 : dtMs)
            this.bastion.updateBastion(dt, dtMs)
            this.memory.updateLeaks(dt, frozen ? 0 : dtMs)
            this.hacking.updateHackPulses(dt)
            this.pathChips?.update(seen)
            this.linePulses?.update(seen, (u, d) => this.hacking.pulseFade(u, d))
            this.shrapnel?.update(seen)
            this.glitchClouds?.update(seen)
            this.particles.update(seen)
            this.transient?.update(seen)
        }
        this.guardrail?.update(live ? seen : 0)
        this.terminals?.update(live ? seen : 0, view.camera)
        this.rail.updateRail(frozen ? 0 : dt)
        this.updateCamera(dt)
        this.territory.updateTerritory(live ? seen : 0)
        const reload = this.rail.reloadTimer > 0 && this.rail.weapon ? 1 - this.rail.reloadTimer / this.rail.weapon.reloadMs : 1
        this.rail.ammoRack?.update(live ? seen : 0, this.rail.mag, this.rail.magSize, reload)
        this.laneProps?.update(live ? seen : 0, view.redLine, view.orangeLine)
        this.combat.updateDying(live ? seen : 0)
        view.ageSurges(live ? seen : 0)

        // The grid goes dark while the gun reloads: it has no power then.
        view.trapMaterial.uniforms.uLevel!.value = (this.loadout?.spikeDps ?? 0) > 0 && this.rail.tarpitPowered ? 1 : 0
        view.shieldMaterial.uniforms.uStrength!.value = this.bastion.shieldMax > 0 ? this.bastion.shield / this.bastion.shieldMax : 0
        view.shieldMaterial.uniforms.uHit!.value = this.bastion.shieldHit
        // With every node theirs the ground right up to the deck and the barrier
        // lattice turn disputed orange, and the fence's own glow dims.
        this.territory.overrun += ((this.allNodesTaken ? 1 : 0) - this.territory.overrun) * Math.min(1, dt * 1.5)
        view.gate.value = this.territory.overrun
        view.setWallState(this.bastion.wallMaxHp > 0 ? this.bastion.wallHp / this.bastion.wallMaxHp : 1, this.bastion.wallFlash, this.territory.overrun)

        // BLACKOUT: the lights go down and the fog closes in, eased both ways.
        const dark = this.bonus === 'blackout' && this.running ? 1 : 0
        this.territory.darkness += (dark - this.territory.darkness) * Math.min(1, dt * 1.2)
        view.renderer.toneMappingExposure = 1.05 - 0.5 * this.territory.darkness
        // The hostiles' shroud follows the same dark: the zones, and the Blackout.
        shroud.dark.value = view.darkZones
        shroud.blackout.value.set(this.territory.darkness, -BLACKOUT_LIGHT_D * FIELD_SCALE)
        const fog = view.scene.fog as THREE.Fog | null
        if (fog) {
            fog.near = 45 - 27 * this.territory.darkness
            fog.far = 120 - 58 * this.territory.darkness
        }

        if (this.demo) this.demoCamera(dt)
        view.render(frozen ? 0 : dt, this.shake)
        this.drawOverlay(frozen ? 0 : dt)

        if (this.running && live) {
            this.callbacks.onWaveTime(Math.max(0, this.waveMs - this.waveElapsed), this.enemies.length)
        }
    }

    private updateCamera(dt: number) {
        this.shake = this.shake > 0.005 ? Math.max(0, this.shake - this.shake * SHAKE_DECAY * dt) : 0
    }

    // ─── Shield bearers ──────────────────────────────────────────────────────

    /** A dark zone calls up the shield wall; `maintainBearers` sends the bulwarks. */
    sendShieldBearers() {
        this.bearerTimer = 0
        const front = this.frontierChips()[0]
        if (front) {
            this.callbacks.onNotice('A shield wall is moving up to guard their nodes.', 'bad')
            this.sysLog.shieldWall(front.id)
        }
    }

    /**
     * While a dark zone stands, the portal keeps its shield wall manned:
     * `BEARERS_PER_ZONE` bulwarks per zone (up to `BEARERS_MAX`), each slain
     * one replaced, a beat apart. Top-ups like the hackers: half the credits,
     * no coins.
     */
    private maintainBearers(dtMs: number) {
        this.bearerTimer -= dtMs
        // Nothing to shield on a locked board: its nodes cannot be taken back.
        if (this.bearerTimer > 0 || this.pathChips?.locked) return
        const zones = this.territory.darkZones.filter(zone => zone.on).length
        const wanted = Math.min(BEARERS_MAX, zones * BEARERS_PER_ZONE)
        if (!wanted || !this.frontierChips().length) return
        if (this.enemies.filter(e => e.bearer).length >= wanted) return
        this.bearerTimer = BEARER_RESPAWN_MS
        this.spawn(hackerzEnemy(BEARER_ID), true)
        const bearer = this.enemies[this.enemies.length - 1]
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
    private maintainDefenders() {
        const chips = this.pathChips?.chips ?? []
        // A locked board's nodes cannot be taken back, so nobody guards them;
        // and a bonus round is a rush besides.
        const holding = !this.finalPush && !this.bonus && !this.pathChips?.locked
        for (const enemy of this.enemies) {
            if (enemy.defending && (!holding || enemy.defending.state !== 'hacked')) enemy.defending = null
        }
        if (!holding) return
        for (const chip of chips) {
            if (chip.state !== 'hacked') continue
            if (this.enemies.some(e => e.defending === chip)) continue
            let pick: EnemyEntity | null = null
            for (const enemy of this.enemies) {
                if (!this.canDefend(enemy)) continue
                if (Math.hypot(enemy.u - chip.u, enemy.d - chip.d) > DEFEND_RADIUS) continue
                if (!pick || enemy.maxHp < pick.maxHp) pick = enemy
            }
            if (!pick) continue
            pick.defending = chip
            this.sight('defender')
        }
    }

    /**
     * Late in the run every hacker brings bodyguards: weak walkers that keep
     * themselves between it and the rail and soak the fire meant for it. A
     * guard that falls is replaced by the nearest free weakling, or, with none
     * to hand, by a fresh one from the portal — a top-up like the hackers
     * themselves: half the credits, no coins.
     */
    private maintainEscorts(dtMs: number) {
        this.escortTimer -= dtMs
        const perHacker = this.wave >= ESCORT_DOUBLE_WAVE ? 2 : this.wave >= ESCORT_FROM_WAVE ? 1 : 0
        const wanted = (hacker: EnemyEntity) => this.bonus ? 0 : Math.max(perHacker, this.isVanguard(hacker) ? 1 : 0)
        const live = new Set(this.enemies)
        for (const enemy of this.enemies) {
            const charge = enemy.escorting
            if (charge && (!live.has(charge) || charge.hp <= 0 || !wanted(charge))) enemy.escorting = null
        }
        if (this.bonus) return
        for (const hacker of this.enemies) {
            if (hacker.def.id !== HACKERZ_HACKER_ID || hacker.decoy) continue
            const want = wanted(hacker)
            let guards = this.enemies.filter(e => e.escorting === hacker).length
            if (guards > 0) this.sight('bodyguard')
            while (guards < want) {
                // A hacker pushing past the gate drags one of the node
                // defenders along as its shield before it drafts anyone else.
                const hostage = this.isVanguard(hacker) && guards === 0 ? this.nearestDefender(hacker) : null
                if (hostage) {
                    hostage.defending = null
                    hostage.escorting = hacker
                    guards++
                    this.sysLog.hostage(hacker.def.id, hostage.def.id)
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
                this.spawn(hackerzEnemy(ESCORT_ID), true)
                const fresh = this.enemies[this.enemies.length - 1]
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
        const gate = this.pathChips?.ordered[0]
        const pick = hacker.targetChip
        return !!gate && gate.state !== 'hacked' && !!pick && pick !== gate && pick.state !== 'hacked'
    }

    /** The nearest unit within reach standing guard at a node, to be taken along as a shield. */
    private nearestDefender(hacker: EnemyEntity) {
        let best: EnemyEntity | null = null
        let bestDistance = ESCORT_REACH
        for (const enemy of this.enemies) {
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
        for (const enemy of this.enemies) {
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
        const rank = Math.max(0, this.enemies.filter(e => e.escorting === hacker).indexOf(enemy))
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
        const guards = (chip: PathChip) => this.enemies.filter(e => e.bearer && e.targetChip === chip).length
        return front.reduce<PathChip | null>((best, chip) => !best || guards(chip) < guards(best) ? chip : best, null)
    }

    /**
     * A bearer's chip: it follows the frontier as it moves, and when the node it
     * guards is taken back it has nothing left to stand for — it disintegrates.
     * True when the bearer is gone.
     */
    private keepBearerPost(enemy: EnemyEntity, index: number) {
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
        const enemy = this.enemies[index]
        if (!enemy) return
        const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.particles.burst(at, enemy.def.hex, 40, 10, { size: 0.3, life: 0.7 })
        const ground = fieldToWorld(enemy.u, enemy.d, 0.05, new THREE.Vector3())
        for (let b = 0; b < 4; b++) {
            this.transient?.bolt(at, ground.clone().add(_w.set(randRange(-1, 1), 0, randRange(-1, 1))), enemy.def.hex)
        }
        this.view?.addSurge(ground.x, ground.z, enemy.def.hex, 1)
        this.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'DISINTEGRATED', enemy.def.hex, 1)
        this.combat.removeEnemy(index, true)
    }

    /**
     * The frontier: the hacked nodes nearest the fence, the ones the player is
     * most likely to try and take back.
     */
    private frontierChips() {
        return (this.pathChips?.chips ?? [])
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
        const rank = this.enemies.filter(e => e.bearer && e.targetChip === chip).indexOf(enemy)
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
        for (const other of this.enemies) {
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
     * A ranged unit that has set up within reach of a node picks a firing spot
     * to one side of it instead, clear of every node, and parks there. True
     * when it has just been sent to step aside.
     */
    private parkAside(enemy: EnemyEntity) {
        if (enemy.def.kind !== 'ranged' || enemy.parked) return false
        const chips = this.pathChips?.chips ?? []
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

    /**
     * A demo unit walks the waypoints its script gave it instead of thinking
     * for itself, but the board still has its say: a honeypot in range draws
     * it in, a proxy wall stops it at its line, and the fence stops it at its
     * standoff. Arrived once it is where its blows land.
     */
    private puppetStep(enemy: EnemyEntity, goal: RouteGoal, hold: Hold | null, dt: number) {
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

    /** A parked gun walks to its firing spot; it has arrived once it is there. */
    private walkToPark(enemy: EnemyEntity, spot: { u: number, d: number }, dt: number) {
        const moved = this.walkTo(enemy, spot.u, spot.d, dt)
        return { moved, arrived: moved === 0 }
    }

    /** Whether a unit stands close behind a shield bearer (portal side), in the cover of the wall. */
    isSheltered(enemy: EnemyEntity) {
        if (enemy.bearer) return false
        return this.enemies.some(other => other.bearer && other.d < enemy.d
            && Math.hypot(other.u - enemy.u, other.d - enemy.d) <= SHELTER_RADIUS)
    }

    addShake(amount: number) {
        // The old engine shook in pixels; this one shakes in world units. A lag
        // spike shows nothing landing, so nothing shakes.
        if (this.lag.boardLagMs > 0) return
        this.shake = Math.min(MAX_SHAKE, this.shake + amount * 0.05)
    }

    private drawOverlay(dt: number) {
        const view = this.view
        if (!view) return
        const tags: HealthTag[] = []
        for (const enemy of this.enemies) {
            // The bar's trail holds where the health stood, then drains down to it.
            const fraction = enemy.hp / enemy.maxHp
            const trail = enemy.hpTrail ?? 1
            enemy.hpTrail = trail <= fraction ? fraction : Math.max(fraction, trail - dt * HP_TRAIL_DRAIN)
            // Only wounded enemies get a bar; a pip over every crawler is noise.
            // Nor does anything mostly lost in the dark: the bar would give it away.
            if (enemy.hp >= enemy.maxHp || !enemy.rig.root.visible || this.territory.shroudOf(enemy) > 0.6) continue
            tags.push({
                // Overlays follow the picture, so a lag spike does not give a position away.
                pos: this.lag.seenWorld(enemy, enemy.rig.height * PER_WORLD + 12, new THREE.Vector3()),
                fraction,
                trail,
                color: hexCss(enemy.def.hex),
                armored: enemy.armored,
                width: enemy.def.boss ? 90 : clamp(enemy.def.height * 0.6, 22, 50)
            })
        }
        let reticle = null
        if (this.rail.target) {
            const height = this.rail.target.rig.height * PER_WORLD
            const pos = this.lag.seenWorld(this.rail.target, height * 0.5, new THREE.Vector3())
            const top = view.project(this.lag.seenWorld(this.rail.target, height, _w), { x: 0, y: 0 })
            const mid = view.project(pos, { x: 0, y: 0 })
            const size = top && mid ? clamp(Math.abs(top.y - mid.y) + 6, 12, 70) : 16
            reticle = { pos, size, color: '#22d3ee' }
        }
        // Radar contacts: a bracket on everything the ping lit, fading with it.
        const markers = []
        for (const enemy of this.enemies) {
            if (enemy.revealMs <= 0) continue
            const height = enemy.rig.height * PER_WORLD
            const pos = this.lag.seenWorld(enemy, height * 0.5, new THREE.Vector3())
            const top = view.project(this.lag.seenWorld(enemy, height, _w), { x: 0, y: 0 })
            const mid = view.project(pos, { x: 0, y: 0 })
            const size = top && mid ? clamp(Math.abs(top.y - mid.y) + 8, 12, 80) : 16
            markers.push({ pos, size, alpha: enemy.revealMs / PING_REVEAL_MS, cloaked: !!enemy.def.cloaked })
        }
        this.overlay.draw(
            view.overlayCtx, view.width, view.height, this.paused ? 0 : dt,
            (p, out) => view.project(p, out), tags, reticle, this.visualTime / 1000, markers
        )
    }

    // ─── Spawning ────────────────────────────────────────────────────────────

    private releaseScheduled() {
        while (this.scheduleIndex < this.schedule.length
            && (this.schedule[this.scheduleIndex] as ScheduledSpawn).atMs <= this.waveElapsed) {
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
    private maintainHackers(dtMs: number) {
        this.hackerTimer -= dtMs
        if (this.hackerTimer > 0) return
        if (!this.pathChips?.chips.some(chip => chip.state !== 'hacked')) return
        const alive = this.enemies.filter(e => e.def.id === HACKERZ_HACKER_ID && !e.decoy).length
        const field = hackerzHackerField(this.wave, this.waveElapsed)
        if (this.hackerField > 0 && field > this.hackerField) this.sysLog.hackerSurge(field - this.hackerField)
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
    private maintainDistraction(dtMs: number) {
        this.distractTimer -= dtMs
        if (this.distractTimer > 0 || this.bonus) return
        const chips = this.pathChips
        if (!chips || chips.conquered >= DISTRACT_NODES || this.allNodesTaken) return
        const sapper = hackerzEnemy('sapper')
        if (Math.max(sapper.fromWave, DISTRACT_FROM_WAVE) > this.wave) return
        if (this.enemies.filter(e => e.def.id === sapper.id).length >= DISTRACT_MAX) return
        this.distractTimer = DISTRACT_MS * (0.75 + randomFloat() * 0.5)
        this.spawn(sapper, true)
        if (!this.decoysLogged) {
            this.decoysLogged = true
            this.sysLog.decoys()
        }
    }

    /**
     * Brings a unit onto the field. `at` sets it down mid-field instead (a
     * spiderling hatching): it takes the nearest line from there, and the
     * portal shows nothing of it. `reinforcement` is a top-up hacker: half
     * the credits, and no coins.
     */
    spawn(def: HackerzEnemyDefinition, reinforcement = false, hpScale = 1, at: { u: number, d: number } | null = null) {
        const loadout = this.loadout
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
        this.fieldRoot.add(rig.root)

        // A hard difficulty phases in over the run (see `HACKERZ_DIFFICULTY_FULL_WAVE`).
        const maxHp = def.hp * hackerzHpMultiplier(this.wave) * hackerzWaveEnemyHp(difficulty, this.wave) * (this.bonus === 'ddos' ? 0.5 : 1) * hpScale
        const bounty = def.bounty * hackerzBountyMultiplier(this.wave) * (this.bonus === 'ddos' ? 0.6 : 1)
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
            damage: def.damage * hackerzDamageMultiplier(this.wave) * hackerzWaveEnemyDamage(difficulty, this.wave),
            bounty,
            // Bonus rounds pay credits only: coins are the site economy, and a
            // replayable sprint must never be a way to farm them.
            coinValue: this.bonus || reinforcement ? 0 : hackerzCoinValue(bounty, this.wave, difficulty, loadout.coinMultiplier),
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
        if (this.ridesNetwork(enemy)) {
            if (at) this.attachToNetwork(enemy)
            else this.enterFromPortal(enemy)
        }
        placeEnemy(enemy)
        // Arrivals take the clearest socket (see `enterFromPortal`); one that
        // still lands on a body — every socket backed up — waits inside the
        // portal until the way is clear.
        if (!at && !def.boss && !hackerzIsAirborne(def) && this.crowd.crowdedAt(enemy)) {
            enemy.gateHold = true
            enemy.rig.root.visible = false
        }
        this.enemies.push(enemy)
        this.transient?.ring(fieldToWorld(u, d, 0.1, _v), def.hex, def.boss ? 6 : 1.6, 0.5)
        // Coming through the gate sends power lines out across it from the entry
        // point — in the dark, the only sign that anything arrived.
        if (!at) this.view?.portalArrival(enemy.u)

        if (def.boss) {
            this.callbacks.onBoss(def.name)
            this.sysLog.boss(def.id, def.name)
            this.callbacks.onSound?.('boss-spawn')
            this.overlay.banner(def.name, RED, 'kernel-level intrusion')
            this.addShake(10)
        }
    }

    // ─── Enemies ─────────────────────────────────────────────────────────────

    private updateEnemies(dt: number, dtMs: number) {
        // The Tarpit Grid runs off the gun's magazine: dead while it reloads.
        const spikeDps = this.rail.tarpitPowered ? this.loadout?.spikeDps ?? 0 : 0
        let spiking = false

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i] as EnemyEntity
            // Felled in a brawl or by a Power Surge since its last turn: a hostile
            // pays out as any kill; a turned unit that falls pays nothing.
            if (enemy.hp <= 0) {
                this.combat.killEnemy(i, enemy.turned ? 0 : 1)
                continue
            }
            // Waiting inside the portal for its socket to clear: it steps out
            // (and resolves in) only once nothing is standing there.
            if (enemy.gateHold) {
                if (this.crowd.crowdedAt(enemy)) continue
                enemy.gateHold = false
                enemy.age = 0
                enemy.rig.root.visible = true
            }
            enemy.age += dt
            // Where it stood before this tick's move, for the collision check below.
            const fromU = enemy.u
            const fromD = enemy.d
            const fromSeg = enemy.routeSeg
            const fromYaw = enemy.yaw
            if (enemy.def.boss) this.updateBoss(enemy, dt, dtMs)
            // A shield bearer whose node was taken back disintegrates on the spot.
            if (enemy.bearer && this.running && !this.purging && this.keepBearerPost(enemy, i)) continue
            const riding = this.ridesNetwork(enemy)
            // A honeypot or proxy wall in the way is where this unit stops instead.
            let hold: Hold | null = enemy.burrowMs > 0 || enemy.def.boss
                ? null
                : this.deployables?.holdFor(enemy.u, enemy.d, enemy.standoff, hackerzIsAirborne(enemy.def)) ?? null
            // A spiderling is not fooled by a honeypot: it only stops for what it can drain.
            if (hold?.target.kind === 'honeypot' && enemy.def.drain) hold = null
            // A honeypot only draws a rider whose line runs past it.
            if (hold?.target.kind === 'honeypot' && riding
                && !this.routeAheadPasses(enemy, hold.target.u, hold.target.d, 90)) hold = null
            // Hackers go for the next path node still ahead on their lines — and
            // when none is left ahead, they double back for one that is still open.
            let node = !hold && !enemy.turned && this.hacking.canHack(enemy) ? this.hacking.hackTarget(enemy) : null
            if (!node && !hold && riding && this.hacking.canHack(enemy)) {
                const open = this.pathChips?.ordered.filter(chip => chip.state !== 'hacked') ?? []
                const nearest = open.reduce<PathChip | null>((best, chip) =>
                    !best || Math.hypot(chip.u - enemy.u, chip.d - enemy.d) < Math.hypot(best.u - enemy.u, best.d - enemy.d) ? chip : best, null)
                if (nearest && this.planDetour(enemy, nearest)) node = this.hacking.hackTarget(enemy)
            }
            if (enemy.def.id === HACKERZ_HACKER_ID && riding) this.hacking.dodge(enemy, dtMs)
            if (!node && enemy.hacking) this.hacking.stopHacking(enemy)

            // Only so many can work one node at once; the rest close in and wait
            // a step further out, ready to take the next free terminal.
            const queued = !!node && !enemy.hacking
                && this.enemies.filter(e => e.hacking && e.targetChip === node).length >= HACK_TEAM
            const reach = HACK_REACH * (0.55 + 0.45 * enemy.hackReach) + (queued ? HACK_QUEUE_GAP : 0)
            const pot = hold?.target.kind === 'honeypot' ? hold.target : null
            const goal: RouteGoal = node
                ? { stopD: enemy.standoff, near: (u, d) => Math.hypot(u - node.u, d - node.d) <= reach }
                : pot
                    ? { stopD: hold!.stopD, near: (u, d) => Math.hypot(u - pot.u, d - pot.d) <= 80 }
                    : { stopD: hold ? hold.stopD : enemy.standoff }

            // Tactics: a wounded weakling falls back toward red or holds there to
            // heal, and healthier units in front of a retreating one hold the
            // line to cover it. Everyone else gets on with the attack.
            const tactic = riding || enemy.bearer || enemy.defending || enemy.escorting ? this.tactics(enemy, dtMs) : 'advance'
            if (enemy.parked && (tactic !== 'advance' || node || hold)) enemy.parked = null
            const parked = enemy.parked
            const live = this.running && !this.purging
            // A turned unit hunts hostiles; a hostile with one in its face fights
            // it; a healer flies its own rounds; everyone else gets on with it.
            const mending = enemy.turned
                ? (live ? this.whiteHats.turnedStep(enemy, dt, dtMs) : { moved: 0, arrived: false })
                : (live ? this.whiteHats.brawlStep(enemy, dtMs) : null)
                    ?? (enemy.def.heal && !enemy.kamikaze && live ? this.healers.healerStep(enemy, dt, dtMs) : null)
            const step = mending ?? (enemy.demoPath
                ? this.puppetStep(enemy, goal, hold, dt)
                : parked
                ? this.walkToPark(enemy, parked, dt)
                : tactic === 'advance'
                    ? (node && !queued && riding ? this.hacking.parkStep(enemy, node, dt) : null)
                    ?? (riding ? this.ride(enemy, goal, dt) : this.fly(enemy, goal, dt))
                    : { moved: this.holdBack(enemy, tactic, dt), arrived: false })
            if (!node || queued || tactic !== 'advance') enemy.hackSlot = null
            // Stride is driven by distance, not time, so a knocked-back or
            // crowded enemy never moon-walks.
            enemy.stride += strideFor(step.moved, unitSize(enemy.def))
            let rollSpeed = rollSpeedFor(step.moved, enemy.rig.height, dt, FIELD_SCALE)

            if (tactic !== 'advance') {
                if (enemy.hacking) this.hacking.stopHacking(enemy)
            } else if (!step.arrived) {
                if (enemy.hacking) this.hacking.stopHacking(enemy)
            } else if (node && queued) {
                // Waiting its turn at the node: idling on the spot.
                rollSpeed = 0
            } else if (node) {
                rollSpeed = 0
                this.hacking.hackAt(enemy, node, dtMs)
            } else if (!hold && this.parkAside(enemy)) {
                // A gun that set up beside a node would read as its guard: it
                // steps aside first, and opens fire from there.
            } else {
                rollSpeed = 0
                enemy.attackTimer -= dtMs
                if (enemy.attackTimer <= 0) {
                    // Burst types fire a short volley, then take the full gap.
                    if (enemy.burstLeft <= 0) enemy.burstLeft = enemy.def.burst ?? 1
                    enemy.burstLeft--
                    enemy.attackTimer = enemy.burstLeft > 0 ? MOTION.burstGapMs : enemy.def.attackMs
                    if (hold) {
                        if (this.assault.strikeDeployable(enemy, hold)) continue
                    } else {
                        this.assault.enemyStrike(enemy)
                        if (enemy.def.kind === 'bomber' || enemy.kamikaze) continue
                    }
                }
            }

            // Knockback decays rather than stopping dead, so a pulse reads as a
            // shove rather than a teleport. A rider is shoved back up its own
            // line, never off it: not past the corner it came round, and not at
            // all while it is running across.
            let ceiling = Infinity
            if (riding && enemy.route) {
                const a = enemy.route[enemy.routeSeg]
                const b = enemy.route[enemy.routeSeg + 1]
                if (!a || !b || segmentDirection(a, b) !== 'down') enemy.pushVd = 0
                else ceiling = a.d
            }
            if (enemy.pushVd !== 0) {
                enemy.d = Math.min(ceiling, enemy.d + enemy.pushVd * dt)
                enemy.pushVd *= Math.max(0, 1 - dt * 4)
                if (Math.abs(enemy.pushVd) < 4) enemy.pushVd = 0
                if (enemy.d > DESPAWN_DEPTH) {
                    this.combat.removeEnemy(i)
                    continue
                }
            }

            // Bodies are solid: a move that would carry this one into another
            // stops at the point of contact.
            this.crowd.collide(enemy, fromU, fromD, fromSeg, fromYaw, dtMs)

            // Grid trap: ground units only, and only inside the band.
            if (spikeDps > 0 && !enemy.turned && !hackerzIsAirborne(enemy.def) && enemy.d < SPIKE_BAND) {
                spiking = true
                this.combat.damageEnemy(enemy, spikeDps * dt, 'kinetic', false, false, false, false)
                if (enemy.hp <= 0) {
                    this.combat.killEnemy(i, 1)
                    continue
                }
                if (randomChance(dt * 4)) {
                    this.particles.burst(enemyWorld(enemy, 4, _v), AMBER, 4, 6, { size: 0.18, life: 0.25 })
                }
            }

            // Held ground bites: anything that has pushed down into the blue
            // takes a steady tick of damage for as long as it stays there.
            // Behind a shield wall the ground's bite does not reach.
            // A unit still carrying its shield (a Warden) shrugs the ground off.
            // A demo unit does too, unless its scene is about the ground itself.
            if (this.running && !this.purging && !enemy.turned && (!enemy.demoPath || this.demoScript?.ground) && this.territory.inHeldGround(enemy) && !this.isSheltered(enemy) && enemy.guard <= 0) {
                enemy.zoneTick += dtMs
                // Sappers are built to run the gauntlet: they only feel every second tick.
                if (enemy.zoneTick >= ZONE_TICK_MS && enemy.def.kind === 'bomber' && ++enemy.zoneTicks % 2 === 1) {
                    enemy.zoneTick -= ZONE_TICK_MS
                } else if (enemy.zoneTick >= ZONE_TICK_MS) {
                    enemy.zoneTick -= ZONE_TICK_MS
                    const share = enemy.def.boss ? ZONE_TICK_BOSS_SHARE : ZONE_TICK_SHARE
                    const bite = enemy.maxHp * share + 2 + this.wave * 0.6
                    // A tick is the ground biting, not a hit: it never pops a shield.
                    this.combat.damageEnemy(enemy, bite, 'energy', false, !this.combat.untouchable(enemy), false, false)
                    this.particles.burst(enemyWorld(enemy, 3, _v), CYAN, 4, 5, { size: 0.18, life: 0.3 })
                    if (enemy.hp <= 0) {
                        this.combat.killEnemy(i, 1)
                        continue
                    }
                }
            } else {
                enemy.zoneTick = 0
            }
            this.territory.redGround(enemy, dtMs)

            if (hackerzIsAirborne(enemy.def)) enemy.hover += dt * MOTION.hoverRate
            if (enemy.flashMs > 0) enemy.flashMs = Math.max(0, enemy.flashMs - dtMs)

            // Radar: the ping's wavefront lights a contact when it arrives.
            if (enemy.pingDelay >= 0) {
                enemy.pingDelay -= dtMs
                if (enemy.pingDelay < 0) enemy.revealMs = PING_REVEAL_MS
            }
            if (enemy.revealMs > 0) enemy.revealMs = Math.max(0, enemy.revealMs - dtMs)

            // PACKET LOSS: the picture lags. During a lag spike the whole board
            // holds where it was last seen — pose, turn, flash, sheen, all of it —
            // while everything carries on moving, and the rounds go where they
            // really are, not where they look.
            if (this.lag.boardLagMs > 0) continue

            easeSheen(enemy.rig, enemy.redShield, dt)
            // Riders snap round corners like a light cycle (turned in `ride`); flyers face the fence.
            enemy.rig.root.rotation.y = enemy.yaw
            // A turned unit glows faintly white: it is ours now.
            enemy.rig.body.uniforms.uFlash!.value = Math.max(hitFlash(enemy.flashMs), enemy.turned ? 0.3 : 0)
            // A blast's corruption tears the body's polygons into slipping bands, easing out.
            if (enemy.glitchMs) enemy.glitchMs = Math.max(0, enemy.glitchMs - dtMs)
            if (enemy.phaseMs) enemy.phaseMs = Math.max(0, enemy.phaseMs - dtMs)
            // Passing through another body tears it too (`phaseMs`), without the skips.
            enemy.rig.body.uniforms.uGlitch!.value = Math.max(glitchOf(enemy), Math.min(1, (enemy.phaseMs ?? 0) / GLITCH_FADE_MS))
            // The dark hides a unit gradually, in its own shader (see `shroud` in
            // models): only a burrowed or cloaked one drops out of the picture
            // outright. A ping lifts the shroud off it, eased in and out.
            const cloakedAway = !!enemy.def.cloaked && !enemy.decloaked && enemy.revealMs <= 0
            // A burrowing ROOTKIT stays in sight while it melts into the floor.
            enemy.rig.root.visible = !underground(enemy) && !cloakedAway
            if (enemy.litMs) enemy.litMs = Math.max(0, enemy.litMs - dtMs)
            enemy.rig.reveal.value += ((enemy.revealMs > 0 || enemy.litMs ? 1 : 0) - enemy.rig.reveal.value) * Math.min(1, dt * 5)
            // Into the dark the lock slips: the rail keeps firing where it last saw its target.
            if (this.rail.target === enemy && this.combat.inTheDark(enemy)) {
                this.rail.lockSpot = { u: enemy.u, d: enemy.d, y: enemyCentreY(enemy) }
                this.rail.target = null
            }
            // A cloaked unit still disturbs the grid: a faint shimmer where it walks.
            if (cloakedAway && Math.random() < dt * 5) {
                this.particles.emit(enemyWorld(enemy, randRange(5, enemy.rig.height * PER_WORLD), _v), _w.set(0, 1.2, 0), enemy.def.hex,
                    { size: 0.16, life: 0.4, gravity: 0, intensity: 1.2 })
            }
            // Rez in: the unit is drawn up out of the grid over its first beat.
            const rez = Math.min(1, enemy.age / MOTION.rezIn)
            // A spiderling swells on what it drains.
            const grown = drainGrowth(enemy.drainPower)
            enemy.rig.root.scale.set(grown, rez * grown, grown)
            poseRig(enemy.rig, enemy.stride, dt, rollSpeed)
            // A gun that just fired kicks back along its barrel and eases home.
            if (enemy.rig.barrel) enemy.recoil = easeRecoil(enemy.rig, enemy.recoil, dt)
            // A melee blow; at full reach a prod discharges, a ram slams home.
            if (enemy.rig.weapon) {
                const before = enemy.strike
                enemy.strike = easeStrike(enemy.rig, enemy.strike, dt)
                if (strikeLands(before, enemy.strike)) {
                    if (enemy.rig.weaponKind === 'ram') this.assault.ramImpact(enemy)
                    else this.assault.prodZap(enemy)
                }
            }
            placeEnemy(enemy)
            // ROOTKIT's dive: legs drawn into a point, the whole body drilling round.
            if (enemy.burrowMs > 0 || enemy.riseMs > 0) {
                const dive = burrowing(enemy)
                gatherLegs(enemy.rig, dive.gather)
                enemy.rig.root.rotation.y = enemy.yaw + dive.spin
            }
            if (enemy.heave > 0) this.memory.heaveLeak(enemy, dt)
            enemy.hexShield?.update(dt)
            if (enemy.inject > 0) {
                const before = enemy.inject
                enemy.inject = easeInject(enemy.rig, enemy.inject, dt)
                // ROOTKIT's stab puts its brood in; a spiderling's is its bite (see `drainFence`).
                if (injectLands(before, enemy.inject) && enemy.def.id === 'titan') this.rootkit.injectBrood(enemy)
            }
            if (enemy.ribbonMs > 0 || enemy.ribbon?.busy) this.assault.feedRibbon(enemy, dt, dtMs)
            enemy.storm?.update(dt)
            enemy.wound?.update(dt)
        }

        if (spiking) this.rail.drainTarpit(dt)
        this.crowd.separate()
    }

    // ─── Bosses ──────────────────────────────────────────────────────────────

    private updateBoss(enemy: EnemyEntity, dt: number, dtMs: number) {
        if (enemy.decoy) return
        switch (enemy.def.id) {
            case 'titan':
                this.rootkit.updateRootkit(enemy, dt, dtMs)
                break
            case 'leviathan':
                this.blackIce.updateBlackIce(enemy, dtMs)
                break
            case 'zeroday':
                this.zeroDay.updateZeroDay(enemy, dt)
                break
        }
    }

    // ─── Tactics ─────────────────────────────────────────────────────────────

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
    private keepsOutOfBlue(enemy: EnemyEntity) {
        return this.running && !this.finalPush && !this.bonus && this.isSkirmisher(enemy)
    }

    /**
     * What a rider does this frame. A skirmisher under half health falls back
     * toward red ground and, once there, holds and heals until it is nearly
     * whole. A healthy unit asked to cover holds where it is for a moment.
     * The final push overrides it all.
     */
    private tactics(enemy: EnemyEntity, dtMs: number): Tactic {
        if (enemy.coverMs > 0) enemy.coverMs -= dtMs
        // Bearers hold their wall through everything, the final push included.
        if (enemy.bearer && this.running && !this.purging) return this.bearerPost(enemy) ? 'guard' : 'advance'
        // A node's defender holds its post until it is relieved.
        if (enemy.defending && this.running && !this.purging && this.defenderPost(enemy)) return 'guard'
        // A bodyguard sticks to its hacker through everything, the final push included.
        if (enemy.escorting && this.running && !this.purging) return 'guard'
        // Bonus rounds are a rush: nobody falls back or holds to cover.
        if (!this.running || this.purging || this.finalPush || this.bonus || enemy.def.boss) {
            enemy.recovering = false
            return 'advance'
        }
        if (this.isSkirmisher(enemy)) {
            const share = enemy.hp / enemy.maxHp
            if (share >= RECOVERED) enemy.recovering = false
            else if (share < RETREAT_BELOW) enemy.recovering = true
            // With a shield wall up, the wounded make for cover behind it.
            if (enemy.recovering && this.shelterSpot(enemy)) return 'shelter'
            if (enemy.recovering) return this.territory.zoneOf(enemy.u, enemy.d) === 'theirs' ? 'recover' : 'retreat'
        }
        return enemy.coverMs > 0 ? 'cover' : 'advance'
    }

    /** Carries out a non-advancing tactic. Returns the distance moved. */
    private holdBack(enemy: EnemyEntity, tactic: Tactic, dt: number) {
        if (tactic === 'guard') {
            const post = enemy.bearer
                ? this.bearerPost(enemy)
                : enemy.escorting ? this.escortPost(enemy) : this.defenderPost(enemy)
            return post ? this.walkTo(enemy, post.u, post.d, dt) : 0
        }
        if (tactic === 'shelter') {
            const spot = this.shelterSpot(enemy)
            return spot ? this.walkTo(enemy, spot.u, spot.d, dt) : 0
        }
        if (tactic === 'retreat') {
            this.callCover(enemy)
            return this.fallBack(enemy, dt)
        }
        if (tactic === 'recover') {
            // In red: make for a node they hold, if the line runs past one
            // nearby, and gather round it — it heals twice as fast there, and
            // the crowd stands between the player's rounds and the node. A
            // locked board's nodes cannot be taken, so nobody gathers there.
            if (this.pathChips?.locked) return 0
            const guard = this.pathChips?.chips.find(chip => chip.state === 'hacked'
                && Math.hypot(chip.u - enemy.u, chip.d - enemy.d) < 320
                && this.routeAheadPasses(enemy, chip.u, chip.d, 70))
            if (!guard) return 0
            const reach = 55 + enemy.hackReach * 45
            return this.ride(enemy, { stopD: enemy.standoff, near: (u, d) => Math.hypot(u - guard.u, d - guard.d) <= reach }, dt).moved
        }
        return 0
    }

    /**
     * Healthier units between a retreating one and the fence hold their
     * ground for a moment, so the player's fire meets them first.
     */
    private callCover(retreating: EnemyEntity) {
        for (const other of this.enemies) {
            if (other === retreating || other.def.id === HACKERZ_HACKER_ID || other.def.kind === 'bomber') continue
            if (other.hp / other.maxHp < 0.7 || other.d >= retreating.d || other.d <= other.standoff + 20) continue
            if (Math.hypot(other.u - retreating.u, other.d - retreating.d) > COVER_RADIUS) continue
            other.coverMs = COVER_HOLD_MS
        }
    }

    /**
     * Backs a rider up its own line, toward the portal: the one time a unit
     * moves away from the fence. It stops where its line began.
     */
    private fallBack(enemy: EnemyEntity, dt: number) {
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

    // ─── Data lines ──────────────────────────────────────────────────────────

    /**
     * Ground units ride the data lines; flyers and a burrowed ROOTKIT do not.
     * Once every node is theirs the lines no longer matter: everything charges
     * straight over their ground for the wall.
     */
    ridesNetwork(enemy: EnemyEntity) {
        // Packet loss keeps the light units on the lines: the lag is the threat
        // there, not a charge. The heavies are too big for the corners and go straight.
        return !hackerzIsAirborne(enemy.def) && enemy.burrowMs <= 0 && !enemy.demoPath
            && (!this.allNodesTaken || (this.bonus === 'packetloss' && !this.isHeavy(enemy.def)))
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
    private get allNodesTaken() {
        const chips = this.pathChips?.chips ?? []
        return chips.length > 0 && chips.every(chip => chip.state === 'hacked')
    }

    /** The network layer of a path node: 1 for the outermost. */
    private chipLayer(chip: PathChip) {
        return (this.pathChips?.ordered.indexOf(chip) ?? -1) + 1
    }

    /** Whether a path node is still ahead of a rider: at or past the node its line runs to. */
    chipAhead(enemy: EnemyEntity, chip: PathChip) {
        const node = this.network.nodes[enemy.routeTo]
        if (!enemy.route || !node) return true
        return this.chipLayer(chip) >= node.layer
    }

    /** Whether the rest of a rider's line passes within `radius` of a point. */
    private routeAheadPasses(enemy: EnemyEntity, u: number, d: number, radius: number) {
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
    private enterFromPortal(enemy: EnemyEntity) {
        const sources = this.network.nodes.map((node, index) => ({ node, index })).filter(s => s.node.kind === 'source')
        if (!sources.length) return
        const wanted = enemy.d
        const clearAt = (u: number, from: number) => {
            let d = from
            // Step back past whatever stands on this column, until it is clear.
            for (let guard = 0; guard < 40; guard++) {
                enemy.u = u
                enemy.d = d
                const blocker = this.enemies.find(o => !hackerzIsAirborne(o.def) && o.hp > 0 && sinkInto(enemy, u, d, o) > 0)
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
        const pots = this.deployables?.items.filter(item => item.kind === 'honeypot' && item.hp > 0) ?? []
        const lured = out.filter(trace => pots.some(pot => tracePassesNear(trace, pot.u, pot.d, LURE_TRACE_RADIUS)))
        let trace: Trace
        if (lured.length) {
            trace = random(lured)
        } else {
            const ordered = this.pathChips?.ordered ?? []
            // A hacker heads for its own pick; failing that, the next open node.
            const own = enemy.targetChip
            const picked = own && own.state !== 'hacked' && this.chipLayer(own) > node.layer ? own : undefined
            const target = this.hacking.canHack(enemy)
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
    private planDetour(enemy: EnemyEntity, target: PathChip) {
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
    private ride(enemy: EnemyEntity, goal: RouteGoal, dt: number) {
        const boost = this.groundSpeed(enemy) * (enemy.def.kind === 'bomber' ? SAPPER_SPEED : 1)
        let budget = enemy.speed * this.hacking.chipBuff(enemy) * this.pushSpeed * boost * dt
        // A skirmisher halts at the edge of blue ground rather than step into it.
        // One already standing in blue (the ground changed under it) carries on.
        const keepOut = this.keepsOutOfBlue(enemy) && this.territory.zoneOf(enemy.u, enemy.d) !== 'held'
        // A boosted rider leaves a thin red trail, so the fast lane reads as one.
        if (boost > 1 && Math.random() < dt * 14) {
            this.particles.emit(enemyWorld(enemy, 3, _v), _w.set(0, 0.4, 0), RED, { size: 0.16, life: 0.35, gravity: 0 })
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
                if (this.territory.zoneOf(nu, nd) === 'held') break
            }
            if (across) enemy.u += way * step
            else enemy.d += way * step
            budget -= step
            moved += step
        }
        // Off its line, it eases back onto it whenever that does not walk it into anyone.
        const leg = this.crowd.legOf(enemy)
        if (leg && !arrived) {
            const off = leg.vertical ? enemy.u - leg.from.u : enemy.d - leg.from.d
            const back = Math.min(Math.abs(off), enemy.speed * this.pushSpeed * LANE_RETURN * dt) * Math.sign(off)
            if (back !== 0) {
                const u = leg.vertical ? enemy.u - back : enemy.u
                const d = leg.vertical ? enemy.d : enemy.d - back
                if (!this.crowd.sinksDeeper(enemy, u, d)) {
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
    private fly(enemy: EnemyEntity, goal: RouteGoal, dt: number) {
        enemy.yaw = turnToward(enemy.yaw, YAW_DOWN, dt * 16)
        if (goal.near?.(enemy.u, enemy.d)) return { moved: 0, arrived: true }
        const room = enemy.d - goal.stopD
        if (room <= 0) {
            enemy.d = goal.stopD
            return { moved: 0, arrived: true }
        }
        const step = Math.min(room, enemy.speed * this.hacking.chipBuff(enemy) * this.pushSpeed * this.groundSpeed(enemy)
            * (enemy.burrowMs > 0 ? 1.8 : 1) * (enemy.def.kind === 'bomber' ? SAPPER_SPEED : 1) * dt)
        // Flying skirmishers hold at the edge of blue ground too.
        if (this.keepsOutOfBlue(enemy) && this.territory.zoneOf(enemy.u, enemy.d) !== 'held'
            && this.territory.zoneOf(enemy.u, enemy.d - step) === 'held') return { moved: 0, arrived: false }
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
        const surge = this.lag.lagCatchUpMs > 0 ? LAG_CATCH_UP_SPEED : 1
        const taken = this.pathChips?.chips.some(chip => chip.state === 'hacked')
        if (!taken || enemy.burrowMs > 0) return surge
        return (this.territory.zoneOf(enemy.u, enemy.d) === 'theirs' ? THEIR_GROUND_SPEED : 1) * surge
    }

    // ─── Wave end ────────────────────────────────────────────────────────────

    /**
     * The wall flushes the field: a wall of light sweeps out from the wall and
     * takes everything it passes. Survivors still pay out, at a fraction — enough
     * that a wave you barely held is not also a wave you earned nothing from.
     */
    beginPurge() {
        if (this.purging) return
        this.sysLog.purge(this.enemies.length)
        // The sweep is a full garbage collection: every leaked block goes with it.
        this.memory.clearLeaks(true)
        // And the black ice melts.
        for (const wall of this.blackIce.iceWalls) wall.wall.thaw()
        this.purging = true
        this.rail.holding = false
        this.rail.target = null
        this.callbacks.onWaveTime(0, this.enemies.length)

        this.view?.flash(0xffffff, 0.25)
        this.addShake(6)
        const width = FIELD_HALF_WIDTH * 2 * FIELD_SCALE + 6
        this.transient?.sweep(width, 9, 0, -PURGE_REACH * FIELD_SCALE, PURGE_MS,
            (z) => {
                const front = -z * PER_WORLD
                for (let i = this.enemies.length - 1; i >= 0; i--) {
                    if ((this.enemies[i] as EnemyEntity).d > front) continue
                    this.combat.killEnemy(i, HACKERZ_PURGE_BOUNTY)
                }
            },
            () => this.finishWave()
        )
    }

    /**
     * The closing stretch of a wave: every hostile on the field charges the
     * fence faster, while the hackers keep working the nodes. This is where a
     * wave is meant to peak.
     */
    private beginFinalPush() {
        this.finalPush = true
        this.sysLog.finalPush()
        this.overlay.banner('FINAL PUSH', RED, 'they are going all in')
        this.view?.flash(RED, 0.16)
        this.addShake(6)
        this.callbacks.onSound?.('boss-spawn')
    }

    /** The field's pace: everything moves at `ENEMY_PACE`, and faster again in the final push. */
    get pushSpeed() {
        return ENEMY_PACE * (this.finalPush ? FINAL_PUSH_SPEED : 1)
    }

    private finishWave() {
        // A wall that fell during the sweep has already ended the run; do not
        // hand the uplink a wave it can deploy out of.
        if (this.gameOver) return
        this.running = false
        this.purging = false
        this.finalPush = false
        this.abilities.overclockLeft = 0
        this.deployer.arm(null)
        // Unspent hardware does not carry over: it was placed for this fight.
        this.deployables?.clear()
        this.linePulses?.clear()

        // Anything left (a boss knocked past the sweep's reach, say) goes too.
        while (this.enemies.length) this.combat.killEnemy(this.enemies.length - 1, HACKERZ_PURGE_BOUNTY)
        for (const spit of this.projectiles.spits) spit.mesh.removeFromParent()
        this.projectiles.spits = []
        this.memory.clearLeaks(false)
        this.rootkit.infected.clear()
        this.blackIce.clearIce()
        this.deployer.surges = []
        this.abilities.portscanLeft = 0
        // Coins still mid-flight belong to the wave that dropped them.
        this.scoring.flushCoins()

        const event = this.bonus
        let passed = false
        if (event) {
            // The sandbox: the wall goes back to how the round found it.
            this.bastion.wallHp = this.bastion.bonusStartHp
            this.bastion.shield = this.bastion.bonusStartShield
            this.bastion.emitWall()
            passed = !this.bastion.bonusFailed
            if (passed && this.scoring.waveCredits > 0) {
                const extra = this.scoring.waveCredits * (HACKERZ_BONUS_MULTIPLIER - 1)
                this.scoring.waveCredits += extra
                this.callbacks.onCredits(extra, 'clear')
                this.overlay.banner(`BONUS ×${HACKERZ_BONUS_MULTIPLIER}`, LIME, `+${extra} credits`)
                this.view?.flash(0xa3e635, 0.3)
                if (this.rail.railRig) this.particles.burst(this.rail.railRig.root.position, LIME, 120, 16, { size: 0.36, life: 1 })
            }
            this.bonus = null
            if (this.pathChips) this.pathChips.locked = false
            this.pathChips?.restore(this.bonusChips)
            this.bonusChips = null
            this.territory.islands = []
        } else {
            const integrity = this.bastion.wallMaxHp > 0 ? this.bastion.wallHp / this.bastion.wallMaxHp : 0
            const clear = hackerzClearBonus(this.wave, integrity)
            this.scoring.waveCredits += clear
            this.callbacks.onCredits(clear, 'clear')
        }

        const victory = !event && this.wave >= HACKERZ_MAX_WAVE
        if (victory) {
            this.gameOver = true
            this.overlay.banner('INTRUSION REPELLED', LIME, `${HACKERZ_MAX_WAVE} waves held`)
            this.view?.flash(0xffffff, 0.4)
        }

        this.sysLog.waveEnd(this.wave, this.scoring.waveKills)
        this.callbacks.onWaveEnd({
            wave: this.wave,
            kills: this.scoring.waveKills,
            credits: this.scoring.waveCredits,
            coins: this.scoring.waveCoins,
            wallHp: Math.round(this.bastion.wallHp),
            wallMaxHp: this.bastion.wallMaxHp,
            victory,
            bonus: event,
            passed
        })
        this.callbacks.onSound?.('wave-win')
    }

    endRun() {
        if (this.gameOver) return
        this.gameOver = true
        this.running = false
        this.purging = false
        this.rail.holding = false
        this.rail.target = null
        this.callbacks.onSound?.('game-over')
        // Coins in the air when the wall fell were still earned.
        this.scoring.flushCoins()

        this.view?.flash(RED, 0.6)
        this.overlay.banner('BREACHED', RED, `wave ${this.wave}`)
        this.addShake(22)
        for (let i = 0; i < 6; i++) {
            this.transient?.ring(fieldToWorld(randRange(-400, 400), randRange(0, 60), 1, _v), RED, 8, 0.8)
        }
        this.callbacks.onGameOver({ wave: this.wave, kills: this.scoring.totalKills })
    }

    // ─── Housekeeping ────────────────────────────────────────────────────────

    private clearField() {
        while (this.enemies.length) this.combat.removeEnemy(this.enemies.length - 1)
        for (const bullet of this.projectiles.bullets) bullet.mesh.removeFromParent()
        this.projectiles.bullets = []
        for (const spit of this.projectiles.spits) spit.mesh.removeFromParent()
        this.projectiles.spits = []
        this.memory.clearLeaks(false)
        this.rootkit.infected.clear()
        this.blackIce.clearIce()
        this.deployer.surges = []
        this.abilities.portscanLeft = 0
        // Dropped without banking: a cleared field is a run that is restarting.
        for (const coin of this.scoring.coins) coin.mesh.removeFromParent()
        this.scoring.coins = []
        this.particles.clear()
        for (const corpse of this.combat.dying) disposeRig(corpse.rig)
        this.combat.dying = []
        this.view?.clearSurges()
        this.transient?.clear()
        this.overlay.clear()
        this.deployables?.clear()
        this.linePulses?.clear()
        this.shrapnel?.clear()
        this.glitchClouds?.clear()
        this.hacking.clearHacking()
        this.deployer.armed = null
        this.bonus = null
        this.bonusChips = null
        if (this.pathChips) this.pathChips.locked = false
        this.rail.target = null
        this.rail.holding = false
        this.shake = 0
        this.bastion.wallFlash = 0
    }
}

/**
 * The units within `AUTOPILOT_PACK_RADIUS` of whichever of them has the most
 * neighbours: the densest pack. Empty when there are none.
 */
function densestGroup(units: EnemyEntity[]) {
    let centre: EnemyEntity | null = null
    let most = 0
    for (const unit of units) {
        let count = 0
        for (const other of units) {
            if (Math.hypot(other.u - unit.u, other.d - unit.d) <= AUTOPILOT_PACK_RADIUS) count++
        }
        if (count > most) {
            most = count
            centre = unit
        }
    }
    if (!centre) return []
    const at = centre
    return units.filter(o => Math.hypot(o.u - at.u, o.d - at.d) <= AUTOPILOT_PACK_RADIUS)
}
