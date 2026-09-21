import {
    PIRATE_ENEMY_TIERS
} from '#shared/utils/gamelogic/pirates'
import {
    pirateEnemiesInReach,
    pirateHeadingOf,
    pirateKegTarget,
    pirateLayaAdvice,
    pirateLayaQuestions,
    type PirateAutopilotAdvice,
    type PirateAutopilotEnemy,
    type PirateAutopilotPoint,
    type PirateAutopilotSnapshot
} from '#shared/utils/gamelogic/pirates-autopilot'
import { WORLD_W, WORLD_H } from './constants'
import type { PirateGame } from './pirate-game'

// Auto-play for Pirate Raid. Two loops share the work:
//
// - The brain: up to ten times a second the browser asks Laya, running on the
//   player's own machine (laya_server.py), how dangerous things are, which
//   headings are open water, whether each pickup is safe and whether the keg
//   is worth throwing. One question at a time is in flight, so a slower
//   machine simply gets fewer answers a second.
// - The helm: every tick, code scores candidate spots around the ship (enemy
//   reach, blasts, mines, coast, cannon coverage) weighted by the brain's
//   latest answers, and sails to the best one. Dodging telegraphed blasts
//   lives here, since even a fast answer is too slow to react to them.
//
// Laya's judgments are blended with the helm's own read rather than trusted
// outright: measured on these questions, it ranks situations well but its 50%
// line wanders. Without fresh answers (Laya not running) the helm steers on
// its own read alone.

export type PirateAutopilotMode = 'fight' | 'kite' | 'retreat' | 'supply' | 'repair' | 'treasure' | 'dodge'

export interface PirateAutopilotStatus {
    mode: PirateAutopilotMode
    /** Latest advice came from Laya and is still fresh. */
    laya: boolean
    /** The last question reached Laya. */
    online: boolean
}

type View = PirateAutopilotSnapshot & { speed: number }

const THINK_MS = 100
/** At most ten questions a second, and never two at once. */
const ASK_INTERVAL_MS = 100
const LAYA_TIMEOUT_MS = 1000
/** How long to wait before trying again once Laya stops answering. */
const OFFLINE_RETRY_MS = 3000
const ADVICE_STALE_MS = 800
/** Share of each judgment that comes from Laya; the rest is the helm's own read. */
const LAYA_WEIGHT = 0.6
const EDGE = 60
const RINGS = [70, 150, 240]
const ANGLES = 16

const TIERS = new Map(PIRATE_ENEMY_TIERS.map(tier => [tier.id, tier]))

function dist(a: PirateAutopilotPoint, b: PirateAutopilotPoint) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

function segPointDist(a: PirateAutopilotPoint, b: PirateAutopilotPoint, p: PirateAutopilotPoint) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
    return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)
}

/** How much an enemy's broadside hurts, roughly in light-ship units. */
function enemyWeight(enemy: PirateAutopilotEnemy) {
    const tier = TIERS.get(enemy.tier)
    if (!tier) return 1
    if (tier.boss) return 5
    return Math.max(0.6, tier.maxDamage * (tier.volley ?? 1) / 14)
}

/** The helm's own read of the sea. */
function localAdvice(view: View): PirateAutopilotAdvice {
    const pressure = pirateEnemiesInReach(view.enemies, view).reduce((sum, enemy) => sum + enemyWeight(enemy), 0)
    const under = view.hazards.some(hazard => dist(hazard, view) <= hazard.r + 20)
    const danger = Math.min(1, pressure / 6 * (1.3 - view.hull) + (under ? 0.3 : 0) + (view.hull < 0.25 && pressure > 0 ? 0.5 : 0))
    const safe = (p: PirateAutopilotPoint | null) => p && pirateEnemiesInReach(view.enemies, p, 0).reduce((sum, enemy) => sum + enemyWeight(enemy), 0) < 2 ? 1 : 0
    const keg = pirateKegTarget(view.enemies)
    return {
        danger,
        heading: null,
        headingConfidence: 0,
        openWater: null,
        grabSupply: safe(view.supply),
        grabRepair: safe(view.repair),
        grabTreasure: safe(view.treasure),
        throwKeg: keg && (keg.ships >= 3 || keg.boss) ? 1 : 0
    }
}

