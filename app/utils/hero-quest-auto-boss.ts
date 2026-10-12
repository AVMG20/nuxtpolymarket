/**
 * Whether a boss should fire on its own right now.
 *
 * Pure, and its own module, because "did we just re-fight the final boss for the ninetieth time"
 * is not a thing anyone should have to discover by watching a screen. Every reason to hold is a
 * named case with a spec against it.
 *
 * ## The rule
 *
 * A boss engages automatically while `document.visibilityState` reads `visible`. That is the same
 * presence `HQ_REFRESH_INTERVAL_MS` demonstrates, so the design invariant is untouched: a
 * backgrounded tab, a closed app and an offline settle still never engage a boss, and Void Shards
 * still cannot be earned from idle time alone (`idle-mechanics.md` §5).
 *
 * ## Why it is not simply "at a gate and visible"
 *
 * Three things have to be true beyond that, and each of them is a real failure someone would
 * otherwise hit:
 *
 * 1. **The run must not already be cleared.** `nextStage` is a fixed point at World 10 Stage 10,
 *    so a won super boss leaves the run parked on the same gate with `runCleared` set. The
 *    server rejects a re-fight there (`resolveBossEngage`); holding here just avoids sending a
 *    request that can only fail.
 * 2. **The projection must have held the gate for `AUTO_ENGAGE_GRACE_KILLS`.** The client counts
 *    kills fractionally and the server floors, so the screen reaches a gate up to one kill before
 *    the server agrees. See `AUTO_ENGAGE_GRACE_KILLS`.
 * 3. **Nothing may already be in flight or on screen.** One engage at a time, and never while a
 *    replay is still playing.
 * 4. **The boss must not have just beaten the party.** A fight lost to the timer or a wipe drops the
 *    run back a stage; reaching the gate again does not re-engage it. The player does, from the
 *    stage's challenge button, when they choose to try again (`open-items.md` #38).
 */

import {
    AUTO_ENGAGE_GRACE_KILLS,
    AUTO_ENGAGE_MAX_DELAY_SECONDS,
    AUTO_ENGAGE_MIN_DELAY_SECONDS
} from '#shared/utils/hero-quest/constants'

export interface AutoEngageInput {
    /** Projected, not the payload's — the point is to fire without waiting for the next poll. */
    atBossGate: boolean
    /** `document.visibilityState === 'visible'`. The whole permission for this to happen. */
    documentVisible: boolean
    /** The World 10 super boss is already down and prestige is waiting. */
    runCleared: boolean
    /** A request is in flight. */
    engaging: boolean
    /** A replay is on screen, auto-engaged or not. */
    replayOpen: boolean
    /** Seconds the projection has continuously reported a gate. */
    secondsAtGate: number
    /** The served rate, which is what one kill of grace is worth. `null` when there is none. */
    secondsPerKill: number | null
    /** Seconds until a previously rejected engage may be retried; 0 when nothing is pending. */
    retryInSeconds: number
    /** This gate's boss beat the party last time, so it waits for the player to challenge it. */
    lostHere: boolean
}

/**
 * How long to sit at a projected gate before trusting the server to agree.
 *
 * One kill, clamped. A `secondsPerKill` of null means the party cannot kill anything, so it
 * cannot have *reached* a gate by killing either — the floor is the honest answer there, and the
 * `atBossGate` check is what actually decides that case.
 */
export function autoEngageDelaySeconds(secondsPerKill: number | null): number {
    const perKill = secondsPerKill !== null && Number.isFinite(secondsPerKill) && secondsPerKill > 0
        ? secondsPerKill
        : 0
    return Math.min(
        AUTO_ENGAGE_MAX_DELAY_SECONDS,
        Math.max(AUTO_ENGAGE_MIN_DELAY_SECONDS, perKill * AUTO_ENGAGE_GRACE_KILLS)
    )
}

export function shouldAutoEngage(input: AutoEngageInput): boolean {
    if (!input.atBossGate) return false
    if (!input.documentVisible) return false
    if (input.runCleared) return false
    if (input.engaging || input.replayOpen) return false
    if (input.retryInSeconds > 0) return false
    if (input.lostHere) return false
    return input.secondsAtGate >= autoEngageDelaySeconds(input.secondsPerKill)
}
