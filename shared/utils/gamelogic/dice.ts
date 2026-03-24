export interface DiceResult {
  roll: number       // 0.00–99.99
  won: boolean
  multiplier: number // 98 / winChance
  payout: number
  winChance: number
  [key: string]: unknown
}

export function playDice(bet: number, options?: Record<string, unknown>): DiceResult {
  const winChance = Number(options?.winChance ?? 50)

  if (!Number.isFinite(winChance) || winChance < 2 || winChance > 96) {
    throw createError({ statusCode: 400, message: 'Win chance must be between 2 and 96' })
  }

  const roll = Math.floor(Math.random() * 10000) / 100  // 0.00–99.99
  const multiplier = 98 / winChance
  const won = roll < winChance
  const payout = won ? bet * multiplier : 0

  return { roll, won, multiplier, payout, winChance}
}
