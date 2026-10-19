import * as THREE from 'three'
import { randomBetween, randomChance, randomFloat, randomInt, seededRng, withSeed } from './rng'
import type { DemoScript } from '../hackerz-demo-scripts'
import type { HackerzAutopilotView } from '#shared/utils/gamelogic/hackerz-autopilot'
import {
    HACKERZ_BONUS_MS, HACKERZ_BONUS_MULTIPLIER, HACKERZ_BOSS_EVERY, HACKERZ_DEPLOYABLE_MAX,
    HACKERZ_BONUS_PASS_INTEGRITY, HACKERZ_HACKER_ID, HACKERZ_MAX_SLOTS, hackerzHackerField, HACKERZ_MAX_WAVE,
    HACKERZ_SPIDER_CAP, HACKERZ_SPIDER_HATCH_MS, HACKERZ_SPIDER_INFECT_RADIUS, HACKERZ_SPIDER_INJECT_MS,
    HACKERZ_SPIDER_MAX_DRAIN, HACKERZ_REINFORCEMENT_BOUNTY, HACKERZ_PURGE_BOUNTY, HACKERZ_SPAWN_WINDOW_MS,
    HACKERZ_TYPE_HEX, HACKERZ_WAVE_MS, hackerzBossFor, hackerzBountyMultiplier, hackerzClearBonus, hackerzCoinValue,
    HACKERZ_DEPLOYABLES, HACKERZ_PORTSCAN_REPING_MS, hackerzDamageMultiplier, hackerzDeployable, hackerzDeployableStats,
    hackerzEmptyStock, hackerzEnemy, hackerzHpMultiplier, hackerzWaveEnemyDamage, hackerzWaveEnemyHp, hackerzIsAirborne,
    hackerzIsBossWave, hackerzNetworkEvent, hackerzTypeMultiplier, hackerzWaveBudget, hackerzSpawnWeight,
    hackerzWavePool, type HackerzDamageType, type HackerzDeployableId, type HackerzDeployableStock,
    type HackerzEnemyDefinition, type HackerzEnemyId, type HackerzEventId, type HackerzLoadout,
    type HackerzWeaponRuntime
} from '#shared/utils/gamelogic/hackerz'
import {
    BULLET_LIFE_MS, BULLET_RADIUS, DESPAWN_DEPTH, FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE, MAX_SHAKE,
    MODEL_HEIGHT_SCALE, PICK_SLACK_PX, PULSE_KNOCKBACK, PULSE_RADIUS, PURGE_MS, PURGE_REACH, RAIL_U, SHAKE_DECAY,
    SPAWN_SPREAD, SPIKE_BAND, SPIT_GRAVITY, SPIT_SPEED, FENCE_HEIGHT, GUN_Z, SHIELD_D, WALL_HALF_LENGTH, WALL_HEIGHT,
    mountPosition
} from './constants'
import { clamp, randRange, segPointDist, segSegDist } from './math'
import { CHIP_HIT_RADIUS, PathChips, type PathChip } from './path-chips'
import { Guardrail } from './guardrail'
import { Deployables, type Blast, type Hold } from './deployables'
import { HackTerminals } from './hack-terminal'
import { LinePulses } from './line-pulses'
import { SysLog } from './sys-log'
import { Shrapnel } from './shrapnel'
import { GlitchClouds } from './glitch-cloud'
import { HexShield } from './hex-shield'
import { CRYSTAL_RIBBON_IDS, CrystalRibbon } from './crystal-ribbon'
import { BLOCK_STORM_IDS, BlockStorm } from './block-storm'
import { DrainWound } from './drain-wound'
import { IceWall, disposeIceGlob, makeIceGlob } from './ice-wall'
import {
    buildNetwork, nearestOnNetwork, segmentDirection, tracePassesNear, zapTarget, type DataNetwork, type LinePoint,
    type Trace
} from './data-lines'
import { buildRig, disposeRig, hdr, loadModels, modelClock, poseRig, shroud, type ModelRig } from './models'
import {
    ENEMY_PACE, MOTION, SAPPER_SPEED, THEIR_GROUND_SPEED, easeRailKick, easeRecoil, easeSheen, easeTurretKick, hitFlash,
    drainGrowth, gatherLegs, easeInject, easeStrike, fangTips, injectLands, muzzleOf, railKickFor, rollSpeedFor,
    spinTurret, strideFor, strikeLands, turnToward, weaponTip
} from './rig-motion'
import { AMBER, CYAN, HackerzScene, LIME, RED, fieldToWorld } from './scene'
import { AmmoRack } from './ammo-rack'
import { LaneProps } from './lane-props'
import {
    Overlay, ParticleSystem, TransientFx, hexCss, makeProjectile, makeSpit, turretProjectile, type HealthTag
} from './fx'
import type { BulletEntity, EnemyEntity, HackerzCallbacks, HackerzStartConfig, SpitEntity, TurretMount } from './types'
import {
    ROOTKIT_BURROW_MS, GLITCH_FADE_MS, halfExtents, PER_WORLD, LEAK_D, _v, _w, ZONE_TICK_MS, BLACKOUT_LIGHT_D
} from './game/tuning'
import { Healers } from './game/healers'
import { Leaks } from './game/leaks'
import { Scoring } from './game/scoring'
import { Bastion } from './game/bastion'
import { PacketLoss } from './game/packet-loss'
import { Territory } from './game/territory'
import {
    burrowing, enemyCentreY, enemyWorld, footprint, glitchOf, outweighs, placeEnemy, reachOf, sinkInto, underground
} from './game/bodies'

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

/** What a projectile carries, whoever fired it. */
interface ShotSpec {
    damage: number
    pierce: number
    damageType: HackerzDamageType
    splashRadius: number
    splashDamage: number
    homing: boolean
    chain: number
    chainFalloff: number
    speed: number
    hex: number
    projectile: HackerzWeaponRuntime['projectile']
    crit: boolean
    fromTurret: boolean
}

/** Turret and rail muzzles sit this high above the field, in field units. */
const MUZZLE_Y = (WALL_HEIGHT + 1.1) * PER_WORLD

/** Where the fence is struck, and where dropped coins bank. */
const WALL_HIT_Y = FENCE_HEIGHT * 0.55 * PER_WORLD

/**
 * Rounds start on the deck, well behind the fence. Walkers stop a body-width
 * out from the fence to hit it, so the guns have to stand back far enough that
 * a unit at the fence is in front of every barrel rather than under it.
 */
const MUZZLE_D = -GUN_Z * PER_WORLD

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

/**
 * BLACK ICE: how often it spits, how its globs fall (field units/s²), and the
 * walls they build — how wide and tall at full growth, how much of a wall one
 * glob makes, the nearest to the fence one may stand, how long it lasts after
 * its last glob, and how much a round through it is slowed.
 */
const BLACK_ICE_SPIT_MS = 2500
const BLACK_ICE_GRAVITY = 900
const BLACK_ICE_WALL_WIDTH = 150
const BLACK_ICE_WALL_HEIGHT = 130
const BLACK_ICE_DEPOSIT = 0.3
const BLACK_ICE_WALL_MIN_D = 140
const BLACK_ICE_WALL_LIFE_MS = 14_000
const BLACK_ICE_SLOW = 0.45

/**
 * The slab BLACK ICE throws at the rail: a third of the field wide, aimed at
 * where the gun stood. A gun clear of it by more than its own half width
 * when it lands is missed.
 */
const BLACK_ICE_RAIL_CHUNK = FIELD_HALF_WIDTH * 2 / 3
const RAIL_GUN_HALF = 24

const ROOTKIT_BURROW_CLUTCH = 3

/** Radar ping: recharge, wavefront speed in field units a second, and how long a contact stays lit. */
const PING_COOLDOWN_MS = 3500
const PING_SPEED = 1500
const PING_REVEAL_MS = 2600

/**
 * How hard spawns bunch toward the end of the window: 1 is even, higher packs
 * more of the wave into its closing seconds.
 */
const SPAWN_RAMP = 1.8

/** The last stretch of a wave: everything drops what it is doing and charges the fence. */
const FINAL_PUSH_MS = 12_000
const FINAL_PUSH_SPEED = 1.35

/** How many open nodes the hackers split across at once. */
const HACK_FRONTS = 2

/** The most hackers that work one node at once; the rest wait this much further out for a free terminal. */
const HACK_TEAM = 4
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

/** Hacker zap-dodge: how far ahead a round is seen, the odds of dodging it, the jump range, and the recharge. */
const ZAP_SIGHT = 150
const ZAP_CHANCE = 0.55
const ZAP_MIN = 45
const ZAP_MAX = 170
const ZAP_COOLDOWN_MS = 2600

/** Half the width of a turret's own lane, in field units: mounts sit about twice this apart. */
const TURRET_LANE = 75

/** How often a turret holding a target looks again for one it would rather shoot. */
const TURRET_RETARGET_MS = 400

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

/**
 * Hackers park side by side in a row behind a node (portal side), facing
 * the fence: the row this far behind it, this many slots either side of the
 * middle. One within this distance of its node leaves the line to park.
 */
const HACK_ROW_BACK = 70
const HACK_SLOT_SIDE = 2
const HACK_PARK_FROM = 280

/** Facing for a rider: down the column toward the fence, or along a rung. */
const YAW_DOWN = 0
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

/** The colour of an electric prod's discharge. */
const PROD_HEX = 0xbfe9ff

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

/** PACKET LOSS: the share of player rounds that never arrive. */
const PACKET_LOSS = 0.25

/**
 * The blue pulse a round knocks out of a hacked node: strength it loses per
 * field unit on each kind of ground (it starts at 1), how many nodes on it can
 * fan out through, and the most that may run at once.
 */
const LINE_PULSE_FADE = { held: 1 / 1400, contested: 1 / 550, theirs: 1 / 170 }
const LINE_PULSE_HOPS = 1
const LINE_PULSE_MAX = 24

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

/**
 * The Longbore's track: how far either side of the middle it can glide (field
 * units, just inside the lane), and how fast — quick enough to keep up with a
 * cursor sweeping the lane.
 */
const RAIL_TRACK = FIELD_HALF_WIDTH - 20
const RAIL_GLIDE = 2400

/**
 * The Longbore punching through a body: the flame it throws up, how long the
 * round hangs in the body before carrying on, and how hard it drives it back.
 */
const LONGBORE_FLARE = 0xc084fc
const PUNCH_HOLD_MS = 70
const PUNCH_PUSH = 480

/** The clearance kept between two bodies on the ground, in field units. */
const CROWD_GAP = 4

/** How long a body may stand blocked before a jam is broken, and how long it then backs off to break it. */
const JAM_MS = 2500
const YIELD_MS = 700

/**
 * A rider's line is guidance, not a rail: it may stand off it by up to this
 * much (field units) to step round a body or stand beside one, which is
 * enough to reach the next pin over. It eases back onto the line, at this
 * share of its speed, whenever there is room.
 */
const LANE_SLACK = 70
const LANE_RETURN = 0.5

/** Rounds the Tarpit Grid burns from the gun's magazine each second it is biting. */
const TARPIT_ROUNDS_PER_S = 1

/** Auto-play offers Laya this many hostiles to choose between, and counts this close to the wall as near. */
const AUTOPILOT_CONTACTS = 5
const AUTOPILOT_NEAR = 250

/** Hostiles this close together count as one pack, for where auto-play puts a deployable. */
const AUTOPILOT_PACK_RADIUS = 140

/** How far ahead of a pack (toward the wall) auto-play puts each deployable that waits for it. */
const AUTOPILOT_DEPLOY_AHEAD: Partial<Record<HackerzDeployableId, number>> = { honeypot: 120, proxy: 90, bomb: 60, surge: 0 }

/** How long a round fired blind into the dark lights up what it hits. */
const HIT_LIGHT_MS = 450

/** The most two overlapping bodies are pushed apart in one tick (field units). */
const SEPARATE_STEP = 4

/** How long a blast leaves a unit glitching, and over how much of the end it eases out. */
const GLITCH_MS = 650

/**
 * A hacker passing through another body tears at full strength (kept topped
 * up past the fade while they overlap), with a puff of corrupted blocks this
 * often per frame — but none of a blast's skips. Cosmetic.
 */
const PHASE_GLITCH_MS = GLITCH_FADE_MS + 100
const PHASE_CLOUD_CHANCE = 0.08

/** How fast a health bar's trail drains after a hit, in bar-lengths a second. */
const HP_TRAIL_DRAIN = 0.9

/** How close to its stop line a demo unit counts as there: `walkTo` settles within 3. */
const PUPPET_SETTLE = 4

/** Deployables may only go down on this stretch of the lane. */
const DEPLOY_MIN_D = 60
const DEPLOY_MAX_D = FIELD_DEPTH * 0.85
const DEPLOY_KEYS: Record<string, HackerzDeployableId> = Object.fromEntries(HACKERZ_DEPLOYABLES.map(def => [def.key.toLowerCase(), def.id]))

/** A logic bomb dropped this close to a node that is not theirs is wired onto it. */
const BOMB_CHIP_SNAP = 110

export class HackerzGame {
    view: HackerzScene | null = null
    callbacks: HackerzCallbacks
    particles = new ParticleSystem(5000)
    transient: TransientFx | null = null
    overlay = new Overlay()
    fieldRoot = new THREE.Group()
    railRig: ModelRig | null = null
    private ammoRack: AmmoRack | null = null
    private laneProps: LaneProps | null = null
    pathChips: PathChips | null = null
    private terminals: HackTerminals | null = null
    /** The data lines ground hostiles ride. Rebuilt each run. */
    private network: DataNetwork = { nodes: [], traces: [] }
    /** Hack pulses in flight from a terminal to its node: they count when they land. */
    private hackPulses: { chip: PathChip, from: THREE.Vector3, to: THREE.Vector3, t: number, mesh: THREE.Mesh }[] = []
    private pulseGeometry = new THREE.OctahedronGeometry(0.34, 0)
    private pulseMaterial = new THREE.MeshBasicMaterial({ color: hdr(0xff3b3b, 3), toneMapped: false })
    private guardrail: Guardrail | null = null
    /** Killed units still shorting out on the field: cosmetic only, already paid out. */
    private dying: { rig: ModelRig, age: number, life: number, hex: number }[] = []
    private resizeObserver: ResizeObserver | null = null
    private raf = 0
    private lastTime = 0

    // ── Lifecycle ──
    private destroyed = false
    private mounted = false
    /** A wave is live: enemies spawn, the clock runs, input fires. */
    running = false
    private paused = false
    /** The end-of-wave sweep is playing; input is dead but the field still ticks. */
    purging = false
    gameOver = false

    // ── Run state ──
    loadout: HackerzLoadout | null = null
    private weapon: HackerzWeaponRuntime | null = null
    private slots = 2
    private wave = 0
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
    private deployables: Deployables | null = null
    private linePulses: LinePulses | null = null
    private shrapnel: Shrapnel | null = null
    /** Warhead blasts: clouds of corrupted data scrambling the splash area. */
    private glitchClouds: GlitchClouds | null = null
    /** The firewall's syslog, for the terminal beside the board. */
    sysLog = new SysLog(line => this.callbacks.onLog?.(line))
    /** The hacker pack size last seen this wave, to announce a second contingent. */
    private hackerField = 0
    private decoysLogged = false
    private stock: HackerzDeployableStock = hackerzEmptyStock()
    /** Armed by Z/X/C: the next left click places it instead of firing. */
    private armed: HackerzDeployableId | null = null

    // ── Weapon ──
    private mag = 10
    private magSize = 10
    private fireTimer = 0
    private reloadTimer = 0
    /** Rounds the Tarpit Grid has drawn from the magazine but not yet spent a whole round of. */
    private tarpitDrain = 0
    private pulseCharge = 0
    private overclockCharge = 0
    private overclockLeft = 0
    private railHeading = Math.PI
    /** Where the rail gun stands along the wall: the middle, or wherever a railgun has glided to on its track. */
    private railU = RAIL_U
    /** The railgun's track across the deck, shown while the Longbore is on. */
    private railTrack: THREE.Object3D | null = null
    private railKick = 0
    private pingCharge = PING_COOLDOWN_MS

    // ── Entities ──
    enemies: EnemyEntity[] = []
    bullets: BulletEntity[] = []
    spits: SpitEntity[] = []
    /** BLACK ICE's globs in flight (a field position and velocity; `left` seconds to landing), and the walls they have built. */
    private iceGlobs: { mesh: THREE.Mesh, u: number, d: number, y: number, vu: number, vd: number, vy: number, left: number, atRail: boolean, width: number }[] = []
    private iceWalls: { u: number, d: number, wall: IceWall, ageMs: number }[] = []
    /** A Portscan's sweep left (ms), and the countdown to its next ping once the contacts fade. */
    private portscanLeft = 0
    private rescanMs = 0
    /** Power Surges on the grid: where, how long left, and the countdowns to the next arc and the next ring. */
    private surges: { u: number, d: number, leftMs: number, arcMs: number, ringMs: number }[] = []
    /** Hacked nodes ROOTKIT has infected, and ms until each hatches its next spiderling. */
    private infected = new Map<number, number>()
    private turrets: TurretMount[] = []

    // ── Input ──
    /** The hostile the button was pressed on: tracked only while it stays held. */
    target: EnemyEntity | null = null
    /** Left button held: the rail fires, at `target` or else at the cursor. */
    private holding = false
    /** Where a lag spike left the rail firing when it dropped the lock. */
    lockSpot: { u: number, d: number, y: number } | null = null
    /** A press always fires once, even if the button is up again before the next frame. */
    private queuedShot = false
    private aimU = 0
    private aimD = FIELD_DEPTH * 0.5
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

        this.railRig = buildRig('turret-rail', CYAN, 1.8)
        this.railRig.root.position.set(RAIL_U * FIELD_SCALE, WALL_HEIGHT, GUN_Z)
        view.scene.add(this.railRig.root)

