export const MAX_PRESTIGE_LEVEL = 3
export const PRESTIGE_COIN_COST = 100_000_000_000
export const PRESTIGE_GEM_COST = 50_000
export const PRESTIGE_BONUS_PER_LEVEL = 0.05

export const PRESTIGE_TITLES = ['Unprestiged', 'Radiant', 'Ascendant', 'Mythic'] as const
export const PRESTIGE_EXCLUDED_CREDIT_CATEGORIES = new Set(['bank', 'gem market'])

export function clampPrestigeLevel(level: number) {
  return Math.min(MAX_PRESTIGE_LEVEL, Math.max(0, Math.floor(level)))
}

export function prestigeBonusMultiplier(level: number) {
  return 1 + clampPrestigeLevel(level) * PRESTIGE_BONUS_PER_LEVEL
}

export function prestigeBonusPercent(level: number) {
  return Math.round(clampPrestigeLevel(level) * PRESTIGE_BONUS_PER_LEVEL * 100)
}

export function prestigeTitle(level: number) {
  return PRESTIGE_TITLES[clampPrestigeLevel(level)]!
}

export function applyPrestigeCreditBonus(amount: string | number, level: number, category?: string, eligible = true) {
  const parsed = Number(amount)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid credit amount')

  const multiplier = !eligible || PRESTIGE_EXCLUDED_CREDIT_CATEGORIES.has(category?.trim().toLowerCase() ?? '')
    ? 1
    : prestigeBonusMultiplier(level)

  return (parsed * multiplier).toFixed(4)
}
