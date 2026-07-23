import {
    SHAPEZZ_COIN_PAYOUT_SCALE,
    SHAPEZZ_CHECKPOINT_MS,
    SHAPEZZ_COMBAT_LIMITS,
    SHAPEZZ_RUN_UPGRADES,
    shapezzCheckpointPressure,
    shapezzDifficulty,
    shapezzEnemyHealthMultiplier,
    shapezzExecutionThreshold,
    shapezzExplosionDamageMultiplier,
    shapezzIntensity,
    shapezzKillShockwaveStats,
    shapezzOverkillDividendStats,
    shapezzWeaponFireRateCap,
    type ShapezzDifficultyId,
    type ShapezzRunUpgradeId,
    type ShapezzWeapon
} from '#shared/utils/gamelogic/shapezz'
import type { ShapezzSoundEvent } from '~/utils/shapezz-sounds'

const WIDTH = 1280
const HEIGHT = 720
const FLOOR_Y = 662
const GRAVITY = 1900
const COIN_COLOR = '#22d3ee'
const COIN_GRAVITY = 1100

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
    coins: number
    kills: number
    elapsedMs: number
    checkpoint: number
    combo: number
    upgrades: Partial<Record<ShapezzRunUpgradeId, number>>
}

export interface ShapezzEngineCallbacks {
    onHud: (snapshot: ShapezzSnapshot) => void
    onCheckpoint: (offers: ShapezzRunUpgradeId[], snapshot: ShapezzSnapshot) => void
    onBoss: (name: string) => void
    onGameOver: (snapshot: ShapezzSnapshot) => void
    /** Fired at every audible game moment — playback throttles per-event. */
    onSfx?: (event: ShapezzSoundEvent) => void
    /** Fired when the pause state changes (button or P/Escape key). */
    onPause?: (paused: boolean) => void
}

interface Point { x: number, y: number }
interface Platform { x: number, y: number, width: number, height: number }
interface Particle extends Point { vx: number, vy: number, life: number, maxLife: number, size: number, color: string, gravity: number, square: boolean }
interface Shockwave extends Point { radius: number, maxRadius: number, life: number, maxLife: number, color: string, width: number }
interface Beam { from: Point, to: Point, life: number, maxLife: number, color: string, width: number }
interface DamageText extends Point { text: string, color: string, life: number, maxLife: number, size: number, vx: number, vy: number }
interface Pickup extends Point { vx: number, vy: number, value: number, life: number, kind: 'coin' | 'health' }
interface Singularity extends Point { life: number, maxLife: number, radius: number, damageTick: number, triggersHealing: boolean }
interface Turret extends Point { life: number, fireCooldown: number, angle: number }

interface Bullet extends Point {
    vx: number
    vy: number
    damage: number
    radius: number
    life: number
    pierce: number
    bounces: number
    color: string
    accentColor: string
    friendly: boolean
    homing: boolean
    trail: boolean
    explosionRadius: number
    traveled: number
    falloffStart: number
    falloffEnd: number
    minFalloffDamage: number
    visualIntensity: number
    secondaryEffects: boolean
    triggersHealing: boolean
    hitIds: Set<number>
}

type EnemyType = 'melee' | 'shooter' | 'tank' | 'dasher' | 'boss'
interface Enemy extends Point {
    id: number
    type: EnemyType
    vx: number
    vy: number
    radius: number
    hp: number
    maxHp: number
    damage: number
    speed: number
    reward: number
    color: string
    fireCooldown: number
    contactCooldown: number
    phase: number
    boss: boolean
}

interface Player extends Point {
    vx: number
    vy: number
    size: number
    hp: number
    onGround: boolean
    invulnerable: number
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value))
}

function distance(a: Point, b: Point) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

function distanceToSegment(point: Point, start: Point, end: Point) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return distance(point, start)
    const projection = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
    return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy))
}

function normalized(dx: number, dy: number) {
    const length = Math.hypot(dx, dy) || 1
    return { x: dx / length, y: dy / length }
}

function randomBetween(min: number, max: number) {
    return min + Math.random() * (max - min)
}

function drawPolygon(ctx: CanvasRenderingContext2D, sides: number, x: number, y: number, radius: number, rotation = 0) {
    ctx.beginPath()
    for (let i = 0; i < sides; i++) {
        const angle = rotation + i / sides * Math.PI * 2
        const px = x + Math.cos(angle) * radius
        const py = y + Math.sin(angle) * radius
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
    }
    ctx.closePath()
}

export class ShapezzEngine {
    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D
    private callbacks: ShapezzEngineCallbacks
    private stats: ShapezzPlayerStats
    private weapon: ShapezzWeapon
    private difficultyId: ShapezzDifficultyId
    private player: Player
    private keys = new Set<string>()
    private aim = { x: WIDTH * 0.75, y: HEIGHT * 0.45 }
    private aimVisible = false
    private firing = false
    private dropThroughTimer = 0
    private running = false
    private paused = false
    private checkpointOpen = false
    private destroyed = false
    private raf = 0
    private lastFrame = 0
    private elapsedMs = 0
    private nextCheckpointMs = SHAPEZZ_CHECKPOINT_MS
    private spawnCooldown = 0.15
    private fireCooldown = 0
    private orbitalCooldown = 0
    private droneCooldown = 0
    private ceilingBatteryCooldown = 0
    private shotCounter = 0
    private bossCheckpoint = 0
    private kills = 0
    private healingKills = 0
    private coins = 0
    private combo = 0
    private maxCombo = 0
    private comboTimer = 0
    private lastHudAt = 0
    private enemyId = 1
    private shake = 0
    private flash = 0
    private upgrades: Partial<Record<ShapezzRunUpgradeId, number>> = {}
    private enemies: Enemy[] = []
    private bullets: Bullet[] = []
    private particles: Particle[] = []
    private shockwaves: Shockwave[] = []
    private beams: Beam[] = []
    private damageTexts: DamageText[] = []
    private pickups: Pickup[] = []
    private singularities: Singularity[] = []
    private turrets: Turret[] = []
    private platforms: Platform[] = [
        { x: 0, y: FLOOR_Y, width: WIDTH, height: HEIGHT - FLOOR_Y },
        { x: 125, y: 520, width: 250, height: 18 },
        { x: 510, y: 445, width: 260, height: 18 },
        { x: 905, y: 525, width: 245, height: 18 },
        { x: 315, y: 315, width: 210, height: 16 },
        { x: 775, y: 275, width: 230, height: 16 }
    ]

