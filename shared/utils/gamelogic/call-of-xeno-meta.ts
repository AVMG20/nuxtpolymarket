// Call of Xeno — account meta-progression: permanent upgrades, difficulty
// tiers and the run-payout model.
//
// Shared verbatim by the client (shop UI, in-run effects, payout preview)
// and the server (authoritative costs, unlock gates, payout ceiling). The
// ceiling function here is the whole anti-cheat story for payouts: a run can
// only ever be credited with points a wall-clock-elapsed session could
// plausibly have earned, so a tampered client claiming a billion points gets
// the ceiling, not the billion.

import type { CallOfXenoWeaponId } from './call-of-xeno'

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export type CallOfXenoUpgradeId =
    | 'warChest'
    | 'bodyArmor'
    | 'adrenaline'
    | 'scavenger'
    | 'contract'
    | 'sidearm'

export interface CallOfXenoUpgradeDef {
    id: CallOfXenoUpgradeId
    name: string
    description: string
    /** Highest level buyable. */
    max: number
    /** Price of level 1. Each further level multiplies by `growth`. */
    baseCost: number
    growth: number
}

export const CALL_OF_XENO_UPGRADES: CallOfXenoUpgradeDef[] = [
    {
        id: 'warChest',
        name: 'War Chest',
        description: '+1,000 starting points per level',
        max: 10,
        baseCost: 200_000,
        growth: 1.8
    },
    {
        id: 'bodyArmor',
        name: 'Body Armor',
        description: '+25 max health per level',
        max: 5,
        baseCost: 3_000_000,
        growth: 2.4
    },
    {
        id: 'adrenaline',
        name: 'Adrenaline',
        description: 'Health regen starts 0.2s sooner and runs 1% faster per level',
        max: 10,
        baseCost: 800_000,
        growth: 1.6
    },
    {
        id: 'scavenger',
        name: 'Scavenger',
        description: '5% off every in-run purchase per level — 25% off max (doors, guns, perks, box, Pack-a-Punch)',
        max: 5,
        baseCost: 800_000,
        growth: 2.1
    },
    {
        id: 'contract',
        name: 'Payout Contract',
        description: '+25% end-of-run cash conversion per level',
        max: 9,
        baseCost: 1_500_000,
        growth: 1.65
    },
    {
        id: 'sidearm',
        name: 'Sidearm',
        description: 'Unlock better starting sidearms: Skorpion, Trench Gun, MP40, AK-74',
        max: 4,
        baseCost: 1_200_000,
        growth: 3.2
    }
]

export const CALL_OF_XENO_UPGRADE_IDS = CALL_OF_XENO_UPGRADES.map(def => def.id)

export type CallOfXenoUpgradeLevels = Record<CallOfXenoUpgradeId, number>

export const CALL_OF_XENO_EMPTY_LEVELS: CallOfXenoUpgradeLevels = {
    warChest: 0,
    bodyArmor: 0,
    adrenaline: 0,
    scavenger: 0,
    contract: 0,
    sidearm: 0
}

/** Price of the next level, or null when the track is maxed. */
export function callOfXenoUpgradeCost(def: CallOfXenoUpgradeDef, level: number): number | null {
    if (level >= def.max) return null
    return Math.round(def.baseCost * Math.pow(def.growth, level))
}

const SIDEARM_LADDER: CallOfXenoWeaponId[] = ['skorpion', 'trench', 'mp40', 'ak74']

/** Sidearms the Sidearm track unlocks, in order. Exported for the picker UI. */
export const CALL_OF_XENO_SIDEARM_LADDER = SIDEARM_LADDER

/** Base health-regen delay in seconds — mirrors CALL_OF_XENO_REGEN_DELAY. */
const REGEN_DELAY_BASE = 3.5
const REGEN_DELAY_PER_LEVEL = 0.2

export interface CallOfXenoUpgradeEffects {
    startingPoints: number
    maxHealth: number
    /** Seconds before health starts regenerating (3.5s down to 1.5s). */
    regenDelaySeconds: number
    /** Multiplier on the base regen rate (1 to 1.10). */
    regenRateMult: number
    /** Multiplier on every in-run price (1 down to 0.75). */
    costMult: number
    /** Multiplier on the end-of-run cash conversion. */
    payoutMult: number
    /** Weapon the run starts with, null = the M1911. */
    startWeapon: CallOfXenoWeaponId | null
}

/** Position on the difficulty ladder — higher is harder. */
export function callOfXenoDifficultyRank(id: string): number {
    const index = CALL_OF_XENO_DIFFICULTIES.findIndex(d => d.id === id)
    return index === -1 ? -1 : index
}

/** True when a finished run beats the recorded best: harder tier, then deeper. */
export function callOfXenoBeatsBestRun(
    rounds: number,
    difficultyId: string,
    bestRounds: number,
    bestDifficultyId: string | null
): boolean {
    if (bestDifficultyId === null || bestRounds <= 0) return rounds > 0
    const rank = callOfXenoDifficultyRank(difficultyId)
    const bestRank = callOfXenoDifficultyRank(bestDifficultyId)
    if (rank !== bestRank) return rank > bestRank
    return rounds > bestRounds
}

