import { describe, expect, it } from 'vitest'
import {
  applyPrestigeCreditBonus,
  prestigeBonusMultiplier,
  prestigeBonusPercent,
  prestigeTitle
} from '../../shared/utils/prestige'

describe('prestige credit bonus', () => {
  it.each([
    [0, 1, 0, 'Unprestiged'],
    [1, 1.05, 5, 'Radiant'],
    [2, 1.1, 10, 'Ascendant'],
    [3, 1.15, 15, 'Mythic']
  ])('maps prestige level %i to its benefits', (level, multiplier, percent, title) => {
    expect(prestigeBonusMultiplier(level)).toBe(multiplier)
    expect(prestigeBonusPercent(level)).toBe(percent)
    expect(prestigeTitle(level)).toBe(title)
  })

  it('adds five percent per prestige level to wallet credits', () => {
    expect(applyPrestigeCreditBonus('100.0000', 1, 'miner')).toBe('105.0000')
    expect(applyPrestigeCreditBonus('100.0000', 2, 'pirates')).toBe('110.0000')
    expect(applyPrestigeCreditBonus('100.0000', 3, 'lootbox')).toBe('115.0000')
  })

  it('never boosts reversible wallet conversions', () => {
    expect(applyPrestigeCreditBonus('100.0000', 3, 'bank')).toBe('100.0000')
    expect(applyPrestigeCreditBonus('100.0000', 3, 'gem market')).toBe('100.0000')
  })

  it('can explicitly exclude wager settlements', () => {
    expect(applyPrestigeCreditBonus('100.0000', 3, 'dice', false)).toBe('100.0000')
    expect(applyPrestigeCreditBonus('100.0000', 3, 'blackjack', false)).toBe('100.0000')
  })

  it('clamps levels above the maximum', () => {
    expect(applyPrestigeCreditBonus('100.0000', 99, 'miner')).toBe('115.0000')
  })
})
