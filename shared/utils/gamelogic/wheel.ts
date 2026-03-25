// shared/utils/gamelogic/wheel.ts

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

// All wheels: 8 segments, RTP = 98% (target sum = 8 × 0.98 = 7.84)
export const WHEEL_CONFIGS: Record<WheelDifficulty, WheelSegment[]> = {
  easy: [
    // 1×0 + 4×1.5 + 2×1.2 + 1×0.44 = 0+6+2.4+0.44 = 8.84 ❌
    // Ugh, let me try target = 7.84 again
    // 2×0 + 4×1.5 + 1×1.5 + 1×0.34 = 0+6+1.5+0.34 = 7.84 ✓ but 0.34 is weird
    // 2×0 + 5×1.4 + 1×0.84 = 0+7+0.84 = 7.84 ✓ — 8 total, 0.84 is "get most back"
    { multiplier: 0,    color: 'red',    count: 2 },
    { multiplier: 0.84, color: 'blue',   count: 1 },
    { multiplier: 1.4,  color: 'blue',   count: 5 },
  ],
  medium: [
    // 3×0 + 3×1.5 + 1×2 + 1×1.34 = 0+4.5+2+1.34 = 7.84 ✓
    { multiplier: 0,    color: 'red',    count: 3 },
    { multiplier: 1.34, color: 'blue',  count: 1 },
    { multiplier: 1.5,  color: 'green',   count: 3 },
    { multiplier: 2,    color: 'yellow', count: 1 },
  ],
  hard: [
    // 5×0 + 1×1.5 + 1×2.5 + 1×3.84 = 0+1.5+2.5+3.84 = 7.84 ✓
    { multiplier: 0,    color: 'red',    count: 5 },
    { multiplier: 1.5,  color: 'blue',   count: 1 },
    { multiplier: 2.5,  color: 'green',  count: 1 },
    { multiplier: 3.84, color: 'yellow',  count: 1 },
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
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  const idx = Math.floor((arr[0]! / 0xFFFFFFFF) * totalSegments)

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