/** Laya's answers leaned on the helm's own read. Headings are Laya's alone. */
function blend(laya: PirateAutopilotAdvice, local: PirateAutopilotAdvice): PirateAutopilotAdvice {
    const mix = (a: number, b: number) => a * LAYA_WEIGHT + b * (1 - LAYA_WEIGHT)
    return {
        ...laya,
        danger: mix(laya.danger, local.danger),
        grabSupply: mix(laya.grabSupply, local.grabSupply),
        grabRepair: mix(laya.grabRepair, local.grabRepair),
        grabTreasure: mix(laya.grabTreasure, local.grabTreasure),
        throwKeg: mix(laya.throwKeg, local.throwKeg)
    }
}

export class PirateAutopilot {
    private stopped = true
    /** Bumped on stop, so an answer to a question from before a restart is dropped. */
    private generation = 0
    private inFlight = false
    private askedAt = -Infinity
    private retryAt = 0
    private advice: PirateAutopilotAdvice | null = null
    private adviceAt = 0
    private thinkTimer = 0
    private destination: PirateAutopilotPoint | null = null
    private status: PirateAutopilotStatus = { mode: 'fight', laya: false, online: false }

    constructor(
        private game: PirateGame,
        /** Root of the local Laya API, e.g. http://127.0.0.1:8000. */
        private layaUrl: string,
        private onStatus: (status: PirateAutopilotStatus) => void,
        /** The advice steering the ship, every think tick. `laya` is false for the helm's own read. */
        private onAdvice?: (advice: PirateAutopilotAdvice, laya: boolean) => void
    ) {}

    start() {
        if (!this.stopped) return
        this.stopped = false
        this.destination = null
        this.advice = null
        this.retryAt = 0
        this.onStatus(this.status)
        this.game.setFrameHook(deltaMS => this.frame(deltaMS))
    }

    stop() {
        this.stopped = true
        this.generation += 1
        this.game.setFrameHook(null)
        this.inFlight = false
        this.setStatus({ online: false, laya: false })
    }

    private setStatus(patch: Partial<PirateAutopilotStatus>) {
        const next = { ...this.status, ...patch }
        if (next.mode === this.status.mode && next.laya === this.status.laya && next.online === this.status.online) return
        this.status = next
        this.onStatus(next)
    }

    private frame(deltaMS: number) {
        this.thinkTimer -= deltaMS
        if (this.thinkTimer > 0) return
        this.thinkTimer = THINK_MS

        const view = this.game.autopilotView()
        this.ask(view)
        this.think(view)
    }

