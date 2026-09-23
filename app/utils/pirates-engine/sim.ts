import {
    PIRATE_RUN_DURATION_MS, PIRATE_TIMELINE_SCALE, PIRATE_LATE_BOSS_PHASE_MS,
    PIRATE_POWER_UP_INTERVAL_MS, PIRATE_POWER_UP_LIFESPAN_MS, PIRATE_POWER_UP_KILL_DROP_CHANCE,
    PIRATE_HEALTH_PACK_INTERVAL_MS, PIRATE_HEALTH_PACK_LIFESPAN_MS, PIRATE_HEALTH_PACK_KILL_DROP_CHANCE,
    PIRATE_SEA_MINE_INTERVAL_MS, PIRATE_SEA_MINE_LIFESPAN_MS,
    PIRATE_REGEN_DELAY_MS, pirateRegenTickIntervalMs,
    PIRATE_HUNTER_CHAIN_COUNT, PIRATE_HUNTER_CHAIN_INTERVAL_MS, pirateHunterChainDamage,
    pirateBombDamage, pirateMaelstromPulseDamage, PIRATE_MAELSTROM_RADIUS, PIRATE_MAELSTROM_PULL, pirateClampAbilityLevel, pirateAbilityCooldownMs,
    PIRATE_CONSORT_FOLLOW_DISTANCE, pirateConsortStatFraction, pirateConsortHpFraction, pirateConsortCannonCount,
    pirateConsortDamageFraction,
    PIRATE_HELLFIRE_ZONE_RADIUS, PIRATE_HELLFIRE_SHELL_COUNT, PIRATE_HELLFIRE_BLAST_RADIUS, pirateHellfireShellDamage,
    PIRATE_ROGUE_WAVE_LENGTH, PIRATE_ROGUE_WAVE_WIDTH, PIRATE_ROGUE_WAVE_SPEED, PIRATE_ROGUE_WAVE_KNOCKBACK, pirateRogueWaveDamage,
    PIRATE_CANNON_TIERS, PIRATE_ENEMY_TIERS,
    PIRATE_AMMO_RANGE_MULT, PIRATE_AMMO_DAMAGE_MULT,
    PIRATE_GEM_AMMO_ATTACK_MULT, PIRATE_GEM_AMMO_DAMAGE_MULT,
    PIRATE_BOSS_RESPAWN_MS, PIRATE_BOSS_DAMAGE_MULT, PIRATE_DOUBLE_BOSS_DIFFICULTY,
    PIRATE_BOSS_ABILITY_INITIAL_MIN_MS, PIRATE_BOSS_ABILITY_INITIAL_MAX_MS,
    PIRATE_BOSS_ABILITY_COOLDOWN_MIN_MS, PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS,
    PIRATE_UPGRADE_EFFECTS, PIRATE_POWER_UPS, PIRATE_RARITIES,
    pirateSpawnIntervalMs, pirateMaxConcurrentEnemies, pirateRollEnemyTier, pirateDifficultyMultiplier,
    pirateRollAttack, pirateBossFirstSpawnMs, pirateRollBoss, pirateRollPowerUp, piratePowerUp,
    pirateInitialEnemyCount, pirateSpawnBatchSize,
    pirateSeaMineDamageFraction, pirateCannonTier,
    pirateEnemyReloadMultiplier, pirateSurvivalCoins, pirateSurvivalCoinRate,
    type PirateAbilityId, type PirateEnemyAbility, type PirateEnemyTier, type PiratePowerUpId, type PirateRarity
} from '#shared/utils/gamelogic/pirates'
import type { PirateAutopilotSnapshot } from '#shared/utils/gamelogic/pirates-autopilot'
import { randomFloat } from '#shared/utils/random'
import {
    WORLD_W, WORLD_H, BALL_SPEED, PLAYER_CANNON_FIRE_GAP_MS, PICKUP_RADIUS, HOLD_RANGE_FRACTION,
    WAYPOINT_REACH_DIST, PLAYER_BOMB_RADIUS, GUN_FIRE_ARC, GUN_SLEW_RATE, SHIP_RADIUS
} from './constants'
import { ENEMY_GUNS, PLAYER_GUN_SIZE, enemyHull, hullHitRadius, pirateGunMounts, playerHull } from './layout'
import { angleDiff, clamp, dist, dist2, randRange, segPointDist, turnToward } from './math'
import { PirateNavGrid, generateIslandLayout } from './nav-grid'
import type {
    Island, PirateAnnouncement, PirateGameOverResult, PirateHudState, PirateShipStats, PirateSoundEvent,
    Point, ProjectileKind, SimAlly, SimEnemy, SimEvent, SimGun, SimPickup, SimPlayer, SimProjectile,
    SimSeaMine, SimTelegraph, SimWreck, SimZone, SoundOptions, ZoneKind
} from './types'

// PirateSim: the whole voyage as plain data. It never touches the DOM, a
// canvas or audio. The renderer reads its public arrays each frame, and every
// one-off cosmetic (flashes, numbers, sounds) leaves as an event in `events`,
// which the owner drains. A headless balance run can drive it straight from
// bun with nothing but start() and step().

const FIXED_STEP_MS = 1000 / 60
const MAX_STEPS_PER_CALL = 10
const MAX_BUFFERED_EVENTS = 4000

const PLAYER_TURN_RATE = 3.4
const PLAYER_ACCEL = 440
const PLAYER_DECEL = 560
const ENEMY_TURN_RATE = 2.6
const WRECK_MS = 1600
const PLAYER_HIT_RADIUS = hullHitRadius(playerHull())
const HULL_POPUP_MS = 140
const PLAYER_POPUP_MS = 120

type AmmoKind = 'free' | 'standard' | 'gem'

interface PlayerGun extends SimGun {
    tierId: string
    attackRating: number
    maxDamage: number
    reloadMs: number
    range: number
    reloadTimer: number
    shotTrail: boolean
    mutated: boolean
    /** Resting angle relative to the hull when there is nothing to shoot. */
    rest: number
}

interface AllyGun extends SimGun {
    attackRating: number
    maxDamage: number
    reloadMs: number
    range: number
    reloadTimer: number
    rest: number
}

interface EnemyGun extends SimGun {
    rest: number
}

interface Enemy extends SimEnemy {
    guns: EnemyGun[]
    hitRadius: number
    reloadTimer: number
    abilityTimer: number
    strafe: 1 | -1
    /** Kraken: ms surfaced; fire ship: fuse left. */
    timerMs: number
    damageSinceSurface: number
    popupAcc: number
    popupTimer: number
    popupCrit: boolean
    dead: boolean
}

interface Ally extends SimAlly {
    guns: AllyGun[]
    defenseRating: number
    speed: number
    fireGapMs: number
    dead: boolean
}

interface Projectile extends SimProjectile {
    fromX: number
    fromY: number
    toX: number
    toY: number
    durationMs: number
    arc: number
    /** Lobbed shots rise and fall; falling shells only fall. */
    fall: boolean
    motion: 'lerp' | 'homing' | 'spiral'
    /** Keeps a cannonball's end point on its moving target, offset by the spread it was fired with. */
    track: { kind: 'enemy' | 'player' | 'ally', id: number } | null
    spreadX: number
    spreadY: number
    /** > 0: collides with the player's hull on the way (skiffs, mines, sniper rounds, harpoons, spiral shot). */
    contactRadius: number
    onContact: (() => void) | null
    onLand: ((x: number, y: number) => void) | null
    /** Homing warheads. */
    speed: number
    targetId: number
    /** Spiral shot. */
    cx: number
    cy: number
    theta: number
    spin: number
    radius: number
    radialSpeed: number
    dead: boolean
}

interface Telegraph extends SimTelegraph {
    dead: boolean
}

interface Zone extends SimZone {
    pulseTimer: number
    pulsesLeft: number
    damage: number
    hit: Set<number>
    travelled: number
    tickTimer: number
    dead: boolean
}

interface Pickup extends SimPickup {
    healFraction: number
    dead: boolean
}

interface Mine extends SimSeaMine {
    damageFraction: number
    dead: boolean
}

interface Wreck extends SimWreck {
    dead: boolean
}

interface Timer {
    at: number
    fn: () => void
}

export interface PirateSimHooks {
    onGameOver?: (result: PirateGameOverResult) => void
    onAnnounce?: (announcement: PirateAnnouncement) => void
}

const ROMAN = ['', '', ' II', ' III', ' IV', ' V']

/** Where the damage the captain deals comes from, for the debrief and balance runs. */
export type PirateDamageSource = 'cannon' | 'ability' | 'upgrade' | 'hazard'

function rarityIndex(rarity: PirateRarity) {
    return PIRATE_RARITIES.findIndex(entry => entry.id === rarity)
}

function tierRank(tierId: string) {
    return PIRATE_CANNON_TIERS.findIndex(tier => tier.id === tierId)
}

export class PirateSim {
    // ─── State the renderer reads ───────────────────────────────────────────
    player: SimPlayer
    enemies: Enemy[] = []
    allies: Ally[] = []
    wrecks: Wreck[] = []
    projectiles: Projectile[] = []
    telegraphs: Telegraph[] = []
    zones: Zone[] = []
    pickups: Pickup[] = []
    mines: Mine[] = []
    islands: Island[] = []
    elapsedMs = 0
    running = false
    difficulty = 0
    power = 5
    abilityId: PirateAbilityId = 'bomb'
    abilityLevel = 1
    events: SimEvent[] = []
    powerUpStacks = new Map<PiratePowerUpId, number>()
    /** Hull damage dealt this voyage, split by what dealt it. */
    damageBySource: Record<PirateDamageSource, number> = { cannon: 0, ability: 0, upgrade: 0, hazard: 0 }

    // ─── Internals ─────────────────────────────────────────────────────────
    private hooks: PirateSimHooks
    private stats!: PirateShipStats
    private nav = new PirateNavGrid()
    private cannons: PlayerGun[] = []
    private accumulatorMs = 0
    private nextId = 1
    private timers: Timer[] = []
    private baseMaxHp = 100
    private steerX = 0
    private steerY = 0
    private msSinceHit = 0
    private regenTickMs = 0
    private shieldRefillMs = 0
    private ammo = 0
    private gemAmmo = 0
    private ammoStart = 0
    private gemAmmoStart = 0
    private preferGem = false
    private fireGapMs = 0
    private titanCounter = 0
    private abilityCooldownRemaining = 0
    private warheadTimerMs = 0
    private spawnTimerMs = 0
    private bossTimerMs = 0
    private lastBossId: string | null = null
    private crateTimerMs = PIRATE_POWER_UP_INTERVAL_MS
    private repairTimerMs = PIRATE_HEALTH_PACK_INTERVAL_MS
    private mineTimerMs = PIRATE_SEA_MINE_INTERVAL_MS
    private playerPopupAcc = 0
    private playerPopupTimer = 0
    private lowHullWarned = false
    private kills = 0
    private bossesSunk = 0
    private shotsFired = 0
    private abilitiesUsed = 0
    private damageDealt = 0
    private sunkByType = new Map<string, { name: string, count: number }>()
    private ended = false