    private keydown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase()
        if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) event.preventDefault()
        this.keys.add(key)
        if (key === 'p' || key === 'escape') this.togglePause()
        if ((key === ' ' || key === 'w' || key === 'arrowup') && this.running && !this.paused && this.player.onGround) this.jump()
        if ((key === 's' || key === 'arrowdown') && this.running && !this.paused && this.player.onGround) this.dropThroughPlatform()
    }

    private keyup = (event: KeyboardEvent) => {
        this.keys.delete(event.key.toLowerCase())
    }

    // Without this, enemies keep attacking while the player has no input.
    private windowBlur = () => {
        this.keys.clear()
        this.firing = false
        if (this.running && !this.paused) this.togglePause()
    }

    private pointermove = (event: PointerEvent) => {
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

    constructor(canvas: HTMLCanvasElement, stats: ShapezzPlayerStats, weapon: ShapezzWeapon, difficultyId: ShapezzDifficultyId, callbacks: ShapezzEngineCallbacks) {
        this.canvas = canvas
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D is unavailable')
        this.ctx = ctx
        this.stats = stats
        this.weapon = weapon
        this.difficultyId = difficultyId
        this.callbacks = callbacks
        this.player = { x: WIDTH / 2, y: FLOOR_Y - 50, vx: 0, vy: 0, size: 36, hp: stats.maxHp, onGround: false, invulnerable: 0 }
        this.resize()
        window.addEventListener('resize', this.resize)
        window.addEventListener('keydown', this.keydown, { passive: false })
        window.addEventListener('keyup', this.keyup)
        window.addEventListener('pointerup', this.pointerup)
        window.addEventListener('blur', this.windowBlur)
        canvas.addEventListener('pointermove', this.pointermove)
        canvas.addEventListener('pointerleave', this.pointerleave)
        canvas.addEventListener('pointerdown', this.pointerdown)
        canvas.addEventListener('contextmenu', event => event.preventDefault())
        this.raf = requestAnimationFrame(this.frame)
    }

    private resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        this.canvas.width = Math.round(WIDTH * dpr)
        this.canvas.height = Math.round(HEIGHT * dpr)
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
        window.removeEventListener('resize', this.resize)
        window.removeEventListener('keydown', this.keydown)
        window.removeEventListener('keyup', this.keyup)
        window.removeEventListener('pointerup', this.pointerup)
        window.removeEventListener('blur', this.windowBlur)
        this.canvas.removeEventListener('pointermove', this.pointermove)
        this.canvas.removeEventListener('pointerleave', this.pointerleave)
        this.canvas.removeEventListener('pointerdown', this.pointerdown)
    }

    chooseUpgrade(id: ShapezzRunUpgradeId) {
        if (!this.checkpointOpen) return
        this.upgrades[id] = (this.upgrades[id] ?? 0) + 1
        this.checkpointOpen = false
        this.running = true
        this.flash = 0.65
        this.shockwaves.push({ x: this.player.x, y: this.player.y, radius: 10, maxRadius: 330, life: 0.65, maxLife: 0.65, color: '#ffffff', width: 8 })
        this.burst(this.player.x, this.player.y, SHAPEZZ_RUN_UPGRADES.find(upgrade => upgrade.id === id)?.accent ?? '#ffffff', 55, 520)
        this.callbacks.onHud(this.snapshot())
    }

    getSnapshot() {
        return this.snapshot()
    }

    /** Freeze/unfreeze the simulation. No-op outside a live run (checkpoint, game over). */
    togglePause() {
        if (!this.running) return
        this.paused = !this.paused
        this.callbacks.onPause?.(this.paused)
    }

    private frame = (now: number) => {
        if (this.destroyed) return
        const dt = Math.min(0.033, Math.max(0, (now - (this.lastFrame || now)) / 1000))
        this.lastFrame = now
        if (this.running && !this.paused) this.update(dt)
        else if (!this.paused) this.updateEffects(dt)
        this.render(now / 1000)
        this.raf = requestAnimationFrame(this.frame)
    }

    private snapshot(): ShapezzSnapshot {
        return {
            hp: Math.max(0, this.player.hp),
            maxHp: this.stats.maxHp,
            coins: this.coins,
            kills: this.kills,
            elapsedMs: this.elapsedMs,
            checkpoint: Math.floor(this.elapsedMs / SHAPEZZ_CHECKPOINT_MS),
            combo: this.combo,
            upgrades: { ...this.upgrades }
        }
    }

    private update(dt: number) {
        this.elapsedMs += dt * 1000
        this.fireCooldown -= dt
        this.orbitalCooldown -= dt
        this.droneCooldown -= dt
        this.ceilingBatteryCooldown -= dt
        this.spawnCooldown -= dt
        this.comboTimer -= dt
        this.player.invulnerable -= dt

        if (this.comboTimer <= 0) this.combo = 0
        this.updatePlayer(dt)
        this.updateSpawning(dt)
        this.updateEnemies(dt)
        this.updateBullets(dt)
        this.updatePickups(dt)
        this.updateCompanions(dt)
        this.updateSingularities(dt)
        this.updateEffects(dt)

        const frenzy = Math.min(3, this.upgrades.frenzy ?? 0)
        const fireMultiplier = this.combo > 0 && frenzy > 0 ? 2 + (frenzy - 1) * 0.35 : 1
        if (this.firing && this.fireCooldown <= 0) {
            const fired = this.firePlayerVolley(this.player.x, this.player.y - 6, Math.atan2(this.aim.y - this.player.y, this.aim.x - this.player.x))
            if (fired) this.callbacks.onSfx?.(this.weapon.type === 'arcCoil' ? 'shoot-blaster' : `shoot-${this.weapon.type}`)
            const requestedFireRate = this.stats.fireRate * this.weapon.fireRateMultiplier * fireMultiplier
            const fireRateCap = shapezzWeaponFireRateCap(this.weapon.type)
            this.fireCooldown = 1 / Math.min(fireRateCap, requestedFireRate)
        }

        if (this.elapsedMs >= this.nextCheckpointMs) {
            this.nextCheckpointMs += SHAPEZZ_CHECKPOINT_MS
            this.openCheckpoint()
        }

        if (this.player.hp <= 0) {
            this.running = false
            this.flash = 0.9
            this.burst(this.player.x, this.player.y, '#ffffff', 120, 760)
            this.callbacks.onSfx?.('player-death')
            this.callbacks.onGameOver(this.snapshot())
        }

        if (this.elapsedMs - this.lastHudAt >= 90) {
            this.lastHudAt = this.elapsedMs
            this.callbacks.onHud(this.snapshot())
        }
    }

    private updatePlayer(dt: number) {
        const left = this.keys.has('a') || this.keys.has('arrowleft')
        const right = this.keys.has('d') || this.keys.has('arrowright')
        this.dropThroughTimer = Math.max(0, this.dropThroughTimer - dt)
        const targetVx = (Number(right) - Number(left)) * this.stats.moveSpeed
        const acceleration = this.player.onGround ? 16 : 8
        this.player.vx += (targetVx - this.player.vx) * Math.min(1, dt * acceleration)
        this.player.vy += GRAVITY * dt

        const previousBottom = this.player.y + this.player.size / 2
        this.player.x += this.player.vx * dt
        this.player.y += this.player.vy * dt
        this.player.x = clamp(this.player.x, this.player.size / 2, WIDTH - this.player.size / 2)
        this.player.onGround = false

        const bottom = this.player.y + this.player.size / 2
        for (const platform of this.platforms) {
            if (this.dropThroughTimer > 0 && platform.y < FLOOR_Y) continue
            const withinX = this.player.x + this.player.size * 0.35 > platform.x && this.player.x - this.player.size * 0.35 < platform.x + platform.width
            if (withinX && this.player.vy >= 0 && previousBottom <= platform.y + 4 && bottom >= platform.y) {
                this.player.y = platform.y - this.player.size / 2
                this.player.vy = 0
                this.player.onGround = true
                break
            }
        }

        if (this.player.y > HEIGHT + 100) {
            this.player.y = 100
            this.player.x = WIDTH / 2
            this.damagePlayer(this.stats.maxHp * 0.2)
        }

        if (Math.abs(this.player.vx) > 120 && this.player.onGround && Math.random() < dt * 24) {
            this.particles.push({ x: this.player.x - Math.sign(this.player.vx) * 18, y: this.player.y + 18, vx: -this.player.vx * 0.25 + randomBetween(-30, 30), vy: randomBetween(-90, -20), life: 0.35, maxLife: 0.35, size: randomBetween(2, 5), color: '#67e8f9', gravity: 120, square: true })
        }
    }

    private jump() {
        this.player.vy = -this.stats.jumpSpeed
        this.player.onGround = false
        this.callbacks.onSfx?.('dash')
        this.burst(this.player.x, this.player.y + 18, '#67e8f9', 14, 230)
        const stacks = Math.min(4, this.upgrades.afterimage ?? 0)
        for (let i = 0; i < stacks && this.turrets.length < SHAPEZZ_COMBAT_LIMITS.turrets; i++) {
            this.turrets.push({ x: this.player.x + (i - (stacks - 1) / 2) * 18, y: this.player.y + 14, life: 5.5, fireCooldown: i * 0.09, angle: 0 })
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

    private updateSpawning(dt: number) {
        const checkpoint = Math.floor(this.elapsedMs / SHAPEZZ_CHECKPOINT_MS)
        if (checkpoint >= 2 && checkpoint > this.bossCheckpoint && checkpoint % 2 === 0) {
            this.bossCheckpoint = checkpoint
            this.spawnBoss(checkpoint)
        }

        if (this.spawnCooldown > 0 || this.enemies.length >= SHAPEZZ_COMBAT_LIMITS.enemies) return
        const pressure = shapezzCheckpointPressure(checkpoint)
        const intensity = shapezzIntensity(this.elapsedMs, this.difficultyId) * pressure.population
        const burstCount = Math.min(4, 1 + Math.floor(intensity / 2.4), SHAPEZZ_COMBAT_LIMITS.enemies - this.enemies.length)
        for (let i = 0; i < burstCount; i++) this.spawnEnemy()
        this.spawnCooldown = clamp(0.72 / intensity, 0.11, 0.72)

        if (this.enemies.length < SHAPEZZ_COMBAT_LIMITS.enemies && Math.random() < dt * intensity * 0.14) this.spawnEnemy('shooter')
    }

    private spawnEnemy(forceType?: EnemyType) {
        const minutes = this.elapsedMs / 60_000
        const roll = Math.random()
        const type = forceType ?? (roll < 0.44 ? 'melee' : roll < 0.7 ? 'shooter' : roll < 0.88 ? 'dasher' : 'tank')
        const difficulty = shapezzDifficulty(this.difficultyId)
        const healthMultiplier = shapezzEnemyHealthMultiplier(this.elapsedMs, this.difficultyId)
        const checkpoint = Math.floor(this.elapsedMs / SHAPEZZ_CHECKPOINT_MS)
        const pressure = shapezzCheckpointPressure(checkpoint)
        const side = Math.random() < 0.5 ? -1 : 1
        const config = {
            melee: { radius: 18, hp: 38, damage: 13, speed: 150, reward: 15, color: '#fb7185' },
            shooter: { radius: 21, hp: 52, damage: 10, speed: 92, reward: 22, color: '#fbbf24' },
            tank: { radius: 31, hp: 155, damage: 22, speed: 62, reward: 50, color: '#a78bfa' },
            dasher: { radius: 16, hp: 62, damage: 18, speed: 205, reward: 30, color: '#34d399' },
            boss: { radius: 74, hp: 2200, damage: 28, speed: 68, reward: 750, color: '#e879f9' }
        }[type]
        this.enemies.push({
            id: this.enemyId++, type,
            x: side < 0 ? -config.radius - 20 : WIDTH + config.radius + 20,
            y: randomBetween(120, FLOOR_Y - 70),
            vx: 0, vy: 0, radius: config.radius,
            hp: config.hp * healthMultiplier * pressure.health,
            maxHp: config.hp * healthMultiplier * pressure.health,
            damage: config.damage * difficulty.enemyDamage * (1 + minutes * 0.1) * pressure.damage,
            speed: config.speed * difficulty.enemySpeed,
            reward: Math.round(config.reward * SHAPEZZ_COIN_PAYOUT_SCALE * difficulty.reward * pressure.reward * (1 + minutes * 0.04)),
            color: config.color,
            fireCooldown: randomBetween(0.3, 1.4), contactCooldown: 0,
            phase: Math.random() * Math.PI * 2,
            boss: false
        })
    }

    private spawnBoss(checkpoint: number) {
        this.spawnEnemy('boss')
        const boss = this.enemies[this.enemies.length - 1]!
        const scale = 1 + checkpoint * 0.24
        boss.hp *= scale
        boss.maxHp = boss.hp
        boss.reward = Math.round(boss.reward * scale)
        boss.boss = true
        boss.fireCooldown = 1
        this.callbacks.onSfx?.('boss-spawn')
        this.callbacks.onBoss(checkpoint >= 6 ? 'THE IMPOSSIBLE POLYGON' : 'THE OVERSEER')
        this.shake = 18
        this.flash = 0.7
        this.burst(WIDTH / 2, HEIGHT / 2, '#e879f9', 90, 650)
    }

    private updateEnemies(dt: number) {
        const next: Enemy[] = []
        for (const enemy of this.enemies) {
            enemy.fireCooldown -= dt
            enemy.contactCooldown -= dt
            enemy.phase += dt
            const toPlayer = normalized(this.player.x - enemy.x, this.player.y - enemy.y)
            const dist = distance(enemy, this.player)

            if (enemy.type === 'melee' || enemy.type === 'tank' || enemy.type === 'dasher') {
                let speed = enemy.speed
                if (enemy.type === 'dasher') speed *= 0.7 + Math.max(0, Math.sin(enemy.phase * 3.8)) * 2.5
                enemy.vx += (toPlayer.x * speed - enemy.vx) * Math.min(1, dt * 4)
                enemy.vy += (toPlayer.y * speed - enemy.vy) * Math.min(1, dt * 4)
            } else {
                const desired = enemy.type === 'boss' ? 330 : 410
                const direction = dist < desired - 60 ? -1 : dist > desired + 90 ? 1 : 0
                const tangent = Math.sin(enemy.phase * 0.8)
                enemy.vx += (toPlayer.x * enemy.speed * direction - toPlayer.y * tangent * enemy.speed * 0.55 - enemy.vx) * Math.min(1, dt * 2.5)
                enemy.vy += (toPlayer.y * enemy.speed * direction + toPlayer.x * tangent * enemy.speed * 0.55 - enemy.vy) * Math.min(1, dt * 2.5)
                if (enemy.fireCooldown <= 0) {
                    if (enemy.type === 'boss') this.fireBossPattern(enemy)
                    else this.fireEnemyBullet(enemy, toPlayer.x, toPlayer.y)
                    enemy.fireCooldown = enemy.type === 'boss' ? 1.15 : randomBetween(1.2, 2.1)
                }
            }

            enemy.x += enemy.vx * dt
            enemy.y += enemy.vy * dt
            enemy.x = clamp(enemy.x, -100, WIDTH + 100)
            enemy.y = clamp(enemy.y, 70, FLOOR_Y - 30)

            if (dist < enemy.radius + this.player.size * 0.48 && enemy.contactCooldown <= 0) {
                this.damagePlayer(enemy.damage * 0.62)
                enemy.contactCooldown = 0.75
                enemy.vx -= toPlayer.x * 280
                enemy.vy -= toPlayer.y * 280
            }

            if (enemy.hp > 0) next.push(enemy)
        }
        this.enemies = next
    }

    private fireEnemyBullet(enemy: Enemy, dx: number, dy: number) {
        if (this.bullets.length >= SHAPEZZ_COMBAT_LIMITS.bullets) return
        const speed = enemy.boss ? 290 : 260
        this.bullets.push({
            x: enemy.x, y: enemy.y, vx: dx * speed, vy: dy * speed, damage: enemy.damage,
            radius: enemy.boss ? 9 : 6, life: 6, pierce: 0, bounces: 0,
            color: enemy.color, accentColor: enemy.color, friendly: false, homing: false, trail: true,
            explosionRadius: 0, traveled: 0, falloffStart: 9999, falloffEnd: 10_000,
            minFalloffDamage: 1, visualIntensity: enemy.boss ? 3 : 1, secondaryEffects: false, triggersHealing: false, hitIds: new Set()
        })
        this.callbacks.onSfx?.('enemy-shoot')
        this.burst(enemy.x, enemy.y, enemy.color, enemy.boss ? 12 : 5, 150)
    }

    private fireBossPattern(enemy: Enemy) {
        const count = 12 + Math.floor(this.elapsedMs / 180_000) * 4
        const base = enemy.phase
        for (let i = 0; i < count; i++) {
            const angle = base + i / count * Math.PI * 2
            this.fireEnemyBullet(enemy, Math.cos(angle), Math.sin(angle))
        }
        const aim = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x)
        for (let i = -2; i <= 2; i++) this.fireEnemyBullet(enemy, Math.cos(aim + i * 0.1), Math.sin(aim + i * 0.1))
        this.shockwaves.push({ x: enemy.x, y: enemy.y, radius: enemy.radius, maxRadius: 250, life: 0.45, maxLife: 0.45, color: enemy.color, width: 8 })
        this.shake = Math.max(this.shake, 8)
    }

    private firePlayerVolley(
        x: number,
        y: number,
        angle: number,
        damageMultiplier = 1,
        triggersHealing = true,
        targetPoint: Point = this.aim,
        arcAcquisitionRange = this.weapon.chainRange
    ) {
        if (this.weapon.type === 'arcCoil') {
            return this.fireArcCoil(x, y, angle, damageMultiplier, triggersHealing, targetPoint, arcAcquisitionRange)
        }

        const twinFang = this.upgrades.twinFang ?? 0
        const effectiveTwinStacks = Math.min(this.weapon.type === 'shotgun' ? 3 : 4, twinFang)
        const extra = effectiveTwinStacks * 2
        const count = this.weapon.pellets + extra
        const overflowDamage = 1 + Math.max(0, twinFang - effectiveTwinStacks) * 0.08
        const spread = this.weapon.type === 'shotgun'
            ? this.weapon.spread + Math.min(0.08, extra * 0.01)
            : Math.max(this.weapon.spread, Math.min(0.55, (count - 1) * 0.05))
        const secondaryProcLimit = damageMultiplier < 1 ? 0 : this.weapon.type === 'shotgun' ? 2 : Math.min(4, count)
        for (let i = 0; i < count; i++) {
            const offset = count === 1 ? 0 : -spread / 2 + i / (count - 1) * spread
            const secondaryEffects = secondaryProcLimit > 0 && i % Math.max(1, Math.ceil(count / secondaryProcLimit)) === 0
            this.createPlayerBullet(x, y, angle + offset, damageMultiplier * overflowDamage, false, secondaryEffects, triggersHealing)
        }
        this.shotCounter++
        const singularityEvery = Math.max(5, 14 - (this.upgrades.blackHole ?? 0) * 3)
        if ((this.upgrades.blackHole ?? 0) > 0 && this.shotCounter % singularityEvery === 0) {
            this.singularities.push({ x: targetPoint.x, y: targetPoint.y, life: 2.6, maxLife: 2.6, radius: 125 + Math.min(4, this.upgrades.blackHole ?? 1) * 18, damageTick: 0, triggersHealing })
            this.singularities = this.singularities.slice(-SHAPEZZ_COMBAT_LIMITS.singularities)
            this.callbacks.onSfx?.('singularity')
        }
        const muzzleX = x + Math.cos(angle) * 25
        const muzzleY = y + Math.sin(angle) * 25
        const muzzleParticleCount = this.weapon.type === 'shotgun'
            ? 4 + Math.ceil(count / 4) + this.weapon.visualIntensity
            : 5 + Math.min(8, Math.ceil(count / 2)) + this.weapon.visualIntensity * 2
        this.burst(muzzleX, muzzleY, this.weapon.primaryColor, muzzleParticleCount, 210 + this.weapon.visualIntensity * 35)
        if (this.weapon.visualIntensity >= 3 && this.weapon.type !== 'shotgun') this.burst(muzzleX, muzzleY, this.weapon.accentColor, this.weapon.visualIntensity * 2, 310)
        if (this.weapon.type === 'launcher') {
            this.shake = Math.max(this.shake, 3 + this.weapon.visualIntensity)
            this.shockwaves.push({ x: muzzleX, y: muzzleY, radius: 3, maxRadius: 35 + this.weapon.visualIntensity * 6, life: 0.18, maxLife: 0.18, color: this.weapon.primaryColor, width: 4 })
        }
        return true
    }

    private fireArcCoil(
        x: number,
        y: number,
        angle: number,
        damageMultiplier: number,
        triggersHealing: boolean,
        targetPoint: Point,
        acquisitionRange: number
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
        const extraHops = Math.min(3, this.upgrades.railPierce ?? 0) + Math.min(2, this.upgrades.ricochet ?? 0)
        const maxHops = this.weapon.chainCount + extraHops
        const decay = Math.min(0.94, 0.82 + velocity * 0.03)
        const hit = new Set<number>()
        let fired = false

        for (let primaryIndex = 0; primaryIndex < primaryCount; primaryIndex++) {
            const primary = this.aimedEnemy({ x, y }, angle, acquisitionRange, hit)
            if (!primary) break
            fired = true
            let source: Point = { x, y }
            let target: Enemy | null = primary
            let hopDamage = arcDamage

            for (let hop = 0; target && hop <= maxHops; hop++) {
                const currentTarget: Enemy = target
                hit.add(currentTarget.id)
                this.beams.push({
                    from: { x: source.x, y: source.y },
                    to: { x: currentTarget.x, y: currentTarget.y },
                    life: 0.13,
                    maxLife: 0.13,
                    color: hop === 0 ? this.weapon.primaryColor : this.weapon.accentColor,
                    width: 3 + this.weapon.visualIntensity * 0.65 + giant * 1.5
                })
                this.hitEnemy(currentTarget, hopDamage, this.weapon.primaryColor, currentTarget.x, currentTarget.y, true, triggersHealing)
                if (hop === 0) this.triggerArcPrimaryImpact(currentTarget, hopDamage, triggersHealing)
                source = { x: currentTarget.x, y: currentTarget.y }
                target = this.nearestEnemy(source, this.weapon.chainRange, undefined, hit)
                hopDamage *= decay
            }
        }

        if (!fired) return false
        this.shotCounter++
        const singularityEvery = Math.max(5, 14 - (this.upgrades.blackHole ?? 0) * 3)
        if ((this.upgrades.blackHole ?? 0) > 0 && this.shotCounter % singularityEvery === 0) {
            this.singularities.push({ x: targetPoint.x, y: targetPoint.y, life: 2.6, maxLife: 2.6, radius: 125 + Math.min(4, this.upgrades.blackHole ?? 1) * 18, damageTick: 0, triggersHealing })
            this.singularities = this.singularities.slice(-SHAPEZZ_COMBAT_LIMITS.singularities)
            this.callbacks.onSfx?.('singularity')
        }
        this.burst(x, y, this.weapon.primaryColor, 5 + this.weapon.visualIntensity * 2, 240)
        return true
    }

    private triggerArcPrimaryImpact(enemy: Enemy, impactDamage: number, triggersHealing: boolean) {
        const explosive = Math.min(4, this.upgrades.explosive ?? 0)
        if (explosive > 0) {
            const radius = 64 + explosive * 24
            const blastDamage = impactDamage * (0.45 + explosive * 0.12)
            this.callbacks.onSfx?.('explosion')
            this.shockwaves.push({ x: enemy.x, y: enemy.y, radius: 8, maxRadius: radius, life: 0.3, maxLife: 0.3, color: '#fb7185', width: 5 + this.weapon.visualIntensity })
            for (const target of this.enemies) {
                if (target.id !== enemy.id && distance(target, enemy) < radius) {
                    this.hitEnemy(target, blastDamage, '#fb7185', target.x, target.y, true, triggersHealing)
                }
            }
        }

        const chains = Math.min(3, this.upgrades.chainLightning ?? 0)
        if (chains <= 0) return
        let source: Enemy = enemy
        const hit = new Set<number>([enemy.id])
        for (let i = 0; i < 1 + chains * 2; i++) {
            const target = this.nearestEnemy(source, this.weapon.chainRange, undefined, hit)
            if (!target) break
            hit.add(target.id)
            this.beams.push({ from: { x: source.x, y: source.y }, to: { x: target.x, y: target.y }, life: 0.18, maxLife: 0.18, color: '#c4b5fd', width: 4 + chains })
            this.hitEnemy(target, impactDamage * 0.5, '#c4b5fd', target.x, target.y, true, triggersHealing)
            source = target
        }
    }

    private createPlayerBullet(
        x: number,
        y: number,
        angle: number,
        damageMultiplier = 1,
        homing = false,
        secondaryEffects = false,
        triggersHealing = true
    ) {
        if (this.bullets.length >= SHAPEZZ_COMBAT_LIMITS.bullets) return
        const giantStacks = this.upgrades.giantRounds ?? 0
        const giant = Math.min(3, giantStacks)
        const velocity = Math.min(4, this.upgrades.hyperVelocity ?? 0)
        const speed = 780 * this.weapon.projectileSpeedMultiplier * Math.pow(1.5, velocity)
        this.bullets.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            damage: this.stats.damage * this.weapon.damageMultiplier * damageMultiplier * Math.pow(1.35, giant) * (1 + Math.max(0, giantStacks - giant) * 0.1),
            radius: 5 * this.weapon.projectileSizeMultiplier * Math.pow(1.7, giant),
            life: 2.5,
            pierce: Math.min(9, (this.upgrades.railPierce ?? 0) * 3),
            bounces: Math.min(6, (this.upgrades.ricochet ?? 0) * 2),
            color: giant > 0 ? '#fb923c' : this.weapon.primaryColor,
            accentColor: this.weapon.accentColor,
            friendly: true,
            homing,
            trail: velocity > 0 || this.weapon.visualIntensity >= 2 || this.weapon.type === 'launcher',
            explosionRadius: this.weapon.explosionRadius,
            traveled: 0,
            falloffStart: this.weapon.falloffStart,
            falloffEnd: this.weapon.falloffEnd,
            minFalloffDamage: this.weapon.minFalloffDamage,
            visualIntensity: this.weapon.visualIntensity,
            secondaryEffects,
            triggersHealing,
            hitIds: new Set()
        })
    }

    private updateBullets(dt: number) {
        const activeBullets = this.bullets
        this.bullets = []
        const kept: Bullet[] = []
        for (const bullet of activeBullets) {
            bullet.life -= dt
            if (bullet.life <= 0) continue
            const previousPosition = { x: bullet.x, y: bullet.y }

            if (bullet.friendly && bullet.homing && this.enemies.length) {
                const target = this.nearestEnemy(bullet, 480)
                if (target) {
                    const direction = normalized(target.x - bullet.x, target.y - bullet.y)
                    const speed = Math.hypot(bullet.vx, bullet.vy)
                    bullet.vx += (direction.x * speed - bullet.vx) * Math.min(1, dt * 8)
                    bullet.vy += (direction.y * speed - bullet.vy) * Math.min(1, dt * 8)
                }
            }

            if (!bullet.friendly && (this.upgrades.bulletTime ?? 0) > 0 && distance(bullet, this.player) < 220) {
                const slow = Math.pow(0.58, this.upgrades.bulletTime ?? 0)
                bullet.x += bullet.vx * dt * slow
                bullet.y += bullet.vy * dt * slow
                bullet.traveled += Math.hypot(bullet.vx, bullet.vy) * dt * slow
            } else {
                bullet.x += bullet.vx * dt
                bullet.y += bullet.vy * dt
                bullet.traveled += Math.hypot(bullet.vx, bullet.vy) * dt
            }

            const shotgunVisualMultiplier = bullet.friendly && this.weapon.type === 'shotgun' ? 0.3 : 1
            if (bullet.trail && this.particles.length < SHAPEZZ_COMBAT_LIMITS.particles && Math.random() < dt * (5 + bullet.visualIntensity * 4) * shotgunVisualMultiplier) {
                const trailLife = (0.18 + bullet.visualIntensity * 0.045) * (bullet.friendly && this.weapon.type === 'shotgun' ? 0.7 : 1)
                this.particles.push({
                    x: bullet.x, y: bullet.y,
                    vx: -bullet.vx * 0.04 + randomBetween(-25, 25), vy: -bullet.vy * 0.04 + randomBetween(-25, 25),
                    life: trailLife, maxLife: trailLife,
                    size: bullet.radius * randomBetween(0.35, 0.75 + bullet.visualIntensity * 0.08),
                    color: Math.random() < 0.28 ? bullet.accentColor : bullet.color,
                    gravity: 0, square: bullet.visualIntensity >= 4 && Math.random() < 0.35
                })
            }

            let remove = false
            if (bullet.friendly) {
                for (const enemy of this.enemies) {
                    if (bullet.hitIds.has(enemy.id) || distanceToSegment(enemy, previousPosition, bullet) > bullet.radius + enemy.radius) continue
                    bullet.hitIds.add(enemy.id)
                    const impactDamage = this.bulletImpactDamage(bullet)
                    this.hitEnemy(enemy, impactDamage, bullet.color, bullet.x, bullet.y, true, bullet.triggersHealing)
                    this.triggerImpact(enemy, bullet, impactDamage)
                    if (bullet.pierce > 0) bullet.pierce--
                    else if (bullet.bounces > 0) {
                        bullet.bounces--
                        bullet.hitIds.clear()
                        const target = this.nearestEnemy(enemy, 520, enemy.id)
                        if (target) {
                            const direction = normalized(target.x - bullet.x, target.y - bullet.y)
                            const speed = Math.hypot(bullet.vx, bullet.vy)
                            bullet.vx = direction.x * speed
                            bullet.vy = direction.y * speed
                            this.beams.push({ from: { x: enemy.x, y: enemy.y }, to: { x: target.x, y: target.y }, life: 0.12, maxLife: 0.12, color: '#fde047', width: 3 })
                        } else bullet.vx *= -1
                    } else remove = true
                    break
                }
            } else if (distance(bullet, this.player) < bullet.radius + this.player.size * 0.45) {
                this.damagePlayer(bullet.damage)
                remove = true
            }

            if (bullet.x < 0 || bullet.x > WIDTH || bullet.y < 0 || bullet.y > HEIGHT) {
                if (bullet.friendly && bullet.bounces > 0) {
                    if (bullet.x < 0 || bullet.x > WIDTH) bullet.vx *= -1
                    if (bullet.y < 0 || bullet.y > HEIGHT) bullet.vy *= -1
                    bullet.x = clamp(bullet.x, 2, WIDTH - 2)
                    bullet.y = clamp(bullet.y, 2, HEIGHT - 2)
                    bullet.bounces--
                    bullet.hitIds.clear()
                } else remove = true
            }
            if (!remove) kept.push(bullet)
        }
        this.bullets = [...kept, ...this.bullets].slice(-SHAPEZZ_COMBAT_LIMITS.bullets)
    }

    private bulletImpactDamage(bullet: Bullet) {
        if (bullet.traveled <= bullet.falloffStart) return bullet.damage
        const falloffProgress = clamp((bullet.traveled - bullet.falloffStart) / Math.max(1, bullet.falloffEnd - bullet.falloffStart), 0, 1)
        return bullet.damage * (1 - falloffProgress * (1 - bullet.minFalloffDamage))
    }

    private triggerImpact(enemy: Enemy, bullet: Bullet, impactDamage: number) {
        const isShotgunBullet = bullet.friendly && this.weapon.type === 'shotgun'
        this.burst(bullet.x, bullet.y, bullet.color, isShotgunBullet ? 2 + bullet.visualIntensity : 3 + bullet.visualIntensity * 2, 230 + bullet.visualIntensity * 30)
        if (bullet.visualIntensity >= 3 && (!isShotgunBullet || bullet.secondaryEffects)) this.burst(bullet.x, bullet.y, bullet.accentColor, bullet.visualIntensity, 360)
        if (!bullet.secondaryEffects) return
        const explosive = Math.min(4, this.upgrades.explosive ?? 0)
        if (explosive > 0 || bullet.explosionRadius > 0) {
            const radius = Math.max(64, bullet.explosionRadius) + explosive * 24
            const explosionColor = bullet.explosionRadius > 0 ? bullet.color : '#fb7185'
            const blastDamage = impactDamage * (bullet.explosionRadius > 0 ? 0.78 + bullet.visualIntensity * 0.04 : 0.45 + explosive * 0.12)
            this.callbacks.onSfx?.('explosion')
            this.shockwaves.push({ x: bullet.x, y: bullet.y, radius: 8, maxRadius: radius, life: 0.3 + bullet.visualIntensity * 0.035, maxLife: 0.3 + bullet.visualIntensity * 0.035, color: explosionColor, width: 5 + bullet.visualIntensity })
            this.burst(bullet.x, bullet.y, explosionColor, 12 + bullet.visualIntensity * 5 + explosive * 3, 390 + bullet.visualIntensity * 55)
            for (const target of this.enemies) {
                const targetDistance = distance(target, bullet)
                if (target.id !== enemy.id && targetDistance < radius) {
                    const damageMultiplier = bullet.explosionRadius > 0
                        ? shapezzExplosionDamageMultiplier(targetDistance, radius)
                        : 1
                    this.hitEnemy(target, blastDamage * damageMultiplier, explosionColor, target.x, target.y, true, bullet.triggersHealing)
                }
            }
            this.shake = Math.max(this.shake, 4 + explosive * 2 + bullet.visualIntensity)
            this.flash = Math.max(this.flash, 0.08 + bullet.visualIntensity * 0.035)
        }

        const chains = Math.min(3, this.upgrades.chainLightning ?? 0)
        if (chains > 0) {
            let source: Enemy = enemy
            const hit = new Set<number>([enemy.id])
            for (let i = 0; i < 1 + chains * 2; i++) {
                const target = this.nearestEnemy(source, 210, undefined, hit)
                if (!target) break
                hit.add(target.id)
                this.beams.push({ from: { x: source.x, y: source.y }, to: { x: target.x, y: target.y }, life: 0.18, maxLife: 0.18, color: '#c4b5fd', width: 4 + chains })
                this.hitEnemy(target, impactDamage * 0.5, '#c4b5fd', target.x, target.y, true, bullet.triggersHealing)
                source = target
            }
        }
    }

    private hitEnemy(
        enemy: Enemy,
        damage: number,
        color: string,
        x: number,
        y: number,
        allowOverkillDividend = true,
        triggersHealing = true
    ) {
        if (enemy.hp <= 0) return
        const previousHp = enemy.hp
        const dealt = Math.min(enemy.hp, damage)
        enemy.hp -= damage
        this.callbacks.onSfx?.('hit-enemy')
        if (this.damageTexts.length < SHAPEZZ_COMBAT_LIMITS.damageTexts) {
            this.damageTexts.push({ x, y, text: Math.round(dealt).toString(), color, life: 0.65, maxLife: 0.65, size: clamp(12 + Math.log2(Math.max(2, damage)) * 2, 14, 34), vx: randomBetween(-25, 25), vy: randomBetween(-120, -75) })
        }
        if (enemy.hp <= 0) {
            this.killEnemy(enemy, triggersHealing)
            if (allowOverkillDividend) this.triggerOverkillDividend(enemy, Math.max(0, damage - previousHp), triggersHealing)
            return
        }

        const executionThreshold = shapezzExecutionThreshold(this.upgrades.executioner ?? 0)
        if (executionThreshold > 0 && enemy.hp / enemy.maxHp <= executionThreshold) {
            if (this.damageTexts.length < SHAPEZZ_COMBAT_LIMITS.damageTexts) {
                this.damageTexts.push({ x: enemy.x, y: enemy.y - enemy.radius, text: 'EXECUTE', color: '#fb7185', life: 0.75, maxLife: 0.75, size: 19, vx: 0, vy: -95 })
            }
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
        this.shockwaves.push({ x: enemy.x, y: enemy.y, radius: 5, maxRadius: stats.radius, life: 0.28, maxLife: 0.28, color: '#fbbf24', width: 5 + Math.min(5, stacks) })
        for (const target of this.enemies) {
            if (target.id !== enemy.id && distance(target, enemy) <= stats.radius) {
                this.hitEnemy(target, damage, '#fbbf24', target.x, target.y, false, triggersHealing)
            }
        }
    }

    private killEnemy(enemy: Enemy, triggersHealing = true) {
        this.kills++
        if (triggersHealing) this.healingKills++
        this.combo++
        this.maxCombo = Math.max(this.maxCombo, this.combo)
        this.comboTimer = 2.6
        this.shake = Math.max(this.shake, enemy.boss ? 24 : 3 + enemy.radius * 0.08)
        this.flash = Math.max(this.flash, enemy.boss ? 0.9 : 0.12)
        this.callbacks.onSfx?.(enemy.boss ? 'boss-death' : 'enemy-death')
        this.burst(enemy.x, enemy.y, enemy.color, enemy.boss ? 180 : 16 + Math.floor(enemy.radius * 0.5), enemy.boss ? 920 : 430)
        this.shockwaves.push({ x: enemy.x, y: enemy.y, radius: 5, maxRadius: enemy.radius * (enemy.boss ? 5 : 2.7), life: enemy.boss ? 0.75 : 0.35, maxLife: enemy.boss ? 0.75 : 0.35, color: enemy.color, width: enemy.boss ? 12 : 5 })

        if (triggersHealing) {
            const previousHp = this.player.hp
            this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.stats.healthPerKill)
            const healed = Math.round(this.player.hp - previousHp)
            if (healed > 0) {
                if (this.damageTexts.length < SHAPEZZ_COMBAT_LIMITS.damageTexts) {
                    this.damageTexts.push({ x: this.player.x, y: this.player.y - 42, text: `+${healed} HP`, color: '#34d399', life: 0.8, maxLife: 0.8, size: 16 + this.stats.healthPerKill, vx: randomBetween(-12, 12), vy: -75 })
                }
                this.burst(this.player.x, this.player.y, '#34d399', 2 + this.stats.healthPerKill, 120 + this.stats.healthPerKill * 18)
            }
        }

        const pickupCount = enemy.boss ? 12 : 1
        let remaining = enemy.reward
        for (let i = 0; i < pickupCount; i++) {
            const value = i === pickupCount - 1 ? remaining : Math.max(1, Math.floor(enemy.reward / pickupCount))
            remaining -= value
            if (this.pickups.length < SHAPEZZ_COMBAT_LIMITS.pickups) {
                this.pickups.push({ x: enemy.x, y: enemy.y, vx: randomBetween(-220, 220), vy: randomBetween(-280, -60), value, life: 12, kind: 'coin' })
            } else this.coins += value
        }
        if (this.pickups.length < SHAPEZZ_COMBAT_LIMITS.pickups && (Math.random() < 0.045 || enemy.boss)) {
            this.pickups.push({ x: enemy.x, y: enemy.y, vx: randomBetween(-180, 180), vy: -280, value: Math.ceil(this.stats.maxHp * (enemy.boss ? 0.35 : 0.12)), life: 12, kind: 'health' })
        }

        const splitstorm = this.upgrades.splitstorm ?? 0
        const visibleSplitstorm = Math.min(3, splitstorm)
        const shardCount = 2 + visibleSplitstorm * 3
        if (splitstorm > 0) {
            const shardDamage = 0.62 * (1 + Math.max(0, splitstorm - visibleSplitstorm) * 0.12)
            for (let i = 0; i < shardCount; i++) this.createPlayerBullet(enemy.x, enemy.y, i / shardCount * Math.PI * 2, shardDamage, true, false, triggersHealing)
        }

        const deathNova = this.upgrades.deathNova ?? 0
        const visibleDeathNova = Math.min(3, deathNova)
        const novaCount = deathNova > 0 ? 6 + visibleDeathNova * 6 : 0
        const novaDamage = 0.5 * (1 + Math.max(0, deathNova - visibleDeathNova) * 0.1)
        for (let i = 0; i < novaCount; i++) this.createPlayerBullet(enemy.x, enemy.y, i / novaCount * Math.PI * 2, novaDamage, false, false, triggersHealing)

        const vampire = Math.min(4, this.upgrades.vampireBurst ?? 0)
        const triggerKills = Math.max(8, 24 - vampire * 4)
        if (triggersHealing && vampire > 0 && this.healingKills % triggerKills === 0) {
            const healed = this.stats.maxHp * 0.25
            this.player.hp = Math.min(this.stats.maxHp, this.player.hp + healed)
            if (this.damageTexts.length < SHAPEZZ_COMBAT_LIMITS.damageTexts) {
                this.damageTexts.push({ x: this.player.x, y: this.player.y - 40, text: `+${Math.round(healed)} HP`, color: '#34d399', life: 1.1, maxLife: 1.1, size: 24, vx: 0, vy: -90 })
            }
            this.shockwaves.push({ x: this.player.x, y: this.player.y, radius: 8, maxRadius: 150, life: 0.5, maxLife: 0.5, color: '#34d399', width: 7 })
        }

        const killShockwaveStacks = this.upgrades.killShockwave ?? 0
        if (killShockwaveStacks > 0) {
            const stats = shapezzKillShockwaveStats(killShockwaveStacks)
            if (this.kills % stats.kills === 0) {
                const damage = this.stats.damage * stats.damageMultiplier
                this.shockwaves.push({ x: this.player.x, y: this.player.y, radius: 8, maxRadius: stats.radius, life: 0.58, maxLife: 0.58, color: '#22d3ee', width: 9 })
                this.burst(this.player.x, this.player.y, '#67e8f9', 24 + Math.min(6, killShockwaveStacks) * 5, 470)
                for (const target of this.enemies) {
                    if (distance(target, this.player) <= stats.radius) {
                        this.hitEnemy(target, damage, '#22d3ee', target.x, target.y, true, triggersHealing)
                    }
                }
                this.shake = Math.max(this.shake, 9)
            }
        }
    }

    private updatePickups(dt: number) {
        const kept: Pickup[] = []
        for (const pickup of this.pickups) {
            pickup.life -= dt
            pickup.vy += (pickup.kind === 'coin' ? COIN_GRAVITY : 720) * dt
            pickup.x += pickup.vx * dt
            pickup.y += pickup.vy * dt
            const groundClearance = pickup.kind === 'coin' ? 9 : 6
            if (pickup.y > FLOOR_Y - groundClearance) {
                pickup.y = FLOOR_Y - groundClearance
                pickup.vy *= -0.45
                pickup.vx *= 0.82
            }
            const dist = distance(pickup, this.player)
            if (dist < this.stats.magnetRange) {
                const direction = normalized(this.player.x - pickup.x, this.player.y - pickup.y)
                const pull = 500 + (this.stats.magnetRange - dist) * 12
                pickup.vx += direction.x * pull * dt
                pickup.vy += direction.y * pull * dt
            }
            if (dist < 28) {
                if (pickup.kind === 'coin') this.coins += pickup.value
                else this.player.hp = Math.min(this.stats.maxHp, this.player.hp + pickup.value)
                this.callbacks.onSfx?.(pickup.kind === 'coin' ? 'pickup-coin' : 'pickup-health')
                this.burst(pickup.x, pickup.y, pickup.kind === 'coin' ? COIN_COLOR : '#34d399', 7, 190)
                continue
            }
            if (pickup.life > 0) kept.push(pickup)
        }
        this.pickups = kept.slice(-SHAPEZZ_COMBAT_LIMITS.pickups)
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
                    origin.y,
                    Math.atan2(target.y - origin.y, target.x - origin.x),
                    1,
                    false,
                    target,
                    this.weapon.type === 'arcCoil' ? 920 : this.weapon.chainRange
                ) || fired
            }
            if (fired) this.callbacks.onSfx?.('drone-shoot')
            const frenzy = Math.min(3, this.upgrades.frenzy ?? 0)
            const fireMultiplier = this.combo > 0 && frenzy > 0 ? 2 + (frenzy - 1) * 0.35 : 1
            const requestedFireRate = this.stats.fireRate * this.weapon.fireRateMultiplier * fireMultiplier
            const clonedFireRate = Math.min(shapezzWeaponFireRateCap(this.weapon.type), requestedFireRate) * 0.82
            this.ceilingBatteryCooldown = 1 / Math.max(0.1, clonedFireRate)
        }

        const orbitals = Math.min(6, (this.upgrades.orbitals ?? 0) * 2)
        if (orbitals > 0 && this.orbitalCooldown <= 0 && this.enemies.length) {
            for (let i = 0; i < orbitals; i++) {
                const angle = this.elapsedMs / 700 + i / orbitals * Math.PI * 2
                const origin = { x: this.player.x + Math.cos(angle) * 72, y: this.player.y + Math.sin(angle) * 72 }
                const target = this.nearestEnemy(origin, 650)
                if (target) {
                    this.createPlayerBullet(origin.x, origin.y, Math.atan2(target.y - origin.y, target.x - origin.x), 0.5, true)
                    this.callbacks.onSfx?.('drone-shoot')
                }
            }
            this.orbitalCooldown = 0.72
        }

        const drones = Math.min(6, (this.upgrades.droneSwarm ?? 0) * 2)
        if (drones > 0 && this.droneCooldown <= 0 && this.enemies.length) {
            for (let i = 0; i < drones; i++) {
                const origin = { x: this.player.x + (i - (drones - 1) / 2) * 38, y: this.player.y - 65 - Math.sin(this.elapsedMs / 330 + i) * 15 }
                const target = this.nearestEnemy(origin, 760)
                if (!target) continue
                this.createPlayerBullet(origin.x, origin.y, Math.atan2(target.y - origin.y, target.x - origin.x), 0.42, true)
                this.callbacks.onSfx?.('drone-shoot')
                this.beams.push({ from: origin, to: { x: target.x, y: target.y }, life: 0.08, maxLife: 0.08, color: '#34d399', width: 2 })
            }
            this.droneCooldown = 0.42
        }

        const turrets: Turret[] = []
        for (const turret of this.turrets) {
            turret.life -= dt
            turret.fireCooldown -= dt
            const target = this.nearestEnemy(turret, 620)
            if (target) turret.angle = Math.atan2(target.y - turret.y, target.x - turret.x)
            if (target && turret.fireCooldown <= 0) {
                this.createPlayerBullet(turret.x, turret.y, turret.angle, 0.48)
                this.callbacks.onSfx?.('drone-shoot')
                turret.fireCooldown = 0.32
            }
            if (turret.life > 0) turrets.push(turret)
        }
        this.turrets = turrets.slice(-SHAPEZZ_COMBAT_LIMITS.turrets)
    }

    private updateSingularities(dt: number) {
        const kept: Singularity[] = []
        for (const singularity of this.singularities) {
            singularity.life -= dt
            singularity.damageTick -= dt
            for (const enemy of this.enemies) {
                const dist = distance(singularity, enemy)
                if (dist > singularity.radius * 1.8) continue
                const direction = normalized(singularity.x - enemy.x, singularity.y - enemy.y)
                const pull = (1 - clamp(dist / (singularity.radius * 1.8), 0, 1)) * 1000
                enemy.vx += direction.x * pull * dt
                enemy.vy += direction.y * pull * dt
                if (singularity.damageTick <= 0 && dist < singularity.radius) {
                    this.hitEnemy(enemy, this.stats.damage * 0.48, '#e879f9', enemy.x, enemy.y, true, singularity.triggersHealing)
                }
            }
            if (singularity.damageTick <= 0) singularity.damageTick = 0.16
            if (singularity.life > 0) kept.push(singularity)
        }
        this.singularities = kept
    }

    private updateEffects(dt: number) {
        this.shake = Math.max(0, this.shake - dt * 34)
        this.flash = Math.max(0, this.flash - dt * 2.8)
        this.particles = this.particles.filter((particle) => {
            particle.life -= dt
            particle.vy += particle.gravity * dt
            particle.x += particle.vx * dt
            particle.y += particle.vy * dt
            return particle.life > 0
        }).slice(-SHAPEZZ_COMBAT_LIMITS.particles)
        this.shockwaves = this.shockwaves.filter((wave) => {
            wave.life -= dt
            wave.radius += (wave.maxRadius - wave.radius) * Math.min(1, dt * 10)
            return wave.life > 0
        }).slice(-SHAPEZZ_COMBAT_LIMITS.shockwaves)
        this.beams = this.beams.filter((beam) => (beam.life -= dt) > 0).slice(-SHAPEZZ_COMBAT_LIMITS.beams)
        this.damageTexts = this.damageTexts.filter((text) => {
            text.life -= dt
            text.x += text.vx * dt
            text.y += text.vy * dt
            text.vy += 70 * dt
            return text.life > 0
        }).slice(-SHAPEZZ_COMBAT_LIMITS.damageTexts)
    }

    private damagePlayer(amount: number) {
        if (this.player.invulnerable > 0 || !this.running) return
        this.player.hp -= amount
        this.player.invulnerable = 0.58
        this.callbacks.onSfx?.('player-hurt')
        this.combo = 0
        this.comboTimer = 0
        this.shake = Math.max(this.shake, 12)
        this.flash = Math.max(this.flash, 0.4)
        this.burst(this.player.x, this.player.y, '#fb7185', 24, 470)
        if (this.damageTexts.length < SHAPEZZ_COMBAT_LIMITS.damageTexts) {
            this.damageTexts.push({ x: this.player.x, y: this.player.y - 35, text: `-${Math.ceil(amount)}`, color: '#fb7185', life: 0.8, maxLife: 0.8, size: 25, vx: 0, vy: -100 })
        }
    }

    private openCheckpoint() {
        this.running = false
        this.checkpointOpen = true
        const pool = [...SHAPEZZ_RUN_UPGRADES]
        const offers: ShapezzRunUpgradeId[] = []
        while (offers.length < 3 && pool.length) {
            const weighted = pool.flatMap(upgrade => {
                const weight = upgrade.rarity === 'cataclysmic' ? 1 : upgrade.rarity === 'unstable' ? 2 : 3
                return Array(weight).fill(upgrade)
            })
            const picked = weighted[Math.floor(Math.random() * weighted.length)]!
            offers.push(picked.id)
            pool.splice(pool.findIndex(upgrade => upgrade.id === picked.id), 1)
        }
        this.shake = 16
        this.flash = 0.8
        this.callbacks.onCheckpoint(offers, this.snapshot())
    }

    private nearestEnemy(from: Point, range: number, excludeId?: number, exclude = new Set<number>()) {
        let result: Enemy | null = null
        let closest = range
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || enemy.id === excludeId || exclude.has(enemy.id)) continue
            const dist = distance(from, enemy)
            if (dist < closest) {
                closest = dist
                result = enemy
            }
        }
        return result
    }

    private aimedEnemy(from: Point, angle: number, range: number, exclude = new Set<number>()) {
        let result: Enemy | null = null
        let bestScore = Infinity
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || exclude.has(enemy.id)) continue
            const dist = distance(from, enemy)
            if (dist > range) continue
            const targetAngle = Math.atan2(enemy.y - from.y, enemy.x - from.x)
            const angleDelta = Math.abs(Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle)))
            if (angleDelta > 0.7) continue
            const score = angleDelta * range * 1.4 + dist
            if (score < bestScore) {
                bestScore = score
                result = enemy
            }
        }
        return result
    }

    private ceilingBatteryPosition(index: number, count: number): Point {
        return { x: WIDTH / 2 + (index - (count - 1) / 2) * 64, y: 42 }
    }

    private burst(x: number, y: number, color: string, count: number, speed: number) {
        const load = this.particles.length / SHAPEZZ_COMBAT_LIMITS.particles + this.bullets.length / SHAPEZZ_COMBAT_LIMITS.bullets
        const densityScale = load > 1.35 ? 0.2 : load > 0.9 ? 0.45 : load > 0.55 ? 0.7 : 1
        const allowed = Math.min(Math.ceil(count * densityScale), Math.max(0, SHAPEZZ_COMBAT_LIMITS.particles - this.particles.length))
        for (let i = 0; i < allowed; i++) {
            const angle = Math.random() * Math.PI * 2
            const velocity = randomBetween(speed * 0.2, speed)
            const life = randomBetween(0.25, 0.85)
            this.particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life, maxLife: life, size: randomBetween(2, 8), color, gravity: randomBetween(0, 420), square: Math.random() < 0.65 })
        }
    }

    private render(time: number) {
        const ctx = this.ctx
        const dpr = this.canvas.width / WIDTH
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, WIDTH, HEIGHT)

        const shakeX = this.shake > 0 ? randomBetween(-this.shake, this.shake) : 0
        const shakeY = this.shake > 0 ? randomBetween(-this.shake, this.shake) : 0
        ctx.save()
        ctx.translate(shakeX, shakeY)
        this.renderBackground(time)
        this.renderPlatforms()
        this.renderPickups(time)
        this.renderSingularities(time)
        this.renderBullets()
        this.renderEnemies(time)
        this.renderCompanions(time)
        this.renderPlayer(time)
        this.renderEffects()
        ctx.restore()

        if (this.flash > 0) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(0.35, this.flash * 0.28)})`
            ctx.fillRect(0, 0, WIDTH, HEIGHT)
        }
        const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 210, WIDTH / 2, HEIGHT / 2, 760)
        vignette.addColorStop(0, 'rgba(0,0,0,0)')
        vignette.addColorStop(1, 'rgba(0,0,0,0.58)')
        ctx.fillStyle = vignette
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        if (this.running && this.aimVisible) this.renderAimCursor(time)
    }

    private renderAimCursor(time: number) {
        const ctx = this.ctx
        const { x, y } = this.aim
        const radius = this.firing ? 9 : 11
        const gap = radius + 5
        const arm = gap + 10
        const pulse = 0.82 + Math.sin(time * 7) * 0.12

        ctx.save()
        ctx.translate(x, y)
        ctx.lineCap = 'round'

        // A dark under-stroke keeps the reticle readable over bright effects.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(-arm, 0)
        ctx.lineTo(-gap, 0)
        ctx.moveTo(gap, 0)
        ctx.lineTo(arm, 0)
        ctx.moveTo(0, -arm)
        ctx.lineTo(0, -gap)
        ctx.moveTo(0, gap)
        ctx.lineTo(0, arm)
        ctx.stroke()

        ctx.shadowColor = '#22d3ee'
        ctx.shadowBlur = 10
        ctx.strokeStyle = '#ecfeff'
        ctx.lineWidth = 2.5
        ctx.stroke()

        ctx.globalAlpha = pulse
        ctx.strokeStyle = '#22d3ee'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
        ctx.stroke()

        ctx.globalAlpha = 1
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(0, 0, 2.75, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
    }

    private renderBackground(time: number) {
        const ctx = this.ctx
        const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT)
        gradient.addColorStop(0, '#06031a')
        gradient.addColorStop(0.55, '#0a1029')
        gradient.addColorStop(1, '#071119')
        ctx.fillStyle = gradient
        ctx.fillRect(-40, -40, WIDTH + 80, HEIGHT + 80)

        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(103,232,249,0.075)'
        const offset = time * 18 % 40
        for (let x = -40 + offset; x < WIDTH + 40; x += 40) {
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, HEIGHT)
            ctx.stroke()
        }
        for (let y = 0; y < HEIGHT; y += 40) {
            ctx.beginPath()
            ctx.moveTo(0, y)
            ctx.lineTo(WIDTH, y)
            ctx.stroke()
        }
        for (let i = 0; i < 45; i++) {
            const x = (i * 193 + time * (8 + i % 5)) % WIDTH
            const y = (i * 97) % 590
            ctx.fillStyle = `rgba(255,255,255,${0.08 + (i % 4) * 0.035})`
            ctx.fillRect(x, y, 1 + i % 2, 1 + i % 2)
        }
    }

    private renderPlatforms() {
        const ctx = this.ctx
        for (const platform of this.platforms) {
            ctx.shadowColor = '#22d3ee'
            ctx.shadowBlur = 16
            const gradient = ctx.createLinearGradient(0, platform.y, 0, platform.y + platform.height)
            gradient.addColorStop(0, '#67e8f9')
            gradient.addColorStop(0.16, '#164e63')
            gradient.addColorStop(1, '#07131d')
            ctx.fillStyle = gradient
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height)
            ctx.shadowBlur = 0
            ctx.fillStyle = 'rgba(103,232,249,0.55)'
            ctx.fillRect(platform.x, platform.y, platform.width, 2)
        }
    }

    private renderPlayer(time: number) {
        const ctx = this.ctx
        const angle = Math.atan2(this.aim.y - this.player.y, this.aim.x - this.player.x)
        if (this.weapon.visualIntensity >= 2) {
            ctx.save()
            ctx.translate(this.player.x, this.player.y)
            ctx.strokeStyle = this.weapon.primaryColor
            ctx.globalAlpha = 0.2 + this.weapon.visualIntensity * 0.055
            ctx.lineWidth = 1 + this.weapon.visualIntensity * 0.5
            ctx.setLineDash([7, 8])
            ctx.lineDashOffset = -time * (20 + this.weapon.visualIntensity * 8)
            ctx.beginPath()
            ctx.arc(0, 0, 27 + this.weapon.visualIntensity * 3, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
        }
        ctx.save()
        ctx.translate(this.player.x, this.player.y)
        if (this.player.invulnerable > 0 && Math.floor(time * 28) % 2 === 0) ctx.globalAlpha = 0.35
        ctx.shadowColor = this.weapon.primaryColor
        ctx.shadowBlur = 16 + this.weapon.visualIntensity * 5
        ctx.fillStyle = '#ecfeff'
        ctx.strokeStyle = this.weapon.primaryColor
        ctx.lineWidth = 4
        ctx.fillRect(-this.player.size / 2, -this.player.size / 2, this.player.size, this.player.size)
        ctx.strokeRect(-this.player.size / 2, -this.player.size / 2, this.player.size, this.player.size)
        ctx.rotate(angle)
        const gunHeight = this.weapon.type === 'launcher' ? 18 : this.weapon.type === 'shotgun' ? 15 : this.weapon.type === 'arcCoil' ? 19 : 12
        const gunLength = this.weapon.type === 'launcher' ? 42 : this.weapon.type === 'arcCoil' ? 30 : 35
        ctx.fillStyle = this.weapon.primaryColor
        ctx.fillRect(8, -gunHeight / 2, gunLength, gunHeight)
        ctx.fillStyle = this.weapon.accentColor
        if (this.weapon.type === 'shotgun') {
            ctx.fillRect(28, -7, 22, 5)
            ctx.fillRect(28, 2, 22, 5)
        } else if (this.weapon.type === 'arcCoil') {
            ctx.strokeStyle = this.weapon.accentColor
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(24, 0, 9, 0, Math.PI * 2)
            ctx.stroke()
        } else {
            ctx.fillRect(32, -3, 16, 6)
        }
        ctx.restore()

        const orbitals = Math.min(6, (this.upgrades.orbitals ?? 0) * 2)
        for (let i = 0; i < orbitals; i++) {
            const orbit = this.elapsedMs / 700 + i / orbitals * Math.PI * 2
            const x = this.player.x + Math.cos(orbit) * 72
            const y = this.player.y + Math.sin(orbit) * 72
            ctx.shadowColor = '#f0abfc'
            ctx.shadowBlur = 14
            ctx.fillStyle = '#f0abfc'
            drawPolygon(ctx, 4, x, y, 10, orbit)
            ctx.fill()
        }
        ctx.shadowBlur = 0
    }

    private renderEnemies(time: number) {
        const ctx = this.ctx
        for (const enemy of this.enemies) {
            const pulse = 1 + Math.sin(time * 5 + enemy.phase) * 0.04
            ctx.save()
            ctx.translate(enemy.x, enemy.y)
            ctx.rotate(enemy.phase * (enemy.type === 'dasher' ? 2.2 : 0.35))
            ctx.shadowColor = enemy.color
            ctx.shadowBlur = enemy.boss ? 35 : 16
            ctx.fillStyle = `${enemy.color}30`
            ctx.strokeStyle = enemy.color
            ctx.lineWidth = enemy.boss ? 7 : 4
            const sides = enemy.type === 'melee' ? 3 : enemy.type === 'shooter' ? 24 : enemy.type === 'tank' ? 6 : enemy.type === 'dasher' ? 4 : 9
            drawPolygon(ctx, sides, 0, 0, enemy.radius * pulse, enemy.type === 'melee' ? Math.PI / 2 : 0)
            ctx.fill()
            ctx.stroke()
            if (enemy.type === 'shooter' || enemy.type === 'boss') {
                ctx.fillStyle = enemy.color
                ctx.beginPath()
                ctx.arc(0, 0, enemy.radius * 0.32, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.restore()
            ctx.shadowBlur = 0

            if (enemy.hp < enemy.maxHp || enemy.boss) {
                const width = enemy.boss ? 170 : enemy.radius * 2
                ctx.fillStyle = 'rgba(0,0,0,0.7)'
                ctx.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 16, width, 5)
                ctx.fillStyle = enemy.color
                ctx.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 16, width * clamp(enemy.hp / enemy.maxHp, 0, 1), 5)
            }
        }
    }

    private renderBullets() {
        const ctx = this.ctx
        const dense = this.bullets.length > 220
        ctx.globalCompositeOperation = 'lighter'
        for (const bullet of this.bullets) {
            if (!dense) {
                ctx.shadowColor = bullet.color
                ctx.shadowBlur = bullet.radius * (2.4 + bullet.visualIntensity * 0.7)
            }
            ctx.fillStyle = bullet.color
            ctx.beginPath()
            ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2)
            ctx.fill()
            if (!dense && bullet.friendly && bullet.visualIntensity >= 2) {
                ctx.fillStyle = bullet.accentColor
                ctx.beginPath()
                ctx.arc(bullet.x, bullet.y, bullet.radius * Math.max(0.22, 0.58 - bullet.visualIntensity * 0.055), 0, Math.PI * 2)
                ctx.fill()
            }
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.shadowBlur = 0
    }

    private renderPickups(time: number) {
        const ctx = this.ctx
        for (const pickup of this.pickups) {
            const color = pickup.kind === 'coin' ? COIN_COLOR : '#34d399'
            ctx.shadowColor = color
            ctx.shadowBlur = pickup.kind === 'coin' ? 8 : 14
            ctx.fillStyle = color
            if (pickup.kind === 'coin') {
                ctx.save()
                ctx.translate(pickup.x, pickup.y)
                ctx.rotate(time * 2.4 + pickup.x * 0.03)
                ctx.beginPath()
                for (let i = 0; i < 6; i++) {
                    const angle = i / 6 * Math.PI * 2
                    const x = Math.cos(angle) * 9
                    const y = Math.sin(angle) * 9
                    if (i === 0) ctx.moveTo(x, y)
                    else ctx.lineTo(x, y)
                }
                ctx.closePath()
                ctx.lineWidth = 4
                ctx.strokeStyle = '#082f49'
                ctx.stroke()
                ctx.fill()
                ctx.shadowBlur = 0
                ctx.strokeStyle = '#ecfeff'
                ctx.lineWidth = 1.5
                ctx.stroke()
                ctx.fillStyle = '#ecfeff'
                ctx.fillRect(-1.5, -5, 3, 10)
                ctx.fillStyle = '#082f49'
                ctx.fillRect(-4, -1.5, 8, 3)
                ctx.restore()
            } else {
                ctx.fillRect(pickup.x - 3, pickup.y - 9, 6, 18)
                ctx.fillRect(pickup.x - 9, pickup.y - 3, 18, 6)
            }
        }
        ctx.shadowBlur = 0
    }

    private renderSingularities(time: number) {
        const ctx = this.ctx
        for (const singularity of this.singularities) {
            const progress = 1 - singularity.life / singularity.maxLife
            const gradient = ctx.createRadialGradient(singularity.x, singularity.y, 2, singularity.x, singularity.y, singularity.radius)
            gradient.addColorStop(0, '#000000')
            gradient.addColorStop(0.25, '#581c87')
            gradient.addColorStop(0.55, 'rgba(232,121,249,0.35)')
            gradient.addColorStop(1, 'rgba(232,121,249,0)')
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.arc(singularity.x, singularity.y, singularity.radius, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#e879f9'
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(singularity.x, singularity.y, 16 + Math.sin(time * 12 + progress * 10) * 7, 0, Math.PI * 2)
            ctx.stroke()
        }
    }

    private renderCompanions(time: number) {
        const ctx = this.ctx
        const ceilingBatteries = Math.min(6, this.upgrades.ceilingBattery ?? 0)
        for (let i = 0; i < ceilingBatteries; i++) {
            const position = this.ceilingBatteryPosition(i, ceilingBatteries)
            const target = this.nearestEnemy(position, 920)
            const angle = target ? Math.atan2(target.y - position.y, target.x - position.x) : Math.PI / 2
            ctx.save()
            ctx.translate(position.x, position.y)
            ctx.rotate(angle)
            ctx.fillStyle = '#18230d'
            ctx.strokeStyle = '#a3e635'
            ctx.lineWidth = 3
            ctx.shadowColor = '#a3e635'
            ctx.shadowBlur = 14
            ctx.fillRect(-13, -11, 26, 22)
            ctx.strokeRect(-13, -11, 26, 22)
            ctx.fillStyle = '#a3e635'
            ctx.fillRect(7, -4, 25, 8)
            ctx.restore()
        }
        const drones = Math.min(6, (this.upgrades.droneSwarm ?? 0) * 2)
        for (let i = 0; i < drones; i++) {
            const x = this.player.x + (i - (drones - 1) / 2) * 38
            const y = this.player.y - 65 - Math.sin(time * 5 + i) * 15
            ctx.shadowColor = '#34d399'
            ctx.shadowBlur = 14
            ctx.strokeStyle = '#34d399'
            ctx.lineWidth = 3
            drawPolygon(ctx, 3, x, y, 10, -Math.PI / 2)
            ctx.stroke()
        }
        for (const turret of this.turrets) {
            ctx.save()
            ctx.translate(turret.x, turret.y)
            ctx.rotate(turret.angle)
            ctx.globalAlpha = clamp(turret.life / 0.8, 0, 1)
            ctx.fillStyle = '#2dd4bf'
            ctx.shadowColor = '#2dd4bf'
            ctx.shadowBlur = 12
            ctx.fillRect(-10, -10, 20, 20)
            ctx.fillRect(6, -3, 20, 6)
            ctx.restore()
        }
        ctx.shadowBlur = 0
    }

    private renderEffects() {
        const ctx = this.ctx
        ctx.globalCompositeOperation = 'lighter'
        for (const particle of this.particles) {
            ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1)
            ctx.fillStyle = particle.color
            if (particle.square) ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size)
            else {
                ctx.beginPath()
                ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
                ctx.fill()
            }
        }
        for (const wave of this.shockwaves) {
            ctx.globalAlpha = clamp(wave.life / wave.maxLife, 0, 1)
            ctx.strokeStyle = wave.color
            ctx.lineWidth = wave.width * (wave.life / wave.maxLife)
            ctx.beginPath()
            ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2)
            ctx.stroke()
        }
        for (const beam of this.beams) {
            ctx.globalAlpha = clamp(beam.life / beam.maxLife, 0, 1)
            ctx.strokeStyle = beam.color
            ctx.lineWidth = beam.width
            ctx.beginPath()
            ctx.moveTo(beam.from.x, beam.from.y)
            const midX = (beam.from.x + beam.to.x) / 2 + randomBetween(-16, 16)
            const midY = (beam.from.y + beam.to.y) / 2 + randomBetween(-16, 16)
            ctx.lineTo(midX, midY)
            ctx.lineTo(beam.to.x, beam.to.y)
            ctx.stroke()
        }
        ctx.globalCompositeOperation = 'source-over'
        for (const text of this.damageTexts) {
            ctx.globalAlpha = clamp(text.life / text.maxLife, 0, 1)
            ctx.fillStyle = text.color
            ctx.font = `900 ${text.size}px ui-sans-serif, system-ui, sans-serif`
            ctx.textAlign = 'center'
            ctx.shadowColor = '#000000'
            ctx.shadowBlur = 5
            ctx.fillText(text.text, text.x, text.y)
        }
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
    }
}
