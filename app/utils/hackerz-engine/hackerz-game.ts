import * as THREE from 'three'
import { randomChance, randomFloat } from '#shared/utils/random'
import {
    HACKERZ_BONUS_MS, HACKERZ_BONUS_MULTIPLIER, HACKERZ_BONUS_PASS_INTEGRITY, HACKERZ_HACKER_ID, HACKERZ_MAX_SLOTS, hackerzHackerField,
    HACKERZ_MAX_WAVE, HACKERZ_REINFORCEMENT_BOUNTY,
    HACKERZ_PURGE_BOUNTY, HACKERZ_SHIELD_DELAY_MS, HACKERZ_SPAWN_WINDOW_MS, HACKERZ_TYPE_HEX, HACKERZ_WAVE_MS,
    hackerzBossFor, hackerzBountyMultiplier, hackerzClearBonus, hackerzCoinValue,
    hackerzDamageMultiplier, hackerzDeployable, hackerzEmptyStock, hackerzEnemy, hackerzHpMultiplier,
    hackerzIsAirborne, hackerzIsBossWave, hackerzNetworkEvent, hackerzTypeMultiplier, hackerzWaveBudget,
    hackerzSpawnWeight, hackerzWavePool,
    type HackerzDamageType, type HackerzDeployableId, type HackerzDeployableStock, type HackerzEnemyDefinition,
    type HackerzEnemyId, type HackerzEventId, type HackerzLoadout, type HackerzWeaponRuntime
} from '#shared/utils/gamelogic/hackerz'
import {
    BULLET_LIFE_MS, BULLET_RADIUS, COIN_FLIGHT_MS, CROWD_PUSH, DESPAWN_DEPTH, FIELD_DEPTH,
    FIELD_HALF_WIDTH, FIELD_SCALE, MAX_SHAKE, MODEL_HEIGHT_SCALE, PICK_SLACK_PX, PULSE_KNOCKBACK,
    PULSE_RADIUS, PURGE_MS, PURGE_REACH, RAIL_U, SHAKE_DECAY, SPAWN_SPREAD, SPIKE_BAND, SPIT_GRAVITY,
    SPIT_SPEED, FENCE_HEIGHT, GUN_Z, WALL_HALF_LENGTH, WALL_HEIGHT, mountPosition
} from './constants'
import { clamp, randRange, segPointDist, segSegDist } from './math'
import { CHIP_HIT_RADIUS, PathChips, type PathChip } from './path-chips'
import { Guardrail } from './guardrail'
import { Deployables, type Blast, type Hold } from './deployables'
import { HackTerminals } from './hack-terminal'
import { LinePulses } from './line-pulses'
import { SysLog } from './sys-log'
import {
    buildNetwork, nearestOnNetwork, segmentDirection, tracePassesNear, zapTarget,
    type DataNetwork, type LinePoint, type Trace
} from './data-lines'
import { buildRig, disposeRig, hdr, loadModels, modelClock, poseRig, type ModelRig } from './models'
import { AMBER, CYAN, DARK_ZONES, FRONT_COLUMNS, HackerzScene, ISLANDS, LIME, RED, fieldToWorld } from './scene'
import { AmmoRack } from './ammo-rack'
import { LaneProps, zoneAt } from './lane-props'
import { Overlay, ParticleSystem, TransientFx, hexCss, makeCoin, makeProjectile, makeSpit, type HealthTag } from './fx'
import type {
    BulletEntity, CoinEntity, EnemyEntity, HackerzCallbacks, HackerzStartConfig, SpitEntity, TurretMount
} from './types'

/** A spawn the wave scheduler has already decided on. */
interface ScheduledSpawn {
    atMs: number
    def: HackerzEnemyDefinition
    /** Extra health multiplier, for a DDoS surge that hit its unit cap. */
    hpScale?: number
}

/** What a rider is doing: pressing on, healing in red, falling back to it, or holding to cover one that is. */
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

/** Field units per world unit, for heights that only exist for rendering. */
const PER_WORLD = 1 / FIELD_SCALE
/** Turret and rail muzzles sit this high above the field, in field units. */
const MUZZLE_Y = (WALL_HEIGHT + 1.1) * PER_WORLD
/** Where the fence is struck, and where dropped coins bank. */
const WALL_HIT_Y = FENCE_HEIGHT * 0.55 * PER_WORLD
const COIN_BANK = new THREE.Vector3(0, WALL_HEIGHT + 1.2, GUN_Z + 0.4)
/**
 * Rounds start on the deck, well behind the fence. Walkers stop a body-width
 * out from the fence to hit it, so the guns have to stand back far enough that
 * a unit at the fence is in front of every barrel rather than under it.
 */
const MUZZLE_D = -GUN_Z * PER_WORLD
/** Chain lengths that earn a banner. */
const CHAIN_MILESTONES = [10, 25, 50, 100]
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
/**
 * Every hostile's speed in the rules, scaled up for the 3D field. Riders take
 * the long way round along the data lines where the balance sim walks them
 * straight in, so this also keeps their time to the fence near what the sim
 * assumes.
 */
const ENEMY_PACE = 1.4
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
/** Hacker zap-dodge: how far ahead a round is seen, the odds of dodging it, the jump range, and the recharge. */
const ZAP_SIGHT = 150
const ZAP_CHANCE = 0.55
const ZAP_MIN = 45
const ZAP_MAX = 170
const ZAP_COOLDOWN_MS = 2600
/** Half the width of a turret's own lane, in field units: mounts sit about twice this apart. */
const TURRET_LANE = 75
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
/** Speed through their own red ground, once they hold a node. */
const THEIR_GROUND_SPEED = 2
/** A honeypot pulls in riders whose next trace passes this close to it. */
const LURE_TRACE_RADIUS = 120
/** Hackers get to work within this far of a node — a column over still counts. */
const HACK_REACH = 125
/** Facing for a rider: down the column toward the fence, or along a rung. */
const YAW_DOWN = 0
const YAW_RIGHT = Math.PI / 2
const YAW_LEFT = -Math.PI / 2
/** Held ground bites: a tick this often, of this share of max health plus a flat bite. */
const ZONE_TICK_MS = 500
const ZONE_TICK_SHARE = 0.025
const ZONE_TICK_BOSS_SHARE = 0.006
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
/** How far in front of its hacker (toward the rail) a bodyguard stands, and the gap to the next one. */
const ESCORT_AHEAD = 40
const ESCORT_SPACING = 30
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
/** Island radii, field units: a node taken out of turn, and one being hacked away from the front. */
const RED_ISLAND = 150
const ORANGE_ISLAND = 170
/** How fast an island swells, in field units of radius a second. */
const ISLAND_FLOW = 160
/** Red ground's gifts to anything standing in it: a one-hit shield, recharging, and a heal per tick. */
const RED_SHIELD_RECHARGE_MS = 3000
/** A weakling below this share of health holds in red to heal, until it is back above `RECOVERED`. */
const RETREAT_BELOW = 0.5
const RECOVERED = 0.9
/** Units this close to a node they hold heal twice as fast, and stand guard over it. */
const GUARD_RADIUS = 140
/** Sappers run this much faster than the rules say, and shrug off every second held-ground tick. */
const SAPPER_SPEED = 1.5
/** A unit falls back at this share of its pace; healthier units this close in front of it hold to cover it. */
const RETREAT_SPEED = 0.8
const COVER_RADIUS = 170
const COVER_HOLD_MS = 900
const YAW_UP = Math.PI
/** How soon a shield re-forms on a unit stepping back into red. */
const RED_SHIELD_REFORM_MS = 500
const RED_HEAL_SHARE = 0.02
const RED_HEAL_BOSS_SHARE = 0.005
/** How fast their red ground pours toward a node they have taken, in field units a second. */
const RED_FLOW_SPEED = 150
/** How fast disputed ground swarms out from their line, in field units a second. */
const SWARM_SPEED = 260
/** Hack pulses: how often a hacking unit fires one, how long it flies, and how much of a node it takes. */
const HACK_PULSE_MS = 560
const HACK_PULSE_FLIGHT = 0.35
const HACK_PULSE_AMOUNT = 0.09
/**
 * Nodes out by the portal are poorly defended and fall fast; the closer to the
 * fence, the longer one holds out. A pulse's take is scaled from the first
 * figure (right at the portal: a third of the old hack time) down to the second
 * (at the fence: the old hack time, and never slower).
 */
const HACK_EASE_FAR = 1.5
const HACK_EASE_NEAR = 0.5
/** BLACKOUT: hostiles further out than this are dark until a ping lights them. */
const BLACKOUT_LIGHT_D = 260
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
/** PACKET LOSS: how long the board's picture freezes, and the gap between freezes, give or take. */
const LAG_FREEZE_MS = 1400
const LAG_GAP_MS = 1800
/** PACKET LOSS: when a spike clears, hostiles surge this many times faster for this long. */
const LAG_CATCH_UP_SPEED = 4
const LAG_CATCH_UP_MS = 500
/** Deployables may only go down on this stretch of the lane. */
const DEPLOY_MIN_D = 60
const DEPLOY_MAX_D = FIELD_DEPTH * 0.85
const DEPLOY_KEYS: Record<string, HackerzDeployableId> = { z: 'honeypot', x: 'bomb', c: 'proxy' }
/** A logic bomb dropped this close to a node that is not theirs is wired onto it. */
const BOMB_CHIP_SNAP = 110

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()

export class HackerzGame {
    private view: HackerzScene | null = null
    private callbacks: HackerzCallbacks
    private particles = new ParticleSystem(5000)
    private transient: TransientFx | null = null
    private overlay = new Overlay()
    private fieldRoot = new THREE.Group()
    private railRig: ModelRig | null = null
    private ammoRack: AmmoRack | null = null
    private laneProps: LaneProps | null = null
    private pathChips: PathChips | null = null
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
    private running = false
    private paused = false
    /** The end-of-wave sweep is playing; input is dead but the field still ticks. */
    private purging = false
    private gameOver = false

    // ── Run state ──
    private loadout: HackerzLoadout | null = null
    private weapon: HackerzWeaponRuntime | null = null
    private slots = 2
    private wave = 0
    private waveElapsed = 0
    private schedule: ScheduledSpawn[] = []
    private scheduleIndex = 0
    private waveKills = 0
    private waveCredits = 0
    private waveCoins = 0
    private waveLeaks = 0
    private totalKills = 0
    /**
     * Exploit chain: kills since the last leak. It multiplies run credits only —
     * coins, and so the site economy, never see it.
     */
    private chain = 0
    /** The wave's closing stretch is on: everything but the hackers charges. */
    private finalPush = false
    /** Ms until the portal may send the next top-up hacker. */
    private hackerTimer = 0
    /** Ms until the portal may send the next shield bearer. */
    private bearerTimer = 0
    private escortTimer = 0
    private distractTimer = 0
    /** Packet loss: ms left on the current board-wide lag spike, and ms until the next. */
    private boardLagMs = 0
    private boardLagTimer = LAG_GAP_MS
    /** Ms left on the catch-up surge that follows a lag spike. */
    private lagCatchUpMs = 0
    /** How far the ground behind the fence has turned orange (0–1), eased toward whether every node is theirs. */
    private overrun = 0
    /** Dark-zone slots over clusters of hacked nodes; field units, strength eased 0–1. */
    private darkZones = Array.from({ length: DARK_ZONES }, () => ({ u: 0, d: 0, r: 0, strength: 0, on: false }))
    /** Island radii per path node (outermost first), eased; field units. */
    private islands: { red: number, orange: number }[] = []