    constructor(hooks: PirateSimHooks = {}) {
        this.hooks = hooks
        this.player = this.freshPlayer('starter')
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────

    /** Lay out a fresh sea with the ship idling in the middle, before any voyage. */
    prepare(stats: PirateShipStats) {
        this.stats = stats
        this.abilityId = stats.abilityId
        this.abilityLevel = pirateClampAbilityLevel(stats.abilityLevel ?? 1)
        this.player = this.freshPlayer(stats.skinId)
        this.baseMaxHp = stats.maxHp
        this.player.hp = stats.maxHp
        this.player.maxHp = stats.maxHp
        this.buildCannons(stats)
        this.setIslands(generateIslandLayout())
    }

    setSkin(skinId: string) {
        this.player.skinId = skinId
        if (this.stats) this.stats.skinId = skinId
    }

    start(stats: PirateShipStats, power: number, difficulty: number, options: { islands?: Island[] } = {}) {
        this.stats = stats
        this.power = power
        this.difficulty = difficulty
        this.abilityId = stats.abilityId
        this.abilityLevel = pirateClampAbilityLevel(stats.abilityLevel ?? 1)
        this.enemies = []
        this.allies = []
        this.wrecks = []
        this.projectiles = []
        this.telegraphs = []
        this.zones = []
        this.pickups = []
        this.mines = []
        this.timers = []
        this.events = []
        this.powerUpStacks.clear()
        this.elapsedMs = 0
        this.accumulatorMs = 0
        this.player = this.freshPlayer(stats.skinId)
        this.baseMaxHp = stats.maxHp
        this.player.hp = stats.maxHp
        this.player.maxHp = stats.maxHp
        this.buildCannons(stats)
        this.setIslands(options.islands ?? generateIslandLayout())
        this.steerX = 0
        this.steerY = 0
        this.msSinceHit = 0
        this.regenTickMs = 0
        this.shieldRefillMs = 0
        this.ammo = stats.ammo
        this.gemAmmo = stats.gemAmmo
        this.ammoStart = stats.ammo
        this.gemAmmoStart = stats.gemAmmo
        this.preferGem = false
        this.fireGapMs = 0
        this.titanCounter = 0
        this.abilityCooldownRemaining = 0
        this.warheadTimerMs = 0
        this.spawnTimerMs = pirateSpawnIntervalMs(0, difficulty)
        this.bossTimerMs = pirateBossFirstSpawnMs(difficulty)
        this.lastBossId = null
        this.crateTimerMs = PIRATE_POWER_UP_INTERVAL_MS
        this.repairTimerMs = PIRATE_HEALTH_PACK_INTERVAL_MS
        this.mineTimerMs = PIRATE_SEA_MINE_INTERVAL_MS
        this.playerPopupAcc = 0
        this.playerPopupTimer = 0
        this.lowHullWarned = false
        this.kills = 0
        this.bossesSunk = 0
        this.shotsFired = 0
        this.abilitiesUsed = 0
        this.damageDealt = 0
        this.damageBySource = { cannon: 0, ability: 0, upgrade: 0, hazard: 0 }
        this.sunkByType.clear()
        this.ended = false
        this.running = true

        const opening = pirateInitialEnemyCount(difficulty)
        for (let i = 0; i < opening; i++) this.spawnEnemy(pirateRollEnemyTier(0, difficulty))
        // An opening crate gives every voyage a first decision to make.
        this.spawnCrate()
        this.sound('voyage-start')
    }

    /** End the voyage early by player choice. */
    cancel() {
        if (!this.running) return
        this.endGame(false, 'cancelled')
    }

    /**
     * Advance by `dtMs` of real time. The simulation runs in fixed 60 Hz
     * steps so a headless run and a live one behave the same. After the
     * voyage ends only the cosmetic tails (wrecks sinking, flashes) move.
     */
    step(dtMs: number) {
        this.accumulatorMs = Math.min(this.accumulatorMs + Math.max(0, dtMs), FIXED_STEP_MS * MAX_STEPS_PER_CALL)
        while (this.accumulatorMs >= FIXED_STEP_MS) {
            this.accumulatorMs -= FIXED_STEP_MS
            if (this.running) this.tick(FIXED_STEP_MS)
            else this.tickCosmetic(FIXED_STEP_MS)
        }
        if (this.events.length > MAX_BUFFERED_EVENTS) this.events.splice(0, this.events.length - MAX_BUFFERED_EVENTS)
    }

    /** Hand over and clear the buffered events. */
    drainEvents() {
        const drained = this.events
        this.events = []
        return drained
    }

    // ─── Orders ─────────────────────────────────────────────────────────────

    /** Sail to a point, pathing around islands. */
    sailTo(x: number, y: number, marker = true) {
        if (!this.running) return
        this.player.attackTargetId = null
        this.steerX = 0
        this.steerY = 0
        this.player.path = this.nav.computePath(this.player.x, this.player.y, clamp(x, 40, WORLD_W - 40), clamp(y, 40, WORLD_H - 40))
        const goal = this.player.path[this.player.path.length - 1]
        if (goal && marker) this.emit({ type: 'move-marker', x: goal.x, y: goal.y })
    }

    /** Direct keyboard steering. A zero vector hands the helm back (the ship eases to a stop). */
    steer(dx: number, dy: number) {
        const len = Math.hypot(dx, dy)
        this.steerX = len > 0 ? dx / len : 0
        this.steerY = len > 0 ? dy / len : 0
        if (len > 0) {
            this.player.path = []
            this.player.attackTargetId = null
        }
    }

    get steering() {
        return this.steerX !== 0 || this.steerY !== 0
    }

    /** Chase an enemy into range and focus every gun on it. */
    attack(enemyId: number) {
        const enemy = this.enemies.find(e => e.id === enemyId)
        if (!this.running || !enemy || enemy.dead || !this.targetable(enemy)) return false
        this.player.attackTargetId = enemyId
        this.player.path = []
        return true
    }

    heaveTo() {
        this.player.attackTargetId = null
        this.player.path = []
        this.steerX = 0
        this.steerY = 0
    }

    setPreferGem(prefer: boolean) {
        this.preferGem = prefer
    }

    get prefersGem() {
        return this.preferGem
    }

    enemyAt(x: number, y: number): SimEnemy | null {
        let best: Enemy | null = null
        let bestD = Infinity
        for (const enemy of this.enemies) {
            if (enemy.dead || !this.targetable(enemy)) continue
            const d = dist(x, y, enemy.x, enemy.y)
            if (d <= enemy.hitRadius + 14 && d < bestD) {
                best = enemy
                bestD = d
            }
        }
        return best
    }

    pickupAt(x: number, y: number): SimPickup | null {
        return this.pickups.find(pickup => !pickup.dead && dist(x, y, pickup.x, pickup.y) <= 40) ?? null
    }

    blocked(x: number, y: number) {
        return this.nav.pointInIsland(x, y)
    }

    get abilityReady() {
        return this.running && this.abilityCooldownRemaining <= 0 && !this.consortAtSea
    }

    /** Full cooldown of the equipped ability right now (Kraken's Heart shortens it). */
    get abilityCooldownMs() {
        const heart = this.stack('krakens-heart') > 0 ? 1 - PIRATE_UPGRADE_EFFECTS.heartCooldown : 1
        return Math.round(pirateAbilityCooldownMs(this.abilityId, this.abilityLevel) * heart)
    }

    get abilityRemainingMs() {
        return this.abilityCooldownRemaining
    }

    /** Cast the equipped ability at a world point. False while it is unavailable. */
    castAbility(x: number, y: number) {
        if (!this.running) return false
        if (this.abilityCooldownRemaining > 0) {
            this.popup(x, y - 20, `${Math.ceil(this.abilityCooldownRemaining / 1000)}s`, 0xfde68a, false)
            return false
        }
        if (this.consortAtSea) {
            this.popup(x, y - 20, 'CONSORT AT SEA', 0xbfdbfe, false)
            return false
        }
        x = clamp(x, 30, WORLD_W - 30)
        y = clamp(y, 30, WORLD_H - 30)
        this.abilitiesUsed += 1
        // The consort defers its cooldown until the escort sinks.
        if (this.abilityId !== 'consort') this.abilityCooldownRemaining = this.abilityCooldownMs
        switch (this.abilityId) {
            case 'seekers': this.castHunterChain(); break
            case 'consort': this.castConsort(); break
            case 'maelstrom': this.castMaelstrom(x, y); break
            case 'firestorm': this.castHellfire(x, y); break
            case 'tidal': this.castRogueWave(x, y); break
            default: this.castKeg(x, y)
        }
        return true
    }

    // ─── HUD / autopilot views ──────────────────────────────────────────────

    hud(): PirateHudState {
        const bosses = this.enemies
            .filter(enemy => !enemy.dead && enemy.tier.boss)
            .map(enemy => ({
                id: enemy.id,
                name: enemy.tier.name,
                kind: enemy.tier.boss!,
                hp: Math.max(0, enemy.hp),
                maxHp: enemy.maxHp,
                shield: enemy.shield,
                hidden: !this.targetable(enemy)
            }))
        return {
            elapsedMs: this.elapsedMs,
            remainingMs: Math.max(0, PIRATE_RUN_DURATION_MS - this.elapsedMs),
            hp: Math.max(0, Math.ceil(this.player.hp)),
            maxHp: this.player.maxHp,
            shield: Math.ceil(this.player.shield),
            maxShield: this.player.maxShield,
            coins: this.coins,
            coinRate: pirateSurvivalCoinRate(this.elapsedMs, this.difficulty),
            ammo: this.ammo,
            gemAmmo: this.gemAmmo,
            preferGem: this.preferGem,
            ability: {
                id: this.abilityId,
                level: this.abilityLevel,
                remainingMs: this.abilityCooldownRemaining,
                totalMs: this.abilityCooldownMs,
                locked: this.consortAtSea,
                ready: this.abilityReady
            },
            powerUps: PIRATE_POWER_UPS.filter(p => this.stack(p.id) > 0).map(p => ({ id: p.id, stacks: this.stack(p.id) })),
            kills: this.kills,
            enemiesAfloat: this.enemies.filter(enemy => !enemy.dead).length,
            bosses,
            tethered: this.player.tetherMs > 0,
            nextCrateMs: Math.max(0, this.crateTimerMs)
        }
    }

    get coins() {
        return pirateSurvivalCoins(this.elapsedMs, this.difficulty)
    }

    /** Effective reach of the longest gun right now. */
    get cannonRange() {
        const longest = this.cannons.reduce((max, gun) => Math.max(max, gun.range), 0)
        return longest * this.rangeMult()
    }

    get sailSpeed() {
        return this.maxSpeed()
    }

    autopilotView(): PirateAutopilotSnapshot & { speed: number } {
        const p = this.player
        const nearest = (kind: SimPickup['kind']) => {
            let best: Pickup | null = null
            let bestD = Infinity
            for (const pickup of this.pickups) {
                if (pickup.dead || pickup.kind !== kind) continue
                const d = dist2(p.x, p.y, pickup.x, pickup.y)
                if (d < bestD) {
                    best = pickup
                    bestD = d
                }
            }
            return best ? { x: best.x, y: best.y } : null
        }
        return {
            t: this.elapsedMs,
            x: p.x,
            y: p.y,
            hull: p.hp / Math.max(1, p.maxHp),
            shield: p.shield,
            range: this.cannonRange,
            keg: this.abilityId === 'bomb' && this.abilityReady,
            powerUps: [...this.powerUpStacks.values()].reduce((sum, n) => sum + n, 0),
            speed: this.maxSpeed(),
            enemies: this.enemies
                .filter(enemy => !enemy.dead && this.targetable(enemy))
                .map(enemy => ({ id: enemy.id, tier: enemy.tier.id, x: enemy.x, y: enemy.y, hp: enemy.hp / enemy.maxHp, range: enemy.tier.range })),
            hazards: this.telegraphs
                .filter(t => !t.dead && t.hostile)
                .map(t => t.kind === 'line' ? { x: t.x2, y: t.y2, r: Math.max(40, t.width * 3) } : { x: t.x, y: t.y, r: t.r }),
            mines: this.mines.filter(mine => !mine.dead).map(mine => ({ x: mine.x, y: mine.y })),
            islands: this.islands.map(({ x, y, r }) => ({ x, y, r })),
            supply: nearest('crate'),
            repair: nearest('repair')
        }
    }

    // ─── Setup helpers ──────────────────────────────────────────────────────

    private freshPlayer(skinId: string): SimPlayer {
        return {
            x: WORLD_W / 2,
            y: WORLD_H / 2,
            angle: -Math.PI / 2,
            velocity: 0,
            hp: 100,
            maxHp: 100,
            shield: 0,
            maxShield: 0,
            skinId,
            guns: [],
            flashMs: 0,
            tetherMs: 0,
            tetherFrom: null,
            warheads: 0,
            warheadSpin: 0,
            path: [],
            attackTargetId: null,
            alive: true
        }
    }

    private buildCannons(stats: PirateShipStats) {
        const hull = playerHull()
        const sorted = [...stats.cannons].sort((a, b) => a.slotIndex - b.slotIndex)
        const mounts = pirateGunMounts(sorted.length, hull)
        this.cannons = sorted.map((cannon, index) => {
            const mount = mounts[index]!
            const size = PLAYER_GUN_SIZE[cannon.tierId] ?? PLAYER_GUN_SIZE.swivel!
            const rest = mount.y === 0 ? 0 : mount.y < 0 ? -Math.PI / 2 : Math.PI / 2
            return {
                mountX: mount.x,
                mountY: mount.y,
                aim: this.player.angle + rest,
                color: cannon.shotColor,
                length: size.length,
                bore: size.bore,
                recoil: 0,
                charge: 1,
                style: 'cannon' as const,
                tierId: cannon.tierId,
                attackRating: cannon.attackRating,
                maxDamage: cannon.maxDamage,
                reloadMs: cannon.reloadMs,
                range: cannon.range,
                reloadTimer: randRange(0, cannon.reloadMs * 0.5 * PIRATE_TIMELINE_SCALE),
                shotTrail: cannon.shotTrail,
                mutated: pirateCannonTier(cannon.tierId).mutatedTrail ?? false,
                rest
            }
        })
        this.player.guns = this.cannons
    }

    private setIslands(islands: Island[]) {
        this.islands = islands
        this.nav.setIslands(islands)
    }

    // ─── Event helpers ──────────────────────────────────────────────────────

    private emit(event: SimEvent) {
        this.events.push(event)
    }

    private sound(sound: PirateSoundEvent, x?: number, intensity?: number) {
        const options: SoundOptions | undefined = x === undefined && intensity === undefined ? undefined : { x, intensity }
        this.events.push({ type: 'sound', sound, options })
    }

    private popup(x: number, y: number, text: string, color: number, big: boolean) {
        this.events.push({ type: 'popup', x, y, text, color, big })
    }

    private announce(announcement: PirateAnnouncement) {
        this.hooks.onAnnounce?.(announcement)
    }

    private schedule(delayMs: number, fn: () => void) {
        this.timers.push({ at: this.elapsedMs + delayMs, fn })
    }

    private telegraph(kind: SimTelegraph['kind'], x: number, y: number, r: number, durationMs: number, color: number, hostile = true, x2 = x, y2 = y, width = 0) {
        const t: Telegraph = { id: this.nextId++, kind, x, y, x2, y2, r, width, color, ageMs: 0, durationMs, hostile, dead: false }
        this.telegraphs.push(t)
        return t
    }

    private stack(id: PiratePowerUpId) {
        return this.powerUpStacks.get(id) ?? 0
    }

    // ─── Main tick ──────────────────────────────────────────────────────────

    private tick(dtMs: number) {
        const dt = dtMs / 1000
        this.elapsedMs += dtMs

        this.runTimers()
        this.updateAbilityCooldown(dtMs)
        this.updateRegenAndShield(dtMs)
        this.updatePlayer(dt, dtMs)
        this.updatePlayerGuns(dt, dtMs)
        this.updateWarheads(dt, dtMs)
        this.updateAllies(dt, dtMs)
        this.updateEnemies(dt, dtMs)
        this.updateProjectiles(dtMs)
        this.updateTelegraphs(dtMs)
        this.updateZones(dt, dtMs)
        this.updatePickups(dt, dtMs)
        this.updateMines(dtMs)
        this.updateSpawning(dtMs)
        this.tickCosmetic(dtMs)
        this.flushPopups(dtMs)
        this.cleanup()

        if (this.running && this.elapsedMs >= PIRATE_RUN_DURATION_MS) this.endGame(true, 'timeout')
    }

    /** The parts that keep moving after the voyage ends: sinking hulls and fading telegraphs. */
    private tickCosmetic(dtMs: number) {
        for (const wreck of this.wrecks) {
            wreck.progress = Math.min(1, wreck.progress + dtMs / WRECK_MS)
            if (wreck.progress >= 1) wreck.dead = true
        }
        if (this.player.flashMs > 0) this.player.flashMs = Math.max(0, this.player.flashMs - dtMs)
        if (!this.running) {
            for (const t of this.telegraphs) {
                t.ageMs += dtMs
                if (t.ageMs >= t.durationMs) t.dead = true
            }
            for (const z of this.zones) {
                z.ageMs += dtMs
                if (z.ageMs >= z.durationMs) z.dead = true
            }
            this.cleanup()
        }
    }

    private updateTelegraphs(dtMs: number) {
        for (const t of this.telegraphs) {
            t.ageMs += dtMs
            if (t.ageMs >= t.durationMs) t.dead = true
        }
    }

    private runTimers() {
        if (!this.timers.length) return
        // Timers can schedule more timers; only run the ones already due.
        const due: Timer[] = []
        this.timers = this.timers.filter((timer) => {
            if (timer.at <= this.elapsedMs) {
                due.push(timer)
                return false
            }
            return true
        })
        for (const timer of due) {
            if (!this.running) return
            timer.fn()
        }
    }

    private cleanup() {
        if (this.enemies.some(e => e.dead)) this.enemies = this.enemies.filter(e => !e.dead)
        if (this.allies.some(a => a.dead)) this.allies = this.allies.filter(a => !a.dead)
        if (this.projectiles.some(p => p.dead)) this.projectiles = this.projectiles.filter(p => !p.dead)
        if (this.telegraphs.some(t => t.dead)) this.telegraphs = this.telegraphs.filter(t => !t.dead)
        if (this.zones.some(z => z.dead)) this.zones = this.zones.filter(z => !z.dead)
        if (this.pickups.some(p => p.dead)) this.pickups = this.pickups.filter(p => !p.dead)
        if (this.mines.some(m => m.dead)) this.mines = this.mines.filter(m => !m.dead)
        if (this.wrecks.some(w => w.dead)) this.wrecks = this.wrecks.filter(w => !w.dead)
    }

    private updateAbilityCooldown(dtMs: number) {
        if (this.abilityCooldownRemaining <= 0) return
        this.abilityCooldownRemaining = Math.max(0, this.abilityCooldownRemaining - dtMs)
        if (this.abilityCooldownRemaining === 0 && !this.consortAtSea) this.sound('ability-ready')
    }

    // ─── Player ─────────────────────────────────────────────────────────────

    private maxSpeed() {
        const p = this.player
        let speed = this.stats.speed * (1 + this.stack('following-wind') * PIRATE_UPGRADE_EFFECTS.followingWindSpeedPerStack)
        if (p.tetherMs > 0) speed *= 0.45
        if (this.insideZone('ink', p.x, p.y)) speed *= 0.6
        return speed
    }

    private insideZone(kind: ZoneKind, x: number, y: number) {
        for (const zone of this.zones) {
            if (!zone.dead && zone.kind === kind && dist2(x, y, zone.x, zone.y) <= zone.r * zone.r) return true
        }
        return false
    }

    private updatePlayer(dt: number, dtMs: number) {
        const p = this.player
        if (p.tetherMs > 0) {
            p.tetherMs = Math.max(0, p.tetherMs - dtMs)
            if (p.tetherMs === 0) p.tetherFrom = null
        }

        let desired: number | null = null
        let targetSpeed = 0
        const maxSpeed = this.maxSpeed()
        const target = p.attackTargetId !== null ? this.enemies.find(e => e.id === p.attackTargetId && !e.dead) : null
        if (p.attackTargetId !== null && (!target || !this.targetable(target))) p.attackTargetId = null

        if (this.steerX !== 0 || this.steerY !== 0) {
            desired = Math.atan2(this.steerY, this.steerX)
            targetSpeed = maxSpeed
        } else if (target) {
            const d = dist(p.x, p.y, target.x, target.y)
            const clear = this.nav.segmentClear(p.x, p.y, target.x, target.y)
            if (clear && d <= this.cannonRange * HOLD_RANGE_FRACTION) {
                p.path = []
            } else {
                // Re-path toward a moving target now and then instead of every frame.
                const last = p.path[p.path.length - 1]
                if (!last || dist(last.x, last.y, target.x, target.y) > 60) p.path = this.nav.computePath(p.x, p.y, target.x, target.y)
            }
        }

        if (desired === null && p.path.length) {
            let wp = p.path[0]!
            while (wp && dist(p.x, p.y, wp.x, wp.y) <= WAYPOINT_REACH_DIST + p.velocity * 0.06) {
                p.path.shift()
                wp = p.path[0]!
            }
            if (wp) {
                desired = Math.atan2(wp.y - p.y, wp.x - p.x)
                targetSpeed = maxSpeed
                // Ease off near the final waypoint so the ship settles instead of circling it.
                if (p.path.length === 1) targetSpeed = Math.min(maxSpeed, dist(p.x, p.y, wp.x, wp.y) * 2.4 + 40)
            }
        }

        const turnRate = PLAYER_TURN_RATE * (1 + this.stack('following-wind') * 0.25)
        if (desired !== null) {
            const diff = angleDiff(p.angle, desired)
            p.angle = turnToward(p.angle, desired, turnRate * dt)
            // Hard turns bleed speed, the way a real hull would.
            targetSpeed *= Math.max(0.3, Math.cos(Math.min(Math.PI / 2, Math.abs(diff))))
        }
        const accel = targetSpeed > p.velocity ? PLAYER_ACCEL : PLAYER_DECEL
        p.velocity = p.velocity < targetSpeed
            ? Math.min(targetSpeed, p.velocity + accel * dt)
            : Math.max(targetSpeed, p.velocity - accel * dt)

        if (p.velocity > 0.5) {
            const step = p.velocity * dt
            if (!this.moveHull(p, Math.cos(p.angle) * step, Math.sin(p.angle) * step, SHIP_RADIUS - 6)) {
                p.velocity *= 0.5
                if (p.path.length) p.path = this.nav.computePath(p.x, p.y, p.path[p.path.length - 1]!.x, p.path[p.path.length - 1]!.y)
            }
        }
        p.x = clamp(p.x, 40, WORLD_W - 40)
        p.y = clamp(p.y, 40, WORLD_H - 40)
    }

    /** Move a hull, sliding along island coasts. False when it could not move at all. */
    private moveHull(hull: { x: number, y: number }, dx: number, dy: number, clearance: number) {
        const nx = hull.x + dx
        const ny = hull.y + dy
        if (!this.nav.pointInIsland(nx, ny, clearance)) {
            hull.x = nx
            hull.y = ny
            return true
        }
        if (!this.nav.pointInIsland(hull.x + dx, hull.y, clearance)) {
            hull.x += dx
            return true
        }
        if (!this.nav.pointInIsland(hull.x, hull.y + dy, clearance)) {
            hull.y += dy
            return true
        }
        return false
    }

    /**
     * Passive hull regen once PIRATE_REGEN_DELAY_MS has passed without taking
     * a hit, delivered as +1 ticks spread across the regen cycle. Tide Ward
     * refills on its own, shorter timer.
     */
    private updateRegenAndShield(dtMs: number) {
        const p = this.player
        this.msSinceHit += dtMs
        if (p.maxShield > 0 && p.shield < p.maxShield && this.msSinceHit >= PIRATE_UPGRADE_EFFECTS.tideWardRechargeDelayMs) {
            const before = p.shield
            p.shield = Math.min(p.maxShield, p.shield + p.maxShield * dtMs / 900)
            if (before === 0 && p.shield > 0) this.emit({ type: 'burst', x: p.x, y: p.y, color: 0x67e8f9, count: 10 })
        }
        const rate = this.stats.regenRate
        if (rate <= 0 || p.hp <= 0 || p.hp >= p.maxHp || this.msSinceHit < PIRATE_REGEN_DELAY_MS) {
            if (p.hp >= p.maxHp) this.regenTickMs = 0
            return
        }
        const interval = pirateRegenTickIntervalMs(rate)
        this.regenTickMs += dtMs
        if (this.regenTickMs < interval) return
        this.regenTickMs -= interval
        this.healPlayer(1, false)
    }

    private healPlayer(amount: number, announce: boolean) {
        const p = this.player
        const healed = Math.min(amount, p.maxHp - p.hp)
        if (healed <= 0) return 0
        p.hp += healed
        if (p.hp / p.maxHp > 0.4) this.lowHullWarned = false
        this.emit({ type: 'heal', x: p.x, y: p.y - 30, amount: Math.round(healed) })
        if (announce) this.emit({ type: 'burst', x: p.x, y: p.y, color: 0x4ade80, count: 16 })
        return healed
    }

    /** Anything hurting the captain's ship goes through here: shield first, then hull. */
    private damagePlayer(amount: number, heavy = false) {
        if (!this.running || amount <= 0) return
        const p = this.player
        this.msSinceHit = 0
        this.regenTickMs = 0
        let hull = amount
        if (p.shield > 0) {
            const absorbed = Math.min(p.shield, hull)
            p.shield -= absorbed
            hull -= absorbed
            this.sound('shield-hit', p.x)
            if (hull <= 0) {
                this.popup(p.x, p.y - 44, 'SHIELD', 0x67e8f9, false)
                return
            }
        }
        p.hp = Math.max(0, p.hp - hull)
        p.flashMs = 180
        this.playerPopupAcc += hull
        if (this.playerPopupTimer <= 0) this.playerPopupTimer = PLAYER_POPUP_MS
        this.sound('ship-hit', p.x, heavy ? 1 : 0.5)
        this.emit({ type: 'impact', x: p.x + randRange(-12, 12), y: p.y + randRange(-12, 12), color: 0xef4444, heavy })
        this.emit({ type: 'shake', amount: heavy ? 9 : 4 })
        if (!this.lowHullWarned && p.hp > 0 && p.hp / p.maxHp < 0.25) {
            this.lowHullWarned = true
            this.sound('low-hull')
            this.announce({ kind: 'warning', title: 'Hull critical', subtitle: 'Break away and repair' })
        }
        if (p.hp <= 0) this.endGame(false, 'defeat')
    }

    // ─── Player guns ────────────────────────────────────────────────────────

    private peekShotKind(): AmmoKind {
        if (this.preferGem && this.gemAmmo > 0) return 'gem'
        if (this.ammo > 0) return 'standard'
        if (this.gemAmmo > 0) return 'gem'
        return 'free'
    }

    private consumeShot(): AmmoKind {
        const kind = this.peekShotKind()
        if (kind === 'gem') this.gemAmmo -= 1
        else if (kind === 'standard') this.ammo -= 1
        return kind
    }

    private rangeMult() {
        const ammo = this.peekShotKind() === 'standard' ? PIRATE_AMMO_RANGE_MULT : 1
        return ammo * (1 + this.stack('crows-nest') * PIRATE_UPGRADE_EFFECTS.crowsNestRangePerStack)
    }

    private damageMult() {
        return this.stack('krakens-heart') > 0 ? 1 + PIRATE_UPGRADE_EFFECTS.heartDamage : 1
    }

    /** World position of a gun's mount on a hull. */
    private mountWorld(hull: { x: number, y: number, angle: number }, gun: SimGun): Point {
        const cos = Math.cos(hull.angle)
        const sin = Math.sin(hull.angle)
        return { x: hull.x + gun.mountX * cos - gun.mountY * sin, y: hull.y + gun.mountX * sin + gun.mountY * cos }
    }

    private muzzle(hull: { x: number, y: number, angle: number }, gun: SimGun): Point {
        const mount = this.mountWorld(hull, gun)
        return { x: mount.x + Math.cos(gun.aim) * gun.length, y: mount.y + Math.sin(gun.aim) * gun.length }
    }

    private slewGun(gun: SimGun & { rest: number }, hull: { x: number, y: number, angle: number }, target: Point | null, dt: number) {
        let desired: number
        if (target) {
            const mount = this.mountWorld(hull, gun)
            desired = Math.atan2(target.y - mount.y, target.x - mount.x)
        } else {
            desired = hull.angle + gun.rest
        }
        gun.aim = turnToward(gun.aim, desired, GUN_SLEW_RATE * dt)
        if (gun.recoil > 0) gun.recoil = Math.max(0, gun.recoil - dt / 0.18)
        return Math.abs(angleDiff(gun.aim, desired))
    }

    private pickPlayerTarget(range: number): Enemy | null {
        const p = this.player
        const r2 = range * range
        if (p.attackTargetId !== null) {
            const priority = this.enemies.find(e => e.id === p.attackTargetId)
            if (priority && !priority.dead && this.targetable(priority) && dist2(p.x, p.y, priority.x, priority.y) <= r2) return priority
        }
        let best: Enemy | null = null
        let bestD = Infinity
        for (const enemy of this.enemies) {
            if (enemy.dead || !this.targetable(enemy)) continue
            const d = dist2(p.x, p.y, enemy.x, enemy.y)
            if (d <= r2 && d < bestD) {
                best = enemy
                bestD = d
            }
        }
        return best
    }

    /**
     * Every gun port picks its own target, slews its barrel onto it and fires
     * only once it is roughly on target, so what the player sees each barrel
     * doing is exactly what it is doing.
     */
    private updatePlayerGuns(dt: number, dtMs: number) {
        this.fireGapMs = Math.max(0, this.fireGapMs - dtMs)
        const p = this.player
        const rangeMult = this.rangeMult()
        const reloadMult = Math.pow(1 - PIRATE_UPGRADE_EFFECTS.quickHandsReloadPerStack, this.stack('quick-hands'))
        for (const gun of this.cannons) {
            gun.reloadTimer -= dtMs
            const full = gun.reloadMs * reloadMult * PIRATE_TIMELINE_SCALE
            gun.charge = clamp(1 - gun.reloadTimer / full, 0, 1)
            const target = this.pickPlayerTarget(gun.range * rangeMult)
            const off = this.slewGun(gun, p, target, dt)
            if (!target || gun.reloadTimer > 0 || this.fireGapMs > 0 || off > GUN_FIRE_ARC) continue
            gun.reloadTimer = full
            this.fireGapMs = PLAYER_CANNON_FIRE_GAP_MS
            this.firePlayerGun(gun, target)
        }
    }

    private firePlayerGun(gun: PlayerGun, target: Enemy) {
        const p = this.player
        const kind = this.consumeShot()
        this.shotsFired += 1
        const titan = this.stack('titan-shot') > 0 && ++this.titanCounter % PIRATE_UPGRADE_EFFECTS.titanEvery === 0
        gun.recoil = 1
        const from = this.muzzle(p, gun)
        const rank = tierRank(gun.tierId)
        this.emit({ type: 'muzzle', x: from.x, y: from.y, angle: gun.aim, color: kind === 'gem' ? 0x7dd3fc : gun.color, size: titan ? 2 : 1 + rank * 0.08 })
        this.sound(titan ? 'titan-fire' : kind === 'gem' ? 'cannon-gem' : rank >= 5 ? 'cannon-heavy' : 'cannon', from.x, rank / 7)

        const attack = Math.round(gun.attackRating
            * (kind === 'gem' ? PIRATE_GEM_AMMO_ATTACK_MULT : 1)
            * (1 + this.stack('crows-nest') * PIRATE_UPGRADE_EFFECTS.crowsNestAccuracyPerStack))
        const maxDamage = Math.round(gun.maxDamage * (kind === 'gem' ? PIRATE_GEM_AMMO_DAMAGE_MULT : kind === 'standard' ? PIRATE_AMMO_DAMAGE_MULT : 1))
        const trail: SimProjectile['trail'] = titan ? 'mutated' : kind === 'gem' ? 'gem' : gun.mutated ? 'mutated' : gun.shotTrail ? 'tier' : 'smoke'
        const targetId = target.id
        this.launchBall({
            kind: titan ? 'titan' : kind === 'gem' ? 'gem' : 'ball',
            owner: 'player',
            from,
            target: { kind: 'enemy', id: targetId },
            to: target,
            color: titan ? 0xfacc15 : gun.color,
            size: titan ? 9 : 4 + rank * 0.25,
            trail,
            onLand: (x, y) => {
                const enemy = this.enemies.find(e => e.id === targetId)
                if (!enemy || enemy.dead || !this.targetable(enemy)) {
                    this.emit({ type: 'splash', x, y, size: titan ? 1.6 : 0.7 })
                    return
                }
                this.resolvePlayerShot(enemy, attack, maxDamage, kind, titan, x, y)
            }
        })
    }

    private resolvePlayerShot(enemy: Enemy, attack: number, maxDamage: number, kind: AmmoKind, titan: boolean, x: number, y: number) {
        const roll = pirateRollAttack(attack, enemy.defense, maxDamage)
        if (!roll.hit && !titan) {
            this.emit({ type: 'splash', x, y, size: 0.7 })
            this.sound('miss-splash', x)
            if (randomFloat() < 0.35) this.popup(x, y - 20, 'MISS', 0x9ca3af, false)
            return
        }
        const base = roll.hit ? roll.dmg : Math.ceil(maxDamage * 0.5)
        const blast = this.stack('blast-powder')
        const blastBonus = blast > 0 ? 1 + PIRATE_UPGRADE_EFFECTS.blastDirect[blast - 1]! : 1
        const damage = base * (titan ? PIRATE_UPGRADE_EFFECTS.titanDamage : 1) * blastBonus * this.damageMult()
        this.emit({ type: 'impact', x, y, color: kind === 'gem' ? 0x7dd3fc : 0xfde68a, heavy: roll.crit || titan })
        this.sound(roll.crit ? 'impact-crit' : 'impact', x)
        this.damageEnemy(enemy, damage, roll.crit || titan)

        if (blast > 0) {
            const radius = PIRATE_UPGRADE_EFFECTS.blastRadius[blast - 1]!
            const splash = damage * PIRATE_UPGRADE_EFFECTS.blastSplash[blast - 1]!
            this.emit({ type: 'explosion', x: enemy.x, y: enemy.y, r: radius * 0.6, color: 0xfb923c, heavy: false })
            for (const other of this.enemies) {
                if (other === enemy || other.dead || !this.targetable(other)) continue
                if (dist2(enemy.x, enemy.y, other.x, other.y) <= radius * radius) this.damageEnemy(other, splash, false, undefined, 'upgrade')
            }
        }
        const storm = this.stack('stormglass')
        if (storm > 0 && randomFloat() < PIRATE_UPGRADE_EFFECTS.stormChance[storm - 1]!) this.chainLightning(enemy, damage * PIRATE_UPGRADE_EFFECTS.stormDamage)
        if (titan) {
            const radius = PIRATE_UPGRADE_EFFECTS.titanRadius
            this.emit({ type: 'shockwave', x: enemy.x, y: enemy.y, r: radius, color: 0xfacc15 })
            this.emit({ type: 'shake', amount: 8 })
            for (const other of this.enemies) {
                if (other.dead || !this.targetable(other)) continue
                const d = dist(enemy.x, enemy.y, other.x, other.y)
                if (d > radius) continue
                if (other !== enemy) this.damageEnemy(other, damage * 0.35, false, undefined, 'upgrade')
                this.knockback(other, Math.atan2(other.y - this.player.y, other.x - this.player.x), 60)
            }
        }
    }

    private chainLightning(origin: Enemy, damage: number) {
        const points: Point[] = [{ x: origin.x, y: origin.y }]
        const used = new Set<number>([origin.id])
        let from: Enemy = origin
        for (let jump = 0; jump < PIRATE_UPGRADE_EFFECTS.stormJumps; jump++) {
            let next: Enemy | null = null
            let bestD = PIRATE_UPGRADE_EFFECTS.stormRange * PIRATE_UPGRADE_EFFECTS.stormRange
            for (const enemy of this.enemies) {
                if (enemy.dead || used.has(enemy.id) || !this.targetable(enemy)) continue
                const d = dist2(from.x, from.y, enemy.x, enemy.y)
                if (d < bestD) {
                    next = enemy
                    bestD = d
                }
            }
            if (!next) break
            used.add(next.id)
            points.push({ x: next.x, y: next.y })
            this.damageEnemy(next, damage, false, 0x7dd3fc, 'upgrade')
            from = next
        }
        if (points.length > 1) {
            this.emit({ type: 'lightning', points, color: 0x7dd3fc })
            this.sound('lightning', origin.x)
        }
    }

    // ─── Projectiles ────────────────────────────────────────────────────────

    private baseProjectile(kind: ProjectileKind, owner: SimProjectile['owner'], from: Point, to: Point, durationMs: number, color: number, size: number, trail: SimProjectile['trail']): Projectile {
        return {
            id: this.nextId++,
            kind,
            owner,
            x: from.x,
            y: from.y,
            z: 0,
            angle: Math.atan2(to.y - from.y, to.x - from.x),
            color,
            size,
            trail,
            ageMs: 0,
            fromX: from.x,
            fromY: from.y,
            toX: to.x,
            toY: to.y,
            durationMs,
            arc: 0,
            fall: false,
            motion: 'lerp',
            track: null,
            spreadX: 0,
            spreadY: 0,
            contactRadius: 0,
            onContact: null,
            onLand: null,
            speed: 0,
            targetId: -1,
            cx: 0,
            cy: 0,
            theta: 0,
            spin: 0,
            radius: 0,
            radialSpeed: 0,
            dead: false
        }
    }

    /** A cannonball that follows its target so it visibly lands on the hull it rolled against. */
    private launchBall(opts: {
        kind: ProjectileKind
        owner: SimProjectile['owner']
        from: Point
        target: Projectile['track']
        to: Point
        color: number
        size: number
        trail: SimProjectile['trail']
        onLand: (x: number, y: number) => void
    }) {
        const spread = 18
        const travel = dist(opts.from.x, opts.from.y, opts.to.x, opts.to.y)
        const duration = clamp(travel / BALL_SPEED, 0.16, 0.8) * 1000
        const p = this.baseProjectile(opts.kind, opts.owner, opts.from, opts.to, duration, opts.color, opts.size, opts.trail)
        p.arc = Math.min(34, travel * 0.08)
        p.track = opts.target
        p.spreadX = randRange(-spread, spread) * 0.5
        p.spreadY = randRange(-spread, spread) * 0.5
        p.onLand = opts.onLand
        this.projectiles.push(p)
        return p
    }

    private updateProjectiles(dtMs: number) {
        const player = this.player
        for (const p of this.projectiles) {
            if (p.dead) continue
            p.ageMs += dtMs
            const prevX = p.x
            const prevY = p.y
            if (p.motion === 'homing') {
                this.stepWarhead(p, dtMs)
                continue
            }
            if (p.motion === 'spiral') {
                const t = p.ageMs / 1000
                p.radius += p.radialSpeed * dtMs / 1000
                p.theta += p.spin * dtMs / 1000
                p.x = p.cx + Math.cos(p.theta) * p.radius
                p.y = p.cy + Math.sin(p.theta) * p.radius
                p.angle = p.theta + Math.PI / 2 * Math.sign(p.spin)
                if (t * 1000 >= p.durationMs || p.x < -40 || p.y < -40 || p.x > WORLD_W + 40 || p.y > WORLD_H + 40) p.dead = true
            } else {
                if (p.track) {
                    const target = this.trackPoint(p.track)
                    if (target) {
                        p.toX = target.x + p.spreadX
                        p.toY = target.y + p.spreadY
                    }
                }
                const t = Math.min(1, p.ageMs / p.durationMs)
                p.x = p.fromX + (p.toX - p.fromX) * t
                p.y = p.fromY + (p.toY - p.fromY) * t
                p.z = p.fall ? p.arc * (1 - t) : p.arc * 4 * t * (1 - t)
                if (p.x !== prevX || p.y !== prevY) p.angle = Math.atan2(p.y - prevY, p.x - prevX)
                if (t >= 1) {
                    p.dead = true
                    p.onLand?.(p.x, p.y)
                    continue
                }
            }
            if (p.contactRadius > 0 && player.alive && segPointDist(prevX, prevY, p.x, p.y, player.x, player.y) <= p.contactRadius + PLAYER_HIT_RADIUS * 0.6) {
                p.dead = true
                p.onContact?.()
            }
        }
    }

    private trackPoint(track: NonNullable<Projectile['track']>): Point | null {
        if (track.kind === 'player') return this.player
        if (track.kind === 'ally') return this.allies.find(a => a.id === track.id && !a.dead) ?? null
        const enemy = this.enemies.find(e => e.id === track.id)
        return enemy && !enemy.dead ? enemy : null
    }

    // ─── Enemies: damage, sinking ───────────────────────────────────────────

    /** Kraken below the surface or the Phantom mid-blink cannot be hit or targeted. */
    private targetable(enemy: Enemy) {
        return enemy.state !== 'submerged' && enemy.state !== 'surfacing' && enemy.state !== 'diving' && enemy.state !== 'blinking'
    }

    /** All player-side damage lands here: ward shield first, then hull; lifesteal; popups; sinking. */
    private damageEnemy(enemy: Enemy, amount: number, crit: boolean, _color?: number, source: PirateDamageSource = 'cannon') {
        if (enemy.dead || !this.targetable(enemy) || amount <= 0) return 0
        let remaining = amount
        if (enemy.shield > 0) {
            const absorbed = Math.min(enemy.shield, remaining)
            enemy.shield -= absorbed
            remaining -= absorbed
        }
        const dealt = Math.min(Math.max(0, enemy.hp), remaining)
        enemy.hp -= remaining
        enemy.flashMs = 110
        enemy.damageSinceSurface += dealt
        this.damageDealt += dealt
        this.damageBySource[source] += dealt
        enemy.popupAcc += amount
        enemy.popupCrit = enemy.popupCrit || crit
        if (enemy.popupTimer <= 0) enemy.popupTimer = crit ? 1 : HULL_POPUP_MS
        if (this.stack('krakens-heart') > 0 && dealt > 0) {
            const heal = dealt / enemy.maxHp * PIRATE_UPGRADE_EFFECTS.heartLifesteal * this.player.maxHp
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal)
        }
        if (enemy.hp <= 0) this.sinkEnemy(enemy)
        return dealt
    }

