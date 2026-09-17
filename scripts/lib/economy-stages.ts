// Shared progression model for the two idle economies, XENO and COLONY.
//
// The property this exists to protect: at any given number of DAYS PLAYED, the
// two games should pay comparably. Tier index is not a fair axis — Colony's
// Habitat 6 and Xeno's T9 are both "the end", but they are 82 and 121 days
// apart from Habitat 1 and T1 respectively, and the stages in between do not
// line up at all. Everything here is therefore keyed on days-to-reach, and the
// income figures are whole-account (every terrarium slot, every grid tile), not
// per-slot.
//
// scripts/xeno-income.ts, scripts/colony-income.ts, scripts/economy-compare.ts
// and test/economy/cross-game.spec.ts all read the same functions from here so
// they cannot drift apart from each other or from the live constants.

import {
    BUG_TYPES,
    researchYieldRange,
    avgTickYield,
    deriveCapacity,
    deriveTrackModifiers,
    effectiveTickMs,
    effectiveFeedPerHour,
    getItem,
    habitatLevelUpCost,
    habitatLevelUpDurationMs,
    habitatTrackRequirement,
    researchResourceMultiplier,
    researchSpeedRange,
    socialSpeedBonusPct,
    trackLevelCost,
    trackLevelDurationMs,
    FEED_COST_PER_POINT,
    MAX_RESEARCH_LEVEL,
    MAX_TIER,
    RESEARCH_COST_MULTIPLIERS,
    UPGRADE_TRACKS,
    type BugType,
    type UpgradeTrackId
} from '../../shared/utils/colony'

import {
    MUTATIONS,
    PLANT_TYPES,
    breedDuration,
    effectiveGrowTime,
    getPlant,
    gridSlotUnlockCost,
    breederSlotUnlockCost,
    xenoSpeedBoost,
    xenoYieldBonus,
    XENO_MAX_GRID_SLOTS,
    XENO_UPGRADE_MAX_LEVEL,
    XENO_UPGRADE_TRACKS,
    type PlantType
} from '../../shared/utils/xeno'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export interface Stage {
    /** Human label, e.g. "hab4" or "T7". */
    label: string
    /** Days of real time to reach this stage from a fresh account. */
    days: number
    /** Coins per hour the whole account produces here, net of running costs. */
    coinsPerHour: number
    /** Coins sunk to get here and to stock the account at this stage. */
    capital: number
    /** What is actually being farmed at this stage. */
    best: string
}

// ─── COLONY ─────────────────────────────────────────────────────────────────
// A colony stage is a Habitat Level. Habitat N gates which bug tiers are
// purchasable (tier <= habitatLevel) and is itself gated on every upgrade track
// reaching its own required level, so the track levels at each stage are not a
// guess — they are exactly HABITAT_TRACK_REQUIREMENTS.

export const COLONY_STAGES = [1, 2, 3, 4, 5, 6] as const

/** Every track's level at the moment the player reaches `habitatLevel`. */
export function colonyTrackLevels(habitatLevel: number): Record<UpgradeTrackId, number> {
    const levels = {} as Record<UpgradeTrackId, number>
    for (const track of UPGRADE_TRACKS) {
        // habitatTrackRequirement(id, L) is what's needed to go from L to L+1,
        // so being AT habitatLevel means having met the requirement for L-1.
        levels[track.id] = habitatLevel <= 1 ? 0 : habitatTrackRequirement(track.id, habitatLevel - 1)
    }
    return levels
}

/**
 * Builder days to reach `habitatLevel`. BASE_BUILDER_COUNT is 1 and a builder
 * can only hold one job at a time, so the critical path is the plain sum of
 * every track level plus every habitat level-up — no parallelism.
 */
export function colonyDaysTo(habitatLevel: number): number {
    const levels = colonyTrackLevels(habitatLevel)
    let ms = 0
    for (const track of UPGRADE_TRACKS) {
        for (let level = 1; level <= levels[track.id]; level++) ms += trackLevelDurationMs(level)
    }
    for (let level = 1; level < habitatLevel; level++) ms += habitatLevelUpDurationMs(level)
    return ms / DAY_MS
}

/** Coins sunk into habitat level-ups, track levels, a full terrarium and research. */
export function colonyCapital(habitatLevel: number, researchLevel: number): number {
    const levels = colonyTrackLevels(habitatLevel)
    let coins = 0
    for (const track of UPGRADE_TRACKS) {
        for (let level = 1; level <= levels[track.id]; level++) coins += trackLevelCost(level).coins
    }
    for (let level = 1; level < habitatLevel; level++) coins += habitatLevelUpCost(level)

    const species = colonyBestSpecies(habitatLevel, researchLevel)
    if (species) {
        coins += deriveCapacity(levels) * species.type.spawnCost
        for (let level = 0; level < researchLevel; level++) {
            coins += (RESEARCH_COST_MULTIPLIERS[level] ?? 0) * species.type.spawnCost
        }
    }
    return coins
}

