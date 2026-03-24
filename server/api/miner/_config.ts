// ─── Mining Rig ───────────────────────────────────────────────────────────────
export const RIG_MAX_LEVEL = 30
export const RIG_BASE_INCOME = 75              // $/day at level 1
export const RIG_INCOME_INCREMENT = 75         // additional $/day per level
export const RIG_BASE_UPGRADE_COST = 500       // base upgrade cost
export const RIG_UPGRADE_COST_INCREMENT = 250  // additional cost per current level

// ─── Vault ────────────────────────────────────────────────────────────────────
export const VAULT_MAX_LEVEL = 30
export const VAULT_BASE_CAP = 75               // $ cap at level 1
export const VAULT_CAP_INCREMENT = 75          // additional $ cap per level
export const VAULT_BASE_UPGRADE_COST = 350
export const VAULT_UPGRADE_COST_INCREMENT = 75

// ─── Gem Factory ──────────────────────────────────────────────────────────────
export const FACTORY_MAX_LEVEL = 10
export const FACTORY_BASE_RATE = 1          // gems/day at level 1
export const FACTORY_RATE_INCREMENT = 0.5      // additional gems/day per level
export const FACTORY_BASE_CAP = 10              // gem cap at level 1
export const FACTORY_CAP_INCREMENT = 1         // additional gem cap per level
export const FACTORY_BASE_UPGRADE_COST = 750
export const FACTORY_UPGRADE_COST_INCREMENT = 750

// ─── Gem Shop ─────────────────────────────────────────────────────────────────
export const SHOP_INSTANT_FILL_COST = 5        // gems — fills vault to cap
export const SHOP_DOUBLE_WIN_COST = 5          // gems — 2x next win (capped at 1500, not yet implemented)
export const SHOP_EXTRA_PLAY_COST = 1          // gems — extra play (not yet implemented)
export const SHOP_QUICK_CASH_COST = 1          // gems
export const SHOP_QUICK_CASH_AMOUNT = 200      // $ credited instantly

// ─── Mines Game ───────────────────────────────────────────────────────────────
export const MINES_MAX_COUNT = 10
export const MINES_BASE_PURCHASE_COST = 1000
export const MINES_PURCHASE_COST_INCREMENT = 750
export const MINES_TILE_VALUES = [1000, 600, 450, 350, 300, 200, 150, 100, 0] as const

/** Cost to buy the next mine (pass current count before purchase) */
export function minesPurchaseCost(currentCount: number) {
  return MINES_BASE_PURCHASE_COST + (currentCount - 1) * MINES_PURCHASE_COST_INCREMENT
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function rigIncome(level: number) {
  return RIG_BASE_INCOME + (level - 1) * RIG_INCOME_INCREMENT
}

export function vaultCap(level: number) {
  return VAULT_BASE_CAP + (level - 1) * VAULT_CAP_INCREMENT
}

export function rigUpgradeCost(level: number) {
  return RIG_BASE_UPGRADE_COST + level * RIG_UPGRADE_COST_INCREMENT
}

export function vaultUpgradeCost(level: number) {
  return VAULT_BASE_UPGRADE_COST + level * VAULT_UPGRADE_COST_INCREMENT
}

export function factoryRate(level: number) {
  return FACTORY_BASE_RATE + (level - 1) * FACTORY_RATE_INCREMENT
}

export function factoryCap(level: number) {
  return FACTORY_BASE_CAP + (level - 1) * FACTORY_CAP_INCREMENT
}

export function factoryUpgradeCost(level: number) {
  return FACTORY_BASE_UPGRADE_COST + level * FACTORY_UPGRADE_COST_INCREMENT
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