    private flushPopups(dtMs: number) {
        for (const enemy of this.enemies) {
            if (enemy.popupAcc <= 0) continue
            enemy.popupTimer -= dtMs
            if (enemy.popupTimer > 0 && !enemy.dead) continue
            this.popup(enemy.x, enemy.y - enemy.hitRadius - 8, `${Math.max(1, Math.round(enemy.popupAcc))}`, enemy.popupCrit ? 0xfacc15 : 0xffffff, enemy.popupCrit)
            enemy.popupAcc = 0
            enemy.popupCrit = false
        }
        if (this.playerPopupAcc > 0) {
            this.playerPopupTimer -= dtMs
            if (this.playerPopupTimer <= 0 || !this.running) {
                this.popup(this.player.x, this.player.y - 44, `-${Math.max(1, Math.round(this.playerPopupAcc))}`, 0xf87171, this.playerPopupAcc >= this.player.maxHp * 0.08)
                this.playerPopupAcc = 0
            }
        }
    }

    private sinkEnemy(enemy: Enemy) {
        if (enemy.dead) return
        enemy.dead = true
        if (enemy.popupAcc > 0) {
            this.popup(enemy.x, enemy.y - enemy.hitRadius - 8, `${Math.round(enemy.popupAcc)}`, enemy.popupCrit ? 0xfacc15 : 0xffffff, enemy.popupCrit)
            enemy.popupAcc = 0
        }
        if (this.player.attackTargetId === enemy.id) this.player.attackTargetId = null
        if (this.player.tetherFrom === enemy.id) {
            this.player.tetherMs = 0
            this.player.tetherFrom = null
        }
        this.kills += 1
        const sunk = this.sunkByType.get(enemy.tier.id)
        this.sunkByType.set(enemy.tier.id, { name: enemy.tier.name, count: (sunk?.count ?? 0) + 1 })
        const scale = enemy.tier.sizeScale ?? 1
        this.wrecks.push({
            id: enemy.id,
            tierId: enemy.tier.id,
            side: 'enemy',
            x: enemy.x,
            y: enemy.y,
            angle: enemy.angle,
            color: enemy.tier.color,
            sizeScale: scale,
            progress: 0,
            boss: enemy.tier.boss ?? null,
            dead: false
        })
        this.emit({ type: 'explosion', x: enemy.x, y: enemy.y, r: 40 * scale, color: 0xfb923c, heavy: true })
        this.emit({ type: 'splash', x: enemy.x, y: enemy.y, size: 1.4 * scale })
        this.emit({ type: 'burst', x: enemy.x, y: enemy.y, color: 0x78350f, count: 14 })

        // Sunk while burning, a fire ship still goes off — right in its friends' faces.
        if (enemy.tier.id === 'fireship' && enemy.state === 'burning') this.fireshipExplode(enemy, true)

        if (enemy.tier.boss) {
            this.bossesSunk += 1
            this.sound('boss-sunk', enemy.x)
            this.emit({ type: 'shockwave', x: enemy.x, y: enemy.y, r: 180, color: enemy.tier.color })
            this.emit({ type: 'shake', amount: 14 })
            this.bossTimerMs = this.elapsedMs >= PIRATE_LATE_BOSS_PHASE_MS ? 12_000 * PIRATE_TIMELINE_SCALE : PIRATE_BOSS_RESPAWN_MS
            this.spawnCrate(enemy.x, enemy.y, 'epic')
            if (enemy.tier.boss === 'phantom') {
                for (const minion of this.enemies) {
                    if (minion.summoned && !minion.dead) this.sinkEnemy(minion)
                }
            }
        } else {
            this.sound('enemy-sunk', enemy.x, scale)
            if (randomFloat() < PIRATE_POWER_UP_KILL_DROP_CHANCE) this.spawnCrate(enemy.x, enemy.y)
            else if (randomFloat() < PIRATE_HEALTH_PACK_KILL_DROP_CHANCE) this.spawnRepair(enemy.x, enemy.y)
        }
    }

