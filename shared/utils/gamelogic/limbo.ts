import { randomFloat } from '../random'

export interface LimboResult {
  result: number     // generated multiplier
  won: boolean
  target: number
  multiplier: number // same as target
  payout: number
  [key: string]: unknown
}

export function playLimbo(bet: number, options?: Record<string, unknown>): LimboResult {
  const target = Number(options?.target ?? 2)

  if (!Number.isFinite(target) || target < 1.10 || target > 1_000_000) {
    throw createError({ statusCode: 400, message: 'Target must be between 1.01 and 1000000' })
  }

  const rand = randomFloat()

  // RTP = 98%: P(result >= target) = 0.98 / target
  const raw = rand === 0 ? 1_000_000 : 0.98 / rand
  const result = Math.min(Math.floor(raw * 100) / 100, 1_000_000)
  const won = result >= target
  const payout = won ? bet * target : 0

  return { result, won, target, multiplier: target, payout }
}
