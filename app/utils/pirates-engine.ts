import { Application, Container, Graphics, Text, Circle } from 'pixi.js'
import gsap from 'gsap'
import {
    PIRATE_RUN_DURATION_MS,
    PIRATE_TREASURE_MIN_INTERVAL_MS, PIRATE_TREASURE_MAX_INTERVAL_MS, PIRATE_TREASURE_LIFESPAN_MS,
    pirateSpawnIntervalMs, pirateMaxConcurrentEnemies, pirateRollEnemyTier, pirateDifficultyMultiplier,
    pirateTreasureReward,
    type PirateEnemyTier, type PirateCannonStats
} from '#shared/utils/gamelogic/pirates'

export interface PirateShipStats {
    maxHp: number
    speed: number
    cannon: PirateCannonStats
    range: number
    reloadMs: number
}

export interface PirateGameCallbacks {
    onHpChange: (hp: number, maxHp: number) => void
    onCoinsChange: (coins: number) => void
    onTimeChange: (elapsedMs: number, remainingMs: number) => void
    onGameOver: (result: { survived: boolean, coins: number, elapsedMs: number }) => void
    onKill?: (tierName: string, reward: number) => void
}

// World is authored in a fixed design space and the whole `world` container is
// scaled to fit the host element on resize (same pattern fireinthehole.vue uses
// for its reel grid).
const WORLD_W = 1400
const WORLD_H = 820
const BALL_SPEED = 780 // px/s
const PICKUP_RADIUS = 46
const HOLD_RANGE_FRACTION = 0.85
const ROTATE_LERP = 0.12
const MOVE_STOP_DIST = 6

interface Enemy {
    id: number
    tier: PirateEnemyTier
    hp: number
    maxHp: number
    x: number
    y: number
    angle: number
    reloadTimer: number
    speed: number
    dmgMin: number
    dmgMax: number
    root: Container
    hull: Container
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

export class PirateGame {
    private app: Application | null = null
    private world = new Container()
    private bg = new Graphics()
    private treasureLayer = new Container()
    private enemyLayer = new Container()
    private playerLayer = new Container()
    private effectsLayer = new Container()

    private callbacks: PirateGameCallbacks
    private stats: PirateShipStats
    private power = 5
    private runDurationMs = PIRATE_RUN_DURATION_MS

    private running = false
    private destroyed = false
    private elapsedMs = 0
    private playerHp = 100
    private coins = 0
    private playerX = WORLD_W / 2
    private playerY = WORLD_H / 2
    private playerAngle = 0
    private moveTarget: { x: number, y: number } | null = null
    private attackTargetId: number | null = null
    private reloadTimer = 0
    private spawnTimerMs = 0
    private treasureTimerMs = 0
    private nextEnemyId = 1
    private enemies = new Map<number, Enemy>()
    private treasure: Treasure | null = null
    private player!: { root: Container, hull: Container }

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

        this.world.addChild(this.bg)
        this.world.addChild(this.treasureLayer)
        this.world.addChild(this.enemyLayer)
        this.world.addChild(this.playerLayer)
        this.world.addChild(this.effectsLayer)
        this.app.stage.addChild(this.world)

        this.drawWaterTexture()
        this.bg.eventMode = 'static'
        this.bg.cursor = 'crosshair'
        this.bg.on('pointerdown', (e) => {
            const p = e.getLocalPosition(this.world)
            this.handleWaterClick(p.x, p.y)
        })

        this.player = this.createShipVisual(0xf4d35e, true)
        this.player.root.position.set(this.playerX, this.playerY)
        this.playerLayer.addChild(this.player.root)

        this.app.ticker.add((ticker) => this.update(ticker.deltaMS))
    }

    resize(clientWidth: number) {
        if (!this.app) return
        const w = Math.max(360, Math.round(clientWidth))
        const h = Math.round(w * WORLD_H / WORLD_W)
        this.app.renderer.resize(w, h)
        this.world.scale.set(w / WORLD_W)
    }

