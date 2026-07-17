// shared/utils/gamelogic/wheel.ts

import { randomFloat } from '../random'

export type WheelDifficulty = 'easy' | 'medium' | 'hard'

export interface WheelSegment {
  multiplier: number
  color: 'green' | 'blue' | 'yellow' | 'red'
  count: number
}

export interface WheelResult {
  segmentIndex: number   // index into the segments array that was hit
  multiplier: number     // multiplier of the winning segment
  won: boolean           // true if multiplier > 0 (not a zero/loss segment)
  payout: number
  difficulty: WheelDifficulty
  [key: string]: unknown
}

export const WHEEL_CONFIGS: Record<WheelDifficulty, WheelSegment[]> = {
  // 10 segs — 60% win — max 2×
  easy: [
    { multiplier: 0,   color: 'red',    count: 4 },
    { multiplier: 1.4, color: 'blue',   count: 3 },
    { multiplier: 1.8, color: 'green', count: 2 },
    { multiplier: 2,   color: 'yellow',  count: 1 },
  ],
  // 10 segs — 50% win — max 3×
  medium: [
    { multiplier: 0,   color: 'red',    count: 5 },
    { multiplier: 1.4, color: 'blue',   count: 2 },
    { multiplier: 2,   color: 'green', count: 2 },
    { multiplier: 3,   color: 'yellow',  count: 1 },
  ],
  // 10 segs — 30% win — max 5×
  hard: [
    { multiplier: 0,   color: 'red',    count: 7 },
    { multiplier: 1.8, color: 'blue',   count: 1 },
    { multiplier: 3,   color: 'green', count: 1 },
    { multiplier: 5,   color: 'yellow',  count: 1 },
  ],
}

export function playWheel(bet: number, options?: Record<string, unknown>): WheelResult {
  const difficulty = (options?.difficulty as WheelDifficulty) ?? 'medium'

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw createError({ statusCode: 400, message: 'Difficulty must be easy, medium, or hard' })
  }

  const segments = WHEEL_CONFIGS[difficulty]
  const totalSegments = segments.reduce((s, seg) => s + seg.count, 0)

  // Pick a random segment
  const idx = Math.floor(randomFloat() * totalSegments)

  // Map flat index to segment
  let cursor = 0
  let hitSegmentIndex = 0
  let hitMultiplier = 0
  for (let i = 0; i < segments.length; i++) {
    cursor += segments[i]!.count
    if (idx < cursor) {
      hitSegmentIndex = i
      hitMultiplier = segments[i]!.multiplier
      break
    }
  }

  const won = hitMultiplier > 0
  const payout = won ? bet * hitMultiplier : 0

  return {
    segmentIndex: hitSegmentIndex,
    multiplier: hitMultiplier,
    won,
    payout,
    difficulty,
  }
}