    private knockback(enemy: Enemy, angle: number, distance: number) {
        if (enemy.tier.boss === 'kraken') return
        const steps = Math.ceil(distance / 12)
        const dx = Math.cos(angle) * distance / steps
        const dy = Math.sin(angle) * distance / steps
        for (let i = 0; i < steps; i++) {
            if (!this.moveHull(enemy, dx, dy, SHIP_RADIUS - 8)) break
        }
        enemy.x = clamp(enemy.x, 30, WORLD_W - 30)
        enemy.y = clamp(enemy.y, 30, WORLD_H - 30)
    }

    // ─── Enemy spawning ─────────────────────────────────────────────────────

    private spawnPoint(minFromPlayer: number): Point | null {
        const margin = 50
        for (let attempt = 0; attempt < 30; attempt++) {
            const edge = Math.floor(randomFloat() * 4)
            let x: number
            let y: number
            if (edge === 0) {
                x = margin
                y = randRange(margin, WORLD_H - margin)
            } else if (edge === 1) {
                x = WORLD_W - margin
                y = randRange(margin, WORLD_H - margin)
            } else if (edge === 2) {
                x = randRange(margin, WORLD_W - margin)
                y = margin
            } else {
                x = randRange(margin, WORLD_W - margin)
                y = WORLD_H - margin
            }
            if (this.nav.pointInIsland(x, y) || dist(x, y, this.player.x, this.player.y) < minFromPlayer) continue
            return { x, y }
        }
        return null
    }

    /** Open water at a ring around the player, for surfacing and blinking bosses. */
    private pointNearPlayer(minD: number, maxD: number): Point {
        const p = this.player
        for (let attempt = 0; attempt < 40; attempt++) {
            const angle = randRange(0, Math.PI * 2)
            const d = randRange(minD, maxD)
            const x = p.x + Math.cos(angle) * d
            const y = p.y + Math.sin(angle) * d
            if (x < 90 || y < 90 || x > WORLD_W - 90 || y > WORLD_H - 90) continue
            if (this.nav.pointInIsland(x, y, 70)) continue
            return { x, y }
        }
        return this.nav.nearestFreePoint(clamp(p.x + minD, 90, WORLD_W - 90), clamp(p.y, 90, WORLD_H - 90))
    }

    private spawnEnemy(tier: PirateEnemyTier, options: { at?: Point, summoned?: boolean } = {}) {
        let at: Point | null = options.at ?? null
        if (!at && tier.boss === 'kraken') at = this.pointNearPlayer(240, 330)
        if (!at) at = this.spawnPoint(tier.boss ? 380 : 300)
        if (!at) return null
        const diff = pirateDifficultyMultiplier(this.elapsedMs, this.difficulty)
        const scale = tier.sizeScale ?? 1
        const hull = enemyHull(scale)
        const spec = ENEMY_GUNS[tier.id] ?? ENEMY_GUNS.sloop!
        const angle = Math.atan2(this.player.y - at.y, this.player.x - at.x)
        const guns: EnemyGun[] = pirateGunMounts(spec.count, hull).map((mount) => {
            const rest = mount.y === 0 ? 0 : mount.y < 0 ? -Math.PI / 2 : Math.PI / 2
            return {
                mountX: mount.x,
                mountY: mount.y,
                aim: angle + rest,
                color: options.summoned ? 0x99f6e4 : spec.color,
                length: spec.length * Math.sqrt(scale),
                bore: spec.bore * Math.sqrt(scale),
                recoil: 0,
                charge: 1,
                style: options.summoned ? 'spectral' : spec.style,
                rest
            }
        })
        const hp = Math.max(1, Math.round(tier.hp * diff.hpMult * (options.summoned ? 1.4 : 1)))
        const reloadMult = pirateEnemyReloadMultiplier(this.elapsedMs, this.difficulty) * PIRATE_TIMELINE_SCALE
        const enemy: Enemy = {
            id: this.nextId++,
            tier,
            x: at.x,
            y: at.y,
            angle,
            velocity: 0,
            hp,
            maxHp: hp,
            shield: 0,
            defense: Math.max(1, Math.round(tier.defense * diff.statMult)),
            attackRating: Math.max(1, Math.round(tier.attackRating * diff.statMult)),
            maxDamage: Math.max(1, Math.round(tier.maxDamage * diff.dmgMult * (tier.boss ? PIRATE_BOSS_DAMAGE_MULT : 1))),
            guns,
            state: tier.boss === 'kraken' ? 'surfacing' : 'sailing',
            stateMs: tier.boss === 'kraken' ? 1200 : 0,
            flashMs: 0,
            ageMs: 0,
            summoned: options.summoned ?? false,
            tentacles: [],
            hitRadius: hullHitRadius(hull),
            reloadTimer: randRange(300 * PIRATE_TIMELINE_SCALE, tier.reloadMs * reloadMult),
            abilityTimer: this.initialAbilityTimer(tier),
            strafe: randomFloat() < 0.5 ? 1 : -1,
            timerMs: 0,
            damageSinceSurface: 0,
            popupAcc: 0,
            popupTimer: 0,
            popupCrit: false,
            dead: false
        }
        if (tier.boss === 'kraken') {
            enemy.hitRadius = 58
            this.layoutTentacles(enemy)
            this.emit({ type: 'splash', x: at.x, y: at.y, size: 3 })
        } else {
            this.emit({ type: 'splash', x: at.x, y: at.y, size: scale })
        }
        this.enemies.push(enemy)
        return enemy
    }

    private initialAbilityTimer(tier: PirateEnemyTier) {
        if (tier.boss) return randRange(PIRATE_BOSS_ABILITY_INITIAL_MIN_MS, PIRATE_BOSS_ABILITY_INITIAL_MAX_MS)
        if (tier.abilities.includes('ward')) return randRange(2500, 4500)
        if (tier.abilities.includes('harpoon')) return randRange(3000, 5500)
        return randRange(4200 * PIRATE_TIMELINE_SCALE, 7200 * PIRATE_TIMELINE_SCALE)
    }

    private nextAbilityTimer(enemy: Enemy) {
        if (enemy.tier.boss) return randRange(PIRATE_BOSS_ABILITY_COOLDOWN_MIN_MS, PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS)
        if (enemy.tier.abilities.includes('ward')) return randRange(6000, 7000)
        if (enemy.tier.abilities.includes('harpoon')) return randRange(7000, 10_000)
        return randRange(7600 * PIRATE_TIMELINE_SCALE, 11_500 * PIRATE_TIMELINE_SCALE)
    }

    private updateSpawning(dtMs: number) {
        this.spawnTimerMs -= dtMs
        if (this.spawnTimerMs <= 0) {
            const max = pirateMaxConcurrentEnemies(this.elapsedMs, this.difficulty)
            let regular = 0
            for (const enemy of this.enemies) {
                if (!enemy.dead && !enemy.tier.boss && !enemy.summoned) regular++
            }
            const batch = Math.min(Math.max(0, max - regular), pirateSpawnBatchSize(this.elapsedMs, this.difficulty))
            for (let i = 0; i < batch; i++) this.spawnEnemy(pirateRollEnemyTier(this.elapsedMs, this.difficulty))
            this.spawnTimerMs = pirateSpawnIntervalMs(this.elapsedMs, this.difficulty) * randRange(0.85, 1.2)
        }

        // Bosses run on their own clock, outside the concurrency cap. Only the
        // higher tiers add a second simultaneous boss in the final stretch.
        const late = this.elapsedMs >= PIRATE_LATE_BOSS_PHASE_MS
        const bossCap = late && this.difficulty >= PIRATE_DOUBLE_BOSS_DIFFICULTY ? 2 : 1
        const bosses = this.enemies.filter(enemy => !enemy.dead && enemy.tier.boss).length
        if (late && bosses < bossCap) this.bossTimerMs = Math.min(this.bossTimerMs, 12_000 * PIRATE_TIMELINE_SCALE)
        if (bosses >= bossCap) return
        this.bossTimerMs -= dtMs
        if (this.bossTimerMs > 0) return
        const tier = pirateRollBoss(this.elapsedMs, this.difficulty, this.lastBossId)
        const boss = this.spawnEnemy(tier)
        this.bossTimerMs = late ? 28_000 * PIRATE_TIMELINE_SCALE : PIRATE_BOSS_RESPAWN_MS
        if (!boss) return
        this.lastBossId = tier.id
        this.sound('boss-horn')
        if (tier.boss === 'kraken') this.sound('kraken-roar', boss.x)
        this.emit({ type: 'shake', amount: 8 })
        this.announce({ kind: 'boss', title: tier.name, subtitle: tier.role, bossKind: tier.boss })
    }