    start(stats: PirateShipStats, power: number) {
        this.stats = stats
        this.power = power
        this.playerHp = stats.maxHp
        this.coins = 0
        this.elapsedMs = 0
        this.attackTargetId = null
        this.moveTarget = null
        this.reloadTimer = 0
        this.spawnTimerMs = pirateSpawnIntervalMs(0)
        this.treasureTimerMs = randRange(PIRATE_TREASURE_MIN_INTERVAL_MS, PIRATE_TREASURE_MAX_INTERVAL_MS)
        this.playerX = WORLD_W / 2
        this.playerY = WORLD_H / 2
        this.playerAngle = 0
        this.clearEntities()

        this.player.root.alpha = 1
        this.player.root.scale.set(1)
        this.player.hull.rotation = 0
        this.player.hull.scale.set(1)
        this.player.root.position.set(this.playerX, this.playerY)

        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.callbacks.onCoinsChange(this.coins)
        this.callbacks.onTimeChange(0, this.runDurationMs)

        this.running = true
    }

    destroy() {
        this.destroyed = true
        this.running = false
        if (this.app) {
            this.app.destroy(true, { children: true, texture: true })
            this.app = null
        }
    }

    // ─── Input ──────────────────────────────────────────────────────────────

    private handleWaterClick(x: number, y: number) {
        if (!this.running) return
        this.attackTargetId = null
        this.moveTarget = { x, y }
    }

    // ─── Main loop ──────────────────────────────────────────────────────────

    private update(deltaMS: number) {
        if (!this.running) return
        const dt = deltaMS / 1000
        this.elapsedMs += deltaMS
        this.callbacks.onTimeChange(this.elapsedMs, Math.max(0, this.runDurationMs - this.elapsedMs))

        this.updatePlayer(dt, deltaMS)
        this.updateEnemies(dt, deltaMS)
        this.updateTreasure(dt, deltaMS)
        this.updateSpawning(deltaMS)

        if (this.elapsedMs >= this.runDurationMs) this.endGame(true)
    }

    private updatePlayer(dt: number, deltaMS: number) {
        const target = this.attackTargetId !== null ? this.enemies.get(this.attackTargetId) : null

        if (target) {
            const d = dist(this.playerX, this.playerY, target.x, target.y)
            const desiredAngle = Math.atan2(target.y - this.playerY, target.x - this.playerX)
            this.playerAngle = lerpAngle(this.playerAngle, desiredAngle, ROTATE_LERP)

            // Close the distance until comfortably inside range (a margin below
            // the hard cutoff) so the ship doesn't flicker between chasing and
            // holding as the enemy drifts right at the boundary.
            if (d > this.stats.range * HOLD_RANGE_FRACTION) {
                this.playerX += Math.cos(desiredAngle) * this.stats.speed * dt
                this.playerY += Math.sin(desiredAngle) * this.stats.speed * dt
            }
            if (d <= this.stats.range) {
                this.reloadTimer -= deltaMS
                if (this.reloadTimer <= 0) {
                    this.reloadTimer = this.stats.reloadMs
                    this.playerFireAt(target)
                }
            }
        } else if (this.moveTarget) {
            const d = dist(this.playerX, this.playerY, this.moveTarget.x, this.moveTarget.y)
            if (d > MOVE_STOP_DIST) {
                const ang = Math.atan2(this.moveTarget.y - this.playerY, this.moveTarget.x - this.playerX)
                this.playerAngle = lerpAngle(this.playerAngle, ang, ROTATE_LERP)
                this.playerX += Math.cos(ang) * this.stats.speed * dt
                this.playerY += Math.sin(ang) * this.stats.speed * dt
            } else {
                this.moveTarget = null
            }
        }

        const margin = 40
        this.playerX = Math.min(WORLD_W - margin, Math.max(margin, this.playerX))
        this.playerY = Math.min(WORLD_H - margin, Math.max(margin, this.playerY))
        this.player.root.position.set(this.playerX, this.playerY)
        this.player.hull.rotation = this.playerAngle
    }

    private updateEnemies(_dt: number, deltaMS: number) {
        const dt = _dt
        for (const enemy of this.enemies.values()) {
            const d = dist(enemy.x, enemy.y, this.playerX, this.playerY)
            const desiredAngle = Math.atan2(this.playerY - enemy.y, this.playerX - enemy.x)
            enemy.angle = lerpAngle(enemy.angle, desiredAngle, ROTATE_LERP)

            if (d > enemy.tier.range) {
                enemy.x += Math.cos(desiredAngle) * enemy.speed * dt
                enemy.y += Math.sin(desiredAngle) * enemy.speed * dt
                const margin = 30
                enemy.x = Math.min(WORLD_W - margin, Math.max(margin, enemy.x))
                enemy.y = Math.min(WORLD_H - margin, Math.max(margin, enemy.y))
            } else {
                enemy.reloadTimer -= deltaMS
                if (enemy.reloadTimer <= 0) {
                    enemy.reloadTimer = enemy.tier.reloadMs
                    this.enemyFire(enemy)
                }
            }

            enemy.root.position.set(enemy.x, enemy.y)
            enemy.hull.rotation = enemy.angle
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
            const max = pirateMaxConcurrentEnemies(this.elapsedMs)
            if (this.enemies.size < max) this.spawnEnemy()
            this.spawnTimerMs = pirateSpawnIntervalMs(this.elapsedMs) * randRange(0.85, 1.2)
        }
    }

