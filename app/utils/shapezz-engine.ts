import {
    SHAPEZZ_BOMBER_BLAST_RADIUS,
    SHAPEZZ_BOSSES,
    SHAPEZZ_BULLET_PRIORITY,
    SHAPEZZ_CHECKPOINT_MS,
    SHAPEZZ_COMBAT_LIMITS,
    SHAPEZZ_ELITE,
    SHAPEZZ_ENEMIES,
    SHAPEZZ_RUN_UPGRADES,
    SHAPEZZ_SPLITTER_SHARDS,
    SHAPEZZ_TURRET_DAMAGE_MULTIPLIER,
    SHAPEZZ_WARDEN_AURA_RADIUS,
    SHAPEZZ_WARDEN_DAMAGE_TAKEN,
    shapezzBlackHoleStats,
    shapezzBossEscort,
    shapezzBossForCheckpoint,
    shapezzBossHealthScale,
    shapezzCheckpointPressure,
    shapezzCritStats,
    shapezzDifficulty,
    shapezzEliteChance,
    shapezzEnemyCoinValue,
    shapezzEnemyHealthMultiplier,
    shapezzEnemyMix,
    shapezzExecutionThreshold,
    shapezzExplosionDamageMultiplier,
    shapezzHyperVelocityDamage,
    shapezzIntensity,
    shapezzKillShockwaveStats,
    shapezzOverkillDividendStats,
    shapezzPrismLanceStats,
    shapezzRollPlatforms,
    shapezzShieldStats,
    shapezzVampireBurstStats,
    shapezzWeaponFireRateCap,
    type ShapezzBossKind,
    type ShapezzBulletPriority,
    type ShapezzDifficultyId,
    type ShapezzEnemyType,
    type ShapezzRunUpgradeId,
    type ShapezzWeapon
} from '#shared/utils/gamelogic/shapezz'
import type { ShapezzAutopilotView } from '#shared/utils/gamelogic/shapezz-autopilot'
import { randomChance, randomFloat, randomPick } from '#shared/utils/random'
import type { ShapezzSoundEvent, ShapezzSoundOptions } from '~/utils/shapezz-sounds'
import { ShapezzRenderer } from './shapezz/render'
import {
    FLOOR_Y, GRAVITY, HEIGHT, WIDTH, COIN_COLOR,
    angleDelta, clamp, distance, distanceSquared, distanceToSegmentSquared, jitter, normalized,
    type Beam, type Bullet, type DamageSource, type DamageText, type Debris, type Enemy, type EnemyBullet,
    type EnemyBulletShape, type Lance, type Laser, type Particle, type ParticleKind, type Pickup,
    type Platform, type Player, type Point, type Shockwave, type Singularity, type Turret, type Warning
} from './shapezz/world'

const COIN_GRAVITY = 1100
const ENEMY_GRID_SIZE = 160
const ENEMY_GRID_COLUMNS = 10
const ENEMY_GRID_ROWS = 6
const MAX_ENEMY_RADIUS = 110
const JUMP_RELEASE_MULTIPLIER = 0.45
const COMBO_MILESTONE = 25
/** Sources that can roll an Overcharge crit: direct shots, not splash or auras. */
const CRIT_SOURCES = new Set<DamageSource>(['weapon', 'ceiling', 'orbital', 'drone', 'turret', 'splitstorm', 'nova', 'lance', 'chain'])

export interface ShapezzPlayerStats {
    maxHp: number
    damage: number
    fireRate: number
    moveSpeed: number
    jumpSpeed: number
    magnetRange: number
    healthPerKill: number
}

export interface ShapezzSnapshot {
    hp: number
    maxHp: number
    shield: number
    shieldCapacity: number
    coins: number
    kills: number
    elapsedMs: number
    checkpoint: number
    combo: number
    upgrades: Partial<Record<ShapezzRunUpgradeId, number>>
}

/** What the auto-pilot holds down this frame, in place of the keyboard and mouse. */
export interface ShapezzAutopilotInput {
    move: -1 | 0 | 1
    jump: boolean
    drop: boolean
    aimX: number
    aimY: number
    fire: boolean
}

export interface ShapezzEngineCallbacks {
    onHud: (snapshot: ShapezzSnapshot) => void
    onCheckpoint: (offers: ShapezzRunUpgradeId[], snapshot: ShapezzSnapshot) => void
    onBoss: (name: string, title: string) => void
    onGameOver: (snapshot: ShapezzSnapshot) => void
    /** Fired at every audible game moment — playback throttles per-event. */
    onSfx?: (event: ShapezzSoundEvent, options?: ShapezzSoundOptions) => void
    /** Fired when the pause state changes (button or P/Escape key). */
    onPause?: (paused: boolean) => void
    /** HUD frame rate readout, sampled from the render-quality averager. */
    onFps?: (fps: number) => void
}

/** Run telemetry for the balance playtest. */
export interface ShapezzCombatStats {
    elapsedMs: number
    kills: number
    coins: number
    maxCombo: number
    bossesKilled: number
    damageBySource: Partial<Record<DamageSource, number>>
    damageTakenByCause: Record<string, number>
    deathCause: string | null
    upgrades: Partial<Record<ShapezzRunUpgradeId, number>>
}

interface Scheduled {
    delay: number
    ownerId: number
    action: () => void
}

/** Boss attacks. Each boss cycles through its own list. */
type BossAttack =
    | 'ring' | 'spiral' | 'summon'
    | 'lasers' | 'shards' | 'blink'
    | 'brood' | 'missiles' | 'rain'
    | 'charge' | 'hell' | 'slam'

const BOSS_ATTACKS: Record<ShapezzBossKind, BossAttack[]> = {
    overseer: ['ring', 'spiral', 'ring', 'summon'],
    prism: ['lasers', 'shards', 'blink', 'shards'],
    hive: ['brood', 'missiles', 'rain', 'missiles'],
    polygon: ['charge', 'hell', 'slam', 'charge', 'rain']
}

/** Gameplay randomness (spawns, timings, boss patterns) comes from the shared RNG; `jitter` is for looks only. */
function roll(min: number, max: number) {
    return min + randomFloat() * (max - min)
}

function pan(x: number) {
    return clamp((x - WIDTH / 2) / (WIDTH / 2), -1, 1) * 0.75
}

export class ShapezzEngine {
    // ─── World state (read by ShapezzRenderer) ──────────────────────────────
    readonly stats: ShapezzPlayerStats
    readonly weapon: ShapezzWeapon
    readonly difficultyId: ShapezzDifficultyId
    player: Player
    aim = { x: WIDTH * 0.75, y: HEIGHT * 0.45 }
    aimVisible = false
    firing = false
    running = false
    paused = false
    elapsedMs = 0
    combo = 0
    trauma = 0
    flash = 0
    flashColor = '#ffffff'
    /** 0-1 blend of the boss colour into the arena lighting. */
    bossTint = 0
    bossTintColor = '#e879f9'
    upgrades: Partial<Record<ShapezzRunUpgradeId, number>> = {}
    enemies: Enemy[] = []
    bullets: Bullet[] = []
    enemyBullets: EnemyBullet[] = []
    particles: Particle[] = []
    debris: Debris[] = []
    shockwaves: Shockwave[] = []
    beams: Beam[] = []
    damageTexts: DamageText[] = []
    pickups: Pickup[] = []
    singularities: Singularity[] = []
    turrets: Turret[] = []
    lasers: Laser[] = []
    warnings: Warning[] = []
    lances: Lance[] = []
    /** A fresh ledge layout every run. The floor stays at index 0 (slams and the renderer rely on it). */
    readonly platforms: Platform[] = [
        { x: 0, y: FLOOR_Y, width: WIDTH, height: HEIGHT - FLOOR_Y, glow: 0 },
        ...shapezzRollPlatforms().map(platform => ({ ...platform, glow: 0 }))
    ]

    // ─── Internals ───────────────────────────────────────────────────────────
    private canvas: HTMLCanvasElement | null
    private renderer: ShapezzRenderer | null = null
    private callbacks: ShapezzEngineCallbacks
    private keys = new Set<string>()
    private autopilotInput: ShapezzAutopilotInput | null = null
    private frameHook: ((dt: number) => void) | null = null
    private dropThroughTimer = 0
    private checkpointOpen = false
    private destroyed = false
    private raf = 0
    private lastFrame = 0
    private nextCheckpointMs = SHAPEZZ_CHECKPOINT_MS
    private spawnCooldown = 0.15
    private fireCooldown = 0
    private orbitalCooldown = 0
    private droneCooldown = 0
    private ceilingBatteryCooldown = 0
    private blackHoleCooldown = 1.5
    private lanceCooldown = 1
    private bossCheckpoint = 0
    private kills = 0
    private bossesKilled = 0
    private vampireKills = 0
    private vampireCooldown = 0
    private vampireRegenRemaining = 0
    private vampireRegenRate = 0
    private shieldKills = 0
    private coins = 0
    private maxCombo = 0
    private comboTimer = 0
    private nextComboMilestone = COMBO_MILESTONE
    private lastHudAt = 0
    private enemyId = 1
    private hitStop = 0
    private timeScale = 1
    private wasOnGround = false
    private scheduled: Scheduled[] = []
    private enemyGrid = new Map<number, Enemy[]>()
    /** Live (not evicted) player bullets. Evicted ones sit at life <= 0 until the next sweep. */
    private liveBullets = 0
    private evictCursor = [0, 0, 0]
    private damageBySource: Partial<Record<DamageSource, number>> = {}
    private damageTakenByCause: Record<string, number> = {}
    private deathCause: string | null = null

