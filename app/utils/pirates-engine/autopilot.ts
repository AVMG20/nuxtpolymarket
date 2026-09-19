import {
    PIRATE_ENEMY_TIERS
} from '#shared/utils/gamelogic/pirates'
import {
    pirateEnemiesInReach,
    pirateHeadingAngle,
    pirateKegTarget,
    type PirateAutopilotAdvice,
    type PirateAutopilotEnemy,
    type PirateAutopilotPoint,
    type PirateAutopilotSnapshot
} from '#shared/utils/gamelogic/pirates-autopilot'
import { WORLD_W, WORLD_H } from './constants'
import type { PirateGame } from './pirate-game'

// Auto-play for Pirate Raid. Two loops share the work:
//
// - The brain: a few times a second the sea is sent over a socket, and the
//   server asks Jev how dangerous things are, which heading is open water,
//   whether each pickup is safe and whether the keg is worth throwing.
// - The helm: every frame-ish, code scores candidate spots around the ship
//   (enemy reach, blasts, mines, coast, cannon coverage) weighted by the
//   brain's latest answers, and sails to the best one. Dodging telegraphed
//   blasts lives here, since a socket round trip is too slow to react to them.
//
// Without fresh advice (socket down, Jev unavailable) the helm judges the same
// things itself, just less carefully.

export type PirateAutopilotMode = 'fight' | 'kite' | 'retreat' | 'supply' | 'repair' | 'treasure' | 'dodge'

export interface PirateAutopilotStatus {
    mode: PirateAutopilotMode
    /** Latest advice came from Jev and is still fresh. */
    jev: boolean
    connected: boolean
}

type View = PirateAutopilotSnapshot & { speed: number }

const THINK_MS = 120
const ADVICE_STALE_MS = 1500
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

/** The helm's own read of the sea when Jev has nothing fresh to say. */
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
        grabSupply: safe(view.supply),
        grabRepair: safe(view.repair),
        grabTreasure: safe(view.treasure),
        throwKeg: keg && (keg.ships >= 3 || keg.boss) ? 1 : 0
    }
}

export class PirateAutopilot {
    private ws: WebSocket | null = null
    private stopped = true
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectDelayMs = 1000
    private seq = 0
    private inFlight = false
    private sentAt = 0
    private advice: PirateAutopilotAdvice | null = null
    private adviceAt = 0
    private thinkTimer = 0
    private destination: PirateAutopilotPoint | null = null
    private status: PirateAutopilotStatus = { mode: 'fight', jev: false, connected: false }

    constructor(
        private game: PirateGame,
        private onStatus: (status: PirateAutopilotStatus) => void,
        /** The advice steering the ship, every think tick. `jev` is false for the helm's own read. */
        private onAdvice?: (advice: PirateAutopilotAdvice, jev: boolean) => void
    ) {}

    start() {
        if (!this.stopped) return
        this.stopped = false
        this.destination = null
        this.advice = null
        this.onStatus(this.status)
        this.game.setFrameHook(deltaMS => this.frame(deltaMS))
        this.connect()
    }

    stop() {
        this.stopped = true
        this.game.setFrameHook(null)
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        this.ws?.close()
        this.ws = null
        this.inFlight = false
        this.setStatus({ connected: false, jev: false })
    }

    private connect() {
        if (this.stopped) return
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(`${proto}://${location.host}/api/pirates/autopilot`)
        this.ws = ws
        ws.onopen = () => {
            this.reconnectDelayMs = 1000
            this.inFlight = false
            this.setStatus({ connected: true })
        }
        ws.onmessage = (event) => {
            let data: { seq?: number, advice?: PirateAutopilotAdvice | null, skipped?: boolean }
            try {
                data = JSON.parse(event.data as string)
            } catch {
                return
            }
            if (data.seq !== this.seq) return
            this.inFlight = false
            if (data.advice) {
                this.advice = data.advice
                this.adviceAt = performance.now()
            }
        }
        ws.onclose = (event) => {
            if (this.ws !== ws) return
            this.ws = null
            this.inFlight = false
            this.setStatus({ connected: false })
            // Signed out, not allowed, or auto-play took over in another tab: stay down.
            if (this.stopped || event.code === 4401 || event.code === 4403 || event.code === 4409) return
            this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs)
            this.reconnectDelayMs = Math.min(10_000, this.reconnectDelayMs * 2)
        }
    }

    private setStatus(patch: Partial<PirateAutopilotStatus>) {
        const next = { ...this.status, ...patch }
        if (next.mode === this.status.mode && next.jev === this.status.jev && next.connected === this.status.connected) return
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

    /** Send the sea for fresh advice unless a question is already out. */
    private ask(view: View) {
        const now = performance.now()
        // A lost reply must not stall the brain forever.
        if (this.inFlight && now - this.sentAt < 3000) return
        if (this.ws?.readyState !== WebSocket.OPEN) return
        const { speed: _speed, ...snap } = view
        this.seq += 1
        this.inFlight = true
        this.sentAt = now
        this.ws.send(JSON.stringify({ seq: this.seq, snap }))
    }

    private think(view: View) {
        const fresh = this.advice && performance.now() - this.adviceAt < ADVICE_STALE_MS
        const advice = fresh ? this.advice! : localAdvice(view)
        this.setStatus({ jev: !!fresh })
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

        if (advice.heading && (mode === 'retreat' || mode === 'kite' || advice.danger >= 0.5)) {
            const moved = dist(view, p)
            if (moved > 1) {
                const a = pirateHeadingAngle(advice.heading)
                const cos = ((p.x - view.x) * Math.cos(a) + (p.y - view.y) * Math.sin(a)) / moved
                s += cos * advice.headingConfidence * (mode === 'retreat' ? 4 : 1.5)
            }
        }

        if (goal) s -= dist(goal, p) / 100 * 4
        return s
    }

    private throwKeg(view: View, advice: PirateAutopilotAdvice) {
        if (!view.keg || advice.throwKeg < 0.6) return
        // Re-aim on the current sea: advice is a few hundred ms old.
        const target = pirateKegTarget(view.enemies)
        if (!target || (target.ships < 2 && !target.boss)) return
        this.game.autopilotCastAbility(target.x, target.y)
    }
}
