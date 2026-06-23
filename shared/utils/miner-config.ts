import { GEM_INITIAL_PRICE } from './gamelogic/gem-market'

// All miner upgrade prices AND rewards scale EXPONENTIALLY (geometric per level),
// ─── Mining Rig ───────────────────────────────────────────────────────────────
export const RIG_MAX_LEVEL = 100
export const RIG_BASE_INCOME = 150
export const RIG_INCOME_GROWTH = 1.11        // +11% income per level  → ~4.6M/day at L100; ~11mo to max
export const RIG_BASE_UPGRADE_COST = 250
export const RIG_UPGRADE_GROWTH = 1.125      // +12.5% cost per level

// ─── Vault ────────────────────────────────────────────────────────────────────
export const VAULT_MAX_LEVEL = 100
export const VAULT_BASE_CAP = 300            // ~2 days of same-level rig income of headroom
export const VAULT_CAP_GROWTH = 1.11
export const VAULT_BASE_UPGRADE_COST = 200
export const VAULT_UPGRADE_GROWTH = 1.125

// ─── Gem Factory ──────────────────────────────────────────────────────────────
export const FACTORY_MAX_LEVEL = 20
export const FACTORY_BASE_RATE = 1
export const FACTORY_RATE_STEP = 0.5         // +0.5 gem/day per level → 10.5 gems/day at L20
export const FACTORY_BASE_CAP = 10
export const FACTORY_CAP_STEP = 2            // +2 storage per level → 48 cap at L20
export const FACTORY_BASE_UPGRADE_COST = 1500
export const FACTORY_UPGRADE_GROWTH = 1.97   // last upgrade (L19→L20) ≈ $300M

// ─── Gem Shop — permanent, leveled upgrades bought with GEMS ───────────────────
// These deliver pure progression value (never a direct cash payout), so they
// can't be arbitraged against the swinging gem→cash market price. Prices scale
// geometrically and every effect is hard-capped.

// Rig Overclock — permanent income multiplier applied to BOTH miner (rig)
// income and lootbox CASH rewards. Caps at +20%.
export const OVERCLOCK_MAX_LEVEL = 10
export const OVERCLOCK_BONUS_PER_LEVEL = 0.02    // +2% income per level → +20% at L10
export const OVERCLOCK_BASE_COST = 5.6           // gems for the first tier
export const OVERCLOCK_COST_GROWTH = 1.52        // ~700 gems to fully max

// Factory Catalyst — permanent multiplier on gem production RATE only (never
// storage). Caps at +80% (e.g. a 5.5/day factory → ~9.9/day).
export const CATALYST_MAX_LEVEL = 10
export const CATALYST_BONUS_PER_LEVEL = 0.08     // +8% rate per level → +80% at L10
export const CATALYST_BASE_COST = 6.8            // gems for the first tier
export const CATALYST_COST_GROWTH = 1.48         // ~700 gems to fully max

// ─── Lootboxes ──────────────────────────────────────────────────────────────
// You own a number of lootbox SLOTS — each grants one free open per day.
// There is no "upgrade": cash rewards are a percentage of your vault storage
// (`cap`), so reward value scales automatically as you level the vault, and gem
// rewards are valued live against the gem market. Buying more slots scales hard.
export const LOOTBOX_MAX_SLOTS = 10
export const LOOTBOX_BASE_SLOT_COST = 2000
export const LOOTBOX_SLOT_GROWTH = 3.1

// A paid open is bought with GEMS, not cash. Base 1 gem + 1 gem per 10 vault
// (storage) levels: L1=1, L10=2, L20=3, … L100=11.
export const LOOTBOX_OPEN_BASE_GEM_COST = 1