    // ─── Enemy behaviour ────────────────────────────────────────────────────

    /**
     * What an enemy is shooting at. The consort genuinely pulls aggro — an
     * enemy engages whichever friendly hull is closest, with a small bias
     * toward the captain so it is a partial decoy, not a full one.
     */
    private enemyTarget(enemy: Enemy): { x: number, y: number, ally: Ally | null } {
        let best: Ally | null = null
        let bestD = dist(enemy.x, enemy.y, this.player.x, this.player.y) - 50
        for (const ally of this.allies) {
            if (ally.dead || ally.kind !== 'consort') continue
            const d = dist(enemy.x, enemy.y, ally.x, ally.y)
            if (d < bestD) {
                best = ally
                bestD = d
            }
        }
        if (best) return { x: best.x, y: best.y, ally: best }
        return { x: this.player.x, y: this.player.y, ally: null }
    }

    private updateEnemies(dt: number, dtMs: number) {
        const reloadMult = pirateEnemyReloadMultiplier(this.elapsedMs, this.difficulty) * PIRATE_TIMELINE_SCALE
        for (const enemy of this.enemies) {
            if (enemy.dead) continue
            enemy.ageMs += dtMs
            if (enemy.flashMs > 0) enemy.flashMs = Math.max(0, enemy.flashMs - dtMs)

            if (enemy.tier.boss === 'kraken') {
                this.updateKraken(enemy, dt, dtMs)
                continue
            }
            if (enemy.state === 'blinking') {
                this.updateBlink(enemy, dtMs)
                continue
            }
            if (enemy.tier.id === 'fireship') {
                this.updateFireship(enemy, dt, dtMs)
                continue
            }

            const engaged = this.enemyTarget(enemy)
            const d = dist(enemy.x, enemy.y, engaged.x, engaged.y)
            this.steerEnemy(enemy, engaged, d, dt)

            const inRange = d <= enemy.tier.range
            let bestOff = Infinity
            for (const gun of enemy.guns) {
                const off = this.slewGun(gun, enemy, inRange ? engaged : null, dt)
                if (off < bestOff) bestOff = off
            }

            enemy.abilityTimer -= dtMs
            if (enemy.abilityTimer <= 0) {
                enemy.abilityTimer = this.nextAbilityTimer(enemy)
                this.useEnemyAbility(enemy)
            }

            enemy.reloadTimer -= dtMs
            if (inRange && enemy.reloadTimer <= 0 && (enemy.guns.length === 0 || bestOff <= GUN_FIRE_ARC * 1.5)) {
                enemy.reloadTimer = enemy.tier.reloadMs * reloadMult
                if (enemy.tier.id === 'mortar') this.fireMortar(enemy)
                else this.enemyVolley(enemy)
            }
        }
    }

    /**
     * Sail toward the target with island repulsion; once in range, circle and
     * strafe at a comfortable distance instead of parking, which keeps fights
     * moving and gives a broadside feel.
     */
    private steerEnemy(enemy: Enemy, target: Point, d: number, dt: number) {
        const range = enemy.tier.range
        const toTarget = Math.atan2(target.y - enemy.y, target.x - enemy.x)
        let heading: number
        let speed = enemy.tier.speed
        if (d > range * 0.92) {
            heading = toTarget
        } else {
            // Keep near 75% of range: drift in or out while circling.
            const ideal = range * 0.75
            const radial = clamp((d - ideal) / Math.max(40, range * 0.3), -1, 1)
            heading = toTarget + enemy.strafe * (Math.PI / 2 - radial * 0.9)
            speed *= 0.55
            if (randomFloat() < dt * 0.08) enemy.strafe = enemy.strafe === 1 ? -1 : 1
        }
        let dirX = Math.cos(heading)
        let dirY = Math.sin(heading)
        for (const island of this.islands) {
            const iDist = dist(enemy.x, enemy.y, island.x, island.y)
            const influence = island.r + 80
            if (iDist < influence && iDist > 0) {
                const push = (influence - iDist) / influence * 2.4
                dirX += (enemy.x - island.x) / iDist * push
                dirY += (enemy.y - island.y) / iDist * push
            }
        }
        // Stay off the edges of the chart.
        const edge = 70
        if (enemy.x < edge) dirX += (edge - enemy.x) / edge * 2
        if (enemy.x > WORLD_W - edge) dirX -= (enemy.x - (WORLD_W - edge)) / edge * 2
        if (enemy.y < edge) dirY += (edge - enemy.y) / edge * 2
        if (enemy.y > WORLD_H - edge) dirY -= (enemy.y - (WORLD_H - edge)) / edge * 2
        const desired = Math.atan2(dirY, dirX)
        const turn = ENEMY_TURN_RATE * (enemy.tier.speed > 250 ? 1.6 : 1)
        const diff = angleDiff(enemy.angle, desired)
        enemy.angle = turnToward(enemy.angle, desired, turn * dt)
        const targetSpeed = speed * Math.max(0.35, Math.cos(Math.min(Math.PI / 2, Math.abs(diff))))
        enemy.velocity += clamp(targetSpeed - enemy.velocity, -300 * dt, 200 * dt)
        const step = enemy.velocity * dt
        this.moveHull(enemy, Math.cos(enemy.angle) * step, Math.sin(enemy.angle) * step, SHIP_RADIUS - 8)
        enemy.x = clamp(enemy.x, 30, WORLD_W - 30)
        enemy.y = clamp(enemy.y, 30, WORLD_H - 30)
    }

    /** A volley of ordinary cannonballs, each leaving from whichever barrel is best lined up. */
    private enemyVolley(enemy: Enemy) {
        const volley = enemy.tier.volley ?? 1
        for (let i = 0; i < volley; i++) {
            if (i === 0) this.enemyShot(enemy)
            else this.schedule(i * 150, () => this.enemyShot(enemy))
        }
    }

    private enemyShot(enemy: Enemy) {
        if (enemy.dead || !this.running || !this.targetable(enemy)) return
        const engaged = this.enemyTarget(enemy)
        const allyId = engaged.ally?.id ?? null
        let gun: EnemyGun | null = null
        let bestOff = Infinity
        for (const candidate of enemy.guns) {
            const mount = this.mountWorld(enemy, candidate)
            const off = Math.abs(angleDiff(candidate.aim, Math.atan2(engaged.y - mount.y, engaged.x - mount.x)))
            // Prefer a barrel that hasn't just fired so a broadside ripples down the hull.
            const score = off + candidate.recoil * 0.6
            if (score < bestOff) {
                gun = candidate
                bestOff = score
            }
        }
        const from = gun ? this.muzzle(enemy, gun) : { x: enemy.x, y: enemy.y }
        if (gun) gun.recoil = 1
        const spectral = enemy.tier.id === 'ghostship' || enemy.tier.boss === 'phantom' || enemy.summoned
        this.emit({ type: 'muzzle', x: from.x, y: from.y, angle: gun?.aim ?? enemy.angle, color: spectral ? 0x5eead4 : 0xfb923c, size: 0.9 })
        this.sound('enemy-cannon', from.x, enemy.tier.boss ? 1 : 0.5)
        const attack = enemy.attackRating
        const maxDamage = enemy.maxDamage
        this.launchBall({
            kind: 'enemy',
            owner: 'enemy',
            from,
            target: allyId !== null ? { kind: 'ally', id: allyId } : { kind: 'player', id: 0 },
            to: engaged,
            color: spectral ? 0x5eead4 : 0x1c1917,
            size: enemy.tier.boss ? 5.5 : 4.2,
            trail: spectral ? 'spectral' : 'smoke',
            onLand: (x, y) => {
                if (!this.running) return
                if (allyId !== null) {
                    const ally = this.allies.find(a => a.id === allyId && !a.dead)
                    if (!ally) {
                        this.emit({ type: 'splash', x, y, size: 0.7 })
                        return
                    }
                    const roll = pirateRollAttack(attack, ally.defenseRating, maxDamage)
                    if (roll.hit) this.damageAlly(ally, roll.dmg)
                    else this.emit({ type: 'splash', x, y, size: 0.7 })
                    return
                }
                const roll = pirateRollAttack(attack, this.stats.defenseRating, maxDamage)
                // Following Wind: a ship under full sail is hard to hit.
                const evasion = this.stack('following-wind') * PIRATE_UPGRADE_EFFECTS.followingWindEvasionPerStack
                if (roll.hit && evasion > 0 && this.player.velocity >= this.maxSpeed() * 0.6 && randomFloat() < evasion) roll.hit = false
                if (!roll.hit) {
                    this.emit({ type: 'splash', x, y, size: 0.7 })
                    if (randomFloat() < 0.3) this.popup(this.player.x, this.player.y - 40, 'MISS', 0x9ca3af, false)
                    return
                }
                this.damagePlayer(roll.dmg, roll.crit)
            }
        })
    }

    private useEnemyAbility(enemy: Enemy) {
        const pool = enemy.tier.abilities.filter(a => a !== 'ram' && a !== 'mortar')
        if (!pool.length || !this.targetable(enemy)) return
        const ability: PirateEnemyAbility = pool[Math.floor(randomFloat() * pool.length)]!
        switch (ability) {
            case 'sniper': this.fireSniper(enemy); break
            case 'mine': this.launchDriftMine(enemy); break
            case 'bomb': this.launchFrenzyBomb(enemy); break
            case 'skiffs': this.launchSkiffs(enemy); break
            case 'harpoon': this.fireHarpoon(enemy); break
            case 'ward': this.castWard(enemy); break
            case 'tentacles': this.krakenSlam(enemy, 3); break
            case 'ink': this.krakenInk(enemy); break
            case 'whirlpool': this.krakenWhirlpool(enemy); break
            case 'blink': this.startBlink(enemy); break
            case 'summon': this.phantomSummon(enemy); break
            case 'spiral': this.phantomSpiral(enemy); break
        }
    }

    /** Area strike landing at (x, y): hits the player (and the consort) if they are inside. */
    private resolveArea(x: number, y: number, radius: number, damage: number, color: number, heavy = true) {
        this.emit({ type: 'explosion', x, y, r: radius * 0.7, color, heavy })
        this.emit({ type: 'shockwave', x, y, r: radius, color })
        this.sound(heavy ? 'explosion' : 'impact', x, heavy ? 0.8 : 0.4)
        if (heavy) this.emit({ type: 'shake', amount: 6 })
        for (const ally of this.allies) {
            if (!ally.dead && ally.kind === 'consort' && dist(ally.x, ally.y, x, y) <= radius) this.damageAlly(ally, damage)
        }
        if (dist(this.player.x, this.player.y, x, y) > radius + PLAYER_HIT_RADIUS * 0.3) {
            this.emit({ type: 'splash', x, y, size: 1 })
            if (dist(this.player.x, this.player.y, x, y) < radius + 120) this.popup(x, y - 28, 'DODGED', 0xa5f3fc, false)
            return
        }
        this.damagePlayer(damage, heavy)
    }

    private fireSniper(enemy: Enemy) {
        const tx = this.player.x
        const ty = this.player.y
        const sniperColor = 0xe879f9
        const mount = enemy.guns[0] ? this.muzzle(enemy, enemy.guns[0]) : enemy
        this.telegraph('line', mount.x, mount.y, 0, 900, sniperColor, true, tx, ty, 5)
        this.telegraph('reticle', tx, ty, 58, 900, sniperColor)
        this.sound('sniper-charge', enemy.x)
        this.schedule(900, () => {
            if (enemy.dead || !this.running || !this.targetable(enemy)) return
            const from = enemy.guns[0] ? this.muzzle(enemy, enemy.guns[0]) : { x: enemy.x, y: enemy.y }
            if (enemy.guns[0]) enemy.guns[0].recoil = 1
            this.emit({ type: 'muzzle', x: from.x, y: from.y, angle: Math.atan2(ty - from.y, tx - from.x), color: sniperColor, size: 1.4 })
            this.sound('sniper-fire', from.x)
            const duration = clamp(dist(from.x, from.y, tx, ty) / 430, 0.5, 1.5) * 1000
            const p = this.baseProjectile('sniper', 'enemy', from, { x: tx, y: ty }, duration, sniperColor, 6, 'mutated')
            const damage = Math.max(6, Math.round(enemy.maxDamage * 0.9))
            p.contactRadius = 14
            p.onContact = () => this.resolveArea(p.x, p.y, 34, damage, sniperColor, false)
            p.onLand = (x, y) => {
                if (dist(this.player.x, this.player.y, x, y) > 58) {
                    this.emit({ type: 'splash', x, y, size: 1 })
                    this.popup(x, y - 24, 'DODGED', 0xf0abfc, true)
                    return
                }
                const roll = pirateRollAttack(enemy.attackRating, this.stats.defenseRating, enemy.maxDamage)
                if (roll.hit) this.damagePlayer(roll.dmg, true)
            }
            this.projectiles.push(p)
        })
    }

    private launchDriftMine(enemy: Enemy) {
        const tx = this.player.x
        const ty = this.player.y
        const duration = 2350
        const color = 0x3b82f6
        this.telegraph('circle', tx, ty, 68, duration, color)
        const damage = Math.max(5, Math.round(enemy.maxDamage * 0.9))
        const p = this.baseProjectile('mine', 'enemy', enemy, { x: tx, y: ty }, duration, color, 9, 'none')
        p.contactRadius = 20
        p.onContact = () => this.resolveArea(p.x, p.y, 42, damage, color)
        p.onLand = (x, y) => this.resolveArea(x, y, 68, damage, color)
        this.projectiles.push(p)
    }

    private launchFrenzyBomb(enemy: Enemy) {
        const tx = this.player.x
        const ty = this.player.y
        const radius = enemy.tier.boss ? 125 : 110
        const color = 0xf97316
        this.telegraph('circle', tx, ty, radius, 1300, color)
        this.sound('bomb-throw', enemy.x)
        const damage = Math.max(8, Math.round(enemy.maxDamage * 1.35))
        const p = this.baseProjectile('bomb', 'enemy', enemy, { x: tx, y: ty }, 1300, color, 10, 'fire')
        p.arc = 95
        p.onLand = (x, y) => this.resolveArea(x, y, radius, damage, color)
        this.projectiles.push(p)
    }

    private launchSkiffs(enemy: Enemy) {
        const color = 0x06b6d4
        const damage = Math.max(4, Math.round(enemy.maxDamage * 0.55))
        this.sound('skiff-launch', enemy.x)
        for (let i = 0; i < 3; i++) {
            const angle = i / 3 * Math.PI * 2
            const tx = this.player.x + Math.cos(angle) * 38
            const ty = this.player.y + Math.sin(angle) * 38
            const duration = 1650 + i * 120
            this.telegraph('circle', tx, ty, 42, duration, color)
            const from = { x: enemy.x + Math.cos(angle) * 24, y: enemy.y + Math.sin(angle) * 24 }
            const p = this.baseProjectile('skiff', 'enemy', from, { x: tx, y: ty }, duration, color, 8, 'none')
            p.contactRadius = 18
            p.onContact = () => this.resolveArea(p.x, p.y, 40, damage, color, false)
            p.onLand = (x, y) => this.resolveArea(x, y, 42, damage, color, false)
            this.projectiles.push(p)
        }
    }

