import {
    DF_COSTS, DF_EGG_CHARGE, DF_EGG_ROD_TIME, DF_GRENADES, DF_INTERMISSION_SECONDS, DF_MACHINE_TIMES,
    DF_MAX_PERKS, DF_MELEE, DF_PLAYER, DF_POINTS, DF_POWERUP_LIFETIME,
    DF_POWERUP_MAX_PER_ROUND, DF_POWERUP_SECONDS, DF_REVIVE_GRACE, DF_SOLO_SECONDWIND_MAX, dfPapCost
} from '#shared/utils/dead-front/constants'
import type { DfPowerupKind } from '#shared/utils/dead-front/constants'
import {
    DF_BLOATER, DF_BRUTE_CHARGE, DF_ENEMIES, DF_GHOUL_LUNGE, dfBrutesInRound, dfMaxAlive, dfRoundZombieCount,
    dfShamblerGait, dfSpawnInterval, dfSpecialChances, dfZombieBaseHealth
} from '#shared/utils/dead-front/enemies'
import { DF_BARRICADE_PLANKS, DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import type { DfBarricade, DfInteractable, DfMapDef, DfSpot } from '#shared/utils/dead-front/map'
import { DF_PERKS, dfComputeEffects } from '#shared/utils/dead-front/perks'
import { dfBodyFits, dfBuildCollision, dfGroundHeight, dfLineOfSight, dfMoveBody, dfRampHeight, dfRaycast } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import { DF_FLAG } from '#shared/utils/dead-front/protocol'
import type {
    DfBoxState, DfDevOp, DfEggState, DfEndPlayer, DfEvent, DfHeldWeapon, DfPapState, DfPlayerSnap,
    DfShotHit, DfSnapshot, DfZombieSnap
} from '#shared/utils/dead-front/protocol'
import { DF_WEAPONS, dfBoxPool, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DF_EGG_STEPS } from '#shared/utils/dead-front/types'
import type {
    DfEnemyType, DfHitZone, DfMatchResult, DfPerkId, DfWeaponId, Vec3
} from '#shared/utils/dead-front/types'
import { randomChance, randomFloat, randomInt, randomPick } from '#shared/utils/random'
import { dfArcAim, dfArcBody, dfFlameHitPays } from '#shared/utils/dead-front/combat'
import { DfNav } from './nav'
import { DfArsenal } from './salvage'
import { dfBoxKitRoll, dfBoxRarityRoll, dfClampRarity, dfRarityApplies } from '#shared/utils/dead-front/rarity'
import type { DfRarity } from '#shared/utils/dead-front/rarity'
import { DfSpecials } from './specials'
import {
    dfBoxChoices, dfBoxRoll, dfBulletDamage, dfClaimSane, dfEggAdvance, dfEggTick, dfKillClaimHonoured, dfKillPoints,
    dfRayPointApproach, dfScalePoints
} from './rules'
import type { DfEggAction } from './rules'
import type {
    DfPlayerSetup, SimGas, SimPapJob, SimPlayer, SimPowerup, SimProjectile, SimWeapon, SimZombie, SimZombieState
} from './sim-types'

// The authoritative Dead Front match: rounds, zombies, shots, projectiles,
// interactions, downs and the easter egg. No sockets in here: the match layer
// (match.ts) feeds it client messages and ships its snapshots, so the whole
// game is testable by calling handlers and `step(dt)`.

type KillWeapon = DfWeaponId | 'knife' | 'grenade' | 'arc' | 'trap' | 'sentry'

interface DamageSource {
    weapon: KillWeapon
    /** Weapon id credited with the kill for weapon XP. */
    credit: DfWeaponId | null
    explosive?: boolean
    melee?: boolean
    /** Where the hit landed (for the hit event); defaults to the zombie's chest. */
    at?: Vec3
    /** The shooter's client predicted this hit kills (see `dfKillClaimHonoured`). */
    claimKill?: boolean
    /** False: a non-lethal hit pays no +10 (a flamethrower between its paying ticks). */
    hitPoints?: boolean
}

export interface DfSimOptions {
    map?: DfMapDef
    /** Wall clock in seconds, used for input rate checks. */
    now?: () => number
    /** Seconds before round 1. */
    startDelay?: number
}

const GRAVITY = 16
const ZOMBIE_STEP = 0.6
const CLIMB_TIME = 1.3
/** Alive zombies (with nothing left to spawn) at which the walkers start running. */
const DF_LAST_RUSH = 2
const RISE_TIME = 1.7
const SWAP_TIME = 0.55
const USE_TOLERANCE = 0.9
const REVIVE_REACH = 2.6
const SELF_REVIVE_DELAY = 3
const REPAIR_INTERVAL = 0.5
const STAGGER_TIME = 0.7
const ARC_CHAIN_RANGE = 6
const MAX_FIRE_TOKENS = 2.5
/** Seconds of shots the fire-rate bucket banks, so jittery packets from fast guns are never refused. */
const FIRE_BURST_SECONDS = 0.35
/** Zombie swipes connect within this much of attack range + the player's radius (a step back makes them miss). */
const SWIPE_SLACK = 0.15
/**
 * A swing waits out its target's lag before it lands: their round trip plus the
 * client's zombie interpolation, so a step back made on their screen as the arm
 * came down has reached the server by then. Capped so a bad line can't dodge forever.
 */
const SWING_LAG_EXTRA = 0.05
const SWING_LAG_MAX = 0.3
/** A landing swing waits for movement reports fresher than this (s), up to SWING_HOLD_MAX more. */
const SWING_FRESH_INPUT = 0.15
const SWING_HOLD_MAX = 0.45
/** Seconds without movement reports after which the server no longer knows where a player is. */
export const DF_STALE_INPUT = 0.35
/** Past this the player isn't lagging but gone (a tabbed-out co-op player): zombies land again. */
const STALE_INPUT_MAX = 3
/** A stall within this long of the previous one gets no lag shield (a line that keeps stalling, or a client that stalls on purpose). */
const STALL_SHIELD_COOLDOWN = 10
/** Players further than this, or out of sight, don't see a stuck zombie being recycled. */
const UNSEEN_RANGE = 32
/** Chance each mystery box roll ends with the box moving to another spot (roll refunded). */
export const DF_BOX_MOVE_CHANCE = 0.1
const POWERUP_KINDS: DfPowerupKind[] = ['maxammo', 'double', 'insta', 'nuke', 'carpenter']
/** Relative drop odds: ammo and double points are the common ones, a nuke is a treat. */
const POWERUP_WEIGHTS: Record<DfPowerupKind, number> = { maxammo: 1.25, double: 1.2, insta: 0.9, nuke: 0.75, carpenter: 0.7 }

export class DfMatchSim {
    readonly map: DfMapDef
    readonly solo: boolean
    readonly interactables: Map<string, DfInteractable>
    world: DfCollisionWorld
    nav: DfNav
    now: () => number

    time = 0
    tick = 0
    round = 0
    roundsCompleted = 0
    phase: 'intermission' | 'active' = 'intermission'
    phaseTimer: number
    over = false

    players: SimPlayer[] = []
    zombies: SimZombie[] = []
    projectiles: SimProjectile[] = []
    powerups: SimPowerup[] = []
    gas: SimGas[] = []
    events: DfEvent[] = []

    doors = new Set<string>()
    activeZones = new Set<string>()
    planks: Record<string, number> = {}
    power = false
    double = 0
    insta = 0
    egg: DfEggState
    eggCompleted = false
    box: DfBoxState
    pap: DfPapState

    private nextId = 1
    private toSpawn = 0
    private spawnedThisRound = 0
    private spawnTimer = 0
    private bruteAt: number[] = []
    private powerupsThisRound = 0
    private killsSinceDrop = 0
    private lastPowerup: DfPowerupKind | null = null
    private barricadeTimers = new Map<string, { nextTearAt: number, climbFreeAt: number }>()
    private boxInternal = { final: null as DfWeaponId | null, cycleAt: 0, paid: 0, willMove: false, rarity: 0 as DfRarity, kit: null as DfRarity | null }
    /** The weapon in the Pack-a-Punch (its owner's slot stays reserved by `placeholder`). */
    private papJob: SimPapJob | null = null
    /** Solo pause (menu open, pointer lock lost): the match layer stops stepping. */
    paused = false
    private departed: DfEndPlayer[] = []
    /** Development hook: pause zombie spawning. */
    private devHold = false
    /** Development hook: pids that take no damage. */
    private devGod = new Set<number>()
    private playerNodes = new Map<number, number>()
    private pointsBatch: Map<number, number> | null = null
    /** Per player: when each zombie last paid flame hit points (`dfFlameHitPays`). */
    private readonly flamePaid = new Map<number, Map<number, number>>()
    private fuseIds: string[]
    private rodIds: string[]
    /** Gas rounds, electric traps, crawlers and kill streaks (specials.ts). */
    readonly specials: DfSpecials
    /** Salvage, the workbench, sentries, decoys and support (salvage.ts). */
    readonly arsenal: DfArsenal

    constructor(setups: DfPlayerSetup[], opts: DfSimOptions = {}) {
        this.map = opts.map ?? DF_MAP
        this.now = opts.now ?? (() => performance.now() / 1000)
        this.phaseTimer = opts.startDelay ?? 4
        this.solo = setups.length <= 1
        this.interactables = new Map(dfInteractables(this.map).map(i => [i.id, i]))
        this.world = dfBuildCollision(this.map, this.doors)
        this.nav = new DfNav(this.map.nav)
        this.activeZones.add(this.map.startZone)
        for (const b of this.map.barricades) {
            this.planks[b.id] = DF_BARRICADE_PLANKS
            this.barricadeTimers.set(b.id, { nextTearAt: 0, climbFreeAt: 0 })
        }
        this.fuseIds = this.map.egg.fuses.map(f => f.id)
        this.rodIds = dfEggRods(this.map).map(r => r.id)
        this.egg = { step: 'power', fusesFound: [], charge: 0, chargeNeeded: this.solo ? DF_EGG_CHARGE.solo : DF_EGG_CHARGE.squad, rodsOn: [], rodTimer: 0 }
        // the box never starts in the start zone (it may wander there later)
        const boxStarts = this.map.boxSpots.map((_, i) => i).filter(i => this.map.boxSpots[i]!.zone !== this.map.startZone)
        this.box = { spot: boxStarts.length ? randomPick(boxStarts) : 0, state: 'idle', timer: 0 }
        this.pap = { state: 'idle', timer: 0 }
        setups.forEach((s, i) => this.players.push(this.createPlayer(s, i)))
        this.specials = new DfSpecials(this, {
            killByTrap: z => this.killZombie(z, null, 'body', { weapon: 'trap', credit: null }),
            points: (p, amount) => this.addPoints(p, amount),
            hurt: (p, dmg) => this.hurtPlayer(p, dmg, -1, false),
            spend: (p, cost) => this.spend(p, cost),
            left: () => this.toSpawn + this.zombies.length
        })
        this.arsenal = new DfArsenal(this, {
            damage: (z, p, dmg, zone, explosive) => this.damageZombie(z, p, dmg, zone, explosive ? { weapon: 'grenade', credit: null, explosive: true } : { weapon: 'sentry', credit: null }),
            points: (p, amount) => this.addPoints(p, amount),
            steer: (z, goal, speed, dt) => this.steer(z, goal, speed, dt),
            walkable: (a, b) => this.walkable(a, b),
            makeWeapon: (p, id) => this.makeWeapon(p, id, 0)
        })
    }

    // ================================================================ players

    private createPlayer(setup: DfPlayerSetup, pid: number): SimPlayer {
        const effects = dfComputeEffects([], setup.perkMods, this.solo)
        const p: SimPlayer = {
            pid,
            setup,
            pos: { ...this.spawnPoint(pid) },
            yaw: 0,
            pitch: 0,
            flags: DF_FLAG.grounded,
            seq: 0,
            life: 'alive',
            health: effects.maxHealth,
            points: DF_POINTS.startPoints,
            kills: 0,
            headshots: 0,
            downs: 0,
            revives: 0,
            perks: [],
            effects,
            weapons: [],
            savedWeapons: null,
            savedSlot: 0,
            slot: 0,
            grenades: DF_GRENADES.start,
            bleedout: 0,
            reviveProgress: 0,
            reviving: -1,
            selfRevivesLeft: 0,
            selfReviveAt: 0,
            connected: true,
            tp: 1,
            lastDamageAt: -100,
            invulnUntil: 0,
            reload: null,
            swapUntil: 0,
            meleeReadyAt: 0,
            grenadeReadyAt: 0,
            repairReadyAt: 0,
            useCooldown: new Map(),
            deathWishRound: -1,
            plankPoints: 0,
            secondwindBuys: 0,
            lastInputAt: this.now(),
            rtt: 0,
            moveBudget: 2,
            fireTokens: MAX_FIRE_TOKENS,
            fireTokensAt: this.now(),
            weaponKills: {},
            weaponsFound: new Set(),
            completedEgg: false
        }
        // everyone starts with the M1911 (`startWeapon` is a test hook only)
        p.weapons = [this.makeWeapon(p, setup.startWeapon ?? 'm1911', 0)]
        return p
    }

    private spawnPoint(pid: number): Vec3 {
        const spawns = this.map.playerSpawns
        return spawns.length ? spawns[pid % spawns.length]! : { x: 0, y: 0, z: 0 }
    }

    player(pid: number): SimPlayer | undefined {
        return this.players.find(p => p.pid === pid)
    }

    playerByUser(userId: string): SimPlayer | undefined {
        return this.players.find(p => p.setup.userId === userId)
    }

    private makeWeapon(p: SimPlayer, id: DfWeaponId, pap: number, rarity = 0): SimWeapon {
        const attachments = p.setup.attachments[id] ?? {}
        const r = dfRarityApplies(id) ? dfClampRarity(rarity) : 0
        const stats = dfWeaponStats(id, pap, attachments, r)
        const w: SimWeapon = { id, pap, mag: stats.magSize, reserve: this.maxReserve(p, stats.reserve), attachments, stats }
        if (r > 0) w.rarity = r
        return w
    }

    private maxReserve(p: SimPlayer, reserve: number): number {
        return Math.max(0, Math.round(reserve * p.effects.reserveAmmoMult))
    }

    private held(p: SimPlayer): SimWeapon | undefined {
        return p.weapons[p.slot]
    }

    /** The weapon in hand, unless that slot is waiting on the Pack-a-Punch. */
    private usable(p: SimPlayer): SimWeapon | undefined {
        const w = p.weapons[p.slot]
        return w && !w.away ? w : undefined
    }

    private eye(p: SimPlayer): Vec3 {
        const h = p.life === 'down' ? 0.55 : (p.flags & DF_FLAG.crouch) ? DF_PLAYER.crouchEyeHeight : DF_PLAYER.eyeHeight
        return { x: p.pos.x, y: p.pos.y + h, z: p.pos.z }
    }

    private chest(p: SimPlayer): Vec3 {
        const h = p.life === 'down' ? 0.4 : (p.flags & DF_FLAG.crouch) ? 0.75 : 1.15
        return { x: p.pos.x, y: p.pos.y + h, z: p.pos.z }
    }

    private setEffects(p: SimPlayer): void {
        const before = p.effects.maxHealth
        p.effects = dfComputeEffects(p.perks, p.setup.perkMods, this.solo)
        const after = p.effects.maxHealth
        if (after > before) p.health = Math.min(after, p.health + (after - before))
        else p.health = Math.min(after, p.health)
    }

    /** A player gone from the match (left or timed out). Their scoreboard line stays for the end screen. */
    removePlayer(pid: number): void {
        const p = this.player(pid)
        if (!p) return
        this.departed.push(this.endLine(p))
        this.players = this.players.filter(q => q !== p)
        for (const q of this.players) {
            if (q.reviving === pid) q.reviving = -1
        }
        for (const z of this.zombies) {
            if (z.target === pid) z.repathAt = 0
        }
        if (this.box.owner === pid && this.box.state !== 'moving') {
            this.box.owner = undefined
        }
        if (this.papJob?.owner === pid) this.resetPap()
    }

    /** Solo only: the pause menu (or a lost pointer lock) freezes the whole match. */
    pause(pid: number, paused: boolean): void {
        if (!this.solo || !this.player(pid)) return
        this.paused = paused === true
    }

    setConnected(pid: number, connected: boolean): void {
        const p = this.player(pid)
        if (!p) return
        p.connected = connected
        if (connected) {
            p.lastInputAt = this.now()
            p.awaitingInput = true
            p.moveBudget = 2
            p.tp++
            // a remounted game view counts its inputs from 1 again: an old ack would settle its
            // predictions at once (a reconnecting one just carries on counting past 0)
            p.seq = 0
            // a fresh client (remounted game view) needs snapshots to resume: it re-pauses if it wants
            this.paused = false
        } else {
            p.reviving = -1
        }
    }

    /**
     * Solo and the player's movement reports have stopped arriving (a network stall,
     * a frozen tab) while the socket is still up: the match layer holds the world
     * still until they resume, so a hitch never walks the horde into a player who
     * can't react.
     */
    get soloStalled(): boolean {
        const p = this.players[0]
        return this.solo && !!p && p.connected && p.life !== 'dead' && this.inputAge(p) > DF_STALE_INPUT
    }

    /** Seconds since the player's last movement report (0 before their client has sent any since joining or reconnecting). */
    private inputAge(p: SimPlayer): number {
        return p.seq > 0 && !p.awaitingInput ? this.now() - p.lastInputAt : 0
    }

    get connectedCount(): number {
        return this.players.filter(p => p.connected).length
    }

    // ================================================================ client messages

    /**
     * Development-only test hooks (teleport, points, rounds). The match layer
     * only calls this under `import.meta.dev`; never wire it anywhere else.
     */
    dev(pid: number, op: DfDevOp): void {
        const p = this.player(pid)
        if (!p || !op || typeof op !== 'object') return
        switch (op.k) {
            case 'tp': {
                const pos = finiteVec(op.pos)
                if (!pos) return
                p.pos = pos
                p.moveBudget = 2
                p.tp++
                return
            }
            case 'points':
                if (Number.isFinite(op.amount)) p.points = Math.max(0, Math.round(p.points + op.amount))
                return
            case 'heal':
                p.health = p.effects.maxHealth
                return
            case 'down':
                if (p.life === 'alive') this.downPlayer(p)
                return
            case 'clear':
                for (const z of [...this.zombies]) this.killZombie(z, null, 'body', { weapon: 'knife', credit: null }, { noPoints: true, noDrop: true })
                return
            case 'hold':
                this.devHold = op.on === true
                return
            case 'god':
                if (op.on === true) this.devGod.add(pid)
                else this.devGod.delete(pid)
                return
            case 'special':
                this.specials.dev(p, op)
                return
            case 'arsenal':
                this.arsenal.dev(p, op)
                return
            case 'egg': {
                const order = DF_EGG_STEPS.map(x => x.id)
                const at = order.indexOf(op.step)
                if (at < 0) return
                if (at > 0 && !this.power) {
                    this.power = true
                    this.emit({ k: 'power' })
                }
                const e = this.egg
                e.fusesFound = at > order.indexOf('fuses') ? [...this.fuseIds] : []
                e.charge = at > order.indexOf('charge') ? e.chargeNeeded : 0
                e.rodsOn = at > order.indexOf('rods') ? [...this.rodIds] : []
                e.rodTimer = 0
                e.step = op.step
                this.emit({ k: 'egg', step: e.step })
                return
            }
            case 'round': {
                if (!Number.isFinite(op.round) || op.round < 1) return
                for (const z of [...this.zombies]) this.killZombie(z, null, 'body', { weapon: 'knife', credit: null }, { noPoints: true, noDrop: true })
                this.round = Math.floor(op.round) - 1
                this.startRound()
                return
            }
        }
    }

    input(pid: number, msg: { seq: number, pos: Vec3, yaw: number, pitch: number, flags: number, rtt?: number }): void {
        const p = this.player(pid)
        if (!p) return
        const hadInput = p.seq > 0 && !p.awaitingInput
        if (Number.isFinite(msg.seq) && msg.seq > p.seq) p.seq = Math.floor(msg.seq)
        if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw
        if (Number.isFinite(msg.pitch)) p.pitch = clamp(msg.pitch, -1.6, 1.6)
        if (Number.isFinite(msg.flags)) p.flags = msg.flags & 0xff
        if (Number.isFinite(msg.rtt)) p.rtt = clamp(msg.rtt! / 1000, 0, 1)
        const now = this.now()
        if (hadInput && now - p.lastInputAt > DF_STALE_INPUT) p.lastStallEnd = now
        p.awaitingInput = false
        const dt = clamp(now - p.lastInputAt, 0, 0.5)
        p.lastInputAt = now
        if (p.life === 'dead') return
        const target = finiteVec(msg.pos)
        if (!target) return
        this.applyMove(p, target, dt)
    }

    /**
     * Client-authoritative movement: the reported position is taken whenever
     * the body fits there and the move is within a generous speed budget, so
     * the server never drags a player back (no rubber-banding). Only a move
     * into geometry (slid along the walls instead), a teleport-sized jump or a
     * fall out of the map moves the player server-side; the client snaps back
     * only when that leaves it far off (`tp`).
     */
    private applyMove(p: SimPlayer, target: Vec3, dt: number): void {
        const maxSpeed = p.life === 'down'
            ? 2.2
            : DF_PLAYER.sprintSpeed * Math.max(1, p.effects.moveMult) * Math.max(1, p.effects.sprintMult) * 1.5 + 1
        p.moveBudget = Math.min(4, p.moveBudget + maxSpeed * dt)
        const dx = target.x - p.pos.x
        const dz = target.z - p.pos.z
        const dy = target.y - p.pos.y
        const horiz = Math.hypot(dx, dz)
        if (horiz > p.moveBudget + 6 || dy > 6 + horiz) {
            // Teleport-sized: keep the server position and make the client snap back.
            p.tp++
            return
        }
        let tx = target.x
        let tz = target.z
        let ty = target.y
        const allowed = p.moveBudget
        if (horiz > allowed) {
            // a little faster than possible (a hitch, a burst of packets): take what the budget allows, quietly
            const k = allowed / horiz
            tx = p.pos.x + dx * k
            tz = p.pos.z + dz * k
        }
        const moved = Math.min(horiz, allowed)
        p.moveBudget = Math.max(0, p.moveBudget - moved)
        if (ty - p.pos.y > 1.6 + moved) ty = p.pos.y + 1.6 + moved
        const crouch = p.life === 'down' || (p.flags & DF_FLAG.crouch) !== 0
        const body = {
            radius: DF_PLAYER.radius * 0.85,
            height: crouch ? DF_PLAYER.crouchHeight : DF_PLAYER.height,
            stepHeight: DF_PLAYER.stepHeight
        }
        const next = { x: tx, y: ty, z: tz }
        if (dfBodyFits(this.world, next, body) || dfBodyFits(this.world, next, { ...body, height: DF_PLAYER.crouchHeight })) {
            p.pos = next
        } else {
            // into geometry (a door state a tick apart, a squeeze): slide there through the collision world
            const res = dfMoveBody(this.world, p.pos, { x: tx - p.pos.x, y: 0, z: tz - p.pos.z }, 1, body)
            p.pos = res.pos
            // truly stuck or far off: only then make the client snap
            if (Math.hypot(res.pos.x - target.x, res.pos.z - target.z) > 1.5) p.tp++
        }
        const floor = dfGroundHeight(this.world, p.pos.x, p.pos.z, p.pos.y + 0.5)
        if (Number.isFinite(floor) && p.pos.y < floor - 0.3) p.pos.y = floor
        if (p.pos.y < this.map.bounds.min.y - 1) {
            p.pos = { ...this.spawnPoint(p.pid) }
            p.tp++
        }
    }

    /**
     * One trigger pull. Client-authoritative (players are friends): the
     * client's magazine, swap and reload timing are taken as reported and its
     * hit claims only pass sanity bounds. The server keeps the ammo total
     * honest (the magazine is refilled from the reserve, never from nothing)
     * and the fire rate within reason.
     */
    fire(pid: number, msg: { origin: Vec3, dirs: Vec3[], hits: DfShotHit[], shot?: number, mag?: number, weapon?: string }): boolean {
        const p = this.player(pid)
        if (!p || p.life === 'dead') return false
        const w = this.usable(p)
        if (!w) return false
        // fired from a weapon the server no longer has in hand (a lent launcher swapped in or out meanwhile): drop it
        if (typeof msg.weapon === 'string' && msg.weapon !== w.id) return false
        const reported = typeof msg.mag === 'number' && Number.isFinite(msg.mag)
        if (reported) {
            // the client finished (or interrupted) its own reload: adopt its magazine
            p.reload = null
            this.syncMag(w, msg.mag! + 1)
        } else if (!this.readyToFire(p)) {
            return false
        }
        if (w.mag <= 0) return false
        // Fire rate: a token bucket refilled at the weapon's rpm, tolerant to network jitter.
        const now = this.now()
        const rate = Math.max(0.5, (w.stats.rpm * p.effects.fireRateMult) / 60) * 1.35
        const cap = Math.max(MAX_FIRE_TOKENS, 1 + rate * FIRE_BURST_SECONDS)
        p.fireTokens = Math.min(cap, p.fireTokens + (now - p.fireTokensAt) * rate)
        p.fireTokensAt = now
        if (p.fireTokens < 1) return false
        p.fireTokens -= 1
        w.mag -= 1

        const eye = this.eye(p)
        let origin = finiteVec(msg.origin) ?? eye
        if (dist(origin, eye) > 2.5) origin = eye
        const maxRays = Math.max(1, w.stats.pellets)
        const dirs: Vec3[] = []
        for (const d of Array.isArray(msg.dirs) ? msg.dirs.slice(0, maxRays) : []) {
            const n = normalize(finiteVec(d))
            if (n) dirs.push(n)
        }
        if (!dirs.length) dirs.push(forward(p.yaw, p.pitch))
        const shotId = typeof msg.shot === 'number' && Number.isFinite(msg.shot) ? Math.floor(msg.shot) : undefined

        const shot = w.stats.shot
        if (shot === 'grenade' || shot === 'xray-bolt') {
            for (const d of dirs) this.launchWeaponProjectile(p, w, origin, d)
            this.emit({ k: 'shot', p: p.pid, weapon: w.id, pap: w.pap, from: rv(origin), to: rv(add(origin, scale(dirs[0]!, 4))) })
            return true
        }
        if (shot === 'arc') {
            this.fireArc(p, w, origin, dirs[0]!, Array.isArray(msg.hits) ? msg.hits : [])
            return true
        }
        this.fireHitscan(p, w, origin, dirs, Array.isArray(msg.hits) ? msg.hits : [], shotId)
        return true
    }

    /**
     * Moves rounds between reserve and magazine so the magazine holds `want`
     * (clamped to the magazine size). Rounds only come out of the reserve, and
     * rounds the client didn't load go back into it: the total never grows.
     */
    private syncMag(w: SimWeapon, want: number): void {
        const target = clamp(Math.round(want), 0, w.stats.magSize)
        if (target > w.mag) {
            const take = Math.min(target - w.mag, w.reserve)
            w.mag += take
            w.reserve -= take
        } else if (target < w.mag) {
            w.reserve += w.mag - target
            w.mag = target
        }
    }

    /** Lenient against reload / swap timers that run a little behind the client (clients that don't report ammo). */
    private readyToFire(p: SimPlayer): boolean {
        if (p.reload) {
            if (p.reload.perRound) {
                p.reload = null
            } else if (p.reload.until - this.time <= 0.2) {
                this.finishReload(p)
            } else {
                return false
            }
        }
        return p.swapUntil - this.time <= 0.2
    }

    private fireHitscan(p: SimPlayer, w: SimWeapon, origin: Vec3, dirs: Vec3[], claims: DfShotHit[], shotId?: number): void {
        const range = w.stats.maxRange
        const budget = dirs.map(() => w.stats.penetration + 1)
        const used = new Set<string>()
        let shotEnd = Math.min(dfRaycast(this.world, origin, dirs[0]!, range + 2)?.dist ?? Infinity, range)
        let flamePaid: Map<number, number> | null = null
        if (DF_WEAPONS[w.id]?.flame) {
            flamePaid = this.flamePaid.get(p.pid) ?? null
            if (!flamePaid) this.flamePaid.set(p.pid, flamePaid = new Map())
        }
        this.pointsBatch = new Map()
        try {
            for (const claim of claims.slice(0, dirs.length * (w.stats.penetration + 1))) {
                if (!claim || typeof claim.z !== 'number') continue
                const z = this.zombies.find(q => q.id === claim.z)
                if (!z || z.hp <= 0) continue
                const target = { type: z.type, pos: z.pos, speed: z.curSpeed }
                let best = -1
                let bestHit: { t: number, miss: number } | null = null
                for (let i = 0; i < dirs.length; i++) {
                    if (budget[i]! <= 0 || used.has(`${i}:${z.id}`)) continue
                    // sanity only: the ray passes within a few metres of the zombie, inside the weapon's range
                    const hit = dfClaimSane(target, origin, dirs[i]!, range)
                    if (!hit || hit.t > range + 4) continue
                    if (!bestHit || hit.miss < bestHit.miss) {
                        best = i
                        bestHit = hit
                    }
                }
                if (best < 0 || !bestHit) continue
                budget[best]!--
                used.add(`${best}:${z.id}`)
                const dir = dirs[best]!
                // the client saw the zone and the distance: take them
                const zone: DfHitZone = isZone(claim.zone) ? claim.zone : 'body'
                const at = typeof claim.dist === 'number' && Number.isFinite(claim.dist) ? clamp(claim.dist, 0, range + 4) : bestHit.t
                const dmg = dfBulletDamage(w.stats, p.effects, zone, at, p.life === 'down')
                if (best === 0) shotEnd = Math.min(shotEnd, at)
                const hitPoints = !flamePaid || dfFlameHitPays(flamePaid, z.id, this.time)
                this.damageZombie(z, p, dmg, zone, { weapon: w.id, credit: w.id, at: add(origin, scale(dir, at)), claimKill: claim.kill === true, hitPoints })
            }
        } finally {
            this.flushPoints(p.pid, shotId)
        }
        this.emit({ k: 'shot', p: p.pid, weapon: w.id, pap: w.pap, from: rv(origin), to: rv(add(origin, scale(dirs[0]!, shotEnd))) })
    }

    private fireArc(p: SimPlayer, w: SimWeapon, origin: Vec3, dir: Vec3, claims: DfShotHit[]): void {
        const range = w.stats.maxRange > 0 ? w.stats.maxRange : 40
        const hit: SimZombie[] = []
        for (const c of claims) {
            const z = this.zombies.find(q => q.id === c?.z)
            if (!z) continue
            // client-authoritative first target: a sanity bound only
            if (z.hp > 0 && dfClaimSane({ type: z.type, pos: z.pos, speed: z.curSpeed }, origin, dir, range)) {
                hit.push(z)
                break
            }
        }
        if (!hit.length) {
            // No usable claim: the zombie the ray takes, aimed at the closest point of its body
            // (point blank, any zombie right in front), so one in your face can't slip under the eye line.
            let best: SimZombie | null = null
            let bestScore = Infinity
            for (const z of this.zombies) {
                if (z.hp <= 0) continue
                const aim = dfArcAim(dfArcBody(z.type, z.pos, z.crawl), origin, dir, range)
                if (!aim || aim.score >= bestScore) continue
                if (dfLineOfSight(this.world, origin, aim.point) || dfLineOfSight(this.world, origin, zChest(z))) {
                    best = z
                    bestScore = aim.score
                }
            }
            if (best) hit.push(best)
        }
        const chains = Math.max(2, w.stats.chains || 4)
        const reach = ARC_CHAIN_RANGE + w.pap
        while (hit.length && hit.length <= chains) {
            const last = hit[hit.length - 1]!
            let next: SimZombie | null = null
            let nd = reach
            for (const z of this.zombies) {
                if (hit.includes(z)) continue
                const d = dist(z.pos, last.pos)
                if (d < nd && dfLineOfSight(this.world, zChest(last), zChest(z))) {
                    nd = d
                    next = z
                }
            }
            if (!next) break
            hit.push(next)
        }
        const to = hit.map(z => rv(zChest(z)))
        const end = to[0] ?? rv(add(origin, scale(dir, Math.min(range, dfRaycast(this.world, origin, dir, range)?.dist ?? range))))
        this.emit({ k: 'shot', p: p.pid, weapon: w.id, pap: w.pap, from: rv(origin), to: end })
        this.emit({ k: 'arc', from: rv(origin), to: to.length ? to : [end] })
        this.pointsBatch = new Map()
        try {
            hit.forEach((z, i) => {
                z.shockedUntil = this.time + 0.8
                const dmg = w.stats.damage * p.effects.damageMult * Math.pow(0.88, i) * (p.life === 'down' ? p.effects.lastStandDamageMult : 1)
                this.damageZombie(z, p, dmg, 'body', { weapon: 'arc', credit: 'wunder' })
            })
            const last = hit[hit.length - 1]
            if (last && w.pap >= 2 && w.stats.splashRadius > 0) {
                this.explode(zChest(last), w.stats.splashRadius, 'shock', p, w.stats.splashDamage, { weapon: 'arc', credit: 'wunder', explosive: true }, 0)
            }
        } finally {
            this.flushPoints()
        }
    }

    /**
     * Without `mag`: a reload starts (the flag remote players see, reload
     * perks, and a timed fallback for clients that don't report ammo). With
     * `mag`: the client's reload finished (or a shell went in) and left the
     * magazine at `mag`, taken from the reserve.
     */
    reload(pid: number, mag?: number, weapon?: string): void {
        const p = this.player(pid)
        if (!p || p.life === 'dead') return
        if (typeof mag === 'number' && Number.isFinite(mag)) {
            const w = this.usable(p)
            // a magazine reported for another weapon (the launcher came or went meanwhile) isn't this one's
            if (!w || (weapon !== undefined && weapon !== w.id)) return
            this.syncMag(w, mag)
            p.reload = null
            return
        }
        if (p.reload) return
        const w = this.usable(p)
        if (!w || w.mag >= w.stats.magSize || w.reserve <= 0) return
        const mult = Math.max(0.1, p.effects.reloadMult)
        const empty = w.mag === 0
        if (w.stats.perRoundReload > 0) {
            const per = (w.stats.perRoundReload / mult) * 0.9
            p.reload = { slot: p.slot, perRound: true, until: 0, next: this.time + per + 0.15 / mult, per }
        } else {
            const dur = ((empty ? w.stats.reloadEmptyTime : w.stats.reloadTime) / mult) * 0.9
            p.reload = { slot: p.slot, perRound: false, until: this.time + dur, next: 0, per: 0 }
        }
        if (empty && p.effects.reloadShock > 0) {
            this.pointsBatch = new Map()
            try {
                this.explode({ x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }, 3, 'shock', p, p.effects.reloadShock, { weapon: w.id, credit: w.id, explosive: true }, 0)
            } finally {
                this.flushPoints()
            }
        }
    }

    private finishReload(p: SimPlayer): void {
        const r = p.reload
        p.reload = null
        if (!r) return
        const w = p.weapons[r.slot]
        if (!w) return
        const need = w.stats.magSize - w.mag
        const take = Math.min(need, w.reserve)
        w.mag += take
        w.reserve -= take
    }

    swap(pid: number, slot: number): void {
        const p = this.player(pid)
        if (!p || p.life === 'dead' || !Number.isInteger(slot)) return
        if (slot === p.slot || slot < 0 || slot >= p.weapons.length) return
        if (p.weapons[slot]!.away) return
        // Last stand is pistols only.
        if (p.life === 'down' && DF_WEAPONS[p.weapons[slot]!.id]?.class !== 'pistol') return
        p.slot = slot
        p.reload = null
        p.swapUntil = this.time + (SWAP_TIME / Math.max(0.1, p.effects.swapMult)) * 0.85
    }

    melee(pid: number, msg: { z?: number, zone?: DfHitZone, shot?: number, kill?: boolean }): void {
        const p = this.player(pid)
        if (!p || p.life !== 'alive') return
        if (this.time < p.meleeReadyAt - 0.15) return
        p.meleeReadyAt = this.time + DF_MELEE.cooldown
        // the knife interrupts a reload, as it does on the client
        p.reload = null
        if (typeof msg.z !== 'number') return
        const z = this.zombies.find(q => q.id === msg.z)
        if (!z) return
        // client-authoritative: only a sanity bound on the reach (lag and the lunge included)
        const reach = DF_MELEE.range + p.effects.meleeLunge + z.def.radius + 2 + z.curSpeed * 0.35
        if (hdist(p.pos, z.pos) > reach || Math.abs(p.pos.y - z.pos.y) > 2) return
        const zone: DfHitZone = msg.zone === 'head' ? 'head' : 'body'
        const shotId = typeof msg.shot === 'number' && Number.isFinite(msg.shot) ? Math.floor(msg.shot) : undefined
        this.pointsBatch = new Map()
        try {
            this.damageZombie(z, p, DF_MELEE.damage * p.effects.meleeMult, zone, { weapon: 'knife', credit: null, melee: true, claimKill: msg.kill === true })
        } finally {
            this.flushPoints(p.pid, shotId)
        }
    }

    grenade(pid: number, msg: { origin: Vec3, dir: Vec3 }): void {
        const p = this.player(pid)
        if (!p || p.life !== 'alive' || p.grenades <= 0) return
        if (this.time < p.grenadeReadyAt) return
        p.grenadeReadyAt = this.time + 0.8
        p.grenades--
        const eye = this.eye(p)
        let origin = finiteVec(msg.origin) ?? eye
        if (dist(origin, eye) > 1.5) origin = eye
        const dir = normalize(finiteVec(msg.dir)) ?? forward(p.yaw, p.pitch)
        this.projectiles.push({
            id: this.nextId++,
            kind: 'grenade',
            pos: origin,
            vel: { x: dir.x * 14, y: dir.y * 14 + 2.5, z: dir.z * 14 },
            tier: 0,
            owner: p.pid,
            weapon: null,
            life: DF_GRENADES.fuse,
            resting: false,
            gravity: 13,
            directDamage: 0,
            splashRadius: DF_GRENADES.radius,
            splashDamage: Math.max(300, dfZombieBaseHealth(Math.max(1, this.round)) * 0.7)
        })
    }

    revive(pid: number, target: number | null): void {
        const p = this.player(pid)
        if (!p) return
        if (target === null || p.life !== 'alive') {
            p.reviving = -1
            return
        }
        const t = this.player(target)
        if (!t || t === p || t.life !== 'down') return
        if (dist(p.pos, t.pos) > REVIVE_REACH) return
        if (p.reviving !== target) {
            for (const q of this.players) if (q !== p && q.reviving === target) return
            p.reviving = target
            t.reviveProgress = 0
        }
    }

    chat(pid: number, text: string): void {
        const p = this.player(pid)
        if (!p) return
        const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 200)
        if (clean) this.emit({ k: 'chat', name: p.setup.name, text: clean })
    }

    // ================================================================ interactions

    use(pid: number, id: string): void {
        const p = this.player(pid)
        if (!p || p.life !== 'alive' || typeof id !== 'string') return
        const it = this.interactables.get(id)
        if (!it) return
        if (hdist(p.pos, it.pos) > DF_PLAYER.useRange + USE_TOLERANCE || Math.abs(p.pos.y - it.pos.y) > 2.2) return
        if (it.kind !== 'barricade') {
            const ready = p.useCooldown.get(id) ?? 0
            if (this.time < ready) return
        }
        const handled = this.useKind(p, it)
        if (handled && it.kind !== 'barricade') p.useCooldown.set(id, this.time + 0.9)
    }

    private useKind(p: SimPlayer, it: DfInteractable): boolean {
        switch (it.kind) {
            case 'rod': return this.useRod(p, it.ref ?? it.id)
            case 'door': return this.useDoor(p, it.ref ?? it.id)
            case 'wallbuy': return this.useWallBuy(p, it)
            case 'perk': return this.usePerk(p, it.ref as DfPerkId)
            case 'box': return this.useBox(p, it.id)
            case 'pap': return this.usePap(p)
            case 'power': return this.usePower()
            case 'fuse': return this.useFuse(p, it.ref ?? it.id)
            case 'generator': return this.eggAction({ kind: 'install' }).progressed
            case 'pedestal': return this.usePedestal(p)
            case 'barricade': return this.useBarricade(p, it.ref ?? it.id)
            case 'trap': return this.specials.useTrap(p, it.ref ?? it.id)
        }
        return false
    }

    private spend(p: SimPlayer, cost: number): boolean {
        if (cost < 0 || p.points < cost) return false
        p.points -= cost
        return true
    }

    private useDoor(p: SimPlayer, doorId: string): boolean {
        const door = this.map.doors.find(d => d.id === doorId)
        if (!door || this.doors.has(door.id)) return false
        if (!this.spend(p, door.cost)) return false
        this.doors.add(door.id)
        for (const z of door.zones) this.activeZones.add(z)
        this.world = dfBuildCollision(this.map, this.doors)
        this.nav.setOpenDoors(this.doors)
        for (const z of this.zombies) z.repathAt = 0
        this.emit({ k: 'door', id: door.id })
        this.emit({ k: 'buy', p: p.pid, what: `door:${door.id}` })
        return true
    }

    private useWallBuy(p: SimPlayer, it: DfInteractable): boolean {
        const id = it.ref as DfWeaponId | undefined
        if (!id || !DF_WEAPONS[id]) return false
        const def = DF_WEAPONS[id]
        // the weapon a lent launcher stands in for still counts as owned (its ammo is bought, not a second copy)
        const stashed = this.arsenal.stashed(p)
        const owned = p.weapons.find(w => w.id === id) ?? (stashed?.id === id ? stashed : undefined)
        // its slot is reserved while it's in the Pack-a-Punch: no second copy, no ammo for the placeholder
        if (owned?.away) return false
        if (owned) {
            const max = this.maxReserve(p, owned.stats.reserve)
            if (owned.reserve >= max && owned.mag >= owned.stats.magSize) return false
            const cost = owned.pap > 0 ? DF_COSTS.papAmmo : (def.ammoCost ?? Math.round((def.wallCost ?? 1000) / 2))
            if (!this.spend(p, cost)) return false
            owned.reserve = max
            this.emit({ k: 'buy', p: p.pid, what: `ammo:${id}` })
            return true
        }
        if (def.wallCost === undefined) return false
        if (!this.spend(p, def.wallCost)) return false
        // a new weapon: a lent launcher goes back first (the trade swaps the real one)
        this.arsenal.endLauncher(p)
        this.giveWeapon(p, this.makeWeapon(p, id, 0), true)
        this.emit({ k: 'buy', p: p.pid, what: `weapon:${id}` })
        return true
    }

    /**
     * Adds a weapon without ever shifting the other slots: the matching slot,
     * the free normal slot (always before the wunderweapon, which rides last),
     * or it replaces the weapon in hand. A slot reserved by the Pack-a-Punch
     * is never replaced.
     */
    private giveWeapon(p: SimPlayer, w: SimWeapon, found: boolean): void {
        if (found) p.weaponsFound.add(w.id)
        let idx = p.weapons.findIndex(x => x.id === w.id)
        if (idx >= 0) {
            if (p.weapons[idx]!.away) return
            p.weapons[idx] = w
        } else if (w.id === 'wunder') {
            p.weapons.push(w)
            idx = p.weapons.length - 1
        } else {
            const normals = p.weapons.filter(x => x.id !== 'wunder').length
            if (normals < 2) {
                const wunder = p.weapons.findIndex(x => x.id === 'wunder')
                idx = wunder >= 0 ? wunder : p.weapons.length
                p.weapons.splice(idx, 0, w)
            } else {
                const cur = p.weapons[p.slot]
                idx = cur && cur.id !== 'wunder' && !cur.away ? p.slot : p.weapons.findIndex(x => x.id !== 'wunder' && !x.away)
                if (idx < 0) return
                p.weapons[idx] = w
            }
        }
        p.slot = idx
        p.reload = null
        p.swapUntil = this.time + (SWAP_TIME / Math.max(0.1, p.effects.swapMult)) * 0.85
    }

    private usePerk(p: SimPlayer, perk: DfPerkId): boolean {
        const def = DF_PERKS[perk]
        if (!def) return false
        const soloWind = perk === 'secondwind' && this.solo
        // Solo, Second Wind works without power (it's the only way to survive a down).
        if (!this.power && !soloWind) return false
        if (p.perks.includes(perk) || p.perks.length >= DF_MAX_PERKS) return false
        if (soloWind && p.secondwindBuys >= DF_SOLO_SECONDWIND_MAX) return false
        const cost = soloWind ? DF_COSTS.secondwindSolo : def.cost
        if (!this.spend(p, cost)) return false
        const before = p.effects.selfRevives
        p.perks.push(perk)
        this.setEffects(p)
        p.selfRevivesLeft += Math.max(0, p.effects.selfRevives - before)
        if (soloWind) p.secondwindBuys++
        this.emit({ k: 'perk', p: p.pid, perk })
        this.emit({ k: 'buy', p: p.pid, what: `perk:${perk}` })
        return true
    }

    private boxSpot(): DfSpot | undefined {
        return this.map.boxSpots[this.box.spot]
    }

    private useBox(p: SimPlayer, id: string): boolean {
        const spot = this.boxSpot()
        if (!spot || spot.id !== id) return false
        const box = this.box
        if (box.state === 'ready' && box.owner === p.pid && box.kit) {
            // an upgrade kit: claimed off the box first, then applied (or set down) by the arsenal
            const tier = box.kit
            this.resetBox()
            this.emit({ k: 'box', what: 'take' })
            // the kit is for your own weapon: a lent launcher goes back first
            this.arsenal.endLauncher(p)
            this.arsenal.claimKit(p, tier)
            return true
        }
        if (box.state === 'ready' && box.owner === p.pid && box.weapon) {
            const weapon = box.weapon
            const rarity = box.rarity ?? 0
            this.arsenal.endLauncher(p)
            this.giveWeapon(p, this.makeWeapon(p, weapon, 0, rarity), true)
            box.state = 'idle'
            box.weapon = undefined
            box.rarity = undefined
            box.owner = undefined
            box.timer = 0
            this.emit({ k: 'box', what: 'take' })
            if (rarity > 0 && dfRarityApplies(weapon)) this.emit({ k: 'rarity', p: p.pid, weapon, rarity, how: 'box' })
            return true
        }
        if (box.state !== 'idle') return false
        if (!this.spend(p, DF_COSTS.box)) return false
        const bi = this.boxInternal
        bi.paid = DF_COSTS.box
        const stash = this.arsenal.stashed(p)
        bi.final = dfBoxRoll(dfBoxChoices(dfBoxPool(), [...p.weapons.map(w => w.id), ...(stash ? [stash.id] : [])]), randomFloat())
        // its rarity, or now and then an upgrade kit instead (rarity.ts)
        bi.rarity = dfBoxRarityRoll(this.round, randomFloat())
        bi.kit = dfBoxKitRoll(this.round, randomFloat(), randomFloat())
        // every roll has a flat chance to send the box elsewhere (the roll is refunded, your weapons untouched)
        bi.willMove = this.map.boxSpots.length > 1 && randomChance(DF_BOX_MOVE_CHANCE)
        bi.cycleAt = this.time + 0.15
        box.state = 'rolling'
        box.owner = p.pid
        box.timer = DF_MACHINE_TIMES.boxRoll
        box.weapon = randomPick(dfBoxPool())
        this.emit({ k: 'box', what: 'open' })
        this.emit({ k: 'buy', p: p.pid, what: 'box' })
        return true
    }

    private stepBox(dt: number): void {
        const box = this.box
        const bi = this.boxInternal
        if (box.state === 'idle') return
        box.timer -= dt
        if (box.state === 'rolling') {
            if (this.time >= bi.cycleAt) {
                bi.cycleAt = this.time + 0.12 + (1 - Math.max(0, box.timer) / DF_MACHINE_TIMES.boxRoll) * 0.25
                const pool = dfBoxPool()
                if (pool.length) box.weapon = randomPick(pool)
            }
            if (box.timer <= 0) {
                const owner = box.owner !== undefined ? this.player(box.owner) : undefined
                if (bi.willMove || !owner || !bi.final) {
                    if (bi.willMove) {
                        if (owner) this.grant(owner, bi.paid)
                        box.state = 'moving'
                        box.timer = DF_MACHINE_TIMES.boxMove
                        box.weapon = undefined
                        this.emit({ k: 'box', what: 'move' })
                    } else {
                        this.resetBox()
                    }
                } else {
                    box.state = 'ready'
                    box.timer = DF_MACHINE_TIMES.boxOffer
                    if (bi.kit) {
                        box.weapon = undefined
                        box.kit = bi.kit
                    } else {
                        box.weapon = bi.final
                        if (bi.rarity > 0 && dfRarityApplies(bi.final)) box.rarity = bi.rarity
                    }
                }
            }
        } else if (box.state === 'ready') {
            if (box.timer <= 0) this.resetBox()
        } else if (box.state === 'moving' && box.timer <= 0) {
            const spots = this.map.boxSpots.map((_, i) => i).filter(i => i !== box.spot)
            if (spots.length) box.spot = randomPick(spots)
            this.resetBox()
        }
    }

    private resetBox(): void {
        this.box.state = 'idle'
        this.box.weapon = undefined
        this.box.rarity = undefined
        this.box.kit = undefined
        this.boxInternal.kit = null
        this.box.owner = undefined
        this.box.timer = 0
        this.boxInternal.final = null
    }

    private usePap(p: SimPlayer): boolean {
        const pap = this.pap
        if (!this.power) return false
        if (pap.state === 'ready' && pap.owner === p.pid && this.papJob) {
            this.returnPap(p, true)
            return true
        }
        if (pap.state !== 'idle') return false
        const w = this.usable(p)
        // a lent launcher isn't yours to pack
        if (!w || DF_WEAPONS[w.id]?.temporary) return false
        const cost = dfPapCost(w.pap)
        if (cost === null || !this.spend(p, cost)) return false
        // The weapon goes in but its slot stays put (reserved), so nothing shifts
        // and it comes back to exactly where it was.
        w.away = true
        p.reload = null
        const other = p.weapons.findIndex(x => !x.away)
        if (other >= 0) {
            p.slot = other
            p.swapUntil = this.time + 0.4
        }
        this.papJob = { owner: p.pid, placeholder: w, id: w.id, tier: w.pap + 1 }
        pap.state = 'working'
        pap.owner = p.pid
        pap.weapon = w.id
        pap.tier = w.pap + 1
        pap.timer = DF_MACHINE_TIMES.papWork
        this.emit({ k: 'pap', p: p.pid, weapon: w.id, tier: w.pap + 1 })
        this.emit({ k: 'buy', p: p.pid, what: 'pap' })
        return true
    }

    /**
     * Hands the upgraded weapon back with a full magazine and reserve: into the
     * slot it left (also while that list is set aside for last stand), or, if
     * the owner lost their weapons since (bled out and respawned), like a new
     * pickup. Taking it from the machine puts it in hand; an automatic return
     * only does when the owner has nothing else to hold.
     */
    private returnPap(p: SimPlayer, taken: boolean): void {
        const job = this.papJob
        if (!job) return
        this.resetPap()
        // Pack-a-Punch keeps the weapon's rarity
        const upgraded = this.makeWeapon(p, job.id, job.tier, job.placeholder.rarity ?? 0)
        if (!taken) this.emit({ k: 'papReturn', p: p.pid, weapon: job.id, tier: job.tier })
        for (const list of [p.weapons, p.savedWeapons]) {
            const i = list ? list.indexOf(job.placeholder) : -1
            if (!list || i < 0) continue
            list[i] = upgraded
            if (list === p.weapons && p.life === 'alive' && (taken || !this.usable(p))) {
                p.slot = i
                p.reload = null
                p.swapUntil = this.time + (SWAP_TIME / Math.max(0.1, p.effects.swapMult)) * 0.85
            }
            return
        }
        if (p.life === 'alive') {
            const before = p.slot
            this.giveWeapon(p, upgraded, false)
            if (!taken && this.usable(p) && p.weapons[before] && !p.weapons[before]!.away && p.weapons[before] !== upgraded) p.slot = before
        } else if (p.savedWeapons) {
            p.savedWeapons.push(upgraded)
        } else {
            p.weapons.push(upgraded)
        }
    }

    private resetPap(): void {
        this.papJob = null
        this.pap.state = 'idle'
        this.pap.owner = undefined
        this.pap.weapon = undefined
        this.pap.tier = undefined
        this.pap.timer = 0
    }

    private stepPap(dt: number): void {
        const pap = this.pap
        if (pap.state === 'idle') return
        const owner = pap.owner !== undefined ? this.player(pap.owner) : undefined
        if (!owner || !this.papJob) {
            this.resetPap()
            return
        }
        // The offer waits for an owner who bled out (until they respawn) or dropped (until they're back).
        if (pap.state === 'ready' && (owner.life === 'dead' || !owner.connected)) return
        pap.timer -= dt
        if (pap.timer > 0) return
        if (pap.state === 'working') {
            pap.state = 'ready'
            pap.timer = DF_MACHINE_TIMES.papOffer
        } else {
            // never keep it: the machine hands it back to its owner
            this.returnPap(owner, false)
        }
    }

    private usePower(): boolean {
        if (this.power) return false
        this.power = true
        this.emit({ k: 'power' })
        this.eggAction({ kind: 'power' })
        return true
    }

    private useFuse(p: SimPlayer, fuseId: string): boolean {
        if (!this.power) return false
        const res = this.eggAction({ kind: 'fuse', id: fuseId })
        if (res.progressed) this.emit({ k: 'fuse', id: fuseId, p: p.pid })
        return res.progressed
    }

    /** Throws a lightning-rod switch; the first one starts the clock for the rest. */
    private useRod(p: SimPlayer, rodId: string): boolean {
        const res = this.eggAction({ kind: 'rod', id: rodId, time: this.solo ? DF_EGG_ROD_TIME.solo : DF_EGG_ROD_TIME.squad })
        if (res.progressed) this.emit({ k: 'rod', id: rodId, p: p.pid, on: true, n: this.egg.rodsOn.length })
        return res.progressed
    }

    /** The rod clock: when it runs out every thrown rod resets and the squad tries again. */
    private stepEgg(dt: number): void {
        const reset = dfEggTick(this.egg, dt, this.fuseIds, this.rodIds)
        // one event per rod, `n` counting down to 0 on the last (the HUD speaks once)
        reset.forEach((id, i) => this.emit({ k: 'rod', id, p: -1, on: false, n: reset.length - 1 - i }))
    }

    private usePedestal(p: SimPlayer): boolean {
        if (this.egg.step !== 'claim') return false
        const res = this.eggAction({ kind: 'claim', pid: p.pid })
        if (!res.progressed) return false
        this.giveWeapon(p, this.makeWeapon(p, 'wunder', 0), true)
        this.eggCompleted = true
        for (const q of this.players) q.completedEgg = true
        this.emit({ k: 'buy', p: p.pid, what: 'weapon:wunder' })
        return true
    }

    private eggAction(action: DfEggAction): { progressed: boolean, stepChanged: boolean } {
        const res = dfEggAdvance(this.egg, action, this.fuseIds, this.rodIds)
        if (res.stepChanged) this.emit({ k: 'egg', step: this.egg.step })
        return res
    }

    private useBarricade(p: SimPlayer, id: string): boolean {
        const b = this.map.barricades.find(x => x.id === id)
        if (!b) return false
        const cur = this.planks[b.id] ?? 0
        if (cur >= DF_BARRICADE_PLANKS) return false
        if (this.time < p.repairReadyAt) return false
        // Not while a zombie is in the opening (climbing through it).
        for (const z of this.zombies) {
            if (z.barricade === b && z.state === 'climb') return false
            if (hdist(z.pos, b.pos) < 1 && Math.abs(z.pos.y - b.pos.y) < 2) return false
        }
        p.repairReadyAt = this.time + REPAIR_INTERVAL - 0.05
        this.planks[b.id] = cur + 1
        this.emit({ k: 'plank', b: b.id, delta: 1 })
        if (p.plankPoints < DF_POINTS.plankCapPerRound) {
            p.plankPoints += DF_POINTS.plank
            this.addPoints(p, DF_POINTS.plank)
        }
        return true
    }

    // ================================================================ step

    step(dt: number): void {
        if (this.over) return
        this.time += dt
        this.tick++
        this.double = Math.max(0, this.double - dt)
        this.insta = Math.max(0, this.insta - dt)
        this.playerNodes.clear()

        this.stepRound(dt)
        this.stepPlayers(dt)
        this.stepBox(dt)
        this.stepPap(dt)
        this.stepZombies(dt)
        this.specials.step(dt)
        this.arsenal.step(dt)
        this.rushLastZombies()
        this.stepProjectiles(dt)
        this.stepPowerups()
        this.stepEgg(dt)
        this.gas = this.gas.filter(g => g.until > this.time)

        if (this.phase === 'active' && this.toSpawn <= 0 && this.zombies.length === 0) this.endRound()
        this.checkGameOver()
    }

    /**
     * The round's last stragglers pick up the pace (from round 2): with nothing
     * left to spawn and two or fewer alive, walkers break into a run, so the
     * end of a round comes to you instead of stalling on a slow walker.
     */
    private rushLastZombies(): void {
        if (this.phase !== 'active' || this.toSpawn > 0 || this.round < 2 || this.zombies.length > DF_LAST_RUSH) return
        for (const z of this.zombies) {
            if (z.gait !== 'walk' || z.type === 'brute') continue
            z.gait = 'run'
            z.speed = Math.max(z.speed, z.def.speeds.run)
        }
    }

    /**
     * Over once nobody can get back up: every player is dead or down without a
     * self-revive. A player who dropped while standing still counts during
     * their reconnect grace (they may come back and revive the squad).
     */
    private checkGameOver(): void {
        if (!this.players.some(p => p.connected)) return
        const standing = this.players.some(p => p.life === 'alive' || (p.life === 'down' && p.selfReviveAt > 0))
        if (!standing) this.over = true
    }

    // ================================================================ rounds

    private stepRound(dt: number): void {
        if (this.phase === 'intermission') {
            this.phaseTimer -= dt
            if (this.phaseTimer <= 0) this.startRound()
            return
        }
        if (this.toSpawn <= 0 || this.devHold) return
        this.spawnTimer -= dt
        if (this.spawnTimer > 0 || this.zombies.length >= dfMaxAlive(this.players.length)) return
        if (this.spawnZombie()) {
            this.toSpawn--
            this.spawnedThisRound++
        }
        this.spawnTimer = this.specials.spawnInterval(dfSpawnInterval(this.round, this.players.length)) * (0.75 + randomFloat() * 0.5)
    }

    startRound(): void {
        this.round++
        this.phase = 'active'
        this.phaseTimer = 0
        const total = this.specials.roundStart(this.round, dfRoundZombieCount(this.round, Math.max(1, this.players.length)))
        this.toSpawn = total
        this.spawnedThisRound = 0
        this.spawnTimer = this.round === 1 ? 1.5 : 2.5
        this.powerupsThisRound = 0
        this.bruteAt = []
        const brutes = this.specials.gas ? 0 : dfBrutesInRound(this.round)
        for (let i = 0; i < brutes; i++) {
            const lo = Math.floor(total * (0.25 + 0.5 * (i / brutes)))
            const hi = Math.max(lo, Math.floor(total * (0.25 + 0.5 * ((i + 1) / brutes))) - 1)
            this.bruteAt.push(randomInt(lo, hi))
        }
        for (const p of this.players) {
            p.plankPoints = 0
            if (this.round > 1) p.grenades = Math.min(DF_GRENADES.max, p.grenades + DF_GRENADES.perRound)
            if (p.life === 'dead') this.respawn(p)
        }
        this.emit({ k: 'round', round: this.round })
        this.arsenal.roundStart(this.round, { gas: this.specials.gas, brutes })
    }

    private endRound(): void {
        this.specials.roundEnd()
        this.arsenal.roundEnd()
        this.roundsCompleted = this.round
        this.phase = 'intermission'
        this.phaseTimer = DF_INTERMISSION_SECONDS
        this.emit({ k: 'roundEnd', round: this.round })
    }

    // ================================================================ spawning

    private spawnZombie(): boolean {
        const type = this.pickType()
        const spot = this.pickSpawn(type)
        if (!spot) return false
        const def = DF_ENEMIES[type]
        const maxHp = Math.round(dfZombieBaseHealth(this.round) * def.healthMult)
        let gait: SimZombie['gait'] = 'walk'
        if (type === 'shambler') gait = dfShamblerGait(this.round, randomFloat())
        else if (type === 'ghoul') gait = 'sprint'
        else if (type === 'brute') gait = this.round >= 16 ? 'run' : 'walk'
        const speed = def.speeds[gait] * (0.92 + randomFloat() * 0.16)
        const z: SimZombie = {
            id: this.nextId++,
            type,
            def,
            pos: spot.pos,
            vy: 0,
            yaw: spot.yaw,
            hp: maxHp,
            maxHp,
            helmet: def.helmet ? maxHp * def.helmet : 0,
            gait,
            speed,
            curSpeed: 0,
            state: spot.barricade ? 'approach' : 'rise',
            resume: 'hunt',
            anim: spot.barricade ? gait : 'rise',
            timer: spot.barricade ? 0 : RISE_TIME,
            barricade: spot.barricade,
            climbFrom: null,
            climbTo: null,
            inside: !spot.barricade,
            target: -1,
            goal: null,
            goalIsNode: false,
            repathAt: 0,
            attackReadyAt: 0,
            attackTarget: -1,
            spitReadyAt: this.time + 2,
            stuckCheckAt: this.time + 1.5,
            stuckRef: { ...spot.pos },
            stuckTime: 0,
            unreachableTime: 0,
            detourUntil: 0,
            detour: null,
            shockedUntil: 0,
            heading: spot.yaw,
            flank: type === 'shambler' || type === 'ghoul' ? this.rollFlank() : 0,
            flankGoal: null,
            lungeReadyAt: this.time + 1.5,
            chargeReadyAt: this.time + 3,
            dash: null,
            vel: { x: 0, y: 0, z: 0 },
            viewY: spot.pos.y
        }
        this.specials.onSpawn(z)
        this.zombies.push(z)
        return true
    }

    /** Places a zombie already inside and hunting (tests, debugging). */
    debugSpawn(type: DfEnemyType, pos: Vec3, hp?: number): SimZombie {
        const def = DF_ENEMIES[type]
        const maxHp = hp ?? Math.round(dfZombieBaseHealth(Math.max(1, this.round)) * def.healthMult)
        const z: SimZombie = {
            id: this.nextId++, type, def, pos: { ...pos }, vy: 0, yaw: 0, hp: maxHp, maxHp,
            helmet: def.helmet ? maxHp * def.helmet : 0, gait: 'walk', speed: def.speeds.walk, curSpeed: 0,
            state: 'hunt', resume: 'hunt', anim: 'walk', timer: 0, barricade: null, climbFrom: null, climbTo: null,
            inside: true, target: -1, goal: null, goalIsNode: false, repathAt: 0, attackReadyAt: 0, attackTarget: -1,
            spitReadyAt: 0, stuckCheckAt: this.time + 1.5, stuckRef: { ...pos }, stuckTime: 0, unreachableTime: 0,
            detourUntil: 0, detour: null, shockedUntil: 0, heading: 0, flank: 0, flankGoal: null,
            lungeReadyAt: this.time + 1, chargeReadyAt: this.time + 1, dash: null, vel: { x: 0, y: 0, z: 0 }, viewY: pos.y
        }
        this.zombies.push(z)
        return z
    }

    /** About a third of the horde swings wide to come at you from the side. */
    private rollFlank(): number {
        if (!randomChance(0.35)) return 0
        return (randomChance(0.5) ? 1 : -1) * (0.75 + randomFloat() * 0.55)
    }

    private pickType(): DfEnemyType {
        if (this.specials.gas) return 'ghoul'
        if (this.bruteAt.includes(this.spawnedThisRound)) return 'brute'
        const chances = dfSpecialChances(this.round)
        const bloaters = this.zombies.filter(z => z.type === 'bloater').length
        if (chances.bloater > 0 && bloaters < 3 && randomChance(chances.bloater)) return 'bloater'
        if (chances.ghoul > 0 && randomChance(chances.ghoul)) return 'ghoul'
        return 'shambler'
    }

    private pickSpawn(type: DfEnemyType): { pos: Vec3, yaw: number, barricade: DfBarricade | null } | null {
        const alive = this.players.filter(p => p.life !== 'dead')
        const near = (pos: Vec3) => {
            let d = Infinity
            for (const p of alive) d = Math.min(d, dist(p.pos, pos))
            return Number.isFinite(d) ? d : 20
        }
        const weight = (d: number) => 1 / (1 + (d / 9) * (d / 9))
        const windows = this.map.barricades.filter(b => this.activeZones.has(b.zone))
        const risers = this.map.riserSpawns.filter(r => this.activeZones.has(r.zone) && near(r.pos) > 3.5)
        const useRiser = risers.length > 0 && (this.specials.gas || windows.length === 0 || (this.round >= 2 && type !== 'brute' && randomChance(0.25)))
        if (useRiser) {
            const r = weightedPick(risers, s => weight(near(s.pos)))
            const pos = { x: r.pos.x + (randomFloat() - 0.5) * 1.2, y: r.pos.y, z: r.pos.z + (randomFloat() - 0.5) * 1.2 }
            const g = dfGroundHeight(this.world, pos.x, pos.z, pos.y + 1)
            if (Number.isFinite(g) && Math.abs(g - r.pos.y) < 0.6) pos.y = g
            else {
                pos.x = r.pos.x
                pos.z = r.pos.z
            }
            return { pos, yaw: r.yaw, barricade: null }
        }
        if (!windows.length) return null
        const b = weightedPick(windows, w => weight(near(w.pos)))
        const back = 2.5 + randomFloat() * 1.5
        const side = (randomFloat() - 0.5) * Math.min(1.6, b.width)
        // Lateral axis of the window (perpendicular to inward in xz).
        const lx = -b.inward.z
        const lz = b.inward.x
        const pos = { x: b.outside.x - b.inward.x * back + lx * side, y: b.outside.y, z: b.outside.z - b.inward.z * back + lz * side }
        const from = { x: b.outside.x, y: b.outside.y + 1, z: b.outside.z }
        const g = dfGroundHeight(this.world, pos.x, pos.z, pos.y + 1.5, true)
        if (Math.abs(g - b.outside.y) < 1.5) pos.y = g
        const body = { radius: DF_ENEMIES[type].radius, height: DF_ENEMIES[type].height, zombie: true }
        if (!dfLineOfSight(this.world, from, { x: pos.x, y: pos.y + 1, z: pos.z }) || !dfBodyFits(this.world, pos, body)) {
            pos.x = b.outside.x
            pos.y = b.outside.y
            pos.z = b.outside.z
        }
        return { pos, yaw: Math.atan2(b.inward.x, b.inward.z), barricade: b }
    }

    // ================================================================ zombies

    private targets(): SimPlayer[] {
        return this.players.filter(p => p.life === 'alive' && p.connected)
    }

    private playerNode(p: SimPlayer): number {
        let n = this.playerNodes.get(p.pid)
        if (n === undefined) {
            n = this.nav.nearest(p.pos)
            this.playerNodes.set(p.pid, n)
        }
        return n
    }

    private stepZombies(dt: number): void {
        const targets = this.targets()
        const before = new Map<SimZombie, Vec3>()
        for (const z of [...this.zombies]) {
            if (z.hp <= 0) continue
            before.set(z, { ...z.pos })
            const bx = z.pos.x
            const bz = z.pos.z
            this.thinkZombie(z, dt, targets)
            z.curSpeed = dt > 0 ? Math.hypot(z.pos.x - bx, z.pos.z - bz) / dt : 0
        }
        this.separate()
        for (const z of this.zombies) {
            const b = before.get(z)
            if (!b || dt <= 0) continue
            z.vel.x = (z.pos.x - b.x) / dt
            z.vel.y = (z.pos.y - b.y) / dt
            z.vel.z = (z.pos.z - b.z) / dt
            const follow = z.state === 'climb' || z.state === 'rise' || z.vy !== 0
            // on stairs the shown height rides a ramp over the steps (feet on the slope), then eases
            const ramp = follow ? z.pos.y : dfRampHeight(this.world, z.pos.x, z.pos.z, z.pos.y, 0.25, ZOMBIE_STEP, true)
            z.viewY = dfZombieViewY(z.viewY, ramp, Math.hypot(z.vel.x, z.vel.z), dt, follow)
            // a long jump (recycled, teleported) carries no velocity
            if (Math.hypot(z.vel.x, z.vel.z) > 20) z.vel.x = z.vel.y = z.vel.z = 0
        }
    }

    private thinkZombie(z: SimZombie, dt: number, targets: SimPlayer[]): void {
        z.timer -= dt
        switch (z.state) {
            case 'rise':
                z.anim = 'rise'
                if (z.timer <= 0) this.toHunt(z)
                return
            case 'stagger':
                z.anim = 'stagger'
                if (z.timer <= 0) {
                    z.state = z.resume
                    z.anim = z.state === 'tear' ? 'tear' : z.gait
                }
                return
            case 'climb':
                this.stepClimb(z)
                return
            case 'attack':
                this.stepAttack(z, dt)
                return
            case 'spit':
                this.stepSpit(z)
                return
            case 'lunge':
                this.stepLunge(z, dt, targets)
                return
            case 'charge':
                this.stepCharge(z, dt, targets)
                return
            case 'approach':
                this.stepApproach(z, dt, targets)
                return
            case 'tear':
                this.stepTear(z, dt, targets)
                return
            case 'hunt':
                // a playing gramophone in earshot comes first
                if (!this.arsenal.lure(z, dt)) this.stepHunt(z, dt, targets)
        }
    }

    private toHunt(z: SimZombie): void {
        z.state = 'hunt'
        z.inside = true
        z.anim = z.gait
        z.repathAt = 0
        z.stuckRef = { ...z.pos }
        z.stuckTime = 0
        z.stuckCheckAt = this.time + 1.5
    }

    private stepApproach(z: SimZombie, dt: number, targets: SimPlayer[]): void {
        const b = z.barricade
        if (!b) {
            this.toHunt(z)
            return
        }
        z.anim = z.gait
        const d = hdist(z.pos, b.outside)
        // Join the crowd at a window someone is already working on instead of shoving for the spot.
        const queued = d < 1.8 && this.zombies.some(o => o !== z && o.barricade === b && (o.state === 'tear' || o.state === 'climb' || (o.state === 'attack' && o.resume === 'tear')))
        if (d < 0.45 || queued) {
            z.state = 'tear'
            z.anim = 'tear'
            z.yaw = Math.atan2(b.inward.x, b.inward.z)
            return
        }
        this.moveToward(z, b.outside, z.speed, dt)
        this.checkStuck(z, targets)
    }

    private stepTear(z: SimZombie, dt: number, targets: SimPlayer[]): void {
        const b = z.barricade
        if (!b) {
            this.toHunt(z)
            return
        }
        z.yaw = turnToward(z.yaw, Math.atan2(b.inward.x, b.inward.z), 0.3)
        // Swipe through the window at anyone standing in it.
        if (this.time >= z.attackReadyAt) {
            for (const p of targets) {
                if (this.atWindow(p, b) || (hdist(p.pos, z.pos) <= z.def.attackRange + DF_PLAYER.radius + 0.35 && Math.abs(p.pos.y - z.pos.y) < 1.3)) {
                    this.beginAttack(z, p, 'tear')
                    return
                }
            }
        }
        const timers = this.barricadeTimers.get(b.id)!
        const planks = this.planks[b.id] ?? 0
        if (planks <= 0) {
            const d = hdist(z.pos, b.outside)
            if (d > 0.45) {
                // Queued behind the window: step up to it before climbing through.
                z.anim = 'walk'
                this.moveToward(z, b.outside, z.def.speeds.walk * 1.5, dt)
                return
            }
            if (this.time >= timers.climbFreeAt) {
                timers.climbFreeAt = this.time + CLIMB_TIME * 0.8
                z.state = 'climb'
                z.anim = 'climb'
                z.timer = CLIMB_TIME
                z.climbFrom = { ...z.pos }
                const inside = { x: b.pos.x + b.inward.x * 0.75, y: b.pos.y, z: b.pos.z + b.inward.z * 0.75 }
                const g = dfGroundHeight(this.world, inside.x, inside.z, inside.y + 1, true)
                if (Math.abs(g - inside.y) < 0.8) inside.y = g
                z.climbTo = inside
            } else {
                z.anim = 'walk'
            }
            return
        }
        z.anim = 'tear'
        if (this.time >= timers.nextTearAt) {
            timers.nextTearAt = this.time + z.def.tearTime
            this.planks[b.id] = planks - 1
            this.emit({ k: 'plank', b: b.id, delta: -1 })
        }
    }

    /** A player standing in a window's opening, within reach of a zombie tearing at it. */
    private atWindow(p: SimPlayer, b: DfBarricade, slack = 0): boolean {
        return hdist(p.pos, b.pos) <= 1.1 + slack && Math.abs(p.pos.y - b.pos.y) < 1.3
    }

    private stepClimb(z: SimZombie): void {
        const from = z.climbFrom
        const to = z.climbTo
        if (!from || !to) {
            this.toHunt(z)
            return
        }
        const k = clamp(1 - z.timer / CLIMB_TIME, 0, 1)
        const e = k * k * (3 - 2 * k)
        z.pos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e }
        z.anim = 'climb'
        if (z.timer <= 0) {
            z.pos = { ...to }
            z.vy = 0
            this.toHunt(z)
        }
    }

    private beginAttack(z: SimZombie, p: SimPlayer, resume: SimZombieState): void {
        z.state = 'attack'
        z.resume = resume
        z.anim = 'attack'
        z.timer = z.def.windup
        z.attackTarget = p.pid
        z.swingPending = false
        z.yaw = Math.atan2(p.pos.x - z.pos.x, p.pos.z - z.pos.z)
    }

    private stepAttack(z: SimZombie, dt: number): void {
        const p = this.player(z.attackTarget)
        z.anim = 'attack'
        if (p && p.life === 'alive' && !z.swingPending) {
            // The swing commits: it tracks you only slowly, so a step aside or back makes it whiff.
            z.yaw = turnToward(z.yaw, Math.atan2(p.pos.x - z.pos.x, p.pos.z - z.pos.z), 2.5 * dt)
            z.heading = z.yaw
            if (z.resume === 'hunt' && hdist(z.pos, p.pos) > z.def.radius + DF_PLAYER.radius + 0.2) {
                // a short shuffle into the swing, along the committed facing
                const lunge = z.type === 'ghoul' ? 1.6 : z.type === 'brute' ? 0.9 : 0.6
                const ahead = { x: z.pos.x + Math.sin(z.yaw), y: z.pos.y, z: z.pos.z + Math.cos(z.yaw) }
                this.moveToward(z, ahead, lunge, dt, false)
            }
        }
        if (z.timer > 0) return
        if (!z.swingPending && p && p.life === 'alive') {
            // the arm is down: let the target's latest moves arrive before it lands
            z.swingPending = true
            z.swingHeld = 0
            z.timer = Math.min(SWING_LAG_MAX, p.rtt + SWING_LAG_EXTRA)
            return
        }
        // Their reports have stalled (a lag spike): hold the arm a moment longer for fresh ones, so
        // the swing is judged where they really are, not where they stood before the spike.
        if (p && p.life === 'alive' && p.connected && this.inputAge(p) > SWING_FRESH_INPUT && (z.swingHeld ?? 0) < SWING_HOLD_MAX) {
            z.swingHeld = (z.swingHeld ?? 0) + dt
            return
        }
        z.swingPending = false
        z.swingHeld = 0
        z.attackReadyAt = this.time + z.def.attackCooldown
        z.state = z.resume
        z.anim = z.state === 'tear' ? 'tear' : z.gait
        if (!p || p.life !== 'alive') return
        const windowHit = z.resume === 'tear' && z.barricade !== null && this.atWindow(p, z.barricade, 0.4)
        if (!windowHit) {
            const d = hdist(z.pos, p.pos)
            if (d > z.def.attackRange + DF_PLAYER.radius + SWIPE_SLACK || Math.abs(p.pos.y - z.pos.y) > 1.4) return
            // only what's in front of it: circling behind a swing dodges it
            const off = Math.abs(wrapAngle(Math.atan2(p.pos.x - z.pos.x, p.pos.z - z.pos.z) - z.yaw))
            if (off > 1.25 && d > z.def.radius + DF_PLAYER.radius + 0.1) return
        }
        if (!dfLineOfSight(this.world, zChest(z), this.chest(p))) return
        this.hurtPlayer(p, z.def.damage, z.id, false)
    }

    /** Ghoul specials and brute charges start here: in range, on level ground and with a clear run. */
    private trySpecial(z: SimZombie, target: SimPlayer, d: number, dy: number): boolean {
        if (dy > 0.6 || this.time < z.attackReadyAt) return false
        if (z.type === 'ghoul') {
            const L = DF_GHOUL_LUNGE
            if (this.time < z.lungeReadyAt || d < L.minRange || d > L.maxRange) return false
            if (!this.clearRun(z, target.pos)) {
                z.lungeReadyAt = this.time + 0.6
                return false
            }
            z.state = 'lunge'
            z.timer = L.windup
        } else if (z.type === 'brute') {
            const C = DF_BRUTE_CHARGE
            if (this.time < z.chargeReadyAt || d < C.minRange || d > C.maxRange) return false
            if (!this.clearRun(z, target.pos)) {
                z.chargeReadyAt = this.time + 0.8
                return false
            }
            z.state = 'charge'
            z.timer = C.windup
        } else {
            return false
        }
        z.anim = 'attack'
        z.attackTarget = target.pid
        z.dash = null
        z.flankGoal = null
        z.yaw = z.heading = Math.atan2(target.pos.x - z.pos.x, target.pos.z - z.pos.z)
        return true
    }

    /** A straight, walkable line with a view of the target. */
    private clearRun(z: SimZombie, to: Vec3): boolean {
        return dfLineOfSight(this.world, zChest(z), { x: to.x, y: to.y + 1.1, z: to.z }) && this.walkable(z.pos, to)
    }

    /** Ghoul leap: crouch (the tell, still turning to face you), then a locked-in leap past where you stood. */
    private stepLunge(z: SimZombie, dt: number, targets: SimPlayer[]): void {
        const L = DF_GHOUL_LUNGE
        const p = this.player(z.attackTarget)
        if (!z.dash) {
            z.anim = 'attack'
            if (p && p.life === 'alive') z.yaw = z.heading = turnToward(z.yaw, Math.atan2(p.pos.x - z.pos.x, p.pos.z - z.pos.z), 10 * dt)
            if (z.timer > 0) return
            if (!p || p.life !== 'alive') {
                this.endDash(z, 0)
                return
            }
            const dx = p.pos.x - z.pos.x
            const dz = p.pos.z - z.pos.z
            const d = Math.max(0.01, Math.hypot(dx, dz))
            z.dash = { dir: { x: dx / d, y: 0, z: dz / d }, speed: L.speed, until: this.time + (d + L.overshoot) / L.speed, hit: false }
            z.yaw = z.heading = Math.atan2(dx, dz)
        }
        z.anim = 'sprint'
        const done = this.dashStep(z, dt, targets, z.def.damage, true)
        if (done || this.time >= z.dash!.until) {
            z.lungeReadyAt = this.time + L.cooldown * (0.8 + randomFloat() * 0.4)
            this.endDash(z, 0)
            z.attackReadyAt = Math.max(z.attackReadyAt, this.time + L.recover)
        }
    }

    /** Brute charge: stop and roar (the tell), then run the line at where you stood; winded afterwards. */
    private stepCharge(z: SimZombie, dt: number, targets: SimPlayer[]): void {
        const C = DF_BRUTE_CHARGE
        const p = this.player(z.attackTarget)
        if (!z.dash) {
            z.anim = 'attack'
            if (p && p.life === 'alive') z.yaw = z.heading = turnToward(z.yaw, Math.atan2(p.pos.x - z.pos.x, p.pos.z - z.pos.z), 4 * dt)
            if (z.timer > 0) return
            if (!p || p.life !== 'alive') {
                this.endDash(z, 0)
                return
            }
            const dx = p.pos.x - z.pos.x
            const dz = p.pos.z - z.pos.z
            const d = Math.max(0.01, Math.hypot(dx, dz))
            z.dash = { dir: { x: dx / d, y: 0, z: dz / d }, speed: C.speed, until: this.time + Math.min(C.maxTime, (d + 2) / C.speed), hit: false }
            z.yaw = z.heading = Math.atan2(dx, dz)
        }
        z.anim = 'sprint'
        const blocked = this.dashStep(z, dt, targets, C.damage, false)
        if (blocked || this.time >= z.dash!.until) {
            z.chargeReadyAt = this.time + C.cooldown * (0.85 + randomFloat() * 0.3)
            // slamming into a wall winds it for longer
            this.endDash(z, C.recover * (blocked ? 1.4 : 1))
        }
    }

    /**
     * Moves a dashing zombie one tick along its locked line and hits the first
     * player it runs into (once per dash). True when the dash should end: it
     * hit someone (and `stopOnHit`), or it ran into a wall.
     */
    private dashStep(z: SimZombie, dt: number, targets: SimPlayer[], damage: number, stopOnHit: boolean): boolean {
        const dash = z.dash!
        const bx = z.pos.x
        const bz = z.pos.z
        z.vy -= GRAVITY * dt
        const res = dfMoveBody(this.world, z.pos, { x: dash.dir.x * dash.speed, y: z.vy, z: dash.dir.z * dash.speed }, dt, {
            radius: z.def.radius,
            height: z.def.height,
            stepHeight: ZOMBIE_STEP,
            zombie: true
        })
        z.pos = res.pos
        if (res.grounded) z.vy = 0
        if (z.pos.y < this.map.bounds.min.y - 2) {
            this.respawnZombie(z)
            return true
        }
        if (!dash.hit) {
            const reach = z.def.radius + DF_PLAYER.radius + 0.25
            for (const p of targets) {
                if (Math.abs(p.pos.y - z.pos.y) > 1.2) continue
                // distance from the player to the segment walked this tick
                const sx = z.pos.x - bx
                const sz = z.pos.z - bz
                const l2 = sx * sx + sz * sz
                const t = l2 > 1e-9 ? clamp(((p.pos.x - bx) * sx + (p.pos.z - bz) * sz) / l2, 0, 1) : 1
                const d = Math.hypot(p.pos.x - (bx + sx * t), p.pos.z - (bz + sz * t))
                if (d > reach) continue
                dash.hit = true
                this.hurtPlayer(p, damage, z.id, false)
                if (stopOnHit) return true
                break
            }
        }
        const moved = Math.hypot(z.pos.x - bx, z.pos.z - bz)
        return moved < dash.speed * dt * 0.3
    }

    private endDash(z: SimZombie, recover: number): void {
        z.dash = null
        z.repathAt = 0
        this.resetStuck(z)
        if (recover > 0) {
            z.state = 'stagger'
            z.resume = 'hunt'
            z.anim = 'stagger'
            z.timer = recover
        } else {
            z.state = 'hunt'
            z.anim = z.gait
        }
    }

    private stepSpit(z: SimZombie): void {
        z.anim = 'spit'
        const p = this.player(z.attackTarget)
        if (p) z.yaw = Math.atan2(p.pos.x - z.pos.x, p.pos.z - z.pos.z)
        if (z.timer > 0) return
        z.state = 'hunt'
        z.anim = z.gait
        z.spitReadyAt = this.time + DF_BLOATER.spitCooldown * (0.85 + randomFloat() * 0.3)
        if (!p || p.life !== 'alive') return
        const from = { x: z.pos.x, y: z.pos.y + z.def.headY, z: z.pos.z }
        const aim = this.chest(p)
        const dx = aim.x - from.x
        const dz = aim.z - from.z
        const d = Math.hypot(dx, dz)
        if (d < 0.5) return
        const t = d / DF_BLOATER.spitSpeed
        const g = 12
        const vy = (aim.y - from.y + 0.5 * g * t * t) / t
        this.projectiles.push({
            id: this.nextId++,
            kind: 'spit',
            pos: from,
            vel: { x: (dx / d) * DF_BLOATER.spitSpeed, y: vy, z: (dz / d) * DF_BLOATER.spitSpeed },
            tier: 0,
            owner: -1,
            weapon: null,
            life: 4,
            resting: false,
            gravity: g,
            directDamage: 0,
            splashRadius: DF_BLOATER.spitRadius,
            splashDamage: DF_BLOATER.spitDamage
        })
    }

    private stepHunt(z: SimZombie, dt: number, targets: SimPlayer[]): void {
        if (this.time >= z.repathAt) this.plan(z, targets)
        const target = z.target >= 0 ? this.player(z.target) : undefined
        if (!target || target.life !== 'alive' || !target.connected) {
            z.anim = 'walk'
            if (z.goal) this.steer(z, z.goal, z.def.speeds.walk * 0.6, dt)
            return
        }
        const d = hdist(z.pos, target.pos)
        const dy = Math.abs(target.pos.y - z.pos.y)
        // Melee.
        if (d <= z.def.attackRange + DF_PLAYER.radius && dy < 1.3 && this.time >= z.attackReadyAt) {
            if (dfLineOfSight(this.world, zChest(z), this.chest(target))) {
                this.beginAttack(z, target, 'hunt')
                return
            }
        }
        // Ghoul leaps and brute charges.
        if ((z.type === 'ghoul' || z.type === 'brute') && !z.crawl && this.trySpecial(z, target, d, dy)) return
        // Bloaters hang back and lob spit.
        if (z.type === 'bloater' && d > 2.2 && d <= DF_BLOATER.spitMax && dy < 4) {
            const los = dfLineOfSight(this.world, { x: z.pos.x, y: z.pos.y + z.def.headY, z: z.pos.z }, this.chest(target))
            if (los) {
                if (this.time >= z.spitReadyAt && d >= DF_BLOATER.spitMin * 0.8) {
                    z.state = 'spit'
                    z.timer = DF_BLOATER.spitWindup
                    z.attackTarget = target.pid
                    z.anim = 'spit'
                    return
                }
                z.yaw = turnToward(z.yaw, Math.atan2(target.pos.x - z.pos.x, target.pos.z - z.pos.z), 6 * dt)
                if (d < DF_BLOATER.spitMin) {
                    const away = { x: z.pos.x - (target.pos.x - z.pos.x), y: z.pos.y, z: z.pos.z - (target.pos.z - z.pos.z) }
                    z.anim = 'walk'
                    this.moveToward(z, away, z.def.speeds.walk, dt, false)
                    return
                }
                if (d < DF_BLOATER.spitMax * 0.7) {
                    z.anim = 'walk'
                    this.resetStuck(z)
                    return
                }
            }
        }
        z.anim = z.gait
        // Chasing in the open: straight at the live position, or swinging wide on a flank.
        let goal: Vec3 | null = z.goalIsNode ? z.goal : target.pos
        if (!z.goalIsNode && z.flankGoal) {
            if (d < 2.6 || hdist(z.pos, z.flankGoal) < 0.7) z.flankGoal = null
            else goal = z.flankGoal
        }
        if (z.detourUntil > this.time && z.detour) goal = z.detour
        if (!goal) return
        if (z.goalIsNode && hdist(z.pos, goal) < 0.6 && Math.abs(goal.y - z.pos.y) < 1.2 && z.repathAt > this.time + 0.05) {
            z.repathAt = this.time
        }
        // Stop just short of the target instead of walking into them.
        if (!z.goalIsNode && d < z.def.attackRange * 0.75 + DF_PLAYER.radius) {
            z.yaw = turnToward(z.yaw, Math.atan2(target.pos.x - z.pos.x, target.pos.z - z.pos.z), 8 * dt)
            z.heading = z.yaw
            this.resetStuck(z)
            return
        }
        this.steer(z, goal, z.speed, dt)
        this.checkStuck(z, targets)
    }

    /**
     * Picks a target and the next waypoint toward them. Direct chase when the
     * player is close, visible and the floor between is walkable; otherwise
     * down the player's distance field, skipping ahead along the path while
     * the straight line stays walkable (smooth corners, fewer waypoints).
     * Keeps its current target unless another player is clearly closer.
     */
    private plan(z: SimZombie, targets: SimPlayer[]): void {
        z.repathAt = this.time + 0.45 + randomFloat() * 0.15
        if (!targets.length) {
            z.target = -1
            z.goal = null
            z.flankGoal = null
            return
        }
        const eye = { x: z.pos.x, y: z.pos.y + 1, z: z.pos.z }
        let cands: { i: number, d: number }[] | null = null
        const candidates = () => {
            if (cands) return cands
            cands = []
            const around = this.nav.around(z.pos, 9, 0.75)
            for (const i of around.slice(0, 8)) {
                const n = this.nav.pos(i)
                if (this.walkable(z.pos, n)) {
                    cands.push({ i, d: dist(z.pos, n) })
                    if (cands.length >= 5) break
                }
            }
            if (!cands.length) {
                const i = this.nav.nearest(z.pos)
                if (i >= 0) cands.push({ i, d: dist(z.pos, this.nav.pos(i)) })
            }
            return cands
        }
        interface Option { pid: number, cost: number, goalIdx: number, field: Float64Array | null }
        let best: Option | null = null
        let current: Option | null = null
        for (const p of targets) {
            let opt: Option | null = null
            const d = dist(z.pos, p.pos)
            const dy = Math.abs(p.pos.y - z.pos.y)
            if (dy < 0.9 && d < 14 && dfLineOfSight(this.world, eye, this.chest(p)) && this.walkable(z.pos, p.pos)) {
                opt = { pid: p.pid, cost: d, goalIdx: -1, field: null }
            } else if (this.nav.size) {
                const pn = this.playerNode(p)
                const field = this.nav.field(pn)
                const tail = hdist(this.nav.pos(pn), p.pos)
                for (const c of candidates()) {
                    const cost = c.d + field[c.i]! + tail
                    if (!Number.isFinite(cost) || (opt && cost >= opt.cost)) continue
                    let goalIdx = c.i
                    if (c.d < 0.8) {
                        // At the node already: its next hop, along a link this body can walk from here.
                        const hops = this.nav.downhill(field, c.i)
                        goalIdx = hops.find(h => this.walkable(z.pos, this.nav.pos(h))) ?? hops[0] ?? -1
                    }
                    opt = { pid: p.pid, cost, goalIdx, field }
                }
            }
            if (!opt) continue
            if (p.pid === z.target) current = opt
            if (!best || opt.cost < best.cost) best = opt
        }
        if (!best) {
            // Nobody reachable: shamble toward the closest player anyway and give up later.
            let closest = targets[0]!
            for (const p of targets) if (dist(p.pos, z.pos) < dist(closest.pos, z.pos)) closest = p
            z.target = closest.pid
            z.goal = closest.pos
            z.goalIsNode = false
            z.flankGoal = null
            z.unreachableTime += 0.5
            return
        }
        if (current && current !== best && current.cost <= best.cost * 1.25 + 1.5) best = current
        z.unreachableTime = 0
        z.target = best.pid
        z.flankGoal = null
        const target = this.player(best.pid)!
        if (best.field && best.goalIdx >= 0) {
            let idx = best.goalIdx
            for (let k = 0; k < 3; k++) {
                const next = this.nav.nextHop(best.field, idx)
                if (next < 0 || !this.walkable(z.pos, this.nav.pos(next))) break
                idx = next
            }
            z.goal = this.nav.pos(idx)
            z.goalIsNode = true
        } else {
            z.goal = target.pos
            z.goalIsNode = false
            if (z.flank !== 0 && !best.field) z.flankGoal = this.flankPoint(z, target)
        }
    }

    /**
     * A point beside the target for a flanking approach: on a circle around
     * them, swung `flank` radians off the straight line, tightening as the
     * gap closes. Null when it isn't walkable or can't see the target.
     */
    private flankPoint(z: SimZombie, target: SimPlayer): Vec3 | null {
        const d = hdist(z.pos, target.pos)
        if (d < 3.5) return null
        const base = Math.atan2(z.pos.x - target.pos.x, z.pos.z - target.pos.z)
        const a = base + z.flank * clamp((d - 2.5) / 6, 0.35, 1)
        const r = Math.min(d * 0.65, 4)
        const x = target.pos.x + Math.sin(a) * r
        const zz = target.pos.z + Math.cos(a) * r
        const g = dfGroundHeight(this.world, x, zz, target.pos.y + 1, true)
        if (!Number.isFinite(g) || Math.abs(g - target.pos.y) > 0.4) return null
        const pt = { x, y: g, z: zz }
        if (!dfLineOfSight(this.world, { x, y: g + 1, z: zz }, this.chest(target)) || !this.walkable(z.pos, pt)) return null
        return pt
    }

    /**
     * Can a zombie walk straight from a to b? Line of sight at hip height and
     * a continuous floor: no step up taller than a stair, no drop off a ledge.
     */
    private walkable(a: Vec3, b: Vec3): boolean {
        if (!dfLineOfSight(this.world, { x: a.x, y: a.y + 1, z: a.z }, { x: b.x, y: b.y + 1, z: b.z })) return false
        const d = hdist(a, b)
        const n = Math.max(1, Math.ceil(d / 0.35))
        let prev = a.y
        for (let k = 1; k <= n; k++) {
            const t = k / n
            const x = a.x + (b.x - a.x) * t
            const z = a.z + (b.z - a.z) * t
            const yl = a.y + (b.y - a.y) * t
            const g = dfGroundHeight(this.world, x, z, Math.max(prev, yl) + ZOMBIE_STEP, true)
            if (g - prev > ZOMBIE_STEP - 0.05 || prev - g > 0.6 || Math.abs(g - yl) > 0.9) return false
            prev = g
        }
        return true
    }

    private moveToward(z: SimZombie, goal: Vec3, speed: number, dt: number, face = true): void {
        let dx = goal.x - z.pos.x
        let dz = goal.z - z.pos.z
        const d = Math.hypot(dx, dz)
        if (d > 1e-4) {
            dx /= d
            dz /= d
        } else {
            dx = 0
            dz = 0
        }
        const step = Math.min(speed, d / Math.max(dt, 1e-3))
        if (face && d > 0.05) z.yaw = turnToward(z.yaw, Math.atan2(dx, dz), 7 * dt)
        z.vy -= GRAVITY * dt
        const res = dfMoveBody(this.world, z.pos, { x: dx * step, y: z.vy, z: dz * step }, dt, {
            radius: z.def.radius,
            height: z.def.height,
            stepHeight: ZOMBIE_STEP,
            zombie: true
        })
        z.pos = res.pos
        if (res.grounded) z.vy = 0
        if (z.pos.y < this.map.bounds.min.y - 2) this.respawnZombie(z)
    }

    /**
     * Hunting movement: the walking direction eases toward the goal (paths
     * curve instead of snapping at waypoints), neighbours steer it sideways
     * so a crowd flows around itself instead of stacking, and it slows into
     * sharp turns. Close to a waypoint it turns on the spot rather than orbit.
     */
    private steer(z: SimZombie, goal: Vec3, speed: number, dt: number): void {
        let dx = goal.x - z.pos.x
        let dz = goal.z - z.pos.z
        const d = Math.hypot(dx, dz)
        if (d < 1e-3) {
            this.moveToward(z, goal, 0, dt, false)
            return
        }
        dx /= d
        dz /= d
        let sx = 0
        let sz = 0
        for (const o of this.zombies) {
            if (o === z || o.state === 'climb' || o.state === 'rise' || Math.abs(o.pos.y - z.pos.y) > 1.2) continue
            const ox = z.pos.x - o.pos.x
            const oz = z.pos.z - o.pos.z
            const min = z.def.radius + o.def.radius + 0.45
            const d2 = ox * ox + oz * oz
            if (d2 >= min * min) continue
            const od = Math.sqrt(d2)
            const w = (min - od) / min
            if (od > 1e-4) {
                sx += (ox / od) * w
                sz += (oz / od) * w
            }
            // dead ahead: pick a side (by id, so neighbours split both ways)
            const ahead = od > 1e-4 ? -(ox * dx + oz * dz) / od : 1
            if (ahead > 0.8) {
                const side = z.id % 2 === 0 ? 1 : -1
                sx += dz * side * w * 0.6
                sz += -dx * side * w * 0.6
            }
        }
        // the push may steer sideways but never turn the zombie away from its goal
        const along = sx * dx + sz * dz
        if (along < 0) {
            sx -= dx * along
            sz -= dz * along
        }
        let wx = dx + sx * 1.1
        let wz = dz + sz * 1.1
        const wl = Math.hypot(wx, wz) || 1
        wx /= wl
        wz /= wl
        const want = Math.atan2(wx, wz)
        const rate = z.gait === 'sprint' ? 11 : z.gait === 'run' ? 9 : 6.5
        if (d < (speed / rate) * 1.6 + 0.3) z.heading = want
        else z.heading = turnToward(z.heading, want, rate * dt)
        const err = Math.abs(wrapAngle(want - z.heading))
        const k = Math.max(0.35, Math.cos(Math.min(err, Math.PI / 2)))
        const step = Math.min(speed * k, d / Math.max(dt, 1e-3))
        z.yaw = turnToward(z.yaw, z.heading, 9 * dt)
        z.vy -= GRAVITY * dt
        const res = dfMoveBody(this.world, z.pos, { x: Math.sin(z.heading) * step, y: z.vy, z: Math.cos(z.heading) * step }, dt, {
            radius: z.def.radius,
            height: z.def.height,
            stepHeight: ZOMBIE_STEP,
            zombie: true
        })
        z.pos = res.pos
        if (res.grounded) z.vy = 0
        if (z.pos.y < this.map.bounds.min.y - 2) this.respawnZombie(z)
    }

    /** Pushes overlapping zombies apart (O(n^2), n <= 24). */
    private separate(): void {
        const zs = this.zombies
        for (let i = 0; i < zs.length; i++) {
            const a = zs[i]!
            if (a.state === 'climb' || a.state === 'rise') continue
            for (let j = i + 1; j < zs.length; j++) {
                const b = zs[j]!
                if (b.state === 'climb' || b.state === 'rise') continue
                if (Math.abs(a.pos.y - b.pos.y) > 1.2) continue
                const dx = b.pos.x - a.pos.x
                const dz = b.pos.z - a.pos.z
                const min = a.def.radius + b.def.radius
                const d2 = dx * dx + dz * dz
                if (d2 >= min * min) continue
                const d = Math.sqrt(d2) || 0.01
                // resolve most (not all) of the overlap per tick: steering does the rest, without jitter
                const push = (min - d) * 0.3
                const nx = d2 > 0 ? dx / d : 1
                const nz = d2 > 0 ? dz / d : 0
                const wa = a.type === 'brute' ? 0.2 : 1
                const wb = b.type === 'brute' ? 0.2 : 1
                const sum = wa + wb
                this.nudge(a, -nx * push * (wa / sum) * 2, -nz * push * (wa / sum) * 2)
                this.nudge(b, nx * push * (wb / sum) * 2, nz * push * (wb / sum) * 2)
            }
            // nor into a standing player: bodies touch, they don't overlap (the client
            // eases itself out of zombies the same way)
            for (const p of this.players) {
                if (p.life !== 'alive' || Math.abs(p.pos.y - a.pos.y) > 1.2) continue
                const dx = a.pos.x - p.pos.x
                const dz = a.pos.z - p.pos.z
                const min = a.def.radius + DF_PLAYER.radius - 0.08
                const d2 = dx * dx + dz * dz
                if (d2 >= min * min) continue
                const d = Math.sqrt(d2)
                if (d < 1e-3) continue
                const push = (min - d) * 0.5
                this.nudge(a, (dx / d) * push, (dz / d) * push)
            }
        }
    }

    private nudge(z: SimZombie, dx: number, dz: number): void {
        if (z.state === 'tear' || z.state === 'attack') {
            dx *= 0.3
            dz *= 0.3
        }
        const res = dfMoveBody(this.world, z.pos, { x: dx, y: 0, z: dz }, 1, {
            radius: z.def.radius,
            height: z.def.height,
            stepHeight: ZOMBIE_STEP,
            zombie: true
        })
        z.pos = res.pos
    }

    private resetStuck(z: SimZombie): void {
        z.stuckRef = { ...z.pos }
        z.stuckTime = 0
        z.stuckCheckAt = this.time + 1.5
    }

    private checkStuck(z: SimZombie, targets: SimPlayer[]): void {
        if (this.time < z.stuckCheckAt) return
        z.stuckCheckAt = this.time + 1.5
        const moved = dist(z.pos, z.stuckRef)
        z.stuckRef = { ...z.pos }
        if (moved < 0.35) z.stuckTime += 1.5
        else z.stuckTime = Math.max(0, z.stuckTime - 1.5)
        if (z.stuckTime >= 3 && z.detourUntil < this.time) {
            z.detour = this.detourPoint(z)
            z.detourUntil = this.time + 1
            z.repathAt = this.time + 1
            z.flankGoal = null
        }
        const far = targets.length > 0 && targets.every(p => dist(p.pos, z.pos) > 90)
        const hopeless = z.stuckTime >= 7.5 || z.unreachableTime >= 12 || far
        // Recycled only out of sight, so nobody watches a zombie blink out; one in view keeps trying detours a while longer.
        if (hopeless && (z.stuckTime >= 30 || z.unreachableTime >= 40 || far || !this.seenByAnyone(z))) this.respawnZombie(z)
    }

    /** A nearby nav node it can walk straight to (a way around whatever holds it), else a random step. */
    private detourPoint(z: SimZombie): Vec3 {
        const opts = this.nav.around(z.pos, 4, 0.75).filter(i => hdist(this.nav.pos(i), z.pos) > 1).slice(0, 8)
        for (let k = 0; k < 3 && opts.length; k++) {
            const i = opts.splice(randomInt(0, opts.length - 1), 1)[0]!
            const n = this.nav.pos(i)
            if (this.walkable(z.pos, n)) return { ...n }
        }
        const a = randomFloat() * Math.PI * 2
        return { x: z.pos.x + Math.sin(a) * 2, y: z.pos.y, z: z.pos.z + Math.cos(a) * 2 }
    }

    /** Can any standing player see this zombie (within range, line of sight to its chest)? */
    private seenByAnyone(z: SimZombie): boolean {
        const c = zChest(z)
        for (const p of this.players) {
            if (p.life === 'dead' || !p.connected || dist(p.pos, z.pos) > UNSEEN_RANGE) continue
            if (dfLineOfSight(this.world, this.eye(p), c)) return true
        }
        return false
    }

    /** Puts a stuck zombie back into the spawn queue without counting a kill. */
    private respawnZombie(z: SimZombie): void {
        const idx = this.zombies.indexOf(z)
        if (idx < 0) return
        this.zombies.splice(idx, 1)
        this.toSpawn++
        this.spawnTimer = Math.min(this.spawnTimer, 0.5)
    }

    // ================================================================ projectiles

    private launchWeaponProjectile(p: SimPlayer, w: SimWeapon, origin: Vec3, dir: Vec3): void {
        const bolt = w.stats.shot === 'xray-bolt'
        const speed = w.stats.projectileSpeed > 0 ? w.stats.projectileSpeed : bolt ? 45 : 32
        this.projectiles.push({
            id: this.nextId++,
            kind: bolt ? 'xray-bolt' : DF_WEAPONS[w.id]?.temporary ? 'mortar' : 'pap-grenade',
            pos: { ...origin },
            vel: scale(dir, speed),
            tier: w.pap,
            owner: p.pid,
            weapon: w.id,
            life: bolt ? 2 : 3,
            resting: false,
            gravity: bolt ? 0 : 9,
            directDamage: w.stats.damage,
            splashRadius: w.stats.splashRadius > 0 ? w.stats.splashRadius : bolt ? 2 : 3.5,
            splashDamage: w.stats.splashDamage > 0 ? w.stats.splashDamage : w.stats.damage
        })
    }

    private stepProjectiles(dt: number): void {
        const live = this.projectiles
        this.projectiles = []
        const keep = live.filter(pr => this.stepProjectile(pr, dt))
        this.projectiles = [...keep, ...this.projectiles]
    }

    /** Advances one projectile; false once it exploded or expired. */
    private stepProjectile(pr: SimProjectile, dt: number): boolean {
        pr.life -= dt
        if (pr.life <= 0) {
            this.detonate(pr, pr.pos, null)
            return false
        }
        if (pr.resting) return true
        const steps = Math.max(1, Math.ceil((len(pr.vel) * dt) / 0.6))
        const h = dt / steps
        for (let s = 0; s < steps; s++) {
            pr.vel.y -= pr.gravity * h
            const move = scale(pr.vel, h)
            const l = len(move)
            if (l < 1e-6) continue
            const dir = scale(move, 1 / l)
            if (pr.kind !== 'grenade') {
                const zHit = pr.kind === 'spit' ? null : this.zombieOnSegment(pr.pos, dir, l)
                const pHit = pr.kind === 'spit' ? this.playerOnSegment(pr.pos, dir, l) : null
                const wall = dfRaycast(this.world, pr.pos, dir, l)
                if (zHit && (!wall || zHit.t <= wall.dist)) {
                    this.detonate(pr, add(pr.pos, scale(dir, zHit.t)), zHit.z)
                    return false
                }
                if (pHit !== null && (!wall || pHit <= wall.dist)) {
                    this.detonate(pr, add(pr.pos, scale(dir, pHit)), null)
                    return false
                }
                if (wall) {
                    this.detonate(pr, add(wall.point, scale(wall.normal, 0.08)), null)
                    return false
                }
                pr.pos = add(pr.pos, move)
            } else {
                const wall = dfRaycast(this.world, pr.pos, dir, l + 0.05)
                if (wall) {
                    pr.pos = add(wall.point, scale(wall.normal, 0.06))
                    const vn = dot(pr.vel, wall.normal)
                    const normal = scale(wall.normal, vn)
                    const tangent = sub(pr.vel, normal)
                    pr.vel = sub(scale(tangent, 0.7), scale(normal, 0.38))
                    if (wall.normal.y > 0.7 && len(pr.vel) < 1.2) {
                        pr.vel = { x: 0, y: 0, z: 0 }
                        pr.resting = true
                        return true
                    }
                } else {
                    pr.pos = add(pr.pos, move)
                }
            }
            if (pr.pos.y < this.map.bounds.min.y - 2) return false
        }
        return true
    }

    private zombieOnSegment(from: Vec3, dir: Vec3, l: number): { z: SimZombie, t: number } | null {
        let best: { z: SimZombie, t: number } | null = null
        for (const z of this.zombies) {
            const c = zChest(z)
            const near = dfRayPointApproach(from, dir, c)
            if (near.t > l + z.def.radius) continue
            if (near.miss <= z.def.radius + 0.2 + z.def.height * 0.25 && (!best || near.t < best.t)) best = { z, t: Math.min(near.t, l) }
        }
        return best
    }

    private playerOnSegment(from: Vec3, dir: Vec3, l: number): number | null {
        let best: number | null = null
        for (const p of this.players) {
            if (p.life === 'dead') continue
            const near = dfRayPointApproach(from, dir, this.chest(p))
            if (near.t > l + 0.5) continue
            if (near.miss <= 0.6 && (best === null || near.t < best)) best = Math.min(near.t, l)
        }
        return best
    }

    private detonate(pr: SimProjectile, at: Vec3, direct: SimZombie | null): void {
        pr.life = 0
        if (pr.kind === 'spit') {
            this.emit({ k: 'explode', pos: rv(at), radius: pr.splashRadius, kind: 'bloater' })
            for (const p of this.players) {
                if (p.life !== 'alive') continue
                const d = dist(this.chest(p), at)
                if (d > pr.splashRadius + 0.4) continue
                this.hurtPlayer(p, pr.splashDamage * (1 - 0.5 * clamp(d / (pr.splashRadius + 0.4), 0, 1)), -1, true)
            }
            return
        }
        const owner = this.player(pr.owner) ?? null
        const kind = pr.kind === 'xray-bolt' ? 'xray' : pr.kind === 'pap-grenade' ? 'pap-grenade' : 'grenade'
        const src: DamageSource = pr.kind === 'grenade'
            ? { weapon: 'grenade', credit: null, explosive: true }
            : { weapon: pr.weapon ?? 'm1911', credit: pr.weapon, explosive: true }
        this.pointsBatch = new Map()
        try {
            if (direct && owner && pr.directDamage > 0) {
                const dmg = pr.directDamage * owner.effects.damageMult * (owner.life === 'down' ? owner.effects.lastStandDamageMult : 1)
                this.damageZombie(direct, owner, dmg, 'body', { ...src, at })
            }
            const selfBase = pr.kind === 'grenade' ? 75 : pr.kind === 'pap-grenade' ? 30 : 0
            this.explode(at, pr.splashRadius, kind, owner, pr.splashDamage, src, selfBase, pr.kind === 'grenade' ? undefined : pr.tier)
        } finally {
            this.flushPoints()
        }
    }

    /** Splash damage to zombies (and the owner, scaled by explosive resistance). */
    private explode(at: Vec3, radius: number, kind: 'grenade' | 'pap-grenade' | 'xray' | 'shock', owner: SimPlayer | null, damage: number, src: DamageSource, selfDamage: number, tier?: number): void {
        // the tier rides on the event: the client colours the blast without having to find the bolt
        this.emit(tier === undefined ? { k: 'explode', pos: rv(at), radius, kind } : { k: 'explode', pos: rv(at), radius, kind, tier })
        const probe = { x: at.x, y: at.y + 0.3, z: at.z }
        const mult = owner ? owner.effects.damageMult * (owner.life === 'down' ? owner.effects.lastStandDamageMult : 1) : 1
        for (const z of [...this.zombies]) {
            const c = zChest(z)
            const d = dist(c, at)
            if (d > radius + z.def.radius) continue
            if (!dfLineOfSight(this.world, probe, c)) continue
            const k = 1 - 0.65 * clamp(d / radius, 0, 1)
            const killed = this.damageZombie(z, owner, damage * k * mult, 'body', { ...src, at: c })
            if (!killed && kind === 'shock' && z.state === 'hunt') {
                z.shockedUntil = this.time + 1
                this.stagger(z)
            }
        }
        if (owner && selfDamage > 0 && owner.life === 'alive') {
            const d = dist(this.chest(owner), at)
            if (d < radius) this.hurtPlayer(owner, selfDamage * (1 - d / radius), -1, true)
        }
    }

    // ================================================================ damage

    private stagger(z: SimZombie): void {
        if (z.state === 'climb' || z.state === 'rise' || z.state === 'stagger') return
        if (z.state === 'lunge' || z.state === 'charge') {
            // a stagger breaks a leap or charge (and its windup)
            z.dash = null
            z.resume = 'hunt'
        } else {
            z.resume = z.state === 'attack' || z.state === 'spit' ? (z.inside ? 'hunt' : 'tear') : z.state
        }
        z.state = 'stagger'
        z.anim = 'stagger'
        z.timer = STAGGER_TIME
    }

    /** Applies damage; true when it killed. Pays hit points (+10) and kill points. */
    private damageZombie(z: SimZombie, p: SimPlayer | null, dmg: number, zone: DfHitZone, src: DamageSource): boolean {
        if (z.hp <= 0 || !(dmg > 0)) return false
        const at = src.at ?? zChest(z)
        if (this.insta > 0) {
            z.hp = 0
        } else if (zone === 'head' && z.helmet > 0 && !src.explosive) {
            // The iron helmet soaks head hits until it breaks.
            z.helmet -= dmg
            if (p) this.emit({ k: 'hit', z: z.id, p: p.pid, zone, pos: rv(at), dmg: Math.round(dmg) })
            if (z.helmet <= 0) {
                z.helmet = 0
                this.stagger(z)
            }
            if (p && src.hitPoints !== false) this.addPoints(p, DF_POINTS.hit)
            return false
        } else {
            z.hp -= dmg
            // the shooter's client already showed this kill: finish a sliver rather than leave a ghost
            if (z.hp > 0 && src.claimKill && dfKillClaimHonoured(z.hp, dmg, z.maxHp)) z.hp = 0
        }
        if (z.hp > 0) {
            this.specials.onWound(z, dmg, zone, src.explosive === true)
            if (p) {
                this.emit({ k: 'hit', z: z.id, p: p.pid, zone, pos: rv(at), dmg: Math.round(dmg) })
                if (src.hitPoints !== false) this.addPoints(p, DF_POINTS.hit)
            }
            return false
        }
        this.killZombie(z, p, zone, src)
        return true
    }

    private killZombie(z: SimZombie, p: SimPlayer | null, zone: DfHitZone, src: DamageSource, opts: { noPoints?: boolean, noDrop?: boolean } = {}): void {
        z.hp = 0
        const idx = this.zombies.indexOf(z)
        if (idx >= 0) this.zombies.splice(idx, 1)
        const gib = src.explosive === true || (zone === 'head' && src.weapon !== 'knife' && randomChance(0.25))
        this.emit({ k: 'kill', z: z.id, p: p?.pid ?? -1, zone, weapon: src.weapon, pos: rv(z.pos), gib })
        if (z.type === 'bloater') {
            this.gas.push({ pos: { ...z.pos }, radius: DF_BLOATER.gasRadius, until: this.time + DF_BLOATER.gasSeconds })
            this.emit({ k: 'gas', pos: rv(z.pos), radius: DF_BLOATER.gasRadius, seconds: DF_BLOATER.gasSeconds })
            this.emit({ k: 'explode', pos: rv(zChest(z)), radius: 2, kind: 'bloater' })
        }
        if (p && !opts.noPoints) {
            p.kills++
            if (zone === 'head') p.headshots++
            if (src.credit && !DF_WEAPONS[src.credit]?.temporary) p.weaponKills[src.credit] = (p.weaponKills[src.credit] ?? 0) + 1
            this.addPoints(p, dfKillPoints(zone, src.melee === true))
            if (p.effects.killHeal > 0 && p.life === 'alive') p.health = Math.min(p.effects.maxHealth, p.health + p.effects.killHeal)
            // (never the lent launcher: its 12 shells are all it gets)
            if (p.effects.ammoOnKillChance > 0 && src.credit && !DF_WEAPONS[src.credit]?.temporary && randomChance(p.effects.ammoOnKillChance)) {
                const w = p.weapons.find(x => x.id === src.credit)
                if (w && w.mag < w.stats.magSize) w.mag++
            }
        }
        // The generator drinks souls of zombies killed near it.
        const gen = this.map.egg.generator.pos
        if (this.egg.step === 'charge' && dist(z.pos, gen) <= this.map.egg.chargeRadius) {
            const res = this.eggAction({ kind: 'soul', needed: this.egg.chargeNeeded })
            if (res.progressed) this.emit({ k: 'soul', from: rv(zChest(z)) })
        }
        if (!opts.noDrop) this.maybeDrop(z)
        this.specials.onKill(z, p, src.weapon, zone, opts)
        this.arsenal.onKill(z, p, src.weapon, zone, { ...opts, explosive: src.explosive === true, credit: src.credit })
    }

    private maybeDrop(z: SimZombie): void {
        if (!z.inside || z.state === 'rise') return
        this.killsSinceDrop++
        if (this.powerupsThisRound >= DF_POWERUP_MAX_PER_ROUND) return
        const chance = Math.min(0.12, 0.02 + this.killsSinceDrop * 0.0015)
        if (!randomChance(chance)) return
        const full = this.map.barricades.every(b => (this.planks[b.id] ?? 0) >= DF_BARRICADE_PLANKS)
        const kinds = POWERUP_KINDS.filter(k => k !== this.lastPowerup && !(k === 'carpenter' && full))
        if (!kinds.length) return
        const kind = weightedPick(kinds, k => POWERUP_WEIGHTS[k])
        this.powerupsThisRound++
        this.killsSinceDrop = 0
        this.lastPowerup = kind
        const g = dfGroundHeight(this.world, z.pos.x, z.pos.z, z.pos.y + 0.5)
        this.powerups.push({
            id: this.nextId++,
            kind,
            pos: { x: z.pos.x, y: Number.isFinite(g) && Math.abs(g - z.pos.y) < 1 ? g : z.pos.y, z: z.pos.z },
            expiresAt: this.time + DF_POWERUP_LIFETIME
        })
    }

    /** Spawns a specific power-up (debug, tests). */
    dropPowerup(kind: DfPowerupKind, pos: Vec3): void {
        this.powerups.push({ id: this.nextId++, kind, pos: { ...pos }, expiresAt: this.time + DF_POWERUP_LIFETIME })
    }

    private stepPowerups(): void {
        this.powerups = this.powerups.filter(pu => pu.expiresAt > this.time)
        for (const pu of [...this.powerups]) {
            const p = this.players.find(q => q.life === 'alive' && hdist(q.pos, pu.pos) < 1.4 && Math.abs(q.pos.y - pu.pos.y) < 1.6)
            if (!p) continue
            this.powerups = this.powerups.filter(x => x !== pu)
            this.applyPowerup(p, pu)
        }
    }

    private applyPowerup(p: SimPlayer, pu: SimPowerup): void {
        this.emit({ k: 'powerup', p: p.pid, kind: pu.kind })
        switch (pu.kind) {
            case 'maxammo':
                for (const q of this.players) {
                    // the lent launcher keeps its 12 shells; the weapon it stands in for is topped up like the rest
                    const stash = this.arsenal.stashed(q)
                    for (const w of [...q.weapons, ...(q.savedWeapons ?? []), ...(stash ? [stash] : [])]) {
                        if (!w.away && !DF_WEAPONS[w.id]?.temporary) w.reserve = this.maxReserve(q, w.stats.reserve)
                    }
                    q.grenades = DF_GRENADES.max
                }
                break
            case 'double':
                this.double = DF_POWERUP_SECONDS
                break
            case 'insta':
                this.insta = DF_POWERUP_SECONDS
                break
            case 'nuke':
                this.emit({ k: 'explode', pos: rv(pu.pos), radius: 60, kind: 'nuke' })
                for (const z of [...this.zombies]) this.killZombie(z, p, 'body', { weapon: 'grenade', credit: null }, { noPoints: true, noDrop: true })
                for (const q of this.players) if (q.life !== 'dead') this.addPoints(q, DF_POINTS.nuke)
                break
            case 'carpenter':
                for (const b of this.map.barricades) {
                    if ((this.planks[b.id] ?? 0) < DF_BARRICADE_PLANKS) {
                        this.planks[b.id] = DF_BARRICADE_PLANKS
                        this.emit({ k: 'plank', b: b.id, delta: 1 })
                    }
                }
                for (const q of this.players) if (q.life !== 'dead') this.addPoints(q, 200)
                break
        }
    }

    private addPoints(p: SimPlayer, base: number): void {
        const amount = dfScalePoints(base, p.effects.pointsMult, this.double > 0)
        if (amount <= 0) return
        p.points += amount
        if (this.pointsBatch) this.pointsBatch.set(p.pid, (this.pointsBatch.get(p.pid) ?? 0) + amount)
        else this.emit({ k: 'points', p: p.pid, amount })
    }

    /** Points without multipliers (refunds). */
    private grant(p: SimPlayer, amount: number): void {
        p.points += amount
        this.emit({ k: 'points', p: p.pid, amount })
    }

    /** Emits the batched points; the shooter's line carries their client shot id (`shot`) for prediction. */
    private flushPoints(shooter?: number, shot?: number): void {
        const batch = this.pointsBatch
        this.pointsBatch = null
        if (!batch) return
        for (const [pid, amount] of batch) {
            if (shot !== undefined && pid === shooter) this.emit({ k: 'points', p: pid, amount, shot })
            else this.emit({ k: 'points', p: pid, amount })
        }
    }

    // ================================================================ player life

    private hurtPlayer(p: SimPlayer, raw: number, zombieId: number, explosive: boolean): void {
        if (p.life !== 'alive' || this.devGod.has(p.pid)) return
        if (zombieId >= 0 && this.time < p.invulnUntil) return
        // No movement from them lately (a lag spike): we don't know where they really are, so a zombie can't land on them.
        if (zombieId >= 0 && p.connected) {
            const age = this.inputAge(p)
            const shielded = this.now() - (p.lastStallEnd ?? -Infinity) > STALL_SHIELD_COOLDOWN
            if (shielded && age > DF_STALE_INPUT && age < STALE_INPUT_MAX) return
        }
        const dmg = explosive ? raw * p.effects.explosiveResistMult : raw
        if (!(dmg > 0)) return
        p.lastDamageAt = this.time
        this.emit({ k: 'zhit', z: zombieId, p: p.pid, dmg: Math.round(dmg) })
        if (p.health - dmg > 0) {
            p.health -= dmg
            return
        }
        if (p.effects.deathWish && p.health >= p.effects.maxHealth - 0.5 && p.deathWishRound !== this.round) {
            p.deathWishRound = this.round
            p.health = 1
            return
        }
        this.downPlayer(p)
    }

    private downPlayer(p: SimPlayer): void {
        // a lent grenade launcher goes back before last stand sets the weapons aside
        this.arsenal.beforeDown(p)
        p.life = 'down'
        p.health = 0
        p.downs++
        p.bleedout = p.effects.bleedoutTime
        p.reviveProgress = 0
        p.reviving = -1
        p.reload = null
        p.swapUntil = 0
        p.flags &= ~DF_FLAG.sprint
        // The Last Stand mod comes with the Second Wind this down takes away: it still powers this last stand.
        const lastStand = p.perks.includes('secondwind') ? p.effects.lastStandDamageMult : 1
        // Second Wind's self-revive: use one charge and keep the perk if charges remain.
        let keep: DfPerkId[] = []
        if (p.selfRevivesLeft > 0) {
            p.selfRevivesLeft--
            p.selfReviveAt = this.time + SELF_REVIVE_DELAY
            if (p.selfRevivesLeft > 0 && p.perks.includes('secondwind')) keep = ['secondwind']
        } else {
            p.selfRevivesLeft = 0
            p.selfReviveAt = 0
        }
        p.perks = keep
        this.setEffects(p)
        p.effects.lastStandDamageMult = Math.max(p.effects.lastStandDamageMult, lastStand)
        if (!keep.length) p.selfRevivesLeft = 0
        // Last stand with a pistol: theirs if they carry one, otherwise their start pistol.
        // The weapon in hand comes back on revive.
        p.savedSlot = p.slot
        const pistol = p.weapons.findIndex(w => !w.away && DF_WEAPONS[w.id]?.class === 'pistol')
        if (pistol >= 0) {
            p.slot = pistol
            const w = p.weapons[pistol]!
            w.reserve = Math.max(w.reserve, w.stats.magSize * 2)
        } else {
            p.savedWeapons = p.weapons
            p.weapons = [this.makeWeapon(p, 'm1911', 0)]
            p.slot = 0
        }
        this.arsenal.onDown(p)
        this.emit({ k: 'down', p: p.pid })
    }

    private revivePlayer(p: SimPlayer, by: SimPlayer | null): void {
        if (p.life !== 'down') return
        p.life = 'alive'
        p.health = Math.max(1, p.effects.maxHealth * 0.5)
        p.lastDamageAt = this.time
        p.bleedout = 0
        p.reviveProgress = 0
        p.selfReviveAt = 0
        if (p.savedWeapons) {
            p.weapons = p.savedWeapons
            p.savedWeapons = null
        }
        p.slot = Math.min(p.savedSlot, Math.max(0, p.weapons.length - 1))
        if (p.weapons[p.slot]?.away) {
            const other = p.weapons.findIndex(w => !w.away)
            if (other >= 0) p.slot = other
        }
        p.reload = null
        p.swapUntil = this.time + 0.5
        p.invulnUntil = this.time + DF_REVIVE_GRACE
        if (by) {
            by.revives++
            by.reviving = -1
            this.addPoints(by, DF_POINTS.revive)
        }
        this.emit({ k: 'revived', p: p.pid, by: by?.pid ?? p.pid })
    }

    private respawn(p: SimPlayer): void {
        p.life = 'alive'
        p.perks = []
        p.selfRevivesLeft = 0
        p.selfReviveAt = 0
        this.setEffects(p)
        p.health = p.effects.maxHealth
        p.weapons = [this.makeWeapon(p, 'm1911', 0)]
        p.savedWeapons = null
        p.slot = 0
        p.reload = null
        p.grenades = DF_GRENADES.start
        p.pos = { ...this.spawnPoint(p.pid) }
        p.moveBudget = 2
        p.lastDamageAt = -100
        p.invulnUntil = this.time + DF_REVIVE_GRACE
        p.reviving = -1
        p.tp++
        this.emit({ k: 'respawn', p: p.pid })
    }

    private stepPlayers(dt: number): void {
        for (const p of this.players) {
            if (p.reload) {
                const w = p.weapons[p.reload.slot]
                if (!w || p.reload.slot !== p.slot) {
                    p.reload = null
                } else if (p.reload.perRound) {
                    while (p.reload && this.time >= p.reload.next) {
                        if (w.mag >= w.stats.magSize || w.reserve <= 0) {
                            p.reload = null
                            break
                        }
                        w.mag++
                        w.reserve--
                        p.reload.next += p.reload.per
                        if (w.mag >= w.stats.magSize || w.reserve <= 0) p.reload = null
                    }
                } else if (this.time >= p.reload.until) {
                    this.finishReload(p)
                }
            }
            if (p.life === 'alive') {
                if (this.time - p.lastDamageAt >= p.effects.regenDelay && p.health < p.effects.maxHealth) {
                    p.health = Math.min(p.effects.maxHealth, p.health + p.effects.regenRate * dt)
                }
                // Gas burns in half-second pulses so damage feedback isn't spammed every tick.
                if (this.tick % 10 === 0) {
                    for (const g of this.gas) {
                        if (hdist(g.pos, p.pos) < g.radius && Math.abs(g.pos.y - p.pos.y) < 2.2) {
                            this.hurtPlayer(p, DF_BLOATER.gasDps * dt * 10, -1, true)
                            break
                        }
                    }
                }
                if (p.reviving >= 0) {
                    const t = this.player(p.reviving)
                    if (!t || t.life !== 'down' || dist(p.pos, t.pos) > REVIVE_REACH + 0.3) p.reviving = -1
                }
            } else if (p.life === 'down') {
                this.stepDowned(p, dt)
            }
        }
    }

    private stepDowned(p: SimPlayer, dt: number): void {
        if (p.selfReviveAt > 0 && this.time >= p.selfReviveAt) {
            this.revivePlayer(p, null)
            return
        }
        const reviver = this.players.find(q => q.reviving === p.pid && q.life === 'alive' && q.connected)
        if (reviver) {
            p.reviveProgress += (dt * Math.max(0.1, reviver.effects.reviveMult)) / DF_PLAYER.reviveTime
            if (p.reviveProgress >= 1) this.revivePlayer(p, reviver)
            return
        }
        p.reviveProgress = 0
        if (p.selfReviveAt > 0) return
        p.bleedout -= dt
        if (p.bleedout <= 0) {
            p.life = 'dead'
            p.bleedout = 0
            p.savedWeapons = null
            this.emit({ k: 'bleedout', p: p.pid })
        }
    }

    // ================================================================ output

    emit(ev: DfEvent): void {
        this.events.push(ev)
    }

    /** The shared snapshot for this tick (everything but `ack`). Drains the event queue. */
    snapshot(): Omit<DfSnapshot, 'ack'> {
        const events = this.events
        this.events = []
        return {
            tick: this.tick,
            time: r2(this.time),
            round: this.round,
            phase: this.phase,
            phaseTimer: r2(Math.max(0, this.phaseTimer)),
            zombiesLeft: this.toSpawn + this.zombies.length,
            players: this.players.map(p => this.playerSnap(p)),
            zombies: this.zombies.map(z => this.zombieSnap(z)),
            projectiles: this.projectiles.map(pr => ({ id: pr.id, kind: pr.kind, pos: rv(pr.pos), vel: rv(pr.vel), tier: pr.tier })),
            powerups: this.powerups.map(pu => ({ id: pu.id, kind: pu.kind, pos: rv(pu.pos), expiresIn: r2(pu.expiresAt - this.time) })),
            world: {
                doors: [...this.doors],
                planks: { ...this.planks },
                power: this.power,
                box: { ...this.box, timer: r2(Math.max(0, this.box.timer)) },
                pap: { ...this.pap, timer: r2(Math.max(0, this.pap.timer)) },
                egg: { ...this.egg, fusesFound: [...this.egg.fusesFound], rodsOn: [...this.egg.rodsOn], rodTimer: Math.ceil(this.egg.rodTimer * 10) / 10 },
                double: r2(this.double),
                insta: r2(this.insta),
                ...this.specials.worldSnap(),
                arsenal: this.arsenal.worldSnap()
            },
            events
        }
    }

    private playerSnap(p: SimPlayer): DfPlayerSnap {
        let flags = p.flags & ~(DF_FLAG.reloading | DF_FLAG.reviving)
        if (p.reload) flags |= DF_FLAG.reloading
        if (p.reviving >= 0) flags |= DF_FLAG.reviving
        const busy = Math.max(0, p.reload ? (p.reload.perRound ? p.reload.next - this.time : p.reload.until - this.time) : 0, p.swapUntil - this.time)
        return {
            pid: p.pid,
            userId: p.setup.userId,
            name: p.setup.name,
            pos: rv(p.pos),
            yaw: r3(p.yaw),
            pitch: r3(p.pitch),
            flags,
            life: p.life,
            health: Math.ceil(p.health),
            maxHealth: p.effects.maxHealth,
            points: p.points,
            kills: p.kills,
            headshots: p.headshots,
            downs: p.downs,
            revives: p.revives,
            perks: [...p.perks],
            weapons: p.weapons.map((w): DfHeldWeapon => ({ id: w.id, pap: w.pap, mag: w.mag, reserve: w.reserve, attachments: w.attachments, maxReserve: this.maxReserve(p, w.stats.reserve), away: w.away || undefined, rarity: w.rarity || undefined })),
            slot: p.slot,
            grenades: p.grenades,
            bleedout: r2(p.bleedout),
            reviveProgress: r2(p.reviveProgress),
            selfRevives: p.selfRevivesLeft,
            connected: p.connected,
            tp: p.tp,
            busy: r2(busy),
            windBuys: this.solo ? p.secondwindBuys : undefined
        }
    }

    private zombieSnap(z: SimZombie): DfZombieSnap {
        const snap: DfZombieSnap = {
            id: z.id,
            type: z.type,
            pos: { x: r2(z.pos.x), y: r2(z.viewY), z: r2(z.pos.z) },
            yaw: r2(z.yaw),
            hp: r3(clamp(z.hp / z.maxHp, 0, 1)),
            anim: z.anim
        }
        // a zombie standing still (tearing, swinging, waiting) sends no velocity: clients read it as zero
        const vel = { x: r2(z.vel.x), y: r2(z.state === 'climb' || z.state === 'rise' ? z.vel.y : 0), z: r2(z.vel.z) }
        if (vel.x !== 0 || vel.y !== 0 || vel.z !== 0) snap.vel = vel
        if (z.type === 'brute') snap.armored = z.helmet > 0
        if (z.shockedUntil > this.time || this.insta > 0) snap.shocked = true
        if (z.state === 'lunge' && !z.dash) snap.tell = 'lunge'
        else if (z.state === 'charge' && !z.dash) snap.tell = 'charge'
        this.specials.decorate(z, snap)
        return snap
    }

    private endLine(p: SimPlayer): DfEndPlayer {
        return { pid: p.pid, name: p.setup.name, kills: p.kills, headshots: p.headshots, points: p.points, downs: p.downs, revives: p.revives }
    }

    /** Scoreboard for the end screen, including players who left early. */
    endPlayers(): DfEndPlayer[] {
        return [...this.players.map(p => this.endLine(p)), ...this.departed].sort((a, b) => a.pid - b.pid)
    }

    /** The round the squad fell on (or is on). */
    get finalRound(): number {
        return Math.max(1, this.round)
    }

    result(pid: number): DfMatchResult | null {
        const p = this.player(pid)
        if (!p) return null
        return {
            roundsSurvived: this.roundsCompleted,
            kills: p.kills,
            headshots: p.headshots,
            downs: p.downs,
            weaponKills: { ...p.weaponKills },
            weaponsFound: [...p.weaponsFound],
            completedEasterEgg: p.completedEgg
        }
    }

    ack(pid: number): number {
        return this.player(pid)?.seq ?? 0
    }
}