    // ── Bonus round ──
    /** The network event this round is, or null for an ordinary wave. */
    private bonus: HackerzEventId | null = null
    /** Length of the round in flight: a wave, or the shorter bonus sprint. */
    private waveMs = HACKERZ_WAVE_MS
    /** The wall as it stood before a bonus round, put back afterwards. */
    private bonusStartHp = 0
    private bonusStartShield = 0
    private bonusFailed = false
    /** The run's node states, set aside while a bonus round plays on a fresh board. */
    private bonusChips: ReturnType<PathChips['snapshot']> | null = null
    /** BLACKOUT dimming, eased 0 → 1. */
    private darkness = 0

    // ── Deployables ──
    private deployables: Deployables | null = null
    private linePulses: LinePulses | null = null
    /** The firewall's syslog, for the terminal beside the board. */
    private sysLog = new SysLog(line => this.callbacks.onLog?.(line))
    /** The hacker pack size last seen this wave, to announce a second contingent. */
    private hackerField = 0
    private decoysLogged = false
    private stock: HackerzDeployableStock = hackerzEmptyStock()
    /** Armed by Z/X/C: the next left click places it instead of firing. */
    private armed: HackerzDeployableId | null = null

    // ── Bastion state ──
    private wallHp = 1000
    private wallMaxHp = 1000
    private shield = 0
    private shieldMax = 0
    private msSinceWallHit = 99_999
    private wallFlash = 0
    private shieldHit = 0

    // ── Weapon ──
    private mag = 10
    private magSize = 10
    private fireTimer = 0
    private reloadTimer = 0
    private pulseCharge = 0
    private overclockCharge = 0
    private overclockLeft = 0
    private railHeading = Math.PI
    private railKick = 0
    private pingCharge = PING_COOLDOWN_MS

    // ── Entities ──
    private enemies: EnemyEntity[] = []
    private bullets: BulletEntity[] = []
    private spits: SpitEntity[] = []
    private coins: CoinEntity[] = []
    private turrets: TurretMount[] = []

    // ── Input ──
    /** The hostile the button was pressed on: tracked only while it stays held. */
    private target: EnemyEntity | null = null
    /** Left button held: the rail fires, at `target` or else at the cursor. */
    private holding = false
    /** Where a lag spike left the rail firing when it dropped the lock. */
    private lockSpot: { u: number, d: number, y: number } | null = null
    /** A press always fires once, even if the button is up again before the next frame. */
    private queuedShot = false
    private aimU = 0
    private aimD = FIELD_DEPTH * 0.5
    private listeners: (() => void)[] = []
    private raycaster = new THREE.Raycaster()
    private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    // ── Camera ──
    private shake = 0
    private elapsedTotal = 0
    /** The picture's clock: drives every shader animation, and stands still during a packet-loss spike. */
    private visualTime = 0

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

        this.attachInput()
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

    /** Drops one enemy of a type onto the field. For a test harness only. */
    debugSpawn(id: HackerzEnemyId, u?: number, d?: number) {
        this.spawn(hackerzEnemy(id))
        const enemy = this.enemies[this.enemies.length - 1]
        if (!enemy) return
        if (u !== undefined) enemy.u = u
        if (d !== undefined) enemy.d = d
        if (this.ridesNetwork(enemy)) this.attachToNetwork(enemy)
        enemy.age = 1
        this.placeEnemy(enemy)
    }

    /** Advances the simulation by hand, in frames of `frameMs`. For a test harness only. */
    debugStep(ms: number, frameMs = 16.7) {
        for (let t = 0; t < ms; t += frameMs) this.tick(frameMs)
    }

