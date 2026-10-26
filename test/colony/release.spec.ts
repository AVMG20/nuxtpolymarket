import { describe, expect, it } from 'vitest'
import { BUG_TYPES, REMOVE_REFUND_RATE, bugStackKey, canReleaseBug, getBug, releaseAllButBest, releaseRefund } from '../../shared/utils/colony'

const stack = (typeId: string, speed: number, yield_: number, eat: number, quantity = 1) =>
  ({ typeId, speed, yield: yield_, eat, quantity })

describe('releasing spare bugs', () => {
  const prestige = BUG_TYPES.find(b => b.prestigeOnly)

  it('refunds half the spawn cost per bug, and nothing for prestige grants', () => {
    expect(releaseRefund('larva', 3)).toBe(getBug('larva')!.spawnCost * REMOVE_REFUND_RATE * 3)
    expect(releaseRefund('nope', 1)).toBe(0)
    if (prestige) {
      expect(canReleaseBug(prestige.id)).toBe(false)
      expect(releaseRefund(prestige.id, 1)).toBe(0)
    }
  })

  it('keeps only the best stack of each species', () => {
    const weak = stack('larva', 5, 1, 3, 4)
    const best = stack('larva', 2, 2, 4, 2)
    const fasterSameYield = stack('larva', 9, 1, 2, 1)
    const lone = stack('beetle', 0, 0, 5, 3)
    const picks = releaseAllButBest([weak, best, fasterSameYield, lone])
    expect(picks).toEqual({ [bugStackKey(weak)]: 4, [bugStackKey(fasterSameYield)]: 1 })
  })

  it('never picks prestige species', () => {
    if (!prestige) return
    const picks = releaseAllButBest([stack(prestige.id, 0, 0, 5, 2), stack(prestige.id, 1, 1, 5, 2)])
    expect(picks).toEqual({})
  })
})
