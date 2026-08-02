import { Application, Container, Graphics } from 'pixi.js'
import { randomChance, randomFloat } from '#shared/utils/random'
import {
    FIREWALL_PURGE_BOUNTY, FIREWALL_SHIELD_DELAY_MS, FIREWALL_SPAWN_WINDOW_MS, FIREWALL_WAVE_MS,
    firewallArmorScale, firewallBossFor, firewallBountyMultiplier, firewallClearBonus, firewallEnemy,
    firewallHpMultiplier, firewallIsAirborne, firewallIsBossWave, firewallWaveBudget, firewallWavePool,
    type FirewallEnemyDefinition, type FirewallLoadout, type FirewallWeaponRuntime
} from '#shared/utils/gamelogic/firewall'
import {
    BARREL_LENGTH, BULLET_LIFE_MS, BULLET_RADIUS, CROWD_PUSH, DESPAWN_X,
    HORIZON_Y, LANE_FAR_SCALE, LANE_FAR_Y, LANE_NEAR_SCALE, LANE_NEAR_Y, MAX_SHAKE,
    MUZZLE_X, MUZZLE_Y, PULSE_KNOCKBACK, PULSE_RADIUS, SPAWN_X, SPIKE_BAND,
    SHAKE_DECAY, SPIT_GRAVITY, SPIT_SPEED, TURRET_MOUNTS, VIEW_H, VIEW_W, WALL_X
} from './constants'
import { clamp, dist, lerp, randRange, segPointDist } from './math'
import * as fx from './fx'
import type {
    BulletEntity, EnemyEntity, FirewallCallbacks, ParticleEntity, SpitEntity, TurretMount
} from './types'

/** A spawn the wave scheduler has already decided on. */
interface ScheduledSpawn {
    atMs: number
    def: FirewallEnemyDefinition
}

/** What a projectile carries, whoever fired it. */
interface ShotSpec {
    damage: number
    pierce: number
    armorPiercing: boolean
    splashRadius: number
    splashDamage: number
    homing: boolean
    chain: number
    chainFalloff: number
    speed: number
    hex: number
    projectile: FirewallWeaponRuntime['projectile']
    crit: boolean
    fromTurret: boolean
}

export class FirewallGame {
    private app: Application | null = null
    private callbacks: FirewallCallbacks

    // ── Layers ──
    /** Everything that shakes. The vignette and banners sit outside it. */
    private world = new Container()
    private bgLayer = new Container()
    private spikeGfx = new Graphics()
    private fieldLayer = new Container()
    private bastionRoot = new Container()
    private bastion: ReturnType<typeof fx.buildBastion> | null = null
    private turretLayer = new Container()
    private bulletLayer = new Container()
    private fxLayer = new Container()
    private textLayer = new Container()
    private overlayLayer = new Container()

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
    private loadout: FirewallLoadout | null = null
    private weapon: FirewallWeaponRuntime | null = null
    private rampart = -1
    private wave = 0
    private waveElapsed = 0
    private schedule: ScheduledSpawn[] = []
    private scheduleIndex = 0
    private waveKills = 0
    private waveCredits = 0
    private waveLeaks = 0
    private totalKills = 0

    // ── Bastion state ──
    private wallHp = 900
    private wallMaxHp = 900
    private shield = 0
    private shieldMax = 0
    private msSinceWallHit = 99_999
    /** Integrity bucket the damage decals were last drawn for. */
    private damageBucket = -1

    // ── Weapon ──
    private mag = 10
    private magSize = 10
    private fireTimer = 0
    private reloadTimer = 0
    private pulseCharge = 0
    private overclockCharge = 0
    private overclockLeft = 0

    // ── Entities ──
    private enemies: EnemyEntity[] = []
    private bullets: BulletEntity[] = []
    private spits: SpitEntity[] = []
    private particles: ParticleEntity[] = []
    private turrets: TurretMount[] = []

    // ── Input ──
    private aimX = 400
    private aimY = 400
    private firing = false
    private listeners: (() => void)[] = []

    // ── Camera ──
    private shake = 0
    private elapsedTotal = 0

    constructor(callbacks: FirewallCallbacks) {
        this.callbacks = callbacks
    }

    // ─── Mount / teardown ────────────────────────────────────────────────────

