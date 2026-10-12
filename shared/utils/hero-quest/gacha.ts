/**
 * Shared gacha mechanics for all four systems (`gacha-shared-system.md`).
 *
 * **Written once, parameterised by `system`.** Gear, Champions, Skills and Artifacts are
 * deliberately parallel — one rarity ladder, one leveling curve, one drop table, one dupe
 * formula, one Essence ladder — so this module takes a `GachaSystem` argument rather than
 * being copied per gacha — the same reasoning that made `hqCollection` one table instead of
 * four (`tech-architecture.md` §3).
 *
 * Pure: no DB, no auth, no `#server` imports. The server calls in to decide what a pull
 * *would* produce and what a spend *would* cost; only the server applies anything.
 */

import {
    CRAFT_COST_PER_RARITY,
    DROP_RATE_TABLE,
    DUPE_LEVEL_CAP,
    DUPE_LEVEL_FACTOR,
    ESSENCE_VALUE_PER_RARITY,
    FREE_PULLS_PER_DAY,
    FREE_PULL_COOLDOWN_MINUTES,
    LEVELS_PER_STAR,
    MAX_GACHA_LEVEL,
    MAX_STAR,
    PULLS_TO_LEVEL_UP,
    RARITY_EPITHETS,
    RARITY_STAT_MULTIPLIERS,
    SEAL_LADDER_BASE_GOLD,
    SEAL_LADDER_GROWTH,
    SINGLE_PULL_COST,
    TEN_PULL_COST,
    TEN_PULL_SIZE
} from './constants'
import type { Rarity } from './types'

/**
 * The shared 6-tier rarity ladder, in ascending order (`gacha-shared-system.md` §1).
 *
 * Lives here rather than in `content/champions.ts` because it belongs to all four gachas, not
 * to Champions. Content depends on mechanics, never the other way round.
 */
export const RARITIES: readonly Rarity[] = [
    'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'
]

/**
 * Flat power multiplier by rarity — Common 1.0 → Mythic 2.5.
 *
 * Read by Champions (`champions-guild-gacha.md` §2), Gear (`gear-equipment.md` §2) and
 * Artifacts, so it is not Champion content. Keyed off the ordered ladder above so the constants
 * file holds a plain array and the rarity→value mapping exists in exactly one place.
 *
 * ⚠ **Adjacent tiers must stay under `RARITY_ADJACENT_RATIO_CEILING`** — Gear's Rarity
 * Progression Guarantee. The worst adjacent ratio today is 1.25×; `content.spec.ts` asserts it.
 */
export const RARITY_STAT_MULTIPLIER: Readonly<Record<Rarity, number>> = Object.fromEntries(
    RARITIES.map((rarity, index) => [rarity, RARITY_STAT_MULTIPLIERS[index]!])
) as Record<Rarity, number>

/**
 * The rarity epithet ladder from `champions-guild-gacha.md` §5.
 *
 * Shared rather than Champion content: Gear's entire 36-piece roster is *named* by it
 * (`gear-equipment.md` §1 — "`<Rarity Epithet> <Slot Name>`").
 */
export const RARITY_EPITHET: Readonly<Record<Rarity, string>> = Object.fromEntries(
    RARITIES.map((rarity, index) => [rarity, RARITY_EPITHETS[index]!])
) as Record<Rarity, string>

/**
 * Effect lines by rarity — 1 / 1 / 1 / 2 / 2 / 3.
 *
 * Three systems state this same table independently: Champions as *ability count* (§2), Skills
 * as *effect-line count* (`skills-gacha.md` §3), Artifacts as *effect-line count*
 * (`artifacts-dig-site-gacha.md` §3). One table, three readings. Gear is the deliberate
 * exception — single-stat-only, always, so rarity scales magnitude and never adds a line.
 */
export const RARITY_EFFECT_LINES: Readonly<Record<Rarity, number>> = {
    common: 1,
    uncommon: 1,
    rare: 1,
    epic: 2,
    legendary: 2,
    mythic: 3
}

