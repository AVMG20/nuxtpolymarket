import {
    pirateHeadingAngle,
    pirateLayaBias,
    pirateLayaCalibrationQuestions,
    pirateLayaDecision,
    pirateLayaQuestions,
    type PirateAutopilotHeading,
    type PirateAutopilotMove,
    type PirateAutopilotSnapshot,
    type PirateLayaDecision
} from '#shared/utils/gamelogic/pirates-autopilot'
import { WORLD_W, WORLD_H } from './constants'
import type { PirateGame } from './pirate-game'

// Auto-play for Pirate Raid, played by Laya on the player's own machine
// (laya_server.py). Up to ten times a second the sea is described to Laya,
// and Laya decides the move (a heading, a pickup, or an enemy to attack) and
// whether and where to throw the keg. This class only carries those decisions
// out through the same orders a player gives with the mouse. It makes no
// decisions of its own. When Laya's last answer is stale or Laya is down, the
// ship heaves to; its cannons keep firing on their own, as they always do.

export interface PirateAutopilotStatus {
    /** Laya's latest decision is fresh and being carried out. */
    laya: boolean
    /** The last question reached Laya. */
    online: boolean
    /** The move being carried out, or null while waiting for Laya. */
    move: PirateAutopilotMove | null
}

type View = PirateAutopilotSnapshot & { speed: number }

const APPLY_MS = 100
/** At most ten questions a second, and never two at once. */
const ASK_INTERVAL_MS = 100
const LAYA_TIMEOUT_MS = 1000
/** How long to wait before asking again once Laya stops answering. */
const OFFLINE_RETRY_MS = 1000
/** An older decision describes a sea that has moved on; stop acting on it. */
const DECISION_STALE_MS = 600
/** How far ahead to set the waypoint when Laya picks a heading. */
const HEADING_REACH = 220
const EDGE = 60

async function askLaya(url: string, questions: object) {
    const res = await fetch(`${url}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
        signal: AbortSignal.timeout(LAYA_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const data = await res.json() as { answers?: Record<string, { noul?: number, choice?: string }> }
    return data.answers ?? null
}

function sameMove(a: PirateAutopilotMove | null, b: PirateAutopilotMove | null) {
    return JSON.stringify(a) === JSON.stringify(b)
}

export class PirateAutopilot {
    private stopped = true
    /** Bumped on stop, so an answer to a question from before a restart is dropped. */
    private generation = 0
    private inFlight = false
    private askedAt = -Infinity
    private retryAt = 0
    private decision: PirateLayaDecision | null = null
    private decisionAt = 0
    /** Each keg decision is thrown once. */
    private kegThrown = false
    private applied: PirateAutopilotMove | null = null
    /** Laya's lean toward some headings, measured once per session; see pirateLayaCalibrationQuestions. */
    private bias: Record<string, number> | null = null
    private applyTimer = 0
    private status: PirateAutopilotStatus = { laya: false, online: false, move: null }

    constructor(
        private game: PirateGame,
        /** Root of the local Laya API, e.g. http://127.0.0.1:8000. */
        private layaUrl: string,
        private onStatus: (status: PirateAutopilotStatus) => void,
        /** Laya's latest decision, whenever a new one arrives. */
        private onDecision?: (decision: PirateLayaDecision) => void
    ) {}

    start() {
        if (!this.stopped) return
        this.stopped = false
        this.decision = null
        this.applied = null
        this.retryAt = 0
        this.onStatus(this.status)
        this.game.setFrameHook(deltaMS => this.frame(deltaMS))
    }

    stop() {
        this.stopped = true
        this.generation += 1
        this.inFlight = false
        this.game.setFrameHook(null)
        this.setStatus({ online: false, laya: false, move: null })
    }

    private setStatus(patch: Partial<PirateAutopilotStatus>) {
        const next = { ...this.status, ...patch }
        if (next.laya === this.status.laya && next.online === this.status.online && sameMove(next.move, this.status.move)) return
        this.status = next
        this.onStatus(next)
    }

    private frame(deltaMS: number) {
        this.applyTimer -= deltaMS
        if (this.applyTimer > 0) return
        this.applyTimer = APPLY_MS

        const view = this.game.autopilotView()
        this.ask(view)
        this.apply(view)
    }

    /** Describe the sea to Laya unless a question is already out. */
    private ask(view: View) {
        const now = performance.now()
        if (this.inFlight || now - this.askedAt < ASK_INTERVAL_MS || now < this.retryAt) return
        this.inFlight = true
        this.askedAt = now
        const generation = this.generation
        const { speed: _speed, ...snap } = view
        const done = (decision: PirateLayaDecision | null) => {
            if (generation !== this.generation) return
            this.inFlight = false
            if (decision) {
                this.decision = decision
                this.decisionAt = performance.now()
                this.kegThrown = false
                this.onDecision?.(decision)
            } else {
                this.retryAt = performance.now() + OFFLINE_RETRY_MS
            }
            this.setStatus({ online: !!decision })
        }
        if (!this.bias) {
            // First contact: measure Laya's heading bias before acting on any of its answers.
            askLaya(this.layaUrl, pirateLayaCalibrationQuestions())
                .then((answers) => {
                    if (generation !== this.generation) return
                    this.inFlight = false
                    this.bias = answers ? pirateLayaBias(answers) : null
                    if (!this.bias) this.retryAt = performance.now() + OFFLINE_RETRY_MS
                    this.setStatus({ online: !!answers })
                })
                .catch(() => done(null))
            return
        }
        const bias = this.bias
        askLaya(this.layaUrl, pirateLayaQuestions(snap))
            .then(answers => done(answers ? pirateLayaDecision(snap, answers, bias) : null))
            .catch(() => done(null))
    }

    /** Carry out Laya's latest decision, or heave to without one. */
    private apply(view: View) {
        const decision = this.decision && performance.now() - this.decisionAt < DECISION_STALE_MS ? this.decision : null
        this.setStatus({ laya: !!decision, move: decision?.move ?? null })
        if (!decision?.move) {
            if (this.applied !== null) this.game.autopilotHeaveTo()
            this.applied = null
            return
        }

        if (decision.keg && !this.kegThrown) {
            this.kegThrown = this.game.autopilotCastAbility(decision.keg.x, decision.keg.y)
        }

        const move = decision.move
        if (move.kind === 'attack') {
            // Re-issuing the attack order every tick would restart the chase; give it once per new target.
            if (!sameMove(this.applied, move) && this.game.autopilotAttack(move.enemyId)) this.applied = move
            return
        }
        const goal = move.kind === 'grab' ? view[move.pickup] : this.headingGoal(view, move.heading)
        if (!goal) return
        // Heading waypoints move with the ship, so they are refreshed every tick.
        this.game.autopilotSail(goal.x, goal.y)
        this.applied = move
    }

    /** A waypoint a short way along the heading Laya picked, kept inside the map. */
    private headingGoal(view: View, heading: PirateAutopilotHeading) {
        const angle = pirateHeadingAngle(heading)
        return {
            x: Math.min(WORLD_W - EDGE, Math.max(EDGE, view.x + Math.cos(angle) * HEADING_REACH)),
            y: Math.min(WORLD_H - EDGE, Math.max(EDGE, view.y + Math.sin(angle) * HEADING_REACH))
        }
    }
}