export type LootboxRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface LootboxReward {
    id: string
    kind: 'cash' | 'gems'
    /**
     * cash → fraction of vault `cap`.
     * gems → nominal gem count *at the base gem price*. The count actually
     * awarded scales inversely with the live market price (see lootboxGemCount),
     * so a gem reward is worth roughly the same in cash whatever the price.
     */
    amount: number
    weight: number
    rarity: LootboxRarity
}

/**
 * The full prize pool. Cash amounts are fractions of vault `cap`; gem amounts
 * are nominal counts at the base price. Gems are intentionally rarer than cash.
 */
export const LOOTBOX_REWARDS: LootboxReward[] = [
    // Cash — fraction of vault storage value (the common, bread-and-butter rewards)
    { id: 'cash-10',  kind: 'cash', amount: 0.10, weight: 22,  rarity: 'common' },
    { id: 'cash-25',  kind: 'cash', amount: 0.25, weight: 16,  rarity: 'common' },
    { id: 'cash-50',  kind: 'cash', amount: 0.50, weight: 11,  rarity: 'uncommon' },
    { id: 'cash-100', kind: 'cash', amount: 1.00, weight: 6,   rarity: 'rare' },
    { id: 'cash-200', kind: 'cash', amount: 2.00, weight: 2.5, rarity: 'epic' },
    { id: 'cash-300', kind: 'cash', amount: 3.00, weight: 1.2, rarity: 'epic' },
    { id: 'cash-500', kind: 'cash', amount: 5.00, weight: 0.6, rarity: 'legendary' },
    // Gems — rarer than cash; awarded count scales with the live gem price
    { id: 'gems-1',   kind: 'gems', amount: 1,    weight: 8,    rarity: 'common' },
    { id: 'gems-5',   kind: 'gems', amount: 5,    weight: 4,    rarity: 'uncommon' },
    { id: 'gems-10',  kind: 'gems', amount: 10,   weight: 2.5,  rarity: 'rare' },
    { id: 'gems-25',  kind: 'gems', amount: 25,   weight: 1.2,  rarity: 'epic' },
    { id: 'gems-50',  kind: 'gems', amount: 50,   weight: 0.5,  rarity: 'epic' },
    { id: 'gems-100', kind: 'gems', amount: 100,  weight: 0.2,  rarity: 'legendary' },
]

/** Cost to buy the next lootbox slot (pass current slot count before purchase). */
export function lootboxSlotCost(currentSlots: number) {
    return Math.round(LOOTBOX_BASE_SLOT_COST * Math.pow(LOOTBOX_SLOT_GROWTH, currentSlots - 1))
}

/**
 * Actual gem count awarded for a gem reward at the live market price.
 * The nominal `amount` is calibrated to the base price, so the count scales
 * inversely: pricey gems → fewer awarded, cheap gems → more awarded. Min 1.
 */
export function lootboxGemCount(reward: LootboxReward, gemPrice: number) {
    if (reward.kind !== 'gems') return 0
    if (gemPrice <= 0) return reward.amount
    return Math.max(1, Math.round(reward.amount * GEM_INITIAL_PRICE / gemPrice))
}

/** Cash value of a single reward given the live vault cap and gem price. */
export function lootboxRewardValue(reward: LootboxReward, storageValue: number, gemPrice: number) {
    return reward.kind === 'cash'
        ? reward.amount * storageValue
        : lootboxGemCount(reward, gemPrice) * gemPrice
}

/** Probability-weighted average value of one open (in cash terms). */
export function lootboxExpectedValue(storageValue: number, gemPrice: number) {
    let totalWeight = 0
    let ev = 0
    for (const r of LOOTBOX_REWARDS) {
        totalWeight += r.weight
        ev += r.weight * lootboxRewardValue(r, storageValue, gemPrice)
    }
    return totalWeight > 0 ? ev / totalWeight : 0
}

/** Gem cost of a paid open: 1 gem + 1 per 10 vault (storage) levels. */
export function lootboxOpenGemCost(vaultLevel: number) {
    return LOOTBOX_OPEN_BASE_GEM_COST + Math.floor(vaultLevel / 10)
}