/** Coins/hour one bug of this species earns, net of what it eats, at the given stage. */
export function colonyBugIncome(type: BugType, habitatLevel: number, researchLevel: number): number {
    if (type.producesGems || type.prestigeOnly) return 0
    const mods = deriveTrackModifiers(colonyTrackLevels(habitatLevel))
    const [speedMin, speedMax] = researchSpeedRange(researchLevel)
    const speed = (speedMin + speedMax) / 2
    // Social species are assumed grouped for their full bonus, solitary ones
    // kept alone — the setup each species is actually designed around.
    const groupSize = type.social ? 4 : 1
    const bonusPct = mods.speedBonusPct + socialSpeedBonusPct(type.id, groupSize)

    const bug = { typeId: type.id, speed, eat: (type.eatMin + type.eatMax) / 2 }
    const tickMs = effectiveTickMs(bug, bonusPct)
    if (!Number.isFinite(tickMs) || tickMs <= 0) return 0

    const [yieldMin, yieldMax] = researchYieldRange(researchLevel)
    const yieldLevel = (yieldMin + yieldMax) / 2 + mods.yieldLevelBonus
    const perTick = avgTickYield(yieldLevel) * researchResourceMultiplier(researchLevel)
    const gross = perTick * (getItem(type.itemId)?.sellValue ?? 0) * (HOUR_MS / tickMs)
    const food = effectiveFeedPerHour(bug, bonusPct, mods.feedMultiplier) * FEED_COST_PER_POINT
    return gross - food
}

/** The best coin species available at this habitat level, and what it earns. */
export function colonyBestSpecies(habitatLevel: number, researchLevel: number) {
    const candidates = BUG_TYPES
        .filter(type => !type.producesGems && !type.prestigeOnly && type.tier <= habitatLevel)
        .map(type => ({ type, perBug: colonyBugIncome(type, habitatLevel, researchLevel) }))
        .sort((a, b) => b.perBug - a.perBug)
    return candidates[0] ?? null
}

/** Whole-colony stage: every slot filled with the best species available. */
export function colonyStage(habitatLevel: number, researchLevel: number): Stage {
    const best = colonyBestSpecies(habitatLevel, researchLevel)
    const capacity = deriveCapacity(colonyTrackLevels(habitatLevel))
    return {
        label: `hab${habitatLevel}`,
        days: colonyDaysTo(habitatLevel),
        coinsPerHour: (best?.perBug ?? 0) * capacity,
        capital: colonyCapital(habitatLevel, researchLevel),
        best: best ? `${capacity}x ${best.type.name}` : '—'
    }
}

// ─── XENO ───────────────────────────────────────────────────────────────────
// A xeno stage is the highest plant tier unlocked. Grid slots are always
// assumed fully unlocked (36) — they are cheap relative to everything else and
// a player at any tier worth measuring has bought them.

export const XENO_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
export const XENO_BREEDER_SLOTS = 3

/**
 * Coins/hour one grid tile earns growing this plant on repeat.
 *
 * NET, not gross: harvesting deletes the planted instance and hands back
 * `1 + rollYield(yield) + flat bonuses`, so exactly one plant per cycle goes
 * back into the ground to keep the tile running. Only the remainder is income.
 * Getting this wrong overstates low-tier xeno by 1.5-3x.
 */
export function xenoTileIncome(plant: PlantType, globalLevel: number, artifactYield = 0, artifactSpeed = 0): number {
    const growSeconds = effectiveGrowTime(plant) * (1 - xenoSpeedBoost(globalLevel)) * (1 - artifactSpeed)
    if (growSeconds <= 0) return 0
    const netPerCycle = plant.yield / 2 + xenoYieldBonus(globalLevel) + artifactYield
    return plant.value * netPerCycle * (3600 / growSeconds)
}

/** The best plant available once `tier` is unlocked — every lower tier included, so a fast cheap plant riding the flat yield bonus would show up here. */
export function xenoBestPlant(tier: number, globalLevel: number) {
    const candidates = PLANT_TYPES
        .filter(plant => plant.tier <= tier)
        .map(plant => ({ plant, perTile: xenoTileIncome(plant, globalLevel) }))
        .sort((a, b) => b.perTile - a.perTile)
    return candidates[0] ?? null
}

/**
 * Mutation boost a player realistically has in hand when hunting `tier`:
 * the best gem-crafted mutation artifact that tier's own parents can craft,
 * plus whatever the global Genetic Instability track is worth by then.
 * T5+ mutations have NEGATIVE base chances, so this is not optional — without
 * it the expected number of breeds is infinite.
 */
export function xenoMutationBoostAt(tier: number): number {
    const artifact = tier <= 3 ? 0.10 : tier === 4 ? 0.15 : tier <= 6 ? 0.30 : tier <= 8 ? 0.40 : 0.50
    const global = Math.min(XENO_UPGRADE_MAX_LEVEL, Math.max(0, tier - 2)) * 0.01
    return artifact + global
}

/** Global speed level a player plausibly holds while working on `tier`. */
export function xenoGlobalLevelAt(tier: number): number {
    return Math.max(0, Math.min(XENO_UPGRADE_MAX_LEVEL, (tier - 2) * 1.25))
}

