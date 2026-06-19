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
export const FACTORY_MAX_LEVEL = 10
export const FACTORY_BASE_RATE = 1
export const FACTORY_RATE_STEP = 0.5         // +0.5 gem/day per level → 5.5 gems/day at L10
export const FACTORY_BASE_CAP = 10
export const FACTORY_CAP_STEP = 2            // +2 storage per level → 28 cap at L10
export const FACTORY_BASE_UPGRADE_COST = 1500
export const FACTORY_UPGRADE_GROWTH = 2.47   // reward is linear now, so cost only scales gently

// ─── Gem Shop ─────────────────────────────────────────────────────────────────
export const SHOP_DOUBLE_WIN_COST = 5          // gems — 2x next win (capped at 1500, not yet implemented)
export const SHOP_EXTRA_PLAY_COST = 1          // gems — extra play
export const SHOP_QUICK_CASH_COST = 1          // gems
export const SHOP_QUICK_CASH_AMOUNT = 200      // $ base at factory L1; scales ×factoryLevel

// ─── Mines Game ───────────────────────────────────────────────────────────────
export const MINES_MAX_COUNT = 10
export const MINES_BASE_PURCHASE_COST = 1000
export const MINES_PURCHASE_GROWTH = 1.6
export const MINES_TILE_VALUES = [1000, 600, 450, 350, 300, 200, 150, 100, 0] as const

export const MINES_UPGRADE_MAX_LEVEL = 10
export const MINES_UPGRADE_BASE_COST = 1000
export const MINES_UPGRADE_GROWTH = 1.6
export const MINES_VALUE_GROWTH = 0.10         // +10% per level (linear) → 1.9x at L10

/** Cost to buy the next mine (pass current count before purchase) */
export function minesPurchaseCost(currentCount: number) {
    return Math.round(MINES_BASE_PURCHASE_COST * Math.pow(MINES_PURCHASE_GROWTH, currentCount - 1))
}

/** Cost to upgrade mines to the next level (pass current level) */
export function minesUpgradeCost(currentLevel: number) {
    return Math.round(MINES_UPGRADE_BASE_COST * Math.pow(MINES_UPGRADE_GROWTH, currentLevel - 1))
}

/** Linear multiplier applied to mine tile rewards and extra play value (+10% per level) */
export function minesValueMultiplier(level: number) {
    return 1 + MINES_VALUE_GROWTH * (level - 1)
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

/** 1 gem base + 1 gem per 5 vault levels: L1=1, L5=2, L10=3, L100=21 */
export function instantFillCost(vaultLevel: number) {
    return 1 + Math.floor(vaultLevel / 5)
}

/** Base $200 at factory L1, scales ×factoryLevel: L1=$200, L5=$1000, L10=$2000 */
export function quickCashAmount(factoryLevel: number) {
    return SHOP_QUICK_CASH_AMOUNT * factoryLevel
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