    // ─── Combat ─────────────────────────────────────────────────────────────

    private playerFireAt(target: Enemy) {
        const id = target.id
        const cannon = this.stats.cannon
        this.fireVolley({
            getFrom: () => this.running ? { x: this.playerX, y: this.playerY } : null,
            getTo: () => {
                const e = this.enemies.get(id)
                return e && !e.dead ? { x: e.x, y: e.y } : null
            },
            dmgMin: cannon.min,
            dmgMax: cannon.max,
            ballCount: cannon.balls,
            ballColor: 0x44403c,
            onHit: (dmg, crit) => {
                const e = this.enemies.get(id)
                if (e && !e.dead) this.hitEnemy(e, dmg, crit)
            }
        })
    }

    private enemyFire(enemy: Enemy) {
        const id = enemy.id
        this.fireVolley({
            getFrom: () => {
                const e = this.enemies.get(id)
                return e ? { x: e.x, y: e.y } : null
            },
            getTo: () => this.running ? { x: this.playerX, y: this.playerY } : null,
            dmgMin: enemy.dmgMin,
            dmgMax: enemy.dmgMax,
            ballCount: 1,
            ballColor: 0x1c1917,
            onHit: (dmg, crit) => { if (this.running) this.hitPlayer(dmg, crit) }
        })
    }

    private fireVolley(opts: {
        getFrom: () => { x: number, y: number } | null
        getTo: () => { x: number, y: number } | null
        dmgMin: number
        dmgMax: number
        ballCount: number
        ballColor?: number
        onHit: (dmg: number, crit: boolean, x: number, y: number) => void
    }) {
        for (let i = 0; i < opts.ballCount; i++) {
            gsap.delayedCall(i * 0.09, () => {
                if (this.destroyed || !this.running) return
                const from = opts.getFrom()
                const to = opts.getTo()
                if (!from || !to) return
                this.spawnCannonball(from.x, from.y, to.x, to.y, opts.dmgMin, opts.dmgMax, opts.onHit, opts.ballColor)
            })
        }
    }

    private spawnCannonball(
        fromX: number, fromY: number, toX: number, toY: number,
        dmgMin: number, dmgMax: number,
        onHit: (dmg: number, crit: boolean, x: number, y: number) => void,
        ballColor = 0x2b2320
    ) {
        const spread = 22
        const tx = toX + (Math.random() - 0.5) * spread
        const ty = toY + (Math.random() - 0.5) * spread
        const travel = dist(fromX, fromY, tx, ty)
        const duration = Math.min(0.85, Math.max(0.16, travel / BALL_SPEED))

        const ballRoot = new Container()
        ballRoot.position.set(fromX, fromY)
        const ball = new Graphics()
        ball.circle(0, 0, 5).fill({ color: ballColor }).stroke({ width: 1, color: 0x000000, alpha: 0.5 })
        ballRoot.addChild(ball)
        this.effectsLayer.addChild(ballRoot)

        gsap.to(ball.position, { y: -28, duration: duration / 2, ease: 'sine.out', yoyo: true, repeat: 1 })
        gsap.to(ball.scale, { x: 1.35, y: 1.35, duration: duration / 2, ease: 'sine.out', yoyo: true, repeat: 1 })
        gsap.to(ballRoot.position, {
            x: tx,
            y: ty,
            duration,
            ease: 'none',
            onComplete: () => {
                if (this.destroyed) return
                ballRoot.destroy({ children: true })
                this.spawnSplash(tx, ty)
                const dmg = Math.round(randRange(dmgMin, dmgMax))
                const crit = Math.random() < 0.12
                onHit(crit ? Math.round(dmg * 1.6) : dmg, crit, tx, ty)
            }
        })
    }

    private hitEnemy(enemy: Enemy, dmg: number, crit: boolean) {
        if (enemy.dead) return
        enemy.hp -= dmg
        this.spawnDamagePopup(enemy.x, enemy.y - 34, crit ? `${dmg}!` : `${dmg}`, crit ? 0xfacc15 : 0xffffff, crit)
        if (enemy.hp <= 0) {
            this.killEnemy(enemy)
        } else {
            this.updateEnemyHpBar(enemy)
        }
    }

