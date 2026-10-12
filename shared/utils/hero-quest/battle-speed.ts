/**
 * Battle Speed (`idle-mechanics.md` §3): a Gem-bought block of wall-clock time during which the
 * combat clock runs at 2x, 3x or 5x.
 *
 * One clock, one multiplier. Wave accrual earns more per real second, online and offline (the
 * settle dilates the boosted part of a window before offline efficiency taxes it); a boss fight is
 * a fixed 30 sim-seconds either way, so for it the boost only plays the replay back faster. Arena
 * is the one exclusion, once it exists.
 *
 * The block runs down in real time whether or not anyone is watching, so the only state is the
 * multiplier and the instant it expires. The one pause is a raid: while the run holds, the expiry
 * is pushed out by the time held (`heldBattleSpeedExpiry`).
 */

import {
    BATTLE_SPEED_ANCHOR_GEMS,
    BATTLE_SPEED_DURATIONS_MINUTES,
    BATTLE_SPEED_DURATION_STEP,
    BATTLE_SPEED_PRICE_ROUNDING,
    BATTLE_SPEED_TIERS
} from './constants'

export type BattleSpeedTier = typeof BATTLE_SPEED_TIERS[number]
export type BattleSpeedDuration = typeof BATTLE_SPEED_DURATIONS_MINUTES[number]

export function isBattleSpeedTier(value: unknown): value is BattleSpeedTier {
    return BATTLE_SPEED_TIERS.includes(value as BattleSpeedTier)
}

export function isBattleSpeedDuration(value: unknown): value is BattleSpeedDuration {
    return BATTLE_SPEED_DURATIONS_MINUTES.includes(value as BattleSpeedDuration)
}

/**
 * The Gem price of one block. Proportional on the speed axis, ×1.9 per duration step, and rounded
 * to the nearest 5 only at the end so the rounding never compounds down the chain.
 */
export function battleSpeedPrice(speed: BattleSpeedTier, minutes: BattleSpeedDuration): number {
    const steps = BATTLE_SPEED_DURATIONS_MINUTES.indexOf(minutes)
    const raw = BATTLE_SPEED_ANCHOR_GEMS * (speed / 2) * BATTLE_SPEED_DURATION_STEP ** steps
    return Math.round(raw / BATTLE_SPEED_PRICE_ROUNDING) * BATTLE_SPEED_PRICE_ROUNDING
}

/** A running block, as the row stores it. `null` multiplier or a past expiry means none. */
export interface BattleSpeedWindow {
    multiplier: number | null
    expiresAt: Date | number | null
}

function expiryMs(window: BattleSpeedWindow): number | null {
    if (window.expiresAt === null || !window.multiplier || window.multiplier <= 1) return null
    return typeof window.expiresAt === 'number' ? window.expiresAt : window.expiresAt.getTime()
}

/** The multiplier in force at `now`: the block's, or 1 once it has run out. */
export function battleSpeedAt(window: BattleSpeedWindow, now: number): number {
    const end = expiryMs(window)
    return end !== null && end > now ? window.multiplier! : 1
}

/** Seconds of the block left at `now`, 0 when none runs. */
export function battleSpeedRemainingSeconds(window: BattleSpeedWindow, now: number): number {
    const end = expiryMs(window)
    return end === null ? 0 : Math.max(0, (end - now) / 1000)
}

/**
 * The settle's input for a window that opened at `startMs`: how much of it the block covered,
 * counted from the start, since a block is always bought before the window it boosts opens (a
 * purchase settles first). `undefined` when no block overlaps it.
 */
export function speedBoostFor(window: BattleSpeedWindow, startMs: number): { multiplier: number; overlapSeconds: number } | undefined {
    const remaining = battleSpeedRemainingSeconds(window, startMs)
    return remaining > 0 ? { multiplier: window.multiplier!, overlapSeconds: remaining } : undefined
}

/** `seconds` of wall clock as combat seconds, when the first `boostedFor` of them ran at `multiplier`. */
export function dilatedSeconds(seconds: number, multiplier: number, boostedFor: number): number {
    const overlap = Math.min(Math.max(0, boostedFor), Math.max(0, seconds))
    return overlap * multiplier + (Math.max(0, seconds) - overlap)
}

/**
 * What a purchase leaves running. The same tier extends the block from its current end; a
 * different tier is refused while one runs, since a single window cannot hold two speeds and
 * replacing it would throw away time already paid for.
 */
export function extendBattleSpeed(
    window: BattleSpeedWindow,
    speed: BattleSpeedTier,
    minutes: BattleSpeedDuration,
    now: number
): { multiplier: number; expiresAt: Date } | { conflict: number } {
    const running = battleSpeedAt(window, now)
    if (running !== 1 && running !== speed) return { conflict: running }
    const from = running === 1 ? now : expiryMs(window)!
    return { multiplier: speed, expiresAt: new Date(from + minutes * 60_000) }
}

/**
 * The block's expiry once a span the run held (a raid session, `loadouts.md` §4) is taken out of
 * it: a block running at `fromMs` is pushed out by the whole span, so held time never spends it.
 * `null` when no block ran at `fromMs`, and nothing moves.
 */
export function heldBattleSpeedExpiry(window: BattleSpeedWindow, fromMs: number, toMs: number): Date | null {
    const end = expiryMs(window)
    if (end === null || end <= fromMs || toMs <= fromMs) return null
    return new Date(end + (toMs - fromMs))
}
