import {
    SHAPEZZ_ARENA,
    shapezzLayaBias,
    shapezzLayaCalibrationQuestions,
    shapezzLayaCheckpointQuestions,
    shapezzLayaDecision,
    shapezzLayaQuestions,
    shapezzLayaUpgrade,
    type ShapezzAutopilotAction,
    type ShapezzAutopilotEnemy,
    type ShapezzAutopilotView,
    type ShapezzCheckpointContext,
    type ShapezzLayaDecision
} from '#shared/utils/gamelogic/shapezz-autopilot'
import type { ShapezzRunUpgradeId } from '#shared/utils/gamelogic/shapezz'
import type { ShapezzAutopilotInput, ShapezzEngine } from './shapezz-engine'

// Auto-play for SHAPEZZ, played by Laya on the player's own machine
// (laya_server.py). Up to ten times a second the arena is described to Laya,
// and Laya decides the move and the target. This class only carries those
// decisions out: it holds the chosen direction, presses jump or drop once when
// Laya picks them, and aims at the enemy Laya chose, leading it by the shot's
// travel time. It makes no decisions of its own. When Laya's last answer is
// stale or Laya is down, the cube stands still and holds fire.

export interface ShapezzAutopilotStatus {
    /** Laya's latest decision is fresh and being carried out. */
    laya: boolean
    /** The last question reached Laya. */
    online: boolean
    /** The move being carried out, or null while waiting for Laya. */
    action: ShapezzAutopilotAction | null
}

const APPLY_MS = 50
/** At most ten questions a second, and never two at once. */
const ASK_INTERVAL_MS = 100
const LAYA_TIMEOUT_MS = 1000
const CHECKPOINT_TIMEOUT_MS = 2500
/** How long to wait before asking again once Laya stops answering. */
const OFFLINE_RETRY_MS = 1000
/** An older decision describes an arena that has moved on; stop acting on it. */
const DECISION_STALE_MS = 500