    private killEnemy(enemy: Enemy) {
        enemy.dead = true
        this.enemies.delete(enemy.id)
        if (this.attackTargetId === enemy.id) this.attackTargetId = null

        const reward = Math.round(randRange(enemy.tier.coinMin, enemy.tier.coinMax))
        this.coins += reward
        this.callbacks.onCoinsChange(this.coins)
        this.callbacks.onKill?.(enemy.tier.name, reward)
        this.spawnDamagePopup(enemy.x, enemy.y - 10, `+${reward}`, 0xfde047, false)
        this.spawnSplash(enemy.x, enemy.y)

        gsap.to(enemy.root.scale, { x: 0, y: 0, duration: 0.5, ease: 'back.in(1.6)' })
        gsap.to(enemy.root, {
            alpha: 0,
            duration: 0.55,
            ease: 'power2.in',
            onComplete: () => enemy.root.destroy({ children: true })
        })
    }

    private hitPlayer(dmg: number, crit: boolean) {
        if (!this.running) return
        this.playerHp = Math.max(0, this.playerHp - dmg)
        this.callbacks.onHpChange(this.playerHp, this.stats.maxHp)
        this.spawnDamagePopup(this.playerX, this.playerY - 30, `-${dmg}`, 0xff6b6b, crit)
        this.shake(crit ? 9 : 5)
        if (this.playerHp <= 0) this.endGame(false)
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

        root.eventMode = 'static'
        root.cursor = 'pointer'
        root.hitArea = new Circle(0, 0, 26)
        root.on('pointerdown', (e) => {
            e.stopPropagation()
            if (!this.running) return
            this.attackTargetId = null
            this.moveTarget = { x, y }
        })

        this.treasure = {
            root,
            x,
            y,
            vx: randRange(-16, 16),
            vy: randRange(-16, 16),
            reward: pirateTreasureReward(this.elapsedMs),
            age: 0
        }
    }