/**
 * Days to unlock EVERY species of `tier`, not just the first one — the T(N+1)
 * mutation table needs four distinct T(N) parents, so a tier is not really
 * "reached" until it is complete.
 *
 * Per species: expected breeds is 1/chance, those breeds share the breeder
 * pool, and each round is gated by whichever is slower — the breed itself, or
 * regrowing the parents it consumed on the grid.
 */
export function xenoDaysForTier(tier: number): number {
    const speedLevel = xenoGlobalLevelAt(tier)
    const boost = xenoMutationBoostAt(tier)
    let ms = 0

    for (const target of PLANT_TYPES.filter(plant => plant.tier === tier)) {
        const routes = MUTATIONS.filter(mutation => mutation.offspring === target.id)
        let bestMs = Infinity
        for (const mutation of routes) {
            const parent1 = getPlant(mutation.parent1)
            const parent2 = getPlant(mutation.parent2)
            if (!parent1 || !parent2) continue
            const chance = Math.max(0.005, Math.min(1, mutation.chance + boost))
            const breedMs = breedDuration(parent1, parent2) * 1000 * (1 - xenoSpeedBoost(speedLevel))
            const regrowMs = Math.max(effectiveGrowTime(parent1), effectiveGrowTime(parent2)) * 1000 * (1 - xenoSpeedBoost(speedLevel))
            const rounds = Math.ceil((1 / chance) / XENO_BREEDER_SLOTS)
            bestMs = Math.min(bestMs, rounds * Math.max(breedMs, regrowMs))
        }
        // Plants with no mutation route are inherited from a parent of their own
        // type and cost no extra hunting time.
        if (Number.isFinite(bestMs)) ms += bestMs
    }
    return ms / DAY_MS
}

/** Cumulative days from a fresh account to a complete tier. */
export function xenoDaysTo(tier: number): number {
    let days = 0
    for (let t = 2; t <= tier; t++) days += xenoDaysForTier(t)
    return days
}

/** Coins sunk into grid slots, breeder slots and global upgrade levels. */
export function xenoCapital(globalLevel: number): number {
    let coins = 0
    for (let index = 0; index < XENO_MAX_GRID_SLOTS; index++) coins += gridSlotUnlockCost(index)
    for (let index = 0; index < XENO_BREEDER_SLOTS; index++) coins += breederSlotUnlockCost(index)
    for (const track of XENO_UPGRADE_TRACKS) {
        for (let level = 0; level < Math.floor(globalLevel); level++) coins += track.costs[level] ?? 0
    }
    return coins
}

/** Whole-farm stage: 36 tiles all growing the best plant available. */
export function xenoStage(tier: number, globalLevel: number): Stage {
    const best = xenoBestPlant(tier, globalLevel)
    return {
        label: `T${tier}`,
        days: xenoDaysTo(tier),
        coinsPerHour: (best?.perTile ?? 0) * XENO_MAX_GRID_SLOTS,
        capital: xenoCapital(globalLevel),
        best: best ? `${XENO_MAX_GRID_SLOTS}x ${best.plant.name}` : '—'
    }
}

// ─── Cross-game ─────────────────────────────────────────────────────────────

/**
 * Colony's income at an arbitrary number of days, interpolated geometrically
 * between habitat stages. Past Habitat 6 it PLATEAUS rather than extrapolating —
 * hab6 is the last stage there is, and pretending the curve keeps climbing
 * would make late xeno look artificially poor.
 */
export function colonyIncomeAtDay(days: number, researchLevel: number): number {
    const points = COLONY_STAGES.map(level => colonyStage(level, researchLevel))
    const first = points[0]!
    const last = points[points.length - 1]!
    if (days <= first.days) return first.coinsPerHour
    if (days >= last.days) return last.coinsPerHour
    for (let i = 1; i < points.length; i++) {
        const lo = points[i - 1]!
        const hi = points[i]!
        if (days <= hi.days) {
            const t = (days - lo.days) / (hi.days - lo.days)
            return lo.coinsPerHour * Math.pow(hi.coinsPerHour / lo.coinsPerHour, t)
        }
    }
    return last.coinsPerHour
}

export interface Comparison {
    tier: number
    days: number
    xeno: number
    colony: number
    /** xeno / colony. 1 means the two pay the same for the same time invested. */
    ratio: number
}

/** Xeno against colony at the same number of days played, at each xeno tier. */
export function compareAtEqualDays(globalLevelFor: (tier: number) => number, researchLevel: number): Comparison[] {
    return XENO_TIERS.filter(tier => tier >= 3).map((tier) => {
        const stage = xenoStage(tier, globalLevelFor(tier))
        const colony = colonyIncomeAtDay(stage.days, researchLevel)
        return { tier, days: stage.days, xeno: stage.coinsPerHour, colony, ratio: stage.coinsPerHour / colony }
    })
}

export { MAX_RESEARCH_LEVEL, MAX_TIER, XENO_UPGRADE_MAX_LEVEL }