    private fireHarpoon(enemy: Enemy) {
        const gun = enemy.guns[0]
        const from0 = gun ? this.muzzle(enemy, gun) : { x: enemy.x, y: enemy.y }
        const tx = this.player.x
        const ty = this.player.y
        const angle = Math.atan2(ty - from0.y, tx - from0.x)
        const reach = dist(from0.x, from0.y, tx, ty) + 70
        const ex = from0.x + Math.cos(angle) * reach
        const ey = from0.y + Math.sin(angle) * reach
        const color = 0x2dd4bf
        this.telegraph('line', from0.x, from0.y, 0, 800, color, true, ex, ey, 14)
        this.schedule(800, () => {
            if (enemy.dead || !this.running) return
            const from = gun ? this.muzzle(enemy, gun) : { x: enemy.x, y: enemy.y }
            if (gun) gun.recoil = 1
            this.sound('harpoon-fire', from.x)
            const p = this.baseProjectile('harpoon', 'enemy', from, { x: ex, y: ey }, dist(from.x, from.y, ex, ey) / 950 * 1000, color, 5, 'none')
            p.contactRadius = 10
            p.onContact = () => {
                if (enemy.dead) return
                this.damagePlayer(Math.max(3, Math.round(enemy.maxDamage * 0.6)))
                this.player.tetherMs = 2500
                this.player.tetherFrom = enemy.id
                this.sound('harpoon-hit', this.player.x)
                this.popup(this.player.x, this.player.y - 56, 'HARPOONED', color, true)
            }
            p.onLand = (x, y) => this.emit({ type: 'splash', x, y, size: 0.6 })
            this.projectiles.push(p)
        })
    }

    /** Three shells lobbed at marked water around (and a little ahead of) the player. */
    private fireMortar(enemy: Enemy) {
        const p = this.player
        const leadX = p.x + Math.cos(p.angle) * p.velocity * 0.7
        const leadY = p.y + Math.sin(p.angle) * p.velocity * 0.7
        const color = 0xfbbf24
        const damage = Math.max(6, Math.round(enemy.maxDamage * 1.1))
        this.sound('mortar-launch', enemy.x)
        for (let i = 0; i < 3; i++) {
            const offset = i === 0 ? 0 : randRange(70, 115)
            const angle = randRange(0, Math.PI * 2)
            const tx = clamp(leadX + Math.cos(angle) * offset, 40, WORLD_W - 40)
            const ty = clamp(leadY + Math.sin(angle) * offset, 40, WORLD_H - 40)
            const gun = enemy.guns[i % Math.max(1, enemy.guns.length)]
            const from = gun ? this.muzzle(enemy, gun) : { x: enemy.x, y: enemy.y }
            if (gun) gun.recoil = 1
            const delay = i * 120
            this.telegraph('circle', tx, ty, 60, 1400 + delay, color)
            this.schedule(delay, () => {
                if (!this.running) return
                this.emit({ type: 'muzzle', x: from.x, y: from.y, angle: -Math.PI / 2, color, size: 1.2 })
                const shell = this.baseProjectile('mortar', 'enemy', from, { x: tx, y: ty }, 1400, color, 7, 'smoke')
                shell.arc = 190
                shell.onLand = (x, y) => this.resolveArea(x, y, 60, damage, color)
                this.projectiles.push(shell)
            })
        }
    }

    private castWard(enemy: Enemy) {
        const radius = 230
        this.zones.push(this.makeZone('ward', enemy.x, enemy.y, radius, 0, 800))
        this.sound('ward-cast', enemy.x)
        let shielded = 0
        for (const other of this.enemies) {
            if (other === enemy || other.dead || dist(enemy.x, enemy.y, other.x, other.y) > radius) continue
            const cap = other.maxHp * 0.3
            if (other.shield < cap) {
                other.shield = cap
                shielded += 1
            }
        }
        if (shielded) this.emit({ type: 'burst', x: enemy.x, y: enemy.y, color: 0x22d3ee, count: 12 })
    }

    private updateFireship(enemy: Enemy, dt: number, dtMs: number) {
        const p = this.player
        const d = dist(enemy.x, enemy.y, p.x, p.y)
        if (enemy.state === 'sailing' && d < 200) {
            enemy.state = 'burning'
            enemy.timerMs = 2500
            this.sound('fireship-ignite', enemy.x)
            this.telegraph('circle', enemy.x, enemy.y, 85, 2500, 0xef4444)
        }
        const burning = enemy.state === 'burning'
        const desired = Math.atan2(p.y - enemy.y, p.x - enemy.x)
        enemy.angle = turnToward(enemy.angle, desired, (burning ? 3.4 : 2.4) * dt)
        const targetSpeed = enemy.tier.speed * (burning ? 1.6 : 1)
        enemy.velocity += clamp(targetSpeed - enemy.velocity, -300 * dt, 260 * dt)
        const step = enemy.velocity * dt
        this.moveHull(enemy, Math.cos(enemy.angle) * step, Math.sin(enemy.angle) * step, SHIP_RADIUS - 8)
        enemy.x = clamp(enemy.x, 30, WORLD_W - 30)
        enemy.y = clamp(enemy.y, 30, WORLD_H - 30)
        // The fuse ring rides with the hull.
        for (const t of this.telegraphs) {
            if (t.kind === 'circle' && t.r === 85 && t.color === 0xef4444 && dist(t.x, t.y, enemy.x, enemy.y) < 60) {
                t.x = enemy.x
                t.y = enemy.y
            }
        }
        if (!burning) return
        enemy.timerMs -= dtMs
        if (d < enemy.hitRadius + 30 || enemy.timerMs <= 0) {
            enemy.dead = true
            this.fireshipExplode(enemy, false)
            this.wrecks.push({ id: enemy.id, tierId: enemy.tier.id, side: 'enemy', x: enemy.x, y: enemy.y, angle: enemy.angle, color: enemy.tier.color, sizeScale: enemy.tier.sizeScale ?? 1, progress: 0.3, boss: null, dead: false })
        }
    }

    /** Powder hold goes up: hurts the player if close, and the fleet if it was sunk among them. */
    private fireshipExplode(enemy: Enemy, sunkByPlayer: boolean) {
        const radius = 85
        const diff = pirateDifficultyMultiplier(this.elapsedMs, this.difficulty)
        const damage = Math.round(10 * 2.2 * diff.dmgMult)
        for (const t of this.telegraphs) {
            if (t.kind === 'circle' && t.r === radius && dist(t.x, t.y, enemy.x, enemy.y) < 60) t.dead = true
        }
        this.emit({ type: 'burst', x: enemy.x, y: enemy.y, color: 0xf97316, count: 22 })
        this.resolveArea(enemy.x, enemy.y, radius, damage, 0xef4444, true)
        if (sunkByPlayer) {
            for (const other of this.enemies) {
                if (other === enemy || other.dead) continue
                if (dist(other.x, other.y, enemy.x, enemy.y) <= radius + other.hitRadius) this.damageEnemy(other, other.maxHp * 0.35 + damage, true, undefined, 'hazard')
            }
        }
    }

    // ─── Kraken ─────────────────────────────────────────────────────────────

    private layoutTentacles(enemy: Enemy) {
        const count = 5
        enemy.tentacles = []
        for (let i = 0; i < count; i++) {
            const angle = i / count * Math.PI * 2 + randRange(-0.3, 0.3)
            const r = randRange(78, 108)
            enemy.tentacles.push({ x: enemy.x + Math.cos(angle) * r, y: enemy.y + Math.sin(angle) * r, raise: 0 })
        }
    }

    private updateKraken(enemy: Enemy, dt: number, dtMs: number) {
        enemy.stateMs -= dtMs
        const raiseTarget = enemy.state === 'sailing' ? 1 : enemy.state === 'surfacing' ? 0.5 : 0
        for (const tentacle of enemy.tentacles) tentacle.raise += clamp(raiseTarget - tentacle.raise, -dt * 2, dt * 2)
        enemy.angle = turnToward(enemy.angle, Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x), 0.8 * dt)

        switch (enemy.state) {
            case 'surfacing':
                if (enemy.stateMs <= 0) {
                    enemy.state = 'sailing'
                    enemy.timerMs = 0
                    enemy.damageSinceSurface = 0
                    this.emit({ type: 'splash', x: enemy.x, y: enemy.y, size: 3 })
                    this.sound('kraken-roar', enemy.x)
                }
                return
            case 'diving':
                if (enemy.stateMs <= 0) {
                    enemy.state = 'submerged'
                    enemy.stateMs = 2500
                    enemy.shield = 0
                }
                return
            case 'submerged':
                if (enemy.stateMs <= 0) {
                    const at = this.pointNearPlayer(220, 320)
                    enemy.x = at.x
                    enemy.y = at.y
                    this.layoutTentacles(enemy)
                    enemy.state = 'surfacing'
                    enemy.stateMs = 1200
                    this.telegraph('circle', at.x, at.y, 90, 1200, 0x7c3aed)
                }
                return
            default:
                break
        }

        enemy.timerMs += dtMs
        if (enemy.timerMs > 14_000 || enemy.damageSinceSurface >= enemy.maxHp * 0.25) {
            enemy.state = 'diving'
            enemy.stateMs = 800
            if (this.player.attackTargetId === enemy.id) this.player.attackTargetId = null
            this.sound('kraken-dive', enemy.x)
            this.emit({ type: 'splash', x: enemy.x, y: enemy.y, size: 2.6 })
            return
        }