    private collectTreasure(tr: Treasure) {
        this.treasure = null
        this.coins += tr.reward
        this.callbacks.onCoinsChange(this.coins)
        this.spawnDamagePopup(tr.x, tr.y - 14, `+${tr.reward}`, 0xfde047, true)
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

    // ─── Enemy spawning ─────────────────────────────────────────────────────

    private spawnEnemy() {
        if (!this.running || !this.app) return
        const tier = pirateRollEnemyTier(this.elapsedMs)
        const diff = pirateDifficultyMultiplier(this.elapsedMs, this.power)
        const hp = Math.max(1, Math.round(tier.hp * diff.hpMult))

        const margin = 50
        const edge = Math.floor(Math.random() * 4)
        let x: number, y: number
        if (edge === 0) { x = margin; y = randRange(margin, WORLD_H - margin) } else if (edge === 1) { x = WORLD_W - margin; y = randRange(margin, WORLD_H - margin) } else if (edge === 2) { x = randRange(margin, WORLD_W - margin); y = margin } else { x = randRange(margin, WORLD_W - margin); y = WORLD_H - margin }

        const visual = this.createShipVisual(tier.color, false)
        const hpBar = this.createHpBar()
        visual.root.addChild(hpBar.container)
        visual.root.position.set(x, y)
        visual.root.scale.set(0.001)
        this.enemyLayer.addChild(visual.root)
        gsap.to(visual.root.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' })

        const id = this.nextEnemyId++
        const enemy: Enemy = {
            id,
            tier,
            hp,
            maxHp: hp,
            x,
            y,
            angle: Math.atan2(this.playerY - y, this.playerX - x),
            reloadTimer: randRange(300, tier.reloadMs),
            speed: tier.speed,
            dmgMin: Math.max(1, Math.round(tier.dmgMin * diff.dmgMult)),
            dmgMax: Math.max(1, Math.round(tier.dmgMax * diff.dmgMult)),
            root: visual.root,
            hull: visual.hull,
            hpBarFill: hpBar.fill,
            hpBarWidth: hpBar.width,
            dead: false
        }
        this.enemies.set(id, enemy)

        visual.root.eventMode = 'static'
        visual.root.cursor = 'pointer'
        visual.root.hitArea = new Circle(0, 0, 40)
        visual.root.on('pointerdown', (e) => {
            e.stopPropagation()
            if (!this.running || enemy.dead) return
            this.attackTargetId = id
            this.moveTarget = null
        })
    }

    // ─── Visuals ────────────────────────────────────────────────────────────

    private drawWaterTexture() {
        this.bg.clear()
        this.bg.rect(0, 0, WORLD_W, WORLD_H).fill({ color: 0x0b3a57 })
        for (let i = 0; i < 40; i++) {
            const x = Math.random() * WORLD_W
            const y = Math.random() * WORLD_H
            const w = 40 + Math.random() * 90
            this.bg.ellipse(x, y, w, w * 0.18).fill({ color: 0x1c5c82, alpha: 0.12 + Math.random() * 0.08 })
        }
    }

    private createShipVisual(color: number, isPlayer: boolean) {
        const root = new Container()
        const hull = new Container()

        const shadow = new Graphics()
        shadow.ellipse(2, 6, 40, 22).fill({ color: 0x000000, alpha: 0.25 })
        hull.addChild(shadow)

        const body = new Graphics()
        body.ellipse(0, 0, 38, 20).fill({ color }).stroke({ width: 3, color: 0x1c1917, alpha: 0.7 })
        hull.addChild(body)

        const deck = new Graphics()
        deck.ellipse(-2, -2, 24, 11).fill({ color: 0xffffff, alpha: 0.18 })
        hull.addChild(deck)

        const bow = new Graphics()
        bow.poly([38, 0, 26, -9, 26, 9]).fill({ color })
        hull.addChild(bow)

        const mast = new Graphics()
        mast.rect(-2, -34, 4, 30).fill({ color: 0x3f2f1f })
        hull.addChild(mast)

        const sail = new Graphics()
        sail.poly([0, -34, 22, -26, 0, -16]).fill({ color: isPlayer ? 0xfaf3e0 : 0xd9d2c4, alpha: 0.92 }).stroke({ width: 1.5, color: 0x1c1917, alpha: 0.5 })
        hull.addChild(sail)

        if (isPlayer) {
            const flag = new Graphics()
            flag.poly([-2, -34, -16, -30, -2, -26]).fill({ color: 0xef4444 })
            hull.addChild(flag)
        }

        root.addChild(hull)
        return { root, hull }
    }

    private createHpBar() {
        const width = 52
        const container = new Container()
        container.position.set(-width / 2, -50)
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

    private spawnDamagePopup(x: number, y: number, text: string, color: number, crit: boolean) {
        const label = new Text({
            text,
            style: {
                fill: color,
                fontFamily: 'Inter, ui-sans-serif, system-ui',
                fontSize: crit ? 26 : 20,
                fontWeight: '900',
                stroke: { color: 0x111827, width: 4 },
                dropShadow: { color, blur: 8, distance: 0, alpha: 0.85 }
            }
        })
        label.anchor.set(0.5)
        label.position.set(x + (Math.random() - 0.5) * 16, y)
        label.scale.set(0.5)
        this.effectsLayer.addChild(label)
        const drift = (Math.random() - 0.5) * 26
        gsap.to(label.scale, { x: 1, y: 1, duration: 0.16, ease: 'back.out(3)' })
        gsap.to(label.position, { x: label.x + drift, y: label.y - 56, duration: 0.7, ease: 'power2.out' })
        gsap.to(label, { alpha: 0, duration: 0.22, delay: 0.48, ease: 'power2.in', onComplete: () => label.destroy() })
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
            enemy.root.destroy({ children: true })
        }
        this.enemies.clear()
        if (this.treasure) {
            gsap.killTweensOf(this.treasure.root)
            this.treasure.root.destroy({ children: true })
            this.treasure = null
        }
        this.effectsLayer.removeChildren().forEach(c => c.destroy({ children: true }))
        gsap.killTweensOf(this.world.position)
        this.world.position.set(0, 0)
    }

    private endGame(survived: boolean) {
        if (!this.running) return
        this.running = false
        this.attackTargetId = null
        this.moveTarget = null
        if (!survived) {
            gsap.to(this.player.hull.scale, { x: 0, y: 0, duration: 0.9, ease: 'back.in(1.3)' })
            gsap.to(this.player.hull, { rotation: this.player.hull.rotation + 1.3, alpha: 0.15, duration: 0.9 })
            this.spawnSplash(this.playerX, this.playerY)
        }
        this.callbacks.onGameOver({ survived, coins: this.coins, elapsedMs: this.elapsedMs })
    }
}