function dist(a: { x: number, y: number }, b: { x: number, y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y)
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
    private decision: ShapezzLayaDecision | null = null
    private decisionAt = 0
    /** Jump and drop are pressed once per decision, not held. */
    private pressed = false
    private applyTimer = 0
    private input: ShapezzAutopilotInput = { move: 0, jump: false, drop: false, aimX: SHAPEZZ_ARENA.width / 2, aimY: SHAPEZZ_ARENA.height / 2, fire: false }
    private lastHp = -1
    /** Laya's lean toward left or right, measured once per session; see shapezzLayaCalibrationQuestions. */
    private bias: Record<string, number> | null = null
    private roundDamage = 0
    private status: ShapezzAutopilotStatus = { laya: false, online: false, action: null }

    constructor(
        private engine: ShapezzEngine,
        /** Root of the local Laya API, e.g. http://127.0.0.1:8000. */
        private layaUrl: string,
        private onStatus: (status: ShapezzAutopilotStatus) => void,
        /** Laya's latest decision, whenever a new one arrives. */
        private onDecision?: (decision: ShapezzLayaDecision) => void
    ) {}

    start() {
        if (!this.stopped) return
        this.stopped = false
        this.decision = null
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
        this.setStatus({ online: false, laya: false, action: null })
    }

    /** Hull and shield lost since the last checkpoint, as a share of max hull. */
    damageThisRound(maxHp: number) {
        return this.roundDamage / Math.max(1, maxHp)
    }

    /** Ask Laya which mutation to take. Null when Laya is down or gave no usable answer. */
    async decideUpgrade(ctx: ShapezzCheckpointContext): Promise<ShapezzRunUpgradeId | null> {
        let answers = null
        try {
            answers = await askLaya(this.layaUrl, shapezzLayaCheckpointQuestions(ctx), CHECKPOINT_TIMEOUT_MS)
        } catch {
            answers = null
        }
        this.setStatus({ online: !!answers })
        const upgrade = answers ? shapezzLayaUpgrade(ctx.offers, answers) : null
        if (upgrade) this.roundDamage = 0
        return upgrade
    }

    private setStatus(patch: Partial<ShapezzAutopilotStatus>) {
        const next = { ...this.status, ...patch }
        if (next.laya === this.status.laya && next.online === this.status.online && next.action === this.status.action) return
        this.status = next
        this.onStatus(next)
    }

    private frame(dt: number) {
        this.input.jump = false
        this.input.drop = false
        this.applyTimer -= dt * 1000
        if (this.applyTimer > 0) return
        this.applyTimer = APPLY_MS

        const view = this.engine.autopilotView()
        this.trackDamage(view)
        this.ask(view)
        this.apply(view)
    }

    private trackDamage(view: ShapezzAutopilotView) {
        const total = view.hp + view.shield
        if (this.lastHp >= 0 && total < this.lastHp) this.roundDamage += this.lastHp - total
        this.lastHp = total
    }

    /** Describe the arena to Laya unless a question is already out. */
    private ask(view: ShapezzAutopilotView) {
        const now = performance.now()
        if (this.inFlight || now - this.askedAt < ASK_INTERVAL_MS || now < this.retryAt) return
        this.inFlight = true
        this.askedAt = now
        const generation = this.generation
        const done = (decision: ShapezzLayaDecision | null) => {
            if (generation !== this.generation) return
            this.inFlight = false
            if (decision) {
                this.decision = decision
                this.decisionAt = performance.now()
                this.pressed = false
                this.onDecision?.(decision)
            } else {
                this.retryAt = performance.now() + OFFLINE_RETRY_MS
            }
            this.setStatus({ online: !!decision })
        }
        if (!this.bias) {
            // First contact: measure Laya's left/right bias before acting on any of its answers.
            askLaya(this.layaUrl, shapezzLayaCalibrationQuestions(), LAYA_TIMEOUT_MS)
                .then((answers) => {
                    if (generation !== this.generation) return
                    this.inFlight = false
                    this.bias = answers ? shapezzLayaBias(answers) : null
                    if (!this.bias) this.retryAt = performance.now() + OFFLINE_RETRY_MS
                    this.setStatus({ online: !!answers })
                })
                .catch(() => done(null))
            return
        }
        const bias = this.bias
        askLaya(this.layaUrl, shapezzLayaQuestions(view), LAYA_TIMEOUT_MS)
            .then(answers => done(answers ? shapezzLayaDecision(view, answers, bias) : null))
            .catch(() => done(null))
    }

    /** Carry out Laya's latest decision, or stand still without one. */
    private apply(view: ShapezzAutopilotView) {
        const decision = this.decision && performance.now() - this.decisionAt < DECISION_STALE_MS ? this.decision : null
        this.setStatus({ laya: !!decision, action: decision?.action ?? null })
        if (!decision) {
            this.input.move = 0
            this.input.fire = false
            return
        }

        const action = decision.action
        this.input.move = action === 'left' ? -1 : action === 'right' ? 1 : 0
        if (!this.pressed && (action === 'jump' || action === 'drop')) {
            this.input.jump = action === 'jump'
            this.input.drop = action === 'drop'
            this.pressed = true
        }

        const target = view.enemies.find(enemy => enemy.id === decision.targetId)
        this.input.fire = !!target
        if (target) {
            const aim = this.aimAt(view, target)
            this.input.aimX = aim.x
            this.input.aimY = aim.y
        }
    }

    /** Point the gun at Laya's target, leading it by the shot's travel time. */
    private aimAt(view: ShapezzAutopilotView, target: ShapezzAutopilotEnemy) {
        if (view.weapon.type === 'arcCoil' || view.weapon.type === 'railgun') return { x: target.x, y: target.y }
        const t = dist(target, view.player) / Math.max(1, view.weapon.bulletSpeed)
        return { x: target.x + target.vx * t, y: target.y + target.vy * t }
    }
}