        // The magazine sits on the deck right behind the rail, cabled into it.
        this.ammoRack = new AmmoRack(new THREE.Vector3(RAIL_U * FIELD_SCALE, WALL_HEIGHT + 0.25, GUN_Z + 0.7), CYAN)
        this.ammoRack.group.position.set(RAIL_U * FIELD_SCALE, WALL_HEIGHT, GUN_Z + 3.3)
        // Big enough to read every capacitor and its trace from the camera.
        this.ammoRack.group.scale.setScalar(1.3)
        this.ammoRack.group.updateMatrixWorld(true)
        view.scene.add(this.ammoRack.group)

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
        this.railTrack = track
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
        for (const mount of this.turrets) disposeRig(mount.rig)
        this.turrets = []
        if (this.railRig) disposeRig(this.railRig)
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
        const live = this.enemies.filter(e => e.hp > 0 && !e.turned && !e.decoy && !this.untargetable(e))
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
                hidden: hostile.filter(e => this.inTheDark(e) || (!!e.def.cloaked && !e.decloaked && e.revealMs <= 0)).length,
                total: hostile.length,
                pulseReady: !!loadout?.pulseUnlocked && this.pulseCharge >= loadout.pulseCooldownMs,
                pingReady: this.pingCharge >= PING_COOLDOWN_MS,
                overclockReady: !!loadout?.overclockUnlocked && this.overclockLeft <= 0 && this.overclockCharge >= loadout.overclockCooldownMs
            }
        }
    }

    /** Auto-play locks the rail on `target` and holds the trigger, or lets go with none. */
    autopilotAim(target: EnemyEntity | null) {
        const live = !!target && target.hp > 0 && this.enemies.includes(target)
        this.target = live ? target : null
        this.lockSpot = null
        this.holding = live
    }

    /**
     * The densest pack of ground hostiles: its centre, its size, the one in it
     * closest to the wall, and the one a White Hat would best turn. Null with
     * nothing on the ground.
     */
    private autopilotPack() {
        const best = densestGroup(this.enemies.filter(e => e.hp > 0 && !e.turned && !hackerzIsAirborne(e.def) && !this.untouchable(e)))
        if (!best.length) return null
        const u = best.reduce((sum, e) => sum + e.u, 0) / best.length
        const d = best.reduce((sum, e) => sum + e.d, 0) / best.length
        const lead = best.reduce((top, e) => e.d < top.d ? e : top)
        const convert = best.filter(e => this.turnable(e)).sort((a, b) => b.maxHp - a.maxHp)[0] ?? null
        return { u, d, size: best.length, lead, convert }
    }

    /** Auto-play's deployable stock and the pack it would be used on. */
    autopilotStock() {
        const pack = this.autopilotPack()
        return {
            stock: { ...this.stock },
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
        if (!this.running || this.purging || this.paused || this.stock[id] <= 0) return false
        const before = this.stock[id]
        if (hackerzDeployable(id).instant) {
            this.useInstant(id)
            return this.stock[id] < before
        }
        const pack = this.autopilotPack()
        if (!pack) return false
        if (id === 'whitehat') {
            if (pack.convert) this.useWhiteHat(pack.convert)
            return this.stock[id] < before
        }
        this.aimU = pack.u
        this.aimD = pack.d - (AUTOPILOT_DEPLOY_AHEAD[id] ?? 0)
        const spot = this.deploySpot(id)
        this.drop(id, spot.u, spot.d, spot.chip)
        return true
    }

    /**
     * Auto-play fires blind: with nothing to lock on but hostiles hidden in
     * the dark, the rail holds its trigger on the middle of the densest of
     * them — where a player would spray. A cloaked unit is not aimed at: a
     * round passes through it. True when it is firing.
     */
    autopilotBlindFire() {
        const pack = densestGroup(this.enemies.filter(e => e.hp > 0 && !e.turned && !this.untouchable(e) && this.inTheDark(e)))
        if (!pack.length) return false
        const n = pack.length
        this.target = null
        this.lockSpot = {
            u: pack.reduce((sum, e) => sum + e.u, 0) / n,
            d: pack.reduce((sum, e) => sum + e.d, 0) / n,
            y: pack.reduce((sum, e) => sum + enemyCentreY(e), 0) / n
        }
        this.holding = true
        return true
    }

    /** Auto-play fires an ability; each does nothing when it is not ready. */
    autopilotAbility(id: 'pulse' | 'ping' | 'overclock') {
        if (id === 'pulse') this.firePulse()
        else if (id === 'ping') this.firePing()
        else this.fireOverclock()
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
        this.holding = at !== null
        if (!at) this.target = null
    }

    /** Sets off one of the rail's abilities for the script, charged or not. */
    demoAbility(id: 'pulse' | 'overclock' | 'ping') {
        const loadout = this.loadout
        if (!this.demo || !loadout) return
        if (id === 'pulse') {
            this.pulseCharge = loadout.pulseCooldownMs
            this.firePulse()
        } else if (id === 'overclock') {
            this.overclockLeft = 0
            this.overclockCharge = loadout.overclockCooldownMs
            this.fireOverclock()
        } else {
            this.firePing(true)
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
            if (this.target && this.target.hp > 0 && this.enemies.includes(this.target)) return
            this.target = this.enemies
                .filter(e => e.hp > 0 && !e.turned && !this.untargetable(e))
                .sort((a, b) => a.d - b.d)[0] ?? null
        } else if (this.demoFiring === 'node') {
            const chip = this.pathChips?.ordered.find(c => c.state === 'hacked')
            this.target = null
            if (chip) {
                this.aimU = chip.u
                this.aimD = chip.d
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
            this.railHeading = Math.PI
            this.railU = RAIL_U
            this.railKick = 0
            this.bastion.msSinceWallHit = 99_999
            this.bastion.shieldHit = 0
            this.scoring.chain = 0
            this.scoring.totalKills = 0
            this.pingCharge = PING_COOLDOWN_MS
            // Dark zones fade in and out: one lit in the last scene must not still be fading here.
            for (const zone of this.territory.darkZones) Object.assign(zone, { u: 0, d: 0, r: 0, strength: 0, on: false })
            this.territory.darkness = 0
            // Their ground pours rather than jumps, so it is poured back out to the portal: no red left over.
            this.view?.redLine.fill(FIELD_DEPTH)
            this.view?.orangeLine.fill(FIELD_DEPTH)
            // Reused or freshly built, every mount starts as a new one stands: facing home, ready to fire.
            for (const mount of this.turrets) {
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
        this.stock[id] = HACKERZ_DEPLOYABLE_MAX
        if (hackerzDeployable(id).instant) {
            this.useInstant(id)
            return
        }
        if (id === 'whitehat') {
            const pick = this.enemies
                .filter(e => this.turnable(e))
                .sort((a, b) => Math.hypot(a.u - u, a.d - d) - Math.hypot(b.u - u, b.d - d))[0]
            this.useWhiteHat(pick ?? null)
            return
        }
        // Exactly where the script says: no snapping to a line or a node.
        this.drop(id, u, d, null)
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
            canvas.style.cursor = !this.armed && this.pickEnemy(p.x, p.y) ? 'pointer' : 'crosshair'
            if (this.armed) this.showGhost(this.armed)
            if (event.button < 0) return
            if (event.buttons & (1 << buttonBit(event.button))) press(event)
            else lift(event)
        }
        const buttonBit = (button: number) => button === 1 ? 2 : button === 2 ? 1 : button
        const onPointerDown = (event: PointerEvent) => press(event)
        const press = (event: PointerEvent) => {
            if (event.button === 2) {
                // Right click puts an armed deployable away; otherwise it pings.
                if (this.armed) this.arm(null)
                else this.firePing()
                return
            }
            if (event.button !== 0) return
            const p = local(event)
            // A White Hat is aimed at a hostile, not at the ground.
            if (this.armed === 'whitehat') {
                this.useWhiteHat(this.pickEnemy(p.x, p.y))
                return
            }
            if (this.armed) {
                this.setAimFromScreen(p.x, p.y)
                this.placeArmed()
                return
            }
            const frozen = this.pickFrozenTurret(p.x, p.y)
            if (frozen) {
                this.thaw(frozen)
                return
            }
            this.setAimFromScreen(p.x, p.y)
            // Press fires; holding keeps firing. Pressed on a hostile, the rail
            // tracks it for as long as the button stays down — though not
            // through a packet-loss spike, which drops every lock.
            this.lockSpot = null
            this.target = this.lag.boardLagMs > 0 ? null : this.pickEnemy(p.x, p.y)
            this.holding = true
            this.queuedShot = true
        }
        const release = () => {
            this.holding = false
            this.target = null
            this.lockSpot = null
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
            if (key === 'r') this.beginReload()
            if (key === 'escape') {
                this.target = null
                this.arm(null)
            }
            const deploy = DEPLOY_KEYS[key]
            // One with nothing to aim (a Portscan, a Cosmic Blip) goes off at once.
            if (deploy && hackerzDeployable(deploy).instant) this.useInstant(deploy)
            else if (deploy) this.arm(this.armed === deploy ? null : deploy)
            if (key === ' ') {
                // Space scrolls the page by default, which is fatal for a key
                // the player mashes under pressure.
                if (this.running) event.preventDefault()
                this.firePulse()
            }
            if (key === 'q') this.fireOverclock()
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
        this.aimU = hit.x * PER_WORLD
        this.aimD = Math.max(20, -hit.z * PER_WORLD)
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
            if (this.untargetable(enemy)) continue
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

    /**
     * Whether a round's step this frame touched a unit. The unit's footprint is
     * its model's: a capsule as long and as wide as the model, never smaller
     * than the body radius the rules give it.
     */
    private roundHits(bullet: BulletEntity, enemy: EnemyEntity) {
        if (this.untouchable(enemy)) return false
        // A rider turned onto a rung lies across the lane rather than along it.
        const sideways = Math.abs(Math.sin(enemy.yaw)) > 0.7
        const { x: across, z: along } = halfExtents(enemy.rig.box)
        const halfU = sideways ? along : across
        const halfD = sideways ? across : along
        const reach = Math.max(enemy.radius, halfU + BULLET_RADIUS)
        const spine = Math.max(0, halfD - halfU)
        return segSegDist(
            bullet.prevU, bullet.prevD, bullet.u, bullet.d,
            enemy.u, enemy.d - spine, enemy.u, enemy.d + spine
        ) <= reach
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
        this.weapon = loadout.weapon
        this.ammoRack?.setColour(loadout.weapon.hex)
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
        this.pulseCharge = loadout.pulseCooldownMs
        this.overclockCharge = loadout.overclockCooldownMs
        this.overclockLeft = 0
        this.magSize = Math.round(loadout.weapon.magazine)
        this.mag = this.magSize
        this.reloadTimer = 0
        this.tarpitDrain = 0
        this.slots = loadout.slots
        this.syncTurrets()
        this.bastion.emitWall()
        this.emitAmmo()
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
        this.stock = { ...loadout.deployables }
        this.deployables?.clear()
        this.linePulses?.clear()
        this.arm(null)
        const previousMax = this.bastion.wallMaxHp
        this.loadout = loadout
        this.weapon = loadout.weapon
        this.ammoRack?.setColour(loadout.weapon.hex)
        this.bastion.wallMaxHp = loadout.wallMaxHp
        if (loadout.wallMaxHp > previousMax) this.bastion.wallHp += loadout.wallMaxHp - previousMax
        this.bastion.wallHp = clamp(this.bastion.wallHp, 1, this.bastion.wallMaxHp)
        this.bastion.shieldMax = loadout.shieldMax
        this.bastion.shield = loadout.shieldMax
        this.magSize = Math.round(loadout.weapon.magazine)
        this.mag = this.magSize
        this.reloadTimer = 0
        this.tarpitDrain = 0
        this.fireTimer = 0
        this.pulseCharge = loadout.pulseCooldownMs
        this.overclockCharge = loadout.overclockCooldownMs
        this.overclockLeft = 0
        this.slots = loadout.slots
        this.syncTurrets()
        for (const mount of this.turrets) if (mount.frozenMs > 0) this.thaw(mount)

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
        this.target = null
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
        this.emitAmmo()
        this.emitPulse()
        this.emitOverclock()
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
        this.weapon = weapon
        this.ammoRack?.setColour(weapon.hex)
        this.magSize = Math.round(weapon.magazine)
        this.mag = this.magSize
        this.reloadTimer = this.running ? Math.min(600, weapon.reloadMs) : 0
        this.fireTimer = 0
        this.callbacks.onWeapon(weapon.id)
        this.emitAmmo()
        this.callbacks.onSound?.('weapon-swap')
    }

    // ─── Deployables ─────────────────────────────────────────────────────────

    /** Where a deployable would land: the cursor, kept to the deployable stretch. */
    private get deployD() {
        return clamp(this.aimD, DEPLOY_MIN_D, DEPLOY_MAX_D)
    }

    /** Arms a deployable for the next click, or disarms with null. Arming one you have none of does nothing. */
    arm(id: HackerzDeployableId | null) {
        if (id && (!this.running || this.purging || this.stock[id] <= 0)) {
            if (id && this.running && this.stock[id] <= 0) this.callbacks.onNotice(`No ${hackerzDeployable(id).name} left — buy them at the uplink.`, 'info')
            return
        }
        if (this.armed === id) return
        this.armed = id
        if (id) this.target = null
        this.showGhost(id)
        this.callbacks.onArm?.(id)
    }

    /**
     * The node a logic bomb under the cursor would wire onto: the nearest one
     * still ours or still being fought over, within reach of the cursor.
     */
    private bombChip(): PathChip | null {
        let best: PathChip | null = null
        let bestDistance = BOMB_CHIP_SNAP
        for (const chip of this.pathChips?.chips ?? []) {
            if (chip.state === 'hacked') continue
            const distance = Math.hypot(chip.u - this.aimU, chip.d - this.aimD)
            if (distance > bestDistance) continue
            best = chip
            bestDistance = distance
        }
        return best
    }

    /** Where an armed deployable would go down, and the node it would wire onto, if any. */
    private deploySpot(id: HackerzDeployableId) {
        if (id === 'bomb') {
            const chip = this.bombChip()
            if (chip) return { u: chip.u, d: chip.d, chip }
        }
        let u = clamp(this.aimU, -FIELD_HALF_WIDTH + 30, FIELD_HALF_WIDTH - 30)
        let d = this.deployD
        // A honeypot sits on a data line, or nothing could ride to it.
        if (id === 'honeypot') {
            const on = nearestOnNetwork(this.network, u, d)
            if (on) {
                u = on.u
                d = clamp(on.d, DEPLOY_MIN_D, DEPLOY_MAX_D)
            }
        }
        return { u, d, chip: null }
    }

    private showGhost(id: HackerzDeployableId | null) {
        // A White Hat picks a hostile: no patch of ground to preview.
        if (!id || id === 'whitehat') {
            this.deployables?.setGhost(null)
            return
        }
        const spot = this.deploySpot(id)
        this.deployables?.setGhost(id, spot.u, spot.d, this.wave)
    }

    private placeArmed() {
        const id = this.armed
        const deployables = this.deployables
        if (!id || !deployables || !this.running || this.purging || this.paused || this.stock[id] <= 0) return
        const { u, d, chip } = this.deploySpot(id)
        this.drop(id, u, d, chip)
        // One click, one drop: placing another means pressing the key again.
        this.arm(null)
    }

    /** Puts a deployable down at (u, d), wired onto `chip` if given, and spends one. */
    private drop(id: HackerzDeployableId, u: number, d: number, chip: PathChip | null) {
        // A Power Surge is a field the engine runs; the rest are props the deployables keep.
        if (id === 'surge') this.placeSurge(u, d)
        else this.deployables?.place(id, u, d, this.wave, chip?.id ?? null)
        const hex = hackerzDeployable(id).hex
        this.stock[id]--
        this.callbacks.onDeploy?.(id, this.stock[id])
        this.sysLog.deploy(id, chip?.id ?? null)
        const at = fieldToWorld(u, d, 0.2, new THREE.Vector3())
        this.transient?.ring(at, hex, 4, 0.4)
        this.particles.burst(at, hex, 30, 9, { size: 0.3, life: 0.6 })
        this.view?.addSurge(at.x, at.z, hex, 1.2)
        this.callbacks.onSound?.('weapon-swap')
    }

    // ─── Consumables: Portscan, Cosmic Blip, White Hat, Power Surge ──────────

    /**
     * A deployable with nothing to aim goes off the moment its key is pressed.
     * One that would do nothing right now (no node to flip back) is kept.
     */
    private useInstant(id: HackerzDeployableId) {
        const loadout = this.loadout
        if (!loadout || !this.running || this.purging || this.paused) return
        if (this.stock[id] <= 0) {
            this.callbacks.onNotice(`No ${hackerzDeployable(id).name} left — buy them at the uplink.`, 'info')
            return
        }
        if (id === 'portscan') {
            this.portscanLeft = loadout.portscanMs
            this.rescanMs = HACKERZ_PORTSCAN_REPING_MS
            this.firePing(true)
            this.sysLog.deploy(id, null)
        } else if (id === 'blip') {
            if (!this.cosmicBlip(loadout.blipNodes)) return
        } else return
        this.stock[id]--
        this.callbacks.onDeploy?.(id, this.stock[id])
        this.callbacks.onSound?.('weapon-swap')
    }

    /**
     * The Portscan keeps the radar sweeping: whenever the last contacts have
     * faded, it pings again a moment later, until it runs out.
     */
    private updatePortscan(dtMs: number) {
        if (this.portscanLeft <= 0) return
        this.portscanLeft = Math.max(0, this.portscanLeft - dtMs)
        if (this.portscanLeft <= 0) return
        const lit = this.enemies.some(e => e.revealMs > 0 || e.pingDelay >= 0)
        if (lit) {
            this.rescanMs = HACKERZ_PORTSCAN_REPING_MS
            return
        }
        this.rescanMs -= dtMs
        if (this.rescanMs > 0) return
        this.rescanMs = HACKERZ_PORTSCAN_REPING_MS
        this.firePing(true)
    }

    /** A Cosmic Blip: `count` hacked nodes, picked at random, flipped straight back to us. False when there are none. */
    private cosmicBlip(count: number) {
        const chips = this.pathChips
        const hacked = chips && !chips.locked ? chips.chips.filter(chip => chip.state === 'hacked') : []
        if (!hacked.length) {
            this.callbacks.onNotice(chips?.locked ? 'The flood holds every node — nothing for a blip to flip.' : 'No hacked node to flip back.', 'info')
            return false
        }
        let flipped = 0
        for (let n = 0; n < count && hacked.length; n++) {
            const chip = hacked.splice(randomInt(0, hacked.length - 1), 1)[0]!
            if (!chips!.reclaim(chip)) continue
            flipped++
            const at = fieldToWorld(chip.u, chip.d, 0.4, new THREE.Vector3())
            // Out of the sky: a white streak straight down onto the node.
            this.transient?.beam(fieldToWorld(chip.u, chip.d, 30, new THREE.Vector3()), at, 0xe0f2fe, 0.4)
            this.transient?.ring(at, CYAN, 6, 0.55)
            this.particles.burst(at, CYAN, 34, 10, { size: 0.32, life: 0.7 })
            this.view?.addSurge(at.x, at.z, CYAN, 1.6)
            this.pulseFromChip(chip)
        }
        this.sysLog.blip(flipped)
        return flipped > 0
    }

    /**
     * A White Hat: the hostile clicked (never a boss), and as many of the
     * nearest others as the Mainframe allows, switch sides for good.
     */
    private useWhiteHat(picked: EnemyEntity | null) {
        const loadout = this.loadout
        if (!loadout || !this.running || this.purging || this.paused || this.stock.whitehat <= 0) return
        if (!picked || !this.turnable(picked)) {
            this.callbacks.onNotice(picked?.def.boss ? 'A boss cannot be turned.' : 'Click a hostile to turn it.', 'info')
            return
        }
        const turned = [picked]
        const others = this.enemies
            .filter(e => e !== picked && this.turnable(e))
            .sort((a, b) => Math.hypot(a.u - picked.u, a.d - picked.d) - Math.hypot(b.u - picked.u, b.d - picked.d))
        turned.push(...others.slice(0, loadout.whitehatTargets - 1))
        for (const enemy of turned) this.turnEnemy(enemy)
        this.stock.whitehat--
        this.callbacks.onDeploy?.('whitehat', this.stock.whitehat)
        this.sysLog.whiteHat(turned.length)
        this.callbacks.onSound?.('coin-pickup')
        this.arm(null)
    }

    /** A hostile a White Hat can take: not a boss, not a copy, not one already ours, not one out of reach. */
    private turnable(enemy: EnemyEntity) {
        return !enemy.def.boss && !enemy.decoy && !enemy.turned && enemy.hp > 0 && !this.untargetable(enemy)
    }

    /** It switches sides: drops whatever job it had, and is marked white. */
    private turnEnemy(enemy: EnemyEntity) {
        enemy.turned = true
        if (enemy.hacking) this.stopHacking(enemy)
        // Every job it had for them is dropped: no more guarding, escorting or shield-bearing.
        enemy.escorting = null
        enemy.defending = null
        enemy.bearer = false
        enemy.parked = null
        enemy.healing = null
        if (this.target === enemy) this.target = null
        const halo = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: hdr(0xffffff, 2), toneMapped: false, transparent: true, opacity: 0.8, depthWrite: false }))
        halo.scale.setScalar(Math.max(0.6, enemy.rig.height * 0.4))
        halo.position.y = 0.05
        enemy.rig.root.add(halo)
        const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.particles.burst(at, 0xffffff, 24, 8, { size: 0.26, life: 0.6 })
        this.transient?.ring(at, 0xffffff, 3, 0.4)
        this.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'WHITE HAT', 0xffffff, 1.1)
    }

    /** What a turned unit, or a hostile it is brawling with, hits for: its own heft, not its wall damage. */
    private brawlHit(enemy: EnemyEntity) {
        return enemy.maxHp * 0.12 + enemy.damage * 3
    }

    /** The hostile a turned unit goes for: the nearest one it can reach. */
    private turnedFoe(enemy: EnemyEntity) {
        let best: EnemyEntity | null = null
        let bestDistance = Infinity
        for (const other of this.enemies) {
            if (other === enemy || other.turned || other.hp <= 0 || other.burrowMs > 0) continue
            // A turned unit on foot cannot reach a flyer.
            if (hackerzIsAirborne(other.def) && !hackerzIsAirborne(enemy.def)) continue
            const distance = Math.hypot(other.u - enemy.u, other.d - enemy.d)
            if (distance < bestDistance) {
                best = other
                bestDistance = distance
            }
        }
        return best
    }

    /** A turned unit's move: after the nearest hostile, and a blow every attack beat once it is there. */
    private turnedStep(enemy: EnemyEntity, dt: number, dtMs: number) {
        const foe = this.turnedFoe(enemy)
        if (!foe) return { moved: 0, arrived: false }
        const du = foe.u - enemy.u
        const dd = foe.d - enemy.d
        const dist = Math.hypot(du, dd)
        const reach = enemy.radius + foe.radius + 10
        let moved = 0
        if (dist > reach) {
            moved = Math.min(dist - reach, enemy.speed * this.pushSpeed * dt)
            enemy.u += du / dist * moved
            enemy.d += dd / dist * moved
            enemy.yaw = Math.atan2(du, -dd)
        } else {
            enemy.attackTimer -= dtMs
            if (enemy.attackTimer <= 0) {
                enemy.attackTimer = enemy.def.attackMs
                enemy.strike = 1
                this.damageEnemy(foe, this.brawlHit(enemy), 'kinetic', true, true)
                const at = enemyWorld(foe, foe.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
                this.particles.burst(at, 0xffffff, 8, 6, { size: 0.22, life: 0.3 })
            }
        }
        return { moved, arrived: false }
    }

    /**
     * A hostile with a turned unit in its face fights it instead of pressing on:
     * stands, and hits it every attack beat. Null when none is close enough.
     */
    private brawlStep(enemy: EnemyEntity, dtMs: number) {
        if (enemy.turned || enemy.def.boss) return null
        let foe: EnemyEntity | null = null
        for (const other of this.enemies) {
            if (!other.turned || other.hp <= 0) continue
            if (Math.hypot(other.u - enemy.u, other.d - enemy.d) <= enemy.radius + other.radius + 12) {
                foe = other
                break
            }
        }
        if (!foe) return null
        enemy.attackTimer -= dtMs
        if (enemy.attackTimer <= 0) {
            enemy.attackTimer = enemy.def.attackMs
            enemy.strike = 1
            this.damageEnemy(foe, this.brawlHit(enemy), 'kinetic', true, false)
        }
        return { moved: 0, arrived: false }
    }

    /** A Power Surge laid on the grid at (u, d). */
    private placeSurge(u: number, d: number) {
        const loadout = this.loadout
        if (!loadout) return
        this.surges.push({ u, d, leftMs: loadout.surgeMs, arcMs: 0, ringMs: 0 })
    }

    /** Every Power Surge on the grid: arcs into the hostiles inside it, a few at a time, until it runs out. */
    private updateSurges(dtMs: number) {
        if (!this.surges.length) return
        const stats = hackerzDeployableStats(this.wave).surge
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
                this.transient?.ring(fieldToWorld(surge.u, surge.d, 0.08, _v), hex, stats.radius * FIELD_SCALE, 0.5, 0.6)
            }
            const centre = fieldToWorld(surge.u, surge.d, 0.3, new THREE.Vector3())
            if (Math.random() < dtMs / 1000 * 8) {
                const a = Math.random() * Math.PI * 2
                const r = Math.random() * stats.radius
                this.transient?.bolt(centre, fieldToWorld(surge.u + Math.cos(a) * r, surge.d + Math.sin(a) * r, 0.1, new THREE.Vector3()), hex)
            }
            surge.arcMs -= dtMs
            if (surge.arcMs > 0) continue
            surge.arcMs += stats.arcMs
            const inside = this.enemies.filter(e => !e.turned && e.hp > 0 && !this.untouchable(e)
                && Math.hypot(e.u - surge.u, e.d - surge.d) <= stats.radius)
            for (let n = 0; n < stats.arcs && inside.length; n++) {
                const enemy = inside.splice(randomInt(0, inside.length - 1), 1)[0]!
                this.damageEnemy(enemy, stats.damage, 'energy', true, true)
                const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
                this.transient?.bolt(centre, at, hex)
                this.particles.burst(at, hex, 5, 6, { size: 0.2, life: 0.25 })
            }
        }
    }

    /** A honeypot or logic bomb goes off: everything in the radius takes it, falling off to half at the edge. */
    private detonateBlast(blast: Blast) {
        const at = fieldToWorld(blast.u, blast.d, 0.4, new THREE.Vector3())
        this.transient?.ring(at, blast.hex, blast.radius * FIELD_SCALE, 0.5, 2)
        this.transient?.flash(at, blast.hex, 3, 0.3)
        this.particles.burst(at, blast.hex, 90, 18, { size: 0.42, life: 0.9, gravity: 10 })
        this.particles.burst(at, 0xffffff, 30, 12, { size: 0.3, life: 0.5 })
        this.view?.addSurge(at.x, at.z, blast.hex, 2.4)
        this.view?.flash(blast.hex, 0.18)
        this.addShake(12)
        this.callbacks.onSound?.('boss-death')
        let kills = 0
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i] as EnemyEntity
            if (this.untouchable(enemy)) continue
            const distance = Math.hypot(enemy.u - blast.u, enemy.d - blast.d)
            if (distance > blast.radius) continue
            this.damageEnemy(enemy, blast.damage * (1 - 0.5 * distance / blast.radius), 'energy', true, true)
            if (!enemy.def.boss) enemy.pushVd += 160 * (1 - distance / blast.radius)
            if (enemy.hp <= 0) {
                this.killEnemy(i, 1)
                kills++
            }
        }
        this.sysLog.blast(blast.kind, kills)
        const label = blast.kind === 'honeypot' ? 'HONEYPOT SPRUNG' : 'LOGIC BOMB'
        this.overlay.floatText(fieldToWorld(blast.u, blast.d, 3, _v), kills > 1 ? `${label} ×${kills}` : label, blast.hex, kills > 2 ? 1.7 : 1.3)
        if (kills >= 4) this.overlay.banner(`MULTI-KILL ×${kills}`, blast.hex)
    }

    private updateDeployables(dt: number) {
        const deployables = this.deployables
        if (!deployables) return
        const ground = this.enemies
            .filter(e => !hackerzIsAirborne(e.def) && !this.untouchable(e))
            .map(e => ({ u: e.u, d: e.d, hacker: e.def.id === HACKERZ_HACKER_ID }))
        const events = deployables.update(dt, ground)
        for (const blast of events.blasts) this.detonateBlast(blast)
        for (const broken of events.broken) {
            const at = fieldToWorld(broken.u, broken.d, 1, new THREE.Vector3())
            this.particles.burst(at, broken.hex, 50, 12, { size: 0.3, life: 0.6 })
            if (broken.hp <= 0) this.overlay.floatText(at, 'PROXY DOWN', broken.hex, 1.1)
        }
    }

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
        this.holding = false
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

    // ─── Bastion assembly ────────────────────────────────────────────────────

    /** Rebuilds the mounted turrets to match what the uplink installed. */
    private syncTurrets() {
        const view = this.view
        if (!view) return
        const wanted = this.loadout?.turrets ?? []
        const same = wanted.length === this.turrets.length
            && wanted.every((runtime, i) => this.turrets[i]?.runtime.id === runtime.id && this.turrets[i]?.runtime.slot === runtime.slot)
        if (same) {
            // Same hardware, new numbers (Firmware, Foundry): keep the rigs.
            wanted.forEach((runtime, i) => { this.turrets[i]!.runtime = runtime })
        } else {
            for (const mount of this.turrets) disposeRig(mount.rig)
            this.turrets = []
            for (const runtime of wanted) {
                const anchor = mountPosition(runtime.slot)
                const rig = buildRig(`turret-${runtime.id}`, runtime.hex, 1.3)
                const z = GUN_Z + anchor.z
                rig.root.position.set(anchor.u * FIELD_SCALE, WALL_HEIGHT + 0.1 + anchor.rise, z)
                view.scene.add(rig.root)
                this.turrets.push({
                    runtime,
                    rig,
                    u: anchor.u,
                    z,
                    muzzleD: -z * PER_WORLD,
                    muzzleLift: anchor.rise * PER_WORLD,
                    cooldown: randomBetween(0, 400),
                    kick: 0,
                    heading: Math.PI,
                    frozenMs: 0,
                    ice: null,
                    target: null,
                    retargetMs: 0
                })
            }
        }
        const installed = Array.from({ length: HACKERZ_MAX_SLOTS }, (_, slot) => wanted.some(t => t.slot === slot))
        view.setMountsUsed(this.slots, installed)
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
                this.hatchInfected(dtMs)
                this.updateWeapon(dtMs)
                this.updateAbilities(dtMs)
                if (!this.finalPush && this.waveElapsed >= this.waveMs - FINAL_PUSH_MS) this.beginFinalPush()
                if (this.waveElapsed >= this.waveMs) this.beginPurge()
            }
            this.updateDeployables(dt)
            this.updateEnemies(dt, dtMs)
            this.updateBullets(dt)
            this.updateSpits(dt)
            this.updateIce(dt)
            if (this.running && !this.purging) this.updateSurges(dtMs)
            this.updateTurrets(dtMs, frozen)
            this.scoring.updateCoins(frozen ? 0 : dtMs)
            this.bastion.updateBastion(dt, dtMs)
            this.memory.updateLeaks(dt, frozen ? 0 : dtMs)
            this.updateHackPulses(dt)
            this.pathChips?.update(seen)
            this.linePulses?.update(seen, (u, d) => this.pulseFade(u, d))
            this.shrapnel?.update(seen)
            this.glitchClouds?.update(seen)
            this.particles.update(seen)
            this.transient?.update(seen)
        }
        this.guardrail?.update(live ? seen : 0)
        this.terminals?.update(live ? seen : 0, view.camera)
        this.updateRail(frozen ? 0 : dt)
        this.updateCamera(dt)
        this.territory.updateTerritory(live ? seen : 0)
        const reload = this.reloadTimer > 0 && this.weapon ? 1 - this.reloadTimer / this.weapon.reloadMs : 1
        this.ammoRack?.update(live ? seen : 0, this.mag, this.magSize, reload)
        this.laneProps?.update(live ? seen : 0, view.redLine, view.orangeLine)
        this.updateDying(live ? seen : 0)
        view.ageSurges(live ? seen : 0)

        // The grid goes dark while the gun reloads: it has no power then.
        view.trapMaterial.uniforms.uLevel!.value = (this.loadout?.spikeDps ?? 0) > 0 && this.tarpitPowered ? 1 : 0
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
        this.removeEnemy(index, true)
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
    private walkTo(enemy: EnemyEntity, u: number, d: number, dt: number) {
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
        const taken = new Set(this.enemies.filter(e => e !== enemy && e.hackSlot?.chip === node).map(e => e.hackSlot!.index))
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
    private parkStep(enemy: EnemyEntity, node: PathChip, dt: number) {
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
            return { moved: this.walkTo(enemy, spot.u, spot.d, dt), arrived: false }
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
                return { moved: this.walkTo(enemy, node.u + side * rowEnd, enemy.d, dt), arrived: false }
            }
            return { moved: this.walkTo(enemy, enemy.u, laneD, dt), arrived: false }
        }
        // Behind it: down onto the lane, then along it to the slot.
        if (enemy.d > laneD + 3) return { moved: this.walkTo(enemy, enemy.u, laneD, dt), arrived: false }
        return { moved: this.walkTo(enemy, spot.u, laneD, dt), arrived: false }
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
        if (this.target) {
            const height = this.target.rig.height * PER_WORLD
            const pos = this.lag.seenWorld(this.target, height * 0.5, new THREE.Vector3())
            const top = view.project(this.lag.seenWorld(this.target, height, _w), { x: 0, y: 0 })
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
    private spawn(def: HackerzEnemyDefinition, reinforcement = false, hpScale = 1, at: { u: number, d: number } | null = null) {
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
        if (!at && !def.boss && !hackerzIsAirborne(def) && this.crowdedAt(enemy)) {
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
        const spikeDps = this.tarpitPowered ? this.loadout?.spikeDps ?? 0 : 0
        let spiking = false

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i] as EnemyEntity
            // Felled in a brawl or by a Power Surge since its last turn: a hostile
            // pays out as any kill; a turned unit that falls pays nothing.
            if (enemy.hp <= 0) {
                this.killEnemy(i, enemy.turned ? 0 : 1)
                continue
            }
            // Waiting inside the portal for its socket to clear: it steps out
            // (and resolves in) only once nothing is standing there.
            if (enemy.gateHold) {
                if (this.crowdedAt(enemy)) continue
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
            let node = !hold && !enemy.turned && this.canHack(enemy) ? this.hackTarget(enemy) : null
            if (!node && !hold && riding && this.canHack(enemy)) {
                const open = this.pathChips?.ordered.filter(chip => chip.state !== 'hacked') ?? []
                const nearest = open.reduce<PathChip | null>((best, chip) =>
                    !best || Math.hypot(chip.u - enemy.u, chip.d - enemy.d) < Math.hypot(best.u - enemy.u, best.d - enemy.d) ? chip : best, null)
                if (nearest && this.planDetour(enemy, nearest)) node = this.hackTarget(enemy)
            }
            if (enemy.def.id === HACKERZ_HACKER_ID && riding) this.dodge(enemy, dtMs)
            if (!node && enemy.hacking) this.stopHacking(enemy)

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
                ? (live ? this.turnedStep(enemy, dt, dtMs) : { moved: 0, arrived: false })
                : (live ? this.brawlStep(enemy, dtMs) : null)
                    ?? (enemy.def.heal && !enemy.kamikaze && live ? this.healers.healerStep(enemy, dt, dtMs) : null)
            const step = mending ?? (enemy.demoPath
                ? this.puppetStep(enemy, goal, hold, dt)
                : parked
                ? this.walkToPark(enemy, parked, dt)
                : tactic === 'advance'
                    ? (node && !queued && riding ? this.parkStep(enemy, node, dt) : null)
                    ?? (riding ? this.ride(enemy, goal, dt) : this.fly(enemy, goal, dt))
                    : { moved: this.holdBack(enemy, tactic, dt), arrived: false })
            if (!node || queued || tactic !== 'advance') enemy.hackSlot = null
            // Stride is driven by distance, not time, so a knocked-back or
            // crowded enemy never moon-walks.
            enemy.stride += strideFor(step.moved, unitSize(enemy.def))
            let rollSpeed = rollSpeedFor(step.moved, enemy.rig.height, dt, FIELD_SCALE)

            if (tactic !== 'advance') {
                if (enemy.hacking) this.stopHacking(enemy)
            } else if (!step.arrived) {
                if (enemy.hacking) this.stopHacking(enemy)
            } else if (node && queued) {
                // Waiting its turn at the node: idling on the spot.
                rollSpeed = 0
            } else if (node) {
                rollSpeed = 0
                this.hackAt(enemy, node, dtMs)
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
                        if (this.strikeDeployable(enemy, hold)) continue
                    } else {
                        this.enemyStrike(enemy)
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
                    this.removeEnemy(i)
                    continue
                }
            }

            // Bodies are solid: a move that would carry this one into another
            // stops at the point of contact.
            this.collide(enemy, fromU, fromD, fromSeg, fromYaw, dtMs)

            // Grid trap: ground units only, and only inside the band.
            if (spikeDps > 0 && !enemy.turned && !hackerzIsAirborne(enemy.def) && enemy.d < SPIKE_BAND) {
                spiking = true
                this.damageEnemy(enemy, spikeDps * dt, 'kinetic', false, false, false, false)
                if (enemy.hp <= 0) {
                    this.killEnemy(i, 1)
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
                    this.damageEnemy(enemy, bite, 'energy', false, !this.untouchable(enemy), false, false)
                    this.particles.burst(enemyWorld(enemy, 3, _v), CYAN, 4, 5, { size: 0.18, life: 0.3 })
                    if (enemy.hp <= 0) {
                        this.killEnemy(i, 1)
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
            if (this.target === enemy && this.inTheDark(enemy)) {
                this.lockSpot = { u: enemy.u, d: enemy.d, y: enemyCentreY(enemy) }
                this.target = null
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
                    if (enemy.rig.weaponKind === 'ram') this.ramImpact(enemy)
                    else this.prodZap(enemy)
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
                if (injectLands(before, enemy.inject) && enemy.def.id === 'titan') this.injectBrood(enemy)
            }
            if (enemy.ribbonMs > 0 || enemy.ribbon?.busy) this.feedRibbon(enemy, dt, dtMs)
            enemy.storm?.update(dt)
            enemy.wound?.update(dt)
        }

        if (spiking) this.drainTarpit(dt)
        this.separate()
    }

    /** The Tarpit Grid has power while the gun has rounds in it and is not reloading. */
    private get tarpitPowered() {
        return this.reloadTimer <= 0 && this.mag > 0
    }

    /**
     * The Tarpit Grid draws its power from the gun: while it is biting it
     * burns through the magazine at a steady rate, on top of whatever the gun
     * fires, and an empty magazine sends the gun to reload — the grid going
     * dark with it until the reload is done.
     */
    private drainTarpit(dt: number) {
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

    // ─── Bosses ──────────────────────────────────────────────────────────────

    private updateBoss(enemy: EnemyEntity, dt: number, dtMs: number) {
        if (enemy.decoy) return
        switch (enemy.def.id) {
            case 'titan':
                this.updateRootkit(enemy, dt, dtMs)
                break
            case 'leviathan':
                this.updateBlackIce(enemy, dtMs)
                break
            case 'zeroday':
                this.updateZeroDay(enemy, dt)
                break
        }
    }

    /**
     * ROOTKIT goes to ground every few seconds while it is still far out: gone
     * from sight and from every gun, moving faster, its route given away only by
     * red surges running through the traces, until it erupts somewhere else.
     */
    private updateRootkit(enemy: EnemyEntity, dt: number, dtMs: number) {
        // It halts with its head against the ICE Barrier while that stands,
        // and against the fence itself once the barrier is down.
        enemy.standoff = enemy.rig.box.max.z * PER_WORLD + 2 + (this.bastion.shield > 0 ? SHIELD_D : 0)
        if (enemy.riseMs > 0) enemy.riseMs = Math.max(0, enemy.riseMs - dtMs)
        if (enemy.burrowMs > 0) {
            const wasUp = !underground(enemy)
            enemy.burrowMs = Math.max(0, enemy.burrowMs - dtMs)
            // The moment it drills out of sight, a clutch of its brood scatters from the hole.
            if (wasUp && underground(enemy) && !enemy.decoy) {
                const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
                this.transient?.ring(at, enemy.def.hex, 6, 0.45)
                this.particles.burst(at, enemy.def.hex, 30, 10, { size: 0.3, life: 0.6 })
                for (let i = 0; i < ROOTKIT_BURROW_CLUTCH; i++) {
                    const a = (i / ROOTKIT_BURROW_CLUTCH) * Math.PI * 2
                    this.hatchSpider(enemy.u + Math.cos(a) * 40, enemy.d + Math.sin(a) * 40)
                }
            }
            // Melting in: the floor boils red round it as it goes under.
            if (!underground(enemy) && Math.random() < dt * 30) {
                const at = fieldToWorld(enemy.u + randRange(-30, 30), enemy.d + randRange(-30, 30), 0.05, _v)
                this.particles.emit(at, _w.set(0, 1.5, 0), enemy.def.hex, { size: 0.3, life: 0.5, gravity: 0 })
            }
            enemy.u = clamp(enemy.u + Math.sin(enemy.age * 1.6) * dt * 90, -FIELD_HALF_WIDTH + 60, FIELD_HALF_WIDTH - 60)
            if (Math.random() < dt * 5) {
                const at = fieldToWorld(enemy.u, enemy.d, 0, _v)
                this.view?.addSurge(at.x, at.z, enemy.def.hex, 0.8)
            }
            if (enemy.burrowMs === 0) {
                // It erupts onto the nearest data line and rides on from there.
                this.attachToNetwork(enemy)
                enemy.age = 0
                // And climbs back out of the floor where it surfaced.
                enemy.riseMs = MOTION.burrowRiseMs
                const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
                this.transient?.ring(at, enemy.def.hex, 9, 0.5)
                this.particles.burst(at, enemy.def.hex, 50, 12, { size: 0.35, life: 0.7 })
                this.addShake(8)
            }
            return
        }
        this.rootkitBrood(enemy, dtMs)
        enemy.bossTimer -= dtMs
        if (enemy.bossTimer > 0 || enemy.d < enemy.standoff + 220) return
        enemy.bossTimer = 6000
        enemy.burrowMs = ROOTKIT_BURROW_MS
        const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
        this.transient?.ring(at, enemy.def.hex, 7, 0.45)
        this.particles.burst(at, enemy.def.hex, 40, 10, { size: 0.3, life: 0.6 })
        this.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD, _v), 'BURROWING', enemy.def.hex, 1.2)
        if (this.target === enemy) this.target = null
    }

    /**
     * BLACK ICE spits black ice: globs that land ahead of it and freeze into
     * walls that shield what is behind them, slowing every round through them,
     * and every third spit at your rail, where a hit lags the whole board.
     */
    private spitBlackIce(enemy: EnemyEntity, dtMs: number) {
        if (!this.running || this.purging || enemy.decoy) return
        enemy.broodMs -= dtMs
        if (enemy.broodMs > 0) return
        enemy.broodMs = BLACK_ICE_SPIT_MS
        enemy.burstLeft = (enemy.burstLeft + 1) % 3
        const atRail = enemy.burstLeft === 0 && !!this.railRig
        placeEnemy(enemy)
        const mouth = muzzleOf(enemy.rig, new THREE.Vector3())
        const from = { u: mouth.x * PER_WORLD, d: -mouth.z * PER_WORLD, y: mouth.y * PER_WORLD }
        let to: { u: number, d: number, y: number }
        // At the rail it throws a slab a third of the field wide, at where the
        // gun stands now: a gun that can glide (the Longbore) can get out from under it.
        const width = atRail ? BLACK_ICE_RAIL_CHUNK : 0
        if (atRail) {
            const rail = this.railRig!.root.position
            const u = clamp(this.railU, -FIELD_HALF_WIDTH + width / 2, FIELD_HALF_WIDTH - width / 2)
            to = { u, d: -rail.z * PER_WORLD, y: (rail.y + 1) * PER_WORLD }
        } else {
            // Ahead of it, between it and the fence: where its wall will stand.
            to = { u: clamp(enemy.u + randomBetween(-70, 70), -FIELD_HALF_WIDTH + 60, FIELD_HALF_WIDTH - 60), d: Math.max(BLACK_ICE_WALL_MIN_D, enemy.d * randomBetween(0.45, 0.65)), y: 0 }
        }
        const flight = atRail ? 1.1 : 0.9
        const gravity = BLACK_ICE_GRAVITY
        const mesh = makeIceGlob(enemy.rig.height * (atRail ? 0.22 : 0.12))
        if (width) {
            // Stretched across the lane to the slab's full width.
            const box = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!)
            mesh.scale.x = width * FIELD_SCALE / Math.max(0.01, box.max.x - box.min.x)
        }
        mesh.position.copy(mouth)
        this.fieldRoot.add(mesh)
        this.iceGlobs.push({
            mesh,
            ...from,
            vu: (to.u - from.u) / flight,
            vd: (to.d - from.d) / flight,
            vy: (to.y - from.y) / flight + 0.5 * gravity * flight,
            left: flight,
            atRail,
            width
        })
        this.transient?.flash(mouth, 0xa5b4fc, 0.9)
        this.particles.burst(mouth, 0xa5b4fc, 10, 6, { size: 0.24, life: 0.35 })
    }

    /** Black ice in flight, landing, and the walls it builds; called every frame. */
    private updateIce(dt: number) {
        for (let i = this.iceGlobs.length - 1; i >= 0; i--) {
            const glob = this.iceGlobs[i]!
            glob.left -= dt
            glob.vy -= BLACK_ICE_GRAVITY * dt
            glob.u += glob.vu * dt
            glob.d += glob.vd * dt
            glob.y += glob.vy * dt
            fieldToWorld(glob.u, glob.d, glob.y * FIELD_SCALE, glob.mesh.position)
            // A slab tumbles end over end along its length; a glob spins every way.
            glob.mesh.rotation.x += dt * 4
            if (!glob.width) glob.mesh.rotation.y += dt * 3
            if (Math.random() < dt * 30) this.particles.emit(glob.mesh.position, _w.set(0, 0.3, 0), 0xa5b4fc, { size: 0.18, life: 0.35, gravity: 0 })
            if (glob.left > 0) continue
            const at = glob.mesh.position.clone()
            disposeIceGlob(glob.mesh)
            this.iceGlobs.splice(i, 1)
            this.particles.burst(at, 0xa5b4fc, 18, 7, { size: 0.26, life: 0.5 })
            if (glob.atRail) {
                // It shatters along its whole length on the rail.
                for (let k = -2; k <= 2; k++) {
                    const shard = fieldToWorld(glob.u + k * glob.width / 5, glob.d, at.y, new THREE.Vector3())
                    this.particles.burst(shard, 0xa5b4fc, 10, 6, { size: 0.24, life: 0.45 })
                }
                // Clear of the gun: it smashes on the rail and does nothing.
                if (Math.abs(this.railU - glob.u) > glob.width / 2 + RAIL_GUN_HALF) {
                    this.addShake(2)
                    continue
                }
                // On the gun: the frame freezes, as in PACKET LOSS.
                this.transient?.ring(at, 0xa5b4fc, 3, 0.4)
                this.view?.flash(0xa5b4fc, 0.12)
                this.lag.lagSpike()
                continue
            }
            this.depositIce(glob.u, glob.d)
        }
        for (let i = this.iceWalls.length - 1; i >= 0; i--) {
            const wall = this.iceWalls[i]!
            wall.ageMs += dt * 1000
            if (wall.ageMs > BLACK_ICE_WALL_LIFE_MS) wall.wall.thaw()
            wall.wall.update(dt)
            if (!wall.wall.gone) continue
            wall.wall.dispose()
            this.iceWalls.splice(i, 1)
        }
    }

    /** A glob lands: it freezes onto the wall here, or starts a new one. */
    private depositIce(u: number, d: number) {
        let wall = this.iceWalls.find(w => Math.abs(w.u - u) < BLACK_ICE_WALL_WIDTH * 0.6 && Math.abs(w.d - d) < 60)
        if (!wall) {
            const iceWall = new IceWall(this.fieldRoot, fieldToWorld(u, d, 0, new THREE.Vector3()),
                BLACK_ICE_WALL_WIDTH * FIELD_SCALE, BLACK_ICE_WALL_HEIGHT * FIELD_SCALE)
            wall = { u, d, wall: iceWall, ageMs: 0 }
            this.iceWalls.push(wall)
        }
        wall.ageMs = 0
        wall.wall.deposit(BLACK_ICE_DEPOSIT)
        this.transient?.ring(fieldToWorld(u, d, 0.1, _v), 0xa5b4fc, 2.4, 0.35)
    }

    /** True when a round crossing from (u0, d0) to (u1, d1) passes through a wall of black ice. */
    private throughIce(u0: number, d0: number, u1: number, d1: number) {
        for (const wall of this.iceWalls) {
            if (wall.wall.fill < 0.2) continue
            const half = BLACK_ICE_WALL_WIDTH * 0.5 * Math.min(1, 0.4 + wall.wall.fill)
            if (Math.min(u0, u1) > wall.u + half || Math.max(u0, u1) < wall.u - half) continue
            if (Math.min(d0, d1) > wall.d + 8 || Math.max(d0, d1) < wall.d - 8) continue
            return wall
        }
        return null
    }

    private clearIce() {
        for (const glob of this.iceGlobs) disposeIceGlob(glob.mesh)
        this.iceGlobs = []
        for (const wall of this.iceWalls) wall.wall.dispose()
        this.iceWalls = []
    }

    /** BLACK ICE freezes one of your turrets at a time; a click on it thaws it. */
    private updateBlackIce(enemy: EnemyEntity, dtMs: number) {
        this.spitBlackIce(enemy, dtMs)
        enemy.bossTimer -= dtMs
        if (enemy.bossTimer > 0) return
        enemy.bossTimer = 7000
        const warm = this.turrets.filter(m => m.frozenMs <= 0)
        if (!warm.length) return
        const mount = warm[randomInt(0, warm.length - 1)]!
        mount.frozenMs = 12_000
        if (!mount.ice) {
            mount.ice = new THREE.Mesh(
                new THREE.OctahedronGeometry(1.05, 0),
                new THREE.MeshBasicMaterial({ color: hdr(0xbfe9ff, 1.2), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })
            )
            mount.ice.scale.set(1, 1.3, 1)
            mount.ice.position.y = 0.9
            mount.rig.root.add(mount.ice)
        }
        mount.ice.visible = true
        const from = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.7, new THREE.Vector3())
        const to = mount.rig.root.position.clone().add(_w.set(0, 1, 0))
        this.transient?.bolt(from, to, 0xbfe9ff)
        this.transient?.beam(from, to, 0xbfe9ff, 0.35)
        this.particles.burst(to, 0xbfe9ff, 24, 6, { size: 0.26, life: 0.6 })
        this.callbacks.onNotice('BLACK ICE froze a turret — click it to thaw.', 'bad')
    }

    /** Thaws a frozen turret, early by a click or on its own when the ice runs out. */
    private thaw(mount: TurretMount) {
        mount.frozenMs = 0
        if (mount.ice) mount.ice.visible = false
        const at = mount.rig.root.position.clone().add(_w.set(0, 1, 0))
        this.particles.burst(at, 0xbfe9ff, 30, 9, { size: 0.3, life: 0.6 })
        this.transient?.ring(at, 0xbfe9ff, 2.4, 0.35)
    }

    /** The frozen turret under the cursor, if any: thawing beats firing for that click. */
    private pickFrozenTurret(x: number, y: number) {
        const view = this.view
        if (!view) return null
        const screen = { x: 0, y: 0 }
        for (const mount of this.turrets) {
            if (mount.frozenMs <= 0) continue
            if (!view.project(mount.rig.root.position.clone().add(_w.set(0, 0.9, 0)), screen)) continue
            if (Math.hypot(screen.x - x, screen.y - y) <= 34) return mount
        }
        return null
    }

    /**
     * ZERO DAY splits as it is worn down, at three quarters, a half and a quarter
     * of its health: two decoys each time, and it trades places with one of them.
     * The tell: only the real one bleeds data — a steady drip of falling green
     * glyph-bits. Decoys are fragile and pay nothing.
     */
    private updateZeroDay(enemy: EnemyEntity, dt: number) {
        if (Math.random() < dt * 28) {
            const at = enemyWorld(enemy, randRange(0.3, 0.9) * enemy.rig.height * PER_WORLD, new THREE.Vector3())
            at.x += randRange(-0.6, 0.6)
            this.particles.emit(at, _w.set(randRange(-0.4, 0.4), -0.5, randRange(-0.4, 0.4)), 0x86efac,
                { size: 0.2, life: 0.9, gravity: 3, drag: 0.5, intensity: 2.2 })
        }
        const threshold = 1 - 0.25 * (enemy.splits + 1)
        if (enemy.splits >= 3 || enemy.hp / enemy.maxHp > threshold) return
        enemy.splits++
        const decoys = [this.spawnDecoy(enemy, -1), this.spawnDecoy(enemy, 1)]
        // Swap places with one copy, so the player has to find the tell again.
        const swap = decoys[randomChance(0.5) ? 0 : 1]!
        const u = enemy.u
        const d = enemy.d
        enemy.u = swap.u
        enemy.d = swap.d
        swap.u = u
        swap.d = d
        if (this.ridesNetwork(enemy)) {
            this.attachToNetwork(enemy)
            this.attachToNetwork(swap)
        }
        if (this.target === enemy) this.target = null
        const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.transient?.ring(at, enemy.def.hex, 10, 0.5)
        this.overlay.banner('ZERO DAY FORKED', enemy.def.hex, 'find the one that bleeds data')
        this.addShake(10)
    }

    private spawnDecoy(real: EnemyEntity, side: number): EnemyEntity {
        const rig = buildRig(real.def.id, real.def.hex, real.rig.height, { shrouded: true })
        this.fieldRoot.add(rig.root)
        const decoy: EnemyEntity = {
            ...real,
            rig,
            // Its own footprint memo: sharing the original's would let one overwrite the other's.
            foot: undefined,
            route: null,
            redShield: false,
            recovering: false,
            u: clamp(real.u + side * randomBetween(110, 170), -FIELD_HALF_WIDTH + 40, FIELD_HALF_WIDTH - 40),
            d: real.d + randomBetween(-50, 50),
            hp: real.maxHp * 0.05,
            maxHp: real.maxHp * 0.05,
            damage: real.damage * 0.5,
            bounty: 0,
            coinValue: 0,
            decoy: true,
            age: 0,
            pingDelay: -1,
            revealMs: 0,
            splits: 3
        }
        // A ground copy lands on whichever data line is nearest.
        if (this.ridesNetwork(decoy)) this.attachToNetwork(decoy)
        placeEnemy(decoy)
        this.enemies.push(decoy)
        return decoy
    }

    /**
     * Pushes overlapping enemies apart. Without it a wave stacks into a single
     * column at the wall and reads as one enemy taking sixty hits.
     */
    private separate() {
        for (let i = 0; i < this.enemies.length; i++) {
            const a = this.enemies[i] as EnemyEntity
            for (let j = i + 1; j < this.enemies.length; j++) {
                const b = this.enemies[j] as EnemyEntity
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
                                this.glitchClouds?.burst(enemyWorld(body, body.rig.height * PER_WORLD * 0.5, new THREE.Vector3()), body.rig.height * 0.7, body.def.hex)
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
        if (moves.some(([e, u, d], k) => this.ridesNetwork(e) && !this.nearLine(e, u, d, was[k]![0], was[k]![1]))) return false
        for (const [e, u, d] of moves) {
            e.u = u
            e.d = d
        }
        const ok = moves.every(([e], k) => !this.enemies.some((o) => {
            if (moves.some(([m]) => m === o) || !this.solidPair(e, o)) return false
            const now = sinkInto(e, e.u, e.d, o)
            return now > 0.5 && now > sinkInto(e, was[k]![0], was[k]![1], o) + 0.01
        }))
        if (!ok) moves.forEach(([e], k) => ([e.u, e.d] = was[k]!))
        return ok
    }

    /** The stretch of line a rider is on: whether it runs along `d` (down, or up on a detour) or across. */
    private legOf(enemy: EnemyEntity) {
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
    private sinksDeeper(enemy: EnemyEntity, u: number, d: number) {
        return this.enemies.some((o) => {
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
        const lean = Math.sign(at - them) || Math.sign(line - them) || (this.enemies.indexOf(enemy) % 2 ? 1 : -1)
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

    /** Whether any other body on the ground stands where this one is. */
    private crowdedAt(enemy: EnemyEntity) {
        return this.enemies.some(o => o !== enemy && !o.gateHold && o.hp > 0 && !hackerzIsAirborne(o.def)
            && sinkInto(enemy, enemy.u, enemy.d, o) > 1)
    }

    /**
     * Collision: bodies on the ground are solid. If this tick's move (a walk, a
     * ride, a shove) would carry `enemy` deeper into another body than it
     * stood before, the move is cut back to the furthest point short of that —
     * it stops at contact and waits, rather than walking through or being
     * shoved aside. Moving away from or along another body is always free.
     */
    private collide(enemy: EnemyEntity, fromU: number, fromD: number, fromSeg: number, fromYaw: number, dtMs: number) {
        if (hackerzIsAirborne(enemy.def) || enemy.burrowMs > 0) return
        const toU = enemy.u
        const toD = enemy.d
        if (toU === fromU && toD === fromD && enemy.yaw === fromYaw) return
        // One hacking or guarding a chip walks through everyone, and everyone through it.
        if (this.permeable(enemy)) return
        const rides = this.ridesNetwork(enemy)
        // Only bodies it could touch this tick: every spot tried below (the
        // move, a sidestep, a back-off) lies within twice the move of where
        // it started, and no footprint, however turned, reaches past x + z.
        const self = halfExtents(enemy.rig.box)
        const range = self.x + self.z + 2 * Math.hypot(toU - fromU, toD - fromD) + 1
        const others = this.enemies.filter((o) => {
            const half = halfExtents(o.rig.box)
            const near = range + half.x + half.z
            return Math.abs(o.u - fromU) <= near && Math.abs(o.d - fromD) <= near && this.solidPair(enemy, o)
        })
        // How deep it sank into any other body before this tick, at its old spot and heading.
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
        // broken, by this one backing off. A queue just waits its turn.
        if (enemy.blockedMs > JAM_MS && wall.blockedBy === enemy) {
            enemy.blockedMs = 0
            enemy.yieldMs = YIELD_MS
            enemy.yieldFrom = wall
        }
    }

    /**
     * A held unit beats on the honeypot or proxy wall in its way instead of the
     * fence. A sapper spends itself on it. True when the unit is gone.
     */
    private strikeDeployable(enemy: EnemyEntity, hold: Hold) {
        const damage = enemy.damage * this.chipBuff(enemy)
        const at = fieldToWorld(enemy.u, hold.target.d, 1.2, new THREE.Vector3())
        this.particles.burst(at, hold.target.hex, 5, 7, { size: 0.2, life: 0.3 })
        if (enemy.def.kind === 'bomber') {
            this.deployables?.strike(hold.target, damage * 2)
            this.transient?.ring(at, enemy.def.hex, 7, 0.4)
            this.particles.burst(at, enemy.def.hex, 26, 14, { size: 0.32, life: 0.6 })
            this.addShake(6)
            const index = this.enemies.indexOf(enemy)
            if (index >= 0) this.removeEnemy(index)
            return true
        }
        if (enemy.def.cloaked && !enemy.decloaked) enemy.decloaked = true
        // A spiderling sinks its fangs into a proxy wall and drains it like the fence.
        if (enemy.def.drain && hold.target.kind === 'proxy') {
            this.drainFence(enemy, damage, hold.target)
            return false
        }
        this.deployables?.strike(hold.target, damage)
        return false
    }

    /** What an enemy does when it reaches its stopping distance. */
    private enemyStrike(enemy: EnemyEntity) {
        const damage = enemy.damage * this.chipBuff(enemy)
        // The last healers of a wave go off on the fence like a weak Sapper.
        switch (enemy.kamikaze ? 'bomber' : enemy.def.kind) {
            case 'ranged': {
                const heavy = enemy.def.id === 'artillery'
                // The shot leaves from the muzzle itself (shared with the
                // database turntable), not from somewhere inside the body.
                placeEnemy(enemy)
                // Twin guns (a Gunship's) take turns down the volley.
                const muzzle = muzzleOf(enemy.rig, new THREE.Vector3(), enemy.burstLeft)
                const from = { u: muzzle.x / FIELD_SCALE, d: -muzzle.z / FIELD_SCALE, y: muzzle.y / FIELD_SCALE }
                const speed = heavy ? SPIT_SPEED * 1.5 : SPIT_SPEED
                const flightTime = Math.max(0.35, from.d / speed)
                const mesh = makeSpit(enemy.def.hex, heavy)
                this.fieldRoot.add(mesh)
                this.spits.push({
                    mesh,
                    u: from.u,
                    d: from.d,
                    y: from.y,
                    vd: -from.d / flightTime,
                    vy: (WALL_HIT_Y - from.y) / flightTime + 0.5 * SPIT_GRAVITY * flightTime,
                    damage,
                    hex: enemy.def.hex,
                    heavy
                })
                this.transient?.flash(muzzle, enemy.def.hex, heavy ? 0.9 : 0.5)
                enemy.recoil = 1
                break
            }
            case 'bomber': {
                this.bastion.damageWall(damage, enemy.u)
                // It goes up: the spikes are blown off the cage in every direction.
                placeEnemy(enemy)
                this.shrapnel?.burst(enemy.rig, enemy.def.hex)
                const at = enemyWorld(enemy, 10, _v)
                this.transient?.flash(at, enemy.def.hex, 2.6, 0.25)
                this.transient?.ring(at, enemy.def.hex, 9, 0.45)
                this.particles.burst(at, enemy.def.hex, 30, 16, { size: 0.35, life: 0.7 })
                this.addShake(14)
                this.callbacks.onNotice(`A ${enemy.def.name} reached the wall.`, 'bad')
                this.sysLog.sapperHit(Math.floor((enemy.u + FIELD_HALF_WIDTH) / 100) + 1, this.bastion.integrityPercent())
                const index = this.enemies.indexOf(enemy)
                if (index >= 0) this.removeEnemy(index)
                break
            }
            default: {
                // A spiderling latches on and drains instead of striking.
                if (enemy.def.drain) {
                    this.drainFence(enemy, damage)
                    break
                }
                // A cloaked unit has to drop its cloak to strike.
                if (enemy.def.cloaked && !enemy.decloaked) {
                    enemy.decloaked = true
                    this.particles.burst(enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, _v), enemy.def.hex, 14, 6, { size: 0.24, life: 0.4 })
                }
                this.bastion.damageWall(damage, enemy.u)
                this.particles.burst(fieldToWorld(enemy.u, 4, FENCE_HEIGHT * 0.5, _v), enemy.def.hex, 5, 8, { size: 0.2, life: 0.3 })
                // A unit with a melee weapon (the Warden's prod) jabs it home.
                enemy.strike = 1
                // A Phantom's strikes are a crystal ribbon: each keeps it fed until the next.
                if (CRYSTAL_RIBBON_IDS.includes(enemy.def.id)) enemy.ribbonMs = enemy.def.attackMs * 1.3
                // ZERO DAY's are its own body: it comes apart at the wall and regrows from its gem.
                if (BLOCK_STORM_IDS.includes(enemy.def.id)) this.blockStorm(enemy)
                // A leaking unit (the Daemon) heaves a leaked block onto the pile;
                // it only starts draining once it lands there.
                if (enemy.def.leak && enemy.heave <= 0 && enemy.rig.lifts.length) {
                    enemy.heave = 1
                    enemy.heaveDrain = damage * enemy.def.leak
                }
                break
            }
        }
    }

    /** A Phantom's ribbon: crystals out of its chest, round its crossing orbits, and off the front at the fence. */
    private feedRibbon(enemy: EnemyEntity, dt: number, dtMs: number) {
        enemy.ribbonMs = Math.max(0, enemy.ribbonMs - dtMs)
        const height = enemy.rig.height
        enemy.ribbon ??= new CrystalRibbon(this.fieldRoot, enemy.def.hex, height, at => {
            if (randomChance(0.35)) this.particles.burst(at, enemy.def.hex, 3, 5, { size: 0.16, life: 0.25 })
        })
        const chest = enemyWorld(enemy, height * PER_WORLD * 0.6, new THREE.Vector3())
        const target = fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.55, new THREE.Vector3())
        const forward = target.clone().sub(chest).normalize()
        enemy.ribbon.update(dt, enemy.ribbonMs > 0, chest, forward, target)
    }

    /** ZERO DAY's blow: its blocks burst off, sweep past its gem and pelt the fence; it regrows after. */
    private blockStorm(enemy: EnemyEntity) {
        placeEnemy(enemy)
        enemy.storm ??= new BlockStorm(enemy.rig, this.fieldRoot, enemy.def.hex, at => {
            this.particles.burst(at, enemy.def.hex, 4, 6, { size: 0.22, life: 0.3 })
        })
        enemy.storm.start(fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.5, new THREE.Vector3()))
    }

    /** The ram slamming home: sparks and grit off the plate, a shock along the fence, a jolt. */
    private ramImpact(enemy: EnemyEntity) {
        placeEnemy(enemy)
        const face = weaponTip(enemy.rig, new THREE.Vector3())
        if (!face) return
        this.particles.burst(face, 0xffd08a, 26, 9, { size: 0.24, life: 0.4, gravity: 12 })
        this.particles.burst(face, enemy.def.hex, 12, 5, { size: 0.32, life: 0.5 })
        this.transient?.ring(fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.3, _v), enemy.def.hex, 3.2, 0.35)
        this.addShake(7)
    }

    /** The prod's discharge: arcs from its tip into the fence, and a spit of sparks. */
    private prodZap(enemy: EnemyEntity) {
        placeEnemy(enemy)
        const tip = weaponTip(enemy.rig, new THREE.Vector3())
        if (!tip) return
        const fence = fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.45, new THREE.Vector3())
        this.transient?.bolt(tip, fence, PROD_HEX)
        this.transient?.bolt(tip, fence.clone().add(_w.set(randRange(-0.6, 0.6), randRange(-0.4, 0.4), 0)), PROD_HEX)
        this.particles.burst(tip, PROD_HEX, 10, 6, { size: 0.18, life: 0.25 })
    }

    // ─── ROOTKIT's brood ─────────────────────────────────────────────────────

    /**
     * A spiderling drains the fence (the ICE Barrier first): quietly, like a
     * leak, and harder every time. What it drains feeds it: it grows, its
     * health with it, and it heals by what it took.
     */
    private drainFence(enemy: EnemyEntity, damage: number, proxy: Hold['target'] | null = null) {
        const dealt = damage * enemy.drainPower
        // The fence (its ICE Barrier first), or the proxy wall standing in the way.
        if (proxy) this.deployables?.strike(proxy, dealt)
        else this.bastion.damageWall(dealt, enemy.u, true)
        const before = drainGrowth(enemy.drainPower)
        enemy.drainPower = Math.min(HACKERZ_SPIDER_MAX_DRAIN, enemy.drainPower * (1 + enemy.def.drain!))
        enemy.maxHp *= drainGrowth(enemy.drainPower) / before
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + dealt)
        // The bite: its fangs drive in, a red stain spills out round them, and
        // the draw pulses in from the stain's edge, up the fangs, into it.
        enemy.inject = 1
        placeEnemy(enemy)
        const tips = fangTips(enemy.rig)
        const bite = tips.length ? tips.reduce((sum, t) => sum.add(t), new THREE.Vector3()).divideScalar(tips.length) : enemyWorld(enemy, 6, new THREE.Vector3())
        const surfaceD = proxy ? proxy.d + 4 : 1
        const at = fieldToWorld(enemy.u, surfaceD, bite.y * PER_WORLD, new THREE.Vector3())
        enemy.wound ??= new DrainWound(this.fieldRoot, enemy.def.hex)
        // The surface faces the field: back toward the spiderling.
        enemy.wound.place(at, _w.set(0, 0, -1), enemy.rig.height * drainGrowth(enemy.drainPower) * 0.9)
        enemy.wound.draw(enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.45, new THREE.Vector3()))
    }

    /** Spiderlings on the field. */
    private spiderCount() {
        let n = 0
        for (const e of this.enemies) if (e.def.id === 'spiderling') n++
        return n
    }

    /** A spiderling hatches at (u, d), if the brood is not already at its cap. */
    private hatchSpider(u: number, d: number) {
        if (this.spiderCount() >= HACKERZ_SPIDER_CAP) return
        // A reinforcement: half bounty and no coins, so the brood is never a farm.
        this.spawn(hackerzEnemy('spiderling'), true, 1, { u, d })
    }

    /**
     * ROOTKIT, surfaced: it infects the hacked nodes it passes, and every few
     * seconds its forelegs rear up to inject a pair of spiderlings.
     */
    private rootkitBrood(enemy: EnemyEntity, dtMs: number) {
        if (!this.running || this.purging || enemy.decoy) return
        for (const chip of this.pathChips?.chips ?? []) {
            if (chip.state !== 'hacked' || this.infected.has(chip.id)) continue
            if (Math.hypot(chip.u - enemy.u, chip.d - enemy.d) > HACKERZ_SPIDER_INFECT_RADIUS) continue
            this.infected.set(chip.id, HACKERZ_SPIDER_HATCH_MS * 0.5)
            const at = fieldToWorld(chip.u, chip.d, 0.3, new THREE.Vector3())
            this.transient?.ring(at, enemy.def.hex, 4, 0.5)
            this.particles.burst(at, enemy.def.hex, 24, 7, { size: 0.24, life: 0.6 })
            this.sysLog.infected(chip.id)
        }
        enemy.broodMs -= dtMs
        if (enemy.broodMs > 0 || enemy.inject > 0) return
        enemy.broodMs = HACKERZ_SPIDER_INJECT_MS
        if (this.spiderCount() < HACKERZ_SPIDER_CAP) enemy.inject = 1
    }

    /** The forelegs drive home: a spiderling out of each needle. */
    private injectBrood(enemy: EnemyEntity) {
        for (const tip of fangTips(enemy.rig)) {
            this.particles.burst(tip, enemy.def.hex, 10, 5, { size: 0.2, life: 0.35 })
            this.hatchSpider(tip.x * PER_WORLD, -tip.z * PER_WORLD)
        }
    }

    /**
     * Infected nodes hatch a spiderling every tick, for as long as ROOTKIT
     * lives and the node stays theirs.
     */
    private hatchInfected(dtMs: number) {
        if (!this.infected.size) return
        if (!this.enemies.some(e => e.def.id === 'titan' && !e.decoy)) {
            this.infected.clear()
            return
        }
        const chips = this.pathChips?.chips ?? []
        for (const [id, ms] of this.infected) {
            const chip = chips.find(c => c.id === id)
            if (!chip || chip.state !== 'hacked') {
                this.infected.delete(id)
                continue
            }
            const at = fieldToWorld(chip.u, chip.d, 0.3, _v)
            // A sick pulse on the node, so the player can see what is breeding there.
            if (Math.random() < dtMs / 1000 * 4) this.particles.emit(at, _w.set(randRange(-0.4, 0.4), 1.2, randRange(-0.4, 0.4)), 0xfb7185, { size: 0.2, life: 0.5, gravity: 0 })
            let left = ms - dtMs
            if (left <= 0) {
                left += HACKERZ_SPIDER_HATCH_MS
                this.transient?.ring(at, 0xfb7185, 2.4, 0.35)
                this.hatchSpider(chip.u, chip.d - 30)
            }
            this.infected.set(id, left)
        }
    }

    // ─── Memory leaks ────────────────────────────────────────────────────────

    /**
     * Applies damage. There is no resistance term — a source that is not the type
     * an enemy is weak to deals full damage, and one that is deals a quarter more.
     * The number is coloured by the damage type and the bonus hit is drawn larger,
     * so the mechanic is legible from the field without a tooltip.
     */
    private damageEnemy(
        enemy: EnemyEntity,
        amount: number,
        damageType: HackerzDamageType,
        flash: boolean,
        showNumber: boolean,
        crit = false,
        /** False for damage over time (trap, held ground): it does not count as a hit on a shield. */
        shieldable = true
    ) {
        // Red ground's shield eats one whole hit and breaks, the sheen flaring
        // across the plating as it takes the impact.
        if (shieldable && enemy.redShield && amount > 0) {
            this.territory.setRedShield(enemy, false)
            enemy.rig.body.uniforms.uShieldHit!.value = 1
            const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
            this.particles.burst(at, 0xff3b3b, 14, 7, { size: 0.24, life: 0.35 })
            if (showNumber) this.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'BLOCKED', 0xff6b6b, 0.95)
            if (flash) enemy.flashMs = MOTION.hitFlashMs
            return
        }
        const bonus = hackerzTypeMultiplier(damageType, enemy.armored)
        const dealt = amount * bonus
        // A carried shield (the Warden's) takes the hit until it breaks; the
        // bubble flashes round the unit from the shield back.
        const blocked = Math.min(enemy.guard, dealt)
        if (blocked > 0) {
            enemy.guard -= blocked
            if (shieldable) (enemy.hexShield ??= new HexShield(enemy.rig)).pulse()
            if (enemy.guard <= 0) this.breakGuard(enemy)
        }
        enemy.hp -= dealt - blocked
        if (flash) enemy.flashMs = MOTION.hitFlashMs
        if (showNumber) {
            const effective = bonus > 1
            this.overlay.floatText(
                enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v),
                crit ? `${Math.round(dealt)}!` : effective ? `${Math.round(dealt)}+` : `${Math.round(dealt)}`,
                crit ? 0xfde047 : HACKERZ_TYPE_HEX[damageType],
                crit ? 1.5 : effective ? 1.2 : 0.95
            )
        }
    }

    /** The shield gives: it shatters off the unit, and hits land on the unit from now on. */
    private breakGuard(enemy: EnemyEntity) {
        enemy.guard = 0
        placeEnemy(enemy)
        this.shrapnel?.burst(enemy.rig, 0xffffff, enemy.rig.guardParts)
        for (const part of enemy.rig.guardParts) part.visible = false
        const at = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.particles.burst(at, 0xffffff, 18, 9, { size: 0.24, life: 0.45 })
        this.transient?.ring(at, 0xffffff, 3, 0.35)
        this.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'SHIELD DOWN', 0xffffff, 1.1)
    }

    /** Removes an enemy and pays out. `payout` scales it (the purge pays less). */
    private killEnemy(index: number, payout: number) {
        const enemy = this.enemies[index]
        if (!enemy) return
        // A kill the player earned extends the chain; the purge's sweep does not.
        if (payout >= 1) this.scoring.extendChain()
        const credits = Math.round(enemy.bounty * payout * (payout >= 1 ? this.scoring.chainMultiplier : 1))
        const coins = Math.round(enemy.coinValue * payout)

        const centre = enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.45, new THREE.Vector3())
        // A ZERO DAY copy dies as what it is: a fake, with none of the boss's fanfare.
        const bossDeath = !!enemy.def.boss && !enemy.decoy
        // The purge writes its own summary; only kills the player made get a line.
        if (payout >= 1 && !enemy.decoy) this.sysLog.kill(enemy.def.id, enemy.def.name, bossDeath, !!enemy.def.cloaked)
        if (enemy.decoy) this.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'DECOY', 0x94a3b8, 1.2)
        this.particles.burst(centre, enemy.def.hex, bossDeath ? 120 : 22, bossDeath ? 22 : 11,
            { size: bossDeath ? 0.5 : 0.3, life: 0.8, gravity: 18 })
        // The discharge: bolts arc from the body into the floor, and the charge
        // runs out along the circuit traces from where it grounded.
        const ground = fieldToWorld(enemy.u, enemy.d, 0.05, new THREE.Vector3())
        const bolts = bossDeath ? 9 : 4
        for (let b = 0; b < bolts; b++) {
            const reach = enemy.rig.height * (bossDeath ? 0.8 : 0.9) + 0.6
            this.transient?.bolt(centre, _v.set(ground.x + randRange(-reach, reach), 0.05, ground.z + randRange(-reach, reach)).clone(), enemy.def.hex)
        }
        this.view?.addSurge(ground.x, ground.z, enemy.def.hex, bossDeath ? 2.4 : payout < 1 ? 0.6 : 1)
        this.transient?.ring(fieldToWorld(enemy.u, enemy.d, 0.1, _v), enemy.def.hex, bossDeath ? 14 : 2.4, 0.4)
        if (credits > 0) {
            this.overlay.floatText(enemyWorld(enemy, enemy.rig.height * PER_WORLD + 34, _v), `+${credits}`, LIME, 1.1)
        }
        if (coins > 0) this.scoring.dropCoins(enemy, coins)
        if (bossDeath) {
            this.transient?.ring(centre, RED, 30, 0.8)
            this.view?.flash(0xffffff, 0.35)
            this.addShake(18)
            this.callbacks.onNotice(`${enemy.def.name} purged.`, 'good')
        }

        this.removeEnemy(index, true)
        this.callbacks.onSound?.(bossDeath ? 'boss-death' : 'enemy-death')
        this.scoring.waveKills++
        this.scoring.totalKills++
        if (credits > 0) {
            this.scoring.waveCredits += credits
            this.callbacks.onCredits(credits, payout < 1 ? 'purge' : 'kill')
        }
    }

    /**
     * Takes an enemy off the field. A killed one leaves its body behind for a
     * beat, shorting out (see `updateDying`); anything else just goes.
     */
    private removeEnemy(index: number, shortOut = false) {
        const enemy = this.enemies[index]
        if (!enemy) return
        if (this.target === enemy) this.target = null
        for (const mount of this.turrets) {
            if (mount.target === enemy) mount.target = null
        }
        for (const other of this.enemies) {
            if (other.healing === enemy) other.healing = null
        }
        this.terminals?.close(enemy)
        // A block still in its hands goes down with it.
        enemy.carry?.dispose()
        enemy.carry = null
        enemy.hexShield?.dispose()
        enemy.hexShield = null
        enemy.ribbon?.dispose()
        enemy.ribbon = null
        // Whole again for its death, whatever state it was in.
        enemy.storm?.dispose()
        enemy.storm = null
        enemy.wound?.dispose()
        enemy.wound = null
        if (shortOut) this.dying.push({ rig: enemy.rig, age: 0, life: enemy.def.boss ? 0.9 : 0.4, hex: enemy.def.hex })
        else disposeRig(enemy.rig)
        this.enemies.splice(index, 1)
    }

    /**
     * A dead unit flares white-hot and is pulled down into the grid. Driven by
     * its age alone, so a paused game holds it still; no strobing — a fast
     * flash is a photosensitivity hazard, not an effect.
     */
    private updateDying(dt: number) {
        for (let i = this.dying.length - 1; i >= 0; i--) {
            const corpse = this.dying[i]!
            corpse.age += dt
            const t = corpse.age / corpse.life
            if (t >= 1) {
                disposeRig(corpse.rig)
                this.dying.splice(i, 1)
                continue
            }
            corpse.rig.body.uniforms.uFlash!.value = 1.1 * (1 - t)
            corpse.rig.root.scale.set(1, Math.max(0.02, 1 - t * t), 1)
            if (dt > 0 && Math.random() < dt * 25) {
                this.particles.emit(
                    corpse.rig.root.position.clone().add(_w.set(randRange(-0.6, 0.6), corpse.rig.height * (1 - t) * Math.random(), randRange(-0.6, 0.6))),
                    _v.set(randRange(-3, 3), randRange(1, 5), randRange(-3, 3)), corpse.hex, { size: 0.22, life: 0.25, gravity: 4 }
                )
            }
        }
    }

    // ─── Player weapon ───────────────────────────────────────────────────────

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

    private updateRail(dt: number) {
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

    private updateWeapon(dtMs: number) {
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
                const nodes = 1 + 0.1 * (this.pathChips?.owned ?? 0)
                this.fireTimer = weapon.fireIntervalMs / (this.overclockLeft > 0 ? this.overclockRate : 1) / nodes
            } else {
                this.beginReload()
            }
        }
    }

    private get overclockRate() {
        return this.loadout?.overclockMultiplier ?? 1
    }

    private beginReload() {
        if (!this.weapon || this.reloadTimer > 0 || this.mag >= this.magSize) return
        if (!this.running || this.purging) return
        this.reloadTimer = this.weapon.reloadMs
        this.emitAmmo()
        this.callbacks.onSound?.('weapon-reload')
    }

    private shoot() {
        const weapon = this.weapon
        const loadout = this.loadout
        if (!weapon || !loadout) return
        this.mag--
        this.emitAmmo()
        if (weapon.id === 'rail') this.callbacks.onSound?.('shoot-rail')
        else if (weapon.id === 'flak') this.callbacks.onSound?.('shoot-flak')
        else if (weapon.id === 'arc') this.callbacks.onSound?.('shoot-arc')
        else if (weapon.id === 'missile') this.callbacks.onSound?.('shoot-missile')
        else if (weapon.id === 'sniper') this.callbacks.onSound?.('shoot-sniper')

        let aim = this.railAim()
        // Aimed down at a pile of leaked memory by the fence, the round goes for
        // the top of it, and is spent freeing a block.
        const leak = this.target ? null : this.memory.leakPileAt(aim.u, aim.d)
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
        const overclocked = this.overclockLeft > 0
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
            this.spawnBullet(from, MUZZLE_D, MUZZLE_Y, angle + spread, spec, aim.y, this.target)
            if (leak) this.bullets[this.bullets.length - 1]!.leakU = leak.u
        }

        const muzzle = fieldToWorld(from + Math.sin(angle) * 36, MUZZLE_D + Math.cos(angle) * 36, MUZZLE_Y * FIELD_SCALE, _v)
        this.transient?.flash(muzzle, spec.hex, weapon.projectile === 'slug' ? 0.9 : 0.55)
        this.railKick = railKickFor(weapon.projectile)
        this.addShake(weapon.projectile === 'slug' ? 5 : crit ? 3 : 1.6)
    }

    /**
     * A round on the ground plane: `angle` is measured from straight out (+d)
     * toward +u. Its rendered height eases from the muzzle to `toY` over the
     * ground distance to the aim point, so a locked shot visibly meets the body.
     */
    private spawnBullet(u: number, d: number, fromY: number, angle: number, spec: ShotSpec, toY: number, aimAt: EnemyEntity | null) {
        const mesh = makeProjectile(spec.projectile, spec.hex, spec.crit, spec.fromTurret)
        this.fieldRoot.add(mesh)
        const span = aimAt ? Math.max(40, Math.hypot(aimAt.u - u, aimAt.d - d)) : Math.max(40, Math.hypot(this.aimU - u, this.aimD - d))
        const bullet: BulletEntity = {
            mesh,
            u,
            d,
            y: fromY,
            prevU: u,
            prevD: d,
            vu: Math.sin(angle) * spec.speed,
            vd: Math.cos(angle) * spec.speed,
            damage: spec.damage,
            pierce: spec.pierce,
            hit: new Set(),
            // Missiles are slow and steer, so they need a far longer leash.
            lifeMs: BULLET_LIFE_MS * (spec.homing ? 3.5 : 1),
            crit: spec.crit,
            fromTurret: spec.fromTurret,
            damageType: spec.damageType,
            splashRadius: spec.splashRadius,
            splashDamage: spec.splashDamage,
            homing: spec.homing,
            target: spec.homing ? (aimAt ?? this.pickHomingTarget(u, d)) : null,
            chain: spec.chain,
            chainFalloff: spec.chainFalloff,
            hex: spec.hex,
            projectile: spec.projectile,
            fromY,
            toY,
            span,
            flown: 0
        }
        if (this.bonus === 'packetloss' && randomChance(PACKET_LOSS)) {
            bullet.lostAt = randomBetween(0.25, 0.85) * span
        }
        this.orientBullet(bullet)
        this.bullets.push(bullet)
    }

    orientBullet(bullet: BulletEntity) {
        const p = fieldToWorld(bullet.u, bullet.d, bullet.y * FIELD_SCALE, bullet.mesh.position)
        _w.set(p.x + bullet.vu * FIELD_SCALE, p.y, p.z - bullet.vd * FIELD_SCALE)
        bullet.mesh.lookAt(_w)
    }

    /** Missiles lock the enemy closest to the wall — the one that matters. */
    private pickHomingTarget(u: number, d: number) {
        let best: EnemyEntity | null = null
        let bestScore = -Infinity
        for (const enemy of this.enemies) {
            if (this.untargetable(enemy)) continue
            const score = -enemy.d - Math.hypot(enemy.u - u, enemy.d - d) * 0.25
            if (score > bestScore) {
                bestScore = score
                best = enemy
            }
        }
        return best
    }

    private updateBullets(dt: number) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i] as BulletEntity

            // Punching through a body, a railgun round hangs there a beat before it carries on.
            if (bullet.holdMs) {
                bullet.holdMs = Math.max(0, bullet.holdMs - dt * 1000)
                continue
            }

            if (bullet.homing) this.steerMissile(bullet, dt)

            bullet.prevU = bullet.u
            bullet.prevD = bullet.d
            bullet.u += bullet.vu * dt
            bullet.d += bullet.vd * dt
            bullet.flown += Math.hypot(bullet.vu, bullet.vd) * dt
            const toY = bullet.homing && bullet.target ? enemyCentreY(bullet.target) : bullet.toY
            bullet.y = bullet.fromY + (toY - bullet.fromY) * Math.min(1, bullet.flown / bullet.span)
            bullet.lifeMs -= dt * 1000
            // Mid lag spike the round flies on, but its picture holds.
            if (this.lag.boardLagMs <= 0) this.orientBullet(bullet)

            if (bullet.lostAt !== undefined && bullet.flown >= bullet.lostAt) {
                const at = fieldToWorld(bullet.u, bullet.d, bullet.y * FIELD_SCALE, new THREE.Vector3())
                this.particles.burst(at, 0xe879f9, 10, 5, { size: 0.24, life: 0.4, gravity: 0 })
                this.overlay.floatText(at, 'LOST', 0xe879f9, 0.8)
                bullet.mesh.removeFromParent()
                this.bullets.splice(i, 1)
                continue
            }

            // Through a wall of black ice: the round drags on, slowed for good.
            if (!bullet.iced && this.iceWalls.length && this.throughIce(bullet.prevU, bullet.prevD, bullet.u, bullet.d)) {
                bullet.iced = true
                bullet.vu *= BLACK_ICE_SLOW
                bullet.vd *= BLACK_ICE_SLOW
                bullet.lifeMs /= BLACK_ICE_SLOW
                this.particles.burst(bullet.mesh.position, 0xa5b4fc, 6, 4, { size: 0.2, life: 0.3 })
            }

            // A round fired at leaked memory goes in low at the foot of the
            // fence, under the Daemons standing over it: it hits nothing on the
            // way, and is spent on the pile.
            if (bullet.leakU !== undefined) {
                if (bullet.d < LEAK_D) continue
                this.memory.shootLeak(bullet.leakU)
                bullet.mesh.removeFromParent()
                this.bullets.splice(i, 1)
                continue
            }

            let consumed = false
            for (let e = this.enemies.length - 1; e >= 0; e--) {
                const enemy = this.enemies[e]
                if (!enemy || bullet.hit.has(enemy)) continue
                if (!this.roundHits(bullet, enemy)) continue

                bullet.hit.add(enemy)
                // Caught by a bodyguard, the round spares the hacker behind it:
                // no splash and no arc jump reaches its charge.
                if (enemy.escorting) bullet.hit.add(enemy.escorting)
                this.damageEnemy(enemy, bullet.damage, bullet.damageType, true, true, bullet.crit)
                // A round fired blind lights up what it hits, for a moment.
                if (this.inTheDark(enemy)) enemy.litMs = HIT_LIGHT_MS
                this.callbacks.onSound?.('hit-enemy')
                const at = enemyWorld(enemy, enemyCentreY(enemy) - enemy.altitude, new THREE.Vector3())
                this.particles.burst(at, enemy.def.hex, bullet.crit ? 8 : 4, 9, { size: 0.22, life: 0.3 })
                if (bullet.projectile === 'slug' || bullet.pierce > 0) {
                    this.transient?.beam(fieldToWorld(bullet.prevU, bullet.prevD, bullet.y * FIELD_SCALE, new THREE.Vector3()), at, bullet.hex)
                }
                // A railgun round (the Longbore's, or a Rail Lance's) punching
                // through: it hangs in the body a beat, a shock ring bursts out
                // sideways, a gout of flame roars up out of it — the Longbore's
                // purple, a turret its own colour — and the body is driven back.
                if (bullet.projectile === 'slug') {
                    const flame = bullet.fromTurret ? bullet.hex : LONGBORE_FLARE
                    bullet.holdMs = PUNCH_HOLD_MS
                    this.transient?.flash(at, 0xffffff, 0.7, 0.1, 1.6)
                    this.transient?.shockRing(at, flame, Math.max(1.6, enemy.rig.height * 1.1), _w.set(bullet.vu, 0, -bullet.vd).normalize())
                    this.transient?.flame(at, flame, Math.max(6, enemy.rig.height * 3))
                    // The plated and the bosses only stagger; the light are hurled.
                    enemy.pushVd += PUNCH_PUSH * (enemy.def.boss ? 0.2 : enemy.armored ? 0.35 : 1)
                }

                if (bullet.splashRadius > 0) this.detonate(bullet, enemy)
                if (bullet.chain > 0) this.chainFrom(bullet, enemy)

                if (enemy.hp <= 0) {
                    const index = this.enemies.indexOf(enemy)
                    if (index >= 0) this.killEnemy(index, 1)
                } else if (!enemy.def.boss) {
                    // A little shove on hit — the feedback that sells the shot
                    // even when the target survives it.
                    enemy.pushVd += bullet.fromTurret ? 12 : 30
                }

                // A warhead is spent on the first thing it touches, whatever its
                // pierce says; the splash is the multi-target part. A bodyguard
                // throws itself on the round: it goes no further either.
                if (bullet.pierce > 0 && bullet.splashRadius === 0 && !enemy.escorting) {
                    bullet.pierce--
                } else {
                    consumed = true
                    break
                }
            }

            if (!consumed && !bullet.fromTurret && this.roundThroughChips(bullet)) consumed = true

            const offField = Math.abs(bullet.u) > WALL_HALF_LENGTH + 200 || bullet.d > DESPAWN_DEPTH + 100 || bullet.d < MUZZLE_D - 60
            if (consumed || bullet.lifeMs <= 0 || offField) {
                bullet.mesh.removeFromParent()
                this.bullets.splice(i, 1)
            }
        }
    }

    /** Missiles turn at a fixed rate, so a bad lock is still a miss. */
    private steerMissile(bullet: BulletEntity, dt: number) {
        const target = bullet.target
        if (!target || target.hp <= 0 || !this.enemies.includes(target)) {
            bullet.target = this.pickHomingTarget(bullet.u, bullet.d)
            return
        }
        const speed = Math.hypot(bullet.vu, bullet.vd) || 1
        const desired = Math.atan2(target.u - bullet.u, target.d - bullet.d)
        const current = Math.atan2(bullet.vu, bullet.vd)
        const angle = turnToward(current, desired, 4.5 * dt)
        bullet.vu = Math.sin(angle) * speed
        bullet.vd = Math.cos(angle) * speed
        if (randomChance(dt * 30)) {
            this.particles.emit(bullet.mesh.position, _w.set(0, 0.5, 0), bullet.hex, { size: 0.25, life: 0.3, gravity: 0 })
        }
    }

    /**
     * Splash from a warhead. The direct target has already been hit. The blast
     * ripples out through the grid lines in the round's colour, exactly as far
     * as the splash reaches, and every hostile it catches shows the hit.
     */
    private detonate(bullet: BulletEntity, epicentre: EnemyEntity) {
        // It goes off on the unit it struck, not wherever the round happened to
        // be when it connected — a big target's far side would carry the blast
        // past its neighbours.
        const u = epicentre.u
        const d = epicentre.d
        const at = fieldToWorld(u, d, bullet.y * FIELD_SCALE, new THREE.Vector3())
        const ground = fieldToWorld(u, d, 0.1, new THREE.Vector3())
        // Kept dim: any brighter and the bloom washes the orange out to white.
        this.view?.addSurge(ground.x, ground.z, bullet.hex, 0.45, bullet.splashRadius * FIELD_SCALE)
        // The blast itself: a cloud of corrupted data scrambling the whole splash area.
        this.glitchClouds?.burst(fieldToWorld(u, d, 0, new THREE.Vector3()), bullet.splashRadius * FIELD_SCALE, bullet.hex)
        this.transient?.ring(ground, bullet.hex, bullet.splashRadius * FIELD_SCALE * 1.4, 0.38)
        this.particles.burst(at, bullet.hex, 14, 12, { size: 0.3, life: 0.45 })
        this.addShake(3)
        epicentre.glitchMs = GLITCH_MS
        // Hackers shrug splash off alone, but a crew working one node together
        // is hit as one: catch any of them, and the whole crew takes it.
        // The blast reaches a body if it reaches any of it, not just its middle:
        // two Bulwarks shoulder to shoulder stand further apart, centre to
        // centre, than a warhead's splash.
        const reached = (enemy: EnemyEntity) => enemy === epicentre || reachOf(enemy, u, d) <= bullet.splashRadius
        const crewNodes = new Set<PathChip>()
        for (const enemy of this.enemies) {
            if (enemy.def.id === HACKERZ_HACKER_ID && enemy.hacking && enemy.targetChip && reached(enemy)) crewNodes.add(enemy.targetChip)
        }
        const crew = new Set<EnemyEntity>()
        for (const chip of crewNodes) {
            const working = this.enemies.filter(e => e.def.id === HACKERZ_HACKER_ID && e.hacking && e.targetChip === chip && !this.untouchable(e))
            if (working.length >= 2) for (const hacker of working) crew.add(hacker)
        }
        for (let e = this.enemies.length - 1; e >= 0; e--) {
            const enemy = this.enemies[e] as EnemyEntity
            if (enemy === epicentre || bullet.hit.has(enemy) || this.untouchable(enemy)) continue
            if (crew.has(enemy)) {
                // A hacking crew: every member takes it, wherever on the node it works.
            } else if (enemy.def.id === HACKERZ_HACKER_ID || !reached(enemy)) {
                // A lone hacker shrugs splash off: picking one off takes a direct hit.
                continue
            }
            this.damageEnemy(enemy, bullet.splashDamage, bullet.damageType, true, true, false)
            enemy.glitchMs = GLITCH_MS
            this.particles.burst(enemyWorld(enemy, enemyCentreY(enemy) - enemy.altitude, _w), bullet.hex, 6, 7, { size: 0.22, life: 0.3 })
            if (enemy.hp <= 0) this.killEnemy(e, 1)
        }
    }

    /** Arc rounds jump to nearby enemies for a shrinking share of the damage. */
    private chainFrom(bullet: BulletEntity, source: EnemyEntity) {
        let from = source
        let damage = bullet.damage * bullet.chainFalloff

        for (let jump = 0; jump < bullet.chain; jump++) {
            let best: EnemyEntity | null = null
            let bestDist = 260
            for (const enemy of this.enemies) {
                // Hackers are grounded against arcs: only a direct hit lands on one.
                if (bullet.hit.has(enemy) || this.untargetable(enemy) || enemy.def.id === HACKERZ_HACKER_ID) continue
                const d = Math.hypot(enemy.u - from.u, enemy.d - from.d)
                if (d < bestDist) {
                    bestDist = d
                    best = enemy
                }
            }
            if (!best) return
            // Electricity jumping body to body: a crackling bolt you can see,
            // and a spray of sparks where it lands.
            const start = enemyWorld(from, enemyCentreY(from) - from.altitude, new THREE.Vector3())
            const end = enemyWorld(best, enemyCentreY(best) - best.altitude, new THREE.Vector3())
            this.transient?.arc(start, end, bullet.hex)
            this.particles.burst(end, bullet.hex, 10, 9, { size: 0.22, life: 0.3 })
            this.particles.burst(end, 0xffffff, 4, 6, { size: 0.16, life: 0.2 })
            bullet.hit.add(best)
            this.damageEnemy(best, damage, bullet.damageType, true, true, false)
            if (best.hp <= 0) {
                const index = this.enemies.indexOf(best)
                if (index >= 0) this.killEnemy(index, 1)
            }
            from = best
            damage *= bullet.chainFalloff
        }
    }

    // ─── Turrets ─────────────────────────────────────────────────────────────

    /** `frozen`: a packet-loss spike — the turrets still fire, but are not seen to move. */
    private updateTurrets(dtMs: number, frozen = false) {
        const overclocked = this.overclockLeft > 0
        const dt = frozen ? 0 : dtMs / 1000
        for (const mount of this.turrets) {
            if (mount.frozenMs > 0) {
                mount.frozenMs -= dtMs
                if (mount.frozenMs <= 0) this.thaw(mount)
                continue
            }
            const target = this.turretTarget(mount, dtMs)
            // Turrets aim at what they can see — during a packet-loss spike,
            // the stale picture rather than where the unit really is.
            const seen = target ? this.lag.seenAt(target) : null
            if (target && seen) {
                const desired = Math.atan2((seen.u - mount.u) * FIELD_SCALE, -seen.d * FIELD_SCALE - mount.z)
                mount.heading = turnToward(mount.heading, desired, dt * MOTION.turretTurn)
            }
            if (mount.rig.yaw) mount.rig.yaw.rotation.y = mount.heading
            spinTurret(mount.rig, dt)

            if (!frozen) mount.kick = easeTurretKick(mount.rig, mount.kick, dtMs)

            if (!this.running || this.purging) continue
            mount.cooldown -= dtMs * (overclocked ? this.overclockRate : 1)
            if (!target || !seen || mount.cooldown > 0) continue
            mount.cooldown = mount.runtime.intervalMs

            const isMissile = mount.runtime.splashRadius > 0
            const angle = Math.atan2(seen.u - mount.u, seen.d - mount.muzzleD)
            this.spawnBullet(mount.u, mount.muzzleD, MUZZLE_Y * 0.92 + mount.muzzleLift, angle, {
                damage: mount.runtime.damage,
                pierce: mount.runtime.pierce,
                damageType: mount.runtime.damageType,
                splashRadius: mount.runtime.splashRadius,
                splashDamage: mount.runtime.splashDamage,
                // A missile can only home on a signal it has; mid-spike it flies blind.
                homing: isMissile && this.lag.boardLagMs <= 0,
                chain: 0,
                chainFalloff: 0,
                speed: isMissile ? 780 : 1700,
                hex: mount.runtime.hex,
                projectile: turretProjectile(mount.runtime),
                crit: false,
                fromTurret: true
            }, enemyCentreY(target), target)
            const muzzle = fieldToWorld(mount.u + Math.sin(angle) * 30, mount.muzzleD + Math.cos(angle) * 30, (MUZZLE_Y * 0.92 + mount.muzzleLift) * FIELD_SCALE, _v)
            this.transient?.flash(muzzle, mount.runtime.hex, 0.35)
            mount.kick = MOTION.turretKick
            if (mount.runtime.id === 'gun') this.callbacks.onSound?.('turret-gun')
            else if (mount.runtime.id === 'needler') this.callbacks.onSound?.('turret-needler')
            else if (mount.runtime.id === 'warhead') this.callbacks.onSound?.('turret-warhead')
            else if (mount.runtime.id === 'lance') this.callbacks.onSound?.('turret-lance')
        }
    }

    /**
     * What a turret shoots, in order of preference:
     *
     * 1. Anything but a hacker: the hackers are the rail's job, and a battery
     *    that ignores them while there is armour about gives them a chance.
     * 2. Its own lane — the strip of field in front of its mount — then the
     *    lanes beside it, then anything in range, so a battery spreads its fire
     *    instead of every barrel chasing one unit.
     * 3. The tankiest: the most health it started with.
     * 4. Whatever is closest to the fence.
     *
     * Range is measured straight out from the wall, which is what the balance
     * sim assumes.
     */
    private pickTurretTarget(mount: TurretMount) {
        let best: EnemyEntity | null = null
        let bestHacker = 0
        let bestTier = 0
        for (const enemy of this.enemies) {
            if (enemy.d > mount.runtime.range || this.untargetable(enemy)) continue
            const hacker = enemy.def.id === HACKERZ_HACKER_ID ? 1 : 0
            const off = Math.abs(enemy.u - mount.u)
            const tier = off <= TURRET_LANE ? 0 : off <= TURRET_LANE * 3 ? 1 : 2
            if (best && (hacker > bestHacker || (hacker === bestHacker && (tier > bestTier
                || (tier === bestTier && (enemy.maxHp < best.maxHp
                    || (enemy.maxHp === best.maxHp && enemy.d >= best.d))))))) continue
            best = enemy
            bestHacker = hacker
            bestTier = tier
        }
        return best
    }

    /**
     * A turret keeps shooting what it picked until that drops out of range or
     * out of sight, and only now and then looks again for something better —
     * the full search above runs a few times a second, not every frame.
     */
    private turretTarget(mount: TurretMount, dtMs: number) {
        mount.retargetMs -= dtMs
        const kept = mount.target
        if (kept && mount.retargetMs > 0 && kept.d <= mount.runtime.range && !this.untargetable(kept)) return kept
        mount.target = this.pickTurretTarget(mount)
        mount.retargetMs = TURRET_RETARGET_MS
        return mount.target
    }

    // ─── Enemy projectiles ───────────────────────────────────────────────────

    private updateSpits(dt: number) {
        for (let i = this.spits.length - 1; i >= 0; i--) {
            const spit = this.spits[i] as SpitEntity
            spit.vy -= SPIT_GRAVITY * dt
            spit.d += spit.vd * dt
            spit.y += spit.vy * dt
            if (this.lag.boardLagMs <= 0) {
                fieldToWorld(spit.u, spit.d, spit.y * FIELD_SCALE, spit.mesh.position)
                spit.mesh.rotation.y += dt * 8
            }

            const landed = spit.d <= 0
            if (!landed && spit.y > -20) continue
            if (landed) {
                this.bastion.damageWall(spit.damage, spit.u)
                const at = fieldToWorld(spit.u, 0, WALL_HIT_Y * FIELD_SCALE, _v)
                this.particles.burst(at, spit.hex, spit.heavy ? 18 : 8, 10, { size: 0.28, life: 0.4 })
                if (spit.heavy) {
                    this.transient?.ring(at, spit.hex, 4, 0.4)
                    this.addShake(8)
                }
            }
            spit.mesh.removeFromParent()
            this.spits.splice(i, 1)
        }
    }

    // ─── Abilities ───────────────────────────────────────────────────────────

    /**
     * Whether a unit is out of reach: a cloaked one nobody has pinged, or a
     * ROOTKIT underground. Nothing targets, hits or splashes an untouchable unit.
     */
    private untouchable(enemy: EnemyEntity) {
        // A White Hat's convert is on our side now: nothing of ours shoots it.
        if (enemy.turned) return true
        // Still waiting inside the portal: not on the board yet.
        if (enemy.gateHold) return true
        if (enemy.burrowMs > 0) return true
        return !!enemy.def.cloaked && !enemy.decloaked && enemy.revealMs <= 0
    }

    /**
     * Whether a unit stands unseen in the dark: out past the light in a
     * BLACKOUT, or inside a dark zone, with no ping on it. Rounds fired blind
     * still hit it, but nothing can lock on.
     */
    private inTheDark(enemy: EnemyEntity) {
        if (enemy.revealMs > 0) return false
        if (this.bonus === 'blackout' && this.running && enemy.d > BLACKOUT_LIGHT_D) return true
        return this.territory.inDarkZone(enemy.u, enemy.d)
    }

    /** Whether nothing can pick a unit out to aim at: untouchable, or unseen in the dark. */
    untargetable(enemy: EnemyEntity) {
        return this.untouchable(enemy) || this.inTheDark(enemy)
    }

    /**
     * Right click: a radar ring sweeps out from the rail and lights every contact
     * as the wavefront reaches it; the highlight fades as the wave moves on.
     * `free`: a Portscan's own sweep, which neither needs nor spends the radar's charge.
     */
    private firePing(free = false) {
        if (!this.running || this.purging || this.paused || (!free && this.pingCharge < PING_COOLDOWN_MS)) return
        if (!free) {
            this.pingCharge = 0
            this.emitPing()
        }
        const reach = (FIELD_DEPTH + 300) * FIELD_SCALE
        this.transient?.ring(fieldToWorld(RAIL_U, MUZZLE_D, 0.15, _v), LIME, reach, reach / (PING_SPEED * FIELD_SCALE), 1.6)
        for (const enemy of this.enemies) {
            enemy.pingDelay = Math.hypot(enemy.u - RAIL_U, enemy.d - MUZZLE_D) / PING_SPEED * 1000
        }
        this.sysLog.ping(this.enemies.length)
        this.callbacks.onSound?.('weapon-swap')
    }

    private emitPing() {
        this.callbacks.onPing?.(this.pingCharge, PING_COOLDOWN_MS)
    }

    private updateAbilities(dtMs: number) {
        const loadout = this.loadout
        if (!loadout) return
        this.updatePortscan(dtMs)

        if (this.pingCharge < PING_COOLDOWN_MS) {
            // In a BLACKOUT the radar is the only light, so it recharges twice as fast.
            this.pingCharge = Math.min(PING_COOLDOWN_MS, this.pingCharge + dtMs * (this.bonus === 'blackout' ? 2 : 1))
            this.emitPing()
        }

        if (loadout.pulseUnlocked) {
            this.pulseCharge = Math.min(loadout.pulseCooldownMs, this.pulseCharge + dtMs)
            this.emitPulse()
        }
        if (loadout.overclockUnlocked) {
            if (this.overclockLeft > 0) {
                this.overclockLeft = Math.max(0, this.overclockLeft - dtMs)
            } else {
                this.overclockCharge = Math.min(loadout.overclockCooldownMs, this.overclockCharge + dtMs)
            }
            this.emitOverclock()
        }
    }

    private firePulse() {
        const loadout = this.loadout
        if (!loadout?.pulseUnlocked || !this.running || this.purging || this.paused) return
        if (this.pulseCharge < loadout.pulseCooldownMs) return
        this.pulseCharge = 0
        this.emitPulse()
        this.callbacks.onSound?.('ability-pulse')

        this.transient?.ring(fieldToWorld(0, 0, 0.2, _v), CYAN, PULSE_RADIUS * FIELD_SCALE, 0.7, 3)
        this.view?.flash(0x22d3ee, 0.4)
        this.addShake(16)

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i] as EnemyEntity
            const falloff = clamp(1 - enemy.d / PULSE_RADIUS, 0.25, 1)
            // The pulse is kinetic: it is the panic button, and the thing you
            // panic about is a plated wave already inside the trap band.
            this.damageEnemy(enemy, loadout.pulseDamage * falloff, 'kinetic', true, true, false)
            enemy.pushVd += PULSE_KNOCKBACK * falloff * (enemy.def.boss ? 0.25 : 1)
            if (enemy.hp <= 0) this.killEnemy(i, 1)
        }
        // The hacked nodes nearest the wall wash back toward us, the front one
        // whole. A defender throws itself in the way: the wash breaks on its
        // node, and it does not survive it.
        const defenderOf = (chip: PathChip) => this.enemies.findIndex(enemy => enemy.defending === chip && enemy.hp > 0)
        const wash = this.pathChips?.icePulse(chip => defenderOf(chip) >= 0)
        for (const chip of wash?.reclaimed ?? []) {
            this.pulseFromChip(chip)
            this.chipReclaimed(chip)
        }
        if (wash?.brokeOn) {
            const at = fieldToWorld(wash.brokeOn.u, wash.brokeOn.d, 0.4, new THREE.Vector3())
            this.transient?.ring(at, CYAN, 7, 0.6)
            this.particles.burst(at, 0xe0f2fe, 40, 12, { size: 0.3, life: 0.8 })
            for (let i = defenderOf(wash.brokeOn); i >= 0; i = defenderOf(wash.brokeOn)) {
                const defender = this.enemies[i] as EnemyEntity
                defender.hp = 0
                this.killEnemy(i, 1)
            }
        }
        this.callbacks.onNotice('ICE pulse discharged.', 'info')
    }

    /** Q — a burst of fire rate across the rail and every mounted turret. */
    private fireOverclock() {
        const loadout = this.loadout
        if (!loadout?.overclockUnlocked || !this.running || this.purging || this.paused) return
        if (this.overclockLeft > 0 || this.overclockCharge < loadout.overclockCooldownMs) return
        this.overclockCharge = 0
        this.overclockLeft = loadout.overclockMs
        this.emitOverclock()
        this.callbacks.onSound?.('ability-overclock')
        this.view?.flash(0xf97316, 0.28)
        this.overlay.banner('OVERCLOCK', AMBER)
        this.callbacks.onNotice('Overclock engaged.', 'good')
    }

    // ─── Path nodes ──────────────────────────────────────────────────────────

    /** ×1.25 on speed and damage for a hostile inside a hacked node's aura. */
    private chipBuff(enemy: EnemyEntity) {
        return this.pathChips?.buffedAt(enemy.u, enemy.d) ? 1.25 : 1
    }

    /**
     * Who goes for the path nodes: the green hackers, and only them. They keep
     * at it through the final push — there is always someone on the nodes —
     * while everything else heads for the fence.
     */
    private canHack(enemy: EnemyEntity) {
        return this.running && !this.purging && enemy.def.id === HACKERZ_HACKER_ID && !enemy.decoy && !enemy.demoPath
            && enemy.burrowMs <= 0 && enemy.age > 0.4
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
    private ridesNetwork(enemy: EnemyEntity) {
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

    /**
     * The node a hacker works on. Hackers spread over the two nearest nodes
     * still open ahead of them, each picking whichever has fewer hackers on
     * it, and stick with their pick until it falls — so the swarm splits into
     * two fronts instead of piling onto one.
     */
    private hackTarget(enemy: EnemyEntity) {
        const chips = this.pathChips
        if (!chips) return null
        // While the first node still stands it blocks the whole board, and the
        // hackers throw in on it together, a few at a time (`HACK_TEAM`). One
        // that finds every terminal taken pushes on to a node further forward
        // instead — taking a hostage along as a shield (see `maintainEscorts`) —
        // and sticks with it.
        const gate = chips.ordered[0]
        if (gate && gate.state !== 'hacked' && this.chipAhead(enemy, gate)) {
            const pick = enemy.targetChip
            if (pick && pick !== gate && pick.state !== 'hacked' && this.chipAhead(enemy, pick)) return pick
            const team = this.enemies.filter(e => e !== enemy && e.hacking && e.targetChip === gate).length
            if (enemy.hacking || team < HACK_TEAM) {
                enemy.targetChip = gate
                return gate
            }
            const forward = chips.ordered.find(chip => chip !== gate && chip.state !== 'hacked' && this.chipAhead(enemy, chip))
            enemy.targetChip = forward ?? gate
            return enemy.targetChip
        }
        const open = chips.ordered
            .filter(chip => chip.state !== 'hacked' && this.chipAhead(enemy, chip))
            .slice(0, HACK_FRONTS)
        if (!open.length) {
            enemy.targetChip = null
            return null
        }
        if (enemy.targetChip && open.includes(enemy.targetChip)) return enemy.targetChip
        const crowd = (chip: PathChip) => this.enemies.filter(e => e !== enemy && e.targetChip === chip).length
        enemy.targetChip = open.reduce((best, chip) => crowd(chip) < crowd(best) ? chip : best)
        return enemy.targetChip
    }

    /**
     * A hacker about to take one of the player's rounds may zap sideways onto
     * another data line — never further from the fence — with a green arc
     * marking the jump. It cannot do it again for a while, and does not always
     * see the round coming.
     */
    private dodge(enemy: EnemyEntity, dtMs: number) {
        enemy.zapCooldown -= dtMs
        if (enemy.zapCooldown > 0 || this.untouchable(enemy)) return
        const threatened = this.bullets.some((bullet) => {
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
        const to = zapTarget(this.network, enemy.u, enemy.d, ZAP_MIN, ZAP_MAX)
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
        this.transient?.bolt(from, landed, enemy.def.hex)
        this.particles.burst(from, enemy.def.hex, 12, 6, { size: 0.24, life: 0.35 })
        this.particles.burst(landed, enemy.def.hex, 16, 7, { size: 0.26, life: 0.4 })
        placeEnemy(enemy)
    }

    /** The network layer of a path node: 1 for the outermost. */
    private chipLayer(chip: PathChip) {
        return (this.pathChips?.ordered.indexOf(chip) ?? -1) + 1
    }

    /** Whether a path node is still ahead of a rider: at or past the node its line runs to. */
    private chipAhead(enemy: EnemyEntity, chip: PathChip) {
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
    private attachToNetwork(enemy: EnemyEntity) {
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
            const target = this.canHack(enemy)
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
        let budget = enemy.speed * this.chipBuff(enemy) * this.pushSpeed * boost * dt
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
        const leg = this.legOf(enemy)
        if (leg && !arrived) {
            const off = leg.vertical ? enemy.u - leg.from.u : enemy.d - leg.from.d
            const back = Math.min(Math.abs(off), enemy.speed * this.pushSpeed * LANE_RETURN * dt) * Math.sign(off)
            if (back !== 0) {
                const u = leg.vertical ? enemy.u - back : enemy.u
                const d = leg.vertical ? enemy.d : enemy.d - back
                if (!this.sinksDeeper(enemy, u, d)) {
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
        const step = Math.min(room, enemy.speed * this.chipBuff(enemy) * this.pushSpeed * this.groundSpeed(enemy)
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

    /** A unit in reach of a node hacks it: a terminal opens beside it and fires pulses into the node. */
    private hackAt(enemy: EnemyEntity, node: PathChip, dtMs: number) {
        const terminal = this.terminals?.open(enemy)
        enemy.hacking = true
        if (terminal) {
            // The panel floats above the unit, staggered by its reach so a
            // queue's terminals do not stack into one.
            enemyWorld(enemy, enemy.rig.height * PER_WORLD + 40 + enemy.hackReach * 24, terminal.position)
            terminal.position.x += (enemy.u >= node.u ? 1 : -1) * 1.2
            // A terminal glowing in the dark would give its hacker away.
            terminal.visible = enemy.rig.root.visible && this.territory.shroudOf(enemy) < 0.5
        }
        enemy.pulseTimer -= dtMs
        if (enemy.pulseTimer <= 0) {
            enemy.pulseTimer = MOTION.hackPulseMs * (0.85 + randomFloat() * 0.3)
            if (terminal?.visible) this.fireHackPulse(node, terminal.position)
            else this.landPulse(node)
        }
    }

    private stopHacking(enemy: EnemyEntity) {
        enemy.hacking = false
        this.terminals?.close(enemy)
    }

    /** A pulse leaves a terminal for its node; it counts when it arrives. */
    private fireHackPulse(node: PathChip, from: THREE.Vector3) {
        const mesh = new THREE.Mesh(this.pulseGeometry, this.pulseMaterial)
        mesh.position.copy(from)
        this.fieldRoot.add(mesh)
        this.hackPulses.push({ chip: node, from: from.clone(), to: fieldToWorld(node.u, node.d, 0.5, new THREE.Vector3()), t: 0, mesh })
        this.particles.burst(from, 0xff3b3b, 3, 3, { size: 0.16, life: 0.2, gravity: 0 })
    }

    private updateHackPulses(dt: number) {
        for (let i = this.hackPulses.length - 1; i >= 0; i--) {
            const pulse = this.hackPulses[i]!
            pulse.t += dt / MOTION.hackPulseFlight
            if (pulse.t >= 1) {
                pulse.mesh.removeFromParent()
                this.hackPulses.splice(i, 1)
                this.particles.burst(pulse.to, 0xff3b3b, 4, 5, { size: 0.18, life: 0.25 })
                this.landPulse(pulse.chip)
                continue
            }
            // A shallow arc, spinning as it goes.
            pulse.mesh.position.lerpVectors(pulse.from, pulse.to, pulse.t)
            pulse.mesh.position.y += Math.sin(pulse.t * Math.PI) * MOTION.hackPulseArc
            pulse.mesh.rotation.y += dt * 12
            if (randomChance(dt * 30)) this.particles.emit(pulse.mesh.position, _w.set(0, 0, 0), 0xff3b3b, { size: 0.12, life: 0.18, gravity: 0 })
        }
    }

    /** A pulse lands. The one that takes the node is announced. */
    private landPulse(node: PathChip) {
        const chips = this.pathChips
        if (!chips) return
        const wasAlert = node.alert
        const depth = clamp(node.d / FIELD_DEPTH, 0, 1)
        const taken = chips.landPulse(node, HACK_PULSE_AMOUNT * (HACK_EASE_NEAR + (HACK_EASE_FAR - HACK_EASE_NEAR) * depth))
        if (!taken) {
            if (!wasAlert && node.alert) {
                this.sysLog.chipUnderAttack(node.id, this.enemies.filter(e => e.hacking && e.targetChip === node).length || 1)
            }
            return
        }
        const next = chips.ordered.find(chip => chip.state !== 'hacked')
        this.sysLog.chipCaptured(node.id, next ? next.id : null)
        const at = fieldToWorld(node.u, node.d, 0.3, new THREE.Vector3())
        this.view?.addSurge(at.x, at.z, RED, 1.6)
        this.transient?.ring(at, RED, 6, 0.55)
        this.particles.burst(at, RED, 40, 10, { size: 0.32, life: 0.7 })
        this.overlay.floatText(at, 'NODE COMPROMISED', RED, 1.3)
        this.addShake(4)
        this.callbacks.onNotice('A path node was hacked — shoot it to reclaim it.', 'bad')
        // A logic bomb wired onto it goes off under the crew that just took it.
        for (const blast of this.deployables?.detonateOnChip(node.id) ?? []) this.detonateBlast(blast)
        // The units on it re-target on their next step and march on to the next node.
    }

    private clearHacking() {
        this.terminals?.clear()
        for (const pulse of this.hackPulses) pulse.mesh.removeFromParent()
        this.hackPulses = []
        for (const enemy of this.enemies) enemy.hacking = false
    }

    /**
     * A player round that reaches a hacked node strikes it and is spent there:
     * it chips away at the node, and knocks a blue pulse out along every data
     * line the node is wired to. True when the round struck one.
     */
    private roundThroughChips(bullet: BulletEntity) {
        const chips = this.pathChips
        if (!chips) return false
        for (const chip of chips.chips) {
            if (chip.state !== 'hacked' || bullet.chipsHit?.has(chip.id)) continue
            if (segPointDist(bullet.prevU, bullet.prevD, bullet.u, bullet.d, chip.u, chip.d) > CHIP_HIT_RADIUS) continue
            ;(bullet.chipsHit ??= new Set()).add(chip.id)
            const at = fieldToWorld(chip.u, chip.d, 0.4, new THREE.Vector3())
            // A DDoS-locked node shrugs the round off in red: there is no taking it back.
            this.particles.burst(at, chips.locked ? RED : CYAN, 6, 7, { size: 0.22, life: 0.3 })
            this.pulseFromChip(chip)
            if (chips.hit(chip)) this.chipReclaimed(chip)
            return true
        }
        return false
    }

    /** A hacked node came back to us: it pays, and shows it. */
    private chipReclaimed(chip: PathChip) {
        const at = fieldToWorld(chip.u, chip.d, 0.4, new THREE.Vector3())
        const reward = 15 + this.wave * 8
        this.scoring.waveCredits += reward
        this.callbacks.onCredits(reward, 'kill')
        this.view?.addSurge(at.x, at.z, CYAN, 1.6)
        this.transient?.ring(at, CYAN, 6, 0.55)
        this.particles.burst(at, CYAN, 34, 10, { size: 0.32, life: 0.7 })
        this.overlay.floatText(at, `RECLAIMED +${reward}`, CYAN, 1.3)
        this.sysLog.chipReclaimed(chip.id)
        this.callbacks.onSound?.('coin-pickup')
    }

    /**
     * Sends blue pulses out of a struck node along every line wired to it, in
     * and out. A pulse that still has strength when it reaches the next node
     * fans out once more from there.
     */
    private pulseFromChip(chip: PathChip) {
        const pulses = this.linePulses
        if (!pulses) return
        const nodes = this.network.nodes
        const index = nodes.findIndex(node => node.kind === 'node' && Math.abs(node.u - chip.u) < 1 && Math.abs(node.d - chip.d) < 1)
        if (index < 0) return
        const fan = (from: number, strength: number, hops: number, cameBy: Trace | null) => {
            for (const trace of this.network.traces) {
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
    private pulseFade(u: number, d: number) {
        const zone = this.territory.zoneOf(u, d)
        return zone === 'held' ? LINE_PULSE_FADE.held : zone === 'contested' ? LINE_PULSE_FADE.contested : LINE_PULSE_FADE.theirs
    }

    // ─── Exploit chain ───────────────────────────────────────────────────────

    /** See `Bastion.damageWall`. */
    damageWall(amount: number, sourceU: number, quiet = false) {
        return this.bastion.damageWall(amount, sourceU, quiet)
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
        for (const wall of this.iceWalls) wall.wall.thaw()
        this.purging = true
        this.holding = false
        this.target = null
        this.callbacks.onWaveTime(0, this.enemies.length)

        this.view?.flash(0xffffff, 0.25)
        this.addShake(6)
        const width = FIELD_HALF_WIDTH * 2 * FIELD_SCALE + 6
        this.transient?.sweep(width, 9, 0, -PURGE_REACH * FIELD_SCALE, PURGE_MS,
            (z) => {
                const front = -z * PER_WORLD
                for (let i = this.enemies.length - 1; i >= 0; i--) {
                    if ((this.enemies[i] as EnemyEntity).d > front) continue
                    this.killEnemy(i, HACKERZ_PURGE_BOUNTY)
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
        this.overclockLeft = 0
        this.arm(null)
        // Unspent hardware does not carry over: it was placed for this fight.
        this.deployables?.clear()
        this.linePulses?.clear()

        // Anything left (a boss knocked past the sweep's reach, say) goes too.
        while (this.enemies.length) this.killEnemy(this.enemies.length - 1, HACKERZ_PURGE_BOUNTY)
        for (const spit of this.spits) spit.mesh.removeFromParent()
        this.spits = []
        this.memory.clearLeaks(false)
        this.infected.clear()
        this.clearIce()
        this.surges = []
        this.portscanLeft = 0
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
                if (this.railRig) this.particles.burst(this.railRig.root.position, LIME, 120, 16, { size: 0.36, life: 1 })
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
        this.holding = false
        this.target = null
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
        while (this.enemies.length) this.removeEnemy(this.enemies.length - 1)
        for (const bullet of this.bullets) bullet.mesh.removeFromParent()
        this.bullets = []
        for (const spit of this.spits) spit.mesh.removeFromParent()
        this.spits = []
        this.memory.clearLeaks(false)
        this.infected.clear()
        this.clearIce()
        this.surges = []
        this.portscanLeft = 0
        // Dropped without banking: a cleared field is a run that is restarting.
        for (const coin of this.scoring.coins) coin.mesh.removeFromParent()
        this.scoring.coins = []
        this.particles.clear()
        for (const corpse of this.dying) disposeRig(corpse.rig)
        this.dying = []
        this.view?.clearSurges()
        this.transient?.clear()
        this.overlay.clear()
        this.deployables?.clear()
        this.linePulses?.clear()
        this.shrapnel?.clear()
        this.glitchClouds?.clear()
        this.clearHacking()
        this.armed = null
        this.bonus = null
        this.bonusChips = null
        if (this.pathChips) this.pathChips.locked = false
        this.target = null
        this.holding = false
        this.shake = 0
        this.bastion.wallFlash = 0
    }

    private emitAmmo() {
        const progress = this.reloadTimer > 0 && this.weapon
            ? 1 - this.reloadTimer / this.weapon.reloadMs
            : 1
        this.callbacks.onAmmo(this.mag, this.magSize, progress)
    }

    private emitPulse() {
        this.callbacks.onPulse(this.pulseCharge, this.loadout?.pulseCooldownMs ?? 1)
    }

    private emitOverclock() {
        this.callbacks.onOverclock(
            this.overclockCharge,
            this.loadout?.overclockCooldownMs ?? 1,
            this.overclockLeft
        )
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