/** Whether a weapon is a legal starting sidearm at this Sidearm level. */
export function callOfXenoSidearmUnlocked(weapon: CallOfXenoWeaponId, sidearmLevel: number): boolean {
    if (weapon === 'm1911') return true
    const index = SIDEARM_LADDER.indexOf(weapon)
    return index !== -1 && sidearmLevel >= index + 1
}

export function callOfXenoUpgradeEffects(levels: CallOfXenoUpgradeLevels): CallOfXenoUpgradeEffects {
    return {
        startingPoints: 500 + levels.warChest * 1000,
        maxHealth: 100 + levels.bodyArmor * 25,
        regenDelaySeconds: Math.max(REGEN_DELAY_BASE - levels.adrenaline * REGEN_DELAY_PER_LEVEL, 1.5),
        regenRateMult: 1 + levels.adrenaline * 0.01,
        // Additive on purpose: 5% per level, hard-floored at a 25% discount.
        costMult: Math.max(0.75, 1 - levels.scavenger * 0.05),
        payoutMult: 1 + levels.contract * 0.25,
        startWeapon: levels.sidearm > 0 ? SIDEARM_LADDER[Math.min(levels.sidearm, SIDEARM_LADDER.length) - 1]! : null
    }
}

/** Total price of every level of every track — the account's sink ceiling. */
export function callOfXenoTotalUpgradeCost(): number {
    let total = 0
    for (const def of CALL_OF_XENO_UPGRADES) {
        for (let level = 0; level < def.max; level++) {
            total += callOfXenoUpgradeCost(def, level)!
        }
    }
    return total
}

// ---------------------------------------------------------------------------
// Difficulties
// ---------------------------------------------------------------------------

export type CallOfXenoDifficultyId = 'recruit' | 'veteran' | 'survivor' | 'nightmare'

export interface CallOfXenoDifficulty {
    id: CallOfXenoDifficultyId
    name: string
    description: string
    /** Zombie health, speed, damage and count multipliers. */
    healthMult: number
    speedMult: number
    damageMult: number
    countMult: number
    /** Payout multiplier. */
    reward: number
    /**
     * Best round required on the *previous* tier before this one unlocks.
     * Recruit is always open (null).
     */
    requiredBestRound: number | null
    previous: CallOfXenoDifficultyId | null
}

export const CALL_OF_XENO_DIFFICULTIES: CallOfXenoDifficulty[] = [
    {
        id: 'recruit',
        name: 'Recruit',
        description: 'The standard outbreak. 1× payout.',
        healthMult: 1,
        speedMult: 1,
        damageMult: 1,
        countMult: 1,
        reward: 1,
        requiredBestRound: null,
        previous: null
    },
    {
        id: 'veteran',
        name: 'Veteran',
        description: 'Tougher, faster, hungrier. 2.5× payout.',
        healthMult: 1.5,
        speedMult: 1.1,
        damageMult: 1.5,
        countMult: 1.2,
        reward: 2.5,
        requiredBestRound: 12,
        previous: 'recruit'
    },
    {
        id: 'survivor',
        name: 'Survivor',
        description: 'The horde does not stop. 5× payout.',
        healthMult: 2.5,
        speedMult: 1.25,
        damageMult: 2,
        countMult: 1.5,
        reward: 5,
        requiredBestRound: 16,
        previous: 'veteran'
    },
    {
        id: 'nightmare',
        name: 'Nightmare',
        description: 'Everything and all of it at once. 10× payout.',
        healthMult: 4,
        speedMult: 1.4,
        damageMult: 3,
        countMult: 2,
        reward: 10,
        requiredBestRound: 25,
        previous: 'survivor'
    }
]

export const CALL_OF_XENO_DIFFICULTY_IDS = CALL_OF_XENO_DIFFICULTIES.map(d => d.id)

export function callOfXenoDifficulty(id: unknown): CallOfXenoDifficulty {
    return CALL_OF_XENO_DIFFICULTIES.find(d => d.id === id) ?? CALL_OF_XENO_DIFFICULTIES[0]!
}

/** Best round a player has recorded, per tier. Recruit defaults to open. */
export type CallOfXenoBestRounds = Record<CallOfXenoDifficultyId, number>

export function callOfXenoDifficultyUnlocked(difficulty: CallOfXenoDifficulty, best: CallOfXenoBestRounds): boolean {
    if (difficulty.previous === null) return true
    return best[difficulty.previous] >= (difficulty.requiredBestRound ?? 0)
}

// ---------------------------------------------------------------------------
// Payout model
// ---------------------------------------------------------------------------

/** Seconds of slack every run gets before the clock starts on the ceiling. */
export const CALL_OF_XENO_ELAPSED_GRACE_MS = 120_000
/**
 * Two hours between runs. Dev override: `XENO_COOLDOWN_MS` in `.env` — `0`
 * disables it, any other number of ms shortens it, unset or empty keeps the
 * default. Production never sets it.
 */
