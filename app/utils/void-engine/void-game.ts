import { Application, Container, Graphics } from 'pixi.js'
import gsap from 'gsap'
import { randomChance, randomFloat, randomInt } from '#shared/utils/random'
import {
    VOID_RUN_DURATION_MS, VOID_STORM_START_MS, VOID_STORM_FULL_MS,
    VOID_STORM_DPS_FRACTION, VOID_STORM_ENEMY_MULT,
    VOID_DOCK_RADIUS, VOID_EXTRACT_HOLD_MS,
    VOID_BOOST_MULT, VOID_BOOST_CAPACITY_MS, VOID_BOOST_RECHARGE_PER_SEC, VOID_SHIELD_RECHARGE_DELAY_MS,
    VOID_BOSS_ID, VOID_MIDBOSS_ID, VOID_MIDBOSS_SPAWN_MS, VOID_BOSS_RESPAWN_MS,
    VOID_DRONE_ID, VOID_WARDEN_DRONE_COUNT, VOID_WARDEN_MAX_DRONES, VOID_LANE_SPACING,
    voidSector, voidRollRock, voidRollEnemy, voidEnemy, voidShip, voidResource, voidBundleUnits,
    voidBundleValue, voidVolley,
    voidRampMultiplier, voidRampSpawnIntervalMult, voidRampExtraEnemies, voidRampMinute,
    type VoidResourceBundle, type VoidResourceId, type VoidEnemyDefinition
} from '#shared/utils/gamelogic/void'
import {
    VIEW_W, VIEW_H, WORLD_W, WORLD_H, MOTHERSHIP_RADIUS, DUST_MOTE_COUNT,
    THRUST_ACCEL, LINEAR_DRAG, PLAYER_SHOT_LIFE_MS, ENEMY_SHOT_SPEED,
    MINING_BREAK_GRACE_MS, ROCK_RESPAWN_MS, CAMERA_LERP, CAMERA_LOOKAHEAD,
    SHOCKWAVE_TELEGRAPH_MS, SHOCKWAVE_RADIUS, SHOCKWAVE_EXPAND_MS,
    RAILBEAM_CHARGE_MS, RAILBEAM_LENGTH, RAILBEAM_WIDTH, RAILBEAM_ACTIVE_MS,
    BOSS_REINFORCE_COUNT, MINE_ARM_MS, MINE_LIFE_MS, MINE_TRIGGER_RADIUS, MINE_BLAST_RADIUS
} from './constants'
import { clamp, dist, distSq, randRange, segPointDist, stepAngle } from './math'
import * as fx from './fx'
import {
    emptySpecialFlags, specialFlagKey,
    type Bullet, type DroneEntity, type EnemyEntity, type MineEntity, type Particle, type PickupEntity,
    type RailbeamEntity, type RockEntity, type ShockwaveEntity, type SingularityEntity,
    type SpecialFlags, type VoidGameCallbacks, type VoidLaunchConfig, type VoidRunResult
} from './types'

interface TurretMount {
    runtime: VoidLaunchConfig['turrets'][number]
    offsetX: number
    offsetY: number
    fireTimer: number
    gfx: Container
}

export class VoidGame {
    private app: Application | null = null
    private callbacks: VoidGameCallbacks

    // ── Layers ──
    private nebula = new Graphics()
    private backdrop = new Graphics()
    private starLayers: { container: Container, parallax: number }[] = []
    private worldRoot = new Container()
    private boundsLayer = new Graphics()
    private dustLayer = new Container()
    private bgLayer = new Container()
    private rockLayer = new Container()
    private pickupLayer = new Container()
    private enemyLayer = new Container()
    private bulletLayer = new Container()
    private playerLayer = new Container()
    private effectLayer = new Container()
    private textLayer = new Container()
    private stormLayer = new Graphics()
    private minimap = new Container()
    private minimapDots = new Graphics()

    // ── Run config ──
    private config: VoidLaunchConfig | null = null
    private sectorTier = 1

    // ── Lifecycle ──
    private running = false
    private paused = false
    private destroyed = false
    private ended = false
    private elapsedMs = 0

    // ── Player ──
    private playerRoot = new Container()
    private playerBody: Graphics | null = null
    private playerFlame: Graphics | null = null
    private playerGlow: Graphics | null = null
    private playerRadius = 17
    private playerBarrels = 1
    // The player's own hull bar only appears when something has hit you, then
    // fades back out — a permanent bar over your own ship is just clutter.
    private healthBar: { root: Container, hullFill: Graphics, shieldFill: Graphics, width: number } | null = null
    private healthBarVisibleMs = 0
    private px = WORLD_W / 2
    private py = WORLD_H / 2
    private pvx = 0
    private pvy = 0
    private pAngle = 0
    private hull = 100
    private maxHull = 100
    private shield = 0
    private maxShield = 0
    private msSinceHit = 0
    private boostMs = VOID_BOOST_CAPACITY_MS
    private invulnMs = 0

    // ── Economy ──
    private cargo: VoidResourceBundle = {}
    private cargoUnits = 0
    private cargoCapacity = 60

    // ── Input ──
    private keys = new Set<string>()
    private firing = false
    private aimWorldX = WORLD_W / 2 + 200
    private aimWorldY = WORLD_H / 2
    private listeners: (() => void)[] = []

    // ── Entities ──
    private rocks: RockEntity[] = []
    private enemies: EnemyEntity[] = []
    private bullets: Bullet[] = []
    private particles: Particle[] = []
    private pickups: PickupEntity[] = []
    private shockwaves: ShockwaveEntity[] = []
    private railbeams: RailbeamEntity[] = []
    private mines: MineEntity[] = []
    private singularities: SingularityEntity[] = []
    private drones: DroneEntity[] = []
    private turrets: TurretMount[] = []
    private nextId = 1

    // ── Timers ──
    private fireTimer = 0
    private spawnTimer = 0
    private bossTimer = Infinity
    private midBossTimer = VOID_MIDBOSS_SPAWN_MS
    private extractMs = 0
    // Docking only counts once you have actually left the ring. Without this a
    // run that starts near the mothership can immediately re-trigger the
    // extraction it just finished, which reads as a game frozen at "100%".
    private dockArmed = false
    private stormTickMs = 0
    private announced = new Set<string>()

    // ── Mining ──
    private miningRockId: number | null = null
    private miningRing = new Graphics()
    private miningBeam = new Graphics()

    // ── Camera ──
    private camX = WORLD_W / 2
    private camY = WORLD_H / 2
    private shakeMs = 0
    private shakeMag = 0

    // ── Specials ──
    private specials: SpecialFlags = emptySpecialFlags()

    // ── Stats ──
    private kills = 0
    private bossesKilled = 0
    private rocksMined = 0
    private shotsFired = 0
    private killsByType = new Map<string, { name: string, count: number }>()
    private deepestStormDamage = 0

    constructor(callbacks: VoidGameCallbacks) {
        this.callbacks = callbacks
    }

    // ─── Mount / teardown ────────────────────────────────────────────────────

    async mount(host: HTMLDivElement) {
        // Navigating away from /void and back remounts the page with a brand
        // new host element, but the engine itself lives at module scope and is
        // reused. Re-initialising here would build a second Application whose
        // ticker also calls tick() — two updates per frame, i.e. a run that
        // plays at double speed. If we already have an app, just re-parent its
        // canvas into the new host.
        if (this.app) {
            host.appendChild(this.app.canvas)
            return
        }

        this.app = new Application()
        await this.app.init({
            width: VIEW_W,
            height: VIEW_H,
            backgroundAlpha: 1,
            background: 0x04050c,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2)
        })
        if (this.destroyed) {
            this.app.destroy(true, { children: true })
            this.app = null
            return
        }

        this.app.canvas.classList.add('block', 'touch-none')
        // `autoDensity` writes an inline width/height in CSS pixels (1400x820),
        // and an inline style beats any utility class — so the canvas kept its
        // authored size, overflowed a narrower host, and had its right and
        // bottom edges clipped away by the container. Override it explicitly.
        this.app.canvas.style.width = '100%'
        this.app.canvas.style.height = '100%'
        host.appendChild(this.app.canvas)

        fx.drawNebula(this.nebula)
        this.app.stage.addChild(this.nebula, this.backdrop)

        this.starLayers = fx.buildStarfield()
        for (const layer of this.starLayers) this.app.stage.addChild(layer.container)

        this.worldRoot.addChild(
            this.boundsLayer, this.dustLayer, this.bgLayer, this.rockLayer, this.pickupLayer,
            this.enemyLayer, this.bulletLayer, this.playerLayer, this.effectLayer, this.textLayer
        )
        this.app.stage.addChild(this.worldRoot)
        this.app.stage.addChild(this.stormLayer)

        this.minimap.addChild(this.minimapDots)
        this.minimap.position.set(VIEW_W - 224, VIEW_H - 152)
        this.app.stage.addChild(this.minimap)

        fx.drawWorldBounds(this.boundsLayer)
        this.effectLayer.addChild(this.miningBeam)
        this.effectLayer.addChild(this.miningRing)