// ---------------------------------------------------------------- helpers

/**
 * The height a zombie is shown at. The physics lifts a body a whole stair step
 * in one tick; the shown height instead ramps over the step at a rate that
 * keeps up with the zombie's walking pace on stairs (45 degrees and steeper),
 * so it climbs instead of hopping. Climbs, rises and big drops follow at once.
 */
export function dfZombieViewY(viewY: number, y: number, speed: number, dt: number, follow: boolean): number {
    const d = y - viewY
    if (follow || Math.abs(d) > 1.2 || !Number.isFinite(viewY)) return y
    const rate = (1.2 + Math.max(0, speed) * 1.6) * dt
    return Math.abs(d) <= rate ? y : viewY + Math.sign(d) * rate
}

function isZone(v: unknown): v is DfHitZone {
    return v === 'head' || v === 'body' || v === 'limb'
}

function finiteVec(v: unknown): Vec3 | null {
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const x = o.x
    const y = o.y
    const z = o.z
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
    return { x, y, z }
}

function normalize(v: Vec3 | null): Vec3 | null {
    if (!v) return null
    const l = len(v)
    if (l < 1e-6) return null
    return { x: v.x / l, y: v.y / l, z: v.z / l }
}

/** Direction for a camera yaw/pitch (three.js convention: yaw 0 looks down -z). */
function forward(yaw: number, pitch: number): Vec3 {
    const c = Math.cos(pitch)
    return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c }
}

