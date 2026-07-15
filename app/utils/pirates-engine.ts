import { Application, Assets, Container, Graphics, Sprite, Text, Circle, type Texture } from 'pixi.js'
import gsap from 'gsap'
import {
    PIRATE_RUN_DURATION_MS, PIRATE_TIMELINE_SCALE, PIRATE_LATE_BOSS_PHASE_MS,
    PIRATE_TREASURE_MIN_INTERVAL_MS, PIRATE_TREASURE_MAX_INTERVAL_MS, PIRATE_TREASURE_LIFESPAN_MS,
    PIRATE_POWER_UP_INTERVAL_MS, PIRATE_POWER_UP_LIFESPAN_MS,
    PIRATE_HEALTH_PACK_INTERVAL_MS, PIRATE_HEALTH_PACK_LIFESPAN_MS,
    PIRATE_SEA_MINE_INTERVAL_MS, PIRATE_SEA_MINE_LIFESPAN_MS,
    PIRATE_REGEN_DELAY_MS,
    PIRATE_AMMO_RANGE_MULT, PIRATE_AMMO_DAMAGE_MULT,
    PIRATE_GEM_AMMO_ATTACK_MULT, PIRATE_GEM_AMMO_DAMAGE_MULT,
    PIRATE_COMBO_WINDOW_MS, PIRATE_COMBO_BONUS_PER_STACK, PIRATE_COMBO_MAX_STACKS,
    PIRATE_BOSS_FIRST_SPAWN_MS, PIRATE_BOSS_RESPAWN_MS, PIRATE_BOSS_DAMAGE_MULT, PIRATE_DOUBLE_BOSS_DIFFICULTY,
    PIRATE_BOSS_ABILITY_INITIAL_MIN_MS, PIRATE_BOSS_ABILITY_INITIAL_MAX_MS,
    PIRATE_BOSS_ABILITY_COOLDOWN_MIN_MS, PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS, PIRATE_ENEMY_TIERS,
    pirateSpawnIntervalMs, pirateMaxConcurrentEnemies, pirateRollEnemyTier, pirateDifficultyMultiplier,
    pirateTreasureReward, pirateRollAttack, pirateRewardMultiplier, pirateBossFirstSpawnMs,
    pirateInitialEnemyCount, pirateSpawnBatchSize,
    pirateSeaMineDamageFraction,
    pirateEnemyReloadMultiplier, pirateMaxPayoutForRun,
    PIRATE_SHIP_SKINS, PIRATE_POWER_UPS, pirateAbility,
    type PirateEnemyTier, type PirateAbilityId, type PiratePowerUpId, type PiratePowerUpDefinition
} from '#shared/utils/gamelogic/pirates'

export interface PirateCannonRuntime {
    slotIndex: number
    tierId: string
    attackRating: number
    maxDamage: number
    reloadMs: number
    range: number
    shotColor: number
    shotTrail: boolean
}

export interface PirateShipStats {
    maxHp: number
    speed: number
    defenseRating: number
    /** Passive hull regen in HP/sec, applied only after PIRATE_REGEN_DELAY_MS without a hit. */
    regenRate: number
    cannons: PirateCannonRuntime[]
    ammo: number
    gemAmmo: number
    skinId: string
    abilityId: PirateAbilityId
}

export interface PirateGameOverResult {
    survived: boolean
    coins: number
    elapsedMs: number
    ammoUsed: number
    gemAmmoUsed: number
    kills: number
    shotsFired: number
    abilitiesUsed: number
    sunkByType: { id: string, name: string, count: number }[]
    maxCombo: number
    reason: 'timeout' | 'defeat' | 'cancelled'
    /** 0 (pristine) to 1 (sunk) — drives how long the ship spends in dry dock afterward. */
    hullDamageFraction: number
}

export interface PirateActivePowerUp {
    id: PiratePowerUpId
    name: string
    description: string
    icon: string
    remainingMs: number | null
    stacks: number
    counter?: number
    shield?: number
}

export interface PirateGameCallbacks {
    onHpChange: (hp: number, maxHp: number) => void
    onCoinsChange: (coins: number) => void
    onAmmoChange: (ammo: number, gemAmmo: number) => void
    onAbilityCooldownChange: (remainingMs: number, totalMs: number) => void
    onTimeChange: (elapsedMs: number, remainingMs: number) => void
    onGameOver: (result: PirateGameOverResult) => void
    onKill?: (tierName: string, reward: number) => void
    onCombo?: (count: number) => void
    onBossSpawn?: (name: string) => void
    onPowerUpsChange?: (powerUps: PirateActivePowerUp[], nextDropMs: number, nextHealthPackMs: number) => void
    onPowerUpSpawn?: (name: string) => void
    onPowerUpCollected?: (name: string) => void
    onHealthPackSpawn?: () => void
    onHealthPackCollected?: (amount: number) => void
}

// World is authored in a fixed design space and the whole `world` container is
// scaled to fit the host element on resize.
const WORLD_W = 1400
const WORLD_H = 820
const BALL_SPEED = 780 // px/s
const PICKUP_RADIUS = 46
const HOLD_RANGE_FRACTION = 0.85
const ROTATE_LERP = 0.12
const WAYPOINT_REACH_DIST = 12
const PLAYER_BOMB_RADIUS = 145
const ENEMY_POWER_UP_DROP_CHANCE = 0.1
const ENEMY_HEALTH_PACK_DROP_CHANCE = 0.05

// Pathfinding grid — coarse cells over circular island obstacles. Ships are
// treated as circles of SHIP_RADIUS for clearance checks.
const CELL = 35
const GRID_W = Math.ceil(WORLD_W / CELL)
const GRID_H = Math.ceil(WORLD_H / CELL)
const SHIP_RADIUS = 26
const ISLAND_COUNT_MIN = 4
const ISLAND_COUNT_MAX = 6
const RAIDER_SHIP_SPRITE = '/pirates/sprites/raider-ship.png'
const DPS_RAIDER_SPRITE = '/pirates/sprites/dps-raider.png'
const TANK_RAIDER_SPRITE = '/pirates/sprites/tank-raider.png'
const SNIPER_SHIP_SPRITE = '/pirates/sprites/sniper-ship.png'
const ISLAND_SPRITES = [
    '/pirates/sprites/tropical-island.png',
    '/pirates/sprites/volcanic-island.png',
    '/pirates/sprites/ruins-island.png'
]

type AmmoKind = 'free' | 'standard' | 'gem'

interface Cannon extends PirateCannonRuntime {
    reloadTimer: number
}

interface PlayerShotProfile {
    explosive: boolean
    massive: boolean
    cannonColor: number
    tierTrail: boolean
}

interface Island {
    x: number
    y: number
    r: number
}

interface ShipVisual {
    root: Container
    hull: Container
    body: Container
    sprite?: Sprite
    sails: Graphics[]
    flashOverlay: Graphics
    phase: number
}

interface Enemy {
    id: number
    tier: PirateEnemyTier
    hp: number
    maxHp: number
    x: number
    y: number
    angle: number
    reloadTimer: number
    abilityTimer: number
    speed: number
    defense: number
    attackRating: number
    maxDamage: number
    root: Container
    visual: ShipVisual
    targetRing: Graphics
    hpBarFill: Graphics
    hpBarWidth: number
    dead: boolean
}

interface Treasure {
    root: Container
    x: number
    y: number
    vx: number
    vy: number
    reward: number
    age: number
}

interface PowerUpPickup {
    root: Container
    definition: PiratePowerUpDefinition
    x: number
    y: number
    vx: number
    vy: number
    age: number
}

interface HealthPackPickup {
    root: Container
    x: number
    y: number
    vx: number
    vy: number
    age: number
    healFraction: number
}

interface SeaMine {
    root: Container
    x: number
    y: number
    age: number
    damageFraction: number
}

type EnemyAbility = 'sniper' | 'mine' | 'bomb' | 'skiffs'

function lerpAngle(from: number, to: number, t: number) {
    let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI
    if (diff < -Math.PI) diff += Math.PI * 2
    return from + diff * t
}

function dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1)
}

function randRange(min: number, max: number) {
    return min + Math.random() * (max - min)
}

/** Shortest distance from segment (a→b) to point p. */
function segPointDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(px - ax, py - ay)
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

export class PirateGame {
    private app: Application | null = null
    private world = new Container()
    private bg = new Graphics()
    private waveLayer = new Container()
    private obstacleLayer = new Container()
    private treasureLayer = new Container()
    private enemyLayer = new Container()
    private playerLayer = new Container()
    private effectsLayer = new Container()

    private callbacks: PirateGameCallbacks
    private stats: PirateShipStats
    private power = 5
    private difficulty = 0
    private runDurationMs = PIRATE_RUN_DURATION_MS

    private running = false
    private paused = false
    private destroyed = false
    private elapsedMs = 0
    private timeSec = 0
    private playerHp = 100
    // Passive regen: once the ship has been out of combat (no hit taken and no
    // shot fired) for PIRATE_REGEN_DELAY_MS, it heals on a fixed 1-second tick.
    private msOutOfCombat = 0
    private regenTickMs = 0
    private coins = 0
    private rawCoins = 0
    private ammo = 0
    private gemAmmo = 0
    private ammoStart = 0
    private gemAmmoStart = 0
    private preferGem = false
    private cannons: Cannon[] = []
    private maxCannonRange = 220
    private playerX = WORLD_W / 2
    private playerY = WORLD_H / 2
    private playerAngle = 0
    private playerPath: { x: number, y: number }[] = []
    private chasePathTimer = 0
    private attackTargetId: number | null = null
    private wakeTimer = 0
    private spawnTimerMs = 0
    private bossTimerMs = PIRATE_BOSS_FIRST_SPAWN_MS
    private bossCount = 0
    private treasureTimerMs = 0
    private powerUpTimerMs = PIRATE_POWER_UP_INTERVAL_MS
    private healthPackTimerMs = PIRATE_HEALTH_PACK_INTERVAL_MS
    private seaMineTimerMs = PIRATE_SEA_MINE_INTERVAL_MS
    private powerUpHudTimerMs = 0
    private nextEnemyId = 1
    private enemies = new Map<number, Enemy>()
    private treasure: Treasure | null = null
    private powerUpPickups: PowerUpPickup[] = []
    private healthPackPickups: HealthPackPickup[] = []
    private seaMines: SeaMine[] = []
    private activePowerUps = new Map<PiratePowerUpId, number | null>()
    private powerUpStacks = new Map<PiratePowerUpId, number>()
    private shieldHp = 0
    private blastShotCount = 0
    private titanShotCount = 0
    private player!: ShipVisual
    private playerHealthBar = new Container()
    private playerHealthBarFill = new Graphics()
    private razorOrbit = new Container()
    private ghostArmada = new Container()
    private razorVisualStacks = 0
    private ghostVisualStacks = 0
    private razorDamageTimerMs = 0
    private starburstTimerMs = 0
    private tempestTimerMs = 0
    private ghostFireTimerMs = 0
    private playerShipTexture: Texture | null = null
    private playerSkinTextures = new Map<string, Texture>()
    private raiderShipTexture: Texture | null = null
    private dpsRaiderTexture: Texture | null = null
    private tankRaiderTexture: Texture | null = null
    private sniperShipTexture: Texture | null = null
    private islandTextures: Texture[] = []
    private islands: Island[] = []
    private blocked: Uint8Array = new Uint8Array(GRID_W * GRID_H)
    private popupLanes = new Map<string, number>()
    private kills = 0
    private combo = 0
    private maxCombo = 0
    private lastKillAt = -Infinity
    private shotsFired = 0
    private abilitiesUsed = 0
    private sunkByType = new Map<string, { name: string, count: number }>()
    private playerAbilityCooldownMs = 0
    private abilityHudTimerMs = 0
    private contextMenuHandler: ((event: MouseEvent) => void) | null = null
    private steeringPointerMoveHandler: ((event: PointerEvent) => void) | null = null
    private steeringPointerUpHandler: (() => void) | null = null
    private steeringPointerDown: { x: number, y: number } | null = null
    private lastSteeringUpdateAt = 0

    constructor(callbacks: PirateGameCallbacks, initialStats: PirateShipStats) {
        this.callbacks = callbacks
        this.stats = initialStats
    }

    async mount(container: HTMLDivElement) {
        this.app = new Application()
        await this.app.init({
            width: WORLD_W,
            height: WORLD_H,
            backgroundAlpha: 1,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2)
        })

        this.app.canvas.classList.add('h-full', 'w-full', 'block', 'touch-none')
        container.appendChild(this.app.canvas)
        this.contextMenuHandler = (event: MouseEvent) => {
            event.preventDefault()
            if (!this.running || !this.app) return
            const rect = this.app.canvas.getBoundingClientRect()
            const x = (event.clientX - rect.left) / rect.width * WORLD_W
            const y = (event.clientY - rect.top) / rect.height * WORLD_H
            this.castPlayerAbility(x, y)
        }
        this.app.canvas.addEventListener('contextmenu', this.contextMenuHandler)
        this.app.canvas.addEventListener('pointerdown', (event) => {
            if (event.button === 0) this.steeringPointerDown = { x: event.clientX, y: event.clientY }
        })
        this.steeringPointerMoveHandler = (event: PointerEvent) => {
            if (!this.running || !this.app || !this.steeringPointerDown || (event.buttons & 1) === 0) return
            if (Math.hypot(event.clientX - this.steeringPointerDown.x, event.clientY - this.steeringPointerDown.y) < 6) return
            const now = performance.now()
            if (now - this.lastSteeringUpdateAt < 90) return
            this.lastSteeringUpdateAt = now
            const rect = this.app.canvas.getBoundingClientRect()
            const x = (event.clientX - rect.left) / rect.width * WORLD_W
            const y = (event.clientY - rect.top) / rect.height * WORLD_H
            this.handleWaterClick(x, y, false)
        }
        this.steeringPointerUpHandler = () => { this.steeringPointerDown = null }
        this.app.canvas.addEventListener('pointermove', this.steeringPointerMoveHandler)
        window.addEventListener('pointerup', this.steeringPointerUpHandler)

        this.world.addChild(this.bg)
        this.world.addChild(this.waveLayer)
        this.world.addChild(this.obstacleLayer)
        this.world.addChild(this.treasureLayer)
        this.world.addChild(this.enemyLayer)
        this.world.addChild(this.playerLayer)
        this.world.addChild(this.effectsLayer)
        this.app.stage.addChild(this.world)

        try {
            const [playerTextures, enemyTextures, islandTextures] = await Promise.all([
                Promise.all(PIRATE_SHIP_SKINS.map(skin => Assets.load<Texture>(skin.sprite))),
                Promise.all([
                    Assets.load<Texture>(RAIDER_SHIP_SPRITE),
                    Assets.load<Texture>(DPS_RAIDER_SPRITE),
                    Assets.load<Texture>(TANK_RAIDER_SPRITE),
                    Assets.load<Texture>(SNIPER_SHIP_SPRITE)
                ]),
                Promise.all(ISLAND_SPRITES.map(path => Assets.load<Texture>(path)))
            ])
            this.playerSkinTextures = new Map(PIRATE_SHIP_SKINS.map((skin, index) => [skin.id, playerTextures[index]!]))
            this.playerShipTexture = this.playerSkinTextures.get('starter') ?? null
            this.raiderShipTexture = enemyTextures[0]!
            this.dpsRaiderTexture = enemyTextures[1]!
            this.tankRaiderTexture = enemyTextures[2]!
            this.sniperShipTexture = enemyTextures[3]!
            this.islandTextures = islandTextures
        } catch (error) {
            console.warn('Pirate sprites failed to load; using procedural artwork.', error)
        }

        this.drawWaterTexture()
        this.spawnAmbientWaves()
        // Islands sit above the clickable water but must not swallow clicks —
        // handleWaterClick reroutes clicks on/behind them to reachable water.
        this.obstacleLayer.eventMode = 'none'
        this.waveLayer.eventMode = 'none'
        this.bg.eventMode = 'static'
        this.bg.cursor = 'crosshair'
        this.bg.on('pointerdown', (e) => {
            if (e.button !== 0) return
            const p = e.getLocalPosition(this.world)
            this.handleWaterClick(p.x, p.y)
        })

        this.player = this.createShipVisual(0xf4d35e, true, 1, undefined, this.stats.skinId)
        this.player.root.position.set(this.playerX, this.playerY)
        this.playerLayer.addChild(this.player.root)
        const healthBarBg = new Graphics()
        healthBarBg.roundRect(-48, -6, 96, 12, 5).fill({ color: 0x020617, alpha: 0.88 }).stroke({ width: 2, color: 0xf8fafc, alpha: 0.85 })
        this.playerHealthBar.addChild(healthBarBg, this.playerHealthBarFill)
        this.playerHealthBar.position.set(this.playerX, this.playerY - 58)
        this.playerHealthBar.alpha = 0
        this.playerLayer.addChild(this.playerHealthBar)
        this.playerLayer.addChild(this.razorOrbit, this.ghostArmada)
        this.updatePlayerHealthBar()

        this.generateIslands()

