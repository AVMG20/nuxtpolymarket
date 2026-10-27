import { randomFloat } from '../random'

export interface DiceResult {
  roll: number       // 0.00–99.99
  won: boolean
  multiplier: number // 98 / winChance
  payout: number
  winChance: number
  [key: string]: unknown
}

/** Win chance bounds, in percent */
export const DICE_MIN_CHANCE = 2
export const DICE_MAX_CHANCE = 96

/** 98% RTP: the payout multiplier for a win chance in percent */
export function diceMultiplier(winChance: number): number {
  return 98 / winChance
}

export function playDice(bet: number, options?: Record<string, unknown>): DiceResult {
  const winChance = Number(options?.winChance ?? 50)

  if (!Number.isFinite(winChance) || winChance < DICE_MIN_CHANCE || winChance > DICE_MAX_CHANCE) {
    throw createError({ statusCode: 400, message: `Win chance must be between ${DICE_MIN_CHANCE} and ${DICE_MAX_CHANCE}` })
  }

  const roll = Math.floor(randomFloat() * 10000) / 100  // 0.00–99.99

  const multiplier = diceMultiplier(winChance)
  const won = roll < winChance
  const payout = won ? bet * multiplier : 0

  return { roll, won, multiplier, payout, winChance }
}
