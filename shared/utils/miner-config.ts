// ─── Mining Rig ───────────────────────────────────────────────────────────────
export const RIG_MAX_LEVEL = 100
export const RIG_BASE_INCOME = 150
export const RIG_INCOME_INCREMENT = 150
export const RIG_BASE_UPGRADE_COST = 600
export const RIG_UPGRADE_COST_INCREMENT = 300  // additional cost per current level

// ─── Vault ────────────────────────────────────────────────────────────────────
export const VAULT_MAX_LEVEL = 100
export const VAULT_BASE_CAP = 150
export const VAULT_CAP_INCREMENT = 150
export const VAULT_BASE_UPGRADE_COST = 500
export const VAULT_UPGRADE_COST_INCREMENT = 250

// ─── Gem Factory ──────────────────────────────────────────────────────────────
export const FACTORY_MAX_LEVEL = 10
export const FACTORY_BASE_RATE = 1
export const FACTORY_RATE_INCREMENT = 0.5
export const FACTORY_BASE_CAP = 10
export const FACTORY_CAP_INCREMENT = 1
export const FACTORY_BASE_UPGRADE_COST = 1000
export const FACTORY_UPGRADE_COST_INCREMENT = 1000

// ─── Gem Shop ─────────────────────────────────────────────────────────────────
export const SHOP_INSTANT_FILL_MIN_RATIO = 200   // $/gem at level 1
export const SHOP_INSTANT_FILL_MAX_RATIO = 1200  // $/gem at max vault
export const SHOP_INSTANT_FILL_MIN_COST = 1
export const SHOP_DOUBLE_WIN_COST = 5          // gems — 2x next win (capped at 1500, not yet implemented)
export const SHOP_EXTRA_PLAY_COST = 1          // gems — extra play
export const SHOP_QUICK_CASH_COST = 1          // gems
export const SHOP_QUICK_CASH_AMOUNT = 200      // $ credited instantly

// ─── Mines Game ───────────────────────────────────────────────────────────────
export const MINES_MAX_COUNT = 10
export const MINES_BASE_PURCHASE_COST = 1000
export const MINES_PURCHASE_COST_INCREMENT = 750
export const MINES_TILE_VALUES = [1000, 600, 450, 350, 300, 200, 150, 100, 0] as const

export const MINES_UPGRADE_MAX_LEVEL = 10
export const MINES_UPGRADE_BASE_COST = 1000
export const MINES_UPGRADE_COST_INCREMENT = 750

/** Cost to buy the next mine (pass current count before purchase) */
export function minesPurchaseCost(currentCount: number) {
  return MINES_BASE_PURCHASE_COST + (currentCount - 1) * MINES_PURCHASE_COST_INCREMENT
}

/** Cost to upgrade mines to the next level */
export function minesUpgradeCost(currentLevel: number) {
  return MINES_UPGRADE_BASE_COST + (currentLevel - 1) * MINES_UPGRADE_COST_INCREMENT
}

/** Multiplier for mine rewards and extra play value */
export function minesValueMultiplier(level: number) {
  return 1 + (level - 1) * 0.1
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

export function instantFillCost(vaultLevel: number) {
  const t = (vaultLevel - 1) / (VAULT_MAX_LEVEL - 1) // 0 at L1, 1 at L100
  const ratio = SHOP_INSTANT_FILL_MIN_RATIO + t * (SHOP_INSTANT_FILL_MAX_RATIO - SHOP_INSTANT_FILL_MIN_RATIO)
  return Math.max(SHOP_INSTANT_FILL_MIN_COST, Math.ceil(vaultCap(vaultLevel) / ratio))
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