        this.attachInput()
        this.app.ticker.add(ticker => this.tick(ticker.deltaMS))
    }

    destroy() {
        this.destroyed = true
        this.running = false
        this.detachInput()
        // Looping tweens must die before their targets do, or the next gsap
        // frame writes into a destroyed pixi object and throws.
        fx.killAllFxTweens()
        if (this.app) {
            this.app.destroy(true, { children: true })
            this.app = null
        }
    }

    // ─── Input ───────────────────────────────────────────────────────────────

    private attachInput() {
        if (!this.app) return
        const canvas = this.app.canvas

        const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase()
            if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
                // Space scrolls the page by default, which is fatal for a game
                // that uses it as the boost key.
                if (this.running) event.preventDefault()
                this.keys.add(key)
            }
        }
        const onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase())
        const onBlur = () => { this.keys.clear(); this.firing = false }

        const toWorld = (clientX: number, clientY: number) => {
            const rect = canvas.getBoundingClientRect()
            const sx = (clientX - rect.left) / rect.width * VIEW_W
            const sy = (clientY - rect.top) / rect.height * VIEW_H
            return { x: sx - this.worldRoot.position.x, y: sy - this.worldRoot.position.y }
        }

        const onPointerMove = (event: PointerEvent) => {
            const point = toWorld(event.clientX, event.clientY)
            this.aimWorldX = point.x
            this.aimWorldY = point.y
        }
        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return
            const point = toWorld(event.clientX, event.clientY)
            this.aimWorldX = point.x
            this.aimWorldY = point.y
            this.firing = true
        }
        const onPointerUp = () => { this.firing = false }
        const onContextMenu = (event: MouseEvent) => event.preventDefault()

        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('blur', onBlur)
        canvas.addEventListener('pointermove', onPointerMove)
        canvas.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointerup', onPointerUp)
        canvas.addEventListener('contextmenu', onContextMenu)

        this.listeners = [
            () => window.removeEventListener('keydown', onKeyDown),
            () => window.removeEventListener('keyup', onKeyUp),
            () => window.removeEventListener('blur', onBlur),
            () => canvas.removeEventListener('pointermove', onPointerMove),
            () => canvas.removeEventListener('pointerdown', onPointerDown),
            () => window.removeEventListener('pointerup', onPointerUp),
            () => canvas.removeEventListener('contextmenu', onContextMenu)
        ]
    }

    private detachInput() {
        for (const off of this.listeners) off()
        this.listeners = []
    }

    // ─── Run lifecycle ───────────────────────────────────────────────────────

    /**
     * Returns false when the renderer isn't ready yet. The caller must not flip
     * its own "running" flag on a false — doing so leaves the HUD showing a
     * live control deck over an engine that will never tick.
     */
    start(config: VoidLaunchConfig): boolean {
        if (!this.app || this.destroyed) return false
        this.resetRun(config.sector)
        this.config = config
        this.sectorTier = config.sector
        this.playerBarrels = voidShip(config.shipId).barrels
        this.maxHull = config.stats.maxHull
        this.hull = config.stats.maxHull
        this.maxShield = config.stats.maxShield
        this.shield = config.stats.maxShield
        this.cargoCapacity = config.stats.cargoCapacity

        this.specials = emptySpecialFlags()
        for (const id of config.stats.specialIds) this.specials[specialFlagKey(id)] = true

        this.buildPlayer()
        this.buildTurrets()
        if (this.specials.drones) this.buildDrones()
        this.spawnRockField()
        this.spawnInitialEnemies()

        const sector = voidSector(this.sectorTier)
        this.bossTimer = sector.bossFirstSpawnMs
        this.midBossTimer = VOID_MIDBOSS_SPAWN_MS
        this.spawnTimer = sector.spawnIntervalMs

        this.running = true
        this.paused = false
        this.emitHull()
        this.emitCargo()
        // Push every HUD value to its starting state so nothing can survive
        // from the previous run — a stale extraction bar in particular.
        this.callbacks.onExtractProgress(0, false)
        this.callbacks.onMiningProgress(0, null)
        this.callbacks.onTimeChange(0, 0, 1)
        this.callbacks.onBoostChange(this.boostMs, VOID_BOOST_CAPACITY_MS)
        return true
    }

    pause() { this.paused = true }
    resume() { if (this.running) this.paused = false }

    cancel() {
        if (!this.running) return
        this.endRun('cancelled')
    }

    private resetRun(tier: number) {
        // Kill every looping tween before tearing the display tree down, then
        // rebuild the pieces that own one (backdrop, mothership) from scratch.
        fx.killAllFxTweens()
        gsap.killTweensOf(this.playerRoot)

        const layers = [
            this.dustLayer, this.bgLayer, this.rockLayer, this.pickupLayer,
            this.enemyLayer, this.bulletLayer, this.playerLayer, this.textLayer
        ]
        for (const layer of layers) {
            layer.removeChildren().forEach(child => child.destroy({ children: true }))
        }
        this.effectLayer.removeChildren().forEach((child) => {
            if (child !== this.miningBeam && child !== this.miningRing) child.destroy({ children: true })
        })
        this.miningBeam.clear()
        this.miningRing.clear()
        this.effectLayer.addChild(this.miningBeam, this.miningRing)

        // The static backdrop is re-tinted per sector; it never moves, so it
        // costs nothing to redraw and never drags across the playfield.
        fx.drawStaticBackdrop(this.backdrop, voidSector(tier).color)
        fx.buildDustField(this.dustLayer, DUST_MOTE_COUNT)
        const mothership = fx.buildMothership()
        mothership.position.set(WORLD_W / 2, WORLD_H / 2)
        this.bgLayer.addChild(mothership)

        this.rocks = []
        this.enemies = []
        this.bullets = []
        this.particles = []
        this.pickups = []
        this.shockwaves = []
        this.railbeams = []
        this.mines = []
        this.singularities = []
        this.drones = []
        this.turrets = []
        this.healthBar = null
        this.healthBarVisibleMs = 0
        this.dockArmed = false
        this.elapsedMs = 0
        this.cargo = {}
        this.cargoUnits = 0
        this.kills = 0
        this.bossesKilled = 0
        this.rocksMined = 0
        this.shotsFired = 0
        this.killsByType.clear()
        this.deepestStormDamage = 0
        this.announced.clear()
        this.miningRockId = null
        this.extractMs = 0
        this.invulnMs = 0
        this.boostMs = VOID_BOOST_CAPACITY_MS
        this.msSinceHit = 0
        this.ended = false
        this.px = WORLD_W / 2 + 240
        this.py = WORLD_H / 2
        this.pvx = 0
        this.pvy = 0
        this.pAngle = 0
        this.camX = this.px
        this.camY = this.py
    }

    // ─── Construction ────────────────────────────────────────────────────────

    private buildPlayer() {
        const ship = voidShip(this.config?.shipId ?? 'skiff')
        const built = fx.buildPlayerShip(ship.id, ship.radius, ship.color, ship.accent, ship.trim)
        this.playerRoot = built.root
        this.playerBody = built.body
        this.playerFlame = built.flame
        this.playerGlow = built.engineGlow
        this.playerRadius = ship.radius
        this.playerRoot.position.set(this.px, this.py)
        this.playerLayer.addChild(this.playerRoot)

        this.healthBar = fx.buildPlayerHealthBar()
        this.playerLayer.addChild(this.healthBar.root)
        fx.drawPlayerHealthBar(this.healthBar.hullFill, this.healthBar.shieldFill, this.healthBar.width, 1, this.maxShield > 0 ? 1 : 0)
    }

    /** Flash the hull bar into view; it fades on its own a few seconds later. */
    private revealHealthBar() {
        this.healthBarVisibleMs = 2600
        if (!this.healthBar) return
        this.healthBar.root.alpha = 1
        fx.drawPlayerHealthBar(
            this.healthBar.hullFill,
            this.healthBar.shieldFill,
            this.healthBar.width,
            this.maxHull > 0 ? this.hull / this.maxHull : 0,
            this.maxShield > 0 ? this.shield / this.maxShield : 0
        )
    }

    private updateHealthBar(dtMs: number) {
        const bar = this.healthBar
        if (!bar) return
        bar.root.position.set(this.px, this.py - this.playerRadius * 1.9 - 16)

        if (this.healthBarVisibleMs <= 0) {
            bar.root.alpha = 0
            return
        }
        this.healthBarVisibleMs -= dtMs
        // Hold at full opacity, then fade over the last 700ms.
        bar.root.alpha = clamp(this.healthBarVisibleMs / 700, 0, 1)
        fx.drawPlayerHealthBar(
            bar.hullFill,
            bar.shieldFill,
            bar.width,
            this.maxHull > 0 ? this.hull / this.maxHull : 0,
            this.maxShield > 0 ? this.shield / this.maxShield : 0
        )
    }

    private buildTurrets() {
        const ship = voidShip(this.config?.shipId ?? 'skiff')
        const list = this.config?.turrets ?? []
        this.turrets = list.map((runtime, index) => {
            // Hardpoints alternate port/starboard down the hull so a four-slot
            // Leviathan reads as a broadside rather than a stack.
            const side = index % 2 === 0 ? -1 : 1
            const row = Math.floor(index / 2)
            const gfx = new Container()
            const g = new Graphics()
            g.circle(-2, 0, 5.4).fill({ color: 0x1e293b })
            g.circle(-2, 0, 4.2).fill({ color: runtime.color, alpha: 0.85 })
            g.rect(-4, -3.4, 12, 6.8).fill({ color: 0x334155 })
            g.rect(5, -1.7, 10, 3.4).fill({ color: runtime.color })
            g.rect(5, -0.6, 10, 1.2).fill({ color: 0xe2e8f0, alpha: 0.9 })
            gfx.addChild(g)
            this.playerLayer.addChild(gfx)
            return {
                runtime,
                offsetX: ship.radius * (0.2 - row * 0.55),
                offsetY: ship.radius * 0.88 * side,
                fireTimer: randRange(0, runtime.fireGapMs),
                gfx
            }
        })
    }

    private buildDrones() {
        for (let i = 0; i < 3; i++) {
            const gfx = fx.buildDrone(0xf43f5e)
            this.playerLayer.addChild(gfx)
            this.drones.push({ gfx, angle: (i / 3) * Math.PI * 2, fireTimer: randRange(0, 700) })
        }
    }

    private spawnRockField() {
        const sector = voidSector(this.sectorTier)
        const count = randomInt(sector.rockCountMin, sector.rockCountMax) * 5
        for (let i = 0; i < count; i++) this.spawnRock()
    }

    private spawnRock() {
        const def = voidRollRock(this.sectorTier)
        const point = this.findOpenPoint(MOTHERSHIP_RADIUS * 2.8)
        const radius = def.radius * randRange(0.82, 1.28)
        const built = fx.buildRock(def, radius)
        built.root.position.set(point.x, point.y)
        built.root.rotation = randomFloat() * Math.PI * 2
        this.rockLayer.addChild(built.root)
        this.rocks.push({
            id: this.nextId++,
            def,
            root: built.root,
            body: built.body,
            x: point.x,
            y: point.y,
            radius,
            rotation: built.root.rotation,
            spin: randRange(-0.14, 0.14),
            progress: 0,
            breakGraceMs: 0,
            depleted: false,
            respawnMs: 0
        })
    }

    private spawnInitialEnemies() {
        const sector = voidSector(this.sectorTier)
        for (let i = 0; i < sector.baseEnemies * 3; i++) this.spawnEnemy(voidRollEnemy(this.sectorTier), true)
    }

    private findOpenPoint(minFromCentre: number) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const x = randRange(160, WORLD_W - 160)
            const y = randRange(160, WORLD_H - 160)
            if (dist(x, y, WORLD_W / 2, WORLD_H / 2) < minFromCentre) continue
            if (this.rocks.some(rock => distSq(rock.x, rock.y, x, y) < (rock.radius + 140) ** 2)) continue
            return { x, y }
        }
        return { x: randRange(160, WORLD_W - 160), y: randRange(160, WORLD_H - 160) }
    }

    private spawnEnemy(def: VoidEnemyDefinition, anywhere = false, carrierId: number | null = null) {
        const sector = voidSector(this.sectorTier)
        // Everything that spawns later in the run is tougher than what spawned
        // at the start — the sector does not stay the same difficulty.
        const ramp = voidRampMultiplier(this.elapsedMs)
        let x = 0
        let y = 0
        for (let attempt = 0; attempt < 30; attempt++) {
            x = randRange(140, WORLD_W - 140)
            y = randRange(140, WORLD_H - 140)
            const fromCentre = dist(x, y, WORLD_W / 2, WORLD_H / 2)
            const fromPlayer = dist(x, y, this.px, this.py)
            // Never drop a patrol on top of the dock or in the player's lap.
            if (fromCentre < MOTHERSHIP_RADIUS * 3) continue
            if (!anywhere && fromPlayer < 640) continue
            if (anywhere && fromPlayer < 500) continue
            break
        }

        const built = fx.buildEnemyShip(def)
        built.root.position.set(x, y)

        const hpBarBg = new Graphics()
        const barWidth = Math.max(32, def.radius * 2.1)
        hpBarBg.rect(-barWidth / 2, -def.radius - 18, barWidth, 5).fill({ color: 0x0f172a, alpha: 0.85 })
        const hpBar = new Graphics()
        built.root.addChild(hpBarBg, hpBar)

        const hp = Math.round(def.hp * sector.threat * ramp)
        const enemy: EnemyEntity = {
            id: this.nextId++,
            def,
            root: built.root,
            body: built.body,
            hpBar,
            hpBarBg,
            x,
            y,
            vx: 0,
            vy: 0,
            angle: randomFloat() * Math.PI * 2,
            hp,
            maxHp: hp,
            damage: def.damage * (0.75 + sector.threat * 0.25) * ramp,
            speed: def.speed * (1 + (sector.threat - 1) * 0.1),
            fireTimer: randRange(0, def.fireGapMs),
            abilityTimer: def.abilityCooldownMs > 0 ? randRange(def.abilityCooldownMs * 0.4, def.abilityCooldownMs) : Infinity,
            state: 'drift',
            driftAngle: randomFloat() * Math.PI * 2,
            driftTimer: randRange(1500, 4000),
            strafeSign: randomChance(0.5) ? 1 : -1,
            dead: false,
            boss: Boolean(def.boss),
            flashMs: 0,
            carrierId
        }
        this.drawEnemyHpBar(enemy)
        this.enemyLayer.addChild(built.root)
        this.enemies.push(enemy)

        if (enemy.boss) {
            this.callbacks.onBossSpawn?.(def.name)
            gsap.fromTo(built.root.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.7, ease: 'back.out(2)' })
            this.burst(x, y, def.accentColor, 40, 420)
        }
        return enemy
    }

    // ─── Main loop ───────────────────────────────────────────────────────────

    private tick(deltaMs: number) {
        if (!this.running || this.paused || this.destroyed) return
        // A backgrounded tab hands back one enormous delta on return; clamping
        // keeps collision from tunnelling through half the sector.
        const dtMs = Math.min(deltaMs, 50)
        const dt = dtMs / 1000

        const minuteBefore = voidRampMinute(this.elapsedMs)
        this.elapsedMs += dtMs
        const minuteAfter = voidRampMinute(this.elapsedMs)
        if (minuteAfter > minuteBefore && minuteAfter > 0 && this.elapsedMs < VOID_STORM_START_MS) {
            this.callbacks.onNotice?.(`Patrol strength up — minute ${minuteAfter}.`, 'bad')
        }

        if (this.elapsedMs >= VOID_RUN_DURATION_MS) {
            this.endRun('timeout')
            return
        }

        this.updatePlayer(dt, dtMs)
        this.updateMining(dtMs)
        this.updateTurrets(dtMs)
        this.updateDrones(dt, dtMs)
        this.updateEnemies(dt, dtMs)
        this.updateBullets(dt, dtMs)
        this.updateShockwaves(dtMs)
        this.updateRailbeams(dtMs)
        this.updateMines(dtMs)
        this.updateSingularities(dt, dtMs)
        this.updatePickups(dt, dtMs)
        this.updateRocks(dt, dtMs)
        this.updateParticles(dt, dtMs)
        this.updateStorm(dt, dtMs)
        this.updateExtraction(dtMs)
        this.updateHealthBar(dtMs)
        this.updateCamera(dt, dtMs)
        this.updateMinimap()

        this.callbacks.onTimeChange(this.elapsedMs, this.stormProgress(), voidRampMultiplier(this.elapsedMs))
        this.callbacks.onBoostChange(this.boostMs, VOID_BOOST_CAPACITY_MS)
    }

    // ─── Player ──────────────────────────────────────────────────────────────

    private updatePlayer(dt: number, dtMs: number) {
        const stats = this.config!.stats
        this.invulnMs = Math.max(0, this.invulnMs - dtMs)
        this.msSinceHit += dtMs

        let ax = 0
        let ay = 0
        if (this.keys.has('w') || this.keys.has('arrowup')) ay -= 1
        if (this.keys.has('s') || this.keys.has('arrowdown')) ay += 1
        if (this.keys.has('a') || this.keys.has('arrowleft')) ax -= 1
        if (this.keys.has('d') || this.keys.has('arrowright')) ax += 1
        const mag = Math.hypot(ax, ay)
        if (mag > 0) { ax /= mag; ay /= mag }

        const wantsBoost = this.keys.has(' ') && this.boostMs > 0 && mag > 0
        if (wantsBoost) {
            this.boostMs = Math.max(0, this.boostMs - dtMs)
            if (randomChance(0.55)) this.emitThrusterParticle(true)
        } else {
            this.boostMs = Math.min(VOID_BOOST_CAPACITY_MS, this.boostMs + VOID_BOOST_RECHARGE_PER_SEC * dt)
        }

        const topSpeed = stats.speed * (wantsBoost ? VOID_BOOST_MULT : 1)
        this.pvx += ax * topSpeed * THRUST_ACCEL * dt
        this.pvy += ay * topSpeed * THRUST_ACCEL * dt

        const drag = Math.exp(-LINEAR_DRAG * dt)
        this.pvx *= drag
        this.pvy *= drag

        const speed = Math.hypot(this.pvx, this.pvy)
        if (speed > topSpeed) {
            this.pvx = this.pvx / speed * topSpeed
            this.pvy = this.pvy / speed * topSpeed
        }

        // Clamp to the hull's own radius so a Leviathan can't bury half itself
        // in the sector wall, and kill the velocity component that's pushing
        // into it so the ship doesn't stick.
        const margin = this.playerRadius * 1.6
        const nextX = this.px + this.pvx * dt
        const nextY = this.py + this.pvy * dt
        if (nextX < margin || nextX > WORLD_W - margin) this.pvx *= -0.25
        if (nextY < margin || nextY > WORLD_H - margin) this.pvy *= -0.25
        this.px = clamp(nextX, margin, WORLD_W - margin)
        this.py = clamp(nextY, margin, WORLD_H - margin)

        // Rotation lags the cursor by the hull's turn rate — this is the whole
        // reason a Leviathan feels different to fly than a Wraith.
        const desired = Math.atan2(this.aimWorldY - this.py, this.aimWorldX - this.px)
        this.pAngle = stepAngle(this.pAngle, desired, stats.turnRate * dt)

        this.playerRoot.position.set(this.px, this.py)
        this.playerRoot.rotation = this.pAngle
        const throttle = mag > 0 ? (wantsBoost ? 1 : 0.6) : 0.18
        if (this.playerGlow) this.playerGlow.alpha = 0.25 + throttle * 0.75
        if (this.playerFlame) this.playerFlame.alpha = 0.25 + throttle * 0.75
        if (mag > 0 && randomChance(0.5)) this.emitThrusterParticle(false)

        for (const mount of this.turrets) {
            const cos = Math.cos(this.pAngle)
            const sin = Math.sin(this.pAngle)
            mount.gfx.position.set(
                this.px + mount.offsetX * cos - mount.offsetY * sin,
                this.py + mount.offsetX * sin + mount.offsetY * cos
            )
        }

        if (this.maxShield > 0 && this.msSinceHit > VOID_SHIELD_RECHARGE_DELAY_MS && this.shield < this.maxShield) {
            this.shield = Math.min(this.maxShield, this.shield + stats.shieldRegenPerSec * dt)
            this.emitHull()
        }

        // Firing resolves to mining when the cursor is on a rock in range,
        // otherwise it's the primary cannon. Same hardware, two jobs.
        this.fireTimer -= dtMs
        const miningTarget = this.firing ? this.pickMiningTarget() : null
        this.miningRockId = miningTarget?.id ?? null
        if (this.firing && !miningTarget && this.fireTimer <= 0) this.firePrimary()
    }

    private emitThrusterParticle(boost: boolean) {
        const back = this.pAngle + Math.PI
        const x = this.px + Math.cos(back) * this.playerRadius
        const y = this.py + Math.sin(back) * this.playerRadius
        const spread = randRange(-0.35, 0.35)
        this.spawnParticle({
            x,
            y,
            vx: Math.cos(back + spread) * randRange(60, 190) + this.pvx * 0.2,
            vy: Math.sin(back + spread) * randRange(60, 190) + this.pvy * 0.2,
            color: boost ? 0xbfdbfe : 0x38bdf8,
            radius: boost ? randRange(3.4, 6) : randRange(2, 4),
            life: boost ? 420 : 280,
            alpha: 0.85
        })
    }

    private firePrimary() {
        const stats = this.config!.stats
        const rocket = this.specials.rocket
        this.fireTimer = stats.fireGapMs * (rocket ? 1.25 : 1)

        // Barrels fire parallel lanes rather than a cone — a triple-barrel hull
        // sweeps a wide corridor, which is what makes it feel like an upgrade
        // and not just a bigger number.
        const { lanes, damagePerShot } = voidVolley(stats.damage, this.playerBarrels, stats.multishot)
        const cos = Math.cos(this.pAngle)
        const sin = Math.sin(this.pAngle)
        const nx = -sin
        const ny = cos

        for (let i = 0; i < lanes; i++) {
            const lateral = (i - (lanes - 1) / 2) * VOID_LANE_SPACING
            const muzzleX = this.px + cos * this.playerRadius * 1.6 + nx * lateral
            const muzzleY = this.py + sin * this.playerRadius * 1.6 + ny * lateral
            const crit = stats.critChance > 0 && randomChance(stats.critChance)
            this.spawnBullet({
                x: muzzleX,
                y: muzzleY,
                angle: this.pAngle,
                speed: stats.projectileSpeed * (this.specials.railgun ? 1.6 : 1),
                damage: damagePerShot * (crit ? stats.critDamage : 1) * (rocket ? 1.6 : 1),
                color: crit ? 0xfde047 : rocket ? 0xfb923c : 0x67e8f9,
                pierce: this.specials.railgun ? 99 : stats.pierce,
                splash: rocket ? Math.max(70, stats.splash) : stats.splash,
                lifesteal: this.specials.siphon ? Math.max(0.1, stats.lifesteal) : stats.lifesteal,
                homing: stats.homing,
                rocket,
                chain: this.specials.chain,
                hostile: false,
                range: stats.weaponRange,
                size: crit ? 1.3 : 1.1
            })
            this.spawnParticle({ x: muzzleX, y: muzzleY, vx: 0, vy: 0, color: 0xe0f2fe, radius: 8, life: 110, alpha: 0.8 })
        }
        this.shotsFired += lanes
        this.callbacks.onShoot?.()
    }

    // ─── Mining ──────────────────────────────────────────────────────────────

    private pickMiningTarget(): RockEntity | null {
        const range = this.config!.stats.miningRange
        let best: RockEntity | null = null
        let bestScore = Infinity
        for (const rock of this.rocks) {
            if (rock.depleted) continue
            const toPlayer = dist(rock.x, rock.y, this.px, this.py) - rock.radius
            if (toPlayer > range) continue
            const toCursor = dist(rock.x, rock.y, this.aimWorldX, this.aimWorldY)
            // The cursor has to actually be near the rock, not merely in range.
            if (toCursor > rock.radius + 90) continue
            if (toCursor < bestScore) { bestScore = toCursor; best = rock }
        }
        return best
    }

    private updateMining(dtMs: number) {
        this.miningBeam.clear()
        this.miningRing.clear()

        const target = this.rocks.find(rock => rock.id === this.miningRockId && !rock.depleted)
        for (const rock of this.rocks) {
            if (rock === target || rock.progress <= 0) continue
            // Let go of a rock and the cut fades rather than resetting instantly,
            // so dodging a shockwave mid-cut isn't a total loss.
            rock.breakGraceMs -= dtMs
            if (rock.breakGraceMs <= 0) rock.progress = Math.max(0, rock.progress - dtMs / 4500)
        }

        if (!target) {
            this.callbacks.onMiningProgress(0, null)
            return
        }

        this.cutRock(target, dtMs, 1)

        // Harvest Protocol strips a second rock in range at half rate — the
        // beam splits rather than moving.
        if (this.specials.harvester) {
            const secondary = this.rocks.find(rock =>
                !rock.depleted && rock.id !== target.id
                && dist(rock.x, rock.y, this.px, this.py) - rock.radius <= this.config!.stats.miningRange)
            if (secondary) {
                this.cutRock(secondary, dtMs, 0.5)
                this.miningBeam
                    .moveTo(this.px, this.py)
                    .lineTo(secondary.x, secondary.y)
                    .stroke({ width: 2, color: secondary.def.glow, alpha: 0.5 })
            }
        }

        this.callbacks.onMiningProgress(target.progress, target.def.name)
    }

    private cutRock(rock: RockEntity, dtMs: number, rate: number) {
        const sector = voidSector(this.sectorTier)
        const totalMs = rock.def.mineMs * sector.mineTimeMult * this.config!.stats.miningTimeMult
        rock.breakGraceMs = MINING_BREAK_GRACE_MS
        rock.progress = Math.min(1, rock.progress + (dtMs * rate) / totalMs)

        const color = rock.def.glow
        if (rate >= 1) {
            this.miningBeam
                .moveTo(this.px, this.py)
                .lineTo(rock.x + randRange(-5, 5), rock.y + randRange(-5, 5))
                .stroke({ width: randRange(3, 6), color, alpha: 0.7 })
            this.miningBeam
                .moveTo(this.px, this.py)
                .lineTo(rock.x, rock.y)
                .stroke({ width: 1.6, color: 0xffffff, alpha: 0.9 })
            this.miningRing.position.set(rock.x, rock.y)
            fx.drawMiningRing(this.miningRing, rock.radius, rock.progress, color)
        }

        if (randomChance(0.6 * rate)) {
            const a = randomFloat() * Math.PI * 2
            this.spawnParticle({
                x: rock.x + Math.cos(a) * rock.radius * 0.8,
                y: rock.y + Math.sin(a) * rock.radius * 0.8,
                vx: Math.cos(a) * randRange(40, 160),
                vy: Math.sin(a) * randRange(40, 160),
                color,
                radius: randRange(1.6, 3.6),
                life: 420,
                alpha: 0.9
            })
        }

        if (rock.progress >= 1) this.completeMine(rock)
    }

    private completeMine(rock: RockEntity) {
        const stats = this.config!.stats
        const base = randomInt(rock.def.yieldMin, rock.def.yieldMax)
        const amount = Math.max(1, Math.round(base * stats.oreYieldMult))
        const stored = this.addCargo(rock.def.resource, amount)

        rock.depleted = true
        rock.progress = 0
        rock.respawnMs = ROCK_RESPAWN_MS
        rock.root.visible = false
        this.rocksMined++

        this.shatter(rock.x, rock.y, rock.def.glow, rock.radius)
        this.shake(180, 5)
        fx.floatingText(
            this.textLayer, rock.x, rock.y - rock.radius,
            stored > 0 ? `+${stored} ${voidResource(rock.def.resource).name}` : 'HOLD FULL',
            stored > 0 ? rock.def.glow : 0xf87171,
            stored > 0 ? 16 : 14
        )

        // Prospector's Eye occasionally kicks out a unit of the next ore up.
        if (this.specials.prospectorsEye && randomChance(0.3)) {
            const ladder: VoidResourceId[] = ['ferrite', 'cobalt', 'iridium', 'xenite']
            const index = ladder.indexOf(rock.def.resource)
            const upgraded = index >= 0 && index < ladder.length - 1 ? ladder[index + 1]! : rock.def.resource
            if (this.addCargo(upgraded, 1) > 0) {
                fx.floatingText(this.textLayer, rock.x, rock.y - rock.radius - 24, `+1 ${voidResource(upgraded).name}`, voidResource(upgraded).color, 14)
            }
        }

        this.callbacks.onMineComplete?.(rock.def.resource, stored)
        if (stored < amount) this.callbacks.onNotice?.('Cargo hold is full — dock to unload.', 'bad')
    }

    /** Returns how much actually fit. */
    private addCargo(resource: VoidResourceId, amount: number) {
        const room = Math.max(0, this.cargoCapacity - this.cargoUnits)
        const stored = Math.min(room, amount)
        if (stored > 0) {
            this.cargo[resource] = (this.cargo[resource] ?? 0) + stored
            this.cargoUnits = voidBundleUnits(this.cargo)
            this.emitCargo()
        }
        return stored
    }

    private updateRocks(dt: number, dtMs: number) {
        for (const rock of this.rocks) {
            rock.rotation += rock.spin * dt
            rock.root.rotation = rock.rotation
            if (!rock.depleted) continue
            rock.respawnMs -= dtMs
            if (rock.respawnMs > 0) continue
            // Respawn somewhere else entirely so the field keeps reshaping and
            // the player has a reason to keep moving.
            const point = this.findOpenPoint(MOTHERSHIP_RADIUS * 2.8)
            rock.x = point.x
            rock.y = point.y
            rock.depleted = false
            rock.root.position.set(point.x, point.y)
            rock.root.visible = true
            rock.root.scale.set(0.1)
            gsap.to(rock.root.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2)' })
        }
    }

    // ─── Turrets and drones ──────────────────────────────────────────────────

    private nearestEnemy(x: number, y: number, range: number) {
        let best: EnemyEntity | null = null
        let bestDistSq = range * range
        for (const enemy of this.enemies) {
            if (enemy.dead) continue
            const d = distSq(enemy.x, enemy.y, x, y)
            if (d < bestDistSq) { bestDistSq = d; best = enemy }
        }
        return best
    }

    private updateTurrets(dtMs: number) {
        const stats = this.config!.stats
        for (const mount of this.turrets) {
            const runtime = mount.runtime
            mount.fireTimer -= dtMs
            const origin = mount.gfx.position
            const target = this.nearestEnemy(origin.x, origin.y, runtime.range)
            if (!target) continue

            mount.gfx.rotation = Math.atan2(target.y - origin.y, target.x - origin.x)
            if (mount.fireTimer > 0) continue
            mount.fireTimer = runtime.fireGapMs * (this.specials.rocket ? 1.25 : 1)

            const crit = stats.critChance > 0 && randomChance(stats.critChance)
            this.spawnBullet({
                x: origin.x,
                y: origin.y,
                angle: mount.gfx.rotation,
                speed: stats.projectileSpeed * 0.8 * (this.specials.railgun ? 1.6 : 1),
                damage: runtime.damage * (crit ? stats.critDamage : 1) * (this.specials.rocket ? 1.6 : 1),
                color: crit ? 0xfde047 : runtime.color,
                pierce: this.specials.railgun ? 99 : stats.pierce,
                splash: this.specials.rocket ? Math.max(70, stats.splash) : stats.splash,
                lifesteal: this.specials.siphon ? Math.max(0.1, stats.lifesteal) : stats.lifesteal,
                homing: stats.homing,
                rocket: this.specials.rocket,
                chain: this.specials.chain,
                hostile: false,
                range: runtime.range,
                size: crit ? 1.15 : 0.9
            })
            this.shotsFired++
        }
    }

    private updateDrones(dt: number, dtMs: number) {
        const stats = this.config!.stats
        for (const drone of this.drones) {
            drone.angle += dt * 1.6
            const radius = 66
            const x = this.px + Math.cos(drone.angle) * radius
            const y = this.py + Math.sin(drone.angle) * radius
            drone.gfx.position.set(x, y)

            drone.fireTimer -= dtMs
            const target = this.nearestEnemy(x, y, 420)
            if (!target) continue
            drone.gfx.rotation = Math.atan2(target.y - y, target.x - x)
            if (drone.fireTimer > 0) continue
            drone.fireTimer = 620
            this.spawnBullet({
                x, y,
                angle: drone.gfx.rotation,
                speed: 720,
                damage: stats.damage * 0.3,
                color: 0xfda4af,
                pierce: 0,
                splash: 0,
                lifesteal: 0,
                homing: 0.4,
                rocket: false,
                chain: false,
                hostile: false,
                range: 460,
                size: 0.75
            })
        }
    }

    // ─── Enemies ─────────────────────────────────────────────────────────────

    private updateEnemies(dt: number, dtMs: number) {
        const sector = voidSector(this.sectorTier)

        this.spawnTimer -= dtMs
        if (this.spawnTimer <= 0) {
            this.spawnTimer = sector.spawnIntervalMs * voidRampSpawnIntervalMult(this.elapsedMs)
            const cap = sector.maxEnemies + voidRampExtraEnemies(this.elapsedMs)
            const alive = this.enemies.filter(e => !e.dead && !e.boss).length
            if (alive < cap) this.spawnEnemy(voidRollEnemy(this.sectorTier))
        }

        this.midBossTimer -= dtMs
        if (this.midBossTimer <= 0) {
            // Fires once at minute three; pushed far out afterwards.
            this.midBossTimer = Infinity
            this.spawnEnemy(voidEnemy(VOID_MIDBOSS_ID), true)
            this.callbacks.onNotice?.('Strike cruiser jumping in.', 'bad')
        }

        this.bossTimer -= dtMs
        if (this.bossTimer <= 0) {
            this.bossTimer = VOID_BOSS_RESPAWN_MS
            this.spawnEnemy(voidEnemy(VOID_BOSS_ID))
        }

        for (const enemy of this.enemies) {
            if (enemy.dead) continue

            if (enemy.flashMs > 0) {
                enemy.flashMs -= dtMs
                enemy.body.alpha = enemy.flashMs > 0 ? 0.55 : 1
            }

            const toPlayer = dist(enemy.x, enemy.y, this.px, this.py)
            const vision = enemy.def.vision

            if (enemy.state === 'drift') {
                if (toPlayer < vision) {
                    enemy.state = 'chase'
                    this.spawnParticle({ x: enemy.x, y: enemy.y - enemy.def.radius - 12, vx: 0, vy: -30, color: 0xfca5a5, radius: 5, life: 500, alpha: 1 })
                } else {
                    enemy.driftTimer -= dtMs
                    if (enemy.driftTimer <= 0) {
                        enemy.driftTimer = randRange(2200, 5200)
                        enemy.driftAngle = randomFloat() * Math.PI * 2
                    }
                    this.moveEnemy(enemy, enemy.driftAngle, enemy.speed * 0.32, dt)
                }
            } else {
                // Losing sight is generous — patrols keep pursuing to 1.6x
                // vision so you have to actually break away, not just blink out.
                if (toPlayer > vision * 1.6) {
                    enemy.state = 'drift'
                } else if (toPlayer > enemy.def.range * 0.78) {
                    enemy.state = 'chase'
                    this.moveEnemy(enemy, Math.atan2(this.py - enemy.y, this.px - enemy.x), enemy.speed, dt)
                } else {
                    enemy.state = 'strafe'
                    const toward = Math.atan2(this.py - enemy.y, this.px - enemy.x)
                    // Orbit rather than sit still, and back off if too close.
                    const orbit = toward + (Math.PI / 2) * enemy.strafeSign
                    const push = toPlayer < enemy.def.range * 0.45 ? toward + Math.PI : orbit
                    this.moveEnemy(enemy, push, enemy.speed * 0.7, dt)
                }

                enemy.angle = stepAngle(enemy.angle, Math.atan2(this.py - enemy.y, this.px - enemy.x), enemy.def.turnRate * dt)

                enemy.fireTimer -= dtMs
                if (enemy.fireTimer <= 0 && toPlayer < enemy.def.range) {
                    enemy.fireTimer = enemy.def.fireGapMs * randRange(0.85, 1.2)
                    this.enemyShoot(enemy)
                }

                enemy.abilityTimer -= dtMs
                if (enemy.abilityTimer <= 0) {
                    enemy.abilityTimer = enemy.def.abilityCooldownMs * randRange(0.85, 1.25)
                    this.castEnemyAbility(enemy)
                }
            }

            enemy.root.position.set(enemy.x, enemy.y)
            enemy.root.rotation = enemy.angle
        }

        this.enemies = this.enemies.filter((enemy) => {
            if (!enemy.dead) return true
            enemy.root.destroy({ children: true })
            return false
        })
    }

    private moveEnemy(enemy: EnemyEntity, angle: number, speed: number, dt: number) {
        enemy.x = clamp(enemy.x + Math.cos(angle) * speed * dt, 40, WORLD_W - 40)
        enemy.y = clamp(enemy.y + Math.sin(angle) * speed * dt, 40, WORLD_H - 40)
        if (enemy.state === 'drift') enemy.angle = stepAngle(enemy.angle, angle, enemy.def.turnRate * dt)
    }

    private enemyShoot(enemy: EnemyEntity) {
        const lead = enemy.def.id === 'lancer' ? 0.35 : 0.18
        const targetX = this.px + this.pvx * lead
        const targetY = this.py + this.pvy * lead
        const angle = Math.atan2(targetY - enemy.y, targetX - enemy.x) + randRange(-0.05, 0.05)
        const shots = enemy.boss ? 3 : 1
        for (let i = 0; i < shots; i++) {
            const offset = shots > 1 ? (i - 1) * 0.16 : 0
            this.spawnBullet({
                x: enemy.x + Math.cos(angle) * enemy.def.radius,
                y: enemy.y + Math.sin(angle) * enemy.def.radius,
                angle: angle + offset,
                speed: ENEMY_SHOT_SPEED * (enemy.def.id === 'lancer' ? 1.7 : 1),
                damage: enemy.damage,
                color: enemy.def.accentColor,
                pierce: 0,
                splash: 0,
                lifesteal: 0,
                homing: 0,
                rocket: false,
                chain: false,
                hostile: true,
                range: enemy.def.range * 1.4,
                size: enemy.boss ? 1.4 : 1
            })
        }
    }

    private castEnemyAbility(enemy: EnemyEntity) {
        const abilities = enemy.def.abilities
        if (abilities.length === 0) return
        const ability = abilities[randomInt(0, abilities.length - 1)]!

        if (ability === 'shockwave') {
            const gfx = new Graphics()
            gfx.position.set(enemy.x, enemy.y)
            this.effectLayer.addChild(gfx)
            this.shockwaves.push({
                gfx,
                x: enemy.x,
                y: enemy.y,
                age: 0,
                telegraphMs: SHOCKWAVE_TELEGRAPH_MS,
                expandMs: SHOCKWAVE_EXPAND_MS,
                radius: SHOCKWAVE_RADIUS * (enemy.boss ? 1.5 : 1),
                damage: enemy.damage * (enemy.boss ? 2.2 : 1.9),
                fired: false,
                hitPlayer: false
            })
        } else if (ability === 'railbeam') {
            const angle = Math.atan2(this.py - enemy.y, this.px - enemy.x)
            const gfx = new Graphics()
            gfx.position.set(enemy.x, enemy.y)
            gfx.rotation = angle
            this.effectLayer.addChild(gfx)
            this.railbeams.push({
                gfx,
                x: enemy.x,
                y: enemy.y,
                angle,
                age: 0,
                chargeMs: RAILBEAM_CHARGE_MS,
                activeMs: RAILBEAM_ACTIVE_MS,
                damage: enemy.damage * (enemy.boss ? 2.4 : 2),
                fired: false
            })
        } else if (ability === 'burst') {
            // A full ring of bolts. Wide gaps, so there is always a lane out.
            const count = 12
            const base = Math.atan2(this.py - enemy.y, this.px - enemy.x) + randRange(-0.2, 0.2)
            for (let i = 0; i < count; i++) {
                const angle = base + (i / count) * Math.PI * 2
                this.spawnBullet({
                    x: enemy.x + Math.cos(angle) * enemy.def.radius,
                    y: enemy.y + Math.sin(angle) * enemy.def.radius,
                    angle,
                    speed: ENEMY_SHOT_SPEED * 0.85,
                    damage: enemy.damage * 0.8,
                    color: enemy.def.accentColor,
                    pierce: 0, splash: 0, lifesteal: 0, homing: 0,
                    rocket: false, chain: false, hostile: true,
                    range: 900,
                    size: 1.1
                })
            }
            this.burst(enemy.x, enemy.y, enemy.def.accentColor, 18, 260)
        } else if (ability === 'drones') {
            // A Warden holds a standing swarm rather than flooding the sector —
            // it tops back up to the cap instead of launching unconditionally.
            const alive = this.enemies.filter(e => !e.dead && e.carrierId === enemy.id).length
            const launch = Math.min(VOID_WARDEN_DRONE_COUNT, VOID_WARDEN_MAX_DRONES - alive)
            if (launch <= 0) return
            this.callbacks.onNotice?.('Warden launching hunter-killers', 'bad')
            for (let i = 0; i < launch; i++) {
                const a = (i / launch) * Math.PI * 2 + randRange(-0.3, 0.3)
                const drone = this.spawnEnemy(voidEnemy(VOID_DRONE_ID), true, enemy.id)
                drone.x = clamp(enemy.x + Math.cos(a) * enemy.def.radius * 1.6, 40, WORLD_W - 40)
                drone.y = clamp(enemy.y + Math.sin(a) * enemy.def.radius * 1.6, 40, WORLD_H - 40)
                drone.state = 'chase'
                this.burst(drone.x, drone.y, enemy.def.accentColor, 6, 140)
            }
        } else if (ability === 'minelayer') {
            this.dropMine(enemy.x, enemy.y, enemy.damage * 2.1)
        } else if (ability === 'reinforce') {
            this.callbacks.onNotice?.(`${enemy.def.name} is launching interceptors`, 'bad')
            for (let i = 0; i < BOSS_REINFORCE_COUNT; i++) {
                const a = (i / BOSS_REINFORCE_COUNT) * Math.PI * 2
                const spawned = this.spawnEnemy(voidEnemy('interceptor'), true)
                spawned.x = clamp(enemy.x + Math.cos(a) * 130, 40, WORLD_W - 40)
                spawned.y = clamp(enemy.y + Math.sin(a) * 130, 40, WORLD_H - 40)
                spawned.state = 'chase'
                this.burst(spawned.x, spawned.y, 0xfca5a5, 12, 180)
            }
        }
    }

    private updateShockwaves(dtMs: number) {
        for (const wave of this.shockwaves) {
            wave.age += dtMs
            const telegraph = clamp(wave.age / wave.telegraphMs, 0, 1)
            const expand = wave.age <= wave.telegraphMs ? 0 : clamp((wave.age - wave.telegraphMs) / wave.expandMs, 0, 1)
            fx.drawShockwave(wave.gfx, wave.radius, telegraph, expand, 0xf87171)

            if (expand > 0 && !wave.fired) {
                wave.fired = true
                this.shake(240, 9)
                this.burst(wave.x, wave.y, 0xf87171, 22, 340)
            }
            if (expand > 0 && !wave.hitPlayer) {
                const ring = wave.radius * expand
                const d = dist(this.px, this.py, wave.x, wave.y)
                // The ring is a moving band, not a filled disc — outrunning it
                // outward or diving inside both work.
                if (Math.abs(d - ring) < 42) {
                    wave.hitPlayer = true
                    this.damagePlayer(wave.damage)
                }
            }
        }
        this.shockwaves = this.shockwaves.filter((wave) => {
            if (wave.age < wave.telegraphMs + wave.expandMs) return true
            wave.gfx.destroy()
            return false
        })
    }

    private updateRailbeams(dtMs: number) {
        for (const beam of this.railbeams) {
            beam.age += dtMs
            const charge = clamp(beam.age / beam.chargeMs, 0, 1)
            const active = beam.age <= beam.chargeMs ? 0 : clamp((beam.age - beam.chargeMs) / beam.activeMs, 0, 1)
            fx.drawRailbeam(beam.gfx, RAILBEAM_LENGTH, RAILBEAM_WIDTH, charge, active, 0xc4b5fd)

            if (active > 0 && !beam.fired) {
                beam.fired = true
                this.shake(200, 7)
                const ex = beam.x + Math.cos(beam.angle) * RAILBEAM_LENGTH
                const ey = beam.y + Math.sin(beam.angle) * RAILBEAM_LENGTH
                if (segPointDist(beam.x, beam.y, ex, ey, this.px, this.py) < RAILBEAM_WIDTH) {
                    this.damagePlayer(beam.damage)
                }
                for (let i = 0; i < 16; i++) {
                    const t = randomFloat()
                    this.spawnParticle({
                        x: beam.x + Math.cos(beam.angle) * RAILBEAM_LENGTH * t,
                        y: beam.y + Math.sin(beam.angle) * RAILBEAM_LENGTH * t,
                        vx: randRange(-120, 120),
                        vy: randRange(-120, 120),
                        color: 0xddd6fe,
                        radius: randRange(2, 4.5),
                        life: 380,
                        alpha: 0.9
                    })
                }
            }
        }
        this.railbeams = this.railbeams.filter((beam) => {
            if (beam.age < beam.chargeMs + beam.activeMs) return true
            beam.gfx.destroy()
            return false
        })
    }

    private dropMine(x: number, y: number, damage: number) {
        const built = fx.buildMine(0xfacc15)
        built.root.position.set(x, y)
        this.effectLayer.addChild(built.root)
        this.mines.push({
            root: built.root,
            ring: built.ring,
            x, y,
            age: 0,
            armMs: MINE_ARM_MS,
            life: MINE_LIFE_MS,
            radius: MINE_TRIGGER_RADIUS,
            damage,
            triggered: false
        })
    }

    private updateMines(dtMs: number) {
        for (const mine of this.mines) {
            mine.age += dtMs
            const armed = mine.age >= mine.armMs
            const pulse = 0.5 + Math.sin(mine.age / 180) * 0.5
            fx.drawMineRing(mine.ring, mine.radius, armed, pulse)
            // Fade out over the last two seconds so it never vanishes mid-frame
            // while the player is threading past it.
            mine.root.alpha = clamp((mine.life - mine.age) / 2000, 0, 1)

            if (!armed || mine.triggered) continue
            if (dist(this.px, this.py, mine.x, mine.y) > mine.radius) continue

            mine.triggered = true
            mine.age = mine.life
            this.damagePlayer(mine.damage)
            this.burst(mine.x, mine.y, 0xfacc15, 30, 420)
            this.shake(280, 11)
            // Mines are indiscriminate: whatever laid them can eat one too.
            for (const enemy of this.enemies) {
                if (enemy.dead) continue
                if (dist(enemy.x, enemy.y, mine.x, mine.y) > MINE_BLAST_RADIUS) continue
                this.damageEnemy(enemy, mine.damage * 0.8, enemy.x, enemy.y, 0)
            }
        }
        this.mines = this.mines.filter((mine) => {
            if (mine.age < mine.life) return true
            mine.root.destroy({ children: true })
            return false
        })
    }

    private updateSingularities(dt: number, dtMs: number) {
        for (const hole of this.singularities) {
            hole.age += dtMs
            hole.tickMs -= dtMs
            const life = clamp(1 - hole.age / hole.life, 0, 1)
            hole.gfx.scale.set(0.6 + life * 0.6)
            hole.gfx.rotation += dt * 5
            hole.gfx.alpha = life

            for (const enemy of this.enemies) {
                if (enemy.dead) continue
                const d = dist(enemy.x, enemy.y, hole.x, hole.y)
                if (d > 260) continue
                const pull = (1 - d / 260) * 210 * dt
                const a = Math.atan2(hole.y - enemy.y, hole.x - enemy.x)
                enemy.x += Math.cos(a) * pull
                enemy.y += Math.sin(a) * pull
                if (hole.tickMs <= 0) this.damageEnemy(enemy, hole.damage, hole.x, hole.y, 0)
            }
            if (hole.tickMs <= 0) hole.tickMs = 250
        }
        this.singularities = this.singularities.filter((hole) => {
            if (hole.age < hole.life) return true
            hole.gfx.destroy({ children: true })
            return false
        })
    }

    // ─── Bullets ─────────────────────────────────────────────────────────────

    private spawnBullet(options: {
        x: number, y: number, angle: number, speed: number, damage: number, color: number,
        pierce: number, splash: number, lifesteal: number, homing: number,
        rocket: boolean, chain: boolean, hostile: boolean, range: number, size?: number
    }) {
        const gfx = fx.buildBullet(options.color, options.rocket, options.size ?? 1)
        gfx.position.set(options.x, options.y)
        gfx.rotation = options.angle
        this.bulletLayer.addChild(gfx)
        this.bullets.push({
            gfx,
            x: options.x,
            y: options.y,
            vx: Math.cos(options.angle) * options.speed,
            vy: Math.sin(options.angle) * options.speed,
            // Range is expressed in metres; a bullet simply expires once it has
            // flown that far, which is what makes the Targeting Suite matter.
            life: Math.min(PLAYER_SHOT_LIFE_MS * 2, options.range / options.speed * 1000),
            damage: options.damage,
            pierce: options.pierce,
            splash: options.splash,
            lifesteal: options.lifesteal,
            homing: options.homing,
            hostile: options.hostile,
            color: options.color,
            rocket: options.rocket,
            chain: options.chain,
            hitIds: new Set<number>(),
            targetId: null
        })
    }

    private updateBullets(dt: number, dtMs: number) {
        for (const bullet of this.bullets) {
            if (bullet.homing > 0 && !bullet.hostile) {
                const target = this.nearestEnemy(bullet.x, bullet.y, 520)
                if (target) {
                    const desired = Math.atan2(target.y - bullet.y, target.x - bullet.x)
                    const current = Math.atan2(bullet.vy, bullet.vx)
                    const speed = Math.hypot(bullet.vx, bullet.vy)
                    const next = stepAngle(current, desired, bullet.homing * 6 * dt)
                    bullet.vx = Math.cos(next) * speed
                    bullet.vy = Math.sin(next) * speed
                }
            }

            bullet.x += bullet.vx * dt
            bullet.y += bullet.vy * dt
            bullet.life -= dtMs
            bullet.gfx.position.set(bullet.x, bullet.y)
            bullet.gfx.rotation = Math.atan2(bullet.vy, bullet.vx)

            if (bullet.rocket && randomChance(0.5)) {
                this.spawnParticle({ x: bullet.x, y: bullet.y, vx: randRange(-30, 30), vy: randRange(-30, 30), color: 0xfdba74, radius: randRange(2, 3.6), life: 300, alpha: 0.8 })
            }

            if (bullet.hostile) {
                if (this.invulnMs <= 0 && dist(bullet.x, bullet.y, this.px, this.py) < this.playerRadius + 8) {
                    this.damagePlayer(bullet.damage)
                    bullet.life = 0
                    this.burst(bullet.x, bullet.y, bullet.color, 6, 150)
                }
                continue
            }

            for (const enemy of this.enemies) {
                if (enemy.dead || bullet.hitIds.has(enemy.id)) continue
                if (dist(bullet.x, bullet.y, enemy.x, enemy.y) > enemy.def.radius + 8) continue
                bullet.hitIds.add(enemy.id)
                this.resolveHit(bullet, enemy)
                if (bullet.pierce > 0) bullet.pierce--
                else bullet.life = 0
                break
            }
        }

        this.bullets = this.bullets.filter((bullet) => {
            const outside = bullet.x < -80 || bullet.y < -80 || bullet.x > WORLD_W + 80 || bullet.y > WORLD_H + 80
            if (bullet.life > 0 && !outside) return true
            bullet.gfx.destroy({ children: true })
            return false
        })
    }

    private resolveHit(bullet: Bullet, enemy: EnemyEntity) {
        this.damageEnemy(enemy, bullet.damage, bullet.x, bullet.y, bullet.lifesteal)
        this.burst(bullet.x, bullet.y, bullet.color, bullet.rocket ? 16 : 6, bullet.rocket ? 280 : 160)
        this.callbacks.onHit?.()

        if (bullet.splash > 0) {
            for (const other of this.enemies) {
                if (other.dead || other.id === enemy.id) continue
                if (dist(other.x, other.y, bullet.x, bullet.y) > bullet.splash) continue
                this.damageEnemy(other, bullet.damage * 0.6, other.x, other.y, bullet.lifesteal)
            }
            const ring = new Graphics()
            ring.circle(0, 0, bullet.splash).stroke({ width: 3, color: 0xfb923c, alpha: 0.8 })
            ring.position.set(bullet.x, bullet.y)
            this.effectLayer.addChild(ring)
            gsap.to(ring.scale, { x: 1.35, y: 1.35, duration: 0.28, ease: 'power2.out' })
            gsap.to(ring, { alpha: 0, duration: 0.28, onComplete: () => { if (!ring.destroyed) ring.destroy() } })
        }

        if (bullet.chain) {
            // Two forks at 55%, never back into something this bullet already hit.
            let forks = 0
            for (const other of this.enemies) {
                if (forks >= 2) break
                if (other.dead || bullet.hitIds.has(other.id)) continue
                if (dist(other.x, other.y, enemy.x, enemy.y) > 260) continue
                forks++
                bullet.hitIds.add(other.id)
                this.damageEnemy(other, bullet.damage * 0.55, other.x, other.y, bullet.lifesteal)
                const arc = new Graphics()
                arc.moveTo(enemy.x, enemy.y).lineTo(other.x, other.y).stroke({ width: 3, color: 0x67e8f9, alpha: 0.9 })
                this.effectLayer.addChild(arc)
                gsap.to(arc, { alpha: 0, duration: 0.22, onComplete: () => { if (!arc.destroyed) arc.destroy() } })
            }
        }
    }

    private damageEnemy(enemy: EnemyEntity, amount: number, x: number, y: number, lifesteal: number) {
        if (enemy.dead) return
        enemy.hp -= amount
        enemy.flashMs = 90
        enemy.body.alpha = 0.55
        this.drawEnemyHpBar(enemy)
        // Waking a patrol by shooting it from outside its vision cone is fair.
        if (enemy.state === 'drift') enemy.state = 'chase'

        if (lifesteal > 0 && this.hull < this.maxHull) {
            this.hull = Math.min(this.maxHull, this.hull + amount * lifesteal)
            this.emitHull()
        }

        if (amount >= 1) fx.floatingText(this.textLayer, x, y - 12, Math.round(amount).toString(), 0xfef3c7, 12)
        if (enemy.hp <= 0) this.killEnemy(enemy)
    }

    private drawEnemyHpBar(enemy: EnemyEntity) {
        const width = Math.max(32, enemy.def.radius * 2.1)
        const pct = clamp(enemy.hp / enemy.maxHp, 0, 1)
        enemy.hpBar.clear()
        enemy.hpBar
            .rect(-width / 2, -enemy.def.radius - 18, width * pct, 5)
            .fill({ color: pct > 0.5 ? 0x4ade80 : pct > 0.25 ? 0xfbbf24 : 0xf87171 })
        enemy.hpBarBg.visible = pct < 1
        enemy.hpBar.visible = pct < 1
    }

    private killEnemy(enemy: EnemyEntity) {
        enemy.dead = true
        this.kills++
        if (enemy.boss) this.bossesKilled++
        const entry = this.killsByType.get(enemy.def.id) ?? { name: enemy.def.name, count: 0 }
        entry.count++
        this.killsByType.set(enemy.def.id, entry)

        this.burst(enemy.x, enemy.y, enemy.def.color, enemy.boss ? 70 : 22, enemy.boss ? 620 : 300)
        this.shake(enemy.boss ? 520 : 160, enemy.boss ? 18 : 5)
        this.callbacks.onExplosion?.(enemy.boss)

        // Wrecks drop material, never money — the dock is the only place
        // anything turns into coins. Later kills drop more, matching how much
        // harder they hit back by then.
        const sector = voidSector(this.sectorTier)
        const stats = this.config!.stats
        const ramp = voidRampMultiplier(this.elapsedMs)
        for (const drop of enemy.def.drops) {
            if (drop.chance !== undefined && !randomChance(drop.chance)) continue
            const rolled = randomInt(drop.min, drop.max)
            const amount = Math.max(1, Math.round(
                rolled * (1 + (sector.reward - 1) * 0.25) * ramp * stats.salvageYieldMult * randRange(0.9, 1.15)
            ))
            this.spawnPickup(
                enemy.x + randRange(-24, 24),
                enemy.y + randRange(-24, 24),
                drop.resource, amount, enemy.boss
            )
        }
        if (this.specials.siphon && randomChance(0.35)) {
            this.spawnPickup(enemy.x, enemy.y, 'ferrite', 1, false)
        }

        if (this.specials.singularity) this.spawnSingularity(enemy.x, enemy.y)
    }

    private spawnSingularity(x: number, y: number) {
        const root = new Container()
        const gfx = new Graphics()
        gfx.circle(0, 0, 58).fill({ color: 0x1e1b4b, alpha: 0.55 })
        gfx.circle(0, 0, 34).fill({ color: 0x000000, alpha: 0.85 })
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2
            gfx.arc(0, 0, 70 + i * 12, a, a + 1.6).stroke({ width: 3, color: 0xa78bfa, alpha: 0.7 })
        }
        root.addChild(gfx)
        root.position.set(x, y)
        this.effectLayer.addChild(root)
        this.singularities.push({ gfx: root, x, y, age: 0, life: 2000, damage: this.config!.stats.damage * 0.4, tickMs: 250 })
    }

    // ─── Pickups ─────────────────────────────────────────────────────────────

    private spawnPickup(x: number, y: number, resource: VoidResourceId, amount: number, big: boolean) {
        const gfx = fx.buildPickup(voidResource(resource).color, big)
        gfx.position.set(x, y)
        this.pickupLayer.addChild(gfx)
        const a = randomFloat() * Math.PI * 2
        this.pickups.push({
            gfx, x, y,
            vx: Math.cos(a) * randRange(30, 110),
            vy: Math.sin(a) * randRange(30, 110),
            age: 0,
            resource,
            amount
        })
    }

    private updatePickups(dt: number, dtMs: number) {
        const magnet = this.config!.stats.magnetRange
        for (const pickup of this.pickups) {
            pickup.age += dtMs
            const d = dist(pickup.x, pickup.y, this.px, this.py)
            if (d < magnet) {
                // Magnetise once you're near — chasing individual scrap around
                // the sector is not the interesting part of the loop.
                const a = Math.atan2(this.py - pickup.y, this.px - pickup.x)
                const pull = (1 - d / magnet) * 950
                pickup.vx += Math.cos(a) * pull * dt
                pickup.vy += Math.sin(a) * pull * dt
            }
            const drag = Math.exp(-1.6 * dt)
            pickup.vx *= drag
            pickup.vy *= drag
            pickup.x += pickup.vx * dt
            pickup.y += pickup.vy * dt
            pickup.gfx.position.set(pickup.x, pickup.y)

            if (d < 36) {
                pickup.age = Infinity
                const stored = this.addCargo(pickup.resource, pickup.amount)
                if (stored > 0) {
                    fx.floatingText(this.textLayer, pickup.x, pickup.y, `+${stored} ${voidResource(pickup.resource).name}`, voidResource(pickup.resource).color, 13)
                }
            }
        }
        this.pickups = this.pickups.filter((pickup) => {
            if (pickup.age < 45_000) return true
            gsap.killTweensOf(pickup.gfx)
            gsap.killTweensOf(pickup.gfx.scale)
            pickup.gfx.destroy({ children: true })
            return false
        })
    }

    // ─── Storm ───────────────────────────────────────────────────────────────

    /** 0 before it starts, 1 once the sector is fully engulfed. */
    private stormProgress() {
        if (this.elapsedMs <= VOID_STORM_START_MS) return 0
        return clamp((this.elapsedMs - VOID_STORM_START_MS) / (VOID_STORM_FULL_MS - VOID_STORM_START_MS), 0, 1)
    }

    private safeHalfExtents() {
        const p = this.stormProgress()
        return { halfW: (WORLD_W / 2) * (1 - p), halfH: (WORLD_H / 2) * (1 - p) }
    }

    /** How deep a point sits inside the gas, in pixels. Zero means clear air. */
    private stormDepth(x: number, y: number) {
        const { halfW, halfH } = this.safeHalfExtents()
        const dx = Math.abs(x - WORLD_W / 2) - halfW
        const dy = Math.abs(y - WORLD_H / 2) - halfH
        return Math.max(0, Math.max(dx, dy))
    }

    private updateStorm(dt: number, dtMs: number) {
        const p = this.stormProgress()

        if (p > 0 && !this.announced.has('closing')) {
            this.announced.add('closing')
            this.callbacks.onStormPhase?.('closing')
            this.callbacks.onNotice?.('Ion storm closing in — head for the mothership.', 'bad')
        }
        if (p >= 1 && !this.announced.has('engulfed')) {
            this.announced.add('engulfed')
            this.callbacks.onStormPhase?.('engulfed')
            this.callbacks.onNotice?.('The sector is gone. Dock now or die out here.', 'bad')
        }

        this.drawStorm()

        if (p <= 0) return

        const depth = this.stormDepth(this.px, this.py)
        if (depth > 0) {
            const intensity = clamp(0.25 + depth / 500, 0.25, 1)
            this.hull -= this.maxHull * VOID_STORM_DPS_FRACTION * intensity * dt
            this.deepestStormDamage = Math.max(this.deepestStormDamage, intensity)
            this.msSinceHit = 0
            this.emitHull()
            this.stormTickMs -= dtMs
            if (this.stormTickMs <= 0) {
                this.stormTickMs = 700
                fx.floatingText(this.textLayer, this.px, this.py - 34, 'ION BURN', 0xa3e635, 13)
                this.shake(140, 3)
                this.revealHealthBar()
            }
            if (this.hull <= 0) {
                this.endRun('destroyed')
                return
            }
        }

        for (const enemy of this.enemies) {
            if (enemy.dead) continue
            const enemyDepth = this.stormDepth(enemy.x, enemy.y)
            if (enemyDepth <= 0) continue
            const intensity = clamp(0.25 + enemyDepth / 500, 0.25, 1)
            this.damageEnemy(enemy, enemy.maxHp * VOID_STORM_DPS_FRACTION * VOID_STORM_ENEMY_MULT * intensity * dt, enemy.x, enemy.y, 0)
        }
    }

    private drawStorm() {
        this.stormLayer.clear()
        const p = this.stormProgress()
        if (p <= 0) return

        const { halfW, halfH } = this.safeHalfExtents()
        const cx = WORLD_W / 2 + this.worldRoot.position.x
        const cy = WORLD_H / 2 + this.worldRoot.position.y
        const left = cx - halfW
        const right = cx + halfW
        const top = cy - halfH
        const bottom = cy + halfH
        const pad = 3000
        const alpha = 0.28 + p * 0.22
        const color = 0x65a30d

        // Four slabs around the shrinking clear rect, drawn in screen space so
        // they stay pinned to the viewport regardless of camera position.
        this.stormLayer.rect(-pad, -pad, VIEW_W + pad * 2, top + pad).fill({ color, alpha })
        this.stormLayer.rect(-pad, bottom, VIEW_W + pad * 2, VIEW_H - bottom + pad).fill({ color, alpha })
        this.stormLayer.rect(-pad, top, left + pad, bottom - top).fill({ color, alpha })
        this.stormLayer.rect(right, top, VIEW_W - right + pad, bottom - top).fill({ color, alpha })

        const pulse = 0.55 + Math.sin(this.elapsedMs / 260) * 0.25
        this.stormLayer.rect(left, top, right - left, bottom - top).stroke({ width: 5, color: 0xbef264, alpha: pulse })
        this.stormLayer.rect(left - 12, top - 12, right - left + 24, bottom - top + 24).stroke({ width: 16, color: 0x84cc16, alpha: 0.16 })
    }

    // ─── Extraction ──────────────────────────────────────────────────────────

    private updateExtraction(dtMs: number) {
        const d = dist(this.px, this.py, WORLD_W / 2, WORLD_H / 2)

        // You have to actually undock before you can dock. Until then the ring
        // is inert, so a run can never end on the frame it began.
        if (!this.dockArmed) {
            if (d > VOID_DOCK_RADIUS * 1.25) this.dockArmed = true
            this.extractMs = 0
            this.callbacks.onExtractProgress(0, false)
            return
        }

        const inRange = d < VOID_DOCK_RADIUS
        if (inRange) {
            this.extractMs = Math.min(VOID_EXTRACT_HOLD_MS, this.extractMs + dtMs)
        } else {
            this.extractMs = Math.max(0, this.extractMs - dtMs * 2)
        }
        this.callbacks.onExtractProgress(this.extractMs / VOID_EXTRACT_HOLD_MS, inRange)
        if (this.extractMs >= VOID_EXTRACT_HOLD_MS) this.endRun('extracted')
    }

    // ─── Damage ──────────────────────────────────────────────────────────────

    private damagePlayer(amount: number) {
        if (this.invulnMs > 0 || this.ended) return
        this.msSinceHit = 0
        let remaining = amount
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, remaining)
            this.shield -= absorbed
            remaining -= absorbed
            this.burst(this.px, this.py, 0x38bdf8, 10, 200)
        }
        if (remaining > 0) {
            this.hull -= remaining
            this.invulnMs = 180
            if (this.playerBody) {
                this.playerBody.tint = 0xff6b6b
                gsap.delayedCall(0.12, () => { if (this.playerBody && !this.playerBody.destroyed) this.playerBody.tint = 0xffffff })
            }
        }
        this.shake(180, 7)
        fx.floatingText(this.textLayer, this.px, this.py - 30, `-${Math.round(amount)}`, 0xf87171, 14)
        this.emitHull()
        this.revealHealthBar()
        if (this.hull <= 0) this.endRun('destroyed')
    }

    // ─── Particles ───────────────────────────────────────────────────────────

    private spawnParticle(options: { x: number, y: number, vx: number, vy: number, color: number, radius: number, life: number, alpha?: number }) {
        // A hard ceiling keeps a boss death from tanking the frame rate on a
        // laptop GPU — beyond this the extra sparks are invisible anyway.
        if (this.particles.length > 460) return
        const gfx = new Graphics()
        gfx.circle(0, 0, options.radius).fill({ color: options.color, alpha: options.alpha ?? 1 })
        gfx.position.set(options.x, options.y)
        this.effectLayer.addChild(gfx)
        this.particles.push({
            gfx,
            x: options.x,
            y: options.y,
            vx: options.vx,
            vy: options.vy,
            life: options.life,
            maxLife: options.life,
            drag: 2.2,
            spin: randRange(-6, 6),
            scaleDecay: randRange(0.4, 0.9)
        })
    }

    private burst(x: number, y: number, color: number, count: number, speed: number) {
        for (let i = 0; i < count; i++) {
            const a = randomFloat() * Math.PI * 2
            const s = randRange(speed * 0.3, speed)
            this.spawnParticle({
                x, y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                color: i % 4 === 0 ? 0xffffff : color,
                radius: randRange(2, 5.5),
                life: randRange(280, 620),
                alpha: 0.95
            })
        }
    }

    private shatter(x: number, y: number, color: number, radius: number) {
        for (let i = 0; i < 24; i++) {
            const a = randomFloat() * Math.PI * 2
            const s = randRange(60, 320)
            this.spawnParticle({
                x: x + Math.cos(a) * radius * 0.6,
                y: y + Math.sin(a) * radius * 0.6,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                color,
                radius: randRange(2.5, 6),
                life: randRange(420, 900),
                alpha: 1
            })
        }
    }

    private updateParticles(dt: number, dtMs: number) {
        for (const particle of this.particles) {
            particle.life -= dtMs
            const drag = Math.exp(-particle.drag * dt)
            particle.vx *= drag
            particle.vy *= drag
            particle.x += particle.vx * dt
            particle.y += particle.vy * dt
            const t = clamp(particle.life / particle.maxLife, 0, 1)
            particle.gfx.position.set(particle.x, particle.y)
            particle.gfx.alpha = t
            particle.gfx.scale.set(0.3 + t * particle.scaleDecay + 0.3)
            particle.gfx.rotation += particle.spin * dt
        }
        this.particles = this.particles.filter((particle) => {
            if (particle.life > 0) return true
            particle.gfx.destroy()
            return false
        })
    }

    // ─── Camera and minimap ──────────────────────────────────────────────────

    private shake(durationMs: number, magnitude: number) {
        this.shakeMs = Math.max(this.shakeMs, durationMs)
        this.shakeMag = Math.max(this.shakeMag, magnitude)
    }

    private updateCamera(dt: number, dtMs: number) {
        // Lead the camera slightly in the direction of travel so fast hulls
        // still get to see where they're going.
        const targetX = this.px + this.pvx * CAMERA_LOOKAHEAD
        const targetY = this.py + this.pvy * CAMERA_LOOKAHEAD
        const t = 1 - Math.exp(-(CAMERA_LERP * 60) * dt)
        this.camX += (targetX - this.camX) * t
        this.camY += (targetY - this.camY) * t

        const clampedX = clamp(this.camX, VIEW_W / 2, WORLD_W - VIEW_W / 2)
        const clampedY = clamp(this.camY, VIEW_H / 2, WORLD_H - VIEW_H / 2)

        let shakeX = 0
        let shakeY = 0
        if (this.shakeMs > 0) {
            this.shakeMs -= dtMs
            const falloff = clamp(this.shakeMs / 260, 0, 1)
            shakeX = randRange(-1, 1) * this.shakeMag * falloff
            shakeY = randRange(-1, 1) * this.shakeMag * falloff
            if (this.shakeMs <= 0) this.shakeMag = 0
        }

        this.worldRoot.position.set(-clampedX + VIEW_W / 2 + shakeX, -clampedY + VIEW_H / 2 + shakeY)
        for (const layer of this.starLayers) {
            layer.container.position.set(
                -clampedX * layer.parallax + VIEW_W / 2,
                -clampedY * layer.parallax + VIEW_H / 2
            )
        }
    }

    private updateMinimap() {
        const w = 200
        const h = 118
        const sx = w / WORLD_W
        const sy = h / WORLD_H
        const g = this.minimapDots
        g.clear()
        g.rect(0, 0, w, h).fill({ color: 0x020617, alpha: 0.75 })
        g.rect(0, 0, w, h).stroke({ width: 1.5, color: 0x334155, alpha: 0.9 })

        const p = this.stormProgress()
        if (p > 0) {
            const { halfW, halfH } = this.safeHalfExtents()
            g.rect(
                (WORLD_W / 2 - halfW) * sx, (WORLD_H / 2 - halfH) * sy,
                halfW * 2 * sx, halfH * 2 * sy
            ).stroke({ width: 1.5, color: 0xbef264, alpha: 0.9 })
        }

        g.circle(WORLD_W / 2 * sx, WORLD_H / 2 * sy, 4.5).fill({ color: 0x22d3ee })
        for (const rock of this.rocks) {
            if (rock.depleted) continue
            g.circle(rock.x * sx, rock.y * sy, 1.6).fill({ color: rock.def.glow, alpha: 0.75 })
        }
        for (const enemy of this.enemies) {
            if (enemy.dead) continue
            g.circle(enemy.x * sx, enemy.y * sy, enemy.boss ? 4 : 2.1).fill({ color: enemy.boss ? 0xfbbf24 : 0xf87171 })
        }
        g.circle(this.px * sx, this.py * sy, 3).fill({ color: 0xffffff })
    }

    // ─── HUD plumbing ────────────────────────────────────────────────────────

    private emitHull() {
        this.callbacks.onHullChange(Math.max(0, this.hull), this.maxHull, Math.max(0, this.shield), this.maxShield)
    }

    private emitCargo() {
        this.callbacks.onCargoChange({
            units: this.cargoUnits,
            capacity: this.cargoCapacity,
            bundle: { ...this.cargo },
            value: voidBundleValue(this.cargo)
        })
    }

    // ─── End ─────────────────────────────────────────────────────────────────

    private endRun(reason: VoidRunResult['reason']) {
        if (this.ended) return
        this.ended = true
        this.running = false
        this.firing = false
        this.keys.clear()

        const extracted = reason === 'extracted'
        if (!extracted) {
            this.burst(this.px, this.py, 0xf87171, 60, 620)
            this.shake(600, 20)
            this.playerRoot.visible = false
        } else {
            this.burst(this.px, this.py, 0x22d3ee, 40, 420)
        }
        this.callbacks.onExplosion?.(true)

        const result: VoidRunResult = {
            reason,
            extracted,
            haul: extracted ? { ...this.cargo } : {},
            units: extracted ? this.cargoUnits : 0,
            haulValue: extracted ? voidBundleValue(this.cargo) : 0,
            kills: this.kills,
            rocksMined: this.rocksMined,
            shotsFired: this.shotsFired,
            elapsedMs: Math.round(this.elapsedMs),
            killsByType: Array.from(this.killsByType.entries()).map(([id, entry]) => ({ id, name: entry.name, count: entry.count })),
            deepestStormDamage: this.deepestStormDamage,
            bossesKilled: this.bossesKilled
        }
        this.callbacks.onRunEnd(result)
    }
}