    /** Ask Laya about the current sea unless a question is already out. */
    private ask(view: View) {
        const now = performance.now()
        if (this.inFlight || now - this.askedAt < ASK_INTERVAL_MS || now < this.retryAt) return
        this.inFlight = true
        this.askedAt = now
        const generation = this.generation
        const done = (advice: PirateAutopilotAdvice | null) => {
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
        fetch(`${this.layaUrl}/v1/systemone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions: pirateLayaQuestions(view) }),
            signal: AbortSignal.timeout(LAYA_TIMEOUT_MS)
        })
            .then(res => res.ok ? res.json() as Promise<{ answers?: Record<string, { noul?: number }> }> : null)
            .then(data => done(data?.answers ? pirateLayaAdvice(data.answers) : null))
            .catch(() => done(null))
    }

    private think(view: View) {
        const fresh = this.advice && performance.now() - this.adviceAt < ADVICE_STALE_MS
        const local = localAdvice(view)
        const advice = fresh ? blend(this.advice!, local) : local
        this.setStatus({ laya: !!fresh })
        this.onAdvice?.(advice, !!fresh)

        this.throwKeg(view, advice)

        const underBlast = view.hazards.some(hazard => dist(hazard, view) <= hazard.r + 30)
        const retreat = advice.danger >= 0.75 || view.hull < 0.25
        let goal: PirateAutopilotPoint | null = null
        let mode: PirateAutopilotMode
        if (view.repair && view.hull < 0.75 && advice.grabRepair > 0.5) {
            goal = view.repair
            mode = 'repair'
        } else if (view.supply && advice.grabSupply > 0.55 && advice.danger < 0.8) {
            goal = view.supply
            mode = 'supply'
        } else if (view.treasure && advice.grabTreasure > 0.55 && advice.danger < 0.7 && !retreat) {
            goal = view.treasure
            mode = 'treasure'
        } else if (retreat) {
            mode = 'retreat'
        } else {
            const nearest = view.enemies.reduce<PirateAutopilotEnemy | null>((best, enemy) => !best || dist(enemy, view) < dist(best, view) ? enemy : best, null)
            mode = nearest && view.range > nearest.range + 40 ? 'kite' : 'fight'
        }
        this.setStatus({ mode: underBlast ? 'dodge' : mode })

        const score = (p: PirateAutopilotPoint) => this.score(view, advice, mode, goal, p)
        const candidates: PirateAutopilotPoint[] = [{ x: view.x, y: view.y }]
        if (goal) candidates.push(goal)
        for (const r of RINGS) {
            for (let i = 0; i < ANGLES; i++) {
                const a = i / ANGLES * Math.PI * 2
                candidates.push({ x: view.x + Math.cos(a) * r, y: view.y + Math.sin(a) * r })
            }
        }

        let best: PirateAutopilotPoint | null = null
        let bestScore = -Infinity
        for (const p of candidates) {
            if (p.x < EDGE || p.y < EDGE || p.x > WORLD_W - EDGE || p.y > WORLD_H - EDGE) continue
            if (this.game.autopilotBlocked(p.x, p.y)) continue
            const s = score(p)
            if (s > bestScore) {
                best = p
                bestScore = s
            }
        }
        if (!best) return

        // Hold course unless something clearly better turns up, so the ship
        // doesn't twitch between two near-equal spots.
        const current = this.destination
        const keep = current
            && dist(current, view) > 14
            && !underBlast
            && !this.game.autopilotBlocked(current.x, current.y)
            && score(current) >= bestScore - 1
        if (keep) return
        if (current && dist(current, best) < 20) return
        this.destination = best
        this.game.autopilotSail(best.x, best.y)
    }

    /** Higher is better. Every term is in rough "one light ship's fire" units. */
    private score(view: View, advice: PirateAutopilotAdvice, mode: PirateAutopilotMode, goal: PirateAutopilotPoint | null, p: PirateAutopilotPoint) {
        let s = 0

        for (const hazard of view.hazards) {
            if (dist(hazard, p) < hazard.r + 35) s -= 1000
        }
        for (const mine of view.mines) {
            if (dist(mine, p) < 80) s -= 500
            else if (segPointDist(view, p, mine) < 60) s -= 300
        }

        const threatWeight = (mode === 'retreat' ? 5 : 2.5) * (1 + advice.danger * 1.5)
        const offenseWeight = mode === 'retreat' ? 0.3 : mode === 'fight' || mode === 'kite' ? 2 : 0.6
        for (const enemy of view.enemies) {
            const d = dist(enemy, p)
            const w = enemyWeight(enemy)
            const over = enemy.range + 40 - d
            if (over > 0) s -= threatWeight * w * Math.min(2, 0.5 + over / 100)
            // Nothing wants to sit in a ramming skiff's lap.
            if (d < 170) s -= (170 - d) / 170 * 2 * w
            if (d <= view.range * 0.92) s += offenseWeight * (1.2 - enemy.hp * 0.5) * Math.min(2, w)
        }

        // Corners are where fleets pin you.
        const edge = Math.min(p.x, p.y, WORLD_W - p.x, WORLD_H - p.y)
        if (edge < 140) s -= (140 - edge) / 140 * 3

        s -= dist(view, p) / 400

        // Laya judged every heading, so lean toward open water and away from
        // closed water, hardest when running and a little even mid-fight.
        if (advice.openWater && dist(view, p) > 1) {
            const open = advice.openWater[pirateHeadingOf(p.x - view.x, p.y - view.y)]
            const weight = mode === 'retreat' ? 4 : mode === 'kite' || advice.danger >= 0.5 ? 1.5 : 0.5
            s += (open - 0.5) * 2 * weight
        }

        if (goal) s -= dist(goal, p) / 100 * 4
        return s
    }

    private throwKeg(view: View, advice: PirateAutopilotAdvice) {
        if (!view.keg || advice.throwKeg < 0.6) return
        // Re-aim on the current sea: advice is up to a few hundred ms old.
        const target = pirateKegTarget(view.enemies)
        if (!target || (target.ships < 2 && !target.boss)) return
        this.game.autopilotCastAbility(target.x, target.y)
    }
}