        enemy.abilityTimer -= dtMs
        if (enemy.abilityTimer <= 0) {
            enemy.abilityTimer = this.nextAbilityTimer(enemy)
            this.useEnemyAbility(enemy)
        }
        enemy.reloadTimer -= dtMs
        if (enemy.reloadTimer <= 0 && dist(enemy.x, enemy.y, this.player.x, this.player.y) <= enemy.tier.range + 200) {
            enemy.reloadTimer = enemy.tier.reloadMs * pirateEnemyReloadMultiplier(this.elapsedMs, this.difficulty) * PIRATE_TIMELINE_SCALE
            this.krakenSlam(enemy, 2 + (randomFloat() < 0.5 ? 1 : 0))
        }
    }

    /** Tentacles crash down on marked water around the player. */
    private krakenSlam(enemy: Enemy, count: number) {
        const color = 0xa855f7
        const damage = Math.max(6, Math.round(enemy.maxDamage * 1.4))
        const p = this.player
        for (let i = 0; i < count; i++) {
            const angle = randRange(0, Math.PI * 2)
            const offset = i === 0 ? randRange(0, 30) : randRange(80, 130)
            const tx = clamp(p.x + Math.cos(angle) * offset + Math.cos(p.angle) * p.velocity * 0.4, 40, WORLD_W - 40)
            const ty = clamp(p.y + Math.sin(angle) * offset + Math.sin(p.angle) * p.velocity * 0.4, 40, WORLD_H - 40)
            const delay = 1000 + i * 150
            this.telegraph('circle', tx, ty, 70, delay, color)
            this.schedule(delay, () => {
                if (enemy.dead || !this.running) return
                this.sound('tentacle-slam', tx)
                // A tentacle reaches out to the strike point for a moment.
                const tentacle = enemy.tentacles[i % Math.max(1, enemy.tentacles.length)]
                if (tentacle) {
                    const homeX = tentacle.x
                    const homeY = tentacle.y
                    tentacle.x = tx
                    tentacle.y = ty
                    tentacle.raise = 1
                    this.schedule(450, () => {
                        tentacle.x = homeX
                        tentacle.y = homeY
                    })
                }
                this.resolveArea(tx, ty, 70, damage, color)
            })
        }
    }

    private krakenInk(enemy: Enemy) {
        this.zones.push(this.makeZone('ink', this.player.x, this.player.y, 160, 0, 5000))
        this.sound('ink-splash', this.player.x)
        this.emit({ type: 'splash', x: this.player.x, y: this.player.y, size: 2 })
        this.popup(this.player.x, this.player.y - 60, 'INKED', 0xc4b5fd, true)
        void enemy
    }

    private krakenWhirlpool(enemy: Enemy) {
        const angle = randRange(0, Math.PI * 2)
        const x = clamp(this.player.x + Math.cos(angle) * 60, 60, WORLD_W - 60)
        const y = clamp(this.player.y + Math.sin(angle) * 60, 60, WORLD_H - 60)
        const zone = this.makeZone('whirlpool', x, y, 190, 0, 4000)
        zone.damage = Math.max(1, Math.round(enemy.maxDamage * 0.25))
        this.zones.push(zone)
        this.sound('maelstrom-open', x)
    }

    // ─── Phantom Admiral ────────────────────────────────────────────────────

    private startBlink(enemy: Enemy) {
        enemy.state = 'blinking'
        enemy.stateMs = 600
        enemy.timerMs = 0
        if (this.player.attackTargetId === enemy.id) this.player.attackTargetId = null
        this.sound('phantom-blink', enemy.x)
        this.emit({ type: 'burst', x: enemy.x, y: enemy.y, color: 0x5eead4, count: 18 })
    }

    private updateBlink(enemy: Enemy, dtMs: number) {
        enemy.stateMs -= dtMs
        if (enemy.timerMs === 0 && enemy.stateMs <= 300) {
            enemy.timerMs = 1
            const at = this.pointNearPlayer(290, 390)
            enemy.x = at.x
            enemy.y = at.y
            enemy.angle = Math.atan2(this.player.y - at.y, this.player.x - at.x)
            this.emit({ type: 'burst', x: at.x, y: at.y, color: 0x5eead4, count: 18 })
        }
        if (enemy.stateMs <= 0) {
            enemy.state = 'sailing'
            enemy.reloadTimer = Math.min(enemy.reloadTimer, 350)
        }
    }

    private phantomSummon(enemy: Enemy) {
        const sloop = PIRATE_ENEMY_TIERS.find(tier => tier.id === 'sloop')!
        this.sound('phantom-summon', enemy.x)
        for (let i = 0; i < 2; i++) {
            const angle = enemy.angle + (i === 0 ? Math.PI / 2 : -Math.PI / 2)
            const at = this.nav.nearestFreePoint(clamp(enemy.x + Math.cos(angle) * 70, 60, WORLD_W - 60), clamp(enemy.y + Math.sin(angle) * 70, 60, WORLD_H - 60))
            const minion = this.spawnEnemy(sloop, { at, summoned: true })
            if (minion) this.emit({ type: 'burst', x: at.x, y: at.y, color: 0x5eead4, count: 14 })
        }
    }

    private phantomSpiral(enemy: Enemy) {
        const color = 0x5eead4
        const damage = Math.max(4, Math.round(enemy.maxDamage * 0.8))
        this.sound('phantom-spiral', enemy.x)
        for (let wave = 0; wave < 2; wave++) {
            this.schedule(wave * 450, () => {
                if (enemy.dead || !this.running || !this.targetable(enemy)) return
                const count = 14
                const offset = wave * Math.PI / count
                for (let i = 0; i < count; i++) {
                    const theta = offset + i / count * Math.PI * 2
                    const p = this.baseProjectile('spiral', 'enemy', enemy, enemy, 2200, color, 5, 'spectral')
                    p.motion = 'spiral'
                    p.cx = enemy.x
                    p.cy = enemy.y
                    p.theta = theta
                    p.radius = enemy.hitRadius
                    p.radialSpeed = 250
                    p.spin = wave === 0 ? 0.9 : -0.9
                    p.contactRadius = 6
                    p.onContact = () => {
                        this.damagePlayer(damage)
                        this.emit({ type: 'impact', x: this.player.x, y: this.player.y, color, heavy: false })
                    }
                    this.projectiles.push(p)
                }
            })
        }
    }

    // ─── Player abilities ───────────────────────────────────────────────────

    private blastEnemies(x: number, y: number, radius: number, damage: number, color: number, source: PirateDamageSource = 'ability') {
        let hits = 0
        for (const enemy of this.enemies) {
            if (enemy.dead || !this.targetable(enemy)) continue
            if (dist(x, y, enemy.x, enemy.y) > radius + enemy.hitRadius * 0.5) continue
            hits += 1
            this.damageEnemy(enemy, damage, true, color, source)
        }
        this.clearMines(x, y, radius)
        return hits
    }

    private clearMines(x: number, y: number, radius: number) {
        for (const mine of this.mines) {
            if (mine.dead || dist(x, y, mine.x, mine.y) > radius) continue
            mine.dead = true
            this.emit({ type: 'explosion', x: mine.x, y: mine.y, r: 30, color: 0x38bdf8, heavy: false })
            this.popup(mine.x, mine.y - 28, 'MINE CLEARED', 0x7dd3fc, false)
        }
    }

    private castKeg(x: number, y: number) {
        const p = this.player
        const color = 0xfacc15
        this.sound('keg-throw', p.x)
        this.telegraph('circle', x, y, PLAYER_BOMB_RADIUS, 840, color, false)
        const keg = this.baseProjectile('keg', 'player', p, { x, y }, 840, color, 12, 'fire')
        keg.arc = 115
        keg.onLand = (lx, ly) => {
            const damage = pirateBombDamage(this.power, this.abilityLevel) * this.damageMult()
            this.sound('keg-explode', lx)
            this.emit({ type: 'explosion', x: lx, y: ly, r: PLAYER_BOMB_RADIUS * 0.7, color, heavy: true })
            this.emit({ type: 'shockwave', x: lx, y: ly, r: PLAYER_BOMB_RADIUS, color })
            this.emit({ type: 'burst', x: lx, y: ly, color: 0xfb923c, count: 26 })
            this.emit({ type: 'shake', amount: 12 })
            const hits = this.blastEnemies(lx, ly, PLAYER_BOMB_RADIUS, damage, color)
            this.popup(lx, ly - 70, hits ? `${hits} HIT${hits === 1 ? '' : 'S'}` : 'NO TARGETS', hits ? 0xfef08a : 0x9ca3af, true)
        }
        this.projectiles.push(keg)
    }

    private castHunterChain() {
        this.player.warheads = PIRATE_HUNTER_CHAIN_COUNT
        this.warheadTimerMs = Math.min(this.warheadTimerMs, 350)
        this.sound('warhead-launch', this.player.x, 1)
        this.popup(this.player.x, this.player.y - 62, "HUNTER'S CHAIN", 0xfca5a5, true)
        this.emit({ type: 'burst', x: this.player.x, y: this.player.y, color: 0xfb7185, count: 16 })
    }

    private updateWarheads(dt: number, dtMs: number) {
        const p = this.player
        if (p.warheads <= 0) {
            this.warheadTimerMs = 0
            return
        }
        p.warheadSpin += dt * 0.9
        this.warheadTimerMs -= dtMs
        if (this.warheadTimerMs > 0) return
        const target = this.nearestEnemy(p.x, p.y)
        if (!target) {
            this.warheadTimerMs = 300
            return
        }
        this.warheadTimerMs = PIRATE_HUNTER_CHAIN_INTERVAL_MS
        // Launch from the warhead's slot in the orbit.
        const slot = (p.warheads - 1) / PIRATE_HUNTER_CHAIN_COUNT * Math.PI * 2 + p.warheadSpin
        p.warheads -= 1
        const from = { x: p.x + Math.cos(slot) * 78, y: p.y + Math.sin(slot) * 78 }
        const w = this.baseProjectile('warhead', 'player', from, target, 2600, 0xfb7185, 7, 'fire')
        w.motion = 'homing'
        w.angle = slot + Math.PI / 2
        w.speed = 380
        w.targetId = target.id
        this.projectiles.push(w)
        this.sound('warhead-launch', from.x, 0.5)
    }

    private stepWarhead(w: Projectile, dtMs: number) {
        const dt = dtMs / 1000
        let target = this.enemies.find(e => e.id === w.targetId && !e.dead && this.targetable(e)) ?? null
        if (!target) {
            target = this.nearestEnemy(w.x, w.y)
            if (target) w.targetId = target.id
        }
        if (target) w.angle = turnToward(w.angle, Math.atan2(target.y - w.y, target.x - w.x), 7 * dt)
        w.speed = Math.min(980, w.speed + 900 * dt)
        w.x += Math.cos(w.angle) * w.speed * dt
        w.y += Math.sin(w.angle) * w.speed * dt
        if (target && dist(w.x, w.y, target.x, target.y) <= target.hitRadius) {
            w.dead = true
            const damage = pirateHunterChainDamage(this.power, this.abilityLevel) * this.damageMult()
            this.sound('warhead-hit', w.x)
            this.emit({ type: 'explosion', x: w.x, y: w.y, r: 34, color: 0xfb7185, heavy: true })
            this.emit({ type: 'shockwave', x: w.x, y: w.y, r: 70, color: 0xfecdd3 })
            this.emit({ type: 'shake', amount: 5 })
            this.damageEnemy(target, damage, true, 0xfca5a5, 'ability')
            return
        }
        if (w.ageMs >= w.durationMs || w.x < -50 || w.y < -50 || w.x > WORLD_W + 50 || w.y > WORLD_H + 50) {
            w.dead = true
            this.emit({ type: 'splash', x: w.x, y: w.y, size: 0.8 })
        }
    }

    private nearestEnemy(x: number, y: number): Enemy | null {
        let best: Enemy | null = null
        let bestD = Infinity
        for (const enemy of this.enemies) {
            if (enemy.dead || !this.targetable(enemy)) continue
            const d = dist2(x, y, enemy.x, enemy.y)
            if (d < bestD) {
                best = enemy
                bestD = d
            }
        }
        return best
    }

    /** True while a summoned escort is still afloat, which locks out a recast. */
    private get consortAtSea() {
        return this.abilityId === 'consort' && this.allies.some(ally => ally.kind === 'consort' && !ally.dead)
    }

    /** The strongest cannon in the hold, ranked by tier rather than slot. */
    private bestCannon(): PlayerGun | null {
        let best: PlayerGun | null = null
        for (const gun of this.cannons) {
            if (!best || tierRank(gun.tierId) > tierRank(best.tierId)) best = gun
        }
        return best
    }

    private castConsort() {
        const template = this.bestCannon()
        if (!template) return
        const p = this.player
        const level = this.abilityLevel
        const statFraction = pirateConsortStatFraction(level)
        const damageFraction = pirateConsortDamageFraction(level)
        const maxHp = Math.max(1, Math.round(this.stats.maxHp * pirateConsortHpFraction(level)))
        const stationAngle = Math.PI / 2
        const at = this.nav.nearestFreePoint(
            clamp(p.x + Math.cos(p.angle + stationAngle) * PIRATE_CONSORT_FOLLOW_DISTANCE, 50, WORLD_W - 50),
            clamp(p.y + Math.sin(p.angle + stationAngle) * PIRATE_CONSORT_FOLLOW_DISTANCE, 50, WORLD_H - 50)
        )
        const ally = this.makeAlly('consort', at, stationAngle, template, pirateConsortCannonCount(level), statFraction, damageFraction, maxHp, 0.72)
        ally.defenseRating = Math.max(1, Math.round(this.stats.defenseRating * statFraction))
        this.allies.push(ally)
        this.sound('consort-summon', at.x)
        this.popup(p.x, p.y - 62, 'GHOSTLY CONSORT', 0x93c5fd, true)
        this.emit({ type: 'burst', x: at.x, y: at.y, color: 0x93c5fd, count: 20 })
        this.emit({ type: 'splash', x: at.x, y: at.y, size: 1.2 })
    }

    private makeAlly(kind: SimAlly['kind'], at: Point, stationAngle: number, template: PlayerGun, count: number, accuracy: number, damage: number, maxHp: number, scale: number): Ally {
        const hull = playerHull(scale)
        const mounts = pirateGunMounts(count, hull)
        const guns: AllyGun[] = mounts.map((mount) => {
            const rest = mount.y === 0 ? 0 : mount.y < 0 ? -Math.PI / 2 : Math.PI / 2
            return {
                mountX: mount.x,
                mountY: mount.y,
                aim: this.player.angle + rest,
                color: kind === 'ghost' ? 0xc4b5fd : 0x93c5fd,
                length: template.length * 0.85,
                bore: template.bore * 0.85,
                recoil: 0,
                charge: 1,
                style: 'spectral' as const,
                tierId: template.tierId,
                attackRating: Math.max(1, Math.round(template.attackRating * accuracy)),
                maxDamage: Math.max(1, Math.round(template.maxDamage * damage)),
                reloadMs: template.reloadMs,
                range: template.range,
                reloadTimer: randRange(0, template.reloadMs * 0.5),
                rest
            }
        })
        return {
            id: this.nextId++,
            kind,
            x: at.x,
            y: at.y,
            angle: this.player.angle,
            velocity: 0,
            hp: maxHp,
            maxHp,
            guns,
            flashMs: 0,
            ageMs: 0,
            stationAngle,
            defenseRating: this.stats.defenseRating,
            speed: this.stats.speed * 1.06,
            fireGapMs: 0,
            dead: false
        }
    }

    /** Ghost Crew sloops: one per stack, orbiting the ship. */
    private syncGhosts() {
        const want = this.stack('ghost-crew')
        const have = this.allies.filter(ally => ally.kind === 'ghost' && !ally.dead).length
        const template = this.bestCannon()
        if (!template) return
        for (let i = have; i < want; i++) {
            const stationAngle = i * Math.PI
            const at = this.nav.nearestFreePoint(clamp(this.player.x + Math.cos(stationAngle) * 100, 50, WORLD_W - 50), clamp(this.player.y + Math.sin(stationAngle) * 100, 50, WORLD_H - 50))
            this.allies.push(this.makeAlly('ghost', at, stationAngle, template, PIRATE_UPGRADE_EFFECTS.ghostCrewGuns, 1, PIRATE_UPGRADE_EFFECTS.ghostCrewDamage, 1, 0.6))
            this.emit({ type: 'burst', x: at.x, y: at.y, color: 0xc4b5fd, count: 16 })
        }
    }

    private updateAllies(dt: number, dtMs: number) {
        const p = this.player
        for (const ally of this.allies) {
            if (ally.dead) continue
            ally.ageMs += dtMs
            if (ally.flashMs > 0) ally.flashMs = Math.max(0, ally.flashMs - dtMs)
            let stationX: number
            let stationY: number
            if (ally.kind === 'ghost') {
                ally.stationAngle += dt * 0.6
                stationX = p.x + Math.cos(ally.stationAngle) * 100
                stationY = p.y + Math.sin(ally.stationAngle) * 100
            } else {
                stationX = p.x + Math.cos(p.angle + ally.stationAngle) * PIRATE_CONSORT_FOLLOW_DISTANCE
                stationY = p.y + Math.sin(p.angle + ally.stationAngle) * PIRATE_CONSORT_FOLLOW_DISTANCE
            }
            const toStation = dist(ally.x, ally.y, stationX, stationY)
            if (toStation > 8) {
                const angle = Math.atan2(stationY - ally.y, stationX - ally.x)
                const urgency = toStation > 220 ? 1.9 : toStation < 40 ? toStation / 40 : 1
                const speed = Math.max(ally.speed, p.velocity * 1.1) * urgency
                const step = Math.min(speed * dt, toStation)
                ally.velocity = speed
                if (ally.kind === 'ghost') {
                    // Spectral hulls glide over rocks.
                    ally.x += Math.cos(angle) * step
                    ally.y += Math.sin(angle) * step
                } else {
                    this.moveHull(ally, Math.cos(angle) * step, Math.sin(angle) * step, SHIP_RADIUS - 10)
                }
                ally.angle = turnToward(ally.angle, toStation > 30 ? angle : p.angle, 4 * dt)
            } else {
                ally.velocity = p.velocity
                ally.angle = turnToward(ally.angle, p.angle, 3 * dt)
            }

            ally.fireGapMs = Math.max(0, ally.fireGapMs - dtMs)
            const reach = ally.guns.reduce((max, gun) => Math.max(max, gun.range), 0)
            const target = this.nearestEnemy(ally.x, ally.y)
            const inReach = target && dist(ally.x, ally.y, target.x, target.y) <= reach ? target : null
            for (const gun of ally.guns) {
                gun.reloadTimer -= dtMs
                const off = this.slewGun(gun, ally, inReach, dt)
                if (!inReach || gun.reloadTimer > 0 || ally.fireGapMs > 0 || off > GUN_FIRE_ARC) continue
                gun.reloadTimer = gun.reloadMs * PIRATE_TIMELINE_SCALE
                ally.fireGapMs = PLAYER_CANNON_FIRE_GAP_MS
                this.fireAllyGun(ally, gun, inReach)
            }
        }
    }

    private fireAllyGun(ally: Ally, gun: AllyGun, target: Enemy) {
        gun.recoil = 1
        const from = this.muzzle(ally, gun)
        this.emit({ type: 'muzzle', x: from.x, y: from.y, angle: gun.aim, color: gun.color, size: 0.8 })
        this.sound('cannon', from.x, 0.2)
        const targetId = target.id
        this.launchBall({
            kind: 'ball',
            owner: 'ally',
            from,
            target: { kind: 'enemy', id: targetId },
            to: target,
            color: gun.color,
            size: 4,
            trail: 'spectral',
            onLand: (x, y) => {
                const enemy = this.enemies.find(e => e.id === targetId)
                if (!enemy || enemy.dead || !this.targetable(enemy)) {
                    this.emit({ type: 'splash', x, y, size: 0.6 })
                    return
                }
                const roll = pirateRollAttack(gun.attackRating, enemy.defense, gun.maxDamage)
                if (!roll.hit) {
                    this.emit({ type: 'splash', x, y, size: 0.6 })
                    return
                }
                this.emit({ type: 'impact', x, y, color: gun.color, heavy: roll.crit })
                this.damageEnemy(enemy, roll.dmg * this.damageMult(), roll.crit, gun.color, ally.kind === 'consort' ? 'ability' : 'upgrade')
            }
        })
    }

    private damageAlly(ally: Ally, amount: number) {
        if (ally.dead || ally.kind === 'ghost') return
        ally.hp = Math.max(0, ally.hp - amount)
        ally.flashMs = 150
        this.emit({ type: 'impact', x: ally.x, y: ally.y, color: 0x60a5fa, heavy: false })
        this.popup(ally.x, ally.y - 34, `-${Math.round(amount)}`, 0xbfdbfe, false)
        if (ally.hp > 0) return
        ally.dead = true
        this.wrecks.push({ id: ally.id, tierId: null, side: 'ally', x: ally.x, y: ally.y, angle: ally.angle, color: 0x93c5fd, sizeScale: 0.72, skinId: this.player.skinId, progress: 0, boss: null, dead: false })
        this.emit({ type: 'explosion', x: ally.x, y: ally.y, r: 30, color: 0x60a5fa, heavy: true })
        this.popup(ally.x, ally.y - 50, 'CONSORT LOST', 0x93c5fd, true)
        // Losing the escort is what starts the clock.
        if (this.abilityId === 'consort' && !this.consortAtSea) this.abilityCooldownRemaining = this.abilityCooldownMs
    }

    private makeZone(kind: ZoneKind, x: number, y: number, r: number, angle: number, durationMs: number): Zone {
        return { id: this.nextId++, kind, x, y, r, angle, ageMs: 0, durationMs, pulseTimer: 0, pulsesLeft: 0, damage: 0, hit: new Set(), travelled: 0, tickTimer: 0, dead: false }
    }

    private castMaelstrom(x: number, y: number) {
        const zone = this.makeZone('maelstrom', x, y, PIRATE_MAELSTROM_RADIUS, 0, 4200)
        zone.pulsesLeft = 7
        zone.pulseTimer = 350
        zone.damage = pirateMaelstromPulseDamage(this.power, this.abilityLevel)
        this.zones.push(zone)
        this.clearMines(x, y, PIRATE_MAELSTROM_RADIUS)
        this.sound('maelstrom-open', x)
        this.sound('maelstrom-loop-start', x)
        this.schedule(4250, () => this.sound('maelstrom-loop-stop'))
    }

    /**
     * A deliberate gamble: the zone is enormous, but the seven shells land at
     * random points inside it. A lucky cluster erases a fleet; an unlucky
     * spread throws up a lot of seawater.
     */
    private castHellfire(x: number, y: number) {
        this.zones.push(this.makeZone('hellfire', x, y, PIRATE_HELLFIRE_ZONE_RADIUS, 0, 2800))
        this.sound('hellfire-call', x)
        this.popup(x, y - PIRATE_HELLFIRE_ZONE_RADIUS - 30, 'HELLFIRE INBOUND', 0xfdba74, true)
        let landed = 0
        let struck = 0
        for (let i = 0; i < PIRATE_HELLFIRE_SHELL_COUNT; i++) {
            const angle = randRange(0, Math.PI * 2)
            const radius = Math.sqrt(randomFloat()) * PIRATE_HELLFIRE_ZONE_RADIUS
            const sx = clamp(x + Math.cos(angle) * radius, 45, WORLD_W - 45)
            const sy = clamp(y + Math.sin(angle) * radius, 45, WORLD_H - 45)
            const delay = i * 190 + randRange(0, 120)
            this.schedule(delay, () => {
                this.telegraph('circle', sx, sy, PIRATE_HELLFIRE_BLAST_RADIUS, 700, 0xfb923c, false)
                const shell = this.baseProjectile('shell', 'player', { x: sx - 60, y: sy }, { x: sx, y: sy }, 700, 0xf97316, 11, 'fire')
                shell.arc = 280
                shell.fall = true
                shell.onLand = (lx, ly) => {
                    landed += 1
                    const damage = pirateHellfireShellDamage(this.power, this.abilityLevel) * this.damageMult()
                    this.sound('hellfire-impact', lx)
                    this.emit({ type: 'explosion', x: lx, y: ly, r: PIRATE_HELLFIRE_BLAST_RADIUS * 0.75, color: 0xf97316, heavy: true })
                    this.emit({ type: 'shockwave', x: lx, y: ly, r: PIRATE_HELLFIRE_BLAST_RADIUS, color: 0xfb923c })
                    this.emit({ type: 'shake', amount: 8 })
                    const hits = this.blastEnemies(lx, ly, PIRATE_HELLFIRE_BLAST_RADIUS, damage, 0xfdba74)
                    struck += hits
                    if (!hits) this.emit({ type: 'splash', x: lx, y: ly, size: 1.5 })
                    if (landed === PIRATE_HELLFIRE_SHELL_COUNT) {
                        this.popup(x, y - PIRATE_HELLFIRE_ZONE_RADIUS - 60, struck ? `${struck} SHELL${struck === 1 ? '' : 'S'} ON TARGET` : 'ALL WATER', struck ? 0xfef08a : 0x9ca3af, true)
                    }
                }
                this.projectiles.push(shell)
            })
        }
    }

    private castRogueWave(x: number, y: number) {
        const p = this.player
        const angle = Math.atan2(y - p.y, x - p.x)
        const zone = this.makeZone('wave', p.x + Math.cos(angle) * 40, p.y + Math.sin(angle) * 40, PIRATE_ROGUE_WAVE_WIDTH / 2, angle, PIRATE_ROGUE_WAVE_LENGTH / PIRATE_ROGUE_WAVE_SPEED * 1000)
        zone.damage = pirateRogueWaveDamage(this.power, this.abilityLevel)
        this.zones.push(zone)
        this.sound('wave-roll', p.x)
        this.emit({ type: 'splash', x: p.x, y: p.y, size: 2 })
    }

    private updateZones(dt: number, dtMs: number) {
        const p = this.player
        for (const zone of this.zones) {
            if (zone.dead) continue
            zone.ageMs += dtMs
            if (zone.ageMs >= zone.durationMs) zone.dead = true

            if (zone.kind === 'maelstrom') {
                zone.pulseTimer -= dtMs
                if (zone.pulseTimer <= 0 && zone.pulsesLeft > 0) {
                    zone.pulsesLeft -= 1
                    zone.pulseTimer = 520
                    const damage = zone.damage * this.damageMult()
                    for (const enemy of this.enemies) {
                        if (enemy.dead || !this.targetable(enemy) || dist(zone.x, zone.y, enemy.x, enemy.y) > zone.r) continue
                        if (enemy.tier.boss !== 'kraken') {
                            enemy.x += (zone.x - enemy.x) * PIRATE_MAELSTROM_PULL
                            enemy.y += (zone.y - enemy.y) * PIRATE_MAELSTROM_PULL
                        }
                        this.damageEnemy(enemy, damage, false, 0x67e8f9, 'ability')
                    }
                }
            } else if (zone.kind === 'whirlpool') {
                const d = dist(p.x, p.y, zone.x, zone.y)
                if (d <= zone.r && d > 4) {
                    const pull = 75 * dt
                    this.moveHull(p, (zone.x - p.x) / d * pull, (zone.y - p.y) / d * pull, SHIP_RADIUS - 6)
                    zone.tickTimer -= dtMs
                    if (zone.tickTimer <= 0) {
                        zone.tickTimer = 500
                        this.damagePlayer(zone.damage)
                    }
                }
            } else if (zone.kind === 'wave') {
                const step = PIRATE_ROGUE_WAVE_SPEED * dt
                zone.x += Math.cos(zone.angle) * step
                zone.y += Math.sin(zone.angle) * step
                zone.travelled += step
                this.updateWave(zone)
            }
        }
    }

    /** The Rogue Wave's band: hits each ship once, shoves it along, and washes away hostile shot and mines. */
    private updateWave(zone: Zone) {
        const cos = Math.cos(zone.angle)
        const sin = Math.sin(zone.angle)
        const inBand = (x: number, y: number, pad: number) => {
            const dx = x - zone.x
            const dy = y - zone.y
            const along = dx * cos + dy * sin
            const across = -dx * sin + dy * cos
            return Math.abs(along) <= 34 + pad && Math.abs(across) <= zone.r + pad * 0.5
        }
        for (const enemy of this.enemies) {
            if (enemy.dead || zone.hit.has(enemy.id) || !this.targetable(enemy) || !inBand(enemy.x, enemy.y, enemy.hitRadius)) continue
            zone.hit.add(enemy.id)
            this.damageEnemy(enemy, zone.damage * this.damageMult(), true, 0x7dd3fc, 'ability')
            if (!enemy.dead) this.knockback(enemy, zone.angle, PIRATE_ROGUE_WAVE_KNOCKBACK)
            this.emit({ type: 'splash', x: enemy.x, y: enemy.y, size: 1.4 })
        }
        for (const proj of this.projectiles) {
            if (proj.dead || proj.owner !== 'enemy' || proj.z > 60 || !inBand(proj.x, proj.y, 10)) continue
            proj.dead = true
            this.emit({ type: 'splash', x: proj.x, y: proj.y, size: 0.6 })
        }
        for (const mine of this.mines) {
            if (mine.dead || !inBand(mine.x, mine.y, 16)) continue
            mine.dead = true
            this.emit({ type: 'explosion', x: mine.x, y: mine.y, r: 30, color: 0x38bdf8, heavy: false })
        }
        for (const t of this.telegraphs) {
            // Skiff and mine telegraphs go with the shot they announced; let the rest play out.
            if (t.hostile && t.kind === 'circle' && (t.color === 0x06b6d4 || t.color === 0x3b82f6) && inBand(t.x, t.y, 30)) t.dead = true
        }
    }

    // ─── Pickups ────────────────────────────────────────────────────────────

    private openWater(minFromPlayer: number): Point {
        const margin = 110
        let x = randRange(margin, WORLD_W - margin)
        let y = randRange(margin, WORLD_H - margin)
        if (dist(x, y, this.player.x, this.player.y) < minFromPlayer) {
            x = WORLD_W - x
            y = WORLD_H - y
        }
        if (this.nav.pointInIsland(x, y, 45)) return this.nav.nearestFreePoint(x, y)
        return { x, y }
    }

    private spawnCrate(x?: number, y?: number, minRarity: PirateRarity = 'common') {
        const stacks: Partial<Record<PiratePowerUpId, number>> = {}
        for (const [id, n] of this.powerUpStacks) stacks[id] = n
        // Crates already afloat count too, so two can't promise the same last stack.
        for (const pickup of this.pickups) {
            if (!pickup.dead && pickup.powerUpId) stacks[pickup.powerUpId] = (stacks[pickup.powerUpId] ?? 0) + 1
        }
        const def = pirateRollPowerUp(stacks, minRarity)
        if (!def) return
        const at = x !== undefined && y !== undefined
            ? (this.nav.pointInIsland(x, y, 30) ? this.nav.nearestFreePoint(x, y) : { x, y })
            : this.openWater(260)
        this.pickups.push({
            id: this.nextId++,
            kind: 'crate',
            x: at.x,
            y: at.y,
            vx: randRange(-12, 12),
            vy: randRange(-12, 12),
            ageMs: 0,
            lifespanMs: PIRATE_POWER_UP_LIFESPAN_MS * (rarityIndex(def.rarity) >= 3 ? 1.4 : 1),
            powerUpId: def.id,
            rarity: def.rarity,
            healFraction: 0,
            dead: false
        })
        this.sound('crate-spawn', at.x, rarityIndex(def.rarity) / 4)
        this.announce({ kind: 'crate', title: def.name, subtitle: 'Salvage sighted', rarity: def.rarity, powerUpId: def.id })
    }

    private spawnRepair(x?: number, y?: number) {
        const at = x !== undefined && y !== undefined ? { x, y } : this.openWater(220)
        this.pickups.push({
            id: this.nextId++,
            kind: 'repair',
            x: at.x,
            y: at.y,
            vx: randRange(-10, 10),
            vy: randRange(-10, 10),
            ageMs: 0,
            lifespanMs: PIRATE_HEALTH_PACK_LIFESPAN_MS,
            healFraction: randRange(0.15, 0.25),
            dead: false
        })
    }

    private updatePickups(dt: number, dtMs: number) {
        const p = this.player
        for (const pickup of this.pickups) {
            if (pickup.dead) continue
            pickup.ageMs += dtMs
            pickup.x += pickup.vx * dt
            pickup.y += pickup.vy * dt
            const margin = 65
            if (pickup.x < margin || pickup.x > WORLD_W - margin) pickup.vx *= -1
            if (pickup.y < margin || pickup.y > WORLD_H - margin) pickup.vy *= -1
            if (this.nav.pointInIsland(pickup.x + pickup.vx * dt * 8, pickup.y + pickup.vy * dt * 8, 24)) {
                pickup.vx *= -1
                pickup.vy *= -1
            }
            const reach = PICKUP_RADIUS + 6
            if (dist2(pickup.x, pickup.y, p.x, p.y) < reach * reach && (pickup.kind === 'crate' || p.hp < p.maxHp)) {
                pickup.dead = true
                if (pickup.kind === 'crate') this.applyPowerUp(pickup)
                else this.collectRepair(pickup)
            } else if (pickup.ageMs >= pickup.lifespanMs) {
                pickup.dead = true
            }
        }

        this.crateTimerMs -= dtMs
        if (this.crateTimerMs <= 0) {
            this.crateTimerMs += PIRATE_POWER_UP_INTERVAL_MS
            if (!this.pickups.some(pickup => !pickup.dead && pickup.kind === 'crate')) this.spawnCrate()
        }
        this.repairTimerMs -= dtMs
        if (this.repairTimerMs <= 0) {
            this.repairTimerMs += PIRATE_HEALTH_PACK_INTERVAL_MS
            if (!this.pickups.some(pickup => !pickup.dead && pickup.kind === 'repair')) this.spawnRepair()
        }
    }

    private applyPowerUp(pickup: Pickup) {
        const def = piratePowerUp(pickup.powerUpId!)
        const stacks = Math.min(def.maxStacks, this.stack(def.id) + 1)
        this.powerUpStacks.set(def.id, stacks)
        const p = this.player
        const color = PIRATE_RARITIES[rarityIndex(def.rarity)]!.color
        if (def.id === 'oak-planking') {
            const before = p.maxHp
            p.maxHp = Math.round(this.baseMaxHp * (1 + stacks * PIRATE_UPGRADE_EFFECTS.oakHullPerStack))
            this.healPlayer(p.maxHp - before, true)
        }
        if (def.id === 'oak-planking' || def.id === 'tide-ward') {
            p.maxShield = Math.round(p.maxHp * PIRATE_UPGRADE_EFFECTS.tideWardShieldPerStack * this.stack('tide-ward'))
            if (def.id === 'tide-ward') p.shield = p.maxShield
        }
        if (def.id === 'ghost-crew') this.syncGhosts()
        if (def.id === 'titan-shot') this.titanCounter = 0
        this.sound('crate-pickup', pickup.x, rarityIndex(def.rarity) / 4)
        this.emit({ type: 'burst', x: pickup.x, y: pickup.y, color, count: 18 + rarityIndex(def.rarity) * 6 })
        this.emit({ type: 'shockwave', x: pickup.x, y: pickup.y, r: 70, color })
        this.popup(pickup.x, pickup.y - 40, `${def.name.toUpperCase()}${ROMAN[stacks]}`, color, true)
        this.announce({ kind: 'upgrade', title: `${def.name}${ROMAN[stacks]}`, subtitle: def.description, rarity: def.rarity, powerUpId: def.id })
    }

    private collectRepair(pickup: Pickup) {
        const p = this.player
        const healed = this.healPlayer(Math.max(1, Math.round(p.maxHp * pickup.healFraction)), true)
        this.sound('repair-pickup', pickup.x)
        this.popup(pickup.x, pickup.y - 36, `+${Math.round(healed)} HULL`, 0x86efac, true)
        this.announce({ kind: 'repair', title: `Hull repaired +${Math.round(healed)}` })
    }

    // ─── Sea mines ──────────────────────────────────────────────────────────

    private updateMines(dtMs: number) {
        this.mineTimerMs -= dtMs
        if (this.mineTimerMs <= 0) {
            this.mineTimerMs += PIRATE_SEA_MINE_INTERVAL_MS
            this.spawnMine()
        }
        const p = this.player
        for (const mine of this.mines) {
            if (mine.dead) continue
            mine.ageMs += dtMs
            if (dist2(mine.x, mine.y, p.x, p.y) < 50 * 50) {
                mine.dead = true
                this.emit({ type: 'explosion', x: mine.x, y: mine.y, r: 50, color: 0xef4444, heavy: true })
                this.sound('mine-explode', mine.x)
                this.emit({ type: 'shake', amount: 12 })
                this.popup(p.x, p.y - 58, `MINE -${Math.round(mine.damageFraction * 100)}%`, 0xfca5a5, true)
                this.damagePlayer(Math.max(1, Math.round(p.maxHp * mine.damageFraction)), true)
            } else if (mine.ageMs >= mine.lifespanMs) {
                mine.dead = true
            }
        }
    }

    private spawnMine() {
        const margin = 80
        for (let attempt = 0; attempt < 40; attempt++) {
            const x = randRange(margin, WORLD_W - margin)
            const y = randRange(margin, WORLD_H - margin)
            if (dist(x, y, this.player.x, this.player.y) < 320) continue
            if (this.nav.pointInIsland(x, y, 38)) continue
            if (this.mines.some(mine => dist(x, y, mine.x, mine.y) < 130)) continue
            this.mines.push({ id: this.nextId++, x, y, ageMs: 0, lifespanMs: PIRATE_SEA_MINE_LIFESPAN_MS, damageFraction: pirateSeaMineDamageFraction(this.elapsedMs), dead: false })
            return
        }
    }

    // ─── End ────────────────────────────────────────────────────────────────

    private endGame(survived: boolean, reason: 'timeout' | 'defeat' | 'cancelled') {
        if (this.ended) return
        this.ended = true
        this.running = false
        this.timers = []
        const p = this.player
        p.path = []
        p.attackTargetId = null
        p.warheads = 0
        for (const ally of this.allies) ally.dead = true
        if (reason === 'defeat') {
            p.alive = false
            this.wrecks.push({ id: 0, tierId: null, side: 'player', x: p.x, y: p.y, angle: p.angle, color: 0xf4d35e, sizeScale: 1, skinId: p.skinId, progress: 0, boss: null, dead: false })
            this.emit({ type: 'explosion', x: p.x, y: p.y, r: 50, color: 0xef4444, heavy: true })
            this.emit({ type: 'shake', amount: 14 })
            this.sound('player-sunk', p.x)
            this.sound('defeat')
        } else if (reason === 'timeout') {
            this.sound('voyage-complete')
        }
        this.sound('maelstrom-loop-stop')
        this.flushPopups(PLAYER_POPUP_MS)
        this.cleanup()
        this.hooks.onGameOver?.({
            survived,
            coins: this.coins,
            elapsedMs: this.elapsedMs,
            ammoUsed: this.ammoStart - this.ammo,
            gemAmmoUsed: this.gemAmmoStart - this.gemAmmo,
            kills: this.kills,
            bossesSunk: this.bossesSunk,
            shotsFired: this.shotsFired,
            abilitiesUsed: this.abilitiesUsed,
            damageDealt: Math.round(this.damageDealt),
            sunkByType: [...this.sunkByType.entries()]
                .map(([id, value]) => ({ id, ...value }))
                .sort((a, b) => b.count - a.count),
            powerUps: PIRATE_POWER_UPS.filter(def => this.stack(def.id) > 0).map(def => ({ id: def.id, stacks: this.stack(def.id) })),
            reason,
            hullDamageFraction: reason === 'defeat' ? 1 : clamp(1 - p.hp / p.maxHp, 0, 1)
        })
    }
}
