import {
    SHAPEZZ_ARENA,
    shapezzCheckpointDecision,
    shapezzIncomingShots,
    shapezzLayaCheckpointQuestions,
    shapezzLayaCombatAdvice,
    shapezzLayaCombatQuestions,
    shapezzTargetOf,
    shapezzZoneOf,
    type ShapezzAutopilotAdvice,
    type ShapezzAutopilotEnemy,
    type ShapezzAutopilotPickup,
    type ShapezzAutopilotView,
    type ShapezzCheckpointContext,
    type ShapezzCheckpointDecision
} from '#shared/utils/gamelogic/shapezz-autopilot'
import type { ShapezzAutopilotInput, ShapezzEngine } from './shapezz-engine'

// Auto-play for SHAPEZZ. Two loops share the work:
//
// - The brain: up to ten times a second the browser asks Laya, running on the
//   player's own machine (laya_server.py), how much danger the cube is in,
//   which third of the arena is safe, whether a health orb is worth it and
//   which enemies to shoot first. One question at a time is in flight, so a
//   slower machine simply gets fewer answers a second. At every checkpoint it
//   also picks the mutation; it never cashes out.
// - The helm: twenty times a second, code simulates the next 0.6 s for every
//   move it could make (left, stay, right, each with or without a jump or a
//   drop through a platform) against the shots and rammers bearing down, and
//   takes the cheapest. Aiming leads the chosen target. Dodging lives here,
//   since even a fast answer from Laya is too slow to react to a shot.
//
// Laya's danger and health judgments are blended with the helm's own read
// rather than trusted outright: measured on these kinds of question, it ranks
// situations well but its 50% line wanders. Without fresh answers (Laya not
// running) the helm steers on its own read alone.

export type ShapezzAutopilotMode = 'fight' | 'dodge' | 'retreat' | 'heal'

export interface ShapezzAutopilotStatus {
    mode: ShapezzAutopilotMode
    /** Latest advice came from Laya and is still fresh. */
    laya: boolean
    /** The last question reached Laya. */
    online: boolean
}

const PLAN_MS = 50
const HORIZON_S = 0.6
const STEP_S = 0.05
/** At most ten questions a second, and never two at once. */
const ASK_INTERVAL_MS = 100
const LAYA_TIMEOUT_MS = 1000
const CHECKPOINT_TIMEOUT_MS = 2500
/** How long to wait before trying again once Laya stops answering. */
const OFFLINE_RETRY_MS = 3000
const ADVICE_STALE_MS = 800
/** Share of the danger and health judgments that comes from Laya. */
const LAYA_WEIGHT = 0.6
const SPAWN_EDGE = 110

const MOVES = [-1, 0, 1] as const
type Action = 'none' | 'jump' | 'drop'