/** The `system` enum over `hqCollection.contentId`. */
export type GachaSystem = 'gear' | 'champion' | 'skill' | 'artifact'

export const GACHA_SYSTEMS: readonly GachaSystem[] = ['gear', 'champion', 'skill', 'artifact']

export function isGachaSystem(value: string): value is GachaSystem {
    return (GACHA_SYSTEMS as readonly string[]).includes(value)
}

export function rarityIndex(rarity: Rarity): number {
    const index = RARITIES.indexOf(rarity)
    if (index < 0) throw new Error(`Unknown rarity: ${rarity}`)
    return index
}

// ── Gacha leveling ─────────────────────────────────────  §2

export function clampGachaLevel(level: number): number {
    return Math.min(MAX_GACHA_LEVEL, Math.max(1, Math.floor(level)))
}

/** Pulls still owed to reach the next level, or `null` at the cap. */
export function pullsToNextLevel(level: number): number | null {
    const current = clampGachaLevel(level)
    if (current >= MAX_GACHA_LEVEL) return null
    return PULLS_TO_LEVEL_UP[current] ?? null
}

/**
 * Absorb `pulls` into a gacha's level and progress.
 *
 * Leveling tracks **pulls granted, not currency spent** (§4) — which is why a 10-pull costs 9
 * Seals but advances the counter by 10. Loops rather than solving in closed form because the
 * thresholds are a table, not a curve, and there are only ever 9 of them.
 */
export function applyPulls(level: number, progress: number, pulls: number): { level: number; progress: number } {
    let currentLevel = clampGachaLevel(level)
    let currentProgress = Math.max(0, Math.floor(progress)) + Math.max(0, Math.floor(pulls))

    for (;;) {
        const needed = pullsToNextLevel(currentLevel)
        if (needed === null || currentProgress < needed) break
        currentProgress -= needed
        currentLevel++
    }

    // At the cap there is nothing left to spend progress on, so it stops accumulating.
    if (currentLevel >= MAX_GACHA_LEVEL) return { level: MAX_GACHA_LEVEL, progress: 0 }
    return { level: currentLevel, progress: currentProgress }
}

// ── Drop table ─────────────────────────────────────────  §3

/** The rarity weights for a gacha level, as percentages that sum to 100. */
export function dropRatesFor(level: number): readonly number[] {
    const row = DROP_RATE_TABLE[clampGachaLevel(level)]
    if (!row) throw new Error(`No drop table row for gacha level ${level}`)
    return row
}

/**
 * Pick a rarity from a gacha level's drop table, given a uniform roll in `[0, 1)`.
 *
 * Takes the roll rather than generating it: this is pure shared code, and the entropy has to
 * come from the server's CSPRNG (`randomFloat`). Never `Math.random()` — this decides an
 * outcome that pays out real collection value.
 */
export function rarityFromRoll(level: number, roll: number): Rarity {
    const rates = dropRatesFor(level)
    const target = Math.min(1, Math.max(0, roll)) * 100
    let cumulative = 0
    for (let index = 0; index < rates.length; index++) {
        cumulative += rates[index] ?? 0
        if (target < cumulative) return RARITIES[index]!
    }
    // Float slop at the very top of the range: fall back to the last rarity with real weight
    // rather than off the end of the array.
    for (let index = rates.length - 1; index >= 0; index--) {
        if ((rates[index] ?? 0) > 0) return RARITIES[index]!
    }
    return RARITIES[0]!
}

/**
 * The drop table assumes every roster populates all six rarities, and `content.spec.ts` asserts
 * that per system. If a future roster ships with gaps, repair a roll by folding **down** to the
 * nearest populated rarity: picking uniformly from whatever exists inverts the curve and can pay
 * far better than the roll earned.
 */

// ── Pull cost ──────────────────────────────────────────  §4

export interface PullCost {
    /** Seals actually spent. */
    seals: number
    /** Pulls granted, which is what gacha leveling counts. */
    pulls: number
}

export function pullCost(count: number): PullCost {
    if (count === TEN_PULL_SIZE) return { seals: TEN_PULL_COST, pulls: TEN_PULL_SIZE }
    const pulls = Math.max(1, Math.floor(count))
    return { seals: pulls * SINGLE_PULL_COST, pulls }
}