    async mount(host: HTMLDivElement) {
        // The engine outlives the page component, so a remount must re-parent the
        // existing canvas rather than build a second Application — two tickers
        // both calling tick() is a game that runs at double speed.
        if (this.app) {
            host.appendChild(this.app.canvas)
            return
        }

        this.app = new Application()
        await this.app.init({
            width: VIEW_W,
            height: VIEW_H,
            background: 0x05070f,
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
        // `autoDensity` writes an inline pixel size, and an inline style beats any
        // utility class — without this the canvas overflows a narrower host and
        // has its right edge clipped off.
        this.app.canvas.style.width = '100%'
        this.app.canvas.style.height = '100%'
        host.appendChild(this.app.canvas)

        const sky = new Graphics()
        fx.drawSky(sky)
        const ground = new Graphics()
        fx.drawGround(ground)
        this.bgLayer.addChild(sky, fx.buildStars(), fx.buildRidges(), ground)

        // Enemies sort against each other by lane depth; the layer above them is
        // the wall, which everything on the field is in front of.
        this.fieldLayer.sortableChildren = true
        this.rebuildBastion(0)

        this.world.addChild(
            this.bgLayer, this.spikeGfx, this.fieldLayer,
            this.bastionRoot, this.turretLayer, this.bulletLayer, this.fxLayer, this.textLayer
        )
        this.app.stage.addChild(this.world)

        const vignette = new Graphics()
        fx.drawVignette(vignette)
        this.overlayLayer.addChild(vignette)
        this.app.stage.addChild(this.overlayLayer)

        this.attachInput()
        this.app.ticker.add(ticker => this.tick(ticker.deltaMS))
        this.mounted = true
    }

    destroy() {
        this.destroyed = true
        this.running = false
        this.detachInput()
        // Looping tweens have to die before their targets do, or the next gsap
        // frame writes into a destroyed display object and throws.
        fx.killFxTweens()
        if (this.app) {
            this.app.destroy(true, { children: true })
            this.app = null
        }
    }

    // ─── Input ───────────────────────────────────────────────────────────────

    private attachInput() {
        if (!this.app) return
        const canvas = this.app.canvas

        const toView = (clientX: number, clientY: number) => {
            const rect = canvas.getBoundingClientRect()
            return {
                x: (clientX - rect.left) / rect.width * VIEW_W,
                y: (clientY - rect.top) / rect.height * VIEW_H
            }
        }

        const onPointerMove = (event: PointerEvent) => {
            const point = toView(event.clientX, event.clientY)
            this.aimX = point.x
            this.aimY = point.y
        }
        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return
            const point = toView(event.clientX, event.clientY)
            this.aimX = point.x
            this.aimY = point.y
            this.firing = true
        }
        const onPointerUp = () => { this.firing = false }
        const onBlur = () => { this.firing = false }
        const onContextMenu = (event: MouseEvent) => event.preventDefault()

        const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase()
            if (key === 'r') this.beginReload()
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

    // ─── Run control ─────────────────────────────────────────────────────────

    /** Wipes the field and the bastion back to a fresh run. */
    startRun(loadout: FirewallLoadout) {
        if (!this.mounted) return false
        this.clearField()
        this.loadout = loadout
        this.weapon = loadout.weapon
        this.wave = 0
        this.waveElapsed = 0
        this.totalKills = 0
        this.gameOver = false
        this.purging = false
        this.running = false
        this.wallMaxHp = loadout.wallMaxHp
        this.wallHp = loadout.wallMaxHp
        this.shieldMax = loadout.shieldMax
        this.shield = loadout.shieldMax
        this.pulseCharge = loadout.pulseCooldownMs
        this.overclockCharge = loadout.overclockCooldownMs
        this.overclockLeft = 0
        this.magSize = Math.round(loadout.weapon.magazine)
        this.mag = this.magSize
        this.reloadTimer = 0
        this.rebuildBastion(loadout.rampart)
        this.syncTurrets()
        this.emitWall()
        this.emitAmmo()
        return true
    }

    /**
     * Applies the uplink's new loadout and releases the next wave.
     *
     * Max-health upgrades are handed out as healing rather than as headroom —
     * buying Integrity mid-run should feel like reinforcing the wall, not like
     * watching the health bar percentage drop.
     */
    startWave(wave: number, loadout: FirewallLoadout) {
        if (!this.mounted || this.gameOver) return false
        const previousMax = this.wallMaxHp
        this.loadout = loadout
        this.weapon = loadout.weapon
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
        this.rebuildBastion(loadout.rampart)
        this.syncTurrets()

        this.wave = wave
        this.waveElapsed = 0
        this.waveKills = 0
        this.waveCredits = 0
        this.waveLeaks = 0
        this.scheduleIndex = 0
        this.schedule = this.buildSchedule(wave)
        this.running = true
        this.purging = false
        this.paused = false

        fx.banner(this.overlayLayer, `WAVE ${wave}`, firewallIsBossWave(wave) ? fx.RED : fx.CYAN,
            `${this.schedule.length} hostiles queued`)
        this.emitWall()
        this.emitAmmo()
        this.emitPulse()
        this.emitOverclock()
        return true
    }

    /**
     * Hot-swaps the active weapon mid-wave. The magazine comes back full but the
     * swap costs a short reload, so switching is a decision rather than free.
     */
    swapWeapon(weapon: FirewallWeaponRuntime) {
        if (!this.loadout) return
        this.loadout = { ...this.loadout, weapon }
        this.weapon = weapon
        this.magSize = Math.round(weapon.magazine)
        this.mag = this.magSize
        this.reloadTimer = this.running ? Math.min(600, weapon.reloadMs) : 0
        this.fireTimer = 0
        this.callbacks.onWeapon(weapon.id)
        this.emitAmmo()
    }

    /** Uplink purchase — patches the wall back to full between waves. */
    repairWall() {
        this.wallHp = this.wallMaxHp
        // Force the decal layer to redraw on the next tick, otherwise a repaired
        // wall keeps the cracks it was bought out of.
        this.damageBucket = -1
        this.emitWall()
    }

    pause() {
        this.paused = true
        this.firing = false
    }

    resume() {
        this.paused = false
    }

    get isRunning() {
        return this.running
    }

    // ─── Bastion assembly ────────────────────────────────────────────────────

    /** Rebuilt only when Ramparts changes — it is a full geometry rebuild. */
    private rebuildBastion(rampart: number) {
        if (this.bastion && this.rampart === rampart) return
        this.rampart = rampart
        this.bastionRoot.removeChildren().forEach(child => child.destroy({ children: true }))
        this.bastion = fx.buildBastion(rampart)
        this.bastionRoot.addChild(this.bastion.root)
        this.damageBucket = -1
    }

    private get rise() {
        return fx.rampartRise(this.rampart)
    }

    /** Rebuilds the mounted turrets to match what the uplink installed. */
    private syncTurrets() {
        for (const mount of this.turrets) mount.root.destroy({ children: true })
        this.turrets = []
        const wanted = this.loadout?.turrets ?? []
        for (const runtime of wanted) {
            const anchor = TURRET_MOUNTS[runtime.slot % TURRET_MOUNTS.length]!
            const built = fx.buildTurret(runtime.id, runtime.hex)
            const x = anchor.x
            const y = anchor.y - this.rise
            built.root.position.set(x, y)
            this.turretLayer.addChild(built.root)
            this.turrets.push({
                runtime,
                root: built.root,
                barrel: built.barrel,
                x,
                y,
                cooldown: randRange(0, 400),
                kick: 0
            })
        }
    }

    // ─── Wave scheduling ─────────────────────────────────────────────────────

    /**
     * Spends the wave's budget up front and spreads the result over the spawn
     * window. Deciding the whole wave at once (rather than rolling each frame)
     * is what lets the HUD promise a hostile count the wave actually delivers.
     */
    private buildSchedule(wave: number): ScheduledSpawn[] {
        const pool = firewallWavePool(wave)
        let budget = firewallWaveBudget(wave)
        const picks: FirewallEnemyDefinition[] = []

        let guard = 600
        while (budget > 0 && guard-- > 0) {
            const affordable = pool.filter(def => def.cost <= budget)
            if (!affordable.length) break
            const totalWeight = affordable.reduce((sum, def) => sum + def.weight, 0)
            let roll = randomFloat() * totalWeight
            let chosen = affordable[affordable.length - 1] as FirewallEnemyDefinition
            for (const def of affordable) {
                roll -= def.weight
                if (roll <= 0) { chosen = def; break }
            }
            picks.push(chosen)
            budget -= chosen.cost
        }

        // Spread across the window, then jitter so the rhythm is not metronomic.
        const spawns: ScheduledSpawn[] = picks.map((def, index) => {
            const slot = picks.length <= 1 ? 0 : (index / (picks.length - 1)) * FIREWALL_SPAWN_WINDOW_MS
            const jitter = randRange(-1400, 1400)
            return { atMs: clamp(slot + jitter, 0, FIREWALL_SPAWN_WINDOW_MS), def }
        })

        if (firewallIsBossWave(wave)) {
            // The boss walks in early — it is slow, and a boss purged before it
            // ever reached the wall would be a wave with no climax.
            spawns.push({ atMs: 900, def: firewallEnemy(firewallBossFor(wave)) })
        }

        return spawns.sort((a, b) => a.atMs - b.atMs)
    }

    // ─── Main loop ───────────────────────────────────────────────────────────

    private tick(rawMs: number) {
        if (this.destroyed || !this.app) return
        // A backgrounded tab hands back one enormous frame on return; stepping
        // physics by it teleports every enemy through the wall.
        const dtMs = Math.min(rawMs, 50)
        const dt = dtMs / 1000
        this.elapsedTotal += dtMs

        this.updateCamera(dt)
        fx.drawSpikeBand(this.spikeGfx, this.loadout?.spikeDps ?? 0, this.elapsedTotal)
        this.updateRailAim()

        if (this.paused || this.gameOver) return

        if (this.running && !this.purging) {
            this.waveElapsed += dtMs
            this.releaseScheduled()
            this.updateWeapon(dtMs)
            this.updateAbilities(dtMs)
            if (this.waveElapsed >= FIREWALL_WAVE_MS) this.beginPurge()
        }

        this.updateEnemies(dt, dtMs)
        this.updateBullets(dt)
        this.updateSpits(dt)
        this.updateTurrets(dtMs)
        this.updateParticles(dt, dtMs)
        this.updateBastion(dt, dtMs)

        if (this.running) {
            this.callbacks.onWaveTime(Math.max(0, FIREWALL_WAVE_MS - this.waveElapsed), this.enemies.length)
        }
    }

    private updateCamera(dt: number) {
        if (this.shake > 0.05) {
            this.shake = Math.max(0, this.shake - this.shake * SHAKE_DECAY * dt)
            this.world.position.set(randRange(-this.shake, this.shake), randRange(-this.shake, this.shake))
        } else if (this.world.position.x !== 0 || this.world.position.y !== 0) {
            this.world.position.set(0, 0)
        }
    }

    private addShake(amount: number) {
        this.shake = Math.min(MAX_SHAKE, this.shake + amount)
    }

    // ─── Spawning ────────────────────────────────────────────────────────────

    private releaseScheduled() {
        while (this.scheduleIndex < this.schedule.length
            && (this.schedule[this.scheduleIndex] as ScheduledSpawn).atMs <= this.waveElapsed) {
            this.spawn((this.schedule[this.scheduleIndex] as ScheduledSpawn).def)
            this.scheduleIndex++
        }
    }

    private spawn(def: FirewallEnemyDefinition) {
        const laneT = randomFloat()
        const laneY = lerp(LANE_FAR_Y, LANE_NEAR_Y, laneT)
        // Bosses ignore the lane scale — a capital rendered small because it drew
        // a far lane would undercut the one moment a wave is supposed to land.
        const scale = def.boss ? 1.05 : lerp(LANE_FAR_SCALE, LANE_NEAR_SCALE, laneT)

        const rig = fx.buildFigure(def)
        rig.root.scale.set(scale)
        // Far lanes are dimmer, which sells the distance more cheaply than fog.
        rig.root.alpha = def.boss ? 1 : lerp(0.72, 1, laneT)
        rig.root.zIndex = Math.round(laneY)
        this.fieldLayer.addChild(rig.root)

        const hpMult = firewallHpMultiplier(this.wave)
        const maxHp = def.hp * hpMult
        const altitude = def.altitude ?? 0

        const enemy: EnemyEntity = {
            def,
            rig,
            x: SPAWN_X - randRange(0, 220),
            laneY,
            y: laneY - altitude * scale,
            scale,
            hp: maxHp,
            maxHp,
            // Perspective: the far lanes cross the screen a little slower.
            speed: def.speed * lerp(0.86, 1.08, laneT),
            damage: def.damage * (1 + (this.wave - 1) * 0.04),
            bounty: def.bounty * firewallBountyMultiplier(this.wave),
            armor: def.armor,
            stride: randomFloat() * Math.PI * 2,
            attackTimer: 0,
            burstLeft: 0,
            pushVx: 0,
            hover: randomFloat() * Math.PI * 2,
            flashMs: 0,
            dying: false,
            standoff: def.range ?? def.height * 0.3 * scale + 10,
            healthBar: null
        }
        this.enemies.push(enemy)

        if (def.boss) {
            this.callbacks.onBoss(def.name)
            fx.banner(this.overlayLayer, def.name, fx.RED, 'kernel-level intrusion')
            this.addShake(10)
        }
    }

    // ─── Enemies ─────────────────────────────────────────────────────────────

    private updateEnemies(dt: number, dtMs: number) {
        const spikeDps = this.loadout?.spikeDps ?? 0

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i] as EnemyEntity
            const stopX = WALL_X - enemy.standoff
            const atStop = enemy.x >= stopX

            if (!atStop) {
                const step = enemy.speed * dt
                enemy.x += step
                // Stride is driven by distance, not time, so a knocked-back or
                // crowded enemy never moon-walks.
                enemy.stride += (step / (enemy.def.height * enemy.scale)) * 7
            } else {
                enemy.x = stopX
                enemy.stride += dt * 6
                enemy.attackTimer -= dtMs
                if (enemy.attackTimer <= 0) {
                    // Burst types fire a short volley, then take the full gap.
                    if (enemy.burstLeft <= 0) enemy.burstLeft = enemy.def.burst ?? 1
                    enemy.burstLeft--
                    enemy.attackTimer = enemy.burstLeft > 0 ? 260 : enemy.def.attackMs
                    this.enemyStrike(enemy)
                    if (enemy.def.kind === 'bomber') continue
                }
            }

            // Knockback decays rather than stopping dead, so a pulse reads as a
            // shove rather than a teleport.
            if (enemy.pushVx !== 0) {
                enemy.x += enemy.pushVx * dt
                enemy.pushVx *= Math.max(0, 1 - dt * 4)
                if (Math.abs(enemy.pushVx) < 4) enemy.pushVx = 0
                if (enemy.x < DESPAWN_X) {
                    this.removeEnemy(i)
                    continue
                }
            }

            // Grid trap: ground units only, and only inside the band.
            if (spikeDps > 0 && !firewallIsAirborne(enemy.def) && enemy.x > WALL_X - SPIKE_BAND) {
                this.damageEnemy(enemy, spikeDps * dt, false, false, false, false)
                if (enemy.hp <= 0) {
                    this.killEnemy(i, 1)
                    continue
                }
                if (randomChance(dt * 6)) {
                    this.emitSparks(enemy.x, enemy.laneY - 6, 1, 0x67e8f9)
                }
            }

            if (firewallIsAirborne(enemy.def)) {
                enemy.hover += dt * 2.4
                enemy.y = enemy.laneY - (enemy.def.altitude ?? 0) * enemy.scale + Math.sin(enemy.hover) * 9
            }

            if (enemy.flashMs > 0) {
                enemy.flashMs -= dtMs
                enemy.rig.flash.alpha = Math.max(0, enemy.flashMs / 90) * 0.6
            }

            fx.poseFigure(enemy.rig, enemy.stride, atStop)
            enemy.rig.root.position.set(enemy.x, enemy.y)
        }

        this.separate(dt)
    }