/** Pick a reward by weight. Returns the chosen reward (server-authoritative). */
export function lootboxRoll(): LootboxReward {
    const totalWeight = LOOTBOX_REWARDS.reduce((sum, r) => sum + r.weight, 0)
    let roll = Math.random() * totalWeight
    for (const r of LOOTBOX_REWARDS) {
        roll -= r.weight
        if (roll <= 0) return r
    }
    return LOOTBOX_REWARDS[LOOTBOX_REWARDS.length - 1]!
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function rigIncome(level: number) {
    return Math.round(RIG_BASE_INCOME * Math.pow(RIG_INCOME_GROWTH, level - 1))
}

export function vaultCap(level: number) {
    return Math.round(VAULT_BASE_CAP * Math.pow(VAULT_CAP_GROWTH, level - 1))
}

export function rigUpgradeCost(level: number) {
    return Math.round(RIG_BASE_UPGRADE_COST * Math.pow(RIG_UPGRADE_GROWTH, level - 1))
}

export function vaultUpgradeCost(level: number) {
    return Math.round(VAULT_BASE_UPGRADE_COST * Math.pow(VAULT_UPGRADE_GROWTH, level - 1))
}

export function factoryRate(level: number) {
    return FACTORY_BASE_RATE + FACTORY_RATE_STEP * (level - 1)
}

export function factoryCap(level: number) {
    return FACTORY_BASE_CAP + FACTORY_CAP_STEP * (level - 1)
}

export function factoryUpgradeCost(level: number) {
    return Math.round(FACTORY_BASE_UPGRADE_COST * Math.pow(FACTORY_UPGRADE_GROWTH, level - 1))
}

// ─── Rig Overclock ──────────────────────────────────────────────────────────
/** Permanent income multiplier (applies to rig income AND lootbox cash). */
export function overclockMultiplier(level: number) {
    return 1 + OVERCLOCK_BONUS_PER_LEVEL * Math.min(level, OVERCLOCK_MAX_LEVEL)
}

/** Gem cost of the next Overclock tier (pass the current level). null if maxed. */
export function overclockUpgradeCost(level: number) {
    if (level >= OVERCLOCK_MAX_LEVEL) return null
    return Math.round(OVERCLOCK_BASE_COST * Math.pow(OVERCLOCK_COST_GROWTH, level))
}

/** Rig income after the Overclock multiplier. */
export function effectiveRigIncome(rigLevel: number, overclockLevel: number) {
    return Math.round(rigIncome(rigLevel) * overclockMultiplier(overclockLevel))
}

// ─── Factory Catalyst ─────────────────────────────────────────────────────────
/** Permanent gem-production-rate multiplier (rate only, never storage). */
export function catalystMultiplier(level: number) {
    return 1 + CATALYST_BONUS_PER_LEVEL * Math.min(level, CATALYST_MAX_LEVEL)
}

/** Gem cost of the next Catalyst tier (pass the current level). null if maxed. */
export function catalystUpgradeCost(level: number) {
    if (level >= CATALYST_MAX_LEVEL) return null
    return Math.round(CATALYST_BASE_COST * Math.pow(CATALYST_COST_GROWTH, level))
}

/** Gem production rate after the Catalyst multiplier. */
export function effectiveFactoryRate(factoryLevel: number, catalystLevel: number) {
    return factoryRate(factoryLevel) * catalystMultiplier(catalystLevel)
}

/** ms elapsed → fractional days */
export function elapsedDays(since: Date) {
    return (Date.now() - since.getTime()) / 86_400_000
}

/**
 * Pending amount accumulated since lastCollectedAt, capped at cap.
 * No stored value — everything is derived from time × rate.
 */
export function computePending(ratePerDay: number, lastAt: Date, cap: number) {
    return Math.min(ratePerDay * elapsedDays(lastAt), cap)
}