    private loop = (now: number) => {
        if (this.destroyed) return
        this.raf = requestAnimationFrame(this.loop)
        const rawMs = now - this.lastTime
        this.lastTime = now
        this.tick(rawMs)
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
            this.target = this.boardLagMs > 0 ? null : this.pickEnemy(p.x, p.y)
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
            if (deploy) this.arm(this.armed === deploy ? null : deploy)
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
            if (this.untouchable(enemy)) continue
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
        const box = enemy.rig.box
        // A rider turned onto a rung lies across the lane rather than along it.
        const sideways = Math.abs(Math.sin(enemy.yaw)) > 0.7
        const across = Math.max(-box.min.x, box.max.x) * PER_WORLD
        const along = Math.max(-box.min.z, box.max.z) * PER_WORLD
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
        this.totalKills = config.kills ?? 0
        this.chain = 0
        this.emitChain()
        // A fresh board each run: nodes first, then the lines laid around them.
        this.pathChips?.reset()
        this.network = buildNetwork(this.pathChips?.ordered ?? [])
        this.view?.setNetwork(this.network)
        this.islands = []
        this.gameOver = false
        this.purging = false
        this.running = false
        this.wallMaxHp = loadout.wallMaxHp
        this.wallHp = clamp(config.wallHp ?? loadout.wallMaxHp, 1, loadout.wallMaxHp)
        this.shieldMax = loadout.shieldMax
        this.shield = loadout.shieldMax
        this.pulseCharge = loadout.pulseCooldownMs
        this.overclockCharge = loadout.overclockCooldownMs
        this.overclockLeft = 0
        this.magSize = Math.round(loadout.weapon.magazine)
        this.mag = this.magSize
        this.reloadTimer = 0
        this.slots = loadout.slots
        this.syncTurrets()
        this.emitWall()
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
        this.finalPush = false
        this.hackerTimer = 0
        this.hackerField = 0
        this.decoysLogged = false
        this.sysLog.clock = 0
        this.sysLog.waveStart(wave, event)
        this.waveMs = event ? HACKERZ_BONUS_MS : HACKERZ_WAVE_MS
        this.bonusFailed = false
        this.stock = { ...loadout.deployables }
        this.deployables?.clear()
        this.linePulses?.clear()
        this.arm(null)
        const previousMax = this.wallMaxHp
        this.loadout = loadout
        this.weapon = loadout.weapon
        this.ammoRack?.setColour(loadout.weapon.hex)
        this.wallMaxHp = loadout.wallMaxHp
        if (loadout.wallMaxHp > previousMax) this.wallHp += loadout.wallMaxHp - previousMax
        this.wallHp = clamp(this.wallHp, 1, this.wallMaxHp)
        this.shieldMax = loadout.shieldMax
        this.shield = loadout.shieldMax
        this.magSize = Math.round(loadout.weapon.magazine)
        this.mag = this.magSize
        this.reloadTimer = 0
        this.fireTimer = 0
        this.pulseCharge = loadout.pulseCooldownMs
        this.overclockCharge = loadout.overclockCooldownMs
        this.overclockLeft = 0
        this.slots = loadout.slots
        this.syncTurrets()
        for (const mount of this.turrets) if (mount.frozenMs > 0) this.thaw(mount)

        this.wave = wave
        this.waveElapsed = 0
        this.waveKills = 0
        this.waveCredits = 0
        this.waveCoins = 0
        this.waveLeaks = 0
        this.scheduleIndex = 0
        this.schedule = this.buildSchedule(wave)
        this.running = true
        this.purging = false
        this.paused = false
        this.target = null
        // A bonus round is a sandbox: whatever it does to the wall is undone.
        this.bonusStartHp = this.wallHp
        this.bonusStartShield = this.shield

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
        this.emitWall()
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
        if (!id) {
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
        const item = deployables.place(id, u, d, this.wave, chip?.id ?? null)
        this.stock[id]--
        this.callbacks.onDeploy?.(id, this.stock[id])
        this.sysLog.deploy(id, chip?.id ?? null)
        const at = fieldToWorld(u, d, 0.2, new THREE.Vector3())
        this.transient?.ring(at, item.hex, 4, 0.4)
        this.particles.burst(at, item.hex, 30, 9, { size: 0.3, life: 0.6 })
        this.view?.addSurge(at.x, at.z, item.hex, 1.2)
        this.callbacks.onSound?.('weapon-swap')
        // One click, one drop: placing another means pressing the key again.
        this.arm(null)
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

    /** Uplink purchase — patches the wall back to full between waves. */
    repairWall() {
        this.wallHp = this.wallMaxHp
        this.emitWall()
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
        return Math.round(this.wallHp)
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
                    cooldown: randRange(0, 400),
                    kick: 0,
                    heading: Math.PI,
                    frozenMs: 0,
                    ice: null
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
                if (roll <= 0) { chosen = def; break }
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
            health += def.hp * hackerzHpMultiplier(wave) * difficulty.enemyHp * 0.5
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
        const health = (def: HackerzEnemyDefinition) => def.hp * hackerzHpMultiplier(wave) * difficulty.enemyHp
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
        if (live) this.updateBoardLag(dtMs)
        const frozen = live && this.boardLagMs > 0
        this.muteFx(frozen)
        const seen = frozen ? 0 : dt
        if (!frozen) this.visualTime += dtMs
        modelClock.value = this.visualTime / 1000
        if (live) {
            if (this.running && !this.purging) {
                // A lag spike stops the clock too, but not the hostiles: they
                // gain ground on the wave timer while the picture holds.
                if (!frozen) this.waveElapsed += dtMs
                this.sysLog.tick(this.waveElapsed, this.enemies.length)
                this.releaseScheduled()
                this.maintainHackers(dtMs)
                this.maintainDistraction(dtMs)
                this.maintainBearers(dtMs)
                this.maintainDefenders()
                this.maintainEscorts(dtMs)
                this.updateWeapon(dtMs)
                this.updateAbilities(dtMs)
                if (!this.finalPush && this.waveElapsed >= this.waveMs - FINAL_PUSH_MS) this.beginFinalPush()
                if (this.waveElapsed >= this.waveMs) this.beginPurge()
            }
            this.updateDeployables(dt)
            this.updateEnemies(dt, dtMs)
            this.updateBullets(dt)
            this.updateSpits(dt)
            this.updateTurrets(dtMs, frozen)
            this.updateCoins(frozen ? 0 : dtMs)
            this.updateBastion(dt, dtMs)
            this.updateHackPulses(dt)
            this.pathChips?.update(seen)
            this.linePulses?.update(seen, (u, d) => this.pulseFade(u, d))
            this.particles.update(seen)
            this.transient?.update(seen)
        }
        this.guardrail?.update(live ? seen : 0)
        this.terminals?.update(live ? seen : 0, view.camera)
        this.updateRail(frozen ? 0 : dt)
        this.updateCamera(dt)
        this.updateTerritory(live ? seen : 0)
        const reload = this.reloadTimer > 0 && this.weapon ? 1 - this.reloadTimer / this.weapon.reloadMs : 1
        this.ammoRack?.update(live ? seen : 0, this.mag, this.magSize, reload)
        this.laneProps?.update(live ? seen : 0, view.redLine, view.orangeLine)
        this.updateDying(live ? seen : 0)
        view.ageSurges(live ? seen : 0)

        view.trapMaterial.uniforms.uLevel!.value = (this.loadout?.spikeDps ?? 0) > 0 ? 1 : 0
        view.shieldMaterial.uniforms.uStrength!.value = this.shieldMax > 0 ? this.shield / this.shieldMax : 0
        view.shieldMaterial.uniforms.uHit!.value = this.shieldHit
        // With every node theirs the ground right up to the deck and the barrier
        // lattice turn disputed orange, and the fence's own glow dims.
        this.overrun += ((this.allNodesTaken ? 1 : 0) - this.overrun) * Math.min(1, dt * 1.5)
        view.gate.value = this.overrun
        view.setWallState(this.wallMaxHp > 0 ? this.wallHp / this.wallMaxHp : 1, this.wallFlash, this.overrun)

        // BLACKOUT: the lights go down and the fog closes in, eased both ways.
        const dark = this.bonus === 'blackout' && this.running ? 1 : 0
        this.darkness += (dark - this.darkness) * Math.min(1, dt * 1.2)
        view.renderer.toneMappingExposure = 1.05 - 0.5 * this.darkness
        const fog = view.scene.fog as THREE.Fog | null
        if (fog) {
            fog.near = 45 - 27 * this.darkness
            fog.far = 120 - 58 * this.darkness
        }

        view.render(frozen ? 0 : dt, this.shake)
        this.drawOverlay(frozen ? 0 : dt)

        if (this.running && live) {
            this.callbacks.onWaveTime(Math.max(0, this.waveMs - this.waveElapsed), this.enemies.length)
        }
    }

    private updateCamera(dt: number) {
        this.shake = this.shake > 0.005 ? Math.max(0, this.shake - this.shake * SHAKE_DECAY * dt) : 0
    }

    /**
     * The territory follows the path nodes. Their ground runs from the portal
     * down to the last node they hold in an unbroken run, and while a wave is
     * on, disputed ground swarms out ahead of it to the next node they are
     * going for — or, with nothing left to take, all the way to the fence.
     * Each line reaches furthest at its node and trails back across the lane,
     * so it points at what it is fighting over. Between waves the dispute
     * draws back into their ground.
     */
    private updateTerritory(dt: number) {
        const view = this.view
        const chips = this.pathChips
        if (!view || !chips) return
        const ordered = chips.ordered
        // The lines follow the unbroken run of nodes taken from the portal down;
        // a node taken out of turn, or fought over away from the front, gets
        // an island of its own instead.
        let run = 0
        while (run < ordered.length && ordered[run]!.state === 'hacked') run++
        const connected = ordered.slice(0, run)
        const next = ordered[run] ?? null
        const disputed = this.running && !this.purging
        // With every node gone the gate itself is disputed — unless the grid
        // trap is live, which keeps the band in front of the fence theirs to fear.
        const gateD = (this.loadout?.spikeDps ?? 0) > 0 ? SPIKE_BAND : -20
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
            const creep = 0.7 + 0.3 * Math.sin(c * 1.7 + this.elapsedTotal * 0.0011)
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
        const view = this.view
        const chips = this.pathChips
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
                if (zone.on && this.running) this.sysLog.lightsBack(slot)
                zone.on = false
            }
        })
        for (const target of free) {
            const slot = this.darkZones.find(zone => !zone.on && zone.strength < 0.05)
            if (!slot) break
            Object.assign(slot, { u: target.u, d: target.d, r: target.r, on: true })
            if (this.running) {
                this.overlay.floatText(fieldToWorld(target.u, target.d, 4, _v), 'LIGHTS OUT', RED, 1.5)
                this.sysLog.darkZone(this.darkZones.indexOf(slot))
                this.sendShieldBearers()
            }
        }
        this.darkZones.forEach((zone, i) => {
            zone.strength += ((zone.on ? 1 : 0) - zone.strength) * Math.min(1, dt * 1.2)
            view.darkZones[i]!.set(zone.u * FIELD_SCALE, -zone.d * FIELD_SCALE, zone.r * FIELD_SCALE, zone.strength)
        })
    }

    /**
     * Where a unit appears to be: normally where it is, but during a
     * packet-loss spike where its frozen picture still stands.
     */
    private seenAt(enemy: EnemyEntity) {
        if (this.boardLagMs <= 0) return { u: enemy.u, d: enemy.d }
        const p = enemy.rig.root.position
        return { u: p.x / FIELD_SCALE, d: -p.z / FIELD_SCALE }
    }

    /**
     * Packet loss: every so often the whole board's picture stops updating for
     * a fraction of a second, then catches up in one glitchy jump. Purely what
     * is seen: nothing on the field ever stops.
     */
    /** A lag spike shows nothing new: no sparks, flashes or floating numbers until it catches up. */
    private muteFx(on: boolean) {
        this.particles.muted = on
        if (this.transient) this.transient.muted = on
        this.overlay.muted = on
    }

    private updateBoardLag(dtMs: number) {
        if (this.bonus !== 'packetloss' || !this.running) {
            this.boardLagMs = 0
            this.lagCatchUpMs = 0
            return
        }
        if (this.lagCatchUpMs > 0) this.lagCatchUpMs -= dtMs
        if (this.boardLagMs > 0) {
            this.boardLagMs -= dtMs
            if (this.boardLagMs > 0) return
            // Caught up: everything jumps to where it really was all along.
            this.muteFx(false)
            for (const enemy of this.enemies) {
                this.placeEnemy(enemy)
                this.particles.burst(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, _v), 0xe879f9, 6, 4, { size: 0.22, life: 0.3 })
            }
            for (const bullet of this.bullets) this.orientBullet(bullet)
            for (const spit of this.spits) fieldToWorld(spit.u, spit.d, spit.y * FIELD_SCALE, spit.mesh.position)
            this.view?.flash(0xe879f9, 0.08)
            this.boardLagTimer = LAG_GAP_MS * (0.6 + randomFloat() * 0.8)
            this.lagCatchUpMs = LAG_CATCH_UP_MS
            return
        }
        this.boardLagTimer -= dtMs
        if (this.boardLagTimer > 0) return
        this.boardLagMs = LAG_FREEZE_MS * (0.6 + randomFloat() * 0.8)
        this.sysLog.lagSpike()
        // The spike drops the lock: the rail keeps firing at the last spot it
        // saw its target, while the target walks on out of it.
        if (this.target) {
            this.lockSpot = { u: this.target.u, d: this.target.d, y: this.enemyCentreY(this.target) }
            this.target = null
        }
    }

    // ─── Shield bearers ──────────────────────────────────────────────────────

    /** A dark zone calls up the shield wall; `maintainBearers` sends the bulwarks. */
    private sendShieldBearers() {
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
        const zones = this.darkZones.filter(zone => zone.on).length
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
            if (pick) pick.defending = chip
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
            if (enemy.escorting || enemy.defending || enemy.bearer || enemy.decoy || enemy.def.boss || enemy.def.armored) continue
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
        const ahead = ESCORT_AHEAD + rank * ESCORT_SPACING
        return { u: hacker.u + du / length * ahead, d: Math.max(20, hacker.d + dd / length * ahead) }
    }

    /** Who may stand guard at a node: any free walker but the hackers, the bearers and the bosses. */
    private canDefend(enemy: EnemyEntity) {
        return !enemy.defending && !enemy.escorting && !enemy.bearer && !enemy.decoy && !enemy.def.boss
            && enemy.def.id !== HACKERZ_HACKER_ID && !hackerzIsAirborne(enemy.def) && enemy.burrowMs <= 0
    }

    /** Where a defender stands: square in front of its node, toward the fence. */
    private defenderPost(enemy: EnemyEntity) {
        const chip = enemy.defending
        if (!chip || chip.state !== 'hacked') return null
        return { u: chip.u, d: Math.max(30, chip.d - DEFEND_AHEAD) }
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
        const at = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.particles.burst(at, enemy.def.hex, 40, 10, { size: 0.3, life: 0.7 })
        const ground = fieldToWorld(enemy.u, enemy.d, 0.05, new THREE.Vector3())
        for (let b = 0; b < 4; b++) {
            this.transient?.bolt(at, ground.clone().add(_w.set(randRange(-1, 1), 0, randRange(-1, 1))), enemy.def.hex)
        }
        this.view?.addSurge(ground.x, ground.z, enemy.def.hex, 1)
        this.overlay.floatText(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'DISINTEGRATED', enemy.def.hex, 1)
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

    /** A parked gun walks to its firing spot; it has arrived once it is there. */
    private walkToPark(enemy: EnemyEntity, spot: { u: number, d: number }, dt: number) {
        const moved = this.walkTo(enemy, spot.u, spot.d, dt)
        return { moved, arrived: moved === 0 }
    }

    /** Whether a unit stands close behind a shield bearer (portal side), in the cover of the wall. */
    private isSheltered(enemy: EnemyEntity) {
        if (enemy.bearer) return false
        return this.enemies.some(other => other.bearer && other.d < enemy.d
            && Math.hypot(other.u - enemy.u, other.d - enemy.d) <= SHELTER_RADIUS)
    }

    /** Whether a point lies inside a dark zone that is mostly out. */
    private inDarkZone(u: number, d: number) {
        return this.darkZones.some(zone => zone.strength > 0.5 && Math.hypot(u - zone.u, d - zone.d) < zone.r * 0.85)
    }

    /**
     * Which side holds a field point: the lines, then the islands on top —
     * a red island is theirs, an orange one disputed unless it lies in red.
     */
    private zoneOf(u: number, d: number): 'held' | 'contested' | 'theirs' {
        const view = this.view
        if (!view || d < 0) return 'held'
        const ordered = this.pathChips?.ordered ?? []
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

    private addShake(amount: number) {
        // The old engine shook in pixels; this one shakes in world units. A lag
        // spike shows nothing landing, so nothing shakes.
        if (this.boardLagMs > 0) return
        this.shake = Math.min(MAX_SHAKE, this.shake + amount * 0.05)
    }

    /** Like `enemyWorld`, but where the unit is seen: its frozen picture during a packet-loss spike. */
    private seenWorld(enemy: EnemyEntity, lift: number, out: THREE.Vector3) {
        const seen = this.seenAt(enemy)
        return fieldToWorld(seen.u, seen.d, (enemy.altitude + lift) * FIELD_SCALE, out)
    }

    private drawOverlay(dt: number) {
        const view = this.view
        if (!view) return
        const tags: HealthTag[] = []
        for (const enemy of this.enemies) {
            // Only wounded enemies get a bar; a pip over every crawler is noise.
            if (enemy.hp >= enemy.maxHp) continue
            tags.push({
                // Overlays follow the picture, so a lag spike does not give a position away.
                pos: this.seenWorld(enemy, enemy.rig.height * PER_WORLD + 12, new THREE.Vector3()),
                fraction: enemy.hp / enemy.maxHp,
                color: hexCss(enemy.def.hex),
                armored: enemy.armored,
                width: enemy.def.boss ? 90 : clamp(enemy.def.height * 0.6, 22, 50)
            })
        }
        let reticle = null
        if (this.target) {
            const height = this.target.rig.height * PER_WORLD
            const pos = this.seenWorld(this.target, height * 0.5, new THREE.Vector3())
            const top = view.project(this.seenWorld(this.target, height, _w), { x: 0, y: 0 })
            const mid = view.project(pos, { x: 0, y: 0 })
            const size = top && mid ? clamp(Math.abs(top.y - mid.y) + 6, 12, 70) : 16
            reticle = { pos, size, color: '#22d3ee' }
        }
        // Radar contacts: a bracket on everything the ping lit, fading with it.
        const markers = []
        for (const enemy of this.enemies) {
            if (enemy.revealMs <= 0) continue
            const height = enemy.rig.height * PER_WORLD
            const pos = this.seenWorld(enemy, height * 0.5, new THREE.Vector3())
            const top = view.project(this.seenWorld(enemy, height, _w), { x: 0, y: 0 })
            const mid = view.project(pos, { x: 0, y: 0 })
            const size = top && mid ? clamp(Math.abs(top.y - mid.y) + 8, 12, 80) : 16
            markers.push({ pos, size, alpha: enemy.revealMs / PING_REVEAL_MS, cloaked: !!enemy.def.cloaked })
        }
        this.overlay.draw(
            view.overlayCtx, view.width, view.height, this.paused ? 0 : dt,
            (p, out) => view.project(p, out), tags, reticle, this.visualTime / 1000, markers
        )
    }

    // ─── Positions ───────────────────────────────────────────────────────────

    /** World position of an enemy, `lift` field units above where it stands. */
    private enemyWorld(enemy: EnemyEntity, lift: number, out: THREE.Vector3) {
        return fieldToWorld(enemy.u, enemy.d, (enemy.altitude + lift) * FIELD_SCALE, out)
    }

    /** Field height of an enemy's centre of mass, for aiming and splash. */
    private enemyCentreY(enemy: EnemyEntity) {
        return enemy.altitude + enemy.rig.height * PER_WORLD * 0.5
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

    /** `reinforcement` is a top-up hacker: half the credits, and no coins. */
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
        if (sapper.fromWave > this.wave) return
        if (this.enemies.filter(e => e.def.id === sapper.id).length >= DISTRACT_MAX) return
        this.distractTimer = DISTRACT_MS * (0.75 + randomFloat() * 0.5)
        this.spawn(sapper, true)
        if (!this.decoysLogged) {
            this.decoysLogged = true
            this.sysLog.decoys()
        }
    }

    private spawn(def: HackerzEnemyDefinition, reinforcement = false, hpScale = 1) {
        const loadout = this.loadout
        if (!loadout) return
        const difficulty = loadout.difficulty
        // Flyers pick any lane over the board; ground units come out of one of
        // the portal's sockets and are put on a trace below.
        const u = def.boss ? 0 : (randomFloat() * 2 - 1) * (FIELD_HALF_WIDTH - 40)
        const d = FIELD_DEPTH + randomFloat() * SPAWN_SPREAD

        const height = def.height * MODEL_HEIGHT_SCALE
        const rig = buildRig(def.id, def.hex, height)
        this.fieldRoot.add(rig.root)

        const maxHp = def.hp * hackerzHpMultiplier(this.wave) * difficulty.enemyHp * (this.bonus === 'ddos' ? 0.5 : 1) * hpScale
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
            damage: def.damage * hackerzDamageMultiplier(this.wave) * difficulty.enemyDamage,
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
            standoff: def.range ?? def.height * 0.3 + 10,
            radius: def.height * 0.22 + BULLET_RADIUS,
            age: 0,
            pingDelay: -1,
            revealMs: 0,
            decloaked: false,
            decoy: false,
            bossTimer: def.id === 'titan' ? 6000 : def.id === 'leviathan' ? 7000 : 0,
            burrowMs: 0,
            splits: 0,
            hackReach: randomFloat(),
            pulseTimer: randomFloat() * HACK_PULSE_MS,
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
            parked: null
        }
        if (this.ridesNetwork(enemy)) this.enterFromPortal(enemy)
        this.placeEnemy(enemy)
        this.enemies.push(enemy)
        this.transient?.ring(fieldToWorld(u, d, 0.1, _v), def.hex, def.boss ? 6 : 1.6, 0.5)
        // Coming through the gate sets a ripple running across it from the entry point.
        this.view?.portalRipple(enemy.u)

        if (def.boss) {
            this.callbacks.onBoss(def.name)
            this.sysLog.boss(def.id, def.name)
            this.callbacks.onSound?.('boss-spawn')
            this.overlay.banner(def.name, RED, 'kernel-level intrusion')
            this.addShake(10)
        }
    }

    private placeEnemy(enemy: EnemyEntity) {
        const bob = hackerzIsAirborne(enemy.def) ? Math.sin(enemy.hover) * 9 : 0
        fieldToWorld(enemy.u, enemy.d, (enemy.altitude + bob) * FIELD_SCALE, enemy.rig.root.position)
    }

    // ─── Enemies ─────────────────────────────────────────────────────────────

    private updateEnemies(dt: number, dtMs: number) {
        const spikeDps = this.loadout?.spikeDps ?? 0

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i] as EnemyEntity
            enemy.age += dt
            if (enemy.def.boss) this.updateBoss(enemy, dt, dtMs)
            // A shield bearer whose node was taken back disintegrates on the spot.
            if (enemy.bearer && this.running && !this.purging && this.keepBearerPost(enemy, i)) continue
            const riding = this.ridesNetwork(enemy)
            // A honeypot or proxy wall in the way is where this unit stops instead.
            let hold: Hold | null = enemy.burrowMs > 0 || enemy.def.boss
                ? null
                : this.deployables?.holdFor(enemy.u, enemy.d, enemy.standoff, hackerzIsAirborne(enemy.def)) ?? null
            // A honeypot only draws a rider whose line runs past it.
            if (hold?.target.kind === 'honeypot' && riding
                && !this.routeAheadPasses(enemy, hold.target.u, hold.target.d, 90)) hold = null
            // Hackers go for the next path node still ahead on their lines — and
            // when none is left ahead, they double back for one that is still open.
            let node = !hold && this.canHack(enemy) ? this.hackTarget(enemy) : null
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
            const step = parked
                ? this.walkToPark(enemy, parked, dt)
                : tactic === 'advance'
                    ? riding ? this.ride(enemy, goal, dt) : this.fly(enemy, goal, dt)
                    : { moved: this.holdBack(enemy, tactic, dt), arrived: false }
            // Stride is driven by distance, not time, so a knocked-back or
            // crowded enemy never moon-walks.
            enemy.stride += (step.moved / enemy.def.height) * 7
            let rollSpeed = step.moved * FIELD_SCALE / Math.max(0.2, enemy.rig.height * 0.18) / Math.max(dt, 1e-4)

            if (tactic !== 'advance') {
                if (enemy.hacking) this.stopHacking(enemy)
                if (step.moved === 0) enemy.stride += dt * 3
            } else if (!step.arrived) {
                if (enemy.hacking) this.stopHacking(enemy)
            } else if (node && queued) {
                // Waiting its turn at the node: idling on the spot.
                rollSpeed = 0
                enemy.stride += dt * 2
            } else if (node) {
                rollSpeed = 0
                this.hackAt(enemy, node, dt, dtMs)
            } else if (!hold && this.parkAside(enemy)) {
                // A gun that set up beside a node would read as its guard: it
                // steps aside first, and opens fire from there.
            } else {
                rollSpeed = 0
                enemy.stride += dt * 6
                enemy.attackTimer -= dtMs
                if (enemy.attackTimer <= 0) {
                    // Burst types fire a short volley, then take the full gap.
                    if (enemy.burstLeft <= 0) enemy.burstLeft = enemy.def.burst ?? 1
                    enemy.burstLeft--
                    enemy.attackTimer = enemy.burstLeft > 0 ? 260 : enemy.def.attackMs
                    if (hold) {
                        if (this.strikeDeployable(enemy, hold)) continue
                    } else {
                        this.enemyStrike(enemy)
                        if (enemy.def.kind === 'bomber') continue
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

            // Grid trap: ground units only, and only inside the band.
            if (spikeDps > 0 && !hackerzIsAirborne(enemy.def) && enemy.d < SPIKE_BAND) {
                this.damageEnemy(enemy, spikeDps * dt, 'kinetic', false, false, false, false)
                if (enemy.hp <= 0) {
                    this.killEnemy(i, 1)
                    continue
                }
                if (randomChance(dt * 4)) {
                    this.particles.burst(this.enemyWorld(enemy, 4, _v), AMBER, 4, 6, { size: 0.18, life: 0.25 })
                }
            }

            // Held ground bites: anything that has pushed down into the blue
            // takes a steady tick of damage for as long as it stays there.
            // Behind a shield wall the ground's bite does not reach.
            if (this.running && !this.purging && this.inHeldGround(enemy) && !this.isSheltered(enemy)) {
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
                    this.particles.burst(this.enemyWorld(enemy, 3, _v), CYAN, 4, 5, { size: 0.18, life: 0.3 })
                    if (enemy.hp <= 0) {
                        this.killEnemy(i, 1)
                        continue
                    }
                }
            } else {
                enemy.zoneTick = 0
            }
            this.redGround(enemy, dtMs)

            if (hackerzIsAirborne(enemy.def)) enemy.hover += dt * 2.4
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
            if (this.boardLagMs > 0) continue

            this.updateShieldSheen(enemy, dt)
            // Riders snap round corners like a light cycle (turned in `ride`); flyers face the fence.
            enemy.rig.root.rotation.y = enemy.yaw
            enemy.rig.body.uniforms.uFlash!.value = enemy.flashMs / 90 * 0.7
            const hidden = this.untouchable(enemy)
            enemy.rig.root.visible = !hidden
            // A hidden unit still disturbs the grid: a faint shimmer where it walks.
            if (hidden && Math.random() < dt * 5) {
                this.particles.emit(this.enemyWorld(enemy, randRange(5, enemy.rig.height * PER_WORLD), _v), _w.set(0, 1.2, 0), enemy.def.hex,
                    { size: 0.16, life: 0.4, gravity: 0, intensity: 1.2 })
            }
            // Rez in: the unit is drawn up out of the grid over its first beat.
            const rez = Math.min(1, enemy.age / 0.35)
            enemy.rig.root.scale.set(1, rez, 1)
            poseRig(enemy.rig, enemy.stride, dt, rollSpeed)
            this.placeEnemy(enemy)
        }

        this.separate(dt)
    }

    // ─── Bosses ──────────────────────────────────────────────────────────────

    private updateBoss(enemy: EnemyEntity, dt: number, dtMs: number) {
        if (enemy.decoy) return
        switch (enemy.def.id) {
            case 'titan': this.updateRootkit(enemy, dt, dtMs); break
            case 'leviathan': this.updateBlackIce(enemy, dtMs); break
            case 'zeroday': this.updateZeroDay(enemy, dt); break
        }
    }

    /**
     * ROOTKIT goes to ground every few seconds while it is still far out: gone
     * from sight and from every gun, moving faster, its route given away only by
     * red surges running through the traces, until it erupts somewhere else.
     */
    private updateRootkit(enemy: EnemyEntity, dt: number, dtMs: number) {
        if (enemy.burrowMs > 0) {
            enemy.burrowMs = Math.max(0, enemy.burrowMs - dtMs)
            enemy.u = clamp(enemy.u + Math.sin(enemy.age * 1.6) * dt * 90, -FIELD_HALF_WIDTH + 60, FIELD_HALF_WIDTH - 60)
            if (Math.random() < dt * 5) {
                const at = fieldToWorld(enemy.u, enemy.d, 0, _v)
                this.view?.addSurge(at.x, at.z, enemy.def.hex, 0.8)
            }
            if (enemy.burrowMs === 0) {
                // It erupts onto the nearest data line and rides on from there.
                this.attachToNetwork(enemy)
                enemy.age = 0
                const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
                this.transient?.ring(at, enemy.def.hex, 9, 0.5)
                this.particles.burst(at, enemy.def.hex, 50, 12, { size: 0.35, life: 0.7 })
                this.addShake(8)
            }
            return
        }
        enemy.bossTimer -= dtMs
        if (enemy.bossTimer > 0 || enemy.d < enemy.standoff + 220) return
        enemy.bossTimer = 6000
        enemy.burrowMs = 2600
        const at = fieldToWorld(enemy.u, enemy.d, 0.2, new THREE.Vector3())
        this.transient?.ring(at, enemy.def.hex, 7, 0.45)
        this.particles.burst(at, enemy.def.hex, 40, 10, { size: 0.3, life: 0.6 })
        this.overlay.floatText(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD, _v), 'BURROWING', enemy.def.hex, 1.2)
        if (this.target === enemy) this.target = null
    }

    /** BLACK ICE freezes one of your turrets at a time; a click on it thaws it. */
    private updateBlackIce(enemy: EnemyEntity, dtMs: number) {
        enemy.bossTimer -= dtMs
        if (enemy.bossTimer > 0) return
        enemy.bossTimer = 7000
        const warm = this.turrets.filter(m => m.frozenMs <= 0)
        if (!warm.length) return
        const mount = warm[Math.floor(Math.random() * warm.length)]!
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
        const from = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.7, new THREE.Vector3())
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
            const at = this.enemyWorld(enemy, randRange(0.3, 0.9) * enemy.rig.height * PER_WORLD, new THREE.Vector3())
            at.x += randRange(-0.6, 0.6)
            this.particles.emit(at, _w.set(randRange(-0.4, 0.4), -0.5, randRange(-0.4, 0.4)), 0x86efac,
                { size: 0.2, life: 0.9, gravity: 3, drag: 0.5, intensity: 2.2 })
        }
        const threshold = 1 - 0.25 * (enemy.splits + 1)
        if (enemy.splits >= 3 || enemy.hp / enemy.maxHp > threshold) return
        enemy.splits++
        const decoys = [this.spawnDecoy(enemy, -1), this.spawnDecoy(enemy, 1)]
        // Swap places with one copy, so the player has to find the tell again.
        const swap = decoys[Math.random() < 0.5 ? 0 : 1]!
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
        const at = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.transient?.ring(at, enemy.def.hex, 10, 0.5)
        this.overlay.banner('ZERO DAY FORKED', enemy.def.hex, 'find the one that bleeds data')
        this.addShake(10)
    }

    private spawnDecoy(real: EnemyEntity, side: number): EnemyEntity {
        const rig = buildRig(real.def.id, real.def.hex, real.rig.height)
        this.fieldRoot.add(rig.root)
        const decoy: EnemyEntity = {
            ...real,
            rig,
            route: null,
            redShield: false,
            recovering: false,
            u: clamp(real.u + side * randRange(110, 170), -FIELD_HALF_WIDTH + 40, FIELD_HALF_WIDTH - 40),
            d: real.d + randRange(-50, 50),
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
        this.placeEnemy(decoy)
        this.enemies.push(decoy)
        return decoy
    }

    /**
     * Pushes overlapping enemies apart. Without it a wave stacks into a single
     * column at the wall and reads as one enemy taking sixty hits.
     */
    private separate(dt: number) {
        for (let i = 0; i < this.enemies.length; i++) {
            const a = this.enemies[i] as EnemyEntity
            for (let j = i + 1; j < this.enemies.length; j++) {
                const b = this.enemies[j] as EnemyEntity
                const gap = (a.def.height + b.def.height) * 0.16 + 6
                const du = b.u - a.u
                const dd = b.d - a.d
                if (Math.abs(du) >= gap || Math.abs(dd) >= gap) continue
                const distance = Math.hypot(du, dd)
                if (distance >= gap) continue
                const push = (gap - distance) * CROWD_PUSH * dt * 0.02
                // Riders stay on their lines: two on one straight run down the
                // same line queue along it, the one behind giving way (never back
                // past its corner); anything else just passes.
                const aRides = this.ridesNetwork(a)
                const bRides = this.ridesNetwork(b)
                if (aRides || bRides) {
                    if (aRides && bRides && Math.abs(a.u - b.u) < 0.5) {
                        const back = a.d > b.d ? a : b
                        const from = back.route?.[back.routeSeg]
                        const to = back.route?.[back.routeSeg + 1]
                        if (from && to && segmentDirection(from, to) === 'down') back.d = Math.min(from.d, back.d + push * 0.5)
                    }
                    continue
                }
                // Mostly sideways: crowding should widen the front, not slow it.
                const nu = distance === 0 ? (i % 2 ? 1 : -1) : du / distance
                const nd = distance === 0 ? 0 : dd / distance * 0.35
                a.u = clamp(a.u - push * nu, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH)
                b.u = clamp(b.u + push * nu, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH)
                if (a.d > a.standoff) a.d -= push * nd
                if (b.d > b.standoff) b.d += push * nd
            }
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
        this.deployables?.strike(hold.target, damage)
        return false
    }

    /** What an enemy does when it reaches its stopping distance. */
    private enemyStrike(enemy: EnemyEntity) {
        const damage = enemy.damage * this.chipBuff(enemy)
        switch (enemy.def.kind) {
            case 'ranged': {
                const heavy = enemy.def.id === 'artillery'
                const originY = enemy.altitude + enemy.rig.height * PER_WORLD * 0.75
                const speed = heavy ? SPIT_SPEED * 1.5 : SPIT_SPEED
                const flightTime = Math.max(0.35, enemy.d / speed)
                const mesh = makeSpit(enemy.def.hex, heavy)
                this.fieldRoot.add(mesh)
                this.spits.push({
                    mesh,
                    u: enemy.u,
                    d: enemy.d,
                    y: originY,
                    vd: -enemy.d / flightTime,
                    vy: (WALL_HIT_Y - originY) / flightTime + 0.5 * SPIT_GRAVITY * flightTime,
                    damage,
                    hex: enemy.def.hex,
                    heavy
                })
                this.transient?.flash(fieldToWorld(enemy.u, enemy.d, originY * FIELD_SCALE, _v), enemy.def.hex, heavy ? 0.9 : 0.5)
                break
            }
            case 'bomber': {
                this.damageWall(damage, enemy.u)
                const at = this.enemyWorld(enemy, 10, _v)
                this.transient?.flash(at, enemy.def.hex, 2.6, 0.25)
                this.transient?.ring(at, enemy.def.hex, 9, 0.45)
                this.particles.burst(at, enemy.def.hex, 30, 16, { size: 0.35, life: 0.7 })
                this.addShake(14)
                this.callbacks.onNotice('A sapper reached the wall.', 'bad')
                this.sysLog.sapperHit(Math.floor((enemy.u + FIELD_HALF_WIDTH) / 100) + 1, this.integrityPercent())
                const index = this.enemies.indexOf(enemy)
                if (index >= 0) this.removeEnemy(index)
                break
            }
            default: {
                // A cloaked unit has to drop its cloak to strike.
                if (enemy.def.cloaked && !enemy.decloaked) {
                    enemy.decloaked = true
                    this.particles.burst(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, _v), enemy.def.hex, 14, 6, { size: 0.24, life: 0.4 })
                }
                this.damageWall(damage, enemy.u)
                this.particles.burst(fieldToWorld(enemy.u, 4, FENCE_HEIGHT * 0.5, _v), enemy.def.hex, 5, 8, { size: 0.2, life: 0.3 })
                break
            }
        }
    }

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
            this.setRedShield(enemy, false)
            enemy.rig.body.uniforms.uShieldHit!.value = 1
            const at = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
            this.particles.burst(at, 0xff3b3b, 14, 7, { size: 0.24, life: 0.35 })
            if (showNumber) this.overlay.floatText(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'BLOCKED', 0xff6b6b, 0.95)
            if (flash) enemy.flashMs = 90
            return
        }
        const bonus = hackerzTypeMultiplier(damageType, enemy.armored)
        const dealt = amount * bonus
        enemy.hp -= dealt
        if (flash) enemy.flashMs = 90
        if (showNumber) {
            const effective = bonus > 1
            this.overlay.floatText(
                this.enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v),
                crit ? `${Math.round(dealt)}!` : effective ? `${Math.round(dealt)}+` : `${Math.round(dealt)}`,
                crit ? 0xfde047 : HACKERZ_TYPE_HEX[damageType],
                crit ? 1.5 : effective ? 1.2 : 0.95
            )
        }
    }

    /** Removes an enemy and pays out. `payout` scales it (the purge pays less). */
    private killEnemy(index: number, payout: number) {
        const enemy = this.enemies[index]
        if (!enemy) return
        // A kill the player earned extends the chain; the purge's sweep does not.
        if (payout >= 1) this.extendChain()
        const credits = Math.round(enemy.bounty * payout * (payout >= 1 ? this.chainMultiplier : 1))
        const coins = Math.round(enemy.coinValue * payout)

        const centre = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.45, new THREE.Vector3())
        // A ZERO DAY copy dies as what it is: a fake, with none of the boss's fanfare.
        const bossDeath = !!enemy.def.boss && !enemy.decoy
        // The purge writes its own summary; only kills the player made get a line.
        if (payout >= 1 && !enemy.decoy) this.sysLog.kill(enemy.def.id, enemy.def.name, bossDeath, !!enemy.def.cloaked)
        if (enemy.decoy) this.overlay.floatText(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD + 20, _v), 'DECOY', 0x94a3b8, 1.2)
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
            this.overlay.floatText(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD + 34, _v), `+${credits}`, LIME, 1.1)
        }
        if (coins > 0) this.dropCoins(enemy, coins)
        if (bossDeath) {
            this.transient?.ring(centre, RED, 30, 0.8)
            this.view?.flash(0xffffff, 0.35)
            this.addShake(18)
            this.callbacks.onNotice(`${enemy.def.name} purged.`, 'good')
        }

        this.removeEnemy(index, true)
        this.callbacks.onSound?.(bossDeath ? 'boss-death' : 'enemy-death')
        this.waveKills++
        this.totalKills++
        if (credits > 0) {
            this.waveCredits += credits
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
        this.terminals?.close(enemy)
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

    // ─── Coins ───────────────────────────────────────────────────────────────

    /**
     * Sheds an enemy's coin value as physical coins that fly to the wall. Split
     * across a few discs so a boss reads as a payday, but capped hard.
     */
    private dropCoins(enemy: EnemyEntity, total: number) {
        const count = enemy.def.boss ? 7 : total > 400 ? 3 : total > 80 ? 2 : 1
        const share = Math.floor(total / count)
        for (let i = 0; i < count; i++) {
            // The last coin carries the rounding remainder, so the drop always
            // banks exactly what the kill was worth.
            const value = i === count - 1 ? total - share * (count - 1) : share
            const mesh = makeCoin(enemy.def.boss ? 1.5 : 1)
            const from = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * randRange(0.3, 0.8), new THREE.Vector3())
            from.x += randRange(-0.6, 0.6)
            mesh.position.copy(from)
            this.fieldRoot.add(mesh)
            this.coins.push({ mesh, from, apex: Math.max(from.y, COIN_BANK.y) + randRange(3, 7), t: -i * 0.12, value })
        }
    }

    private updateCoins(dtMs: number) {
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const coin = this.coins[i] as CoinEntity
            coin.t += dtMs / COIN_FLIGHT_MS
            if (coin.t < 0) continue
            if (coin.t >= 1) {
                this.bankCoin(coin)
                this.coins.splice(i, 1)
                continue
            }
            // Quadratic bezier through the apex — one lerp pair, no physics.
            const t = coin.t
            const inv = 1 - t
            const p = coin.mesh.position
            p.x = inv * inv * coin.from.x + 2 * inv * t * ((coin.from.x + COIN_BANK.x) / 2) + t * t * COIN_BANK.x
            p.z = inv * inv * coin.from.z + 2 * inv * t * ((coin.from.z + COIN_BANK.z) / 2) + t * t * COIN_BANK.z
            p.y = inv * inv * coin.from.y + 2 * inv * t * coin.apex + t * t * COIN_BANK.y
            coin.mesh.rotation.y = t * Math.PI * 6
        }
    }

    private bankCoin(coin: CoinEntity) {
        coin.mesh.removeFromParent()
        this.particles.burst(COIN_BANK, AMBER, 3, 4, { size: 0.2, life: 0.3, gravity: 0 })
        this.waveCoins += coin.value
        this.callbacks.onCoins(coin.value)
        this.callbacks.onSound?.('coin-pickup')
    }

    /** Banks everything still in flight — called when a wave settles. */
    private flushCoins() {
        for (const coin of this.coins) this.bankCoin(coin)
        this.coins = []
    }

    // ─── Player weapon ───────────────────────────────────────────────────────

    /**
     * Where the rail is pointing this frame: the locked target, else the spot a
     * lag spike left it firing at (while the button stays down), else the cursor.
     */
    private railAim() {
        const target = this.target
        if (target) return { u: target.u, d: target.d, y: this.enemyCentreY(target) }
        if (this.lockSpot && this.holding) return this.lockSpot
        return { u: this.aimU, d: this.aimD, y: 0 }
    }

    private updateRail(dt: number) {
        const rig = this.railRig
        if (!rig) return
        const aim = this.railAim()
        const desired = Math.atan2((aim.u - RAIL_U) * FIELD_SCALE, -aim.d * FIELD_SCALE - GUN_Z)
        this.railHeading = turnToward(this.railHeading, desired, dt * 14)
        if (rig.yaw) rig.yaw.rotation.y = this.railHeading
        this.railKick += (0 - this.railKick) * Math.min(1, dt * 18)
        if (rig.barrel) rig.barrel.position.z = rig.barrelRestZ - this.railKick
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

        const aim = this.railAim()
        // Lead the target by its walking speed over the round's flight, once —
        // a locked shot should land, but a pushed or turning target can still slip it.
        let aimD = aim.d
        if (this.target && weapon.speed > 0) {
            const flight = Math.hypot(aim.u - RAIL_U, aim.d - MUZZLE_D) / weapon.speed
            if (this.target.d > this.target.standoff) aimD = Math.max(this.target.standoff, aim.d - this.target.speed * flight)
        }
        const angle = Math.atan2(aim.u - RAIL_U, aimD - MUZZLE_D)

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
            this.spawnBullet(RAIL_U, MUZZLE_D, MUZZLE_Y, angle + spread, spec, aim.y, this.target)
        }

        const muzzle = fieldToWorld(RAIL_U + Math.sin(angle) * 36, MUZZLE_D + Math.cos(angle) * 36, MUZZLE_Y * FIELD_SCALE, _v)
        this.transient?.flash(muzzle, spec.hex, weapon.projectile === 'slug' ? 0.9 : 0.55)
        this.railKick = weapon.projectile === 'slug' ? 0.5 : 0.28
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
            bullet.lostAt = randRange(0.25, 0.85) * span
        }
        this.orientBullet(bullet)
        this.bullets.push(bullet)
    }

    private orientBullet(bullet: BulletEntity) {
        const p = fieldToWorld(bullet.u, bullet.d, bullet.y * FIELD_SCALE, bullet.mesh.position)
        _w.set(p.x + bullet.vu * FIELD_SCALE, p.y, p.z - bullet.vd * FIELD_SCALE)
        bullet.mesh.lookAt(_w)
    }

    /** Missiles lock the enemy closest to the wall — the one that matters. */
    private pickHomingTarget(u: number, d: number) {
        let best: EnemyEntity | null = null
        let bestScore = -Infinity
        for (const enemy of this.enemies) {
            if (this.untouchable(enemy)) continue
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

            if (bullet.homing) this.steerMissile(bullet, dt)

            bullet.prevU = bullet.u
            bullet.prevD = bullet.d
            bullet.u += bullet.vu * dt
            bullet.d += bullet.vd * dt
            bullet.flown += Math.hypot(bullet.vu, bullet.vd) * dt
            const toY = bullet.homing && bullet.target ? this.enemyCentreY(bullet.target) : bullet.toY
            bullet.y = bullet.fromY + (toY - bullet.fromY) * Math.min(1, bullet.flown / bullet.span)
            bullet.lifeMs -= dt * 1000
            // Mid lag spike the round flies on, but its picture holds.
            if (this.boardLagMs <= 0) this.orientBullet(bullet)

            if (bullet.lostAt !== undefined && bullet.flown >= bullet.lostAt) {
                const at = fieldToWorld(bullet.u, bullet.d, bullet.y * FIELD_SCALE, new THREE.Vector3())
                this.particles.burst(at, 0xe879f9, 10, 5, { size: 0.24, life: 0.4, gravity: 0 })
                this.overlay.floatText(at, 'LOST', 0xe879f9, 0.8)
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
                this.callbacks.onSound?.('hit-enemy')
                const at = this.enemyWorld(enemy, this.enemyCentreY(enemy) - enemy.altitude, new THREE.Vector3())
                this.particles.burst(at, enemy.def.hex, bullet.crit ? 8 : 4, 9, { size: 0.22, life: 0.3 })
                if (bullet.projectile === 'slug' || bullet.pierce > 0) {
                    this.transient?.beam(fieldToWorld(bullet.prevU, bullet.prevD, bullet.y * FIELD_SCALE, new THREE.Vector3()), at, bullet.hex)
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

    /** Splash from a warhead. The direct target has already been hit. */
    private detonate(bullet: BulletEntity, epicentre: EnemyEntity) {
        const at = fieldToWorld(bullet.u, bullet.d, bullet.y * FIELD_SCALE, new THREE.Vector3())
        this.transient?.ring(fieldToWorld(bullet.u, bullet.d, 0.1, _v), bullet.hex, bullet.splashRadius * FIELD_SCALE * 1.4, 0.38)
        this.transient?.flash(at, bullet.hex, bullet.splashRadius * FIELD_SCALE * 0.5, 0.18)
        this.particles.burst(at, bullet.hex, 14, 12, { size: 0.3, life: 0.45 })
        this.addShake(3)
        for (let e = this.enemies.length - 1; e >= 0; e--) {
            const enemy = this.enemies[e] as EnemyEntity
            // Hackers shrug off splash too: picking them off takes a direct hit.
            if (enemy === epicentre || bullet.hit.has(enemy) || this.untouchable(enemy) || enemy.def.id === HACKERZ_HACKER_ID) continue
            if (Math.hypot(enemy.u - bullet.u, enemy.d - bullet.d) > bullet.splashRadius) continue
            this.damageEnemy(enemy, bullet.splashDamage, bullet.damageType, true, false, false)
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
                if (bullet.hit.has(enemy) || this.untouchable(enemy) || enemy.def.id === HACKERZ_HACKER_ID) continue
                const d = Math.hypot(enemy.u - from.u, enemy.d - from.d)
                if (d < bestDist) {
                    bestDist = d
                    best = enemy
                }
            }
            if (!best) return
            this.transient?.bolt(
                this.enemyWorld(from, this.enemyCentreY(from) - from.altitude, new THREE.Vector3()),
                this.enemyWorld(best, this.enemyCentreY(best) - best.altitude, new THREE.Vector3()),
                bullet.hex
            )
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
            const target = this.pickTurretTarget(mount)
            // Turrets aim at what they can see — during a packet-loss spike,
            // the stale picture rather than where the unit really is.
            const seen = target ? this.seenAt(target) : null
            if (target && seen) {
                const desired = Math.atan2((seen.u - mount.u) * FIELD_SCALE, -seen.d * FIELD_SCALE - mount.z)
                mount.heading = turnToward(mount.heading, desired, dt * 10)
            }
            if (mount.rig.yaw) mount.rig.yaw.rotation.y = mount.heading
            for (const spinner of mount.rig.spins) spinner.rotation.y += dt * 1.5

            if (!frozen) {
                mount.kick += (0 - mount.kick) * Math.min(1, dtMs / 60)
                if (mount.rig.barrel) mount.rig.barrel.position.z = mount.rig.barrelRestZ - mount.kick
            }

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
                homing: isMissile && this.boardLagMs <= 0,
                chain: 0,
                chainFalloff: 0,
                speed: isMissile ? 780 : 1700,
                hex: mount.runtime.hex,
                projectile: isMissile ? 'missile' : mount.runtime.pierce > 0 ? 'slug' : 'rail',
                crit: false,
                fromTurret: true
            }, this.enemyCentreY(target), target)
            const muzzle = fieldToWorld(mount.u + Math.sin(angle) * 30, mount.muzzleD + Math.cos(angle) * 30, (MUZZLE_Y * 0.92 + mount.muzzleLift) * FIELD_SCALE, _v)
            this.transient?.flash(muzzle, mount.runtime.hex, 0.35)
            mount.kick = 0.22
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
        let bestKey: number[] | null = null
        for (const enemy of this.enemies) {
            if (enemy.d > mount.runtime.range || this.untouchable(enemy)) continue
            const off = Math.abs(enemy.u - mount.u)
            const tier = off <= TURRET_LANE ? 0 : off <= TURRET_LANE * 3 ? 1 : 2
            const key = [enemy.def.id === HACKERZ_HACKER_ID ? 1 : 0, tier, -enemy.maxHp, enemy.d]
            if (!bestKey || isBefore(key, bestKey)) {
                bestKey = key
                best = enemy
            }
        }
        return best
    }

    // ─── Enemy projectiles ───────────────────────────────────────────────────

    private updateSpits(dt: number) {
        for (let i = this.spits.length - 1; i >= 0; i--) {
            const spit = this.spits[i] as SpitEntity
            spit.vy -= SPIT_GRAVITY * dt
            spit.d += spit.vd * dt
            spit.y += spit.vy * dt
            if (this.boardLagMs <= 0) {
                fieldToWorld(spit.u, spit.d, spit.y * FIELD_SCALE, spit.mesh.position)
                spit.mesh.rotation.y += dt * 8
            }

            const landed = spit.d <= 0
            if (!landed && spit.y > -20) continue
            if (landed) {
                this.damageWall(spit.damage, spit.u)
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
     * ROOTKIT underground, or anything out in the dark during a BLACKOUT. Nothing
     * targets, hits or splashes an untouchable unit.
     */
    private untouchable(enemy: EnemyEntity) {
        if (enemy.burrowMs > 0) return true
        if (this.bonus === 'blackout' && this.running && enemy.d > BLACKOUT_LIGHT_D && enemy.revealMs <= 0) return true
        // Inside a dark zone only a ping shows what is there.
        if (enemy.revealMs <= 0 && this.inDarkZone(enemy.u, enemy.d)) return true
        return !!enemy.def.cloaked && !enemy.decloaked && enemy.revealMs <= 0
    }

    /**
     * Right click: a radar ring sweeps out from the rail and lights every contact
     * as the wavefront reaches it; the highlight fades as the wave moves on.
     */
    private firePing() {
        if (!this.running || this.purging || this.paused || this.pingCharge < PING_COOLDOWN_MS) return
        this.pingCharge = 0
        this.emitPing()
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

    // ─── Bastion ─────────────────────────────────────────────────────────────

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
        return this.running && !this.purging && enemy.def.id === HACKERZ_HACKER_ID && !enemy.decoy
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
            if (enemy.recovering) return this.zoneOf(enemy.u, enemy.d) === 'theirs' ? 'recover' : 'retreat'
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
        return !hackerzIsAirborne(enemy.def) && enemy.burrowMs <= 0
            && (!this.allNodesTaken || (this.bonus === 'packetloss' && !this.isHeavy(enemy.def)))
    }

    /** Whether a rider stands on the segment of its route it thinks it is on. */
    private onRoute(enemy: EnemyEntity) {
        const a = enemy.route?.[enemy.routeSeg]
        if (!a) return false
        const b = enemy.route![enemy.routeSeg + 1] ?? a
        return enemy.u >= Math.min(a.u, b.u) - 1 && enemy.u <= Math.max(a.u, b.u) + 1
            && enemy.d >= Math.min(a.d, b.d) - 1 && enemy.d <= Math.max(a.d, b.d) + 1
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
        const from = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        if (enemy.hacking) this.stopHacking(enemy)
        enemy.u = to.u
        enemy.d = to.d
        enemy.route = to.trace.points
        enemy.routeSeg = to.seg
        enemy.routeTo = to.trace.to
        enemy.routeFrom = to.trace.from
        enemy.zapCooldown = ZAP_COOLDOWN_MS
        const landed = this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, new THREE.Vector3())
        this.transient?.bolt(from, landed, enemy.def.hex)
        this.particles.burst(from, enemy.def.hex, 12, 6, { size: 0.24, life: 0.35 })
        this.particles.burst(landed, enemy.def.hex, 16, 7, { size: 0.26, life: 0.4 })
        this.placeEnemy(enemy)
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

    /** A new ground unit comes out of one of the portal's sockets and takes a line from it. */
    private enterFromPortal(enemy: EnemyEntity) {
        const sources = this.network.nodes.map((node, index) => ({ node, index })).filter(s => s.node.kind === 'source')
        if (!sources.length) return
        const { node, index } = sources[Math.floor(randomFloat() * sources.length)]!
        enemy.u = node.u
        enemy.d = Math.max(enemy.d, node.d)
        enemy.route = [{ u: node.u, d: enemy.d }, { u: node.u, d: node.d }]
        enemy.routeSeg = 0
        enemy.routeTo = index
        enemy.routeFrom = index
    }

    /** Drops a unit onto the nearest point of the nearest line, riding on toward that line's end. */
    private attachToNetwork(enemy: EnemyEntity) {
        const on = nearestOnNetwork(this.network, enemy.u, enemy.d)
        if (!on) {
            enemy.route = null
            enemy.routeTo = -1
            return
        }
        enemy.u = on.u
        enemy.d = on.d
        enemy.route = on.trace.points
        enemy.routeSeg = on.seg
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
        const keepOut = this.keepsOutOfBlue(enemy) && this.zoneOf(enemy.u, enemy.d) !== 'held'
        // A boosted rider leaves a thin red trail, so the fast lane reads as one.
        if (boost > 1 && Math.random() < dt * 14) {
            this.particles.emit(this.enemyWorld(enemy, 3, _v), _w.set(0, 0.4, 0), RED, { size: 0.16, life: 0.35, gravity: 0 })
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
            const next = enemy.route[enemy.routeSeg + 1]
            if (!next) {
                this.chooseNext(enemy)
                continue
            }
            const du = next.u - enemy.u
            const dd = next.d - enemy.d
            const length = Math.abs(du) + Math.abs(dd)
            if (length < 0.01) {
                enemy.u = next.u
                enemy.d = next.d
                enemy.routeSeg++
                continue
            }
            const across = Math.abs(du) > Math.abs(dd)
            // Lines run down toward the fence; only a hacker's detour climbs one.
            const down = !across && dd < 0
            facing = across ? (du > 0 ? YAW_RIGHT : YAW_LEFT) : down ? YAW_DOWN : YAW_UP
            if (budget <= 1e-4) break
            let step = Math.min(length, budget)
            // Never run down past a stop: the fence's standoff, or a proxy wall.
            if (down) step = Math.min(step, Math.max(0, enemy.d - goal.stopD))
            if (step <= 0) {
                arrived = true
                break
            }
            if (keepOut) {
                const nu = across ? enemy.u + Math.sign(du) * step : enemy.u
                const nd = across ? enemy.d : enemy.d + Math.sign(dd) * step
                if (this.zoneOf(nu, nd) === 'held') break
            }
            if (across) enemy.u += Math.sign(du) * step
            else enemy.d += Math.sign(dd) * step
            budget -= step
            moved += step
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
        if (this.keepsOutOfBlue(enemy) && this.zoneOf(enemy.u, enemy.d) !== 'held'
            && this.zoneOf(enemy.u, enemy.d - step) === 'held') return { moved: 0, arrived: false }
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
        const surge = this.lagCatchUpMs > 0 ? LAG_CATCH_UP_SPEED : 1
        const taken = this.pathChips?.chips.some(chip => chip.state === 'hacked')
        if (!taken || enemy.burrowMs > 0) return surge
        return (this.zoneOf(enemy.u, enemy.d) === 'theirs' ? THEIR_GROUND_SPEED : 1) * surge
    }

    /** Whether a unit stands in the firewall's own blue ground. */
    private inHeldGround(enemy: EnemyEntity) {
        if (enemy.burrowMs > 0) return false
        return this.zoneOf(enemy.u, enemy.d) === 'held'
    }

    /**
     * Red ground looks after its own: anything standing in it grows a shield
     * that eats the next hit (and comes back a few seconds after it pops), and
     * heals a little every tick. Both belong to the ground: a unit that steps
     * out of red loses its shield there and then.
     */
    private redGround(enemy: EnemyEntity, dtMs: number) {
        const live = this.running && !this.purging && enemy.burrowMs <= 0
        const inRed = live && this.zoneOf(enemy.u, enemy.d) === 'theirs'
        // Sheltering behind a shield bearer heals as red ground does, wherever the wall stands.
        const sheltered = live && !inRed && this.isSheltered(enemy)
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
        const chips = this.pathChips
        const guarding = !!chips && !chips.locked && chips.chips.some(chip => chip.state === 'hacked'
            && Math.hypot(chip.u - enemy.u, chip.d - enemy.d) <= GUARD_RADIUS)
        const share = (enemy.def.boss ? RED_HEAL_BOSS_SHARE : RED_HEAL_SHARE) * (guarding ? 2 : 1)
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * share)
        if (!this.untouchable(enemy)) {
            this.particles.emit(this.enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.6, _v), _w.set(0, 2.4, 0), RED,
                { size: 0.2, life: 0.5, gravity: 0 })
        }
    }

    /**
     * The shield is a sheen on the unit's own plating (see the body shader's
     * `uShield`), eased in and out each frame in `updateShieldSheen`.
     */
    private setRedShield(enemy: EnemyEntity, on: boolean) {
        enemy.redShield = on
        if (!on) enemy.redShieldMs = RED_SHIELD_RECHARGE_MS
    }

    /** Eases a unit's shield sheen toward on or off, and lets the break flare fade. */
    private updateShieldSheen(enemy: EnemyEntity, dt: number) {
        const uniforms = enemy.rig.body.uniforms
        const sheen = uniforms.uShield!
        sheen.value += ((enemy.redShield ? 1 : 0) - sheen.value) * Math.min(1, dt * 6)
        const hit = uniforms.uShieldHit!
        if (hit.value > 0) hit.value = Math.max(0, hit.value - dt * 3)
    }

    /** A unit in reach of a node hacks it: a terminal opens beside it and fires pulses into the node. */
    private hackAt(enemy: EnemyEntity, node: PathChip, dt: number, dtMs: number) {
        enemy.stride += dt * 3
        const terminal = this.terminals?.open(enemy)
        enemy.hacking = true
        if (terminal) {
            // The panel floats above the unit, staggered by its reach so a
            // queue's terminals do not stack into one.
            this.enemyWorld(enemy, enemy.rig.height * PER_WORLD + 40 + enemy.hackReach * 24, terminal.position)
            terminal.position.x += (enemy.u >= node.u ? 1 : -1) * 1.2
            terminal.visible = enemy.rig.root.visible
        }
        enemy.pulseTimer -= dtMs
        if (enemy.pulseTimer <= 0) {
            enemy.pulseTimer = HACK_PULSE_MS * (0.85 + randomFloat() * 0.3)
            if (terminal?.visible) this.fireHackPulse(node, terminal.position)
            else this.landPulse(node)
        }
        return 0
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
            pulse.t += dt / HACK_PULSE_FLIGHT
            if (pulse.t >= 1) {
                pulse.mesh.removeFromParent()
                this.hackPulses.splice(i, 1)
                this.particles.burst(pulse.to, 0xff3b3b, 4, 5, { size: 0.18, life: 0.25 })
                this.landPulse(pulse.chip)
                continue
            }
            // A shallow arc, spinning as it goes.
            pulse.mesh.position.lerpVectors(pulse.from, pulse.to, pulse.t)
            pulse.mesh.position.y += Math.sin(pulse.t * Math.PI) * 0.8
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
            if (!chips.hit(chip)) return true
            const reward = 15 + this.wave * 8
            this.waveCredits += reward
            this.callbacks.onCredits(reward, 'kill')
            this.view?.addSurge(at.x, at.z, CYAN, 1.6)
            this.transient?.ring(at, CYAN, 6, 0.55)
            this.particles.burst(at, CYAN, 34, 10, { size: 0.32, life: 0.7 })
            this.overlay.floatText(at, `RECLAIMED +${reward}`, CYAN, 1.3)
            this.sysLog.chipReclaimed(chip.id)
            this.callbacks.onSound?.('coin-pickup')
            return true
        }
        return false
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
        const zone = this.zoneOf(u, d)
        return zone === 'held' ? LINE_PULSE_FADE.held : zone === 'contested' ? LINE_PULSE_FADE.contested : LINE_PULSE_FADE.theirs
    }

    // ─── Exploit chain ───────────────────────────────────────────────────────

    /** ×1 at no chain, +2% a link, capped at ×2 so a long chain is a bonus rather than the economy. */
    private get chainMultiplier() {
        return 1 + Math.min(this.chain, 50) * 0.02
    }

    private extendChain() {
        this.chain++
        if (CHAIN_MILESTONES.includes(this.chain)) {
            this.sysLog.chain(this.chain)
            this.overlay.banner(`EXPLOIT CHAIN ×${this.chain}`, LIME, `credits ×${this.chainMultiplier.toFixed(2)}`)
            this.callbacks.onSound?.('wave-start')
            if (this.railRig) this.particles.burst(this.railRig.root.position, LIME, 40, 9, { size: 0.3, life: 0.7 })
        }
        this.emitChain()
    }

    /** A leak shatters the chain: the loss is what makes holding it worth something. */
    private breakChain() {
        if (this.chain >= 5) {
            this.overlay.floatText(fieldToWorld(RAIL_U, 0, FENCE_HEIGHT + 3, _v), `CHAIN BROKEN · ${this.chain}`, RED, 1.4)
            if (this.railRig) this.particles.burst(this.railRig.root.position, RED, 24, 7, { size: 0.26, life: 0.5 })
        }
        this.chain = 0
        this.emitChain()
    }

    private emitChain() {
        this.callbacks.onChain?.(this.chain, this.chainMultiplier)
    }

    /** Wall health left, as a whole percentage. */
    private integrityPercent() {
        return this.wallMaxHp > 0 ? Math.round(100 * this.wallHp / this.wallMaxHp) : 100
    }

    private damageWall(amount: number, sourceU: number) {
        if (this.gameOver) return
        this.msSinceWallHit = 0
        this.waveLeaks++
        this.breakChain()

        let remaining = amount
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, remaining)
            this.shield -= absorbed
            remaining -= absorbed
            // The barrier lights up where it was struck, which is the only thing
            // that distinguishes a soaked hit from one the wall took.
            this.shieldHit = Math.min(1, this.shieldHit + (absorbed > 40 ? 0.7 : 0.35))
            this.particles.burst(fieldToWorld(sourceU, 26, 3, _v), 0x67e8f9, 6, 6, { size: 0.25, life: 0.3, gravity: 0 })
            if (this.shield <= 0) {
                this.view?.flash(0x67e8f9, 0.18)
                this.callbacks.onNotice('Barrier collapsed.', 'bad')
            }
        }
        if (remaining > 0) {
            this.wallHp = Math.max(0, this.wallHp - remaining)
            this.wallFlash = Math.min(1, this.wallFlash + 0.15 + remaining / 220)
            this.overlay.floatText(fieldToWorld(sourceU, 0, FENCE_HEIGHT + 1.2, _v), `-${Math.round(remaining)}`, RED)
            this.particles.burst(fieldToWorld(sourceU, 2, FENCE_HEIGHT * 0.6, _v), RED, 4, 7, { size: 0.22, life: 0.35 })
        }
        this.addShake(clamp(amount * 0.16, 1.5, 12))
        this.emitWall()
        this.callbacks.onSound?.('wall-hurt')
        if (remaining > 0) this.sysLog.wallHit(this.integrityPercent())

        if (this.bonus) {
            // A bonus round can be lost, never the run: dropping under the line
            // ends the round on the spot, and the sandbox gives the wall back.
            this.wallHp = Math.max(1, this.wallHp)
            if (!this.bonusFailed && this.wallMaxHp > 0 && this.wallHp / this.wallMaxHp < HACKERZ_BONUS_PASS_INTEGRITY) {
                this.bonusFailed = true
                this.overlay.banner('BONUS FAILED', RED, 'integrity under the line')
                this.view?.flash(RED, 0.3)
                if (this.running && !this.purging) this.beginPurge()
            }
            return
        }
        if (this.wallHp <= 0) this.endRun()
    }

    private updateBastion(dt: number, dtMs: number) {
        const loadout = this.loadout
        if (!loadout) return

        this.msSinceWallHit += dtMs
        this.wallFlash = Math.max(0, this.wallFlash - dt * 2.4)
        this.shieldHit = Math.max(0, this.shieldHit - dt * 2)

        if (this.running && !this.purging) {
            if (loadout.repairPerSec > 0 && this.wallHp < this.wallMaxHp) {
                this.wallHp = Math.min(this.wallMaxHp, this.wallHp + loadout.repairPerSec * dt)
                this.emitWall()
            }
            if (this.shieldMax > 0 && this.shield < this.shieldMax && this.msSinceWallHit > HACKERZ_SHIELD_DELAY_MS) {
                this.shield = Math.min(this.shieldMax, this.shield + loadout.shieldRegenPerSec * dt)
                this.emitWall()
            }
        }
    }

    // ─── Wave end ────────────────────────────────────────────────────────────

    /**
     * The wall flushes the field: a wall of light sweeps out from the wall and
     * takes everything it passes. Survivors still pay out, at a fraction — enough
     * that a wave you barely held is not also a wave you earned nothing from.
     */
    private beginPurge() {
        if (this.purging) return
        this.sysLog.purge(this.enemies.length)
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
    private get pushSpeed() {
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
        // Coins still mid-flight belong to the wave that dropped them.
        this.flushCoins()

        const event = this.bonus
        let passed = false
        if (event) {
            // The sandbox: the wall goes back to how the round found it.
            this.wallHp = this.bonusStartHp
            this.shield = this.bonusStartShield
            this.emitWall()
            passed = !this.bonusFailed
            if (passed && this.waveCredits > 0) {
                const extra = this.waveCredits * (HACKERZ_BONUS_MULTIPLIER - 1)
                this.waveCredits += extra
                this.callbacks.onCredits(extra, 'clear')
                this.overlay.banner(`BONUS ×${HACKERZ_BONUS_MULTIPLIER}`, LIME, `+${extra} credits`)
                this.view?.flash(0xa3e635, 0.3)
                if (this.railRig) this.particles.burst(this.railRig.root.position, LIME, 120, 16, { size: 0.36, life: 1 })
            }
            this.bonus = null
            if (this.pathChips) this.pathChips.locked = false
            this.pathChips?.restore(this.bonusChips)
            this.bonusChips = null
            this.islands = []
        } else {
            const integrity = this.wallMaxHp > 0 ? this.wallHp / this.wallMaxHp : 0
            const clear = hackerzClearBonus(this.wave, integrity)
            this.waveCredits += clear
            this.callbacks.onCredits(clear, 'clear')
        }

        const victory = !event && this.wave >= HACKERZ_MAX_WAVE
        if (victory) {
            this.gameOver = true
            this.overlay.banner('INTRUSION REPELLED', LIME, `${HACKERZ_MAX_WAVE} waves held`)
            this.view?.flash(0xffffff, 0.4)
        }

        this.sysLog.waveEnd(this.wave, this.waveKills)
        this.callbacks.onWaveEnd({
            wave: this.wave,
            kills: this.waveKills,
            credits: this.waveCredits,
            coins: this.waveCoins,
            leaked: this.waveLeaks,
            wallHp: Math.round(this.wallHp),
            wallMaxHp: this.wallMaxHp,
            victory,
            bonus: event,
            passed
        })
        this.callbacks.onSound?.('wave-win')
    }

    private endRun() {
        if (this.gameOver) return
        this.gameOver = true
        this.running = false
        this.purging = false
        this.holding = false
        this.target = null
        this.callbacks.onSound?.('game-over')
        // Coins in the air when the wall fell were still earned.
        this.flushCoins()

        this.view?.flash(RED, 0.6)
        this.overlay.banner('BREACHED', RED, `wave ${this.wave}`)
        this.addShake(22)
        for (let i = 0; i < 6; i++) {
            this.transient?.ring(fieldToWorld(randRange(-400, 400), randRange(0, 60), 1, _v), RED, 8, 0.8)
        }
        this.callbacks.onGameOver({ wave: this.wave, kills: this.totalKills })
    }

    // ─── Housekeeping ────────────────────────────────────────────────────────

    private clearField() {
        while (this.enemies.length) this.removeEnemy(this.enemies.length - 1)
        for (const bullet of this.bullets) bullet.mesh.removeFromParent()
        this.bullets = []
        for (const spit of this.spits) spit.mesh.removeFromParent()
        this.spits = []
        // Dropped without banking: a cleared field is a run that is restarting.
        for (const coin of this.coins) coin.mesh.removeFromParent()
        this.coins = []
        this.particles.clear()
        for (const corpse of this.dying) disposeRig(corpse.rig)
        this.dying = []
        this.view?.clearSurges()
        this.transient?.clear()
        this.overlay.clear()
        this.deployables?.clear()
        this.linePulses?.clear()
        this.clearHacking()
        this.armed = null
        this.bonus = null
        this.bonusChips = null
        if (this.pathChips) this.pathChips.locked = false
        this.target = null
        this.holding = false
        this.shake = 0
        this.wallFlash = 0
    }

    private emitWall() {
        this.callbacks.onWall(Math.round(this.wallHp), this.wallMaxHp, Math.round(this.shield), this.shieldMax)
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

/** An island's radius toward its goal: swelling at `ISLAND_FLOW`, draining a little slower. */
function swell(current: number, goal: number, dt: number) {
    return goal > current
        ? Math.min(goal, current + ISLAND_FLOW * dt)
        : Math.max(goal, current - ISLAND_FLOW * 0.6 * dt)
}

/** Turns `current` toward `target` by at most `step` radians, the short way round. */
function turnToward(current: number, target: number, step: number) {
    let diff = (target - current) % (Math.PI * 2)
    if (diff > Math.PI) diff -= Math.PI * 2
    if (diff < -Math.PI) diff += Math.PI * 2
    return current + clamp(diff, -step, step)
}

/** Whether sort key `a` comes before `b`: compared field by field, lowest first. */
function isBefore(a: number[], b: number[]) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i]! < b[i]!
    }
    return false
}