    /**
     * Pushes overlapping enemies apart along the lane. Without it a wave stacks
     * into a single column at the wall and reads as one enemy taking sixty hits.
     */
    private separate(dt: number) {
        for (let i = 0; i < this.enemies.length; i++) {
            const a = this.enemies[i] as EnemyEntity
            for (let j = i + 1; j < this.enemies.length; j++) {
                const b = this.enemies[j] as EnemyEntity
                if (Math.abs(a.laneY - b.laneY) > 26) continue
                const gap = (a.def.height * a.scale + b.def.height * b.scale) * 0.16 + 6
                const dx = b.x - a.x
                if (Math.abs(dx) >= gap) continue
                const push = (gap - Math.abs(dx)) * CROWD_PUSH * dt * 0.02
                const dir = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx)
                a.x -= push * dir
                b.x += push * dir
            }
        }
    }

    /** What an enemy does when it reaches its stopping distance. */
    private enemyStrike(enemy: EnemyEntity) {
        switch (enemy.def.kind) {
            case 'ranged': {
                const heavy = enemy.def.id === 'artillery'
                const originX = enemy.x + enemy.def.height * 0.5 * enemy.scale
                const originY = enemy.y - enemy.def.height * 0.7 * enemy.scale
                const gfx = fx.makeSpitGfx(enemy.def.hex)
                if (heavy) gfx.scale.set(1.6)
                gfx.position.set(originX, originY)
                this.bulletLayer.addChild(gfx)
                // Aimed at the middle of the wall face; the arc does the rest.
                const targetX = WALL_X + 10
                const targetY = HORIZON_Y + 90 - this.rise
                const speed = heavy ? SPIT_SPEED * 1.5 : SPIT_SPEED
                const flightTime = Math.max(0.35, (targetX - originX) / speed)
                this.spits.push({
                    gfx,
                    x: originX,
                    y: originY,
                    vx: (targetX - originX) / flightTime,
                    vy: (targetY - originY) / flightTime - 0.5 * SPIT_GRAVITY * flightTime,
                    damage: enemy.damage,
                    hex: enemy.def.hex,
                    heavy
                })
                fx.muzzleFlash(this.fxLayer, originX, originY, 0, enemy.def.hex, heavy ? 1 : 0.5)
                break
            }
            case 'bomber': {
                this.damageWall(enemy.damage, enemy.x, enemy.y)
                fx.impactSpark(this.fxLayer, enemy.x, enemy.y - 20, enemy.def.hex, true)
                fx.shockRing(this.fxLayer, enemy.x, enemy.laneY, enemy.def.hex, 180, 400)
                this.emitShards(enemy, 18)
                this.addShake(14)
                this.callbacks.onNotice('A sapper reached the wall.', 'bad')
                const index = this.enemies.indexOf(enemy)
                if (index >= 0) this.removeEnemy(index)
                break
            }
            default: {
                this.damageWall(enemy.damage, enemy.x, enemy.y)
                fx.impactSpark(this.fxLayer, WALL_X, enemy.y - enemy.def.height * 0.4 * enemy.scale, enemy.def.hex)
                break
            }
        }
    }

    /**
     * Applies damage through plating. A non-AP round against a Siege Tank loses
     * most of itself and says so with a dim grey number — the armour mechanic is
     * invisible unless the feedback spells it out.
     */
    private damageEnemy(
        enemy: EnemyEntity,
        amount: number,
        flash: boolean,
        showNumber: boolean,
        crit = false,
        armorPiercing = false
    ) {
        const scale = firewallArmorScale(enemy.armor, armorPiercing)
        const dealt = amount * scale
        enemy.hp -= dealt
        if (flash) {
            enemy.flashMs = 90
            enemy.rig.flash.alpha = 0.6
        }
        if (showNumber) {
            const y = enemy.y - enemy.def.height * enemy.scale - 8
            const resisted = scale < 0.9
            fx.floatingText(
                this.textLayer, enemy.x, y,
                crit ? `${Math.round(dealt)}!` : `${Math.round(dealt)}`,
                crit ? 0xfde047 : resisted ? 0x94a3b8 : 0xe2e8f0,
                crit ? 1.5 : resisted ? 0.85 : 1
            )
        }
        if (enemy.hp < enemy.maxHp && !enemy.healthBar) {
            // Only wounded enemies get a bar; a pip over every crawler is noise.
            const bar = new Graphics()
            bar.position.set(0, -enemy.def.height - 14)
            enemy.rig.root.addChild(bar)
            enemy.healthBar = bar
        }
        if (enemy.healthBar) {
            fx.drawEnemyHealth(
                enemy.healthBar, enemy.hp / enemy.maxHp,
                enemy.def.height * 0.7, enemy.def.hex, enemy.armor >= 0.35
            )
        }
    }

    /** Removes an enemy and pays its bounty. `payout` scales it (the purge pays less). */
    private killEnemy(index: number, payout: number) {
        const enemy = this.enemies[index]
        if (!enemy) return
        const credits = Math.round(enemy.bounty * (this.loadout?.bountyMultiplier ?? 1) * payout)

        this.emitShards(enemy, enemy.def.boss ? 42 : 8)
        fx.impactSpark(this.fxLayer, enemy.x, enemy.y - enemy.def.height * 0.45 * enemy.scale, enemy.def.hex, enemy.def.boss)
        fx.scorch(this.fxLayer, enemy.x, enemy.laneY, enemy.def.hex, enemy.def.height * 0.4 * enemy.scale)
        if (credits > 0) {
            fx.floatingText(this.textLayer, enemy.x, enemy.y - enemy.def.height * enemy.scale - 20, `+${credits}`, fx.LIME, 1.1)
        }
        if (enemy.def.boss) {
            fx.shockRing(this.fxLayer, enemy.x, enemy.laneY, fx.RED, 520, 700)
            fx.screenFlash(this.overlayLayer, 0xffffff, 0.35)
            this.addShake(18)
            this.callbacks.onNotice(`${enemy.def.name} purged.`, 'good')
        }

        this.removeEnemy(index)
        this.waveKills++
        this.totalKills++
        if (credits > 0) {
            this.waveCredits += credits
            this.callbacks.onCredits(credits, payout < 1 ? 'purge' : 'kill')
        }
    }

    private removeEnemy(index: number) {
        const enemy = this.enemies[index]
        if (!enemy) return
        enemy.rig.root.destroy({ children: true })
        this.enemies.splice(index, 1)
    }

    // ─── Player weapon ───────────────────────────────────────────────────────

    private updateRailAim() {
        if (!this.bastion) return
        // Unclamped on purpose. The field is to the left, so aim angles live near
        // ±π — and any clamp expressed in atan2 space folds those onto the wrong
        // side, which pointed the barrel back into its own tower.
        const muzzleY = MUZZLE_Y - this.rise
        this.bastion.barrel.rotation = Math.atan2(this.aimY - muzzleY, this.aimX - MUZZLE_X)
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
        if (this.firing && this.reloadTimer <= 0 && this.fireTimer <= 0) {
            if (this.mag > 0) {
                this.shoot()
                this.fireTimer = weapon.fireIntervalMs / (this.overclockLeft > 0 ? this.overclockRate : 1)
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
    }

    private shoot() {
        const weapon = this.weapon
        const loadout = this.loadout
        if (!weapon || !loadout || !this.bastion) return
        this.mag--
        this.emitAmmo()

        const angle = this.bastion.barrel.rotation
        const muzzleY = MUZZLE_Y - this.rise
        const originX = MUZZLE_X + Math.cos(angle) * BARREL_LENGTH
        const originY = muzzleY + Math.sin(angle) * BARREL_LENGTH

        const crit = randomChance(loadout.critChance)
        const overclocked = this.overclockLeft > 0
        const damage = weapon.damage
            * (crit ? loadout.critMultiplier : 1)
            * (overclocked ? 1.25 : 1)

        const spec: ShotSpec = {
            damage,
            pierce: weapon.pierce,
            armorPiercing: weapon.armorPiercing,
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
            const spreadAngle = weapon.pellets > 1
                ? angle + randRange(-weapon.spread, weapon.spread)
                : angle
            this.spawnBullet(originX, originY, spreadAngle, spec)
        }

        fx.muzzleFlash(this.fxLayer, originX, originY, angle, spec.hex, weapon.projectile === 'slug' ? 1.5 : 1)
        // Recoil: the barrel kicks back along its own axis and springs home.
        this.bastion.barrel.position.set(weapon.projectile === 'slug' ? -12 : -7, 0)
        this.addShake(weapon.projectile === 'slug' ? 5 : crit ? 3 : 1.6)
    }

    private spawnBullet(x: number, y: number, angle: number, spec: ShotSpec) {
        const gfx = fx.makeProjectile(spec.projectile, spec.hex, spec.crit, spec.fromTurret)
        gfx.position.set(x, y)
        gfx.rotation = angle
        this.bulletLayer.addChild(gfx)
        this.bullets.push({
            gfx,
            x,
            y,
            prevX: x,
            prevY: y,
            vx: Math.cos(angle) * spec.speed,
            vy: Math.sin(angle) * spec.speed,
            damage: spec.damage,
            pierce: spec.pierce,
            hit: new Set(),
            // Missiles are slow and steer, so they need a far longer leash than
            // a rail slug that crosses the screen in half a second.
            lifeMs: BULLET_LIFE_MS * (spec.homing ? 3.5 : 1),
            crit: spec.crit,
            fromTurret: spec.fromTurret,
            armorPiercing: spec.armorPiercing,
            splashRadius: spec.splashRadius,
            splashDamage: spec.splashDamage,
            homing: spec.homing,
            target: spec.homing ? this.pickHomingTarget(x, y) : null,
            chain: spec.chain,
            chainFalloff: spec.chainFalloff,
            hex: spec.hex
        })
    }

    /** Missiles lock the enemy closest to the wall — the one that matters. */
    private pickHomingTarget(x: number, y: number) {
        let best: EnemyEntity | null = null
        let bestScore = -Infinity
        for (const enemy of this.enemies) {
            const score = enemy.x - dist(x, y, enemy.x, enemy.y) * 0.25
            if (score > bestScore) {
                bestScore = score
                best = enemy
            }
        }
        return best
    }

    private updateBullets(dt: number) {
        if (this.bastion) {
            // Spring the recoil out, framerate-independently enough for 12 pixels.
            const barrel = this.bastion.barrel
            barrel.position.x += (0 - barrel.position.x) * Math.min(1, dt * 18)
        }

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i] as BulletEntity

            if (bullet.homing) this.steerMissile(bullet, dt)

            bullet.prevX = bullet.x
            bullet.prevY = bullet.y
            bullet.x += bullet.vx * dt
            bullet.y += bullet.vy * dt
            bullet.lifeMs -= dt * 1000
            bullet.gfx.position.set(bullet.x, bullet.y)
            if (bullet.homing) bullet.gfx.rotation = Math.atan2(bullet.vy, bullet.vx)

            let consumed = false
            for (let e = this.enemies.length - 1; e >= 0; e--) {
                const enemy = this.enemies[e] as EnemyEntity
                if (bullet.hit.has(enemy)) continue
                if (!this.sweepHits(bullet, enemy)) continue

                bullet.hit.add(enemy)
                this.damageEnemy(enemy, bullet.damage, true, true, bullet.crit, bullet.armorPiercing)
                fx.impactSpark(this.fxLayer, bullet.x, bullet.y, enemy.def.hex)
                this.emitSparks(bullet.x, bullet.y, bullet.crit ? 5 : 3, enemy.def.hex)

                if (bullet.splashRadius > 0) this.detonate(bullet, enemy)
                if (bullet.chain > 0) this.chainFrom(bullet, enemy)

                if (enemy.hp <= 0) {
                    this.killEnemy(e, 1)
                } else if (!enemy.def.boss) {
                    // A little shove on hit — the feedback that sells the shot
                    // even when the target survives it.
                    enemy.pushVx -= bullet.fromTurret ? 12 : 30
                }

                // A warhead is spent on the first thing it touches, whatever its
                // pierce says; the splash is the multi-target part.
                if (bullet.pierce > 0 && bullet.splashRadius === 0) {
                    bullet.pierce--
                } else {
                    consumed = true
                    break
                }
            }

            const offField = bullet.x < -80 || bullet.x > VIEW_W + 80 || bullet.y > VIEW_H + 60 || bullet.y < -60
            if (consumed || bullet.lifeMs <= 0 || offField) {
                bullet.gfx.destroy()
                this.bullets.splice(i, 1)
            }
        }
    }

    /** Missiles turn at a fixed rate, so a bad lock is still a miss. */
    private steerMissile(bullet: BulletEntity, dt: number) {
        const target = bullet.target
        if (!target || target.hp <= 0 || !this.enemies.includes(target)) {
            bullet.target = this.pickHomingTarget(bullet.x, bullet.y)
            return
        }
        const speed = Math.hypot(bullet.vx, bullet.vy) || 1
        const desired = Math.atan2(
            target.y - target.def.height * target.scale * 0.5 - bullet.y,
            target.x - bullet.x
        )
        const current = Math.atan2(bullet.vy, bullet.vx)
        let diff = ((desired - current + Math.PI) % (Math.PI * 2)) - Math.PI
        if (diff < -Math.PI) diff += Math.PI * 2
        const angle = current + clamp(diff, -4.5 * dt, 4.5 * dt)
        bullet.vx = Math.cos(angle) * speed
        bullet.vy = Math.sin(angle) * speed
        if (randomChance(dt * 30)) {
            this.emitSparks(bullet.x - Math.cos(angle) * 14, bullet.y - Math.sin(angle) * 14, 1, bullet.hex)
        }
    }

    /** Splash from a warhead. The direct target has already been hit. */
    private detonate(bullet: BulletEntity, epicentre: EnemyEntity) {
        fx.shockRing(this.fxLayer, bullet.x, bullet.y, bullet.hex, bullet.splashRadius * 1.6, 380)
        fx.impactSpark(this.fxLayer, bullet.x, bullet.y, bullet.hex, true)
        this.emitSparks(bullet.x, bullet.y, 10, bullet.hex)
        this.addShake(3)
        for (let e = this.enemies.length - 1; e >= 0; e--) {
            const enemy = this.enemies[e] as EnemyEntity
            if (enemy === epicentre) continue
            const ey = enemy.y - enemy.def.height * enemy.scale * 0.5
            if (dist(bullet.x, bullet.y, enemy.x, ey) > bullet.splashRadius) continue
            this.damageEnemy(enemy, bullet.splashDamage, true, false, false, bullet.armorPiercing)
            if (enemy.hp <= 0) this.killEnemy(e, 1)
        }
    }

    /** Arc rounds jump to nearby enemies for a shrinking share of the damage. */
    private chainFrom(bullet: BulletEntity, source: EnemyEntity) {
        let fromX = source.x
        let fromY = source.y - source.def.height * source.scale * 0.5
        let damage = bullet.damage * bullet.chainFalloff

        for (let jump = 0; jump < bullet.chain; jump++) {
            let best: EnemyEntity | null = null
            let bestDist = 260
            for (const enemy of this.enemies) {
                if (bullet.hit.has(enemy)) continue
                const ey = enemy.y - enemy.def.height * enemy.scale * 0.5
                const d = dist(fromX, fromY, enemy.x, ey)
                if (d < bestDist) {
                    bestDist = d
                    best = enemy
                }
            }
            if (!best) return
            const targetY = best.y - best.def.height * best.scale * 0.5
            fx.chainArc(this.fxLayer, fromX, fromY, best.x, targetY, bullet.hex)
            bullet.hit.add(best)
            this.damageEnemy(best, damage, true, true, false, bullet.armorPiercing)
            if (best.hp <= 0) {
                const index = this.enemies.indexOf(best)
                if (index >= 0) this.killEnemy(index, 1)
            }
            fromX = best.x
            fromY = targetY
            damage *= bullet.chainFalloff
        }
    }

    /**
     * Swept hit test against the enemy's spine. Sampling three points up the
     * body beats a single centre circle: at 2600 px/s a bullet crosses a crawler
     * in half a frame, and a head-height shot on a Bulwark has to connect.
     */
    private sweepHits(bullet: BulletEntity, enemy: EnemyEntity) {
        const bodyHeight = enemy.def.height * enemy.scale
        const radius = bodyHeight * 0.22 + BULLET_RADIUS
        for (const t of [0.2, 0.5, 0.82]) {
            const py = enemy.y - bodyHeight * t
            if (segPointDist(bullet.prevX, bullet.prevY, bullet.x, bullet.y, enemy.x, py) <= radius) return true
        }
        return false
    }

    // ─── Turrets ─────────────────────────────────────────────────────────────

    private updateTurrets(dtMs: number) {
        const overclocked = this.overclockLeft > 0
        for (const mount of this.turrets) {
            const target = this.pickTurretTarget(mount)
            if (target) {
                const ty = target.y - target.def.height * target.scale * 0.55
                mount.barrel.rotation = Math.atan2(ty - mount.y, target.x - mount.x)
            }

            mount.kick += (0 - mount.kick) * Math.min(1, dtMs / 60)
            mount.barrel.position.x = -mount.kick

            if (!this.running || this.purging) continue
            mount.cooldown -= dtMs * (overclocked ? this.overclockRate : 1)
            if (!target || mount.cooldown > 0) continue
            mount.cooldown = mount.runtime.intervalMs

            const angle = mount.barrel.rotation
            const originX = mount.x + Math.cos(angle) * 30
            const originY = mount.y + Math.sin(angle) * 30
            const isMissile = mount.runtime.splashRadius > 0
            this.spawnBullet(originX, originY, angle, {
                damage: mount.runtime.damage,
                pierce: mount.runtime.pierce,
                armorPiercing: mount.runtime.armorPiercing,
                splashRadius: mount.runtime.splashRadius,
                splashDamage: mount.runtime.splashDamage,
                homing: isMissile,
                chain: 0,
                chainFalloff: 0,
                speed: isMissile ? 780 : 1700,
                hex: mount.runtime.hex,
                projectile: isMissile ? 'missile' : mount.runtime.pierce > 0 ? 'slug' : 'rail',
                crit: false,
                fromTurret: true
            })
            fx.muzzleFlash(this.fxLayer, originX, originY, angle, mount.runtime.hex, 0.45)
            mount.kick = 5
        }
    }

    /**
     * Turrets shoot whatever is closest to the wall and inside their range — the
     * actual threat order, and the reason a long-range Lance earns its price
     * against Howitzers that outrange everything else you own.
     */
    private pickTurretTarget(mount: TurretMount) {
        let best: EnemyEntity | null = null
        for (const enemy of this.enemies) {
            if (enemy.dying) continue
            if (dist(mount.x, mount.y, enemy.x, enemy.y) > mount.runtime.range) continue
            if (!best || enemy.x > best.x) best = enemy
        }
        return best
    }

    // ─── Enemy projectiles ───────────────────────────────────────────────────

    private updateSpits(dt: number) {
        for (let i = this.spits.length - 1; i >= 0; i--) {
            const spit = this.spits[i] as SpitEntity
            spit.vy += SPIT_GRAVITY * dt
            spit.x += spit.vx * dt
            spit.y += spit.vy * dt
            spit.gfx.position.set(spit.x, spit.y)

            const done = spit.x >= WALL_X || spit.y > VIEW_H
            if (!done) continue
            if (spit.x >= WALL_X) {
                this.damageWall(spit.damage, spit.x, spit.y)
                fx.impactSpark(this.fxLayer, spit.x, spit.y, spit.hex, spit.heavy)
                if (spit.heavy) {
                    fx.shockRing(this.fxLayer, spit.x, spit.y, spit.hex, 220, 420)
                    this.addShake(8)
                }
            }
            spit.gfx.destroy()
            this.spits.splice(i, 1)
        }
    }

    // ─── Abilities ───────────────────────────────────────────────────────────

    private updateAbilities(dtMs: number) {
        const loadout = this.loadout
        if (!loadout) return

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

        fx.shockRing(this.fxLayer, WALL_X, HORIZON_Y + 180 - this.rise, fx.CYAN, PULSE_RADIUS, 700)
        fx.screenFlash(this.overlayLayer, 0x22d3ee, 0.4)
        this.addShake(16)

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i] as EnemyEntity
            const falloff = clamp(1 - (WALL_X - enemy.x) / PULSE_RADIUS, 0.25, 1)
            // The pulse burns straight through plating; it is the panic button,
            // and a panic button armour ignores is not one.
            this.damageEnemy(enemy, loadout.pulseDamage * falloff, true, true, false, true)
            enemy.pushVx -= PULSE_KNOCKBACK * falloff * (enemy.def.boss ? 0.25 : 1)
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
        fx.screenFlash(this.overlayLayer, 0xf97316, 0.28)
        fx.banner(this.overlayLayer, 'OVERCLOCK', fx.AMBER)
        this.callbacks.onNotice('Overclock engaged.', 'good')
    }

    // ─── Bastion ─────────────────────────────────────────────────────────────

    private damageWall(amount: number, sourceX: number, sourceY: number) {
        if (this.gameOver) return
        this.msSinceWallHit = 0
        this.waveLeaks++

        let remaining = amount
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, remaining)
            this.shield -= absorbed
            remaining -= absorbed
            fx.impactSpark(this.fxLayer, WALL_X + 6, sourceY, 0x67e8f9)
        }
        if (remaining > 0) {
            this.wallHp = Math.max(0, this.wallHp - remaining)
            if (this.bastion) {
                this.bastion.hitFlash.alpha = Math.min(0.5, 0.1 + remaining / 220)
            }
            fx.floatingText(this.textLayer, WALL_X + 40, sourceY - 30, `-${Math.round(remaining)}`, fx.RED)
        }
        this.addShake(clamp(amount * 0.16, 1.5, 12))
        this.emitSparks(Math.max(WALL_X, sourceX), sourceY, 4, remaining > 0 ? fx.RED : 0x67e8f9)
        this.emitWall()

        if (this.wallHp <= 0) this.endRun()
    }

    private updateBastion(dt: number, dtMs: number) {
        const loadout = this.loadout
        const bastion = this.bastion
        if (!loadout || !bastion) return

        this.msSinceWallHit += dtMs

        if (this.running && !this.purging) {
            if (loadout.repairPerSec > 0 && this.wallHp < this.wallMaxHp) {
                this.wallHp = Math.min(this.wallMaxHp, this.wallHp + loadout.repairPerSec * dt)
                this.emitWall()
            }
            if (this.shieldMax > 0 && this.shield < this.shieldMax && this.msSinceWallHit > FIREWALL_SHIELD_DELAY_MS) {
                this.shield = Math.min(this.shieldMax, this.shield + loadout.shieldRegenPerSec * dt)
                this.emitWall()
            }
        }

        if (bastion.hitFlash.alpha > 0) {
            bastion.hitFlash.alpha = Math.max(0, bastion.hitFlash.alpha - dt * 2.4)
        }

        const integrity = this.wallMaxHp > 0 ? this.wallHp / this.wallMaxHp : 0
        // Decals are redrawn in 5% buckets: a full-height Graphics rebuild per
        // hit is work nobody can see.
        const bucket = Math.floor(integrity * 20)
        if (bucket !== this.damageBucket) {
            this.damageBucket = bucket
            fx.drawWallDamage(bastion.damage, integrity, this.rise)
            fx.drawCore(bastion.core, integrity, this.rise)
        }
        fx.drawShieldDome(bastion.shield, this.shieldMax > 0 ? this.shield / this.shieldMax : 0, this.rise)
    }

    // ─── Particles ───────────────────────────────────────────────────────────

    private emitShards(enemy: EnemyEntity, count: number) {
        const height = enemy.def.height * enemy.scale
        for (let i = 0; i < count; i++) {
            const gfx = fx.makeShard(enemy.def.hex, randRange(3, 7) * enemy.scale)
            const x = enemy.x + randRange(-height * 0.2, height * 0.2)
            const y = enemy.y - randRange(0, height)
            gfx.position.set(x, y)
            this.fxLayer.addChild(gfx)
            this.particles.push({
                gfx,
                x,
                y,
                vx: randRange(-190, 90),
                vy: randRange(-330, -60),
                gravity: 900,
                lifeMs: randRange(600, 1200),
                maxLifeMs: 1200,
                spin: randRange(-9, 9),
                drag: 0.4
            })
        }
    }

    private emitSparks(x: number, y: number, count: number, hex: number) {
        for (let i = 0; i < count; i++) {
            const gfx = fx.makeSpark(hex, randRange(3, 8))
            gfx.position.set(x, y)
            this.fxLayer.addChild(gfx)
            const angle = randRange(0, Math.PI * 2)
            const speed = randRange(120, 420)
            this.particles.push({
                gfx,
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: 420,
                lifeMs: randRange(180, 420),
                maxLifeMs: 420,
                spin: 0,
                drag: 2.4
            })
        }
    }

    private updateParticles(dt: number, dtMs: number) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i] as ParticleEntity
            p.lifeMs -= dtMs
            if (p.lifeMs <= 0) {
                p.gfx.destroy()
                this.particles.splice(i, 1)
                continue
            }
            p.vy += p.gravity * dt
            const drag = Math.max(0, 1 - p.drag * dt)
            p.vx *= drag
            p.vy *= drag
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.gfx.position.set(p.x, p.y)
            if (p.spin) p.gfx.rotation += p.spin * dt
            else p.gfx.rotation = Math.atan2(p.vy, p.vx)
            p.gfx.alpha = Math.min(1, p.lifeMs / (p.maxLifeMs * 0.5))
        }
    }

    // ─── Wave end ────────────────────────────────────────────────────────────

    /**
     * The wall flushes the field: a wall of light sweeps right to left and takes
     * everything it passes. Survivors still pay out, at a fraction — enough that
     * a wave you barely held is not also a wave you earned nothing from, little
     * enough that letting the clock do the work is always the worse play.
     */
    private beginPurge() {
        if (this.purging) return
        this.purging = true
        this.firing = false
        this.callbacks.onWaveTime(0, this.enemies.length)

        fx.screenFlash(this.overlayLayer, 0xffffff, 0.25)
        this.addShake(6)
        fx.purgeSweep(
            this.fxLayer,
            (frontX) => {
                for (let i = this.enemies.length - 1; i >= 0; i--) {
                    const enemy = this.enemies[i] as EnemyEntity
                    if (enemy.x < frontX) continue
                    this.killEnemy(i, FIREWALL_PURGE_BOUNTY)
                }
            },
            () => this.finishWave()
        )
    }

    private finishWave() {
        // A wall that fell during the sweep has already ended the run; do not
        // hand the uplink a wave it can deploy out of.
        if (this.gameOver) return
        this.running = false
        this.purging = false
        this.overclockLeft = 0

        // Anything left (a boss knocked past the sweep's start, say) goes too.
        while (this.enemies.length) this.killEnemy(this.enemies.length - 1, FIREWALL_PURGE_BOUNTY)
        for (const spit of this.spits) spit.gfx.destroy()
        this.spits = []

        const integrity = this.wallMaxHp > 0 ? this.wallHp / this.wallMaxHp : 0
        const bonus = firewallClearBonus(this.wave, integrity)
        this.waveCredits += bonus
        this.callbacks.onCredits(bonus, 'clear')

        this.callbacks.onWaveEnd({
            wave: this.wave,
            kills: this.waveKills,
            credits: this.waveCredits,
            leaked: this.waveLeaks,
            wallHp: Math.round(this.wallHp),
            wallMaxHp: this.wallMaxHp
        })
    }

    private endRun() {
        if (this.gameOver) return
        this.gameOver = true
        this.running = false
        this.purging = false
        this.firing = false

        fx.screenFlash(this.overlayLayer, fx.RED, 0.6, 900)
        fx.banner(this.overlayLayer, 'BREACHED', fx.RED, `wave ${this.wave}`)
        this.addShake(MAX_SHAKE)
        if (this.bastion) fx.drawCore(this.bastion.core, 0, this.rise)
        for (let i = 0; i < 6; i++) {
            fx.shockRing(this.fxLayer, WALL_X + randRange(0, 240), HORIZON_Y + randRange(40, 320), fx.RED, 300, 800)
        }
        this.callbacks.onGameOver({ wave: this.wave, kills: this.totalKills })
    }

    // ─── Housekeeping ────────────────────────────────────────────────────────

    private clearField() {
        while (this.enemies.length) this.removeEnemy(this.enemies.length - 1)
        for (const bullet of this.bullets) bullet.gfx.destroy()
        this.bullets = []
        for (const spit of this.spits) spit.gfx.destroy()
        this.spits = []
        for (const particle of this.particles) particle.gfx.destroy()
        this.particles = []
        this.textLayer.removeChildren().forEach(child => child.destroy())
        this.shake = 0
        this.world.position.set(0, 0)
        this.damageBucket = -1
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