        this.app.ticker.add(ticker => this.update(ticker.deltaMS))
    }

    resize(clientWidth: number) {
        if (!this.app) return
        const w = Math.max(360, Math.round(clientWidth))
        const h = Math.round(w * WORLD_H / WORLD_W)
        this.app.renderer.resize(w, h)
        this.world.scale.set(w / WORLD_W)
    }

    setPlayerSkin(skinId: string) {
        const texture = this.playerSkinTextures.get(skinId) ?? this.playerShipTexture
        if (texture && this.player?.sprite) {
            this.player.sprite.texture = texture
            this.player.sprite.height = this.player.sprite.width * texture.height / texture.width
        }
        this.stats.skinId = skinId
    }

    start(stats: PirateShipStats, power: number, difficulty: number) {
        this.stats = stats
        this.setPlayerSkin(stats.skinId)
        this.power = power
        this.difficulty = difficulty
        this.playerHp = stats.maxHp
        this.msOutOfCombat = 0
        this.regenTickMs = 0
        this.coins = 0
        this.rawCoins = 0
        this.ammo = stats.ammo
        this.gemAmmo = stats.gemAmmo
        this.ammoStart = stats.ammo
        this.gemAmmoStart = stats.gemAmmo
        this.preferGem = false
        this.cannons = stats.cannons.map(c => ({ ...c, reloadTimer: randRange(0, c.reloadMs * 0.5 * PIRATE_TIMELINE_SCALE) }))
        this.maxCannonRange = this.cannons.reduce((max, c) => Math.max(max, c.range), 220)
        this.elapsedMs = 0
        this.attackTargetId = null
        this.playerPath = []
        this.kills = 0
        this.shotsFired = 0
        this.abilitiesUsed = 0
        this.sunkByType.clear()
        this.playerAbilityCooldownMs = 0
        this.abilityHudTimerMs = 0
        this.callbacks.onAbilityCooldownChange(0, pirateAbility(stats.abilityId).cooldownMs)
        this.combo = 0
        this.maxCombo = 0
        this.lastKillAt = -Infinity
        this.spawnTimerMs = pirateSpawnIntervalMs(0, difficulty)
        this.bossTimerMs = pirateBossFirstSpawnMs(difficulty)
        this.bossCount = 0
        this.treasureTimerMs = randRange(PIRATE_TREASURE_MIN_INTERVAL_MS, PIRATE_TREASURE_MAX_INTERVAL_MS)
        this.powerUpTimerMs = PIRATE_POWER_UP_INTERVAL_MS
        this.healthPackTimerMs = PIRATE_HEALTH_PACK_INTERVAL_MS
        this.seaMineTimerMs = PIRATE_SEA_MINE_INTERVAL_MS
        this.powerUpHudTimerMs = 0
        this.activePowerUps.clear()
        this.powerUpStacks.clear()
        this.shieldHp = 0
        this.blastShotCount = 0
        this.titanShotCount = 0
        this.razorDamageTimerMs = 0
        this.starburstTimerMs = 0
        this.tempestTimerMs = 0
        this.ghostFireTimerMs = 0
        this.syncRoguePowerVisuals()
        this.playerX = WORLD_W / 2
        this.playerY = WORLD_H / 2
        this.playerAngle = 0
        this.clearEntities()
        this.generateIslands()

        this.player.root.alpha = 1
        this.player.root.scale.set(1)
        this.player.hull.rotation = 0
        this.player.body.rotation = 0
        this.player.body.scale.set(1)
        this.player.body.alpha = 1
        this.player.root.position.set(this.playerX, this.playerY)
        gsap.killTweensOf(this.playerHealthBar)
        this.playerHealthBar.alpha = 0
        this.updatePlayerHealthBar()

        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.callbacks.onCoinsChange(this.coins)
        this.callbacks.onAmmoChange(this.ammo, this.gemAmmo)
        this.callbacks.onTimeChange(0, this.runDurationMs)
        this.emitPowerUpState()

        this.paused = false
        this.running = true
        const openingEnemies = pirateInitialEnemyCount(difficulty)
        for (let i = 0; i < openingEnemies; i++) this.spawnEnemy()
        this.spawnPowerUp()
        if (this.app) {
            this.app.ticker.start()
            gsap.globalTimeline.resume()
        }
    }

    /** Toggle whether cannons draw from the gem magazine first. */
    setPreferGemAmmo(prefer: boolean) {
        this.preferGem = prefer
    }

    get isRunning() {
        return this.running
    }

    get isPaused() {
        return this.paused
    }

    /**
     * Freeze the voyage exactly where it stands — used when the player
     * navigates away mid-run instead of abandoning it. Stopping the PIXI
     * ticker halts our own sim loop (spawns, reload timers, movement), and
     * pausing gsap's global timeline freezes every in-flight tween (cannonballs,
     * explosions, idle bobbing) right where it was, so nothing resolves or
     * decays while the tab is elsewhere.
     */
    pause() {
        if (!this.running || this.paused || !this.app) return
        this.paused = true
        this.running = false
        this.app.ticker.stop()
        gsap.globalTimeline.pause()
    }

    /** Unfreeze a previously paused voyage from exactly where it left off. */
    resume() {
        if (!this.paused || !this.app) return
        this.paused = false
        this.running = true
        this.app.ticker.start()
        gsap.globalTimeline.resume()
    }

    /**
     * Re-parent the already-initialized canvas into a new host element. Used
     * when navigating back to a page hosting a paused voyage, so we reattach
     * the live game instead of tearing it down and starting over.
     */
    attach(container: HTMLDivElement) {
        if (!this.app) return
        container.appendChild(this.app.canvas)
        this.resize(container.clientWidth)
        // While paused the ticker is stopped, so resizing alone wouldn't
        // repaint at the new dimensions — force one frame so the frozen scene
        // shows up correctly sized immediately instead of on next resume.
        if (this.paused) this.app.renderer.render(this.app.stage)
    }

    /** End the voyage early by player choice, banking whatever's been earned so far. */
    cancel() {
        if (this.destroyed || (!this.running && !this.paused)) return
        if (this.paused) {
            this.paused = false
            this.app?.ticker.start()
            gsap.globalTimeline.resume()
        }
        this.running = true
        this.endGame(false, 'cancelled')
    }

    destroy() {
        this.destroyed = true
        this.running = false
        this.paused = false
        if (this.app) {
            if (this.contextMenuHandler) this.app.canvas.removeEventListener('contextmenu', this.contextMenuHandler)
            if (this.steeringPointerMoveHandler) this.app.canvas.removeEventListener('pointermove', this.steeringPointerMoveHandler)
            if (this.steeringPointerUpHandler) window.removeEventListener('pointerup', this.steeringPointerUpHandler)
            this.app.destroy(true, { children: true, texture: true })
            this.app = null
        }
        this.contextMenuHandler = null
    }

    // ─── Islands & pathfinding ──────────────────────────────────────────────

    private generateIslands() {
        this.obstacleLayer.removeChildren().forEach(c => c.destroy({ children: true }))
        this.islands = []

        const count = Math.round(randRange(ISLAND_COUNT_MIN, ISLAND_COUNT_MAX))
        let attempts = 0
        while (this.islands.length < count && attempts < 200) {
            attempts++
            const r = randRange(42, 78)
            const x = randRange(r + 90, WORLD_W - r - 90)
            const y = randRange(r + 90, WORLD_H - r - 90)
            // Keep the player spawn and neighbouring islands clear so no ship
            // can start boxed in.
            if (dist(x, y, WORLD_W / 2, WORLD_H / 2) < r + 170) continue
            if (this.islands.some(i => dist(x, y, i.x, i.y) < i.r + r + 150)) continue
            this.islands.push({ x, y, r })
            this.drawIsland(x, y, r)
        }

        this.rebuildGrid()
    }

    private drawIsland(x: number, y: number, r: number) {
        const root = new Container()
        root.position.set(x, y)

        const shallows = new Graphics()
        shallows.circle(0, 0, r + 16).fill({ color: 0x2e7ea8, alpha: 0.5 })
        shallows.circle(0, 0, r + 7).fill({ color: 0x5eb3d6, alpha: 0.35 })
        root.addChild(shallows)

        if (this.islandTextures.length) {
            const texture = this.islandTextures[Math.floor(Math.random() * this.islandTextures.length)]!
            const island = new Sprite(texture)
            island.anchor.set(0.5)
            island.width = r * 2.05
            island.height = r * 2.04
            island.rotation = randRange(-0.3, 0.3)
            root.addChild(island)
            this.obstacleLayer.addChild(root)
            gsap.to(shallows, { alpha: 0.7, duration: randRange(2, 3.2), ease: 'sine.inOut', yoyo: true, repeat: -1 })
            return
        }

        // Irregular sandy blob
        const sand = new Graphics()
        const points: number[] = []
        const segments = 14
        for (let i = 0; i < segments; i++) {
            const ang = (i / segments) * Math.PI * 2
            const rad = r * randRange(0.82, 1)
            points.push(Math.cos(ang) * rad, Math.sin(ang) * rad)
        }
        sand.poly(points).fill({ color: 0xe7cf9a }).stroke({ width: 3, color: 0xc9a86a, alpha: 0.8 })
        root.addChild(sand)

        const grass = new Graphics()
        const gPoints: number[] = []
        for (let i = 0; i < segments; i++) {
            const ang = (i / segments) * Math.PI * 2 + 0.3
            const rad = r * randRange(0.45, 0.62)
            gPoints.push(Math.cos(ang) * rad, Math.sin(ang) * rad)
        }
        grass.poly(gPoints).fill({ color: 0x4d8f4f, alpha: 0.9 })
        root.addChild(grass)

        // A couple of palms or rocks
        const decor = new Graphics()
        const decorCount = Math.round(randRange(1, 3))
        for (let i = 0; i < decorCount; i++) {
            const ang = randRange(0, Math.PI * 2)
            const dx = Math.cos(ang) * r * 0.3
            const dy = Math.sin(ang) * r * 0.3
            if (Math.random() < 0.6) {
                // palm: trunk dot + fronds
                decor.circle(dx, dy, 3).fill({ color: 0x6b4a2b })
                for (let f = 0; f < 5; f++) {
                    const fa = (f / 5) * Math.PI * 2
                    decor.ellipse(dx + Math.cos(fa) * 8, dy + Math.sin(fa) * 8, 7, 3).fill({ color: 0x2f6b31, alpha: 0.95 })
                }
            } else {
                decor.circle(dx, dy, randRange(4, 7)).fill({ color: 0x8a8f98 }).stroke({ width: 1.5, color: 0x5b5f66 })
            }
        }
        root.addChild(decor)

        this.obstacleLayer.addChild(root)

        // Gentle breathing of the shallows ring
        gsap.to(shallows, { alpha: 0.7, duration: randRange(2, 3.2), ease: 'sine.inOut', yoyo: true, repeat: -1 })
    }

    private rebuildGrid() {
        this.blocked.fill(0)
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                const cx = gx * CELL + CELL / 2
                const cy = gy * CELL + CELL / 2
                for (const island of this.islands) {
                    if (dist(cx, cy, island.x, island.y) < island.r + SHIP_RADIUS) {
                        this.blocked[gy * GRID_W + gx] = 1
                        break
                    }
                }
            }
        }
    }

    private isBlockedCell(gx: number, gy: number) {
        if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return true
        return this.blocked[gy * GRID_W + gx] === 1
    }

    private pointInIsland(x: number, y: number, extra = SHIP_RADIUS) {
        return this.islands.some(i => dist(x, y, i.x, i.y) < i.r + extra)
    }

    /** True when a ship-width corridor from a to b avoids every island. */
    private segmentClear(ax: number, ay: number, bx: number, by: number) {
        for (const island of this.islands) {
            if (segPointDist(ax, ay, bx, by, island.x, island.y) < island.r + SHIP_RADIUS) return false
        }
        return true
    }

    /** Snap a (possibly blocked) point to the nearest reachable water cell center. */
    private nearestFreePoint(x: number, y: number): { x: number, y: number } {
        const gx = Math.floor(x / CELL)
        const gy = Math.floor(y / CELL)
        if (!this.isBlockedCell(gx, gy) && !this.pointInIsland(x, y)) return { x, y }
        for (let radius = 1; radius < Math.max(GRID_W, GRID_H); radius++) {
            let best: { x: number, y: number } | null = null
            let bestD = Infinity
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
                    if (this.isBlockedCell(gx + dx, gy + dy)) continue
                    const px = (gx + dx) * CELL + CELL / 2
                    const py = (gy + dy) * CELL + CELL / 2
                    const d = dist(px, py, x, y)
                    if (d < bestD) { best = { x: px, y: py }; bestD = d }
                }
            }
            if (best) return best
        }
        return { x, y }
    }

    /**
     * A* over the coarse grid with string-pulling smoothing. Returns waypoints
     * (excluding the start) or a straight line when nothing is in the way.
     */
    private computePath(fromX: number, fromY: number, toX: number, toY: number): { x: number, y: number }[] {
        const goal = this.nearestFreePoint(toX, toY)
        if (this.segmentClear(fromX, fromY, goal.x, goal.y)) return [goal]

        const startGx = Math.floor(fromX / CELL)
        const startGy = Math.floor(fromY / CELL)
        const goalGx = Math.floor(goal.x / CELL)
        const goalGy = Math.floor(goal.y / CELL)
        const startIdx = startGy * GRID_W + startGx
        const goalIdx = goalGy * GRID_W + goalGx

        const gScore = new Float32Array(GRID_W * GRID_H).fill(Infinity)
        const cameFrom = new Int32Array(GRID_W * GRID_H).fill(-1)
        const closed = new Uint8Array(GRID_W * GRID_H)
        gScore[startIdx] = 0
        // Small open list — the grid is under a thousand cells, a linear-scan
        // priority queue is plenty.
        const open: number[] = [startIdx]
        const h = (idx: number) => {
            const gx = idx % GRID_W
            const gy = Math.floor(idx / GRID_W)
            return Math.hypot(gx - goalGx, gy - goalGy)
        }

        let found = false
        while (open.length) {
            let bestI = 0
            let bestF = Infinity
            for (let i = 0; i < open.length; i++) {
                const f = gScore[open[i]!]! + h(open[i]!)
                if (f < bestF) { bestF = f; bestI = i }
            }
            const current = open.splice(bestI, 1)[0]!
            if (current === goalIdx) { found = true; break }
            if (closed[current]) continue
            closed[current] = 1

            const cgx = current % GRID_W
            const cgy = Math.floor(current / GRID_W)
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue
                    const ngx = cgx + dx
                    const ngy = cgy + dy
                    if (this.isBlockedCell(ngx, ngy)) continue
                    // No diagonal corner cutting between two blocked cells
                    if (dx !== 0 && dy !== 0 && (this.isBlockedCell(cgx + dx, cgy) || this.isBlockedCell(cgx, cgy + dy))) continue
                    const nIdx = ngy * GRID_W + ngx
                    if (closed[nIdx]) continue
                    const tentative = gScore[current]! + Math.hypot(dx, dy)
                    if (tentative < gScore[nIdx]!) {
                        gScore[nIdx] = tentative
                        cameFrom[nIdx] = current
                        open.push(nIdx)
                    }
                }
            }
        }

        if (!found) return []

        const cells: { x: number, y: number }[] = []
        let cur = goalIdx
        while (cur !== -1 && cur !== startIdx) {
            cells.push({ x: (cur % GRID_W) * CELL + CELL / 2, y: Math.floor(cur / GRID_W) * CELL + CELL / 2 })
            cur = cameFrom[cur]!
        }
        cells.reverse()
        cells.push(goal)

        // String-pulling: drop intermediate waypoints whenever the direct hop
        // to a later one already clears every island.
        const smoothed: { x: number, y: number }[] = []
        let anchor = { x: fromX, y: fromY }
        let i = 0
        while (i < cells.length) {
            let furthest = i
            for (let j = cells.length - 1; j > i; j--) {
                if (this.segmentClear(anchor.x, anchor.y, cells[j]!.x, cells[j]!.y)) { furthest = j; break }
            }
            smoothed.push(cells[furthest]!)
            anchor = cells[furthest]!
            i = furthest + 1
        }
        return smoothed
    }

    // ─── Input ──────────────────────────────────────────────────────────────

    private handleWaterClick(x: number, y: number, showMarker = true) {
        if (!this.running) return
        this.attackTargetId = null
        this.playerPath = this.computePath(this.playerX, this.playerY, x, y)
        const dest = this.playerPath[this.playerPath.length - 1]
        if (dest && showMarker) this.spawnMoveMarker(dest.x, dest.y)
    }

    // ─── Main loop ──────────────────────────────────────────────────────────

    private update(deltaMS: number) {
        if (!this.running) return
        const dt = deltaMS / 1000
        this.elapsedMs += deltaMS
        this.timeSec += dt
        this.syncBankableCoins()
        if (this.playerAbilityCooldownMs > 0) {
            this.playerAbilityCooldownMs = Math.max(0, this.playerAbilityCooldownMs - deltaMS)
            this.abilityHudTimerMs -= deltaMS
            if (this.abilityHudTimerMs <= 0 || this.playerAbilityCooldownMs === 0) {
                this.callbacks.onAbilityCooldownChange(this.playerAbilityCooldownMs, pirateAbility(this.stats.abilityId).cooldownMs)
                this.abilityHudTimerMs = 100
            }
        }
        this.callbacks.onTimeChange(this.elapsedMs, Math.max(0, this.runDurationMs - this.elapsedMs))

        this.updateRegen(deltaMS)
        this.updatePlayer(dt, deltaMS)
        this.updateCannons(deltaMS)
        this.updateEnemies(dt, deltaMS)
        this.updateTreasure(dt, deltaMS)
        this.updatePowerUps(dt, deltaMS)
        this.updateSeaMines(deltaMS)
        this.updateSpawning(deltaMS)
        this.updateIdleMotion()

        if (this.elapsedMs >= this.runDurationMs) this.endGame(true, 'timeout')
    }

    /**
     * Keep the visible and reported loot aligned with the server's payout
     * ceiling. Raw drops remain accumulated behind the scenes, allowing more
     * of an already-earned haul to become bankable as playtime advances.
     */
    private syncBankableCoins() {
        const gemAmmoUsed = this.gemAmmoStart - this.gemAmmo
        const bankableCoins = Math.min(
            this.rawCoins,
            pirateMaxPayoutForRun(this.elapsedMs, this.difficulty, gemAmmoUsed)
        )
        if (bankableCoins === this.coins) return
        this.coins = bankableCoins
        this.callbacks.onCoinsChange(this.coins)
    }

    private addRawCoins(amount: number) {
        const previouslyBanked = this.coins
        this.rawCoins += amount
        this.syncBankableCoins()
        return this.coins - previouslyBanked
    }

    /** Reset the out-of-combat timer — call on any combat action (taking a hit or firing a shot). */
    private enterCombat() {
        this.msOutOfCombat = 0
        this.regenTickMs = 0
    }

    /**
     * Passive hull regen. Once the ship has been out of combat (no hit taken
     * and no shot fired) for PIRATE_REGEN_DELAY_MS, it heals regenRate HP once
     * per second, spawning a floating heal popup on each tick.
     */
    private updateRegen(deltaMS: number) {
        this.msOutOfCombat += deltaMS
        const rate = this.stats.regenRate
        if (rate <= 0 || this.playerHp <= 0 || this.playerHp >= this.stats.maxHp) {
            this.regenTickMs = 0
            return
        }
        if (this.msOutOfCombat < PIRATE_REGEN_DELAY_MS) return

        this.regenTickMs += deltaMS
        if (this.regenTickMs < 1000) return
        this.regenTickMs -= 1000

        const healed = Math.min(rate, this.stats.maxHp - this.playerHp)
        if (healed <= 0) return
        this.playerHp += healed
        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.updatePlayerHealthBar()
        this.showPlayerHealthBar()
        this.spawnDamagePopup('regen', this.playerX, this.playerY - 46, `+${healed}`, 0xfb7185, false)
    }

    /** Gentle bobbing/sail-billow for every ship, driven off the clock so it never fights gsap. */
    private updateIdleMotion() {
        const animate = (v: ShipVisual) => {
            v.body.position.y = Math.sin(this.timeSec * 2 + v.phase) * 1.6
            v.body.rotation = Math.sin(this.timeSec * 1.3 + v.phase) * 0.025
            for (let i = 0; i < v.sails.length; i++) {
                v.sails[i]!.scale.x = 1 + Math.sin(this.timeSec * 2.6 + v.phase + i) * 0.08
            }
        }
        animate(this.player)
        for (const e of this.enemies.values()) {
            if (!e.dead) animate(e.visual)
        }
    }

    private updatePlayer(dt: number, deltaMS: number) {
        const target = this.attackTargetId !== null ? this.enemies.get(this.attackTargetId) : null
        let moving = false

        if (target) {
            const d = dist(this.playerX, this.playerY, target.x, target.y)
            const clearShot = this.segmentClear(this.playerX, this.playerY, target.x, target.y)

            const ammoRangeMult = this.peekShotKind() === 'standard' ? PIRATE_AMMO_RANGE_MULT : 1
            const rangeMult = 1 + this.powerUpStack('eagle-eye') * 0.25 + this.powerUpStack('keen-sights') * 0.1
            const effectiveMaxRange = this.maxCannonRange * ammoRangeMult * rangeMult
            if (clearShot && d <= effectiveMaxRange * HOLD_RANGE_FRACTION) {
                // In position — face the target and hold.
                const desiredAngle = Math.atan2(target.y - this.playerY, target.x - this.playerX)
                this.playerAngle = lerpAngle(this.playerAngle, desiredAngle, ROTATE_LERP)
                this.playerPath = []
            } else {
                // Chase: re-path on a timer (or when we run out of waypoints)
                // so we track a moving target without an A* every frame.
                this.chasePathTimer -= deltaMS
                if (this.chasePathTimer <= 0 || this.playerPath.length === 0) {
                    this.playerPath = this.computePath(this.playerX, this.playerY, target.x, target.y)
                    this.chasePathTimer = 400
                }
                moving = this.followPath(dt)
            }
        } else if (this.playerPath.length) {
            moving = this.followPath(dt)
        }

        if (moving) {
            this.wakeTimer -= deltaMS
            if (this.wakeTimer <= 0) {
                this.wakeTimer = 90
                this.spawnWake(this.playerX, this.playerY, this.playerAngle)
            }
        }

        const margin = 40
        this.playerX = Math.min(WORLD_W - margin, Math.max(margin, this.playerX))
        this.playerY = Math.min(WORLD_H - margin, Math.max(margin, this.playerY))
        this.player.root.position.set(this.playerX, this.playerY)
        this.playerHealthBar.position.set(this.playerX, this.playerY - 58)
        this.razorOrbit.position.set(this.playerX, this.playerY)
        this.ghostArmada.position.set(this.playerX, this.playerY)
        this.player.hull.rotation = this.playerAngle
    }

    private updatePlayerHealthBar() {
        const fraction = Math.max(0, Math.min(1, this.playerHp / Math.max(1, this.stats.maxHp)))
        const color = fraction > 0.5 ? 0x22c55e : fraction > 0.25 ? 0xf59e0b : 0xef4444
        this.playerHealthBarFill.clear()
        this.playerHealthBarFill.roundRect(-44, -3, 88 * fraction, 6, 3).fill({ color })
    }

    private showPlayerHealthBar() {
        this.updatePlayerHealthBar()
        gsap.killTweensOf(this.playerHealthBar)
        this.playerHealthBar.alpha = 1
        gsap.to(this.playerHealthBar, { alpha: 0, duration: 0.45, delay: 4, ease: 'power2.out' })
    }

    /** Advance the player along the current waypoint list. Returns true when it moved. */
    private followPath(dt: number) {
        const wp = this.playerPath[0]
        if (!wp) return false
        const d = dist(this.playerX, this.playerY, wp.x, wp.y)
        if (d <= WAYPOINT_REACH_DIST) {
            this.playerPath.shift()
            return this.playerPath.length > 0
        }
        const ang = Math.atan2(wp.y - this.playerY, wp.x - this.playerX)
        this.playerAngle = lerpAngle(this.playerAngle, ang, ROTATE_LERP)
        const speedMult = 1 + this.powerUpStack('reinforced-keel') * 0.1
        const step = Math.min(this.stats.speed * speedMult * dt, d)
        const nx = this.playerX + Math.cos(ang) * step
        const ny = this.playerY + Math.sin(ang) * step
        // Belt-and-braces: never step inside an island even if the path is stale.
        if (!this.pointInIsland(nx, ny, SHIP_RADIUS - 6)) {
            this.playerX = nx
            this.playerY = ny
        } else {
            this.playerPath = []
            return false
        }
        return true
    }

    /**
     * Each gun port reloads and fires on its own clock. A cannon prefers the
     * player's explicit attack target if within ITS range, otherwise engages
     * whichever enemy is nearest and in range. Shots arc over islands
     * (mortar-style), so range is all that matters here.
     */
    private updateCannons(deltaMS: number) {
        if (this.enemies.size === 0) return
        for (const cannon of this.cannons) {
            cannon.reloadTimer -= deltaMS
            if (cannon.reloadTimer > 0) continue
            const target = this.pickCannonTarget(cannon)
            if (!target) continue
            const reloadMult = Math.max(0.35, 1 - this.powerUpStack('quick-fuse') * 0.2 - this.powerUpStack('rapid-loader') * 0.1)
            cannon.reloadTimer = cannon.reloadMs * reloadMult * PIRATE_TIMELINE_SCALE
            this.enterCombat()
            this.fireCannonAtEnemy(cannon, target)
        }
    }

    private pickCannonTarget(cannon: Cannon): Enemy | null {
        const ammoRangeMult = this.peekShotKind() === 'standard' ? PIRATE_AMMO_RANGE_MULT : 1
        const rangeMult = 1 + this.powerUpStack('eagle-eye') * 0.25 + this.powerUpStack('keen-sights') * 0.1
        const effectiveRange = cannon.range * ammoRangeMult * rangeMult
        const priority = this.attackTargetId !== null ? this.enemies.get(this.attackTargetId) : null
        if (priority && !priority.dead && dist(this.playerX, this.playerY, priority.x, priority.y) <= effectiveRange) {
            return priority
        }

        let best: Enemy | null = null
        let bestDist = Infinity
        for (const enemy of this.enemies.values()) {
            if (enemy.dead) continue
            const d = dist(this.playerX, this.playerY, enemy.x, enemy.y)
            if (d <= effectiveRange && d < bestDist) {
                best = enemy
                bestDist = d
            }
        }
        return best
    }

    private updateEnemies(dt: number, deltaMS: number) {
        for (const enemy of this.enemies.values()) {
            if (enemy.dead) continue
            enemy.abilityTimer -= deltaMS
            if (enemy.abilityTimer <= 0) {
                this.useEnemyAbility(enemy)
                enemy.abilityTimer = enemy.tier.boss
                    ? randRange(PIRATE_BOSS_ABILITY_COOLDOWN_MIN_MS, PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS)
                    : randRange(7600 * PIRATE_TIMELINE_SCALE, 11_500 * PIRATE_TIMELINE_SCALE)
            }
            const d = dist(enemy.x, enemy.y, this.playerX, this.playerY)
            const desiredAngle = Math.atan2(this.playerY - enemy.y, this.playerX - enemy.x)

            if (d > enemy.tier.range) {
                // Steering with island repulsion — cheap, and with sparse round
                // islands it reads as ships tacking around them.
                let dirX = Math.cos(desiredAngle)
                let dirY = Math.sin(desiredAngle)
                for (const island of this.islands) {
                    const iDist = dist(enemy.x, enemy.y, island.x, island.y)
                    const influence = island.r + 70
                    if (iDist < influence) {
                        const push = (influence - iDist) / influence * 2.2
                        dirX += (enemy.x - island.x) / iDist * push
                        dirY += (enemy.y - island.y) / iDist * push
                    }
                }
                const len = Math.hypot(dirX, dirY) || 1
                dirX /= len
                dirY /= len
                enemy.angle = lerpAngle(enemy.angle, Math.atan2(dirY, dirX), ROTATE_LERP)
                const nx = enemy.x + dirX * enemy.speed * dt
                const ny = enemy.y + dirY * enemy.speed * dt
                if (!this.pointInIsland(nx, ny, SHIP_RADIUS - 8)) {
                    enemy.x = nx
                    enemy.y = ny
                }
                const margin = 30
                enemy.x = Math.min(WORLD_W - margin, Math.max(margin, enemy.x))
                enemy.y = Math.min(WORLD_H - margin, Math.max(margin, enemy.y))
            } else {
                enemy.angle = lerpAngle(enemy.angle, desiredAngle, ROTATE_LERP)
                enemy.reloadTimer -= deltaMS
                if (enemy.reloadTimer <= 0) {
                    enemy.reloadTimer = enemy.tier.reloadMs * pirateEnemyReloadMultiplier(this.elapsedMs, this.difficulty) * PIRATE_TIMELINE_SCALE
                    this.enemyFire(enemy)
                }
            }

            enemy.root.position.set(enemy.x, enemy.y)
            enemy.visual.hull.rotation = enemy.angle
            enemy.targetRing.visible = this.attackTargetId === enemy.id
            if (enemy.targetRing.visible) {
                enemy.targetRing.rotation += dt * 1.6
            }
        }
    }

    private updateTreasure(dt: number, deltaMS: number) {
        if (this.treasure) {
            const tr = this.treasure
            tr.age += deltaMS
            tr.x += tr.vx * dt
            tr.y += tr.vy * dt
            const margin = 60
            if (tr.x < margin || tr.x > WORLD_W - margin) tr.vx *= -1
            if (tr.y < margin || tr.y > WORLD_H - margin) tr.vy *= -1
            if (this.pointInIsland(tr.x + tr.vx * dt * 8, tr.y + tr.vy * dt * 8, 20)) {
                tr.vx *= -1
                tr.vy *= -1
            }
            tr.root.position.set(tr.x, tr.y)

            if (dist(tr.x, tr.y, this.playerX, this.playerY) < PICKUP_RADIUS) {
                this.collectTreasure(tr)
            } else if (tr.age > PIRATE_TREASURE_LIFESPAN_MS) {
                this.expireTreasure(tr)
            }
        } else {
            this.treasureTimerMs -= deltaMS
            if (this.treasureTimerMs <= 0) {
                this.spawnTreasure()
                this.treasureTimerMs = randRange(PIRATE_TREASURE_MIN_INTERVAL_MS, PIRATE_TREASURE_MAX_INTERVAL_MS)
            }
        }
    }

    private updateSpawning(deltaMS: number) {
        this.spawnTimerMs -= deltaMS
        if (this.spawnTimerMs <= 0) {
            const max = pirateMaxConcurrentEnemies(this.elapsedMs, this.difficulty)
            let regular = 0
            for (const e of this.enemies.values()) {
                if (!e.tier.boss) regular++
            }
            const availableSlots = Math.max(0, max - regular)
            const batchSize = Math.min(availableSlots, pirateSpawnBatchSize(this.elapsedMs, this.difficulty))
            for (let i = 0; i < batchSize; i++) this.spawnEnemy()
            this.spawnTimerMs = pirateSpawnIntervalMs(this.elapsedMs, this.difficulty) * randRange(0.85, 1.2)
        }

        // Dreadnoughts run on their own clock, outside the concurrency cap.
        // Only higher difficulty tiers add a second simultaneous boss in the
        // final minute; low tiers remain completable with a strong ship.
        const lateBossPhase = this.elapsedMs >= PIRATE_LATE_BOSS_PHASE_MS
        const bossCap = lateBossPhase && this.difficulty >= PIRATE_DOUBLE_BOSS_DIFFICULTY ? 2 : 1
        if (lateBossPhase && this.bossCount < bossCap) this.bossTimerMs = Math.min(this.bossTimerMs, 12_000 * PIRATE_TIMELINE_SCALE)
        if (this.bossCount < bossCap) {
            this.bossTimerMs -= deltaMS
            if (this.bossTimerMs <= 0) {
                const bossTier = PIRATE_ENEMY_TIERS.find(t => t.boss)
                if (bossTier) {
                    this.bossCount += 1
                    this.spawnEnemy(bossTier)
                    this.callbacks.onBossSpawn?.(bossTier.name)
                    this.shake(7)
                }
                this.bossTimerMs = lateBossPhase ? 28_000 * PIRATE_TIMELINE_SCALE : PIRATE_BOSS_RESPAWN_MS
            }
        }
    }

    // ─── Combat ─────────────────────────────────────────────────────────────

    /** Select the next ammunition without consuming it, so targeting uses the same range profile. */
    private peekShotKind(): AmmoKind {
        if (this.preferGem && this.gemAmmo > 0) return 'gem'
        if (this.ammo > 0) return 'standard'
        if (this.gemAmmo > 0) return 'gem'
        return 'free'
    }

    /** Draw a premium shot when available, otherwise fall back to unlimited free ammunition. */
    private consumeShot(): AmmoKind {
        const kind = this.peekShotKind()
        const takeGem = () => {
            this.gemAmmo -= 1
            this.callbacks.onAmmoChange(this.ammo, this.gemAmmo)
            return 'gem' as const
        }
        const takeStandard = () => {
            this.ammo -= 1
            this.callbacks.onAmmoChange(this.ammo, this.gemAmmo)
            return 'standard' as const
        }
        if (kind === 'gem') return takeGem()
        if (kind === 'standard') return takeStandard()
        return 'free'
    }

    private fireCannonAtEnemy(cannon: Cannon, target: Enemy) {
        const kind = this.consumeShot()
        this.shotsFired += 1

        if (this.hasPowerUp('blast-powder')) this.blastShotCount += 1
        if (this.hasPowerUp('titan-shot')) this.titanShotCount += 1
        const blastEvery = Math.max(2, 5 - this.powerUpStack('blast-powder'))
        const titanEvery = Math.max(4, 12 - this.powerUpStack('titan-shot') * 2)
        const profile: PlayerShotProfile = {
            explosive: this.hasPowerUp('blast-powder') && this.blastShotCount % blastEvery === 0,
            massive: this.hasPowerUp('titan-shot') && this.titanShotCount % titanEvery === 0,
            cannonColor: cannon.shotColor,
            tierTrail: cannon.shotTrail
        }
        if (profile.explosive || profile.massive) this.emitPowerUpState()

        const id = target.id
        const fireAngle = Math.atan2(target.y - this.playerY, target.x - this.playerX)
        const fromX = this.playerX + Math.cos(fireAngle) * 34
        const fromY = this.playerY + Math.sin(fireAngle) * 34
        this.spawnMuzzleFlash(fromX, fromY, fireAngle, kind, cannon.shotColor)

        const ammoAttackRating = kind === 'gem' ? cannon.attackRating * PIRATE_GEM_AMMO_ATTACK_MULT : cannon.attackRating
        const attackRating = Math.round(ammoAttackRating * (1 + this.powerUpStack('deadeye') * 0.22))
        const ammoMaxDamage = kind === 'gem'
            ? cannon.maxDamage * PIRATE_GEM_AMMO_DAMAGE_MULT
            : kind === 'standard' ? cannon.maxDamage * PIRATE_AMMO_DAMAGE_MULT : cannon.maxDamage
        const damageMult = 1 + this.powerUpStack('broadside-fury') * 0.2 + this.powerUpStack('lucky-shot') * 0.08
        const maxDamage = Math.round(ammoMaxDamage * damageMult)

        this.spawnCannonball(fromX, fromY, target.x, target.y, kind, (hitX, hitY) => {
            const e = this.enemies.get(id)
            if (!e || e.dead) {
                this.spawnSplash(hitX, hitY)
                return
            }
            const roll = pirateRollAttack(attackRating, e.defense, maxDamage)
            this.hitEnemy(e, roll, hitX, hitY, kind, profile)
        }, profile)
    }

    private castPlayerAbility(targetX: number, targetY: number) {
        if (this.playerAbilityCooldownMs > 0) {
            this.spawnDamagePopup('player-ability-cooldown', targetX, targetY - 20, `${Math.ceil(this.playerAbilityCooldownMs / 1000)}s`, 0xfde68a, false)
            return
        }
        const ability = pirateAbility(this.stats.abilityId)
        this.playerAbilityCooldownMs = ability.cooldownMs
        this.abilityHudTimerMs = 100
        this.abilitiesUsed += 1
        this.callbacks.onAbilityCooldownChange(this.playerAbilityCooldownMs, ability.cooldownMs)

        if (ability.id === 'seekers') this.castSeekerSalvo(targetX, targetY)
        else if (ability.id === 'stormchain') this.castStormchain(targetX, targetY)
        else if (ability.id === 'maelstrom') this.castMaelstrom(targetX, targetY)
        else if (ability.id === 'firestorm') this.castHellfireBarrage(targetX, targetY)
        else this.castPlayerBomb(targetX, targetY)
    }

    private castPlayerBomb(targetX: number, targetY: number) {
        const marker = new Graphics()
        marker.circle(0, 0, PLAYER_BOMB_RADIUS).fill({ color: 0xfacc15, alpha: 0.07 })
        marker.circle(0, 0, PLAYER_BOMB_RADIUS).stroke({ width: 3, color: 0xfde047, alpha: 0.85 })
        marker.circle(0, 0, 24).stroke({ width: 2, color: 0xfef9c3, alpha: 0.9 })
        marker.position.set(targetX, targetY)
        this.effectsLayer.addChild(marker)
        gsap.fromTo(marker.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.28, ease: 'back.out(2)' })
        gsap.to(marker, { alpha: 0.28, duration: 0.18, yoyo: true, repeat: 5 })

        const root = new Container()
        root.position.set(this.playerX, this.playerY)
        const bomb = new Graphics()
        bomb.circle(0, 0, 16).fill({ color: 0x713f12 }).stroke({ width: 4, color: 0xfde047 })
        bomb.star(-4, -4, 5, 6, 2).fill({ color: 0xfef9c3 })
        root.addChild(bomb)
        this.effectsLayer.addChild(root)
        this.spawnMuzzleFlash(this.playerX, this.playerY, Math.atan2(targetY - this.playerY, targetX - this.playerX), 'standard', 0xfacc15)
        let lastTrail = 0
        gsap.to(bomb.position, { y: -115, duration: 0.42, ease: 'sine.out', yoyo: true, repeat: 1 })
        gsap.to(root.position, {
            x: targetX,
            y: targetY,
            duration: 0.84,
            ease: 'none',
            onUpdate: () => {
                const now = performance.now()
                if (now - lastTrail < 26) return
                lastTrail = now
                this.spawnTrailParticle(root.x, root.y + bomb.y, 0xfacc15, 1.45)
            },
            onComplete: () => {
                if (!root.destroyed) root.destroy({ children: true })
                if (!marker.destroyed) marker.destroy()
                if (!this.running || this.destroyed) return
                this.detonatePlayerBomb(targetX, targetY)
            }
        })
    }

    private detonatePlayerBomb(x: number, y: number) {
        const damage = Math.max(25, Math.round(20 + this.power * 0.75))
        const ring = new Graphics()
        ring.circle(0, 0, 18).fill({ color: 0xfef3c7, alpha: 0.65 }).stroke({ width: 6, color: 0xfacc15, alpha: 0.95 })
        ring.position.set(x, y)
        this.effectsLayer.addChild(ring)
        gsap.to(ring.scale, { x: PLAYER_BOMB_RADIUS / 18, y: PLAYER_BOMB_RADIUS / 18, duration: 0.38, ease: 'power3.out' })
        gsap.to(ring, { alpha: 0, duration: 0.48, ease: 'power2.out', onComplete: () => ring.destroy() })
        this.spawnExplosion(x, y, 0xfacc15, true)
        this.spawnExplosion(x + randRange(-28, 28), y + randRange(-28, 28), 0xf97316, true)
        for (let i = 0; i < 22; i++) {
            const angle = i / 22 * Math.PI * 2 + randRange(-0.12, 0.12)
            const distance = randRange(65, PLAYER_BOMB_RADIUS + 45)
            const spark = new Graphics()
            spark.star(0, 0, 4, randRange(3, 7), 1.5).fill({ color: i % 2 ? 0xfde047 : 0xfb923c, alpha: 0.95 })
            spark.position.set(x, y)
            this.effectsLayer.addChild(spark)
            gsap.to(spark.position, { x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance, duration: 0.55, ease: 'power3.out' })
            gsap.to(spark, { alpha: 0, rotation: Math.PI, duration: 0.6, ease: 'power2.in', onComplete: () => spark.destroy() })
        }
        this.shake(12)
        this.destroySeaMinesInRadius(x, y, PLAYER_BOMB_RADIUS)
        let hits = 0
        for (const enemy of [...this.enemies.values()]) {
            if (enemy.dead || dist(x, y, enemy.x, enemy.y) > PLAYER_BOMB_RADIUS) continue
            hits += 1
            this.applyLifesteal(Math.min(damage, enemy.hp))
            enemy.hp -= damage
            this.flashShip(enemy.visual)
            this.spawnDamagePopup(`player-bomb-${enemy.id}`, enemy.x, enemy.y - 42, `${damage} BOMB`, 0xfde047, true)
            if (enemy.hp <= 0) this.killEnemy(enemy)
            else this.updateEnemyHpBar(enemy)
        }
        this.spawnDamagePopup('player-bomb-result', x, y - 72, hits ? `${hits} HIT${hits === 1 ? '' : 'S'}` : 'NO TARGETS', hits ? 0xfef08a : 0x9ca3af, true)
    }

    private damageEnemyWithAbility(enemy: Enemy, damage: number, label: string, color: number, big = false) {
        if (enemy.dead) return
        this.applyLifesteal(Math.min(damage, enemy.hp))
        enemy.hp -= damage
        this.flashShip(enemy.visual)
        this.spawnExplosion(enemy.x, enemy.y, color, big)
        this.spawnDamagePopup(`ability-${enemy.id}`, enemy.x, enemy.y - 42, `${damage} ${label}`, color, big)
        if (enemy.hp <= 0) this.killEnemy(enemy)
        else this.updateEnemyHpBar(enemy)
    }

    private applyLifesteal(damageDealt: number) {
        if (!this.hasPowerUp('blood-tide') || damageDealt <= 0 || this.playerHp >= this.stats.maxHp) return
        const healed = Math.min(1, this.stats.maxHp - this.playerHp)
        if (healed <= 0) return
        this.playerHp += healed
        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.updatePlayerHealthBar()
        this.showPlayerHealthBar()
    }

    private closestEnemy(x: number, y: number, excluded = new Set<number>()) {
        return [...this.enemies.values()]
            .filter(enemy => !enemy.dead && !excluded.has(enemy.id))
            .sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y))[0]
    }

    private castSeekerSalvo(targetX: number, targetY: number) {
        const picked = [...this.enemies.values()]
            .filter(enemy => !enemy.dead)
            .sort((a, b) => dist(targetX, targetY, a.x, a.y) - dist(targetX, targetY, b.x, b.y))
            .slice(0, 3)
        const damage = Math.max(18, Math.round(12 + this.power * 0.24))
        this.spawnDamagePopup('seeker-cast', this.playerX, this.playerY - 55, "HUNTER'S SALVO", 0xfca5a5, true)

        for (let i = 0; i < 3; i++) {
            const initialTarget = picked[i] ?? picked[i % Math.max(1, picked.length)]
            const root = new Container()
            root.position.set(this.playerX, this.playerY)
            const missile = new Graphics()
            missile.moveTo(15, 0).lineTo(-9, -7).lineTo(-5, 0).lineTo(-9, 7).closePath()
                .fill({ color: 0xf8fafc }).stroke({ width: 2, color: 0xef4444 })
            const glow = new Graphics()
            glow.circle(-10, 0, 6).fill({ color: 0xfb7185, alpha: 0.5 })
            root.addChild(glow, missile)
            this.effectsLayer.addChild(root)
            const flight = { progress: 0 }
            let lastTrail = 0
            gsap.delayedCall(i * 0.13, () => {
                if (!this.running || root.destroyed) return
                gsap.to(flight, {
                    progress: 1,
                    duration: 1.15,
                    ease: 'power1.in',
                    onUpdate: () => {
                        const target = (initialTarget && this.enemies.get(initialTarget.id)) || this.closestEnemy(root.x, root.y)
                        const aimX = target?.x ?? targetX
                        const aimY = target?.y ?? targetY
                        const angle = Math.atan2(aimY - root.y, aimX - root.x)
                        const step = Math.min(28, dist(root.x, root.y, aimX, aimY) * 0.16 + 3)
                        root.x += Math.cos(angle) * step
                        root.y += Math.sin(angle) * step
                        root.rotation = angle
                        const now = performance.now()
                        if (now - lastTrail > 28) {
                            lastTrail = now
                            this.spawnTrailParticle(root.x, root.y, i % 2 ? 0xf97316 : 0xef4444, 1.2)
                        }
                    },
                    onComplete: () => {
                        const target = (initialTarget && this.enemies.get(initialTarget.id)) || this.closestEnemy(root.x, root.y)
                        const hitX = target?.x ?? root.x
                        const hitY = target?.y ?? root.y
                        if (!root.destroyed) root.destroy({ children: true })
                        if (!this.running) return
                        this.spawnExplosion(hitX, hitY, 0xef4444, true)
                        if (target && dist(hitX, hitY, target.x, target.y) < 65) this.damageEnemyWithAbility(target, damage, 'SEEKER', 0xfca5a5, true)
                    }
                })
            })
        }
    }

    private drawLightningArc(fromX: number, fromY: number, toX: number, toY: number) {
        const bolt = new Graphics()
        bolt.moveTo(fromX, fromY)
        const segments = 7
        for (let i = 1; i < segments; i++) {
            const t = i / segments
            const x = fromX + (toX - fromX) * t + randRange(-12, 12)
            const y = fromY + (toY - fromY) * t + randRange(-12, 12)
            bolt.lineTo(x, y)
        }
        bolt.lineTo(toX, toY).stroke({ width: 7, color: 0x38bdf8, alpha: 0.25 })
        bolt.moveTo(fromX, fromY)
        for (let i = 1; i < segments; i++) {
            const t = i / segments
            bolt.lineTo(fromX + (toX - fromX) * t + randRange(-7, 7), fromY + (toY - fromY) * t + randRange(-7, 7))
        }
        bolt.lineTo(toX, toY).stroke({ width: 2.5, color: 0xe0f2fe, alpha: 1 })
        this.effectsLayer.addChild(bolt)
        gsap.to(bolt, { alpha: 0, duration: 0.32, ease: 'power2.in', onComplete: () => bolt.destroy() })
    }

    private castStormchain(targetX: number, targetY: number) {
        const first = this.closestEnemy(targetX, targetY)
        if (!first || dist(targetX, targetY, first.x, first.y) > 280) {
            this.spawnDamagePopup('stormchain-empty', targetX, targetY - 20, 'NO CONDUCTOR', 0x7dd3fc, false)
            return
        }
        const chain: Enemy[] = [first]
        const used = new Set([first.id])
        while (chain.length < 6) {
            const previous = chain[chain.length - 1]!
            const next = this.closestEnemy(previous.x, previous.y, used)
            if (!next || dist(previous.x, previous.y, next.x, next.y) > 285) break
            chain.push(next)
            used.add(next.id)
        }
        this.spawnDamagePopup('stormchain-cast', targetX, targetY - 70, 'STORMCHAIN', 0x7dd3fc, true)
        chain.forEach((enemy, index) => {
            gsap.delayedCall(index * 0.11, () => {
                if (!this.running || enemy.dead) return
                const previous = index === 0 ? { x: targetX, y: targetY - 170 } : chain[index - 1]!
                this.drawLightningArc(previous.x, previous.y, enemy.x, enemy.y)
                const damage = Math.max(12, Math.round((18 + this.power * 0.32) * Math.pow(0.84, index)))
                this.damageEnemyWithAbility(enemy, damage, 'SHOCK', 0x7dd3fc, index === 0)
                for (let spark = 0; spark < 5; spark++) this.spawnTrailParticle(enemy.x + randRange(-22, 22), enemy.y + randRange(-22, 22), 0x38bdf8, 1.2)
                if (index === 0) this.shake(6)
            })
        })
    }

    private castMaelstrom(targetX: number, targetY: number) {
        const root = new Container()
        root.position.set(targetX, targetY)
        const outer = new Graphics()
        outer.circle(0, 0, 175).fill({ color: 0x0ea5e9, alpha: 0.09 }).stroke({ width: 4, color: 0x67e8f9, alpha: 0.7 })
        const inner = new Graphics()
        for (let radius = 35; radius <= 140; radius += 35) inner.arc(0, 0, radius, 0.25, Math.PI * 1.72).stroke({ width: 6, color: 0x38bdf8, alpha: 0.42 })
        const eye = new Graphics()
        eye.circle(0, 0, 24).fill({ color: 0x082f49, alpha: 0.85 }).stroke({ width: 3, color: 0xa5f3fc })
        root.addChild(outer, inner, eye)
        this.effectsLayer.addChild(root)
        this.destroySeaMinesInRadius(targetX, targetY, 185)
        gsap.fromTo(root.scale, { x: 0.15, y: 0.15 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' })
        gsap.to(inner, { rotation: Math.PI * 4, duration: 4.2, ease: 'none' })
        gsap.to(outer, { alpha: 0.35, duration: 0.35, yoyo: true, repeat: 9 })
        const pulseDamage = Math.max(8, Math.round(5 + this.power * 0.09))
        for (let pulse = 0; pulse < 7; pulse++) {
            gsap.delayedCall(0.35 + pulse * 0.52, () => {
                if (!this.running || root.destroyed) return
                for (const enemy of [...this.enemies.values()]) {
                    if (enemy.dead || dist(targetX, targetY, enemy.x, enemy.y) > 185) continue
                    enemy.x += (targetX - enemy.x) * 0.13
                    enemy.y += (targetY - enemy.y) * 0.13
                    enemy.root.position.set(enemy.x, enemy.y)
                    this.damageEnemyWithAbility(enemy, pulseDamage, 'RIP', 0x67e8f9, false)
                }
                for (let i = 0; i < 8; i++) this.spawnTrailParticle(targetX + randRange(-145, 145), targetY + randRange(-145, 145), 0x22d3ee, 1.1, 0.55)
            })
        }
        gsap.delayedCall(4.25, () => {
            if (root.destroyed) return
            gsap.to(root.scale, { x: 0, y: 0, duration: 0.35, ease: 'back.in(1.8)' })
            gsap.to(root, { alpha: 0, duration: 0.35, onComplete: () => root.destroy({ children: true }) })
        })
    }

    private castHellfireBarrage(targetX: number, targetY: number) {
        this.spawnDamagePopup('hellfire-cast', targetX, targetY - 145, 'HELLFIRE INBOUND', 0xfdba74, true)
        const damage = Math.max(16, Math.round(10 + this.power * 0.18))
        for (let i = 0; i < 7; i++) {
            const angle = i / 7 * Math.PI * 2 + randRange(-0.35, 0.35)
            const radius = i === 0 ? 0 : randRange(35, 125)
            const x = Math.max(45, Math.min(WORLD_W - 45, targetX + Math.cos(angle) * radius))
            const y = Math.max(45, Math.min(WORLD_H - 45, targetY + Math.sin(angle) * radius))
            gsap.delayedCall(i * 0.22, () => {
                if (!this.running) return
                const warning = new Graphics()
                warning.circle(0, 0, 72).fill({ color: 0xef4444, alpha: 0.08 }).stroke({ width: 3, color: 0xfb923c, alpha: 0.8 })
                warning.position.set(x, y)
                this.effectsLayer.addChild(warning)
                gsap.fromTo(warning.scale, { x: 0.25, y: 0.25 }, { x: 1, y: 1, duration: 0.62, ease: 'power1.out' })
                const shell = new Graphics()
                shell.circle(0, 0, 12).fill({ color: 0x431407 }).stroke({ width: 3, color: 0xfde68a })
                shell.position.set(x - 75, y - 210)
                this.effectsLayer.addChild(shell)
                gsap.to(shell.position, {
                    x,
                    y,
                    duration: 0.65,
                    ease: 'power2.in',
                    onUpdate: () => this.spawnTrailParticle(shell.x, shell.y, 0xf97316, 1.15),
                    onComplete: () => {
                        if (!shell.destroyed) shell.destroy()
                        if (!warning.destroyed) warning.destroy()
                        if (!this.running) return
                        this.spawnExplosion(x, y, 0xf97316, true)
                        this.destroySeaMinesInRadius(x, y, 72)
                        this.shake(5)
                        for (const enemy of [...this.enemies.values()]) {
                            if (!enemy.dead && dist(x, y, enemy.x, enemy.y) <= 72) this.damageEnemyWithAbility(enemy, damage, 'FIRE', 0xfdba74, true)
                        }
                    }
                })
            })
        }
    }

    private enemyFire(enemy: Enemy) {
        const volley = enemy.tier.volley ?? 1
        const fireOne = () => {
            if (!this.running || enemy.dead || this.destroyed) return
            const fireAngle = Math.atan2(this.playerY - enemy.y, this.playerX - enemy.x)
            const fromX = enemy.x + Math.cos(fireAngle) * 30
            const fromY = enemy.y + Math.sin(fireAngle) * 30
            this.spawnMuzzleFlash(fromX, fromY, fireAngle, 'enemy')
            this.spawnCannonball(fromX, fromY, this.playerX, this.playerY, 'enemy', (hitX, hitY) => {
                if (!this.running) return
                const defenseRating = Math.round(this.stats.defenseRating * (1 + this.powerUpStack('iron-plating') * 0.3))
                const roll = pirateRollAttack(enemy.attackRating, defenseRating, enemy.maxDamage)
                this.hitPlayer(roll, hitX, hitY)
            })
        }
        fireOne()
        // Corsairs and bosses rattle off a staggered spread.
        for (let i = 1; i < volley; i++) {
            gsap.delayedCall(i * 0.15, fireOne)
        }
    }

    private enemyAbilities(enemy: Enemy): EnemyAbility[] {
        if (enemy.tier.boss) return ['sniper', 'mine', 'bomb', 'skiffs']
        if (enemy.tier.sniper) return ['sniper']
        if (enemy.tier.id === 'ironclad' || enemy.tier.id === 'brigantine') return ['mine']
        if (['corsair', 'frigate', 'manowar', 'ghostship'].includes(enemy.tier.id)) return ['bomb']
        return ['skiffs']
    }

    private useEnemyAbility(enemy: Enemy) {
        if (!this.running || enemy.dead || this.destroyed) return
        const abilities = this.enemyAbilities(enemy)
        const ability = abilities[Math.floor(Math.random() * abilities.length)]!
        if (ability === 'sniper') this.fireSniperShot(enemy)
        else if (ability === 'mine') this.launchDriftMine(enemy)
        else if (ability === 'bomb') this.launchFrenzyBomb(enemy)
        else this.deployKamikazeSkiffs(enemy)
    }

    private fireSniperShot(enemy: Enemy) {
        if (!this.running || enemy.dead || this.destroyed) return
        const targetX = this.playerX
        const targetY = this.playerY
        const telegraph = new Container()
        const aimLine = new Graphics()
        aimLine.moveTo(enemy.x, enemy.y)
            .lineTo(targetX, targetY)
            .stroke({ width: 2.5, color: 0xf0abfc, alpha: 0.75 })
        telegraph.addChild(aimLine)
        const impact = new Graphics()
        impact.circle(0, 0, 58).fill({ color: 0xdc2626, alpha: 0.1 })
        impact.circle(0, 0, 58).stroke({ width: 3, color: 0xf87171, alpha: 0.9 })
        impact.moveTo(-14, 0).lineTo(14, 0).stroke({ width: 2, color: 0xfef2f2, alpha: 0.9 })
        impact.moveTo(0, -14).lineTo(0, 14).stroke({ width: 2, color: 0xfef2f2, alpha: 0.9 })
        impact.position.set(targetX, targetY)
        telegraph.addChild(impact)
        this.effectsLayer.addChild(telegraph)

        gsap.fromTo(impact.scale, { x: 0.55, y: 0.55 }, { x: 1, y: 1, duration: 0.32, ease: 'power2.out' })
        gsap.to(impact, { alpha: 0.35, duration: 0.22, ease: 'sine.inOut', yoyo: true, repeat: 3 })

        gsap.delayedCall(0.9, () => {
            if (telegraph.destroyed) return
            gsap.killTweensOf(impact)
            telegraph.destroy({ children: true })
            if (!this.running || enemy.dead || this.destroyed || this.enemies.get(enemy.id) !== enemy) return
            const fireAngle = Math.atan2(targetY - enemy.y, targetX - enemy.x)
            const fromX = enemy.x + Math.cos(fireAngle) * 30
            const fromY = enemy.y + Math.sin(fireAngle) * 30
            this.spawnMuzzleFlash(fromX, fromY, fireAngle, 'enemy')
            this.spawnSniperProjectile(enemy, fromX, fromY, targetX, targetY)
        })
    }

    private spawnSniperProjectile(enemy: Enemy, fromX: number, fromY: number, targetX: number, targetY: number) {
        const root = new Container()
        root.position.set(fromX, fromY)
        const glow = new Graphics()
        glow.circle(0, 0, 13).fill({ color: 0xc026d3, alpha: 0.25 })
        glow.circle(0, 0, 7).fill({ color: 0xf0abfc }).stroke({ width: 2, color: 0xfdf4ff })
        root.addChild(glow)
        this.effectsLayer.addChild(root)

        const duration = Math.min(1.5, Math.max(0.5, dist(fromX, fromY, targetX, targetY) / 430))
        let lastTrail = 0
        let previousX = fromX
        let previousY = fromY
        let collided = false
        gsap.to(root.position, {
            x: targetX,
            y: targetY,
            duration,
            ease: 'none',
            onUpdate: () => {
                if (!collided && segPointDist(previousX, previousY, root.x, root.y, this.playerX, this.playerY) <= 34) {
                    collided = true
                    gsap.killTweensOf(root.position)
                    const hitX = root.x
                    const hitY = root.y
                    if (!root.destroyed) root.destroy({ children: true })
                    if (this.running && !this.destroyed) {
                        this.resolveEnemyAreaAttack(hitX, hitY, 34, Math.max(6, Math.round(enemy.maxDamage * 0.9)), 'SNIPER HIT', 0xe879f9, false)
                    }
                    return
                }
                previousX = root.x
                previousY = root.y
                const now = performance.now()
                if (now - lastTrail < 32) return
                lastTrail = now
                this.spawnTrailParticle(root.x, root.y, 0xe879f9, 1.5)
            },
            onComplete: () => {
                if (collided) return
                if (root.destroyed) return
                root.destroy({ children: true })
                if (!this.running || enemy.dead || this.enemies.get(enemy.id) !== enemy) return
                if (dist(this.playerX, this.playerY, targetX, targetY) > 58) {
                    this.spawnSplash(targetX, targetY)
                    this.spawnDamagePopup('sniper-dodge', targetX, targetY - 24, 'DODGED', 0xf0abfc, true)
                    return
                }
                const defenseRating = Math.round(this.stats.defenseRating * (1 + this.powerUpStack('iron-plating') * 0.3))
                const roll = pirateRollAttack(enemy.attackRating, defenseRating, enemy.maxDamage)
                this.hitPlayer(roll, targetX, targetY)
            }
        })
    }

    private launchDriftMine(enemy: Enemy) {
        const targetX = this.playerX
        const targetY = this.playerY
        const warning = new Graphics()
        warning.circle(0, 0, 68).fill({ color: 0x2563eb, alpha: 0.08 })
        warning.circle(0, 0, 68).stroke({ width: 3, color: 0x60a5fa, alpha: 0.85 })
        warning.position.set(targetX, targetY)
        this.effectsLayer.addChild(warning)
        gsap.fromTo(warning.scale, { x: 0.35, y: 0.35 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' })
        gsap.to(warning, { alpha: 0.35, duration: 0.35, ease: 'sine.inOut', yoyo: true, repeat: 5 })

        const root = new Container()
        root.position.set(enemy.x, enemy.y)
        const glow = new Graphics()
        glow.circle(0, 0, 18).fill({ color: 0x3b82f6, alpha: 0.22 })
        glow.circle(0, 0, 10).fill({ color: 0x172554 }).stroke({ width: 3, color: 0x93c5fd })
        for (let i = 0; i < 6; i++) {
            const angle = i / 6 * Math.PI * 2
            glow.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8)
                .lineTo(Math.cos(angle) * 15, Math.sin(angle) * 15)
                .stroke({ width: 3, color: 0x60a5fa })
        }
        root.addChild(glow)
        this.effectsLayer.addChild(root)
        gsap.to(glow, { rotation: Math.PI * 3, duration: 2.35, ease: 'none' })
        let lastTrail = 0
        let previousX = enemy.x
        let previousY = enemy.y
        let collided = false
        gsap.to(root.position, {
            x: targetX,
            y: targetY,
            duration: 2.35,
            ease: 'power1.in',
            onUpdate: () => {
                if (!collided && segPointDist(previousX, previousY, root.x, root.y, this.playerX, this.playerY) <= 42) {
                    collided = true
                    gsap.killTweensOf(root.position)
                    gsap.killTweensOf(glow)
                    const hitX = root.x
                    const hitY = root.y
                    if (!root.destroyed) root.destroy({ children: true })
                    if (!warning.destroyed) warning.destroy()
                    if (this.running && !this.destroyed) {
                        this.resolveEnemyAreaAttack(hitX, hitY, 42, Math.max(5, Math.round(enemy.maxDamage * 0.9)), 'DRIFT MINE', 0x3b82f6)
                    }
                    return
                }
                previousX = root.x
                previousY = root.y
                const now = performance.now()
                if (now - lastTrail < 45) return
                lastTrail = now
                this.spawnTrailParticle(root.x, root.y, 0x60a5fa, 1.1)
            },
            onComplete: () => {
                if (collided) return
                if (!root.destroyed) root.destroy({ children: true })
                if (!warning.destroyed) warning.destroy()
                if (!this.running || this.destroyed) return
                this.resolveEnemyAreaAttack(targetX, targetY, 68, Math.max(5, Math.round(enemy.maxDamage * 0.9)), 'DRIFT MINE', 0x3b82f6)
            }
        })
    }

    private launchFrenzyBomb(enemy: Enemy) {
        const targetX = this.playerX
        const targetY = this.playerY
        const radius = enemy.tier.boss ? 125 : 110
        const warning = new Graphics()
        warning.circle(0, 0, radius).fill({ color: 0xf97316, alpha: 0.1 })
        warning.circle(0, 0, radius).stroke({ width: 4, color: 0xfb923c, alpha: 0.9 })
        warning.circle(0, 0, radius * 0.7).stroke({ width: 2, color: 0xfed7aa, alpha: 0.65 })
        warning.position.set(targetX, targetY)
        this.effectsLayer.addChild(warning)
        gsap.fromTo(warning.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.5, ease: 'power2.out' })
        gsap.to(warning, { alpha: 0.28, duration: 0.22, yoyo: true, repeat: 7 })

        const root = new Container()
        root.position.set(enemy.x, enemy.y)
        const bomb = new Graphics()
        bomb.circle(0, 0, 18).fill({ color: 0x431407 }).stroke({ width: 4, color: 0xfdba74 })
        bomb.circle(-5, -5, 5).fill({ color: 0xffedd5, alpha: 0.8 })
        const fuse = new Graphics()
        fuse.moveTo(8, -14).quadraticCurveTo(18, -24, 24, -14).stroke({ width: 3, color: 0xfde68a })
        fuse.circle(24, -14, 4).fill({ color: 0xfacc15 })
        root.addChild(bomb, fuse)
        this.effectsLayer.addChild(root)
        this.spawnMuzzleFlash(enemy.x, enemy.y, Math.atan2(targetY - enemy.y, targetX - enemy.x), 'enemy', 0xfb923c)
        let lastTrail = 0
        gsap.to(bomb.position, { y: -95, duration: 0.65, ease: 'sine.out', yoyo: true, repeat: 1 })
        gsap.to(root.position, {
            x: targetX,
            y: targetY,
            duration: 1.3,
            ease: 'none',
            onUpdate: () => {
                const now = performance.now()
                if (now - lastTrail < 35) return
                lastTrail = now
                this.spawnTrailParticle(root.x, root.y + bomb.y, 0xfb923c, 1.4)
            },
            onComplete: () => {
                if (!root.destroyed) root.destroy({ children: true })
                if (!warning.destroyed) warning.destroy()
                if (!this.running || this.destroyed) return
                this.resolveEnemyAreaAttack(targetX, targetY, radius, Math.max(8, Math.round(enemy.maxDamage * 1.35)), 'FRENZY BOMB', 0xf97316)
            }
        })
    }

    private deployKamikazeSkiffs(enemy: Enemy) {
        const baseTargetX = this.playerX
        const baseTargetY = this.playerY
        for (let i = 0; i < 3; i++) {
            const angle = i / 3 * Math.PI * 2
            const targetX = baseTargetX + Math.cos(angle) * 38
            const targetY = baseTargetY + Math.sin(angle) * 38
            const warning = new Graphics()
            warning.circle(0, 0, 42).fill({ color: 0x22d3ee, alpha: 0.06 })
            warning.circle(0, 0, 42).stroke({ width: 2, color: 0x67e8f9, alpha: 0.75 })
            warning.position.set(targetX, targetY)
            this.effectsLayer.addChild(warning)
            gsap.to(warning, { alpha: 0.2, duration: 0.25, yoyo: true, repeat: 7 })

            const skiff = new Container()
            skiff.position.set(enemy.x + Math.cos(angle) * 24, enemy.y + Math.sin(angle) * 24)
            const hull = new Graphics()
            hull.poly([-13, -6, 15, 0, -13, 6, -8, 0]).fill({ color: 0x164e63 }).stroke({ width: 2, color: 0xa5f3fc })
            hull.moveTo(-2, 0).lineTo(-2, -14).lineTo(8, -3).closePath().fill({ color: 0xecfeff, alpha: 0.9 })
            skiff.addChild(hull)
            this.effectsLayer.addChild(skiff)
            skiff.rotation = Math.atan2(targetY - skiff.y, targetX - skiff.x)
            const duration = 1.65 + i * 0.12
            let wakeTimer = 0
            let previousX = skiff.x
            let previousY = skiff.y
            let collided = false
            gsap.to(skiff.position, {
                x: targetX,
                y: targetY,
                duration,
                ease: 'power1.in',
                onUpdate: () => {
                    if (!collided && segPointDist(previousX, previousY, skiff.x, skiff.y, this.playerX, this.playerY) <= 40) {
                        collided = true
                        gsap.killTweensOf(skiff.position)
                        const hitX = skiff.x
                        const hitY = skiff.y
                        if (!skiff.destroyed) skiff.destroy({ children: true })
                        if (!warning.destroyed) warning.destroy()
                        if (this.running && !this.destroyed) {
                            this.resolveEnemyAreaAttack(hitX, hitY, 40, Math.max(4, Math.round(enemy.maxDamage * 0.55)), 'SKIFF RAM', 0x06b6d4, false)
                        }
                        return
                    }
                    previousX = skiff.x
                    previousY = skiff.y
                    const now = performance.now()
                    if (now - wakeTimer < 55) return
                    wakeTimer = now
                    this.spawnTrailParticle(skiff.x, skiff.y, 0x67e8f9, 0.7, 0.55)
                },
                onComplete: () => {
                    if (collided) return
                    if (!skiff.destroyed) skiff.destroy({ children: true })
                    if (!warning.destroyed) warning.destroy()
                    if (!this.running || this.destroyed) return
                    this.resolveEnemyAreaAttack(targetX, targetY, 42, Math.max(4, Math.round(enemy.maxDamage * 0.55)), 'SKIFF', 0x06b6d4, false)
                }
            })
        }
    }

    private resolveEnemyAreaAttack(x: number, y: number, radius: number, damage: number, label: string, color: number, heavy = true) {
        this.spawnExplosion(x, y, color, heavy)
        if (heavy) {
            this.spawnExplosion(x + randRange(-20, 20), y + randRange(-20, 20), 0xfbbf24, false)
            this.shake(8)
        }
        if (dist(this.playerX, this.playerY, x, y) > radius) {
            this.spawnSplash(x, y)
            this.spawnDamagePopup(`dodge-${label}`, x, y - 28, 'DODGED', 0xa5f3fc, true)
            return
        }
        this.damagePlayerDirect(damage, label, color)
    }

    private damagePlayerDirect(damage: number, label: string, color: number) {
        this.enterCombat()
        let hullDamage = damage
        if (this.shieldHp > 0) {
            const absorbed = Math.min(this.shieldHp, hullDamage)
            this.shieldHp -= absorbed
            hullDamage -= absorbed
            this.spawnShieldImpact(absorbed)
            if (this.shieldHp <= 0) this.removePowerUp('tide-shield')
            this.emitPowerUpState()
        }
        if (hullDamage <= 0) return
        this.playerHp = Math.max(0, this.playerHp - hullDamage)
        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.showPlayerHealthBar()
        this.flashShip(this.player)
        this.spawnDamagePopup('player-ability', this.playerX, this.playerY - 42, `${label} -${hullDamage}`, color, true)
        if (this.playerHp <= 0) this.endGame(false, 'defeat')
    }

    private spawnCannonball(
        fromX: number, fromY: number, toX: number, toY: number,
        kind: AmmoKind | 'enemy',
        onImpact: (x: number, y: number) => void,
        profile?: PlayerShotProfile
    ) {
        const spread = 22
        const tx = toX + (Math.random() - 0.5) * spread
        const ty = toY + (Math.random() - 0.5) * spread
        const travel = dist(fromX, fromY, tx, ty)
        const duration = Math.min(0.85, Math.max(0.16, travel / BALL_SPEED))

        const ballRoot = new Container()
        ballRoot.position.set(fromX, fromY)
        const ball = new Graphics()
        const ballScale = profile?.massive ? 2.5 : profile?.explosive ? 1.55 : 1
        if (kind === 'gem') {
            ball.circle(0, 0, 8 * ballScale).fill({ color: profile?.explosive ? 0xef4444 : 0x38bdf8, alpha: 0.3 })
            ball.circle(0, 0, 5 * ballScale).fill({ color: profile?.explosive ? 0xf97316 : 0x7dd3fc }).stroke({ width: 1.5, color: profile?.cannonColor ?? 0xe0f2fe, alpha: 0.9 })
        } else {
            const ballColor = profile?.explosive ? 0xea580c : profile?.massive ? 0x7c3aed : kind === 'enemy' ? 0x1c1917 : 0x44403c
            const strokeColor = profile?.massive ? 0xc4b5fd : profile?.cannonColor ?? 0x000000
            ball.circle(0, 0, 5 * ballScale).fill({ color: ballColor }).stroke({ width: profile?.massive ? 2.5 : 1.5, color: strokeColor, alpha: 0.8 })
        }
        ballRoot.addChild(ball)
        this.effectsLayer.addChild(ballRoot)

        gsap.to(ball.position, { y: -28, duration: duration / 2, ease: 'sine.out', yoyo: true, repeat: 1 })
        gsap.to(ball.scale, { x: 1.35, y: 1.35, duration: duration / 2, ease: 'sine.out', yoyo: true, repeat: 1 })

        let lastTrail = 0
        gsap.to(ballRoot.position, {
            x: tx,
            y: ty,
            duration,
            ease: 'none',
            onUpdate: () => {
                if (this.destroyed || (kind !== 'gem' && !profile?.explosive && !profile?.massive && !profile?.tierTrail)) return
                const now = performance.now()
                if (now - lastTrail < (profile?.tierTrail ? 48 : 36)) return
                lastTrail = now
                const trailColor = profile?.tierTrail ? profile.cannonColor : profile?.explosive ? 0xfb923c : profile?.massive ? 0xa78bfa : 0x7dd3fc
                const trailScale = profile?.massive ? 1.8 : profile?.tierTrail ? 0.85 : 1
                this.spawnTrailParticle(ballRoot.position.x, ballRoot.position.y + ball.position.y, trailColor, trailScale, profile?.tierTrail ? 0.38 : 0.85)
            },
            onComplete: () => {
                if (this.destroyed) return
                ballRoot.destroy({ children: true })
                onImpact(tx, ty)
            }
        })
    }

    private hitEnemy(enemy: Enemy, roll: { hit: boolean, dmg: number, crit: boolean }, x: number, y: number, kind: AmmoKind, profile: PlayerShotProfile) {
        if (enemy.dead) return
        if (!roll.hit) {
            this.spawnSplash(x, y)
            this.spawnDamagePopup(`enemy-${enemy.id}`, x, y - 24, 'MISS', 0x9ca3af, false)
            return
        }
        const baseDamage = roll.dmg
        const damageMult = (profile.explosive ? 1.5 : 1) * (profile.massive ? 3 : 1)
        const damage = Math.max(1, Math.round(baseDamage * damageMult))
        this.applyLifesteal(Math.min(damage, enemy.hp))
        enemy.hp -= damage
        const impactColor = profile.explosive ? 0xef4444 : profile.massive ? 0x8b5cf6 : profile.cannonColor
        this.spawnExplosion(enemy.x, enemy.y, impactColor, roll.crit || profile.explosive || profile.massive)
        if (profile.explosive) this.explodeAround(enemy, Math.max(1, Math.round(baseDamage * 0.5)))
        if (profile.massive) this.shake(9)
        this.flashShip(enemy.visual)
        const color = profile.explosive ? 0xfb923c : profile.massive ? 0xc4b5fd : kind === 'gem' ? 0x7dd3fc : roll.crit ? 0xfacc15 : 0xffffff
        const suffix = profile.massive ? ' TITAN!' : profile.explosive ? ' BOOM!' : roll.crit ? '!' : ''
        this.spawnDamagePopup(`enemy-${enemy.id}`, enemy.x, enemy.y - 40, `${damage}${suffix}`, color, roll.crit || profile.explosive || profile.massive)
        if (enemy.hp <= 0) {
            this.killEnemy(enemy)
        } else {
            this.updateEnemyHpBar(enemy)
        }
    }

    private explodeAround(primary: Enemy, splashDamage: number) {
        const radius = 105
        const ring = new Graphics()
        ring.circle(0, 0, 18).stroke({ width: 5, color: 0xfb923c, alpha: 0.9 })
        ring.position.set(primary.x, primary.y)
        this.effectsLayer.addChild(ring)
        gsap.to(ring.scale, { x: radius / 18, y: radius / 18, duration: 0.3, ease: 'power2.out' })
        gsap.to(ring, { alpha: 0, duration: 0.35, ease: 'power2.out', onComplete: () => ring.destroy() })

        for (const enemy of [...this.enemies.values()]) {
            if (enemy.id === primary.id || enemy.dead || dist(primary.x, primary.y, enemy.x, enemy.y) > radius) continue
            this.applyLifesteal(Math.min(splashDamage, enemy.hp))
            enemy.hp -= splashDamage
            this.spawnExplosion(enemy.x, enemy.y, 0xf97316, false)
            this.flashShip(enemy.visual)
            this.spawnDamagePopup(`enemy-${enemy.id}`, enemy.x, enemy.y - 35, `${splashDamage} SPLASH`, 0xfdba74, false)
            if (enemy.hp <= 0) this.killEnemy(enemy)
            else this.updateEnemyHpBar(enemy)
        }
    }

    private killEnemy(enemy: Enemy) {
        enemy.dead = true
        this.enemies.delete(enemy.id)
        if (this.attackTargetId === enemy.id) this.attackTargetId = null
        enemy.root.eventMode = 'none'
        enemy.targetRing.visible = false

        // Combo chain — kills in quick succession stack a coin bonus.
        const now = this.elapsedMs
        this.combo = now - this.lastKillAt <= PIRATE_COMBO_WINDOW_MS ? this.combo + 1 : 1
        this.lastKillAt = now
        this.maxCombo = Math.max(this.maxCombo, this.combo)
        this.kills += 1
        const sunk = this.sunkByType.get(enemy.tier.id)
        this.sunkByType.set(enemy.tier.id, { name: enemy.tier.name, count: (sunk?.count ?? 0) + 1 })

        const rewardMult = pirateRewardMultiplier(this.elapsedMs, this.difficulty)
        const baseReward = Math.round(randRange(enemy.tier.coinMin, enemy.tier.coinMax) * rewardMult)
        const stacks = Math.min(this.combo - 1, PIRATE_COMBO_MAX_STACKS)
        const bonus = Math.round(baseReward * stacks * PIRATE_COMBO_BONUS_PER_STACK)
        const reward = baseReward + bonus
        const bankedReward = this.addRawCoins(reward)
        this.callbacks.onKill?.(enemy.tier.name, bankedReward)
        if (this.combo > 1) this.callbacks.onCombo?.(this.combo)

        if (bankedReward > 0) {
            this.spawnDamagePopup(`enemy-${enemy.id}`, enemy.x, enemy.y - 14, `+${bankedReward}`, 0xfde047, false)
        }
        if (stacks > 0) {
            this.spawnDamagePopup(`combo`, enemy.x, enemy.y - 62, `COMBO x${this.combo}`, 0xf97316, true)
        }
        this.spawnExplosion(enemy.x, enemy.y, 0xfb923c, true)
        this.spawnSinkBubbles(enemy.x, enemy.y)

        if (Math.random() < ENEMY_POWER_UP_DROP_CHANCE) {
            this.spawnPowerUp(enemy.x, enemy.y)
        } else if (Math.random() < ENEMY_HEALTH_PACK_DROP_CHANCE) {
            this.spawnHealthPack(enemy.x, enemy.y)
        }

        if (enemy.tier.boss) {
            this.bossCount = Math.max(0, this.bossCount - 1)
            this.bossTimerMs = this.elapsedMs >= PIRATE_LATE_BOSS_PHASE_MS ? 12_000 * PIRATE_TIMELINE_SCALE : PIRATE_BOSS_RESPAWN_MS
            // A kill this big deserves fireworks.
            this.spawnExplosion(enemy.x, enemy.y, 0xdc2626, true)
            this.spawnExplosion(enemy.x + randRange(-24, 24), enemy.y + randRange(-24, 24), 0xfbbf24, true)
            this.shake(10)
        }

        // Sinking: list, roll over, slip beneath the waves.
        const v = enemy.visual
        gsap.to(v.body, { rotation: randRange(0.5, 0.9) * (Math.random() < 0.5 ? -1 : 1), duration: 1, ease: 'power1.in' })
        gsap.to(v.body.scale, { x: 0.5, y: 0.5, duration: 1.05, ease: 'power2.in' })
        gsap.to(v.body.position, { y: 10, duration: 1.05, ease: 'power1.in' })
        gsap.to(enemy.root, {
            alpha: 0,
            duration: 1.1,
            ease: 'power2.in',
            onComplete: () => {
                if (this.destroyed) return
                enemy.root.destroy({ children: true })
            }
        })
    }

    private hitPlayer(roll: { hit: boolean, dmg: number, crit: boolean }, x: number, y: number) {
        if (!this.running) return
        if (!roll.hit) {
            this.spawnSplash(x, y)
            this.spawnDamagePopup('player', this.playerX, this.playerY - 34, 'MISS', 0x9ca3af, false)
            return
        }
        this.enterCombat()
        let hullDamage = roll.dmg
        if (this.shieldHp > 0) {
            const absorbed = Math.min(this.shieldHp, hullDamage)
            this.shieldHp -= absorbed
            hullDamage -= absorbed
            this.spawnShieldImpact(absorbed)
            this.spawnDamagePopup('shield', this.playerX, this.playerY - 58, `BLOCK ${absorbed}`, 0x67e8f9, false)
            if (this.shieldHp <= 0) this.removePowerUp('tide-shield')
            this.emitPowerUpState()
        }
        if (hullDamage <= 0) return
        this.playerHp = Math.max(0, this.playerHp - hullDamage)
        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.showPlayerHealthBar()
        this.spawnExplosion(this.playerX, this.playerY, 0xef4444, roll.crit)
        this.flashShip(this.player)
        this.spawnDamagePopup('player', this.playerX, this.playerY - 34, `-${hullDamage}`, 0xff6b6b, roll.crit)
        this.shake(roll.crit ? 9 : 5)
        if (this.playerHp <= 0) this.endGame(false, 'defeat')
    }

    // ─── Treasure ───────────────────────────────────────────────────────────

    private spawnTreasure() {
        if (!this.running || !this.app) return
        const margin = 120
        let x = randRange(margin, WORLD_W - margin)
        let y = randRange(margin, WORLD_H - margin)
        if (dist(x, y, this.playerX, this.playerY) < 150) {
            x = WORLD_W - x
            y = WORLD_H - y
        }
        if (this.pointInIsland(x, y, 40)) {
            const free = this.nearestFreePoint(x, y)
            x = free.x
            y = free.y
        }

        const root = new Container()
        const bobWrapper = new Container()
        const glow = new Graphics()
        glow.circle(0, 0, 20).fill({ color: 0xfde047, alpha: 0.25 })
        bobWrapper.addChild(glow)
        const chest = new Graphics()
        chest.roundRect(-12, -8, 24, 16, 3).fill({ color: 0x92400e }).stroke({ width: 2, color: 0x451a03 })
        chest.roundRect(-12, -8, 24, 6, 2).fill({ color: 0xd97706 })
        chest.circle(0, -8, 3).fill({ color: 0xfde047 })
        bobWrapper.addChild(chest)
        root.addChild(bobWrapper)
        root.position.set(x, y)
        this.treasureLayer.addChild(root)

        gsap.fromTo(root.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.5)' })
        gsap.to(glow.scale, { x: 1.4, y: 1.4, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(bobWrapper.position, { y: -6, duration: 1.1, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        this.spawnTreasureSparkles(root)

        root.eventMode = 'static'
        root.cursor = 'pointer'
        root.hitArea = new Circle(0, 0, 26)
        root.on('pointerdown', (e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            if (!this.running || !this.treasure) return
            this.attackTargetId = null
            this.playerPath = this.computePath(this.playerX, this.playerY, this.treasure.x, this.treasure.y)
        })

        this.treasure = {
            root,
            x,
            y,
            vx: randRange(-16, 16),
            vy: randRange(-16, 16),
            reward: pirateTreasureReward(this.elapsedMs, this.difficulty),
            age: 0
        }
    }

    private spawnTreasureSparkles(root: Container) {
        for (let i = 0; i < 3; i++) {
            const spark = new Graphics()
            spark.star(0, 0, 4, 3.5, 1.4).fill({ color: 0xfef9c3, alpha: 0.95 })
            spark.position.set(randRange(-14, 14), randRange(-16, 4))
            spark.alpha = 0
            root.addChild(spark)
            gsap.to(spark, {
                alpha: 1,
                duration: 0.5,
                delay: i * 0.5,
                yoyo: true,
                repeat: -1,
                repeatDelay: 1,
                ease: 'sine.inOut'
            })
            gsap.to(spark, { rotation: Math.PI, duration: 2.4, repeat: -1, ease: 'none' })
        }
    }

    private collectTreasure(tr: Treasure) {
        this.treasure = null
        const bankedReward = this.addRawCoins(tr.reward)
        if (bankedReward > 0) {
            this.spawnDamagePopup('treasure', tr.x, tr.y - 14, `+${bankedReward}`, 0xfde047, true)
        }
        this.spawnSplash(tr.x, tr.y)
        gsap.killTweensOf(tr.root)
        gsap.to(tr.root.scale, { x: 1.6, y: 1.6, duration: 0.25, ease: 'power2.out' })
        gsap.to(tr.root, { alpha: 0, duration: 0.3, delay: 0.15, onComplete: () => tr.root.destroy({ children: true }) })
    }

    private expireTreasure(tr: Treasure) {
        this.treasure = null
        gsap.killTweensOf(tr.root)
        gsap.to(tr.root, { alpha: 0, duration: 0.6, onComplete: () => tr.root.destroy({ children: true }) })
    }

    // ─── Power ups ─────────────────────────────────────────────────────────

    private hasPowerUp(id: PiratePowerUpId) {
        return this.activePowerUps.has(id)
    }

    private powerUpStack(id: PiratePowerUpId) {
        return this.powerUpStacks.get(id) ?? 0
    }

    private removePowerUp(id: PiratePowerUpId) {
        this.activePowerUps.delete(id)
        this.powerUpStacks.delete(id)
    }

    private syncRoguePowerVisuals() {
        const razorStacks = this.powerUpStack('razor-orbit')
        if (razorStacks !== this.razorVisualStacks) {
            this.razorVisualStacks = razorStacks
            this.razorOrbit.removeChildren().forEach(child => child.destroy({ children: true }))
            const bladeCount = razorStacks > 0 ? Math.min(8, 2 + razorStacks * 2) : 0
            for (let i = 0; i < bladeCount; i++) {
                const angle = i / bladeCount * Math.PI * 2
                const blade = new Graphics()
                blade.moveTo(15, 0).lineTo(0, -7).lineTo(-15, 0).lineTo(0, 7).closePath()
                    .fill({ color: 0xe2e8f0 }).stroke({ width: 2, color: 0xfb7185 })
                blade.position.set(Math.cos(angle) * 92, Math.sin(angle) * 92)
                blade.rotation = angle + Math.PI / 2
                this.razorOrbit.addChild(blade)
            }
        }

        const ghostStacks = this.powerUpStack('ghost-armada')
        if (ghostStacks !== this.ghostVisualStacks) {
            this.ghostVisualStacks = ghostStacks
            this.ghostArmada.removeChildren().forEach(child => child.destroy({ children: true }))
            const shipCount = ghostStacks > 0 ? Math.min(5, ghostStacks + 1) : 0
            for (let i = 0; i < shipCount; i++) {
                const angle = i / shipCount * Math.PI * 2
                const ghost = new Graphics()
                ghost.poly([-12, -5, 14, 0, -12, 5, -7, 0]).fill({ color: 0xc4b5fd, alpha: 0.55 }).stroke({ width: 2, color: 0xf5f3ff, alpha: 0.8 })
                ghost.moveTo(-2, 0).lineTo(-2, -12).lineTo(7, -3).closePath().fill({ color: 0xede9fe, alpha: 0.5 })
                ghost.position.set(Math.cos(angle) * 70, Math.sin(angle) * 70)
                ghost.rotation = angle + Math.PI / 2
                this.ghostArmada.addChild(ghost)
            }
        }
    }

    private updateRoguePowerUps(dt: number, deltaMS: number) {
        this.syncRoguePowerVisuals()
        const razorStacks = this.powerUpStack('razor-orbit')
        this.razorOrbit.visible = razorStacks > 0
        if (razorStacks > 0) {
            this.razorOrbit.rotation += dt * (2.4 + razorStacks * 0.3)
            this.razorDamageTimerMs -= deltaMS
            if (this.razorDamageTimerMs <= 0) {
                this.razorDamageTimerMs = Math.max(220, 420 - razorStacks * 45)
                const damage = Math.max(3, Math.round(3 + this.power * 0.02 + razorStacks * 2))
                for (const enemy of [...this.enemies.values()]) {
                    if (!enemy.dead && dist(this.playerX, this.playerY, enemy.x, enemy.y) <= 112) {
                        this.damageEnemyWithAbility(enemy, damage, 'RAZOR', 0xfb7185, false)
                    }
                }
            }
        } else {
            this.razorDamageTimerMs = 0
        }

        const starburstStacks = this.powerUpStack('starburst-battery')
        if (starburstStacks > 0) {
            this.starburstTimerMs -= deltaMS
            if (this.starburstTimerMs <= 0) {
                this.starburstTimerMs = Math.max(2800, 6500 - starburstStacks * 800)
                this.fireStarburst(starburstStacks)
            }
        } else {
            this.starburstTimerMs = 0
        }

        const tempestStacks = this.powerUpStack('chain-tempest')
        if (tempestStacks > 0) {
            this.tempestTimerMs -= deltaMS
            if (this.tempestTimerMs <= 0) {
                this.tempestTimerMs = Math.max(2200, 5200 - tempestStacks * 650)
                this.fireChainTempest(tempestStacks)
            }
        } else {
            this.tempestTimerMs = 0
        }

        const ghostStacks = this.powerUpStack('ghost-armada')
        this.ghostArmada.visible = ghostStacks > 0
        if (ghostStacks > 0) {
            this.ghostArmada.rotation -= dt * 0.8
            this.ghostFireTimerMs -= deltaMS
            if (this.ghostFireTimerMs <= 0) {
                this.ghostFireTimerMs = Math.max(1200, 2900 - ghostStacks * 350)
                this.fireGhostArmada(ghostStacks)
            }
        } else {
            this.ghostFireTimerMs = 0
        }
    }

    private fireStarburst(stacks: number) {
        const damage = Math.max(8, Math.round(7 + this.power * 0.06 + stacks * 3))
        this.spawnDamagePopup('starburst', this.playerX, this.playerY - 70, 'STARBURST', 0xfde047, true)
        for (let i = 0; i < 10; i++) {
            const angle = i / 10 * Math.PI * 2 + this.timeSec * 0.25
            const targetX = this.playerX + Math.cos(angle) * 380
            const targetY = this.playerY + Math.sin(angle) * 380
            const target = [...this.enemies.values()]
                .filter(enemy => !enemy.dead && segPointDist(this.playerX, this.playerY, targetX, targetY, enemy.x, enemy.y) <= 48)
                .sort((a, b) => dist(this.playerX, this.playerY, a.x, a.y) - dist(this.playerX, this.playerY, b.x, b.y))[0]
            const hitId = target?.id
            this.spawnCannonball(
                this.playerX,
                this.playerY,
                target?.x ?? targetX,
                target?.y ?? targetY,
                'free',
                (x, y) => {
                    const enemy = hitId === undefined ? null : this.enemies.get(hitId)
                    if (enemy && !enemy.dead && dist(x, y, enemy.x, enemy.y) <= 70) this.damageEnemyWithAbility(enemy, damage, 'STAR', 0xfde047, false)
                    else this.spawnSplash(x, y)
                },
                { explosive: false, massive: false, cannonColor: 0xfde047, tierTrail: true }
            )
        }
    }

    private fireChainTempest(stacks: number) {
        const chain: Enemy[] = []
        const used = new Set<number>()
        let fromX = this.playerX
        let fromY = this.playerY
        for (let i = 0; i < Math.min(8, 3 + stacks); i++) {
            const next = this.closestEnemy(fromX, fromY, used)
            if (!next || dist(fromX, fromY, next.x, next.y) > (i === 0 ? 330 : 260)) break
            chain.push(next)
            used.add(next.id)
            fromX = next.x
            fromY = next.y
        }
        chain.forEach((enemy, index) => {
            const previous = index === 0 ? { x: this.playerX, y: this.playerY } : chain[index - 1]!
            this.drawLightningArc(previous.x, previous.y, enemy.x, enemy.y)
            const damage = Math.max(7, Math.round((8 + this.power * 0.045 + stacks * 2) * Math.pow(0.88, index)))
            this.damageEnemyWithAbility(enemy, damage, 'TEMPEST', 0x7dd3fc, index === 0)
        })
    }

    private fireGhostArmada(stacks: number) {
        const targets = [...this.enemies.values()]
            .filter(enemy => !enemy.dead)
            .sort((a, b) => dist(this.playerX, this.playerY, a.x, a.y) - dist(this.playerX, this.playerY, b.x, b.y))
        if (!targets.length) return
        const damage = Math.max(7, Math.round(6 + this.power * 0.04 + stacks * 2))
        this.ghostArmada.children.forEach((ghost, index) => {
            const target = targets[index % targets.length]!
            const id = target.id
            const fromX = this.playerX + ghost.x
            const fromY = this.playerY + ghost.y
            this.spawnMuzzleFlash(fromX, fromY, Math.atan2(target.y - fromY, target.x - fromX), 'gem', 0xa78bfa)
            this.spawnCannonball(fromX, fromY, target.x, target.y, 'gem', (x, y) => {
                const enemy = this.enemies.get(id)
                if (enemy && !enemy.dead) this.damageEnemyWithAbility(enemy, damage, 'GHOST', 0xc4b5fd, false)
                else this.spawnSplash(x, y)
            }, { explosive: false, massive: false, cannonColor: 0xa78bfa, tierTrail: true })
        })
    }

    private updatePowerUps(dt: number, deltaMS: number) {
        let stateChanged = false
        for (const [id, expiresAt] of this.activePowerUps) {
            if (expiresAt !== null && this.elapsedMs >= expiresAt) {
                this.removePowerUp(id)
                stateChanged = true
            }
        }

        this.updateRoguePowerUps(dt, deltaMS)

        for (const pickup of [...this.powerUpPickups]) {
            pickup.age += deltaMS
            pickup.x += pickup.vx * dt
            pickup.y += pickup.vy * dt
            const margin = 65
            if (pickup.x < margin || pickup.x > WORLD_W - margin) pickup.vx *= -1
            if (pickup.y < margin || pickup.y > WORLD_H - margin) pickup.vy *= -1
            if (this.pointInIsland(pickup.x + pickup.vx * dt * 8, pickup.y + pickup.vy * dt * 8, 24)) {
                pickup.vx *= -1
                pickup.vy *= -1
            }
            pickup.root.position.set(pickup.x, pickup.y)

            if (dist(pickup.x, pickup.y, this.playerX, this.playerY) < PICKUP_RADIUS + 6) {
                this.collectPowerUp(pickup)
                stateChanged = true
            } else if (pickup.age >= PIRATE_POWER_UP_LIFESPAN_MS) {
                this.expirePowerUpPickup(pickup)
            }
        }

        for (const healthPack of [...this.healthPackPickups]) {
            healthPack.age += deltaMS
            healthPack.x += healthPack.vx * dt
            healthPack.y += healthPack.vy * dt
            const margin = 65
            if (healthPack.x < margin || healthPack.x > WORLD_W - margin) healthPack.vx *= -1
            if (healthPack.y < margin || healthPack.y > WORLD_H - margin) healthPack.vy *= -1
            if (this.pointInIsland(healthPack.x + healthPack.vx * dt * 8, healthPack.y + healthPack.vy * dt * 8, 24)) {
                healthPack.vx *= -1
                healthPack.vy *= -1
            }
            healthPack.root.position.set(healthPack.x, healthPack.y)

            if (this.playerHp < this.stats.maxHp && dist(healthPack.x, healthPack.y, this.playerX, this.playerY) < PICKUP_RADIUS + 6) {
                this.collectHealthPack(healthPack)
                stateChanged = true
            } else if (healthPack.age >= PIRATE_HEALTH_PACK_LIFESPAN_MS) {
                this.expireHealthPack(healthPack)
            }
        }

        this.powerUpTimerMs -= deltaMS
        if (this.powerUpTimerMs <= 0) {
            if (!this.powerUpPickups.length) this.spawnPowerUp()
            this.powerUpTimerMs += PIRATE_POWER_UP_INTERVAL_MS
        }
        this.healthPackTimerMs -= deltaMS
        if (this.healthPackTimerMs <= 0) {
            if (!this.healthPackPickups.length) this.spawnHealthPack()
            this.healthPackTimerMs += PIRATE_HEALTH_PACK_INTERVAL_MS
        }

        this.powerUpHudTimerMs -= deltaMS
        if (stateChanged || this.powerUpHudTimerMs <= 0) {
            this.powerUpHudTimerMs = 250
            this.emitPowerUpState()
        }
    }

    private spawnPowerUp(dropX?: number, dropY?: number) {
        if (!this.running || !this.app) return
        const choices = PIRATE_POWER_UPS.filter(definition => this.powerUpStack(definition.id) < definition.maxStacks)
        const definition = (choices.length ? choices : PIRATE_POWER_UPS)[Math.floor(Math.random() * (choices.length || PIRATE_POWER_UPS.length))]!
        const margin = 110
        let x = dropX ?? randRange(margin, WORLD_W - margin)
        let y = dropY ?? randRange(margin, WORLD_H - margin)
        if (dropX === undefined && dropY === undefined && dist(x, y, this.playerX, this.playerY) < 220) {
            x = WORLD_W - x
            y = WORLD_H - y
        }
        if (this.pointInIsland(x, y, 45)) {
            const free = this.nearestFreePoint(x, y)
            x = free.x
            y = free.y
        }

        const root = new Container()
        root.position.set(x, y)
        const pulse = new Graphics()
        pulse.circle(0, 0, 32).fill({ color: definition.color, alpha: 0.2 })
        pulse.circle(0, 0, 25).stroke({ width: 3, color: definition.color, alpha: 0.85 })
        root.addChild(pulse)
        const buoy = new Graphics()
        buoy.circle(0, 2, 18).fill({ color: 0xf8fafc }).stroke({ width: 3, color: definition.color })
        buoy.rect(-12, -2, 24, 8).fill({ color: definition.color, alpha: 0.9 })
        root.addChild(buoy)
        const icon = new Text({ text: definition.icon, style: { fontSize: 21 } })
        icon.anchor.set(0.5)
        icon.position.y = -1
        root.addChild(icon)
        const label = new Text({
            text: definition.name.toUpperCase(),
            style: { fill: 0xffffff, fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 12, fontWeight: '900', stroke: { color: 0x111827, width: 4 } }
        })
        label.anchor.set(0.5)
        label.position.y = -34
        root.addChild(label)
        this.treasureLayer.addChild(root)

        gsap.fromTo(root.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.5)' })
        gsap.to(pulse.scale, { x: 1.35, y: 1.35, duration: 0.75, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(pulse, { alpha: 0.45, duration: 0.75, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(buoy.position, { y: -5, duration: 1, ease: 'sine.inOut', yoyo: true, repeat: -1 })

        root.eventMode = 'static'
        root.cursor = 'pointer'
        root.hitArea = new Circle(0, 0, 38)
        root.on('pointerdown', (e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            const activePickup = this.powerUpPickups.find(pickup => pickup.root === root)
            if (!this.running || !activePickup) return
            this.attackTargetId = null
            this.playerPath = this.computePath(this.playerX, this.playerY, activePickup.x, activePickup.y)
        })

        this.powerUpPickups.push({ root, definition, x, y, vx: randRange(-12, 12), vy: randRange(-12, 12), age: 0 })
        this.callbacks.onPowerUpSpawn?.(definition.name)
    }

    private collectPowerUp(pickup: PowerUpPickup) {
        this.powerUpPickups = this.powerUpPickups.filter(active => active !== pickup)
        const { definition } = pickup
        const stacks = Math.min(definition.maxStacks, this.powerUpStack(definition.id) + 1)
        this.powerUpStacks.set(definition.id, stacks)
        if (definition.id === 'tide-shield') {
            this.shieldHp = Math.min(100, this.shieldHp + 20)
            this.activePowerUps.set(definition.id, null)
        } else {
            this.activePowerUps.set(definition.id, this.elapsedMs + definition.durationMs!)
        }
        if (definition.id === 'blast-powder') this.blastShotCount = 0
        if (definition.id === 'titan-shot') this.titanShotCount = 0

        this.syncRoguePowerVisuals()
        this.callbacks.onPowerUpCollected?.(`${definition.name}${stacks > 1 ? ` x${stacks}` : ''}`)
        this.spawnPowerUpBurst(pickup.x, pickup.y, definition.color)
        this.spawnDamagePopup('power-up', pickup.x, pickup.y - 35, definition.name.toUpperCase(), definition.color, true)
        gsap.killTweensOf(pickup.root)
        gsap.to(pickup.root.scale, { x: 1.8, y: 1.8, duration: 0.22, ease: 'power2.out' })
        gsap.to(pickup.root, { alpha: 0, duration: 0.25, onComplete: () => pickup.root.destroy({ children: true }) })
    }

    private expirePowerUpPickup(pickup: PowerUpPickup) {
        this.powerUpPickups = this.powerUpPickups.filter(active => active !== pickup)
        gsap.killTweensOf(pickup.root)
        gsap.to(pickup.root, { alpha: 0, duration: 0.5, onComplete: () => pickup.root.destroy({ children: true }) })
    }

    private spawnHealthPack(dropX?: number, dropY?: number) {
        if (!this.running || !this.app) return
        const margin = 110
        let x = dropX ?? randRange(margin, WORLD_W - margin)
        let y = dropY ?? randRange(margin, WORLD_H - margin)
        if (dropX === undefined && dropY === undefined && dist(x, y, this.playerX, this.playerY) < 210) {
            x = WORLD_W - x
            y = WORLD_H - y
        }
        if (this.pointInIsland(x, y, 45)) {
            const free = this.nearestFreePoint(x, y)
            x = free.x
            y = free.y
        }

        const root = new Container()
        root.position.set(x, y)
        const pulse = new Graphics()
        pulse.circle(0, 0, 32).fill({ color: 0x22c55e, alpha: 0.2 })
        pulse.circle(0, 0, 25).stroke({ width: 3, color: 0x4ade80, alpha: 0.9 })
        root.addChild(pulse)
        const crate = new Graphics()
        crate.roundRect(-18, -15, 36, 30, 6).fill({ color: 0xf8fafc }).stroke({ width: 3, color: 0x16a34a })
        crate.rect(-5, -11, 10, 22).fill({ color: 0xef4444 })
        crate.rect(-12, -4, 24, 9).fill({ color: 0xef4444 })
        root.addChild(crate)
        const label = new Text({
            text: 'HULL REPAIR',
            style: { fill: 0xbbf7d0, fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 12, fontWeight: '900', stroke: { color: 0x111827, width: 4 } }
        })
        label.anchor.set(0.5)
        label.position.y = -35
        root.addChild(label)
        this.treasureLayer.addChild(root)

        gsap.fromTo(root.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.5)' })
        gsap.to(pulse.scale, { x: 1.4, y: 1.4, duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(pulse, { alpha: 0.5, duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(crate.position, { y: -5, duration: 1, ease: 'sine.inOut', yoyo: true, repeat: -1 })

        root.eventMode = 'static'
        root.cursor = 'pointer'
        root.hitArea = new Circle(0, 0, 38)
        root.on('pointerdown', (e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            const activePack = this.healthPackPickups.find(pack => pack.root === root)
            if (!this.running || !activePack) return
            this.attackTargetId = null
            this.playerPath = this.computePath(this.playerX, this.playerY, activePack.x, activePack.y)
        })

        this.healthPackPickups.push({ root, x, y, vx: randRange(-10, 10), vy: randRange(-10, 10), age: 0, healFraction: randRange(0.1, 0.2) })
        this.callbacks.onHealthPackSpawn?.()
    }

    private collectHealthPack(pack: HealthPackPickup) {
        this.healthPackPickups = this.healthPackPickups.filter(active => active !== pack)
        const requestedHeal = Math.max(1, Math.round(this.stats.maxHp * pack.healFraction))
        const healed = Math.min(requestedHeal, this.stats.maxHp - this.playerHp)
        this.playerHp += healed
        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.updatePlayerHealthBar()
        this.callbacks.onHealthPackCollected?.(healed)
        this.spawnPowerUpBurst(pack.x, pack.y, 0x4ade80)
        this.spawnDamagePopup('health-pack', pack.x, pack.y - 35, `+${healed} HULL`, 0x86efac, true)
        gsap.killTweensOf(pack.root)
        gsap.to(pack.root.scale, { x: 1.8, y: 1.8, duration: 0.22, ease: 'power2.out' })
        gsap.to(pack.root, { alpha: 0, duration: 0.25, onComplete: () => pack.root.destroy({ children: true }) })
    }

    private expireHealthPack(pack: HealthPackPickup) {
        this.healthPackPickups = this.healthPackPickups.filter(active => active !== pack)
        gsap.killTweensOf(pack.root)
        gsap.to(pack.root, { alpha: 0, duration: 0.5, onComplete: () => pack.root.destroy({ children: true }) })
    }

    private emitPowerUpState() {
        const active = PIRATE_POWER_UPS
            .filter(definition => this.activePowerUps.has(definition.id))
            .map((definition): PirateActivePowerUp => {
                const expiresAt = this.activePowerUps.get(definition.id) ?? null
                const item: PirateActivePowerUp = {
                    id: definition.id,
                    name: definition.name,
                    description: definition.description,
                    icon: definition.icon,
                    remainingMs: expiresAt === null ? null : Math.max(0, expiresAt - this.elapsedMs),
                    stacks: this.powerUpStack(definition.id)
                }
                if (definition.id === 'tide-shield') item.shield = this.shieldHp
                if (definition.id === 'blast-powder') {
                    const every = Math.max(2, 5 - this.powerUpStack('blast-powder'))
                    item.counter = every - (this.blastShotCount % every)
                }
                if (definition.id === 'titan-shot') {
                    const every = Math.max(4, 12 - this.powerUpStack('titan-shot') * 2)
                    item.counter = every - (this.titanShotCount % every)
                }
                return item
            })
        this.callbacks.onPowerUpsChange?.(active, Math.max(0, this.powerUpTimerMs), Math.max(0, this.healthPackTimerMs))
    }

    // ─── Sea mines ─────────────────────────────────────────────────────────

    private updateSeaMines(deltaMS: number) {
        this.seaMineTimerMs -= deltaMS
        if (this.seaMineTimerMs <= 0) {
            this.spawnSeaMine()
            this.seaMineTimerMs += PIRATE_SEA_MINE_INTERVAL_MS
        }

        for (const mine of [...this.seaMines]) {
            mine.age += deltaMS
            if (dist(mine.x, mine.y, this.playerX, this.playerY) < 50) {
                this.detonateSeaMine(mine)
            } else if (mine.age >= PIRATE_SEA_MINE_LIFESPAN_MS) {
                this.expireSeaMine(mine)
            }
        }
    }

    private spawnSeaMine() {
        if (!this.running || !this.app) return
        const margin = 80
        let position: { x: number, y: number } | null = null
        for (let attempt = 0; attempt < 40; attempt++) {
            const x = randRange(margin, WORLD_W - margin)
            const y = randRange(margin, WORLD_H - margin)
            if (dist(x, y, this.playerX, this.playerY) < 300) continue
            if (this.pointInIsland(x, y, 38)) continue
            if (this.seaMines.some(mine => dist(x, y, mine.x, mine.y) < 120)) continue
            position = { x, y }
            break
        }
        if (!position) return

        const root = new Container()
        root.position.set(position.x, position.y)
        root.eventMode = 'none'
        const warning = new Graphics()
        warning.circle(0, 0, 34).fill({ color: 0xef4444, alpha: 0.08 })
        warning.circle(0, 0, 29).stroke({ width: 2, color: 0xf87171, alpha: 0.55 })
        root.addChild(warning)
        const mine = new Graphics()
        mine.circle(0, 0, 14).fill({ color: 0x292524 }).stroke({ width: 3, color: 0x78716c })
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2
            mine.moveTo(Math.cos(angle) * 11, Math.sin(angle) * 11)
                .lineTo(Math.cos(angle) * 22, Math.sin(angle) * 22)
                .stroke({ width: 4, color: 0x57534e })
            mine.circle(Math.cos(angle) * 23, Math.sin(angle) * 23, 3).fill({ color: 0xef4444 })
        }
        mine.circle(0, 0, 4).fill({ color: 0xfca5a5 })
        root.addChild(mine)
        const label = new Text({
            text: 'SEA MINE',
            style: { fill: 0xfca5a5, fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 11, fontWeight: '900', stroke: { color: 0x111827, width: 4 } }
        })
        label.anchor.set(0.5)
        label.position.y = -37
        root.addChild(label)
        this.treasureLayer.addChild(root)

        gsap.fromTo(root.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.5)' })
        gsap.to(warning.scale, { x: 1.25, y: 1.25, duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(warning, { alpha: 0.8, duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(mine, { rotation: Math.PI * 2, duration: 8, ease: 'none', repeat: -1 })

        this.seaMines.push({
            root,
            x: position.x,
            y: position.y,
            age: 0,
            damageFraction: pirateSeaMineDamageFraction(this.elapsedMs)
        })
    }

    private detonateSeaMine(mine: SeaMine) {
        this.removeSeaMine(mine)
        this.enterCombat()
        let hullDamage = Math.max(1, Math.round(this.stats.maxHp * mine.damageFraction))
        if (this.shieldHp > 0) {
            const absorbed = Math.min(this.shieldHp, hullDamage)
            this.shieldHp -= absorbed
            hullDamage -= absorbed
            this.spawnShieldImpact(absorbed)
            if (this.shieldHp <= 0) this.removePowerUp('tide-shield')
            this.emitPowerUpState()
        }
        this.playerHp = Math.max(0, this.playerHp - hullDamage)
        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        if (hullDamage > 0) this.showPlayerHealthBar()
        this.spawnExplosion(mine.x, mine.y, 0xef4444, true)
        this.spawnExplosion(mine.x + randRange(-16, 16), mine.y + randRange(-16, 16), 0xf97316, true)
        this.spawnDamagePopup('sea-mine', this.playerX, this.playerY - 45, `MINE -${Math.round(mine.damageFraction * 100)}%`, 0xfca5a5, true)
        this.flashShip(this.player)
        this.shake(12)
        if (this.playerHp <= 0) this.endGame(false, 'defeat')
    }

    private expireSeaMine(mine: SeaMine) {
        this.seaMines = this.seaMines.filter(item => item !== mine)
        gsap.killTweensOf(mine.root)
        gsap.killTweensOf(mine.root.children)
        gsap.to(mine.root, { alpha: 0, duration: 0.45, onComplete: () => mine.root.destroy({ children: true }) })
    }

    private removeSeaMine(mine: SeaMine) {
        this.seaMines = this.seaMines.filter(item => item !== mine)
        gsap.killTweensOf(mine.root)
        gsap.killTweensOf(mine.root.children)
        mine.root.destroy({ children: true })
    }

    private destroySeaMinesInRadius(x: number, y: number, radius: number) {
        const mines = this.seaMines.filter(mine => dist(x, y, mine.x, mine.y) <= radius)
        for (const mine of mines) {
            this.removeSeaMine(mine)
            this.spawnExplosion(mine.x, mine.y, 0x38bdf8, false)
            this.spawnDamagePopup(`mine-cleared-${mine.x}-${mine.y}`, mine.x, mine.y - 28, 'MINE CLEARED', 0x7dd3fc, true)
        }
    }

    // ─── Enemy spawning ─────────────────────────────────────────────────────

    private spawnEnemy(tierOverride?: PirateEnemyTier) {
        if (!this.running || !this.app) return
        const tier = tierOverride ?? pirateRollEnemyTier(this.elapsedMs, this.difficulty)
        const diff = pirateDifficultyMultiplier(this.elapsedMs, this.difficulty)
        const hp = Math.max(1, Math.round(tier.hp * diff.hpMult))

        const margin = 50
        let x = 0
        let y = 0
        let foundSpawn = false
        for (let attempt = 0; attempt < 30; attempt++) {
            const edge = Math.floor(Math.random() * 4)
            if (edge === 0) { x = margin; y = randRange(margin, WORLD_H - margin) } else if (edge === 1) { x = WORLD_W - margin; y = randRange(margin, WORLD_H - margin) } else if (edge === 2) { x = randRange(margin, WORLD_W - margin); y = margin } else { x = randRange(margin, WORLD_W - margin); y = WORLD_H - margin }
            if (this.pointInIsland(x, y) || dist(x, y, this.playerX, this.playerY) < 260) continue
            foundSpawn = true
            break
        }
        if (!foundSpawn) return

        const sizeScale = tier.sizeScale ?? 1
        const visual = this.createShipVisual(tier.color, false, sizeScale, tier.id)
        if (tier.id === 'ghostship') {
            visual.body.alpha = 0.78
        }

        if (tier.boss) {
            // Menacing pulsing aura under the hull
            const aura = new Graphics()
            aura.circle(0, 0, 58 * sizeScale).fill({ color: 0xdc2626, alpha: 0.16 })
            aura.circle(0, 0, 58 * sizeScale).stroke({ width: 2.5, color: 0xdc2626, alpha: 0.55 })
            visual.root.addChildAt(aura, 0)
            gsap.to(aura.scale, { x: 1.18, y: 1.18, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: -1 })
            gsap.to(aura, { alpha: 0.5, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        }

        const targetRing = new Graphics()
        const ringR = 46 * sizeScale
        for (let i = 0; i < 4; i++) {
            const a0 = (i / 4) * Math.PI * 2
            targetRing.moveTo(Math.cos(a0) * ringR, Math.sin(a0) * ringR)
                .arc(0, 0, ringR, a0, a0 + Math.PI / 3)
                .stroke({ width: 3, color: 0xf87171, alpha: 0.9 })
        }
        targetRing.visible = false
        visual.root.addChildAt(targetRing, 0)

        const hpBar = tier.boss
            ? this.createHpBar(86, -50 - 18 * sizeScale)
            : this.createHpBar()
        visual.root.addChild(hpBar.container)
        visual.root.position.set(x, y)
        visual.root.scale.set(0.001)
        this.enemyLayer.addChild(visual.root)
        gsap.to(visual.root.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' })
        this.spawnSplash(x, y)

        const id = this.nextEnemyId++
        const enemy: Enemy = {
            id,
            tier,
            hp,
            maxHp: hp,
            x,
            y,
            angle: Math.atan2(this.playerY - y, this.playerX - x),
            reloadTimer: randRange(300 * PIRATE_TIMELINE_SCALE, tier.reloadMs * pirateEnemyReloadMultiplier(this.elapsedMs, this.difficulty) * PIRATE_TIMELINE_SCALE),
            abilityTimer: tier.boss
                ? randRange(PIRATE_BOSS_ABILITY_INITIAL_MIN_MS, PIRATE_BOSS_ABILITY_INITIAL_MAX_MS)
                : randRange(4200 * PIRATE_TIMELINE_SCALE, 7200 * PIRATE_TIMELINE_SCALE),
            speed: tier.speed,
            defense: Math.max(1, Math.round(tier.defense * diff.statMult)),
            attackRating: Math.max(1, Math.round(tier.attackRating * diff.statMult)),
            maxDamage: Math.max(1, Math.round(tier.maxDamage * diff.dmgMult * (tier.boss ? PIRATE_BOSS_DAMAGE_MULT : 1))),
            root: visual.root,
            visual,
            targetRing,
            hpBarFill: hpBar.fill,
            hpBarWidth: hpBar.width,
            dead: false
        }
        this.enemies.set(id, enemy)

        visual.root.eventMode = 'static'
        visual.root.cursor = 'pointer'
        visual.root.hitArea = new Circle(0, 0, 44 * sizeScale)
        visual.root.on('pointerdown', (e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            if (!this.running || enemy.dead) return
            this.attackTargetId = id
            this.playerPath = []
        })
    }

    // ─── Visuals ────────────────────────────────────────────────────────────

    private drawWaterTexture() {
        this.bg.clear()
        this.bg.rect(0, 0, WORLD_W, WORLD_H).fill({ color: 0x0b3a57 })
        // Depth blotches
        for (let i = 0; i < 26; i++) {
            const x = Math.random() * WORLD_W
            const y = Math.random() * WORLD_H
            const w = 60 + Math.random() * 140
            this.bg.ellipse(x, y, w, w * 0.4).fill({ color: 0x0e4466, alpha: 0.25 + Math.random() * 0.15 })
        }
        for (let i = 0; i < 40; i++) {
            const x = Math.random() * WORLD_W
            const y = Math.random() * WORLD_H
            const w = 40 + Math.random() * 90
            this.bg.ellipse(x, y, w, w * 0.18).fill({ color: 0x1c5c82, alpha: 0.12 + Math.random() * 0.08 })
        }
    }

    /** Slow-drifting wave glints that loop forever — makes the sea feel alive. */
    private spawnAmbientWaves() {
        for (let i = 0; i < 14; i++) {
            const wave = new Graphics()
            const w = randRange(24, 60)
            wave.moveTo(-w / 2, 0)
                .quadraticCurveTo(0, -w * 0.14, w / 2, 0)
                .stroke({ width: 2, color: 0x9fd0e8, alpha: randRange(0.12, 0.3) })
            wave.position.set(Math.random() * WORLD_W, Math.random() * WORLD_H)
            this.waveLayer.addChild(wave)
            const drift = randRange(20, 50)
            const dur = randRange(4, 8)
            gsap.to(wave.position, { x: `+=${drift}`, duration: dur, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: Math.random() * dur })
            gsap.to(wave, { alpha: 0.05, duration: dur * 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        }
    }

    /**
     * Top-down ship art. Everything is drawn in "bird's eye" view (hull planks,
     * square-rig sails seen from above) so rotating toward any heading —
     * including straight down — never flips the sprite upside down.
     */
    private createShipVisual(color: number, isPlayer: boolean, sizeScale: number, tierId?: string, playerSkinId?: string): ShipVisual {
        const root = new Container()
        const hull = new Container()
        const body = new Container()
        body.scale.set(sizeScale)

        const shadow = new Graphics()
        shadow.ellipse(3, 5, 40, 18).fill({ color: 0x000000, alpha: 0.25 })
        body.addChild(shadow)

        const isSniper = tierId === 'sniper'
        const isDpsRaider = tierId === 'corsair' || tierId === 'frigate' || tierId === 'manowar'
        const isTankRaider = tierId === 'ironclad' || tierId === 'dreadnought'
        const spriteTexture = isPlayer
            ? (this.playerSkinTextures.get(playerSkinId ?? 'starter') ?? this.playerShipTexture)
            : isSniper
                ? this.sniperShipTexture
                : isDpsRaider
                    ? this.dpsRaiderTexture
                    : isTankRaider ? this.tankRaiderTexture : this.raiderShipTexture
        if (spriteTexture) {
            const sprite = new Sprite(spriteTexture)
            sprite.anchor.set(0.5)
            sprite.width = isSniper ? 88 : isDpsRaider ? 82 : isTankRaider ? 76 : isPlayer ? 82 : 78
            sprite.height = isPlayer
                ? sprite.width * spriteTexture.height / spriteTexture.width
                : isSniper ? 24 : isDpsRaider ? 30 : isTankRaider ? 42 : 37
            body.addChild(sprite)

            // Preserve instant faction/tier readability without recoloring the art.
            const marker = new Graphics()
            marker.circle(-27, 0, isSniper ? 3 : 4).fill({ color, alpha: 0.95 })
            marker.circle(-27, 0, isSniper ? 6 : 7).stroke({ width: 1.5, color, alpha: 0.6 })
            body.addChild(marker)

            const flashOverlay = new Graphics()
            flashOverlay.ellipse(0, 0, isSniper ? 44 : isDpsRaider ? 41 : 39, isSniper ? 12 : isTankRaider ? 21 : 18).fill({ color: 0xffffff })
            flashOverlay.alpha = 0
            body.addChild(flashOverlay)

            hull.addChild(body)
            root.addChild(hull)
            return { root, hull, body, sprite, sails: [], flashOverlay, phase: Math.random() * Math.PI * 2 }
        }

        // Hull: pointed bow (+x), rounded stern
        const hullShape = new Graphics()
        hullShape.poly([
            36, 0,
            24, -11,
            -18, -13,
            -28, -8,
            -30, 0,
            -28, 8,
            -18, 13,
            24, 11
        ]).fill({ color: 0x6b4a2b }).stroke({ width: 3, color: 0x2d1e10, alpha: 0.85 })
        body.addChild(hullShape)

        // Deck inset + planks
        const deck = new Graphics()
        deck.poly([
            29, 0,
            19, -8,
            -16, -9.5,
            -24, -5,
            -25, 0,
            -24, 5,
            -16, 9.5,
            19, 8
        ]).fill({ color: 0x9c7347 })
        deck.moveTo(-22, -3).lineTo(24, -2.5).stroke({ width: 1, color: 0x7a5836, alpha: 0.8 })
        deck.moveTo(-22, 3).lineTo(24, 2.5).stroke({ width: 1, color: 0x7a5836, alpha: 0.8 })
        body.addChild(deck)

        // Colored gunwale trim marks the faction/tier color
        const trim = new Graphics()
        trim.poly([
            36, 0,
            24, -11,
            -18, -13,
            -28, -8
        ]).stroke({ width: 3.5, color, alpha: 0.95 })
        trim.poly([
            -28, 8,
            -18, 13,
            24, 11,
            36, 0
        ]).stroke({ width: 3.5, color, alpha: 0.95 })
        body.addChild(trim)

        // Side cannons peeking out
        const guns = new Graphics()
        for (const gx of [-8, 6]) {
            guns.rect(gx, -15.5, 4, 4).fill({ color: 0x1c1917 })
            guns.rect(gx, 11.5, 4, 4).fill({ color: 0x1c1917 })
        }
        body.addChild(guns)

        // Square-rig sails seen from above: yard (spar) across the hull with a
        // billowing canvas behind it. Two masts.
        const sailColor = isPlayer ? 0xfaf3e0 : 0xd9d2c4
        const sails: Graphics[] = []
        const mastDefs = [
            { x: 8, half: 19 },
            { x: -12, half: 14 }
        ]
        for (const m of mastDefs) {
            const yard = new Graphics()
            yard.roundRect(m.x - 1.5, -m.half, 3, m.half * 2, 1.5).fill({ color: 0x3f2f1f })
            body.addChild(yard)

            const sail = new Graphics()
            // Canvas billows backward (toward -x)
            sail.moveTo(0, -m.half + 2)
                .quadraticCurveTo(-11, 0, 0, m.half - 2)
                .quadraticCurveTo(-4, 0, 0, -m.half + 2)
                .fill({ color: sailColor, alpha: 0.95 })
                .stroke({ width: 1.2, color: 0x1c1917, alpha: 0.4 })
            sail.position.set(m.x - 1, 0)
            body.addChild(sail)
            sails.push(sail)

            const top = new Graphics()
            top.circle(m.x, 0, 2.4).fill({ color: 0x2d1e10 })
            body.addChild(top)
        }

        // Stern flag
        const flag = new Graphics()
        flag.poly([-30, 0, -42, -4, -42, 4]).fill({ color: isPlayer ? 0xef4444 : color })
        body.addChild(flag)

        // Damage flash overlay, blinked from flashShip()
        const flashOverlay = new Graphics()
        flashOverlay.poly([
            36, 0,
            24, -11,
            -18, -13,
            -28, -8,
            -30, 0,
            -28, 8,
            -18, 13,
            24, 11
        ]).fill({ color: 0xffffff })
        flashOverlay.alpha = 0
        body.addChild(flashOverlay)

        hull.addChild(body)
        root.addChild(hull)
        return { root, hull, body, sails, flashOverlay, phase: Math.random() * Math.PI * 2 }
    }

    private flashShip(v: ShipVisual) {
        gsap.killTweensOf(v.flashOverlay)
        v.flashOverlay.alpha = 0.75
        gsap.to(v.flashOverlay, { alpha: 0, duration: 0.22, ease: 'power2.out' })
    }

    private createHpBar(width = 52, offsetY = -50) {
        const container = new Container()
        container.position.set(-width / 2, offsetY)
        const bg = new Graphics()
        bg.roundRect(0, 0, width, 7, 3).fill({ color: 0x1c1917, alpha: 0.75 })
        container.addChild(bg)
        const fill = new Graphics()
        fill.roundRect(0, 0, width, 7, 3).fill({ color: 0x4ade80 })
        container.addChild(fill)
        return { container, fill, width }
    }

    private updateEnemyHpBar(enemy: Enemy) {
        const frac = Math.max(0, enemy.hp / enemy.maxHp)
        enemy.hpBarFill.clear()
        enemy.hpBarFill.roundRect(0, 0, enemy.hpBarWidth * frac, 7, 3)
            .fill({ color: frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfbbf24 : 0xef4444 })
    }

    /**
     * Floating combat text. Popups aimed at the same target stack into "lanes"
     * so rapid multi-cannon volleys stay readable instead of piling onto the
     * exact same pixel.
     */
    private spawnDamagePopup(laneKey: string, x: number, y: number, text: string, color: number, crit: boolean) {
        const lane = this.popupLanes.get(laneKey) ?? 0
        this.popupLanes.set(laneKey, lane + 1)
        gsap.delayedCall(0.45, () => {
            const cur = this.popupLanes.get(laneKey) ?? 0
            this.popupLanes.set(laneKey, Math.max(0, cur - 1))
        })

        const laneOffsetY = -lane * 22
        const laneOffsetX = lane % 2 === 0 ? 0 : (lane % 4 === 1 ? 18 : -18)

        const label = new Text({
            text,
            style: {
                fill: color,
                fontFamily: 'Inter, ui-sans-serif, system-ui',
                fontSize: crit ? 26 : text === 'MISS' ? 17 : 20,
                fontWeight: '900',
                stroke: { color: 0x111827, width: 4 },
                dropShadow: { color, blur: 8, distance: 0, alpha: 0.85 }
            }
        })
        label.anchor.set(0.5)
        label.position.set(x + laneOffsetX + (Math.random() - 0.5) * 8, y + laneOffsetY)
        label.scale.set(0.5)
        this.effectsLayer.addChild(label)
        const drift = (Math.random() - 0.5) * 20
        gsap.to(label.scale, { x: 1, y: 1, duration: 0.16, ease: 'back.out(3)' })
        gsap.to(label.position, { x: label.x + drift, y: label.y - 56, duration: 0.75, ease: 'power2.out' })
        gsap.to(label, { alpha: 0, duration: 0.22, delay: 0.52, ease: 'power2.in', onComplete: () => label.destroy() })
    }

    private spawnSplash(x: number, y: number) {
        for (let i = 0; i < 6; i++) {
            const p = new Graphics()
            p.circle(0, 0, 2 + Math.random() * 2).fill({ color: 0xdbeafe, alpha: 0.8 })
            p.position.set(x, y)
            this.effectsLayer.addChild(p)
            const ang = Math.random() * Math.PI * 2
            const r = 18 + Math.random() * 22
            gsap.to(p.position, { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r, duration: 0.4, ease: 'power2.out' })
            gsap.to(p, { alpha: 0, duration: 0.4, ease: 'power2.in', onComplete: () => p.destroy() })
        }
        const ring = new Graphics()
        ring.circle(0, 0, 8).stroke({ width: 2, color: 0xbfdbfe, alpha: 0.7 })
        ring.position.set(x, y)
        this.effectsLayer.addChild(ring)
        gsap.to(ring.scale, { x: 3, y: 3, duration: 0.5, ease: 'power2.out' })
        gsap.to(ring, { alpha: 0, duration: 0.5, ease: 'power2.out', onComplete: () => ring.destroy() })
    }

    private spawnExplosion(x: number, y: number, color: number, big: boolean) {
        const count = big ? 10 : 6
        for (let i = 0; i < count; i++) {
            const p = new Graphics()
            p.circle(0, 0, big ? 3 + Math.random() * 3 : 2 + Math.random() * 2).fill({ color, alpha: 0.9 })
            p.position.set(x, y)
            this.effectsLayer.addChild(p)
            const ang = Math.random() * Math.PI * 2
            const r = (big ? 30 : 20) + Math.random() * 26
            gsap.to(p.position, { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r - 10, duration: 0.45, ease: 'power3.out' })
            gsap.to(p, { alpha: 0, duration: 0.45, ease: 'power2.in', onComplete: () => p.destroy() })
        }
        const flash = new Graphics()
        flash.circle(0, 0, big ? 18 : 12).fill({ color: 0xffffff, alpha: 0.85 })
        flash.position.set(x, y)
        this.effectsLayer.addChild(flash)
        gsap.to(flash.scale, { x: 1.8, y: 1.8, duration: 0.18, ease: 'power2.out' })
        gsap.to(flash, { alpha: 0, duration: 0.18, ease: 'power2.out', onComplete: () => flash.destroy() })
    }

    private spawnMuzzleFlash(x: number, y: number, angle: number, kind: AmmoKind | 'enemy', cannonColor?: number) {
        const color = cannonColor ?? (kind === 'gem' ? 0x7dd3fc : 0xfcd34d)
        const flash = new Graphics()
        flash.poly([0, 0, 16, -5, 20, 0, 16, 5]).fill({ color, alpha: 0.95 })
        flash.position.set(x, y)
        flash.rotation = angle
        this.effectsLayer.addChild(flash)
        gsap.to(flash, { alpha: 0, duration: 0.14, ease: 'power2.out', onComplete: () => flash.destroy() })

        for (let i = 0; i < 3; i++) {
            const smoke = new Graphics()
            smoke.circle(0, 0, randRange(3, 5)).fill({ color: cannonColor ?? (kind === 'gem' ? 0xbae6fd : 0x9ca3af), alpha: cannonColor ? 0.38 : 0.5 })
            smoke.position.set(x, y)
            this.effectsLayer.addChild(smoke)
            const sAng = angle + randRange(-0.5, 0.5)
            gsap.to(smoke.position, {
                x: x + Math.cos(sAng) * randRange(12, 26),
                y: y + Math.sin(sAng) * randRange(12, 26) - 6,
                duration: 0.55,
                ease: 'power2.out'
            })
            gsap.to(smoke.scale, { x: 2, y: 2, duration: 0.55, ease: 'power1.out' })
            gsap.to(smoke, { alpha: 0, duration: 0.55, ease: 'power1.in', onComplete: () => smoke.destroy() })
        }
    }

    private spawnTrailParticle(x: number, y: number, color: number, scale = 1, alpha = 0.85) {
        const p = new Graphics()
        p.circle(0, 0, randRange(1.5, 3) * scale).fill({ color, alpha })
        p.position.set(x + randRange(-3, 3), y + randRange(-3, 3))
        this.effectsLayer.addChild(p)
        gsap.to(p.scale, { x: 0.2, y: 0.2, duration: 0.4, ease: 'power1.in' })
        gsap.to(p, { alpha: 0, duration: 0.4, ease: 'power1.in', onComplete: () => p.destroy() })
    }

    private spawnPowerUpBurst(x: number, y: number, color: number) {
        for (let i = 0; i < 16; i++) {
            const p = new Graphics()
            p.star(0, 0, 4, randRange(3, 6), randRange(1, 2)).fill({ color, alpha: 0.95 })
            p.position.set(x, y)
            this.effectsLayer.addChild(p)
            const angle = (i / 16) * Math.PI * 2 + randRange(-0.1, 0.1)
            const radius = randRange(35, 75)
            gsap.to(p.position, { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius, duration: 0.55, ease: 'power3.out' })
            gsap.to(p, { alpha: 0, rotation: Math.PI, duration: 0.55, ease: 'power2.in', onComplete: () => p.destroy() })
        }
        this.shake(5)
    }

    private spawnShieldImpact(absorbed: number) {
        const shield = new Graphics()
        shield.circle(0, 0, 43).fill({ color: 0x22d3ee, alpha: 0.13 })
        shield.circle(0, 0, 43).stroke({ width: 4, color: 0x67e8f9, alpha: 0.9 })
        shield.position.set(this.playerX, this.playerY)
        this.effectsLayer.addChild(shield)
        gsap.fromTo(shield.scale, { x: 0.75, y: 0.75 }, { x: 1.25 + absorbed / 50, y: 1.25 + absorbed / 50, duration: 0.25, ease: 'power2.out' })
        gsap.to(shield, { alpha: 0, duration: 0.35, ease: 'power2.out', onComplete: () => shield.destroy() })
    }

    private spawnWake(x: number, y: number, angle: number) {
        const wake = new Graphics()
        wake.ellipse(0, 0, 7, 3.5).fill({ color: 0xdbeafe, alpha: 0.35 })
        wake.position.set(x - Math.cos(angle) * 30, y - Math.sin(angle) * 30)
        wake.rotation = angle
        this.effectsLayer.addChild(wake)
        gsap.to(wake.scale, { x: 2.4, y: 2, duration: 1, ease: 'power1.out' })
        gsap.to(wake, { alpha: 0, duration: 1, ease: 'power1.out', onComplete: () => wake.destroy() })
    }

    private spawnMoveMarker(x: number, y: number) {
        const marker = new Graphics()
        marker.circle(0, 0, 12).stroke({ width: 2.5, color: 0xfef08a, alpha: 0.9 })
        marker.circle(0, 0, 3).fill({ color: 0xfef08a, alpha: 0.9 })
        marker.position.set(x, y)
        this.effectsLayer.addChild(marker)
        gsap.from(marker.scale, { x: 2, y: 2, duration: 0.3, ease: 'power2.out' })
        gsap.to(marker, { alpha: 0, duration: 0.5, delay: 0.2, ease: 'power2.in', onComplete: () => marker.destroy() })
    }

    private spawnSinkBubbles(x: number, y: number) {
        for (let i = 0; i < 8; i++) {
            const b = new Graphics()
            b.circle(0, 0, randRange(1.5, 3.5)).stroke({ width: 1.2, color: 0xe0f2fe, alpha: 0.8 })
            b.position.set(x + randRange(-18, 18), y + randRange(-10, 10))
            this.effectsLayer.addChild(b)
            gsap.to(b.position, { y: b.position.y - randRange(10, 24), duration: randRange(0.6, 1.1), ease: 'power1.out', delay: i * 0.06 })
            gsap.to(b, { alpha: 0, duration: randRange(0.6, 1.1), delay: i * 0.06, ease: 'power1.in', onComplete: () => b.destroy() })
        }
    }

    private shake(amount: number) {
        gsap.killTweensOf(this.world.position)
        const timeline = gsap.timeline({ onComplete: () => this.world.position.set(0, 0) })
        for (let i = 0; i < 4; i++) {
            timeline.to(this.world.position, {
                x: (Math.random() - 0.5) * amount,
                y: (Math.random() - 0.5) * amount,
                duration: 0.045
            })
        }
        timeline.to(this.world.position, { x: 0, y: 0, duration: 0.05 })
    }

    private clearEntities() {
        for (const enemy of this.enemies.values()) {
            gsap.killTweensOf(enemy.root.scale)
            gsap.killTweensOf(enemy.root)
            gsap.killTweensOf(enemy.visual.body)
            gsap.killTweensOf(enemy.visual.body.scale)
            gsap.killTweensOf(enemy.visual.body.position)
            enemy.root.destroy({ children: true })
        }
        this.enemies.clear()
        if (this.treasure) {
            gsap.killTweensOf(this.treasure.root)
            this.treasure.root.destroy({ children: true })
            this.treasure = null
        }
        for (const pickup of this.powerUpPickups) {
            gsap.killTweensOf(pickup.root)
            pickup.root.destroy({ children: true })
        }
        this.powerUpPickups = []
        for (const pack of this.healthPackPickups) {
            gsap.killTweensOf(pack.root)
            pack.root.destroy({ children: true })
        }
        this.healthPackPickups = []
        for (const mine of this.seaMines) {
            gsap.killTweensOf(mine.root)
            gsap.killTweensOf(mine.root.children)
            mine.root.destroy({ children: true })
        }
        this.seaMines = []
        this.effectsLayer.removeChildren().forEach(c => c.destroy({ children: true }))
        this.popupLanes.clear()
        gsap.killTweensOf(this.world.position)
        this.world.position.set(0, 0)
    }

    private endGame(survived: boolean, reason: 'timeout' | 'defeat' | 'cancelled') {
        if (!this.running) return
        this.running = false
        this.activePowerUps.clear()
        this.powerUpStacks.clear()
        this.syncRoguePowerVisuals()
        this.shieldHp = 0
        this.emitPowerUpState()
        this.attackTargetId = null
        this.playerPath = []
        if (!survived && reason === 'defeat') {
            const v = this.player
            this.spawnExplosion(this.playerX, this.playerY, 0xef4444, true)
            this.spawnSinkBubbles(this.playerX, this.playerY)
            gsap.to(v.body, { rotation: 0.8, duration: 1.1, ease: 'power1.in' })
            gsap.to(v.body.scale, { x: 0.45, y: 0.45, duration: 1.15, ease: 'power2.in' })
            gsap.to(v.body, { alpha: 0.1, duration: 1.15, ease: 'power2.in' })
            this.spawnSplash(this.playerX, this.playerY)
        }
        const hullDamageFraction = reason === 'defeat'
            ? 1
            : Math.min(1, Math.max(0, 1 - this.playerHp / this.stats.maxHp))

        this.callbacks.onGameOver({
            survived,
            coins: this.coins,
            elapsedMs: this.elapsedMs,
            ammoUsed: this.ammoStart - this.ammo,
            gemAmmoUsed: this.gemAmmoStart - this.gemAmmo,
            kills: this.kills,
            shotsFired: this.shotsFired,
            abilitiesUsed: this.abilitiesUsed,
            sunkByType: [...this.sunkByType.entries()]
                .map(([id, value]) => ({ id, ...value }))
                .sort((a, b) => b.count - a.count),
            maxCombo: this.maxCombo,
            reason,
            hullDamageFraction
        })
    }
}