export const CALL_OF_XENO_RUN_COOLDOWN_MS = (() => {
    const raw = process.env.XENO_COOLDOWN_MS
    if (raw === undefined || raw === '') return 2 * 60 * 60 * 1000
    const override = Number(raw)
    return Number.isFinite(override) ? Math.max(0, override) : 2 * 60 * 60 * 1000
})()

/**
 * Gross points a run may ever claim, regardless of anything else. Also the
 * asymptote of the per-minute honesty ceiling — no length of play gets a
 * run credited with more than this.
 */
export const CALL_OF_XENO_MAX_GROSS = 2_600_000
/** Absolute payout ceiling — the most one run can ever pay. */
export const CALL_OF_XENO_MAX_PAYOUT = 3_000_000
/**
 * Payout ceiling before the Payout Contract: one run at contract level 0 can
 * never pay more than this, no matter how deep or how long. Each contract
 * level raises the ceiling by its +25%, so the 1M+ payouts only exist for
 * accounts that have actually bought their way into them.
 */
export const CALL_OF_XENO_MAX_PAYOUT_BASE = 925_000
/** Base gross-points → cash conversion, before difficulty and contract. */
export const CALL_OF_XENO_PAYOUT_RATE = 0.04
/**
 * Runs deeper than round 100 settle as round 100. Nobody gets there by hand;
 * the clamp exists so an exploit cannot manufacture one.
 */
export const CALL_OF_XENO_MAX_SETTLED_ROUND = 100

export function callOfXenoRunCooldownRemainingMs(lastRunFinishedAt: Date | null, now: number): number {
    if (!lastRunFinishedAt) return 0
    return Math.max(0, lastRunFinishedAt.getTime() + CALL_OF_XENO_RUN_COOLDOWN_MS - now)
}

/**
 * The honesty ceiling ramps for ~90 minutes — the wall-clock pace of a
 * round-50 run — then the growth decays exponentially (half-life ~99
 * minutes), so depth past round 50 pays progressively less per round and
 * the curve flattens toward CALL_OF_XENO_MAX_GROSS at round-100 pace.
 */
const CEILING_KNEE_MINUTES = 90
const CEILING_RAMP_A = 14_000
const CEILING_RAMP_B = 40
const CEILING_KNEE_VALUE = CEILING_RAMP_A * CEILING_KNEE_MINUTES + CEILING_RAMP_B * CEILING_KNEE_MINUTES * CEILING_KNEE_MINUTES
const CEILING_DECAY_PER_MINUTE = 0.993

/**
 * The most gross points a run of `elapsedMs` could honestly have earned on
 * this difficulty. Tracks a realistic income curve with headroom for
 * point-farming play, then scales by the tier's spawn count.
 */
export function callOfXenoMaxGrossForElapsedMs(elapsedMs: number, difficulty: CallOfXenoDifficulty): number {
    const minutes = Math.max(0, (elapsedMs - CALL_OF_XENO_ELAPSED_GRACE_MS) / 60_000)
    let curve: number
    if (minutes <= CEILING_KNEE_MINUTES) {
        curve = CEILING_RAMP_A * minutes + CEILING_RAMP_B * minutes * minutes
    } else {
        const over = minutes - CEILING_KNEE_MINUTES
        curve = CEILING_KNEE_VALUE + (CALL_OF_XENO_MAX_GROSS - CEILING_KNEE_VALUE) * (1 - Math.pow(CEILING_DECAY_PER_MINUTE, over))
    }
    return Math.min(
        CALL_OF_XENO_MAX_GROSS,
        Math.round(curve * Math.max(1, difficulty.countMult))
    )
}

export interface CallOfXenoPayout {
    /** Cash credited. */
    awarded: number
    /** Gross points after the honesty ceiling — what the rate was paid on. */
    counted: number
    /** True when the reported gross was cut down by the ceiling. */
    capped: boolean
}

/**
 * Converts a finished run into cash. `reportedGross` is client-reported
 * lifetime points earned; the wall clock decides how much of it is
 * believable.
 */
export function callOfXenoPayoutForRun(
    reportedGross: number,
    elapsedMs: number,
    difficulty: CallOfXenoDifficulty,
    payoutMult: number
): CallOfXenoPayout {
    const gross = Math.max(0, Math.floor(reportedGross))
    const counted = Math.min(gross, callOfXenoMaxGrossForElapsedMs(elapsedMs, difficulty))
    // The ceiling a run can hit scales with the Payout Contract level the
    // run started with, so a bare account is capped well under 1M.
    const ceiling = Math.min(CALL_OF_XENO_MAX_PAYOUT, CALL_OF_XENO_MAX_PAYOUT_BASE * payoutMult)
    const awarded = Math.min(
        ceiling,
        Math.floor(counted * CALL_OF_XENO_PAYOUT_RATE * difficulty.reward * payoutMult)
    )
    return { awarded, counted, capped: counted < gross }
}