function zChest(z: SimZombie): Vec3 {
    return { x: z.pos.x, y: z.pos.y + z.def.height * 0.6, z: z.pos.z }
}

function add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(a: Vec3, k: number): Vec3 {
    return { x: a.x * k, y: a.y * k, z: a.z * k }
}

function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z
}

function len(a: Vec3): number {
    return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
}

function dist(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function hdist(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.z - b.z)
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}

function r2(v: number): number {
    return Math.round(v * 100) / 100
}

function r3(v: number): number {
    return Math.round(v * 1000) / 1000
}

function rv(v: Vec3): Vec3 {
    return { x: r2(v.x), y: r2(v.y), z: r2(v.z) }
}

function wrapAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2
    while (a < -Math.PI) a += Math.PI * 2
    return a
}

function turnToward(from: number, to: number, maxStep: number): number {
    let d = to - from
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    if (Math.abs(d) <= maxStep) return to
    return from + Math.sign(d) * maxStep
}

function weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    const weights = items.map(weight)
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = randomFloat() * total
    for (let i = 0; i < items.length; i++) {
        roll -= weights[i]!
        if (roll < 0) return items[i]!
    }
    return items[items.length - 1]!
}

/** The map's lightning-rod switches (the easter egg's last step); none on a map without them. */
export function dfEggRods(map: DfMapDef): DfSpot[] {
    return map.egg.rods ?? []
}