/**
 * Gold price of the next extra Seal bought today for one gacha (`gold-economy.md` §7).
 *
 * `boughtToday` is that gacha's own counter — the four ladders are independent, so buying
 * Champion pulls today never moves the price of Skill pulls.
 */
export function sealLadderPrice(system: GachaSystem, boughtToday: number): number {
    const growth = SEAL_LADDER_GROWTH[system] ?? 1
    return Math.round(SEAL_LADDER_BASE_GOLD * Math.pow(growth, Math.max(0, Math.floor(boughtToday))))
}

/**
 * The day key the ladder's counters reset on, as `YYYY-MM-DD` in UTC.
 *
 * A plain string compared for equality, deliberately — not a timestamp. Postgres keeps
 * microseconds and a JS `Date` only milliseconds, so a compare-and-swap on a timestamp column
 * matches zero rows and fails closed forever (the platform guidance's standing warning). A
 * date key has no such trap, and "did the day roll over" is all this needs to answer.
 *
 * UTC rather than server-local so the reset does not move when the host's zone does.
 */
export function ladderDateKey(now: number | Date = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10)
}

/** First instant of the next UTC day — when every daily counter in the game rolls over. */
export function nextDayResetAt(now: number = Date.now()): number {
    return Date.UTC(
        new Date(now).getUTCFullYear(),
        new Date(now).getUTCMonth(),
        new Date(now).getUTCDate() + 1
    )
}

export interface FreePullState {
    /** How many of today's free 10-pulls are already spent, after the day-rollover reset. */
    used: number
    remaining: number
    /** True when one can be taken right now. */
    available: boolean
    /**
     * When the next one becomes takeable, ms epoch — **null exactly when `available` is true.**
     *
     * One value rather than separate cooldown and reset fields, because the client only ever
     * asks "when can I pull again" and answering it needs both: today's allowance can be spent
     * while the cooldown is also still running, and the later of the two is what actually gates.
     */
    unlocksAt: number | null
}

/**
 * Whether a free 10-pull is available for one gacha, and when the next one is.
 *
 * Pure, so the countdown the client renders and the check the server enforces are the same
 * function rather than two implementations that drift. The server still owns the decision — this
 * being pure is what makes it *shareable*, not what makes it trusted.
 *
 * Two independent gates, and both have to pass:
 *
 * - **The daily allowance**, keyed on a `YYYY-MM-DD` string exactly like the Gold ladder. A
 *   stored counter from a previous day reads as zero rather than being migrated, so nothing has
 *   to run at midnight — the same reason the ladder does it this way.
 * - **The cooldown since the last claim**, which deliberately carries *across* the day boundary.
 *   Claiming at 23:59 does not hand you another at 00:00; the gap is always the full interval,
 *   which is what stops the reset being farmable by timing.
 */
export function freePullState(
    usedToday: number,
    dateKey: string | null,
    lastClaimedAtMs: number | null,
    now: number = Date.now()
): FreePullState {
    const used = dateKey === ladderDateKey(now) ? Math.max(0, Math.floor(usedToday)) : 0
    const remaining = Math.max(0, FREE_PULLS_PER_DAY - used)

    const readyAt = lastClaimedAtMs === null
        ? 0
        : lastClaimedAtMs + FREE_PULL_COOLDOWN_MINUTES * 60_000

    if (remaining > 0 && now >= readyAt) {
        return { used, remaining, available: true, unlocksAt: null }
    }

    // Out of allowance waits for the rollover; in-allowance waits for the cooldown. When both
    // are pending the later one gates, which is why this is a max rather than a branch.
    const unlocksAt = remaining > 0 ? readyAt : Math.max(nextDayResetAt(now), readyAt)
    return { used, remaining, available: false, unlocksAt }
}

/**
 * Total Gold to buy `count` Seals in one go, given how many were already bought today.
 *
 * Each unit is priced at its own rung — buying 5 at once must cost exactly what buying them
 * one at a time would, or the bulk path becomes a discount nobody designed.
 */
