import { randomFloat } from '../random'

export interface LimboResult {
  result: number     // generated multiplier
  won: boolean
  target: number
  multiplier: number // same as target
  payout: number
  [key: string]: unknown
}

/** Target multiplier bounds */
export const LIMBO_MIN_TARGET = 1.1
export const LIMBO_MAX_TARGET = 1_000_000

/** 98% RTP: the chance (0..1) that the result reaches the target */
export function limboWinChance(target: number): number {
  return Math.min(0.98 / target, 0.98)
}

export function playLimbo(bet: number, options?: Record<string, unknown>): LimboResult {
  const target = Number(options?.target ?? 2)

  if (!Number.isFinite(target) || target < LIMBO_MIN_TARGET || target > LIMBO_MAX_TARGET) {
    throw createError({ statusCode: 400, message: `Target must be between ${LIMBO_MIN_TARGET} and ${LIMBO_MAX_TARGET}` })
  }

  const rand = randomFloat()

  // RTP = 98%: P(result >= target) = 0.98 / target
  const raw = rand === 0 ? 1_000_000 : 0.98 / rand
  const result = Math.min(Math.floor(raw * 100) / 100, 1_000_000)
  const won = result >= target
  const payout = won ? bet * target : 0

  return { result, won, target, multiplier: target, payout }
}