function dist(a: { x: number, y: number }, b: { x: number, y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

function hull(view: ShapezzAutopilotView) {
    return view.hp / Math.max(1, view.maxHp)
}

function isRammer(enemy: ShapezzAutopilotEnemy) {
    return enemy.type !== 'shooter' && enemy.type !== 'boss'
}

/** The helm's own read of the arena. */
function localAdvice(view: ShapezzAutopilotView): ShapezzAutopilotAdvice {
    const shots = shapezzIncomingShots(view).length
    const rammers = view.enemies.filter(enemy => isRammer(enemy) && dist(enemy, view.player) < enemy.radius + 110).length
    const boss = view.enemies.some(enemy => enemy.type === 'boss' && dist(enemy, view.player) < 330)
    return {
        danger: Math.min(1, (1 - hull(view)) * 0.6 + shots * 0.15 + rammers * 0.2 + (boss ? 0.2 : 0)),
        zones: null,
        grabHealth: hull(view) < 0.6 ? 1 : hull(view) < 0.8 ? 0.5 : 0,
        focus: null,
        focusConfidence: 0
    }
}

function blend(laya: ShapezzAutopilotAdvice, local: ShapezzAutopilotAdvice): ShapezzAutopilotAdvice {
    const mix = (a: number, b: number) => a * LAYA_WEIGHT + b * (1 - LAYA_WEIGHT)
    return { ...laya, danger: mix(laya.danger, local.danger), grabHealth: mix(laya.grabHealth, local.grabHealth) }
}

async function askLaya(url: string, questions: object, timeoutMs: number) {
    const res = await fetch(`${url}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
        signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    const data = await res.json() as { answers?: Record<string, { noul?: number, choice?: string, probabilities?: Record<string, number> }> }
    return data.answers ?? null
}

export class ShapezzAutopilot {
    private stopped = true
    /** Bumped on stop, so an answer to a question from before a restart is dropped. */
    private generation = 0
    private inFlight = false
    private askedAt = -Infinity
    private retryAt = 0
    private advice: ShapezzAutopilotAdvice | null = null
    private adviceAt = 0
    private planTimer = 0
    private move: -1 | 0 | 1 = 0
    private input: ShapezzAutopilotInput = { move: 0, jump: false, drop: false, aimX: SHAPEZZ_ARENA.width / 2, aimY: SHAPEZZ_ARENA.height / 2, fire: false }
    private lastHp = -1
    private roundDamage = 0
    private status: ShapezzAutopilotStatus = { mode: 'fight', laya: false, online: false }

    constructor(
        private engine: ShapezzEngine,
        /** Root of the local Laya API, e.g. http://127.0.0.1:8000. */
        private layaUrl: string,
        private onStatus: (status: ShapezzAutopilotStatus) => void,
        /** The advice steering the cube, every plan. `laya` is false for the helm's own read. */
        private onAdvice?: (advice: ShapezzAutopilotAdvice, laya: boolean) => void
    ) {}

    start() {
        if (!this.stopped) return
        this.stopped = false
        this.advice = null
        this.retryAt = 0
        this.lastHp = -1
        this.onStatus(this.status)
        this.engine.setFrameHook(dt => this.frame(dt))
        this.engine.setAutopilotInput(this.input)
    }

    stop() {
        this.stopped = true
        this.generation += 1
        this.inFlight = false
        this.engine.setFrameHook(null)
        this.engine.setAutopilotInput(null)
        this.setStatus({ online: false, laya: false })
    }

    /** Hull and shield lost since the last checkpoint, as a share of max hull. */
    damageThisRound(maxHp: number) {
        return this.roundDamage / Math.max(1, maxHp)
    }

    /** Pick the mutation. Falls back to the build values alone if Laya is down. */
    async decideCheckpoint(ctx: ShapezzCheckpointContext): Promise<ShapezzCheckpointDecision> {
        let answers = null
        if (performance.now() >= this.retryAt) {
            try {
                answers = await askLaya(this.layaUrl, shapezzLayaCheckpointQuestions(ctx), CHECKPOINT_TIMEOUT_MS)
            } catch {
                answers = null
            }
        }
        this.roundDamage = 0
        return shapezzCheckpointDecision(ctx, answers)
    }

    private setStatus(patch: Partial<ShapezzAutopilotStatus>) {
        const next = { ...this.status, ...patch }
        if (next.mode === this.status.mode && next.laya === this.status.laya && next.online === this.status.online) return
        this.status = next
        this.onStatus(next)
    }

    private frame(dt: number) {
        // Jump and drop are single presses: hold them for exactly one frame.
        this.input.jump = false
        this.input.drop = false
        this.planTimer -= dt * 1000
        if (this.planTimer > 0) return
        this.planTimer = PLAN_MS

        const view = this.engine.autopilotView()
        this.trackDamage(view)
        this.ask(view)
        this.plan(view)
    }

    private trackDamage(view: ShapezzAutopilotView) {
        const total = view.hp + view.shield
        if (this.lastHp >= 0 && total < this.lastHp) this.roundDamage += this.lastHp - total
        this.lastHp = total
    }

    /** Ask Laya about the current arena unless a question is already out. */
    private ask(view: ShapezzAutopilotView) {
        const now = performance.now()
        if (this.inFlight || now - this.askedAt < ASK_INTERVAL_MS || now < this.retryAt) return
        this.inFlight = true
        this.askedAt = now
        const generation = this.generation
        const done = (advice: ShapezzAutopilotAdvice | null) => {
            if (generation !== this.generation) return
            this.inFlight = false
            if (advice) {
                this.advice = advice
                this.adviceAt = performance.now()
            } else {
                // Not running, or erroring: stop spamming it and steer on instinct for a while.
                this.retryAt = performance.now() + OFFLINE_RETRY_MS
            }
            this.setStatus({ online: !!advice })
        }
        askLaya(this.layaUrl, shapezzLayaCombatQuestions(view), LAYA_TIMEOUT_MS)
            .then(answers => done(answers ? shapezzLayaCombatAdvice(answers) : null))
            .catch(() => done(null))
    }

    private plan(view: ShapezzAutopilotView) {
        const fresh = this.advice && performance.now() - this.adviceAt < ADVICE_STALE_MS
        const local = localAdvice(view)
        const advice = fresh ? blend(this.advice!, local) : local
        this.setStatus({ laya: !!fresh })
        this.onAdvice?.(advice, !!fresh)

        const orb = advice.grabHealth > 0.5 ? this.nearestHealth(view) : null
        const target = this.pickTarget(view, advice)

        let best: { move: -1 | 0 | 1, action: Action, cost: number, damage: number } | null = null
        let stay: number | null = null
        for (const move of MOVES) {
            for (const action of this.actions(view)) {
                const { cost, damage } = this.simulate(view, advice, target, orb, move, action)
                if (move === this.move && action === 'none') stay = cost
                if (!best || cost < best.cost) best = { move, action, cost, damage }
            }
        }
        if (!best) return
        // Hold the current direction unless something is clearly better, so the cube doesn't twitch.
        const keep = stay !== null && best.action === 'none' && stay <= best.cost + 2
        this.move = keep ? this.move : best.move
        this.input.move = this.move
        this.input.jump = !keep && best.action === 'jump'
        this.input.drop = !keep && best.action === 'drop'

        const dodging = shapezzIncomingShots(view, 0.35).length > 0 || best.damage > 0
        this.setStatus({ mode: dodging ? 'dodge' : orb ? 'heal' : advice.danger >= 0.7 ? 'retreat' : 'fight' })

        this.input.fire = view.enemies.length > 0
        if (target) {
            const aim = this.aimAt(view, target)
            this.input.aimX = aim.x
            this.input.aimY = aim.y
        }
    }

    private actions(view: ShapezzAutopilotView): Action[] {
        if (!view.player.onGround) return ['none']
        const feet = view.player.y + view.player.size / 2
        const onPlatform = view.platforms.some(platform => Math.abs(feet - platform.y) <= 4
            && view.player.x > platform.x && view.player.x < platform.x + platform.width)
        return onPlatform ? ['none', 'jump', 'drop'] : ['none', 'jump']
    }

    private nearestHealth(view: ShapezzAutopilotView): ShapezzAutopilotPickup | null {
        return view.pickups
            .filter(pickup => pickup.kind === 'health')
            .reduce<ShapezzAutopilotPickup | null>((best, pickup) => !best || dist(pickup, view.player) < dist(best, view.player) ? pickup : best, null)
    }

    /** The enemy to shoot: the closest threat, nudged toward the group Laya wants dead first. */
    private pickTarget(view: ShapezzAutopilotView, advice: ShapezzAutopilotAdvice) {
        const p = view.player
        const reach = view.weapon.type === 'arcCoil' ? view.weapon.chainRange : Infinity
        let best: ShapezzAutopilotEnemy | null = null
        let bestScore = -Infinity
        for (const enemy of view.enemies) {
            const d = dist(enemy, p)
            // Shapes still off-screen can't be hit yet.
            if (enemy.x < 0 || enemy.x > SHAPEZZ_ARENA.width) continue
            let score = isRammer(enemy) ? 3 * (1 - Math.min(1, d / 600)) * (enemy.type === 'dasher' ? 1.3 : 1) : enemy.type === 'boss' ? 1.5 : 1.2 + (d < 450 ? 0.5 : 0)
            score += (1 - enemy.hp) * 0.5
            if (advice.focus && shapezzTargetOf(enemy.type) === advice.focus) score += 1.5 * advice.focusConfidence
            if (d > reach) score -= 5
            if (score > bestScore) {
                bestScore = score
                best = enemy
            }
        }
        return best
    }

    /** Lead the target by the shot's travel time; mortars aim at the middle of the crowd around it. */
    private aimAt(view: ShapezzAutopilotView, target: ShapezzAutopilotEnemy) {
        let x = target.x
        let y = target.y
        if (view.weapon.type === 'launcher' && view.weapon.explosionRadius > 0) {
            const crowd = view.enemies.filter(enemy => dist(enemy, target) < view.weapon.explosionRadius * 0.6)
            x = crowd.reduce((sum, enemy) => sum + enemy.x, 0) / crowd.length
            y = crowd.reduce((sum, enemy) => sum + enemy.y, 0) / crowd.length
        }
        if (view.weapon.type === 'arcCoil') return { x, y }
        const t = dist({ x, y }, view.player) / Math.max(1, view.weapon.bulletSpeed)
        return { x: x + target.vx * t, y: y + target.vy * t }
    }

    /**
     * Fly one candidate move forward and price it. Damage from shots and
     * rammers dominates; after that the end position is scored for safe
     * zones, spawn edges, rammer spacing, weapon range and health orbs.
     */
    private simulate(
        view: ShapezzAutopilotView,
        advice: ShapezzAutopilotAdvice,
        target: ShapezzAutopilotEnemy | null,
        orb: ShapezzAutopilotPickup | null,
        move: -1 | 0 | 1,
        action: Action
    ) {
        const p = view.player
        const half = p.size / 2
        let x = p.x
        let y = p.y
        let vx = p.vx
        let vy = action === 'jump' ? -view.jumpSpeed : action === 'drop' ? Math.max(p.vy, 120) : p.vy
        let onGround = p.onGround && action === 'none'
        let damage = 0
        const hitShots = new Set<number>()
        const hitEnemies = new Set<number>()
        const shots = view.bullets.filter(bullet => dist(bullet, p) < 700)
        // Rammers home in on the cube wherever it goes, so chase the simulated cube, not where it stands now.
        const chasers = view.enemies
            .filter(enemy => isRammer(enemy) && dist(enemy, p) < 600)
            .map(enemy => ({ enemy, x: enemy.x, y: enemy.y }))

        for (let t = STEP_S; t <= HORIZON_S + 1e-9; t += STEP_S) {
            const accel = onGround ? 16 : 8
            vx += (move * view.moveSpeed - vx) * Math.min(1, STEP_S * accel)
            vy += SHAPEZZ_ARENA.gravity * STEP_S
            const prevBottom = y + half
            x = Math.min(SHAPEZZ_ARENA.width - half, Math.max(half, x + vx * STEP_S))
            y += vy * STEP_S
            onGround = false
            const dropping = action === 'drop' && t <= 0.2
            const bottom = y + half
            if (vy >= 0 && prevBottom <= SHAPEZZ_ARENA.floorY + 4 && bottom >= SHAPEZZ_ARENA.floorY) {
                y = SHAPEZZ_ARENA.floorY - half
                vy = 0
                onGround = true
            } else if (vy >= 0 && !dropping) {
                for (const platform of view.platforms) {
                    const withinX = x + p.size * 0.35 > platform.x && x - p.size * 0.35 < platform.x + platform.width
                    if (withinX && prevBottom <= platform.y + 4 && bottom >= platform.y) {
                        y = platform.y - half
                        vy = 0
                        onGround = true
                        break
                    }
                }
            }

            const urgency = 1.6 - t
            shots.forEach((shot, i) => {
                if (hitShots.has(i)) return
                if (Math.hypot(shot.x + shot.vx * t - x, shot.y + shot.vy * t - y) < shot.radius + p.size * 0.45 + 8) {
                    hitShots.add(i)
                    damage += shot.damage * urgency
                }
            })
            for (const chaser of chasers) {
                const { enemy } = chaser
                const dx = x - chaser.x
                const dy = y - chaser.y
                const d = Math.hypot(dx, dy) || 1
                // Dashers surge well past their base speed in bursts.
                const step = Math.min(d, enemy.speed * (enemy.type === 'dasher' ? 1.6 : 1) * STEP_S)
                chaser.x += dx / d * step
                chaser.y += dy / d * step
                if (hitEnemies.has(enemy.id)) continue
                if (Math.hypot(chaser.x - x, chaser.y - y) < enemy.radius + p.size * 0.48 + 10) {
                    hitEnemies.add(enemy.id)
                    damage += enemy.damage * 0.62 * urgency
                }
            }
        }

        let cost = damage / Math.max(1, view.maxHp) * 100
        const end = { x, y }

        if (advice.zones) {
            const zoneWeight = 6 + advice.danger * 10
            cost += (0.5 - advice.zones[shapezzZoneOf(end.x)]) * 2 * zoneWeight
        }
        // Everything spawns in from the side walls.
        const edge = Math.min(end.x, SHAPEZZ_ARENA.width - end.x)
        if (edge < SPAWN_EDGE) cost += (SPAWN_EDGE - edge) / SPAWN_EDGE * 10
        // Where the rammers will be by then, not where they are now: a jump that
        // only lands back on a rammer after the horizon is no escape.
        for (const chaser of chasers) {
            const d = dist(chaser, end)
            if (d < 170) cost += (170 - d) / 170 * 8 * (0.5 + advice.danger)
        }
        if (target) {
            const d = dist(target, end)
            const want = view.weapon.type === 'arcCoil' ? view.weapon.chainRange * 0.8 : view.weapon.type === 'shotgun' ? 260 : 520
            if (d > want) cost += (d - want) / 100 * (advice.danger >= 0.7 ? 1 : 4)
        }
        if (orb) cost += dist(orb, end) / 100 * 5 * advice.grabHealth
        cost += Math.abs(move) * 0.2 + (action === 'none' ? 0 : 0.3)
        return { cost, damage }
    }
}