export function sealLadderTotal(system: GachaSystem, boughtToday: number, count: number): number {
    let total = 0
    for (let index = 0; index < Math.max(0, Math.floor(count)); index++) {
        total += sealLadderPrice(system, boughtToday + index)
    }
    return total
}

// ── Duplicates, levels and stars ───────────────────────  §6

export interface CollectionEntry {
    /** 0–5. Everything starts at 0★. */
    star: number
    /** 1–10 within the current star, resets to 1 on star-up. */
    level: number
    /** Duplicates banked toward the next level. */
    dupeProgress: number
}

export function newEntry(): CollectionEntry {
    return { star: 0, level: 1, dupeProgress: 0 }
}

export function isMaxed(entry: CollectionEntry): boolean {
    return entry.star >= MAX_STAR && entry.level >= LEVELS_PER_STAR
}

/**
 * dupesToLevelUp(star, level) = round(min((star × 10 + level) × 1.618, 20))
 *
 * The same `star × 10 + level` scalar that drives investment multipliers and the §7 passive —
 * one "how strong is this specific copy" number across every use, rather than three curves.
 */
export function dupesToLevelUp(star: number, level: number): number {
    return Math.round(Math.min(investmentScalar(star, level) * DUPE_LEVEL_FACTOR, DUPE_LEVEL_CAP))
}

/** `star × 10 + level`: 1 at 0★/Lv1, 60 at 5★/Lv10. */
export function investmentScalar(star: number, level: number): number {
    return star * LEVELS_PER_STAR + level
}

export interface DupeOutcome {
    entry: CollectionEntry
    /** Levels gained across this application. */
    levelsGained: number
    /** Stars gained across this application. */
    starsGained: number
    /** Essence produced by dupes that landed on an already-maxed copy. */
    essenceGained: number
}

/**
 * Apply `count` duplicates to an owned copy.
 *
 * Once maxed (5★ Lv10) further duplicates auto-convert to Essence instead of being wasted —
 * the reason none of the four gachas needs a pity counter (§5). Handles the boundary in one
 * pass, so a 10-pull that maxes a copy partway through converts only the genuine remainder.
 */
export function applyDupes(entry: CollectionEntry, count: number, rarity: Rarity): DupeOutcome {
    let current: CollectionEntry = { ...entry }
    let remaining = Math.max(0, Math.floor(count))
    let levelsGained = 0
    let starsGained = 0
    let essenceGained = 0

    while (remaining > 0) {
        if (isMaxed(current)) {
            essenceGained += remaining * essenceValueFor(rarity)
            remaining = 0
            break
        }

        const needed = dupesToLevelUp(current.star, current.level) - current.dupeProgress
        if (remaining < needed) {
            current = { ...current, dupeProgress: current.dupeProgress + remaining }
            remaining = 0
            break
        }

        remaining -= needed
        if (current.level >= LEVELS_PER_STAR) {
            current = { star: current.star + 1, level: 1, dupeProgress: 0 }
            starsGained++
            levelsGained++
        } else {
            current = { ...current, level: current.level + 1, dupeProgress: 0 }
            levelsGained++
        }
    }

    return { entry: current, levelsGained, starsGained, essenceGained }
}

/** Total duplicates to take a copy from scratch to 5★ Lv10. The doc's figure is 1,066. */
export function totalDupesToMax(): number {
    let total = 0
    for (let star = 0; star <= MAX_STAR; star++) {
        for (let level = 1; level <= LEVELS_PER_STAR; level++) {
            if (star === MAX_STAR && level === LEVELS_PER_STAR) break
            total += dupesToLevelUp(star, level)
        }
    }
    return total
}

// ── Essence and crafting ───────────────────────────────  §6

export function essenceValueFor(rarity: Rarity): number {
    return ESSENCE_VALUE_PER_RARITY[rarityIndex(rarity)] ?? 0
}

export function craftCostFor(rarity: Rarity): number {
    return CRAFT_COST_PER_RARITY[rarityIndex(rarity)] ?? 0
}