    private keydown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase()
        if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) event.preventDefault()
        this.keys.add(key)
        if (key === 'p' || key === 'escape') this.togglePause()
        if ((key === ' ' || key === 'w' || key === 'arrowup') && this.running && !this.paused && this.player.onGround) this.jump()
        if ((key === 's' || key === 'arrowdown') && this.running && !this.paused && this.player.onGround) this.dropThroughPlatform()
    }

    private keyup = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase()
        this.keys.delete(key)
        const releasedVariableJump = key === ' ' || key === 'w'
        const jumpStillHeld = this.keys.has(' ') || this.keys.has('w')
        if (releasedVariableJump && !jumpStillHeld && this.running && !this.paused && this.player.vy < 0) {
            this.player.vy *= JUMP_RELEASE_MULTIPLIER
        }
    }

    // Without this, enemies keep attacking while the player has no input.
    // Auto-play is input, so it keeps flying when the window loses focus.
    private windowBlur = () => {
        this.keys.clear()
        if (this.autopilotInput) return
        this.firing = false
        if (this.running && !this.paused) this.togglePause()
    }

    private pointermove = (event: PointerEvent) => {
        if (!this.canvas) return
        const rect = this.canvas.getBoundingClientRect()
        this.aim.x = (event.clientX - rect.left) / rect.width * WIDTH
        this.aim.y = (event.clientY - rect.top) / rect.height * HEIGHT
        this.aimVisible = event.pointerType !== 'touch'
    }

    private pointerleave = () => {
        this.aimVisible = false
    }

    private pointerdown = (event: PointerEvent) => {
        if (event.button !== 0) return
        this.firing = true
        this.pointermove(event)
    }

    private pointerup = (event: PointerEvent) => {
        if (event.button === 0) this.firing = false
    }

    private preventContextMenu = (event: Event) => event.preventDefault()

    /** Pass `null` for the canvas to run headless (the balance playtest drives `step()` itself). */
    constructor(canvas: HTMLCanvasElement | null, stats: ShapezzPlayerStats, weapon: ShapezzWeapon, difficultyId: ShapezzDifficultyId, callbacks: ShapezzEngineCallbacks) {
        this.canvas = canvas
        this.stats = stats
        this.weapon = weapon
        this.difficultyId = difficultyId
        this.callbacks = callbacks
        this.player = {
            x: WIDTH / 2, y: FLOOR_Y - 50, vx: 0, vy: 0, size: 36, hp: stats.maxHp, shield: 0, onGround: false,
            invulnerable: 0, scaleX: 1, scaleY: 1, recoil: 0, muzzleFlash: 0, hurtFlash: 0
        }
        if (!canvas) return
        this.renderer = new ShapezzRenderer(canvas, this, fps => this.callbacks.onFps?.(fps))
        window.addEventListener('keydown', this.keydown, { passive: false })
        window.addEventListener('keyup', this.keyup)
        window.addEventListener('pointerup', this.pointerup)
        window.addEventListener('blur', this.windowBlur)
        canvas.addEventListener('pointermove', this.pointermove)
        canvas.addEventListener('pointerleave', this.pointerleave)
        canvas.addEventListener('pointerdown', this.pointerdown)
        canvas.addEventListener('contextmenu', this.preventContextMenu)
        this.raf = requestAnimationFrame(this.frame)
    }

    start() {
        this.running = true
        this.lastFrame = performance.now()
        this.callbacks.onHud(this.snapshot())
    }

    destroy() {
        this.destroyed = true
        this.running = false
        cancelAnimationFrame(this.raf)
        this.renderer?.destroy()
        if (!this.canvas) return
        window.removeEventListener('keydown', this.keydown)
        window.removeEventListener('keyup', this.keyup)
        window.removeEventListener('pointerup', this.pointerup)
        window.removeEventListener('blur', this.windowBlur)
        this.canvas.removeEventListener('pointermove', this.pointermove)
        this.canvas.removeEventListener('pointerleave', this.pointerleave)
        this.canvas.removeEventListener('pointerdown', this.pointerdown)
        this.canvas.removeEventListener('contextmenu', this.preventContextMenu)
    }

    chooseUpgrade(id: ShapezzRunUpgradeId) {
        if (!this.checkpointOpen) return
        this.upgrades[id] = (this.upgrades[id] ?? 0) + 1
        this.checkpointOpen = false
        this.running = true
        this.flash = 0.65
        this.flashColor = '#ffffff'
        const accent = SHAPEZZ_RUN_UPGRADES.find(upgrade => upgrade.id === id)?.accent ?? '#ffffff'
        this.ring(this.player.x, this.player.y, 330, '#ffffff', 0.65, 8, true)
        this.ring(this.player.x, this.player.y, 220, accent, 0.5, 5)
        this.burst(this.player.x, this.player.y, accent, 55, 520)
        this.sparks(this.player.x, this.player.y, accent, 30, 700)
        this.callbacks.onHud(this.snapshot())
    }

    getSnapshot() {
        return this.snapshot()
    }

    getCombatStats(): ShapezzCombatStats {
        return {
            elapsedMs: this.elapsedMs,
            kills: this.kills,
            coins: this.coins,
            maxCombo: this.maxCombo,
            bossesKilled: this.bossesKilled,
            damageBySource: { ...this.damageBySource },
            damageTakenByCause: { ...this.damageTakenByCause },
            deathCause: this.deathCause,
            upgrades: { ...this.upgrades }
        }
    }

    get isCheckpointOpen() {
        return this.checkpointOpen
    }

    // ─── Auto-pilot ─────────────────────────────────────────────────────────

    /** Called at the start of every simulated frame while a run is live. */
    setFrameHook(hook: ((dt: number) => void) | null) {
        this.frameHook = hook
    }

    /** Take over movement, aim and trigger; null hands them back to the player. */
    setAutopilotInput(input: ShapezzAutopilotInput | null) {
        this.autopilotInput = input
        if (!input) this.firing = false
    }

    private applyAutopilotInput() {
        const pilot = this.autopilotInput
        if (!pilot) return
        this.aim.x = pilot.aimX
        this.aim.y = pilot.aimY
        this.aimVisible = true
        this.firing = pilot.fire
        if (pilot.jump && this.player.onGround) this.jump()
        if (pilot.drop && this.player.onGround) this.dropThroughPlatform()
    }

    /** The arena as the auto-pilot sees it. */
    autopilotView(): ShapezzAutopilotView {
        return {
            elapsedMs: this.elapsedMs,
            checkpoint: Math.floor(this.elapsedMs / SHAPEZZ_CHECKPOINT_MS),
            player: { x: this.player.x, y: this.player.y, vx: this.player.vx, vy: this.player.vy, size: this.player.size, onGround: this.player.onGround },
            hp: Math.max(0, this.player.hp),
            maxHp: this.stats.maxHp,
            shield: Math.max(0, this.player.shield),
            moveSpeed: this.stats.moveSpeed,
            jumpSpeed: this.stats.jumpSpeed,
            weapon: {
                type: this.weapon.type,
                bulletSpeed: this.playerBulletSpeed(),
                chainRange: this.weapon.chainRange,
                explosionRadius: this.weapon.explosionRadius
            },
            bulletTime: this.upgrades.bulletTime ?? 0,
            enemies: this.enemies.filter(enemy => enemy.hp > 0).map(enemy => ({
                id: enemy.id, type: enemy.type, x: enemy.x, y: enemy.y, vx: enemy.vx, vy: enemy.vy,
                radius: enemy.radius, hp: enemy.hp / Math.max(1, enemy.maxHp), damage: enemy.damage, speed: enemy.speed
            })),
            bullets: this.enemyBullets.map(({ x, y, vx, vy, radius, damage }) => ({ x, y, vx, vy, radius, damage })),
            pickups: this.pickups.map(({ x, y, kind, value }) => ({ x, y, kind, value })),
            platforms: this.platforms.filter(platform => platform.y < FLOOR_Y).map(({ x, y, width }) => ({ x, y, width })),
            upgrades: { ...this.upgrades }
        }
    }

    /** Freeze/unfreeze the simulation. No-op outside a live run (checkpoint, game over). */
    togglePause() {
        if (!this.running) return
        this.paused = !this.paused
        this.callbacks.onPause?.(this.paused)
    }

    // ─── Loop ───────────────────────────────────────────────────────────────

    private frame = (now: number) => {
        if (this.destroyed) return
        const frameInterval = now - (this.lastFrame || now)
        const dt = Math.min(0.033, Math.max(0, frameInterval / 1000))
        this.lastFrame = now
        const workStartedAt = performance.now()
        if (this.running && !this.paused) this.step(dt)
        else if (!this.paused) this.updateEffects(dt)
        this.renderer?.render(now / 1000)
        if (this.running && !this.paused) this.renderer?.updateQuality(frameInterval, performance.now() - workStartedAt)
        this.raf = requestAnimationFrame(this.frame)
    }

    /** Advance one frame of real time. Public so a headless playtest can drive the simulation. */
    step(dt: number) {
        if (!this.running) return
        // Hit-stop: a few frozen frames sell a heavy kill. Effects keep drifting slowly.
        if (this.hitStop > 0) {
            this.hitStop -= dt
            this.updateEffects(dt * 0.2)
            return
        }
        this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 1.8)
        this.update(dt * this.timeScale)
    }

    private snapshot(): ShapezzSnapshot {
        return {
            hp: Math.max(0, this.player.hp),
            maxHp: this.stats.maxHp,
            shield: Math.max(0, this.player.shield),
            shieldCapacity: this.upgrades.aegisPlating ? shapezzShieldStats(this.upgrades.aegisPlating).capacity : 0,
            coins: this.coins,
            kills: this.kills,
            elapsedMs: this.elapsedMs,
            checkpoint: Math.floor(this.elapsedMs / SHAPEZZ_CHECKPOINT_MS),
            combo: this.combo,
            upgrades: { ...this.upgrades }
        }
    }

    private get checkpoint() {
        return Math.floor(this.elapsedMs / SHAPEZZ_CHECKPOINT_MS)
    }

    private sfx(event: ShapezzSoundEvent, x?: number, options?: ShapezzSoundOptions) {
        if (!this.callbacks.onSfx) return
        this.callbacks.onSfx(event, x === undefined ? options : { ...options, pan: pan(x) })
    }

    private update(dt: number) {
        this.frameHook?.(dt)
        this.applyAutopilotInput()
        this.elapsedMs += dt * 1000
        this.fireCooldown -= dt
        this.orbitalCooldown -= dt
        this.droneCooldown -= dt
        this.ceilingBatteryCooldown -= dt
        this.blackHoleCooldown -= dt
        this.lanceCooldown -= dt
        this.spawnCooldown -= dt
        this.comboTimer -= dt
        this.player.invulnerable -= dt
        this.vampireCooldown -= dt

        if (this.vampireRegenRemaining > 0) {
            const tick = Math.min(dt, this.vampireRegenRemaining)
            this.vampireRegenRemaining -= tick
            this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.vampireRegenRate * tick)
            if (Math.random() < dt * 20) this.particle('glow', this.player.x + jitter(-20, 20), this.player.y + jitter(-10, 20), 0, jitter(-80, -40), 0.5, 10, '#34d399', 0, 1, 0.4)
        }

        if (this.comboTimer <= 0) {
            this.combo = 0
            this.nextComboMilestone = COMBO_MILESTONE
        }
        this.updatePlayer(dt)
        this.updateSpawning(dt)
        this.updateScheduled(dt)
        this.updateEnemies(dt)
        this.updateLasers(dt)
        this.updateBullets(dt)
        this.updateEnemyBullets(dt)
        this.updatePickups(dt)
        this.updateCompanions(dt)
        this.updateSingularities(dt)
        this.updateEffects(dt)

        if (this.firing && this.fireCooldown <= 0) {
            const fired = this.fireWeapon()
            const requestedFireRate = this.stats.fireRate * this.weapon.fireRateMultiplier * this.frenzyMultiplier()
            const fireRateCap = shapezzWeaponFireRateCap(this.weapon.type)
            // A dry arc-coil trigger (nothing in reach) retries quickly instead of eating a full cooldown.
            this.fireCooldown = fired ? 1 / Math.min(fireRateCap, requestedFireRate) : 0.05
        }

        const boss = this.enemies.find(enemy => enemy.boss)
        this.bossTint += ((boss ? 1 : 0) - this.bossTint) * Math.min(1, dt * 1.5)
        if (boss) this.bossTintColor = boss.color

        if (this.elapsedMs >= this.nextCheckpointMs) {
            this.nextCheckpointMs += SHAPEZZ_CHECKPOINT_MS
            this.openCheckpoint()
        }

        if (this.player.hp <= 0 && this.running) {
            this.running = false
            this.flash = 1
            this.flashColor = '#ffffff'
            this.trauma = 1
            this.explosion(this.player.x, this.player.y, 160, '#67e8f9', true)
            this.burst(this.player.x, this.player.y, '#ffffff', 120, 760)
            this.shatter(this.player.x, this.player.y, 30, '#ecfeff', 24, 620)
            this.sfx('player-death')
            this.callbacks.onGameOver(this.snapshot())
        }

        if (this.elapsedMs - this.lastHudAt >= 90) {
            this.lastHudAt = this.elapsedMs
            this.callbacks.onHud(this.snapshot())
        }
    }

    private frenzyMultiplier() {
        const frenzy = Math.min(3, this.upgrades.frenzy ?? 0)
        return this.combo > 0 && frenzy > 0 ? 2 + (frenzy - 1) * 0.35 : 1
    }

    // ─── Player ─────────────────────────────────────────────────────────────

    private updatePlayer(dt: number) {
        const pilot = this.autopilotInput
        const left = pilot ? pilot.move < 0 : this.keys.has('a') || this.keys.has('arrowleft')
        const right = pilot ? pilot.move > 0 : this.keys.has('d') || this.keys.has('arrowright')
        this.dropThroughTimer = Math.max(0, this.dropThroughTimer - dt)
        // Holding down keeps every elevated platform pass-through, so the player falls all the way
        // to the floor. The timer only covers a tap that is released before the next frame.
        const dropping = this.dropThroughTimer > 0 || (pilot ? pilot.drop : this.keys.has('s') || this.keys.has('arrowdown'))
        const targetVx = (Number(right) - Number(left)) * this.stats.moveSpeed
        const acceleration = this.player.onGround ? 16 : 8
        const player = this.player
        player.vx += (targetVx - player.vx) * Math.min(1, dt * acceleration)
        player.vy += GRAVITY * dt

        const previousBottom = player.y + player.size / 2
        const fallSpeed = player.vy
        player.x += player.vx * dt
        player.y += player.vy * dt
        player.x = clamp(player.x, player.size / 2, WIDTH - player.size / 2)
        player.onGround = false

        const bottom = player.y + player.size / 2
        for (const platform of this.platforms) {
            if (dropping && platform.y < FLOOR_Y) continue
            const withinX = player.x + player.size * 0.35 > platform.x && player.x - player.size * 0.35 < platform.x + platform.width
            if (withinX && player.vy >= 0 && previousBottom <= platform.y + 4 && bottom >= platform.y) {
                player.y = platform.y - player.size / 2
                player.vy = 0
                player.onGround = true
                if (!this.wasOnGround && fallSpeed > 380) {
                    const impact = clamp((fallSpeed - 380) / 900, 0, 1)
                    player.scaleX = 1 + 0.35 * impact + 0.1
                    player.scaleY = 1 - 0.3 * impact - 0.08
                    platform.glow = Math.max(platform.glow, 0.4 + impact * 0.6)
                    this.dust(player.x, platform.y, 6 + Math.round(impact * 10))
                    this.sfx('land', player.x, { volume: 0.4 + impact * 0.6 })
                }
                break
            }
        }
        this.wasOnGround = player.onGround

        if (player.y > HEIGHT + 100) {
            player.y = 100
            player.x = WIDTH / 2
            this.damagePlayer(this.stats.maxHp * 0.2, 'fall')
        }

        // Squash and stretch spring back toward a square cube; stretch with vertical speed in the air.
        const airStretch = player.onGround ? 0 : clamp(Math.abs(player.vy) / 2200, 0, 0.16)
        const targetY = 1 + airStretch
        const targetX = 1 - airStretch * 0.8
        player.scaleX += (targetX - player.scaleX) * Math.min(1, dt * 14)
        player.scaleY += (targetY - player.scaleY) * Math.min(1, dt * 14)
        player.recoil = Math.max(0, player.recoil - dt * 9)
        player.muzzleFlash = Math.max(0, player.muzzleFlash - dt)
        player.hurtFlash = Math.max(0, player.hurtFlash - dt * 3)

        if (Math.abs(player.vx) > 120 && player.onGround && Math.random() < dt * 26) {
            this.particle('square', player.x - Math.sign(player.vx) * 18, player.y + 16, -player.vx * 0.25 + jitter(-30, 30), jitter(-90, -20), 0.35, jitter(2, 5), '#67e8f9', 120, 0.6, 0)
        }
    }

    private jump() {
        this.player.vy = -this.stats.jumpSpeed
        this.player.onGround = false
        this.player.scaleX = 0.72
        this.player.scaleY = 1.32
        this.sfx('dash', this.player.x)
        this.dust(this.player.x, this.player.y + this.player.size / 2, 8)
        this.ring(this.player.x, this.player.y + 18, 46, '#67e8f9', 0.25, 3)
        const stacks = Math.min(4, this.upgrades.afterimage ?? 0)
        for (let i = 0; i < stacks && this.turrets.length < SHAPEZZ_COMBAT_LIMITS.turrets; i++) {
            const x = this.player.x + (i - (stacks - 1) / 2) * 18
            this.turrets.push({ x, y: this.player.y + 14, life: 5.5, fireCooldown: i * 0.09, angle: 0, recoil: 0 })
            this.burst(x, this.player.y + 14, '#2dd4bf', 6, 160)
        }
    }

    private dropThroughPlatform() {
        const feet = this.player.y + this.player.size / 2
        const onElevatedPlatform = this.platforms.some(platform => {
            const withinX = this.player.x + this.player.size * 0.35 > platform.x && this.player.x - this.player.size * 0.35 < platform.x + platform.width
            return platform.y < FLOOR_Y && withinX && Math.abs(feet - platform.y) <= 4
        })
        if (!onElevatedPlatform) return

        this.dropThroughTimer = 0.2
        this.player.onGround = false
        this.player.vy = Math.max(this.player.vy, 120)
        this.player.y += 5
    }

    // ─── Spawning ───────────────────────────────────────────────────────────

    private updateSpawning(dt: number) {
        const checkpoint = this.checkpoint
        if (checkpoint > this.bossCheckpoint) {
            this.bossCheckpoint = checkpoint
            const kind = shapezzBossForCheckpoint(checkpoint)
            if (kind) this.spawnBoss(kind, checkpoint, shapezzBossEscort(checkpoint, this.difficultyId))
        }

        if (this.spawnCooldown > 0 || this.enemies.length >= SHAPEZZ_COMBAT_LIMITS.enemies) return
        const pressure = shapezzCheckpointPressure(checkpoint)
        const intensity = shapezzIntensity(this.elapsedMs, this.difficultyId) * pressure.population
        const burstCount = Math.min(4, 1 + Math.floor(intensity / 2.4), SHAPEZZ_COMBAT_LIMITS.enemies - this.enemies.length)
        for (let i = 0; i < burstCount; i++) this.spawnEnemy()
        this.spawnCooldown = clamp(0.72 / intensity, 0.11, 0.72)

        if (this.enemies.length < SHAPEZZ_COMBAT_LIMITS.enemies && randomChance(dt * intensity * 0.14)) this.spawnEnemy('shooter')
    }

    private pickEnemyType(): ShapezzEnemyType {
        const mix = shapezzEnemyMix(this.checkpoint)
        let roll = randomFloat()
        for (const entry of mix) {
            roll -= entry.share
            if (roll < 0) return entry.type
        }
        return mix[mix.length - 1]?.type ?? 'melee'
    }

    private spawnEnemy(forceType?: ShapezzEnemyType, options: { x?: number, y?: number, vx?: number, vy?: number, minion?: boolean, noElite?: boolean } = {}) {
        if (this.enemies.length >= SHAPEZZ_COMBAT_LIMITS.enemies) return null
        const minutes = this.elapsedMs / 60_000
        const type = forceType ?? this.pickEnemyType()
        const difficulty = shapezzDifficulty(this.difficultyId)
        const healthMultiplier = shapezzEnemyHealthMultiplier(this.elapsedMs, this.difficultyId)
        const checkpoint = this.checkpoint
        const pressure = shapezzCheckpointPressure(checkpoint)
        const config = SHAPEZZ_ENEMIES[type]
        const side = randomChance(0.5) ? -1 : 1
        const elite = !options.noElite && !options.minion && type !== 'shard' && type !== 'boss' && randomChance(shapezzEliteChance(checkpoint))
        const radius = config.radius * (elite ? SHAPEZZ_ELITE.radius : 1)
        const hp = config.hp * healthMultiplier * pressure.health * (elite ? SHAPEZZ_ELITE.hp : 1)
        const onScreen = options.x !== undefined
        const enemy: Enemy = {
            id: this.enemyId++, type,
            x: options.x ?? (side < 0 ? -radius - 20 : WIDTH + radius + 20),
            y: options.y ?? (type === 'sniper' ? roll(90, 220) : roll(120, FLOOR_Y - 70)),
            vx: options.vx ?? 0, vy: options.vy ?? 0, radius,
            hp, maxHp: hp, hpShown: hp,
            damage: config.damage * difficulty.enemyDamage * (1 + minutes * 0.1) * pressure.damage * (elite ? SHAPEZZ_ELITE.damage : 1),
            speed: config.speed * difficulty.enemySpeed,
            reward: Math.round(shapezzEnemyCoinValue(config.reward, this.elapsedMs, this.difficultyId) * (elite ? SHAPEZZ_ELITE.reward : 1) * (options.minion ? 0.25 : 1)),
            color: config.color,
            fireCooldown: roll(0.3, 1.4), contactCooldown: 0,
            phase: Math.random() * Math.PI * 2,
            boss: false, bossKind: null, elite, minion: options.minion ?? false,
            hitFlash: 0, spawnT: onScreen ? 0 : 1, angle: 0,
            state: 0, stateTimer: 0, aimX: this.player.x, aimY: this.player.y,
            shielded: false, bossPhase: 0, attackIndex: 0, sides: 9, targetSides: 9
        }
        if (type === 'sniper') enemy.fireCooldown = roll(1.4, 2.6)
        this.enemies.push(enemy)
        if (elite) this.sfx('enemy-spawn-elite', enemy.x)
        if (onScreen) this.ring(enemy.x, enemy.y, radius * 2.4, enemy.color, 0.35, 3)
        return enemy
    }

    private spawnBoss(kind: ShapezzBossKind, checkpoint: number, escort: ShapezzBossKind | null) {
        this.createBoss(kind, checkpoint, this.player.x < WIDTH / 2 ? WIDTH * 0.72 : WIDTH * 0.28, 1)
        if (escort) this.createBoss(escort, checkpoint, this.player.x < WIDTH / 2 ? WIDTH * 0.42 : WIDTH * 0.58, 0.6)
        const boss = SHAPEZZ_BOSSES[kind]
        this.sfx('boss-spawn')
        this.callbacks.onBoss(escort ? `${boss.name} + ${SHAPEZZ_BOSSES[escort].name}` : boss.name, boss.title)
        this.trauma = Math.max(this.trauma, 0.8)
        this.flash = 0.7
        this.flashColor = boss.color
    }

    private createBoss(kind: ShapezzBossKind, checkpoint: number, x: number, healthShare: number) {
        const enemy = this.spawnEnemy('boss', { x, y: 170, noElite: true })
        if (!enemy) return
        const config = SHAPEZZ_BOSSES[kind]
        const scale = shapezzBossHealthScale(checkpoint, kind) * healthShare
        enemy.bossKind = kind
        enemy.boss = true
        enemy.color = config.color
        enemy.radius = config.radius
        enemy.speed = config.speed * shapezzDifficulty(this.difficultyId).enemySpeed
        enemy.hp *= scale
        enemy.maxHp = enemy.hp
        enemy.hpShown = enemy.hp
        enemy.reward = Math.round(enemy.reward * (1 + checkpoint * 0.24) * healthShare)
        enemy.fireCooldown = 2.2
        enemy.sides = kind === 'polygon' ? 5 : kind === 'prism' ? 3 : kind === 'hive' ? 6 : 9
        enemy.targetSides = enemy.sides
        this.ring(x, 170, 420, config.color, 1.1, 14, true)
        this.ring(x, 170, 260, config.accent, 0.8, 6)
        this.burst(x, 170, config.color, 90, 650)
        this.sparks(x, 170, config.accent, 50, 900)
    }

    // ─── Enemies ────────────────────────────────────────────────────────────

    private updateEnemies(dt: number) {
        for (const enemy of this.enemies) enemy.shielded = false
        for (const warden of this.enemies) {
            if (warden.type !== 'warden' || warden.hp <= 0) continue
            for (const enemy of this.enemies) {
                if (enemy === warden || enemy.boss || enemy.type === 'warden') continue
                if (distanceSquared(enemy, warden) < SHAPEZZ_WARDEN_AURA_RADIUS * SHAPEZZ_WARDEN_AURA_RADIUS) enemy.shielded = true
            }
        }

        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) continue
            enemy.fireCooldown -= dt
            enemy.contactCooldown -= dt
            enemy.stateTimer -= dt
            enemy.phase += dt
            enemy.hitFlash = Math.max(0, enemy.hitFlash - dt)
            enemy.spawnT = Math.min(1, enemy.spawnT + dt / (enemy.boss ? 1 : 0.4))
            enemy.hpShown += (enemy.hp - enemy.hpShown) * Math.min(1, dt * 3.5)
            const playerDx = this.player.x - enemy.x
            const playerDy = this.player.y - enemy.y
            const dist = Math.hypot(playerDx, playerDy)
            const inverseDistance = 1 / (dist || 1)
            const dirX = playerDx * inverseDistance
            const dirY = playerDy * inverseDistance
            const warping = enemy.spawnT < 1 && (enemy.boss || enemy.minion)

            if (warping) {
                enemy.vx *= 0.9
                enemy.vy *= 0.9
            } else if (enemy.boss) {
                this.updateBoss(enemy, dt, dirX, dirY, dist)
            } else {
                switch (enemy.type) {
                    case 'shooter': this.updateShooter(enemy, dt, dirX, dirY, dist); break
                    case 'sniper': this.updateSniper(enemy, dt, dirX, dirY, dist); break
                    case 'warden': this.updateWarden(enemy, dt, dirX, dirY, dist); break
                    case 'bomber': this.updateBomber(enemy, dt, dirX, dirY, dist); break
                    default: this.updateRammer(enemy, dt, dirX, dirY)
                }
            }

            enemy.x += enemy.vx * dt
            enemy.y += enemy.vy * dt
            if (enemy.boss) {
                enemy.x = clamp(enemy.x, enemy.radius, WIDTH - enemy.radius)
                enemy.y = clamp(enemy.y, 80, FLOOR_Y - enemy.radius)
            } else {
                enemy.x = clamp(enemy.x, -100, WIDTH + 100)
                enemy.y = clamp(enemy.y, 70, FLOOR_Y - Math.min(30, enemy.radius))
            }

            if (!warping && enemy.hp > 0 && dist < enemy.radius + this.player.size * 0.48 && enemy.contactCooldown <= 0) {
                const charging = enemy.bossKind === 'polygon' && enemy.state === 2
                this.damagePlayer(enemy.damage * (charging ? 1.1 : 0.62), enemy.boss ? 'boss contact' : `${enemy.type} contact`)
                enemy.contactCooldown = 0.75
                if (!enemy.boss) {
                    enemy.vx -= dirX * 280
                    enemy.vy -= dirY * 280
                }
            }
        }
        this.enemies = this.enemies.filter(enemy => enemy.hp > 0)
        this.rebuildEnemyGrid()
        this.separateEnemies()
    }

    private updateRammer(enemy: Enemy, dt: number, dirX: number, dirY: number) {
        let speed = enemy.speed
        if (enemy.type === 'dasher') speed *= 0.7 + Math.max(0, Math.sin(enemy.phase * 3.8)) * 2.5
        if (enemy.type === 'splitter') speed *= 0.85 + Math.sin(enemy.phase * 2.2) * 0.25
        const steer = enemy.type === 'shard' && enemy.phase < 0.35 ? 0.8 : 4
        enemy.vx += (dirX * speed - enemy.vx) * Math.min(1, dt * steer)
        enemy.vy += (dirY * speed - enemy.vy) * Math.min(1, dt * steer)
        enemy.angle = Math.atan2(enemy.vy, enemy.vx)
    }

    private hover(enemy: Enemy, dt: number, dirX: number, dirY: number, dist: number, desired: number, responsiveness = 2.5) {
        const direction = dist < desired - 60 ? -1 : dist > desired + 90 ? 1 : 0
        const tangent = Math.sin(enemy.phase * 0.8)
        enemy.vx += (dirX * enemy.speed * direction - dirY * tangent * enemy.speed * 0.55 - enemy.vx) * Math.min(1, dt * responsiveness)
        enemy.vy += (dirY * enemy.speed * direction + dirX * tangent * enemy.speed * 0.55 - enemy.vy) * Math.min(1, dt * responsiveness)
    }

    private updateShooter(enemy: Enemy, dt: number, dirX: number, dirY: number, dist: number) {
        this.hover(enemy, dt, dirX, dirY, dist, 410)
        enemy.angle = Math.atan2(dirY, dirX)
        if (enemy.fireCooldown <= 0) {
            this.fireEnemyBullet(enemy, dirX, dirY, 260, enemy.radius > 22 ? 7 : 6)
            this.sfx('enemy-shoot', enemy.x)
            enemy.fireCooldown = roll(1.2, 2.1)
        }
    }

    /** Snipers park high, paint the player with a tracking laser, lock, then fire one fast needle. */
    private updateSniper(enemy: Enemy, dt: number, dirX: number, dirY: number, dist: number) {
        const targetY = 110 + Math.sin(enemy.phase * 0.5) * 50
        const desiredX = this.player.x + (enemy.x < this.player.x ? -1 : 1) * 480
        const moveScale = enemy.state === 1 ? 0.15 : 1
        enemy.vx += ((clamp(desiredX, 40, WIDTH - 40) - enemy.x) * 1.2 * moveScale - enemy.vx) * Math.min(1, dt * 2)
        enemy.vy += ((targetY - enemy.y) * 1.6 * moveScale - enemy.vy) * Math.min(1, dt * 2)
        if (enemy.state === 0) {
            enemy.angle = Math.atan2(dirY, dirX)
            const onScreen = enemy.x > 20 && enemy.x < WIDTH - 20
            if (enemy.fireCooldown <= 0 && onScreen) {
                enemy.state = 1
                enemy.stateTimer = 1.05
                enemy.aimX = this.player.x
                enemy.aimY = this.player.y
                this.sfx('sniper-charge', enemy.x)
            }
            return
        }
        // Track for most of the charge, then lock so the shot can be dodged.
        if (enemy.stateTimer > 0.28) {
            enemy.aimX += (this.player.x - enemy.aimX) * Math.min(1, dt * 7)
            enemy.aimY += (this.player.y - enemy.aimY) * Math.min(1, dt * 7)
        }
        enemy.angle = Math.atan2(enemy.aimY - enemy.y, enemy.aimX - enemy.x)
        if (enemy.stateTimer <= 0) {
            enemy.state = 0
            enemy.fireCooldown = roll(2.6, 3.8)
            const direction = { x: Math.cos(enemy.angle), y: Math.sin(enemy.angle) }
            this.fireEnemyBullet(enemy, direction.x, direction.y, 980, 5, 'needle')
            this.sfx('sniper-fire', enemy.x)
            this.sparks(enemy.x + direction.x * 20, enemy.y + direction.y * 20, enemy.color, 10, 420)
            enemy.vx -= direction.x * 160
            enemy.vy -= direction.y * 160
        }
    }

    private updateWarden(enemy: Enemy, dt: number, dirX: number, dirY: number, dist: number) {
        this.hover(enemy, dt, dirX, dirY, dist, 300, 1.6)
        enemy.angle += dt * 0.6
        if (enemy.fireCooldown <= 0) {
            const aim = Math.atan2(dirY, dirX)
            for (let i = -1; i <= 1; i++) this.fireEnemyBullet(enemy, Math.cos(aim + i * 0.22), Math.sin(aim + i * 0.22), 200, 7)
            this.sfx('enemy-shoot', enemy.x, { pitch: 0.8 })
            enemy.fireCooldown = roll(2.8, 3.6)
        }
    }

    /** Bombers chase, arm a short fuse when close and detonate. Killing one first turns the blast on its friends. */
    private updateBomber(enemy: Enemy, dt: number, dirX: number, dirY: number, dist: number) {
        if (enemy.state === 0) {
            this.updateRammer(enemy, dt, dirX, dirY)
            if (dist < 135) {
                enemy.state = 1
                enemy.stateTimer = 0.85
                this.sfx('bomber-fuse', enemy.x)
            }
            return
        }
        this.sfx('bomber-fuse', enemy.x, { pitch: 1 + (0.85 - enemy.stateTimer) * 0.6 })
        enemy.vx *= Math.pow(0.02, dt)
        enemy.vy *= Math.pow(0.02, dt)
        enemy.vx += dirX * enemy.speed * 0.3 * dt * 4
        enemy.vy += dirY * enemy.speed * 0.3 * dt * 4
        if (enemy.stateTimer <= 0) this.detonateBomber(enemy, true)
    }

    private detonateBomber(enemy: Enemy, hurtsPlayer: boolean) {
        const radius = SHAPEZZ_BOMBER_BLAST_RADIUS * (enemy.elite ? 1.3 : 1)
        enemy.hp = 0
        this.explosion(enemy.x, enemy.y, radius, enemy.color, true)
        if (hurtsPlayer && distance(enemy, this.player) < radius + this.player.size * 0.4) {
            this.damagePlayer(enemy.damage, 'bomber blast')
        }
        // Chain reactions: other shapes in the blast take the hit, and those kills are yours.
        // Scaled to the bomber's own health so the blast tracks the arena ramp instead of the player's build.
        const blastDamage = enemy.maxHp * (hurtsPlayer ? 0.2 : 0.35)
        for (const target of this.enemies) {
            if (target === enemy || target.hp <= 0) continue
            const targetDistance = distance(target, enemy)
            if (targetDistance < radius + target.radius) {
                this.hitEnemy(target, blastDamage * shapezzExplosionDamageMultiplier(targetDistance, radius + target.radius), enemy.color, target.x, target.y, 'bomber')
            }
        }
    }

    // ─── Bosses ─────────────────────────────────────────────────────────────

    private updateBoss(enemy: Enemy, dt: number, dirX: number, dirY: number, dist: number) {
        const kind = enemy.bossKind ?? 'overseer'
        const ratio = enemy.hp / Math.max(1, enemy.maxHp)
        const phase = ratio < 0.33 ? 2 : ratio < 0.66 ? 1 : 0
        if (phase > enemy.bossPhase) {
            enemy.bossPhase = phase
            this.sfx('boss-phase', enemy.x)
            this.ring(enemy.x, enemy.y, 380, enemy.color, 0.9, 12, true)
            this.sparks(enemy.x, enemy.y, SHAPEZZ_BOSSES[kind].accent, 40, 800)
            this.trauma = Math.max(this.trauma, 0.6)
            this.text(enemy.x, enemy.y - enemy.radius - 30, phase === 2 ? 'ENRAGED' : 'PHASE II', enemy.color, 30, 1.2)
            // A phase break clears the hostile shots on screen: a breather, and a reward.
            for (const bullet of this.enemyBullets) this.particle('glow', bullet.x, bullet.y, 0, 0, 0.3, bullet.radius * 3, bullet.color, 0, 1, 0)
            this.enemyBullets.length = 0
        }
        const tempo = 1 + enemy.bossPhase * 0.2
        enemy.angle += dt * (kind === 'prism' ? 0.9 : 0.35) * tempo
        enemy.sides += (enemy.targetSides - enemy.sides) * Math.min(1, dt * 3)

        // Active attack.
        if (enemy.state !== 0) {
            this.updateBossAttack(enemy, dt, dirX, dirY, dist, tempo)
            return
        }

        const desired = kind === 'hive' ? 380 : kind === 'polygon' ? 260 : 330
        this.hover(enemy, dt, dirX, dirY, dist, desired)
        // Keep bosses up in the air where the player can shoot them.
        if (enemy.y > FLOOR_Y - 190) enemy.vy -= 300 * dt
        if (enemy.fireCooldown > 0) return

        const attacks = BOSS_ATTACKS[kind]
        let attack = attacks[enemy.attackIndex % attacks.length]!
        enemy.attackIndex++
        if (attack === 'summon' && enemy.bossPhase === 0) attack = 'ring'
        this.beginBossAttack(enemy, attack, tempo)
    }

    private attackCode(attack: BossAttack) {
        return ['ring', 'spiral', 'summon', 'lasers', 'shards', 'blink', 'brood', 'missiles', 'rain', 'charge', 'hell', 'slam'].indexOf(attack) + 1
    }

    private attackName(code: number): BossAttack {
        return (['ring', 'spiral', 'summon', 'lasers', 'shards', 'blink', 'brood', 'missiles', 'rain', 'charge', 'hell', 'slam'] as const)[code - 1]!
    }

    private beginBossAttack(enemy: Enemy, attack: BossAttack, tempo: number) {
        const aim = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x)
        const recover = (seconds: number) => { enemy.fireCooldown = seconds / tempo }
        enemy.state = this.attackCode(attack)
        switch (attack) {
            case 'ring': {
                this.bossRing(enemy, enemy.phase)
                if (enemy.bossPhase >= 1) this.schedule(0.35, enemy.id, () => this.bossRing(enemy, enemy.phase + 0.2))
                if (enemy.bossPhase >= 2) this.schedule(0.7, enemy.id, () => this.bossRing(enemy, enemy.phase + 0.4))
                enemy.state = 0
                recover(1.5)
                return
            }
            case 'spiral':
                enemy.stateTimer = 2.4
                enemy.aimX = 0
                this.sfx('boss-attack', enemy.x)
                recover(1.4)
                return
            case 'summon': {
                this.sfx('boss-attack', enemy.x)
                for (let i = 0; i < 3 + enemy.bossPhase; i++) {
                    const angle = i / (3 + enemy.bossPhase) * Math.PI * 2
                    this.spawnEnemy(randomPick(['melee', 'dasher'] as const), { x: enemy.x + Math.cos(angle) * 90, y: enemy.y + Math.sin(angle) * 90, vx: Math.cos(angle) * 300, vy: Math.sin(angle) * 300, minion: true })
                }
                enemy.state = 0
                recover(1.6)
                return
            }
            case 'lasers': {
                const count = 3 + enemy.bossPhase
                const sweep = (enemy.attackIndex % 2 === 0 ? 1 : -1) * (0.45 + enemy.bossPhase * 0.12)
                for (let i = 0; i < count; i++) {
                    this.addLaser(enemy, enemy.angle + i / count * Math.PI * 2, 0.95, 1.9, sweep)
                }
                enemy.stateTimer = 2.85
                this.sfx('boss-laser', enemy.x)
                recover(1.3)
                return
            }
            case 'shards': {
                const count = 3 + enemy.bossPhase
                for (let i = 0; i < count; i++) {
                    const angle = aim + (i - (count - 1) / 2) * 0.32
                    this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * 250, Math.sin(angle) * 250, enemy.damage, 12, enemy.color, 'star', { splitIn: 0.75, splitCount: 8 })
                }
                this.sfx('enemy-shoot-heavy', enemy.x)
                this.ring(enemy.x, enemy.y, 120, enemy.color, 0.3, 5)
                enemy.state = 0
                recover(1.7)
                return
            }
            case 'blink': {
                const targetX = clamp(this.player.x + (randomChance(0.5) ? -1 : 1) * roll(260, 420), 120, WIDTH - 120)
                const targetY = roll(130, 300)
                enemy.aimX = targetX
                enemy.aimY = targetY
                enemy.stateTimer = 0.7
                this.warnings.push({ x: targetX, y: targetY, radius: enemy.radius * 1.3, life: 0.7, maxLife: 0.7, color: enemy.color, kind: 'circle', x2: 0, y2: 0 })
                recover(1.4)
                return
            }
            case 'brood': {
                this.sfx('boss-attack', enemy.x)
                const count = 4 + enemy.bossPhase * 2
                for (let i = 0; i < count; i++) {
                    const angle = i / count * Math.PI * 2 + enemy.phase
                    this.spawnEnemy(i % 2 === 0 ? 'dasher' : 'melee', { x: enemy.x + Math.cos(angle) * 60, y: enemy.y + Math.sin(angle) * 60, vx: Math.cos(angle) * 380, vy: Math.sin(angle) * 380, minion: true })
                }
                this.burst(enemy.x, enemy.y, enemy.color, 30, 420)
                enemy.state = 0
                recover(2.2)
                return
            }
            case 'missiles': {
                const count = 4 + enemy.bossPhase * 2
                for (let i = 0; i < count; i++) {
                    const angle = -Math.PI / 2 + (i - (count - 1) / 2) * 0.45
                    this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * 240, Math.sin(angle) * 240, enemy.damage * 0.9, 9, enemy.color, 'star', { homing: 1.7 + enemy.bossPhase * 0.3, life: 4.2 })
                }
                this.sfx('enemy-shoot-heavy', enemy.x)
                enemy.state = 0
                recover(1.8)
                return
            }
            case 'rain': {
                const count = 8 + enemy.bossPhase * 3
                const columns = new Set<number>()
                // Always leave a gap: columns are picked away from one safe lane.
                const safe = clamp(this.player.x + jitter(-160, 160), 60, WIDTH - 60)
                while (columns.size < count) {
                    const x = Math.round(roll(30, WIDTH - 30) / 40) * 40
                    if (Math.abs(x - safe) > 70) columns.add(x)
                }
                for (const x of columns) {
                    const delay = roll(0.75, 1.1)
                    this.warnings.push({ x, y: 0, radius: 14, life: delay, maxLife: delay, color: enemy.color, kind: 'column', x2: 0, y2: 0 })
                    this.schedule(delay, enemy.id, () => this.spawnEnemyBullet(x, -10, 0, 560, enemy.damage * 0.8, 9, enemy.color, 'needle'))
                }
                this.sfx('boss-attack', enemy.x)
                enemy.state = 0
                recover(1.9)
                return
            }
            case 'charge': {
                enemy.stateTimer = 0.8
                enemy.targetSides = 3
                enemy.aimX = this.player.x
                enemy.aimY = this.player.y
                const direction = normalized(this.player.x - enemy.x, this.player.y - enemy.y)
                this.warnings.push({ x: enemy.x, y: enemy.y, radius: enemy.radius, life: 0.8, maxLife: 0.8, color: enemy.color, kind: 'line', x2: enemy.x + direction.x * 1400, y2: enemy.y + direction.y * 1400 })
                this.sfx('boss-attack', enemy.x)
                recover(1.5)
                return
            }
            case 'hell':
                enemy.stateTimer = 3
                enemy.targetSides = 12
                enemy.aimX = 0
                this.sfx('boss-attack', enemy.x)
                recover(1.5)
                return
            case 'slam':
                enemy.stateTimer = 0.7
                enemy.targetSides = 4
                enemy.aimX = this.player.x
                this.warnings.push({ x: this.player.x, y: FLOOR_Y, radius: enemy.radius, life: 0.95, maxLife: 0.95, color: enemy.color, kind: 'circle', x2: 0, y2: 0 })
                recover(1.8)
        }
    }

    private updateBossAttack(enemy: Enemy, dt: number, dirX: number, dirY: number, dist: number, tempo: number) {
        const attack = this.attackName(enemy.state)
        switch (attack) {
            case 'spiral': {
                enemy.vx *= Math.pow(0.1, dt)
                enemy.vy *= Math.pow(0.1, dt)
                enemy.aimX -= dt
                if (enemy.aimX <= 0) {
                    enemy.aimX = 0.075 / tempo
                    const arms = 2 + enemy.bossPhase
                    const base = enemy.phase * 2.6
                    for (let i = 0; i < arms; i++) {
                        const angle = base + i / arms * Math.PI * 2
                        this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * 220, Math.sin(angle) * 220, enemy.damage * 0.8, 7, enemy.color, 'orb')
                    }
                }
                if (enemy.stateTimer <= 0) enemy.state = 0
                return
            }
            case 'lasers':
                enemy.vx *= Math.pow(0.05, dt)
                enemy.vy *= Math.pow(0.05, dt)
                if (enemy.stateTimer <= 0) enemy.state = 0
                return
            case 'blink':
                enemy.vx = 0
                enemy.vy = 0
                if (enemy.stateTimer <= 0) {
                    this.ring(enemy.x, enemy.y, 160, enemy.color, 0.35, 6, true)
                    this.burst(enemy.x, enemy.y, enemy.color, 26, 380)
                    enemy.x = enemy.aimX
                    enemy.y = enemy.aimY
                    enemy.spawnT = 0.6
                    this.ring(enemy.x, enemy.y, 220, enemy.color, 0.45, 8, true)
                    this.sparks(enemy.x, enemy.y, SHAPEZZ_BOSSES.prism.accent, 26, 700)
                    const count = 10 + enemy.bossPhase * 4
                    for (let i = 0; i < count; i++) {
                        const angle = i / count * Math.PI * 2
                        this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * 240, Math.sin(angle) * 240, enemy.damage * 0.8, 7, enemy.color, 'orb')
                    }
                    this.sfx('boss-attack', enemy.x)
                    enemy.state = 0
                }
                return
            case 'charge': {
                if (enemy.stateTimer > 0) {
                    // Wind-up: shiver in place.
                    enemy.vx = Math.sin(enemy.phase * 70) * 60
                    enemy.vy = 0
                    return
                }
                if (enemy.stateTimer > -0.02 && enemy.stateTimer <= 0 && enemy.aimY !== -1) {
                    const direction = normalized(enemy.aimX - enemy.x, enemy.aimY - enemy.y)
                    enemy.vx = direction.x * 1150
                    enemy.vy = direction.y * 1150
                    enemy.aimY = -1
                    this.sfx('dash', enemy.x, { pitch: 0.5, volume: 1.4 })
                }
                enemy.contactCooldown = Math.min(enemy.contactCooldown, 0.2)
                if (Math.random() < 0.7) this.particle('glow', enemy.x, enemy.y, 0, 0, 0.3, enemy.radius * 1.6, enemy.color, 0, 0.8, 0)
                const hitWall = enemy.x <= enemy.radius + 2 || enemy.x >= WIDTH - enemy.radius - 2 || enemy.y <= 82 || enemy.y >= FLOOR_Y - enemy.radius - 2
                if (hitWall || enemy.stateTimer < -1.1) {
                    this.bossImpact(enemy, 14 + enemy.bossPhase * 4)
                    enemy.vx *= -0.2
                    enemy.vy *= -0.2
                    enemy.targetSides = 5
                    enemy.state = 0
                }
                return
            }
            case 'hell': {
                enemy.vx *= Math.pow(0.1, dt)
                enemy.vy *= Math.pow(0.1, dt)
                enemy.aimX -= dt
                if (enemy.aimX <= 0) {
                    enemy.aimX = 0.1 / tempo
                    const arms = 3 + enemy.bossPhase
                    for (let direction = -1; direction <= 1; direction += 2) {
                        const base = enemy.phase * 1.9 * direction
                        for (let i = 0; i < arms; i++) {
                            const angle = base + i / arms * Math.PI * 2
                            this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * 190, Math.sin(angle) * 190, enemy.damage * 0.75, 6, direction > 0 ? enemy.color : SHAPEZZ_BOSSES.polygon.accent, 'orb')
                        }
                    }
                }
                if (enemy.stateTimer <= 0) {
                    enemy.targetSides = 5
                    enemy.state = 0
                }
                return
            }
            case 'slam': {
                if (enemy.stateTimer > 0) {
                    // Rise above the marked spot.
                    enemy.vx = (enemy.aimX - enemy.x) * 5
                    enemy.vy = (110 - enemy.y) * 6
                    return
                }
                enemy.vx = 0
                enemy.vy = 1500
                if (enemy.y >= FLOOR_Y - enemy.radius - 4) {
                    enemy.y = FLOOR_Y - enemy.radius
                    enemy.vy = -200
                    this.bossImpact(enemy, 0)
                    // Floor waves: jump them.
                    for (const side of [-1, 1]) {
                        for (let i = 0; i < 1 + enemy.bossPhase; i++) {
                            this.spawnEnemyBullet(enemy.x + side * enemy.radius, FLOOR_Y - 16, side * (430 + i * 110), 0, enemy.damage, 15, enemy.color, 'wave')
                        }
                    }
                    const floor = this.platforms[0]
                    if (floor) floor.glow = 1
                    enemy.targetSides = 5
                    enemy.state = 0
                }
                return
            }
            default:
                enemy.state = 0
        }
        void dirX
        void dirY
        void dist
    }

    private bossImpact(enemy: Enemy, ringBullets: number) {
        this.explosion(enemy.x, enemy.y, enemy.radius * 2.2, enemy.color, true)
        this.trauma = Math.max(this.trauma, 0.75)
        this.shatter(enemy.x, enemy.y, 14, enemy.color, 14, 520)
        for (let i = 0; i < ringBullets; i++) {
            const angle = i / ringBullets * Math.PI * 2
            this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * 250, Math.sin(angle) * 250, enemy.damage * 0.8, 8, enemy.color, 'orb')
        }
    }

    private bossRing(enemy: Enemy, base: number) {
        if (enemy.hp <= 0) return
        const count = 12 + Math.min(12, Math.floor(this.elapsedMs / 180_000) * 4)
        for (let i = 0; i < count; i++) {
            const angle = base + i / count * Math.PI * 2
            this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(angle) * 290, Math.sin(angle) * 290, enemy.damage, 9, enemy.color, 'orb')
        }
        const aim = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x)
        for (let i = -2; i <= 2; i++) {
            this.spawnEnemyBullet(enemy.x, enemy.y, Math.cos(aim + i * 0.1) * 290, Math.sin(aim + i * 0.1) * 290, enemy.damage, 9, enemy.color, 'orb')
        }
        this.ring(enemy.x, enemy.y, 250, enemy.color, 0.45, 8)
        this.trauma = Math.max(this.trauma, 0.35)
        this.sfx('enemy-shoot-heavy', enemy.x)
    }

    private addLaser(owner: Enemy, angle: number, warmup: number, burn: number, sweep: number) {
        if (this.lasers.length >= SHAPEZZ_COMBAT_LIMITS.lasers) return
        this.lasers.push({
            x: owner.x, y: owner.y, angle, length: 1700, width: 18 + owner.bossPhase * 3,
            warmup, maxWarmup: warmup, life: burn, maxLife: burn, damage: owner.damage * 0.85,
            color: owner.color, sweep, ownerId: owner.id, offset: owner.radius * 0.6
        })
    }

    private updateLasers(dt: number) {
        let kept = 0
        for (const laser of this.lasers) {
            const owner = this.enemies.find(enemy => enemy.id === laser.ownerId)
            if (!owner || owner.hp <= 0) continue
            laser.x = owner.x + Math.cos(laser.angle) * laser.offset
            laser.y = owner.y + Math.sin(laser.angle) * laser.offset
            if (laser.warmup > 0) {
                laser.warmup -= dt
            } else {
                laser.life -= dt
                laser.angle += laser.sweep * dt
                const endX = laser.x + Math.cos(laser.angle) * laser.length
                const endY = laser.y + Math.sin(laser.angle) * laser.length
                const reach = laser.width / 2 + this.player.size * 0.38
                if (distanceToSegmentSquared(this.player.x, this.player.y, laser.x, laser.y, endX, endY) < reach * reach) {
                    this.damagePlayer(laser.damage, 'boss laser')
                }
                if (Math.random() < dt * 40) {
                    const t = Math.random()
                    this.particle('spark', laser.x + (endX - laser.x) * t, laser.y + (endY - laser.y) * t, jitter(-200, 200), jitter(-200, 200), 0.25, 3, laser.color, 0, 0.5, 0)
                }
            }
            if (laser.life > 0) this.lasers[kept++] = laser
        }
        this.lasers.length = kept
    }

    private schedule(delay: number, ownerId: number, action: () => void) {
        this.scheduled.push({ delay, ownerId, action })
    }

    private updateScheduled(dt: number) {
        if (!this.scheduled.length) return
        const due: Scheduled[] = []
        let kept = 0
        for (const item of this.scheduled) {
            item.delay -= dt
            if (item.delay <= 0) due.push(item)
            else this.scheduled[kept++] = item
        }
        this.scheduled.length = kept
        for (const item of due) {
            // Owner -1 is unconditional (effects); anything else dies with the shape that queued it.
            const owner = item.ownerId === -1 ? null : this.enemies.find(enemy => enemy.id === item.ownerId)
            if (item.ownerId === -1 || (owner && owner.hp > 0)) item.action()
        }
    }

    private rebuildEnemyGrid() {
        this.enemyGrid.clear()
        for (const enemy of this.enemies) {
            const column = clamp(Math.floor((enemy.x + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_COLUMNS - 1)
            const row = clamp(Math.floor((enemy.y + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_ROWS - 1)
            const key = column + row * ENEMY_GRID_COLUMNS
            const cell = this.enemyGrid.get(key)
            if (cell) cell.push(enemy)
            else this.enemyGrid.set(key, [enemy])
        }
    }

    /** Soft push-apart so crowds read as individual shapes instead of one blob. */
    private separateEnemies() {
        for (const enemy of this.enemies) {
            if (enemy.boss) continue
            const column = clamp(Math.floor((enemy.x + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_COLUMNS - 1)
            const row = clamp(Math.floor((enemy.y + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_ROWS - 1)
            for (let r = Math.max(0, row - 1); r <= Math.min(ENEMY_GRID_ROWS - 1, row + 1); r++) {
                for (let c = Math.max(0, column - 1); c <= Math.min(ENEMY_GRID_COLUMNS - 1, column + 1); c++) {
                    const cell = this.enemyGrid.get(c + r * ENEMY_GRID_COLUMNS)
                    if (!cell) continue
                    for (const other of cell) {
                        if (other.id <= enemy.id || other.boss) continue
                        const dx = other.x - enemy.x
                        const dy = other.y - enemy.y
                        const minDistance = (enemy.radius + other.radius) * 0.85
                        const distSquared = dx * dx + dy * dy
                        if (distSquared >= minDistance * minDistance || distSquared === 0) continue
                        const dist = Math.sqrt(distSquared)
                        const push = (minDistance - dist) * 0.3 / dist
                        enemy.x -= dx * push
                        enemy.y -= dy * push
                        other.x += dx * push
                        other.y += dy * push
                    }
                }
            }
        }
    }

    // ─── Hostile projectiles ────────────────────────────────────────────────

    private fireEnemyBullet(enemy: Enemy, dx: number, dy: number, speed: number, radius: number, shape: EnemyBulletShape = 'orb') {
        this.spawnEnemyBullet(enemy.x + dx * enemy.radius * 0.8, enemy.y + dy * enemy.radius * 0.8, dx * speed, dy * speed, enemy.damage, radius, enemy.color, shape)
        this.particle('glow', enemy.x + dx * enemy.radius, enemy.y + dy * enemy.radius, 0, 0, 0.12, radius * 4, enemy.color, 0, 0.5, 0)
    }

    private spawnEnemyBullet(
        x: number, y: number, vx: number, vy: number, damage: number, radius: number, color: string, shape: EnemyBulletShape,
        extra: { homing?: number, gravity?: number, splitIn?: number, splitCount?: number, life?: number } = {}
    ) {
        if (this.enemyBullets.length >= SHAPEZZ_COMBAT_LIMITS.enemyBullets) return
        this.enemyBullets.push({
            x, y, vx, vy, damage, radius, life: extra.life ?? 6, color, shape,
            homing: extra.homing ?? 0, gravity: extra.gravity ?? 0,
            splitIn: extra.splitIn ?? 0, splitCount: extra.splitCount ?? 0,
            spin: Math.random() * Math.PI * 2
        })
    }

    private updateEnemyBullets(dt: number) {
        const bulletTime = this.upgrades.bulletTime ?? 0
        const slow = Math.pow(0.42, bulletTime)
        const orbitals = this.orbitalPositions()
        const reach = this.player.size * 0.45
        const count = this.enemyBullets.length
        let kept = 0
        for (let i = 0; i < count; i++) {
            const bullet = this.enemyBullets[i]!
            bullet.life -= dt
            bullet.spin += dt * 6
            if (bullet.life <= 0) continue
            if (bullet.splitIn > 0) {
                bullet.splitIn -= dt
                if (bullet.splitIn <= 0) {
                    for (let s = 0; s < bullet.splitCount; s++) {
                        const angle = s / bullet.splitCount * Math.PI * 2 + bullet.spin
                        this.spawnEnemyBullet(bullet.x, bullet.y, Math.cos(angle) * 230, Math.sin(angle) * 230, bullet.damage * 0.6, 6, bullet.color, 'orb')
                    }
                    this.ring(bullet.x, bullet.y, 60, bullet.color, 0.25, 3)
                    continue
                }
            }
            if (bullet.homing > 0) {
                const current = Math.atan2(bullet.vy, bullet.vx)
                const desired = Math.atan2(this.player.y - bullet.y, this.player.x - bullet.x)
                const turn = clamp(angleDelta(current, desired), -bullet.homing * dt, bullet.homing * dt)
                const speed = Math.hypot(bullet.vx, bullet.vy)
                bullet.vx = Math.cos(current + turn) * speed
                bullet.vy = Math.sin(current + turn) * speed
                if (Math.random() < dt * 30) this.particle('dot', bullet.x, bullet.y, -bullet.vx * 0.1, -bullet.vy * 0.1, 0.3, 3, bullet.color, 0, 0.3, 0)
            }
            bullet.vy += bullet.gravity * dt
            const scale = bulletTime > 0 && distanceSquared(bullet, this.player) < 260 * 260 ? slow : 1
            bullet.x += bullet.vx * dt * scale
            bullet.y += bullet.vy * dt * scale

            let swatted = false
            for (const orbital of orbitals) {
                if (distanceSquared(bullet, orbital) < (bullet.radius + 14) ** 2) {
                    swatted = true
                    this.sparks(bullet.x, bullet.y, '#f0abfc', 5, 260)
                    break
                }
            }
            if (swatted) continue

            if (distanceSquared(bullet, this.player) < (bullet.radius + reach) ** 2) {
                this.damagePlayer(bullet.damage, bullet.shape === 'needle' ? 'sniper/rain shot' : bullet.shape === 'wave' ? 'boss floor wave' : 'enemy shot')
                this.burst(bullet.x, bullet.y, bullet.color, 8, 220)
                continue
            }
            if (bullet.x < -40 || bullet.x > WIDTH + 40 || bullet.y < -60 || bullet.y > HEIGHT + 40) continue
            if (bullet.shape !== 'wave' && bullet.y > FLOOR_Y - bullet.radius * 0.5 && bullet.vy > 0) {
                this.burst(bullet.x, FLOOR_Y - 2, bullet.color, 4, 140)
                continue
            }
            this.enemyBullets[kept++] = bullet
        }
        // Keep any bullets spawned during this pass (splits).
        for (let i = count; i < this.enemyBullets.length; i++) this.enemyBullets[kept++] = this.enemyBullets[i]!
        this.enemyBullets.length = kept
    }

    // ─── Player weapons ─────────────────────────────────────────────────────

    private playerBulletSpeed() {
        const velocity = Math.min(4, this.upgrades.hyperVelocity ?? 0)
        // The rail is hitscan; the auto-pilot reads this to lead its aim.
        if (this.weapon.type === 'railgun') return 100_000
        return 780 * this.weapon.projectileSpeedMultiplier * Math.pow(1.5, velocity)
    }

    private fireWeapon() {
        const angle = Math.atan2(this.aim.y - this.player.y, this.aim.x - this.player.x)
        const x = this.player.x + Math.cos(angle) * 20
        const y = this.player.y - 6 + Math.sin(angle) * 20
        const fired = this.firePlayerVolley(x, y, angle, 1, true, this.aim, this.weapon.chainRange, 'weapon')
        if (!fired) return false
        const type = this.weapon.type
        if (type === 'railgun') this.sfx('sniper-fire', this.player.x, { pitch: 0.75, volume: 1.4 })
        else if (type === 'shotgun') this.sfx('shoot-launcher', this.player.x, { pitch: 1.7, volume: 0.6 })
        else this.sfx(type === 'arcCoil' ? 'shoot-arc' : `shoot-${type}`, this.player.x)
        this.player.recoil = 1
        this.player.muzzleFlash = 0.06
        const kick = type === 'launcher' || type === 'railgun' ? 90 : type === 'shotgun' ? 30 : 0
        if (kick) this.player.vx -= Math.cos(angle) * kick
        return true
    }

    private firePlayerVolley(
        x: number,
        y: number,
        angle: number,
        damageMultiplier: number,
        triggersHealing: boolean,
        targetPoint: Point,
        arcAcquisitionRange: number,
        source: DamageSource
    ) {
        if (this.weapon.type === 'arcCoil') {
            return this.fireArcCoil(x, y, angle, damageMultiplier, triggersHealing, arcAcquisitionRange, source)
        }
        if (this.weapon.type === 'railgun') return this.fireRail(x, y, angle, damageMultiplier, triggersHealing, source)

        // Scatter Array fires a tight volley of seeker missiles (see updateBullets).
        const missiles = this.weapon.type === 'shotgun'
        const twinFang = this.upgrades.twinFang ?? 0
        const effectiveTwinStacks = Math.min(missiles ? 2 : 3, twinFang)
        const extra = effectiveTwinStacks * 2
        const count = this.weapon.pellets + extra
        const overflowDamage = 1 + Math.max(0, twinFang - effectiveTwinStacks) * 0.08
        const spread = missiles
            ? this.weapon.spread + Math.min(0.12, extra * 0.02)
            : Math.max(this.weapon.spread, Math.min(0.55, (count - 1) * 0.05))
        const secondaryProcLimit = damageMultiplier < 1 ? 0 : Math.min(4, count)
        for (let i = 0; i < count; i++) {
            const offset = count === 1 ? 0 : -spread / 2 + i / (count - 1) * spread
            const secondaryEffects = secondaryProcLimit > 0 && i % Math.max(1, Math.ceil(count / secondaryProcLimit)) === 0
            this.createPlayerBullet(x, y, angle + offset, damageMultiplier * overflowDamage, missiles, secondaryEffects, triggersHealing, source, SHAPEZZ_BULLET_PRIORITY.weapon)
        }
        void targetPoint
        const muzzleX = x + Math.cos(angle) * 14
        const muzzleY = y + Math.sin(angle) * 14
        const intensity = this.weapon.visualIntensity
        this.particle('glow', muzzleX, muzzleY, 0, 0, 0.07, 26 + intensity * 5, this.weapon.primaryColor, 0, 0.6, 0)
        const sparkCount = 2 + intensity
        for (let i = 0; i < sparkCount; i++) {
            const sparkAngle = angle + jitter(-0.45, 0.45)
            const speed = jitter(200, 480 + intensity * 40)
            this.particle('spark', muzzleX, muzzleY, Math.cos(sparkAngle) * speed, Math.sin(sparkAngle) * speed, jitter(0.08, 0.2), jitter(1.5, 3), i % 3 === 0 ? this.weapon.accentColor : this.weapon.primaryColor, 0, 0.3, 0)
        }
        if (this.weapon.type === 'launcher') {
            this.trauma = Math.max(this.trauma, 0.18 + intensity * 0.03)
            this.ring(muzzleX, muzzleY, 35 + intensity * 6, this.weapon.primaryColor, 0.18, 4)
            for (let i = 0; i < 3; i++) this.particle('smoke', muzzleX, muzzleY, Math.cos(angle) * jitter(40, 120), Math.sin(angle) * jitter(40, 120) - 20, 0.6, 12, '#000000', -30, 2.2, 0)
        }
        return true
    }

    /**
     * Rail Driver: an instant slug along the aim that hits every shape on the
     * line, losing a little damage per body. Infinite Rail softens that loss,
     * Pinball Murder reflects the slug off the arena walls.
     */
    private fireRail(x: number, y: number, angle: number, damageMultiplier: number, triggersHealing: boolean, source: DamageSource) {
        const twinFang = this.upgrades.twinFang ?? 0
        const effectiveTwinStacks = Math.min(2, twinFang)
        const count = 1 + effectiveTwinStacks * 2
        const overflowDamage = 1 + Math.max(0, twinFang - effectiveTwinStacks) * 0.08
        const giantStacks = this.upgrades.giantRounds ?? 0
        const giant = Math.min(3, giantStacks)
        const velocity = Math.min(4, this.upgrades.hyperVelocity ?? 0)
        const baseDamage = this.stats.damage * this.weapon.damageMultiplier * damageMultiplier * overflowDamage
            * Math.pow(1.35, giant) * (1 + Math.max(0, giantStacks - giant) * 0.1) * shapezzHyperVelocityDamage(velocity)
        const retain = Math.min(0.97, 0.85 + Math.min(3, this.upgrades.railPierce ?? 0) * 0.04)
        const reflections = Math.min(2, this.upgrades.ricochet ?? 0)
        const width = 8 + giant * 5 + this.weapon.visualIntensity
        const intensity = this.weapon.visualIntensity

        for (let shot = 0; shot < count; shot++) {
            let direction = angle + (count === 1 ? 0 : (shot - (count - 1) / 2) * 0.07)
            let fromX = x
            let fromY = y
            let damage = baseDamage
            let firstHit = true
            const hit = new Set<number>()
            for (let segment = 0; segment <= reflections; segment++) {
                const dx = Math.cos(direction)
                const dy = Math.sin(direction)
                // Distance to the arena edge along the ray.
                const tx = dx > 0 ? (WIDTH - fromX) / dx : dx < 0 ? -fromX / dx : Infinity
                const ty = dy > 0 ? (FLOOR_Y - fromY) / dy : dy < 0 ? -fromY / dy : Infinity
                const length = Math.max(0, Math.min(tx, ty))
                const toX = fromX + dx * length
                const toY = fromY + dy * length
                const targets = this.enemies
                    .filter((enemy) => {
                        if (enemy.hp <= 0 || hit.has(enemy.id)) return false
                        const reach = width / 2 + enemy.radius
                        return distanceToSegmentSquared(enemy.x, enemy.y, fromX, fromY, toX, toY) < reach * reach
                    })
                    .sort((a, b) => distanceSquared(a, { x: fromX, y: fromY }) - distanceSquared(b, { x: fromX, y: fromY }))
                for (const enemy of targets) {
                    hit.add(enemy.id)
                    this.hitEnemy(enemy, damage, this.weapon.primaryColor, enemy.x, enemy.y, source, { triggersHealing })
                    this.sparks(enemy.x, enemy.y, this.weapon.accentColor, 4 + intensity, 480, direction)
                    this.particle('glow', enemy.x, enemy.y, 0, 0, 0.12, enemy.radius * 2.4, this.weapon.primaryColor, 0, 1, 0)
                    if (firstHit && damageMultiplier >= 1) {
                        firstHit = false
                        this.triggerArcPrimaryImpact(enemy, damage, triggersHealing)
                    }
                    if (!enemy.boss) {
                        enemy.vx += dx * 120
                        enemy.vy += dy * 120
                    }
                    damage *= retain
                }
                this.lances.push({ from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, life: 0.22, maxLife: 0.22, width, color: this.weapon.primaryColor, glow: this.weapon.accentColor })
                if (segment === reflections) break
                this.ring(toX, toY, 30, this.weapon.primaryColor, 0.2, 3)
                this.sparks(toX, toY, this.weapon.primaryColor, 6, 300)
                if (tx < ty) direction = Math.PI - direction
                else direction = -direction
                fromX = clamp(toX, 1, WIDTH - 1)
                fromY = clamp(toY, 1, FLOOR_Y - 1)
            }
        }
        this.particle('glow', x, y, 0, 0, 0.12, 50 + intensity * 6, this.weapon.primaryColor, 0, 0.6, 0)
        this.sparks(x, y, this.weapon.accentColor, 6 + intensity, 520, angle)
        this.trauma = Math.max(this.trauma, 0.14 + intensity * 0.02)
        return true
    }

    private fireArcCoil(
        x: number,
        y: number,
        angle: number,
        damageMultiplier: number,
        triggersHealing: boolean,
        acquisitionRange: number,
        source: DamageSource
    ) {
        const twinFang = this.upgrades.twinFang ?? 0
        const effectiveTwinStacks = Math.min(2, twinFang)
        const primaryCount = 1 + effectiveTwinStacks * 2
        const overflowDamage = 1 + Math.max(0, twinFang - effectiveTwinStacks) * 0.08
        const giantStacks = this.upgrades.giantRounds ?? 0
        const giant = Math.min(3, giantStacks)
        const velocity = Math.min(4, this.upgrades.hyperVelocity ?? 0)
        const arcDamage = this.stats.damage
            * this.weapon.damageMultiplier
            * damageMultiplier
            * overflowDamage
            * Math.pow(1.35, giant)
            * (1 + Math.max(0, giantStacks - giant) * 0.1)
            * shapezzHyperVelocityDamage(velocity)
        const extraHops = Math.min(3, this.upgrades.railPierce ?? 0) + Math.min(2, this.upgrades.ricochet ?? 0)
        const maxHops = this.weapon.chainCount + extraHops
        const decay = Math.min(0.94, 0.82 + velocity * 0.03)
        const hit = new Set<number>()
        let fired = false

        for (let primaryIndex = 0; primaryIndex < primaryCount; primaryIndex++) {
            const primary = this.aimedEnemy({ x, y }, angle, acquisitionRange, hit)
            if (!primary) break
            fired = true
            let sourcePoint: Point = { x, y }
            let target: Enemy | null = primary
            let hopDamage = arcDamage

            for (let hop = 0; target && hop <= maxHops; hop++) {
                const currentTarget: Enemy = target
                hit.add(currentTarget.id)
                this.beam(sourcePoint.x, sourcePoint.y, currentTarget.x, currentTarget.y, hop === 0 ? this.weapon.primaryColor : this.weapon.accentColor, 3 + this.weapon.visualIntensity * 0.65 + giant * 1.5, 0.13, true)
                this.particle('glow', currentTarget.x, currentTarget.y, 0, 0, 0.12, currentTarget.radius * 2.2, this.weapon.primaryColor, 0, 0.8, 0)
                this.hitEnemy(currentTarget, hopDamage, this.weapon.primaryColor, currentTarget.x, currentTarget.y, source, { triggersHealing })
                if (hop === 0) this.triggerArcPrimaryImpact(currentTarget, hopDamage, triggersHealing)
                sourcePoint = { x: currentTarget.x, y: currentTarget.y }
                target = this.nearestEnemy(sourcePoint, this.weapon.chainRange, undefined, hit)
                hopDamage *= decay
            }
        }

        if (!fired) return false
        this.particle('glow', x, y, 0, 0, 0.09, 30, this.weapon.primaryColor, 0, 0.5, 0)
        this.sparks(x, y, this.weapon.accentColor, 3 + this.weapon.visualIntensity, 260)
        return true
    }

    private triggerArcPrimaryImpact(enemy: Enemy, impactDamage: number, triggersHealing: boolean) {
        const explosive = Math.min(4, this.upgrades.explosive ?? 0)
        if (explosive > 0) {
            const radius = 64 + explosive * 24
            const blastDamage = impactDamage * (0.55 + explosive * 0.15)
            this.sfx('explosion', enemy.x)
            this.explosion(enemy.x, enemy.y, radius, '#fb7185', false)
            for (const target of this.enemies) {
                if (target.id !== enemy.id && distance(target, enemy) < radius) {
                    this.hitEnemy(target, blastDamage, '#fb7185', target.x, target.y, 'explosive', { triggersHealing })
                }
            }
        }
        this.chainLightning(enemy, impactDamage, this.weapon.chainRange, triggersHealing)
    }

    private chainLightning(enemy: Enemy, impactDamage: number, range: number, triggersHealing: boolean) {
        const chains = Math.min(3, this.upgrades.chainLightning ?? 0)
        if (chains <= 0) return
        let source: Enemy = enemy
        const hit = new Set<number>([enemy.id])
        let arced = false
        for (let i = 0; i < 1 + chains * 2; i++) {
            const target = this.nearestEnemy(source, range, undefined, hit)
            if (!target) break
            hit.add(target.id)
            arced = true
            this.beam(source.x, source.y, target.x, target.y, '#c4b5fd', 3 + chains, 0.18, true)
            this.hitEnemy(target, impactDamage * 0.5, '#c4b5fd', target.x, target.y, 'chain', { triggersHealing })
            source = target
        }
        if (arced) this.sfx('chain-lightning', enemy.x)
    }

    private createPlayerBullet(
        x: number,
        y: number,
        angle: number,
        damageMultiplier: number,
        homing: boolean,
        secondaryEffects: boolean,
        triggersHealing: boolean,
        source: DamageSource,
        priority: ShapezzBulletPriority,
        independentVisual?: { color: string, radius?: number }
    ) {
        if (!this.reserveBulletSlot(priority)) return
        // `independentVisual` only opts out of the *look* of the shot. Damage scaling still applies —
        // zeroing giantStacks here is what silently gutted orbitals and afterimage turrets.
        const giantStacks = this.upgrades.giantRounds ?? 0
        const giant = Math.min(3, giantStacks)
        const velocity = independentVisual ? 0 : Math.min(4, this.upgrades.hyperVelocity ?? 0)
        const speed = independentVisual ? 620 : this.playerBulletSpeed()
        this.bullets.push({
            x, y, prevX: x, prevY: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            damage: this.stats.damage * this.weapon.damageMultiplier * damageMultiplier * Math.pow(1.35, giant)
                * (1 + Math.max(0, giantStacks - giant) * 0.1) * shapezzHyperVelocityDamage(velocity),
            radius: independentVisual ? (independentVisual.radius ?? 4.5) : 5 * this.weapon.projectileSizeMultiplier * Math.pow(1.7, giant),
            life: 2.5,
            pierce: Math.min(6, (this.upgrades.railPierce ?? 0) * 2),
            bounces: Math.min(6, (this.upgrades.ricochet ?? 0) * 2),
            color: independentVisual ? independentVisual.color : (giant > 0 ? '#fb923c' : this.weapon.primaryColor),
            accentColor: independentVisual ? independentVisual.color : this.weapon.accentColor,
            homing,
            trail: independentVisual ? false : (velocity > 0 || this.weapon.visualIntensity >= 2 || this.weapon.type === 'launcher'),
            explosionRadius: independentVisual ? 0 : this.weapon.explosionRadius,
            traveled: 0,
            falloffStart: independentVisual ? 99999 : this.weapon.falloffStart,
            falloffEnd: independentVisual ? 99999 : this.weapon.falloffEnd,
            minFalloffDamage: independentVisual ? 1 : this.weapon.minFalloffDamage,
            visualIntensity: independentVisual ? 0 : this.weapon.visualIntensity,
            secondaryEffects,
            triggersHealing,
            hitIds: new Set(),
            priority,
            source
        })
        this.liveBullets++
    }

    /**
     * Make room for a new player projectile. When the pool is full the oldest
     * live bullet of a lower priority is retired; the main gun may also retire
     * its own oldest shot, so pulling the trigger always fires.
     */
    private reserveBulletSlot(priority: ShapezzBulletPriority) {
        if (this.liveBullets < SHAPEZZ_COMBAT_LIMITS.playerBullets) return true
        const maxVictimPriority = priority === SHAPEZZ_BULLET_PRIORITY.weapon ? priority : priority - 1
        for (let victimPriority = 0; victimPriority <= maxVictimPriority; victimPriority++) {
            let cursor = this.evictCursor[victimPriority] ?? 0
            while (cursor < this.bullets.length) {
                const candidate = this.bullets[cursor]!
                cursor++
                if (candidate.life > 0 && candidate.priority === victimPriority) {
                    candidate.life = 0
                    this.liveBullets--
                    this.evictCursor[victimPriority] = cursor
                    return true
                }
            }
            this.evictCursor[victimPriority] = cursor
        }
        return false
    }

    private updateBullets(dt: number) {
        this.evictCursor = [0, 0, 0]
        const count = this.bullets.length
        let keptCount = 0
        for (let index = 0; index < count; index++) {
            const bullet = this.bullets[index]!
            if (bullet.life <= 0) continue
            bullet.life -= dt
            if (bullet.life <= 0) {
                this.liveBullets--
                continue
            }
            const previousX = bullet.x
            const previousY = bullet.y
            bullet.prevX = previousX
            bullet.prevY = previousY

            if (bullet.homing && bullet.priority === SHAPEZZ_BULLET_PRIORITY.weapon && this.weapon.type === 'shotgun') {
                // Scatter Array missiles only lock onto shapes roughly ahead of them and turn
                // slowly, so the volley still has to be aimed; they correct, not hunt.
                const heading = Math.atan2(bullet.vy, bullet.vx)
                const target = this.aimedEnemy(bullet, heading, 220, undefined, 0.3)
                if (target) {
                    const turn = clamp(angleDelta(heading, Math.atan2(target.y - bullet.y, target.x - bullet.x)), -1.6 * dt, 1.6 * dt)
                    const speed = Math.hypot(bullet.vx, bullet.vy)
                    bullet.vx = Math.cos(heading + turn) * speed
                    bullet.vy = Math.sin(heading + turn) * speed
                }
            } else if (bullet.homing && this.enemies.length) {
                const target = this.nearestEnemy(bullet, 480)
                if (target) {
                    const direction = normalized(target.x - bullet.x, target.y - bullet.y)
                    const speed = Math.hypot(bullet.vx, bullet.vy)
                    bullet.vx += (direction.x * speed - bullet.vx) * Math.min(1, dt * 8)
                    bullet.vy += (direction.y * speed - bullet.vy) * Math.min(1, dt * 8)
                }
            }

            bullet.x += bullet.vx * dt
            bullet.y += bullet.vy * dt
            bullet.traveled += Math.hypot(bullet.vx, bullet.vy) * dt

            if (bullet.trail && Math.random() < dt * (6 + bullet.visualIntensity * 5)) {
                const trailLife = 0.18 + bullet.visualIntensity * 0.045
                this.particle(
                    bullet.visualIntensity >= 4 && Math.random() < 0.35 ? 'square' : 'dot',
                    bullet.x, bullet.y,
                    -bullet.vx * 0.04 + jitter(-25, 25), -bullet.vy * 0.04 + jitter(-25, 25),
                    trailLife, bullet.radius * jitter(0.35, 0.75 + bullet.visualIntensity * 0.08),
                    Math.random() < 0.28 ? bullet.accentColor : bullet.color, 0, 0.2, 0
                )
            }

            let remove = false
            const padding = bullet.radius + MAX_ENEMY_RADIUS
            const minColumn = clamp(Math.floor((Math.min(previousX, bullet.x) - padding + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_COLUMNS - 1)
            const maxColumn = clamp(Math.floor((Math.max(previousX, bullet.x) + padding + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_COLUMNS - 1)
            const minRow = clamp(Math.floor((Math.min(previousY, bullet.y) - padding + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_ROWS - 1)
            const maxRow = clamp(Math.floor((Math.max(previousY, bullet.y) + padding + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_ROWS - 1)
            collision: for (let row = minRow; row <= maxRow; row++) {
                for (let column = minColumn; column <= maxColumn; column++) {
                    const enemies = this.enemyGrid.get(column + row * ENEMY_GRID_COLUMNS)
                    if (!enemies) continue
                    for (const enemy of enemies) {
                        const collisionRadius = bullet.radius + enemy.radius
                        if (enemy.hp <= 0 || bullet.hitIds.has(enemy.id) || distanceToSegmentSquared(enemy.x, enemy.y, previousX, previousY, bullet.x, bullet.y) > collisionRadius * collisionRadius) continue
                        bullet.hitIds.add(enemy.id)
                        const impactDamage = this.bulletImpactDamage(bullet)
                        this.hitEnemy(enemy, impactDamage, bullet.color, bullet.x, bullet.y, bullet.source, { triggersHealing: bullet.triggersHealing })
                        if (!enemy.boss) {
                            const shove = Math.min(170, 30 + impactDamage / Math.max(1, enemy.maxHp) * 260) * (enemy.type === 'tank' || enemy.type === 'warden' ? 0.35 : 1)
                            const direction = normalized(bullet.vx, bullet.vy)
                            enemy.vx += direction.x * shove
                            enemy.vy += direction.y * shove
                        }
                        this.triggerImpact(enemy, bullet, impactDamage)
                        if (bullet.pierce > 0) bullet.pierce--
                        else if (bullet.bounces > 0) {
                            bullet.bounces--
                            bullet.hitIds.clear()
                            bullet.hitIds.add(enemy.id)
                            const target = this.nearestEnemy(enemy, 520, enemy.id)
                            if (target) {
                                const direction = normalized(target.x - bullet.x, target.y - bullet.y)
                                const speed = Math.hypot(bullet.vx, bullet.vy)
                                bullet.vx = direction.x * speed
                                bullet.vy = direction.y * speed
                                this.beam(enemy.x, enemy.y, target.x, target.y, '#fde047', 2, 0.12, false)
                            } else bullet.vx *= -1
                        } else remove = true
                        break collision
                    }
                }
            }

            if (!remove && (bullet.x < 0 || bullet.x > WIDTH || bullet.y < 0 || bullet.y > HEIGHT)) {
                if (bullet.bounces > 0) {
                    if (bullet.x < 0 || bullet.x > WIDTH) bullet.vx *= -1
                    if (bullet.y < 0 || bullet.y > HEIGHT) bullet.vy *= -1
                    bullet.x = clamp(bullet.x, 2, WIDTH - 2)
                    bullet.y = clamp(bullet.y, 2, HEIGHT - 2)
                    bullet.bounces--
                    bullet.hitIds.clear()
                    this.sparks(bullet.x, bullet.y, bullet.color, 3, 180)
                } else remove = true
            }
            if (remove) {
                bullet.life = 0
                this.liveBullets--
                continue
            }
            this.bullets[keptCount++] = bullet
        }
        // Bullets created during this pass (bounces, novas, shards) sit past `count`.
        for (let index = count; index < this.bullets.length; index++) {
            const bullet = this.bullets[index]!
            if (bullet.life > 0) this.bullets[keptCount++] = bullet
        }
        this.bullets.length = keptCount
        this.liveBullets = keptCount
    }

    private bulletImpactDamage(bullet: Bullet) {
        if (bullet.traveled <= bullet.falloffStart) return bullet.damage
        const falloffProgress = clamp((bullet.traveled - bullet.falloffStart) / Math.max(1, bullet.falloffEnd - bullet.falloffStart), 0, 1)
        return bullet.damage * (1 - falloffProgress * (1 - bullet.minFalloffDamage))
    }

    private triggerImpact(enemy: Enemy, bullet: Bullet, impactDamage: number) {
        const isShotgunBullet = this.weapon.type === 'shotgun' && bullet.visualIntensity > 0
        const intensity = bullet.visualIntensity
        this.particle('glow', bullet.x, bullet.y, 0, 0, 0.1, bullet.radius * 5 + 10, bullet.color, 0, 0.5, 0)
        this.sparks(bullet.x, bullet.y, bullet.color, isShotgunBullet ? 2 : 3 + intensity, 260 + intensity * 30, Math.atan2(-bullet.vy, -bullet.vx))
        if (intensity >= 3 && (!isShotgunBullet || bullet.secondaryEffects)) this.burst(bullet.x, bullet.y, bullet.accentColor, intensity, 320)
        if (!bullet.secondaryEffects) return
        const explosive = Math.min(4, this.upgrades.explosive ?? 0)
        if (explosive > 0 || bullet.explosionRadius > 0) {
            const radius = Math.max(64, bullet.explosionRadius) + explosive * 24
            const explosionColor = bullet.explosionRadius > 0 ? bullet.color : '#fb7185'
            const blastDamage = impactDamage * (bullet.explosionRadius > 0 ? 0.78 + intensity * 0.04 : 0.55 + explosive * 0.15)
            this.sfx(radius > 150 ? 'explosion-big' : 'explosion', bullet.x)
            this.explosion(bullet.x, bullet.y, radius, explosionColor, bullet.explosionRadius > 0)
            for (const target of this.enemies) {
                const targetDistance = distance(target, bullet)
                if (target.id !== enemy.id && targetDistance < radius) {
                    const damageMultiplier = bullet.explosionRadius > 0
                        ? shapezzExplosionDamageMultiplier(targetDistance, radius)
                        : 1
                    this.hitEnemy(target, blastDamage * damageMultiplier, explosionColor, target.x, target.y, bullet.explosionRadius > 0 ? bullet.source : 'explosive', { triggersHealing: bullet.triggersHealing })
                }
            }
            this.trauma = Math.max(this.trauma, 0.12 + explosive * 0.05 + intensity * 0.03)
        }

        this.chainLightning(enemy, impactDamage, 210, bullet.triggersHealing)
    }

    // ─── Damage and kills ───────────────────────────────────────────────────

    private hitEnemy(
        enemy: Enemy,
        damage: number,
        color: string,
        x: number,
        y: number,
        source: DamageSource,
        options: { allowOverkillDividend?: boolean, triggersHealing?: boolean } = {}
    ) {
        if (enemy.hp <= 0) return
        const allowOverkillDividend = options.allowOverkillDividend ?? true
        const triggersHealing = options.triggersHealing ?? true
        let amount = damage
        let crit = false
        const critStats = shapezzCritStats(this.upgrades.overcharge ?? 0)
        if (critStats.chance > 0 && CRIT_SOURCES.has(source) && randomChance(critStats.chance)) {
            amount *= critStats.multiplier
            crit = true
        }
        const armored = enemy.shielded
        if (armored) amount *= SHAPEZZ_WARDEN_DAMAGE_TAKEN
        const previousHp = enemy.hp
        const dealt = Math.min(enemy.hp, amount)
        enemy.hp -= amount
        enemy.hitFlash = 0.08
        this.damageBySource[source] = (this.damageBySource[source] ?? 0) + dealt
        this.sfx(crit ? 'hit-crit' : armored ? 'hit-armor' : 'hit-enemy', x)
        if (crit) {
            this.sparks(x, y, '#f472b6', 6, 420)
            this.particle('glow', x, y, 0, 0, 0.14, 40, '#f472b6', 0, 1.4, 0)
        }
        if (armored) this.ring(x, y, enemy.radius + 10, '#60a5fa', 0.15, 2)
        this.text(
            x, y, crit ? `${Math.round(dealt)}!` : Math.round(dealt).toString(),
            crit ? '#f9a8d4' : armored ? '#93c5fd' : color,
            clamp(12 + Math.log2(Math.max(2, dealt)) * 2, 14, 34) * (crit ? 1.35 : 1), 0.65, crit
        )
        if (enemy.hp <= 0) {
            this.killEnemy(enemy, triggersHealing)
            if (allowOverkillDividend) this.triggerOverkillDividend(enemy, Math.max(0, amount - previousHp), triggersHealing)
            return
        }

        const executionThreshold = shapezzExecutionThreshold(this.upgrades.executioner ?? 0) * (enemy.boss ? 0.5 : 1)
        if (executionThreshold > 0 && enemy.hp / enemy.maxHp <= executionThreshold) {
            this.text(enemy.x, enemy.y - enemy.radius, 'EXECUTE', '#fb7185', enemy.boss ? 30 : 19, 0.75)
            this.damageBySource.execute = (this.damageBySource.execute ?? 0) + enemy.hp
            this.beam(enemy.x - enemy.radius * 1.4, enemy.y - enemy.radius * 1.4, enemy.x + enemy.radius * 1.4, enemy.y + enemy.radius * 1.4, '#fb7185', 5, 0.2, false)
            this.sfx('execute', enemy.x)
            enemy.hp = 0
            this.killEnemy(enemy, triggersHealing)
        }
    }

    private triggerOverkillDividend(enemy: Enemy, excessDamage: number, triggersHealing: boolean) {
        const stacks = this.upgrades.overkillDividend ?? 0
        if (stacks <= 0 || excessDamage <= 0) return
        const stats = shapezzOverkillDividendStats(stacks)
        const damage = Math.min(excessDamage * stats.conversion, this.stats.damage * stats.damageCapMultiplier)
        if (damage < 1) return
        this.ring(enemy.x, enemy.y, stats.radius, '#fbbf24', 0.28, 5 + Math.min(5, stacks), true)
        for (const target of this.enemies) {
            if (target.id !== enemy.id && distance(target, enemy) <= stats.radius) {
                this.hitEnemy(target, damage, '#fbbf24', target.x, target.y, 'overkill', { allowOverkillDividend: false, triggersHealing })
            }
        }
    }

    private killEnemy(enemy: Enemy, triggersHealing = true) {
        this.kills++
        this.combo++
        this.maxCombo = Math.max(this.maxCombo, this.combo)
        this.comboTimer = 2.6
        if (this.combo >= this.nextComboMilestone) {
            this.text(this.player.x, this.player.y - 70, `${this.nextComboMilestone} COMBO`, '#facc15', 26, 1.1)
            this.sfx('combo-milestone', this.player.x, { pitch: 1 + Math.min(0.5, this.nextComboMilestone / 400) })
            this.ring(this.player.x, this.player.y, 120, '#facc15', 0.4, 4)
            this.nextComboMilestone += COMBO_MILESTONE
        }

        if (enemy.boss) {
            this.bossesKilled++
            this.trauma = 1
            this.flash = 1
            this.flashColor = enemy.color
            this.hitStop = 0.14
            this.timeScale = 0.25
            this.sfx('boss-death', enemy.x)
            this.explosion(enemy.x, enemy.y, 320, enemy.color, true)
            this.shatter(enemy.x, enemy.y, enemy.radius, enemy.color, 60, 900)
            this.ring(enemy.x, enemy.y, enemy.radius * 6, '#ffffff', 0.9, 14, true)
            this.lasers = this.lasers.filter(laser => laser.ownerId !== enemy.id)
            this.scheduled = this.scheduled.filter(item => item.ownerId !== enemy.id)
            // Aftershocks ripple through the wreck after the hit-stop.
            const wreck = { x: enemy.x, y: enemy.y, radius: enemy.radius, color: enemy.color }
            for (let i = 0; i < 5; i++) {
                this.schedule(0.1 + i * 0.13, -1, () => {
                    this.explosion(wreck.x + jitter(-wreck.radius, wreck.radius), wreck.y + jitter(-wreck.radius, wreck.radius), 80 + i * 22, i % 2 ? '#ffffff' : wreck.color, i === 4)
                    this.sfx('explosion', wreck.x, { pitch: 0.7 + i * 0.08 })
                })
            }
        } else {
            const big = enemy.elite || enemy.radius > 26
            this.trauma = Math.max(this.trauma, big ? 0.3 : 0.08 + enemy.radius * 0.003)
            if (enemy.elite) {
                this.hitStop = Math.max(this.hitStop, 0.04)
                this.flash = Math.max(this.flash, 0.25)
                this.flashColor = '#facc15'
            }
            this.sfx(enemy.elite ? 'elite-death' : 'enemy-death', enemy.x, { pitch: clamp(28 / enemy.radius, 0.6, 1.6) })
            this.particle('glow', enemy.x, enemy.y, 0, 0, 0.16, enemy.radius * 3.4, enemy.color, 0, 1.3, 0)
            this.particle('glow', enemy.x, enemy.y, 0, 0, 0.08, enemy.radius * 1.6, '#ffffff', 0, 1.2, 0)
            this.shatter(enemy.x, enemy.y, enemy.radius, enemy.color, Math.min(14, 4 + Math.round(enemy.radius / 4)) + (enemy.elite ? 10 : 0), 380 + (big ? 160 : 0))
            this.sparks(enemy.x, enemy.y, enemy.color, 6 + Math.round(enemy.radius / 3), 420)
            this.ring(enemy.x, enemy.y, enemy.radius * (enemy.elite ? 4.5 : 2.7), enemy.color, enemy.elite ? 0.5 : 0.35, enemy.elite ? 8 : 5)
            if (enemy.elite) this.sparks(enemy.x, enemy.y, '#facc15', 20, 600)
        }

        if (enemy.type === 'splitter') {
            this.sfx('enemy-split', enemy.x)
            for (let i = 0; i < SHAPEZZ_SPLITTER_SHARDS + (enemy.elite ? 2 : 0); i++) {
                const angle = i / SHAPEZZ_SPLITTER_SHARDS * Math.PI * 2 + enemy.phase
                const shard = this.spawnEnemy('shard', { x: enemy.x, y: enemy.y, vx: Math.cos(angle) * 420, vy: Math.sin(angle) * 420 - 80, noElite: true })
                if (shard) shard.spawnT = 1
            }
        }
        if (enemy.type === 'bomber' && enemy.state !== 2) {
            enemy.state = 2
            this.detonateBomber(enemy, false)
            this.sfx('explosion-big', enemy.x)
        }

        if (triggersHealing) {
            const previousHp = this.player.hp
            this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.stats.healthPerKill)
            const healed = Math.round(this.player.hp - previousHp)
            if (healed > 0 && this.damageTexts.length < SHAPEZZ_COMBAT_LIMITS.damageTexts * 0.6) {
                this.text(this.player.x + jitter(-12, 12), this.player.y - 42, `+${healed}`, '#34d399', 14 + this.stats.healthPerKill, 0.7)
            }
        }

        const pickupCount = enemy.boss ? 12 : enemy.elite ? 4 : 1
        let remaining = enemy.reward
        for (let i = 0; i < pickupCount; i++) {
            const value = i === pickupCount - 1 ? remaining : Math.max(1, Math.floor(enemy.reward / pickupCount))
            remaining -= value
            if (this.pickups.length < SHAPEZZ_COMBAT_LIMITS.pickups) {
                this.pickups.push({ x: enemy.x, y: enemy.y, vx: jitter(-220, 220), vy: jitter(-280, -60), value, life: 12, kind: 'coin', spin: Math.random() * 6 })
            } else this.coins += value
        }
        const healthChance = enemy.minion || enemy.type === 'shard' ? 0 : enemy.elite ? 0.35 : 0.045
        if (this.pickups.length < SHAPEZZ_COMBAT_LIMITS.pickups && (enemy.boss || randomChance(healthChance))) {
            this.pickups.push({ x: enemy.x, y: enemy.y, vx: jitter(-180, 180), vy: -280, value: Math.ceil(this.stats.maxHp * (enemy.boss ? 0.35 : 0.12)), life: 12, kind: 'health', spin: 0 })
        }

        // On-kill projectiles yield to the main gun when the pool runs hot.
        const pressure = this.liveBullets / SHAPEZZ_COMBAT_LIMITS.playerBullets
        const spawnBudget = pressure > 0.85 ? 0.35 : pressure > 0.6 ? 0.65 : 1
        const splitstorm = this.upgrades.splitstorm ?? 0
        if (splitstorm > 0) {
            const visibleSplitstorm = Math.min(3, splitstorm)
            const shardCount = Math.max(2, Math.round((2 + visibleSplitstorm * 3) * spawnBudget))
            const fullCount = 2 + visibleSplitstorm * 3
            const shardDamage = 0.62 * (1 + Math.max(0, splitstorm - visibleSplitstorm) * 0.12) * fullCount / shardCount
            for (let i = 0; i < shardCount; i++) {
                this.createPlayerBullet(enemy.x, enemy.y, i / shardCount * Math.PI * 2, shardDamage, true, false, triggersHealing, 'splitstorm', SHAPEZZ_BULLET_PRIORITY.spawned, { color: '#a78bfa', radius: 4 })
            }
        }

        const deathNova = this.upgrades.deathNova ?? 0
        if (deathNova > 0) {
            const visibleDeathNova = Math.min(3, deathNova)
            const fullCount = 6 + visibleDeathNova * 6
            const novaCount = Math.max(6, Math.round(fullCount * spawnBudget))
            // Fewer shots under load carry the full volley's damage, so the upgrade never quietly weakens.
            const novaDamage = 0.5 * (1 + Math.max(0, deathNova - visibleDeathNova) * 0.1) * fullCount / novaCount
            for (let i = 0; i < novaCount; i++) {
                this.createPlayerBullet(enemy.x, enemy.y, i / novaCount * Math.PI * 2, novaDamage, false, false, triggersHealing, 'nova', SHAPEZZ_BULLET_PRIORITY.spawned, { color: '#facc15', radius: 4.5 })
            }
        }

        const vampire = Math.min(4, this.upgrades.vampireBurst ?? 0)
        if (triggersHealing && vampire > 0) {
            // Counted explicitly rather than with `kills % triggerKills`: taking a stack mid-run
            // changes the threshold, and the modulo phase shift made the trigger fire early or skip.
            this.vampireKills++
            const stats = shapezzVampireBurstStats(vampire)
            if (this.vampireKills >= stats.kills && this.vampireCooldown <= 0) {
                this.vampireKills = 0
                this.vampireCooldown = stats.cooldown
                this.vampireRegenRemaining = stats.duration
                this.vampireRegenRate = this.stats.maxHp * stats.healFraction / stats.duration
                this.text(this.player.x, this.player.y - 40, 'REGEN', '#34d399', 22, 1.1)
                this.ring(this.player.x, this.player.y, 150, '#34d399', 0.5, 7)
                this.sfx('pickup-health', this.player.x)
            }
        }

        const aegis = Math.min(4, this.upgrades.aegisPlating ?? 0)
        if (aegis > 0) {
            this.shieldKills++
            const stats = shapezzShieldStats(aegis)
            if (this.shieldKills >= stats.kills) {
                this.shieldKills = 0
                const previousShield = this.player.shield
                this.player.shield = Math.min(stats.capacity, this.player.shield + stats.amount)
                const gained = Math.round(this.player.shield - previousShield)
                if (gained > 0) {
                    this.sfx('shield-gain', this.player.x)
                    this.text(this.player.x, this.player.y - 52, `+${gained} SHIELD`, '#38bdf8', 20, 1)
                    this.ring(this.player.x, this.player.y, 110, '#38bdf8', 0.4, 5)
                }
            }
        }

        const killShockwaveStacks = this.upgrades.killShockwave ?? 0
        if (killShockwaveStacks > 0) {
            const stats = shapezzKillShockwaveStats(killShockwaveStacks)
            if (this.kills % stats.kills === 0) {
                const damage = this.stats.damage * stats.damageMultiplier
                this.ring(this.player.x, this.player.y, stats.radius, '#22d3ee', 0.58, 9, true)
                this.sparks(this.player.x, this.player.y, '#67e8f9', 24 + Math.min(6, killShockwaveStacks) * 5, 700)
                this.sfx('explosion', this.player.x, { pitch: 0.7 })
                for (const target of this.enemies) {
                    if (distance(target, this.player) <= stats.radius) {
                        this.hitEnemy(target, damage, '#22d3ee', target.x, target.y, 'killquake', { triggersHealing })
                    }
                }
                this.trauma = Math.max(this.trauma, 0.4)
            }
        }
    }

    private damagePlayer(amount: number, cause: string) {
        if (this.player.invulnerable > 0 || !this.running) return
        const absorbed = Math.min(this.player.shield, amount)
        this.player.shield -= absorbed
        this.player.hp -= amount - absorbed
        this.player.invulnerable = 0.58
        this.damageTakenByCause[cause] = (this.damageTakenByCause[cause] ?? 0) + amount
        if (this.player.hp <= 0) this.deathCause = cause
        const fullyAbsorbed = absorbed >= amount
        if (absorbed > 0) {
            this.ring(this.player.x, this.player.y, 74, '#38bdf8', 0.28, 4, true)
            this.sparks(this.player.x, this.player.y, '#38bdf8', 12, 380)
        }
        this.sfx(fullyAbsorbed ? 'shield-hit' : 'player-hurt', this.player.x)
        // A hit halves the combo rather than wiping it, so No Brakes survives a crowded arena.
        this.combo = Math.floor(this.combo / 2)
        this.comboTimer = Math.min(this.comboTimer, 1.2)
        this.nextComboMilestone = (Math.floor(this.combo / COMBO_MILESTONE) + 1) * COMBO_MILESTONE
        this.trauma = Math.max(this.trauma, fullyAbsorbed ? 0.3 : 0.55)
        this.flash = Math.max(this.flash, fullyAbsorbed ? 0.2 : 0.45)
        this.flashColor = fullyAbsorbed ? '#38bdf8' : '#fb7185'
        this.hitStop = Math.max(this.hitStop, 0.035)
        this.player.hurtFlash = 1
        if (!fullyAbsorbed) {
            this.burst(this.player.x, this.player.y, '#fb7185', 20, 470)
            this.shatter(this.player.x, this.player.y, 14, '#ecfeff', 5, 360)
        }
        this.text(this.player.x, this.player.y - 35, `-${Math.ceil(amount)}`, fullyAbsorbed ? '#38bdf8' : '#fb7185', 25, 0.8)
    }

    // ─── Pickups and companions ─────────────────────────────────────────────

    private updatePickups(dt: number) {
        let keptCount = 0
        for (const pickup of this.pickups) {
            pickup.life -= dt
            pickup.spin += dt * 4
            pickup.vy += (pickup.kind === 'coin' ? COIN_GRAVITY : 720) * dt
            pickup.x += pickup.vx * dt
            pickup.y += pickup.vy * dt
            const groundClearance = pickup.kind === 'coin' ? 9 : 6
            if (pickup.y > FLOOR_Y - groundClearance) {
                pickup.y = FLOOR_Y - groundClearance
                pickup.vy *= -0.45
                pickup.vx *= 0.82
            }
            pickup.x = clamp(pickup.x, 8, WIDTH - 8)
            const dist = distance(pickup, this.player)
            if (dist < this.stats.magnetRange) {
                const inverseDistance = 1 / (dist || 1)
                const pull = 500 + (this.stats.magnetRange - dist) * 12
                pickup.vx += (this.player.x - pickup.x) * inverseDistance * pull * dt
                pickup.vy += (this.player.y - pickup.y) * inverseDistance * pull * dt
            }
            if (dist < 28) {
                if (pickup.kind === 'coin') this.coins += pickup.value
                else {
                    this.player.hp = Math.min(this.stats.maxHp, this.player.hp + pickup.value)
                    this.text(this.player.x, this.player.y - 50, `+${pickup.value} HP`, '#34d399', 20, 0.9)
                    this.ring(this.player.x, this.player.y, 70, '#34d399', 0.35, 4)
                }
                this.sfx(pickup.kind === 'coin' ? 'pickup-coin' : 'pickup-health', pickup.x)
                this.particle('glow', pickup.x, pickup.y, 0, 0, 0.14, 24, pickup.kind === 'coin' ? COIN_COLOR : '#34d399', 0, 1.2, 0)
                this.burst(pickup.x, pickup.y, pickup.kind === 'coin' ? COIN_COLOR : '#34d399', 4, 160)
                continue
            }
            if (pickup.life > 0) this.pickups[keptCount++] = pickup
        }
        this.pickups.length = keptCount
    }

    /** World positions of the orbital guns this frame (also used to swat enemy shots). */
    orbitalPositions(): Point[] {
        const orbitals = Math.min(6, (this.upgrades.orbitals ?? 0) * 2)
        const positions: Point[] = []
        for (let i = 0; i < orbitals; i++) {
            const angle = this.elapsedMs / 700 + i / orbitals * Math.PI * 2
            positions.push({ x: this.player.x + Math.cos(angle) * 72, y: this.player.y + Math.sin(angle) * 72 })
        }
        return positions
    }

    dronePositions(time: number): Point[] {
        const drones = Math.min(6, (this.upgrades.droneSwarm ?? 0) * 2)
        const positions: Point[] = []
        for (let i = 0; i < drones; i++) {
            positions.push({ x: this.player.x + (i - (drones - 1) / 2) * 38, y: this.player.y - 65 - Math.sin(time * 5 + i) * 15 })
        }
        return positions
    }

    ceilingBatteryPosition(index: number, count: number): Point {
        // Hung below the boss health bar at the top of the arena.
        return { x: WIDTH / 2 + (index - (count - 1) / 2) * 64, y: 66 }
    }

    private updateCompanions(dt: number) {
        const ceilingBatteries = Math.min(6, this.upgrades.ceilingBattery ?? 0)
        if (ceilingBatteries > 0 && this.ceilingBatteryCooldown <= 0 && this.enemies.length) {
            let fired = false
            for (let i = 0; i < ceilingBatteries; i++) {
                const origin = this.ceilingBatteryPosition(i, ceilingBatteries)
                const target = this.nearestEnemy(origin, 920)
                if (!target) continue
                fired = this.firePlayerVolley(
                    origin.x,
                    origin.y + 14,
                    Math.atan2(target.y - origin.y, target.x - origin.x),
                    1,
                    false,
                    target,
                    this.weapon.type === 'arcCoil' ? 920 : this.weapon.chainRange,
                    'ceiling'
                ) || fired
            }
            if (fired) this.sfx('drone-shoot', WIDTH / 2)
            const requestedFireRate = this.stats.fireRate * this.weapon.fireRateMultiplier * this.frenzyMultiplier()
            const clonedFireRate = Math.min(shapezzWeaponFireRateCap(this.weapon.type), requestedFireRate) * 0.82
            this.ceilingBatteryCooldown = 1 / Math.max(0.1, clonedFireRate)
        }

        if (this.orbitalCooldown <= 0 && this.enemies.length) {
            const positions = this.orbitalPositions()
            for (const origin of positions) {
                const target = this.nearestEnemy(origin, 650)
                if (!target) continue
                this.createPlayerBullet(origin.x, origin.y, Math.atan2(target.y - origin.y, target.x - origin.x), SHAPEZZ_TURRET_DAMAGE_MULTIPLIER, true, false, true, 'orbital', SHAPEZZ_BULLET_PRIORITY.companion, { color: '#f0abfc', radius: 4.5 })
                this.particle('glow', origin.x, origin.y, 0, 0, 0.08, 18, '#f0abfc', 0, 0.6, 0)
            }
            if (positions.length) {
                this.sfx('drone-shoot', this.player.x, { pitch: 0.85 })
                this.orbitalCooldown = 0.7
            }
        }

        if (this.droneCooldown <= 0 && this.enemies.length) {
            const positions = this.dronePositions(this.elapsedMs / 1000)
            for (const origin of positions) {
                const target = this.nearestEnemy(origin, 760)
                if (!target) continue
                this.createPlayerBullet(origin.x, origin.y, Math.atan2(target.y - origin.y, target.x - origin.x), SHAPEZZ_TURRET_DAMAGE_MULTIPLIER, true, false, true, 'drone', SHAPEZZ_BULLET_PRIORITY.companion, { color: '#34d399', radius: 3 })
                this.beam(origin.x, origin.y, target.x, target.y, '#34d399', 2, 0.08, false)
            }
            if (positions.length) {
                this.sfx('drone-shoot', this.player.x, { pitch: 1.2 })
                this.droneCooldown = 0.6
            }
        }

        let keptTurrets = 0
        for (const turret of this.turrets) {
            turret.life -= dt
            turret.fireCooldown -= dt
            turret.recoil = Math.max(0, turret.recoil - dt * 8)
            const target = this.nearestEnemy(turret, 620)
            if (target) turret.angle = Math.atan2(target.y - turret.y, target.x - turret.x)
            if (target && turret.fireCooldown <= 0) {
                this.createPlayerBullet(turret.x + Math.cos(turret.angle) * 20, turret.y + Math.sin(turret.angle) * 20, turret.angle, SHAPEZZ_TURRET_DAMAGE_MULTIPLIER, false, false, true, 'turret', SHAPEZZ_BULLET_PRIORITY.companion, { color: '#2dd4bf', radius: 4 })
                this.sfx('drone-shoot', turret.x)
                turret.fireCooldown = 0.55
                turret.recoil = 1
            }
            if (turret.life > 0) this.turrets[keptTurrets++] = turret
            else this.burst(turret.x, turret.y, '#2dd4bf', 8, 180)
        }
        this.turrets.length = keptTurrets

        const blackHole = this.upgrades.blackHole ?? 0
        if (blackHole > 0 && this.blackHoleCooldown <= 0 && this.firing && this.enemies.length) {
            const stats = shapezzBlackHoleStats(blackHole)
            this.blackHoleCooldown = stats.interval
            this.singularities.push({ x: this.aim.x, y: clamp(this.aim.y, 60, FLOOR_Y - 20), life: stats.duration, maxLife: stats.duration, radius: stats.radius, damageTick: 0, triggersHealing: true })
            if (this.singularities.length > SHAPEZZ_COMBAT_LIMITS.singularities) this.singularities.shift()
            this.ring(this.aim.x, this.aim.y, stats.radius, '#e879f9', 0.4, 6, true)
            this.sfx('singularity', this.aim.x)
        }

        const lance = this.upgrades.prismLance ?? 0
        if (lance > 0 && this.lanceCooldown <= 0 && this.firing && this.enemies.length) {
            const stats = shapezzPrismLanceStats(lance)
            this.lanceCooldown = stats.interval
            this.firePrismLance(stats.damageMultiplier, stats.width)
        }
    }

    private firePrismLance(damageMultiplier: number, width: number) {
        const angle = Math.atan2(this.aim.y - this.player.y, this.aim.x - this.player.x)
        const from = { x: this.player.x + Math.cos(angle) * 24, y: this.player.y - 6 + Math.sin(angle) * 24 }
        const to = { x: from.x + Math.cos(angle) * 1700, y: from.y + Math.sin(angle) * 1700 }
        const damage = this.stats.damage * this.weapon.damageMultiplier * damageMultiplier
        this.lances.push({ from, to, life: 0.4, maxLife: 0.4, width, color: '#fde68a', glow: '#f472b6' })
        this.sfx('lance', this.player.x)
        this.trauma = Math.max(this.trauma, 0.35)
        this.player.recoil = 1.6
        const targets = this.enemies.filter(enemy => {
            const reach = width / 2 + enemy.radius
            return enemy.hp > 0 && distanceToSegmentSquared(enemy.x, enemy.y, from.x, from.y, to.x, to.y) < reach * reach
        })
        for (const enemy of targets) {
            this.hitEnemy(enemy, damage, '#fde68a', enemy.x, enemy.y, 'lance')
            this.sparks(enemy.x, enemy.y, '#fde68a', 8, 520, angle)
        }
        // The lance also burns hostile shots out of the air.
        const erase = width / 2 + 6
        this.enemyBullets = this.enemyBullets.filter(bullet => {
            if (distanceToSegmentSquared(bullet.x, bullet.y, from.x, from.y, to.x, to.y) >= erase * erase) return true
            this.particle('glow', bullet.x, bullet.y, 0, 0, 0.2, bullet.radius * 3, '#fde68a', 0, 1, 0)
            return false
        })
        for (let i = 0; i < 26; i++) {
            const t = Math.random() * 0.8
            this.particle('spark', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, jitter(-240, 240), jitter(-240, 240), jitter(0.2, 0.45), jitter(2, 4), i % 2 ? '#fde68a' : '#ffffff', 0, 0.3, 0)
        }
    }

    private updateSingularities(dt: number) {
        let keptCount = 0
        const stats = shapezzBlackHoleStats(this.upgrades.blackHole ?? 1)
        for (const singularity of this.singularities) {
            singularity.life -= dt
            singularity.damageTick -= dt
            for (const enemy of this.enemies) {
                const dist = distance(singularity, enemy)
                if (dist > singularity.radius * 1.8) continue
                const inverseDistance = 1 / (dist || 1)
                const pull = (1 - clamp(dist / (singularity.radius * 1.8), 0, 1)) * (enemy.boss ? 120 : 1000)
                enemy.vx += (singularity.x - enemy.x) * inverseDistance * pull * dt
                enemy.vy += (singularity.y - enemy.y) * inverseDistance * pull * dt
                if (singularity.damageTick <= 0 && dist < singularity.radius) {
                    this.hitEnemy(enemy, this.stats.damage * stats.tickDamage, '#e879f9', enemy.x, enemy.y, 'singularity', { triggersHealing: singularity.triggersHealing })
                }
            }
            if (Math.random() < dt * 30) {
                const angle = Math.random() * Math.PI * 2
                const r = singularity.radius * jitter(0.8, 1.3)
                this.particle('spark', singularity.x + Math.cos(angle) * r, singularity.y + Math.sin(angle) * r, -Math.cos(angle) * r * 2.5, -Math.sin(angle) * r * 2.5, 0.35, 2.5, Math.random() < 0.5 ? '#e879f9' : '#c4b5fd', 0, 0.2, 0)
            }
            if (singularity.damageTick <= 0) singularity.damageTick = 0.16
            if (singularity.life > 0) this.singularities[keptCount++] = singularity
            else {
                this.ring(singularity.x, singularity.y, singularity.radius * 1.2, '#e879f9', 0.35, 6, true)
                this.burst(singularity.x, singularity.y, '#e879f9', 18, 380)
            }
        }
        this.singularities.length = keptCount
    }

    // ─── Checkpoints ────────────────────────────────────────────────────────

    private openCheckpoint() {
        this.running = false
        this.checkpointOpen = true
        this.trauma = 0.6
        this.flash = 0.8
        this.flashColor = '#ffffff'
        this.callbacks.onCheckpoint(this.rollUpgradeOffers(), this.snapshot())
    }

    rollUpgradeOffers(): ShapezzRunUpgradeId[] {
        const pool = [...SHAPEZZ_RUN_UPGRADES]
        const offers: ShapezzRunUpgradeId[] = []
        while (offers.length < 3 && pool.length) {
            const weighted = pool.flatMap(upgrade => {
                const weight = upgrade.rarity === 'cataclysmic' ? 3 : upgrade.rarity === 'unstable' ? 4 : 6
                return Array<typeof upgrade>(weight).fill(upgrade)
            })
            const picked = randomPick(weighted)
            offers.push(picked.id)
            pool.splice(pool.findIndex(upgrade => upgrade.id === picked.id), 1)
        }
        return offers
    }

    applyStartingUpgrade(id: ShapezzRunUpgradeId) {
        this.upgrades[id] = (this.upgrades[id] ?? 0) + 1
    }

    // ─── Targeting ──────────────────────────────────────────────────────────

    nearestEnemy(from: Point, range: number, excludeId?: number, exclude?: Set<number>) {
        let result: Enemy | null = null
        let closestSquared = range * range
        const minColumn = clamp(Math.floor((from.x - range + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_COLUMNS - 1)
        const maxColumn = clamp(Math.floor((from.x + range + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_COLUMNS - 1)
        const minRow = clamp(Math.floor((from.y - range + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_ROWS - 1)
        const maxRow = clamp(Math.floor((from.y + range + ENEMY_GRID_SIZE) / ENEMY_GRID_SIZE), 0, ENEMY_GRID_ROWS - 1)
        for (let row = minRow; row <= maxRow; row++) {
            for (let column = minColumn; column <= maxColumn; column++) {
                const enemies = this.enemyGrid.get(column + row * ENEMY_GRID_COLUMNS)
                if (!enemies) continue
                for (const enemy of enemies) {
                    if (enemy.hp <= 0 || enemy.id === excludeId || exclude?.has(enemy.id)) continue
                    const distSquared = distanceSquared(from, enemy)
                    if (distSquared < closestSquared) {
                        closestSquared = distSquared
                        result = enemy
                    }
                }
            }
        }
        return result
    }

    private aimedEnemy(from: Point, angle: number, range: number, exclude = new Set<number>(), cone = 0.7) {
        let result: Enemy | null = null
        let bestScore = Infinity
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || exclude.has(enemy.id)) continue
            const dist = distance(from, enemy)
            if (dist > range + enemy.radius) continue
            const targetAngle = Math.atan2(enemy.y - from.y, enemy.x - from.x)
            const delta = Math.abs(angleDelta(angle, targetAngle))
            if (delta > cone) continue
            const score = delta * range * 1.4 + dist
            if (score < bestScore) {
                bestScore = score
                result = enemy
            }
        }
        return result
    }

    // ─── Effects ────────────────────────────────────────────────────────────

    private updateEffects(dt: number) {
        this.trauma = Math.max(0, this.trauma - dt * 1.6)
        this.flash = Math.max(0, this.flash - dt * 2.8)
        for (const platform of this.platforms) platform.glow = Math.max(0, platform.glow - dt * 2.2)

        let keptCount = 0
        for (const particle of this.particles) {
            particle.life -= dt
            if (particle.life <= 0) continue
            const drag = particle.drag > 0 ? Math.pow(1 - particle.drag, dt * 10) : 1
            particle.vx *= drag
            particle.vy = particle.vy * drag + particle.gravity * dt
            particle.x += particle.vx * dt
            particle.y += particle.vy * dt
            particle.rotation += particle.spin * dt
            this.particles[keptCount++] = particle
        }
        this.particles.length = keptCount

        keptCount = 0
        for (const piece of this.debris) {
            piece.life -= dt
            if (piece.life <= 0) continue
            piece.vy += 900 * dt
            piece.vx *= Math.pow(0.6, dt)
            piece.x += piece.vx * dt
            piece.y += piece.vy * dt
            piece.rotation += piece.spin * dt
            if (piece.y > FLOOR_Y - piece.size * 0.3 && piece.vy > 0) {
                piece.y = FLOOR_Y - piece.size * 0.3
                piece.vy *= piece.bounced ? -0.1 : -0.35
                piece.vx *= 0.6
                piece.spin *= 0.5
                piece.bounced = true
            }
            this.debris[keptCount++] = piece
        }
        this.debris.length = keptCount

        keptCount = 0
        for (const wave of this.shockwaves) {
            wave.life -= dt
            wave.radius += (wave.maxRadius - wave.radius) * Math.min(1, dt * 10)
            if (wave.life > 0) this.shockwaves[keptCount++] = wave
        }
        this.shockwaves.length = keptCount

        keptCount = 0
        for (const beam of this.beams) {
            beam.life -= dt
            if (beam.life > 0) this.beams[keptCount++] = beam
        }
        this.beams.length = keptCount

        keptCount = 0
        for (const lance of this.lances) {
            lance.life -= dt
            if (lance.life > 0) this.lances[keptCount++] = lance
        }
        this.lances.length = keptCount

        keptCount = 0
        for (const warning of this.warnings) {
            warning.life -= dt
            if (warning.life > 0) this.warnings[keptCount++] = warning
        }
        this.warnings.length = keptCount

        keptCount = 0
        for (const text of this.damageTexts) {
            text.life -= dt
            text.x += text.vx * dt
            text.y += text.vy * dt
            text.vy += 70 * dt
            if (text.life > 0) this.damageTexts[keptCount++] = text
        }
        this.damageTexts.length = keptCount
    }

    /** Particle budget shrinks as the pools fill, so effects never cost the simulation frames. */
    private particleBudget(count: number) {
        const load = this.particles.length / SHAPEZZ_COMBAT_LIMITS.particles
        const scale = load > 0.85 ? 0.2 : load > 0.6 ? 0.45 : load > 0.4 ? 0.75 : 1
        return Math.min(Math.ceil(count * scale), SHAPEZZ_COMBAT_LIMITS.particles - this.particles.length)
    }

    private particle(kind: ParticleKind, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, gravity: number, grow: number, drag: number) {
        if (!this.renderer || this.particles.length >= SHAPEZZ_COMBAT_LIMITS.particles) return
        this.particles.push({ kind, x, y, vx, vy, life, maxLife: life, size, color, gravity, drag, rotation: Math.random() * Math.PI, spin: jitter(-8, 8), grow })
    }

    private burst(x: number, y: number, color: string, count: number, speed: number) {
        if (!this.renderer) return
        const allowed = this.particleBudget(count)
        for (let i = 0; i < allowed; i++) {
            const angle = Math.random() * Math.PI * 2
            const velocity = jitter(speed * 0.2, speed)
            const life = jitter(0.25, 0.8)
            this.particles.push({
                kind: Math.random() < 0.55 ? 'square' : 'dot', x, y,
                vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
                life, maxLife: life, size: jitter(2, 6.5), color, gravity: jitter(0, 420), drag: 0.08,
                rotation: Math.random() * Math.PI, spin: jitter(-10, 10), grow: 0.3
            })
        }
    }

    /** Streaks that fly out and shrink. `direction` biases them into a cone. */
    private sparks(x: number, y: number, color: string, count: number, speed: number, direction?: number) {
        if (!this.renderer) return
        const allowed = this.particleBudget(count)
        for (let i = 0; i < allowed; i++) {
            const angle = direction === undefined ? Math.random() * Math.PI * 2 : direction + jitter(-0.9, 0.9)
            const velocity = jitter(speed * 0.35, speed)
            const life = jitter(0.15, 0.45)
            this.particles.push({
                kind: 'spark', x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
                life, maxLife: life, size: jitter(1.5, 3), color, gravity: 300, drag: 0.12,
                rotation: 0, spin: 0, grow: 0.2
            })
        }
    }

    private dust(x: number, y: number, count: number) {
        for (let i = 0; i < count; i++) {
            const side = i % 2 === 0 ? -1 : 1
            this.particle('smoke', x + side * jitter(4, 16), y - 4, side * jitter(60, 180), jitter(-40, -10), jitter(0.3, 0.55), jitter(5, 9), '#000000', 0, 2, 0.25)
        }
    }

    /** Polygon shards thrown off a shape that died. */
    private shatter(x: number, y: number, radius: number, color: string, count: number, speed: number) {
        if (!this.renderer) return
        const allowed = Math.min(count, SHAPEZZ_COMBAT_LIMITS.debris - this.debris.length)
        for (let i = 0; i < allowed; i++) {
            const angle = Math.random() * Math.PI * 2
            const velocity = jitter(speed * 0.3, speed)
            const life = jitter(0.7, 1.4)
            this.debris.push({
                x: x + Math.cos(angle) * radius * 0.4, y: y + Math.sin(angle) * radius * 0.4,
                vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity - 160,
                life, maxLife: life, size: jitter(radius * 0.25, radius * 0.6), color,
                rotation: Math.random() * Math.PI * 2, spin: jitter(-14, 14), bounced: false
            })
        }
    }

    private ring(x: number, y: number, maxRadius: number, color: string, life: number, width: number, fill = false) {
        if (!this.renderer) return
        if (this.shockwaves.length >= SHAPEZZ_COMBAT_LIMITS.shockwaves) this.shockwaves.shift()
        this.shockwaves.push({ x, y, radius: Math.min(8, maxRadius * 0.1), maxRadius, life, maxLife: life, color, width, fill })
    }

    private beam(fromX: number, fromY: number, toX: number, toY: number, color: string, width: number, life: number, jagged: boolean) {
        if (!this.renderer) return
        if (this.beams.length >= SHAPEZZ_COMBAT_LIMITS.beams) this.beams.shift()
        this.beams.push({ from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, life, maxLife: life, color, width, jagged, seed: Math.random() * 1000 })
    }

    private text(x: number, y: number, text: string, color: string, size: number, life: number, crit = false) {
        if (!this.renderer || this.damageTexts.length >= SHAPEZZ_COMBAT_LIMITS.damageTexts) return
        this.damageTexts.push({ x, y, text, color, life, maxLife: life, size, vx: jitter(-25, 25), vy: jitter(-120, -75), crit })
    }

    /** A layered explosion: white-hot core, coloured fireball, sparks, smoke and a shock ring. */
    private explosion(x: number, y: number, radius: number, color: string, heavy: boolean) {
        if (!this.renderer) return
        this.particle('glow', x, y, 0, 0, heavy ? 0.28 : 0.2, radius * 1.5, color, 0, 1.25, 0)
        this.particle('glow', x, y, 0, 0, heavy ? 0.14 : 0.1, radius * 0.7, '#ffffff', 0, 1.4, 0)
        this.ring(x, y, radius, color, 0.3 + (heavy ? 0.12 : 0), heavy ? 9 : 6, true)
        this.sparks(x, y, color, heavy ? 22 : 12, radius * 4.2)
        this.burst(x, y, color, heavy ? 16 : 8, radius * 3)
        const puffs = this.particleBudget(heavy ? 6 : 3)
        for (let i = 0; i < puffs; i++) {
            const angle = Math.random() * Math.PI * 2
            const offset = jitter(0, radius * 0.4)
            this.particle('smoke', x + Math.cos(angle) * offset, y + Math.sin(angle) * offset, Math.cos(angle) * jitter(20, 70), Math.sin(angle) * jitter(20, 70) - 30, jitter(0.6, 1.1), radius * jitter(0.18, 0.3), '#000000', -40, 2.4, 0.15)
        }
        if (heavy) this.trauma = Math.max(this.trauma, Math.min(0.7, 0.25 + radius / 600))
    }
}
