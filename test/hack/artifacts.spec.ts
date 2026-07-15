import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  OP_TEMPLATES,
  rollOpReward,
  artifactRarityTable,
  collectBonuses,
  ARTIFACT_VALUE,
  AGENT_TRAIT_RANGES,
  AGENT_TRAIT_LABEL,
  RARITY_LABEL,
  RARITY_ORDER,
  formatArtifactAdd,
  type AgentClass,
  type AgentTraitType,
  type ItemMod,
} from '../../shared/utils/hack-config'

const TEST_AGENT = { level: 50, class: 'bruteforce' as AgentClass, items: [] as Array<{ mods: ItemMod[] }> }
const TOTAL_POWER = 999_999

// Deterministic mock that drives rollOpReward down a predictable path:
// success roll, cash roll, gem roll, item roll and artifact-count roll all
// return 0.99, so every op succeeds, rolls max cash, and gets the maximum
// artifact count for its duration. Artifact rolls alternate 0.99 for the
// rarity picker (top rarity of the op's tier) and typeIdx/7 for the trait
// type, so the artifacts cycle through every trait type.
let randomCall = 0
function mockRandom() {
  const c = randomCall++
  if (c <= 4) return 0.99
  const isRarity = (c - 5) % 2 === 0
  if (isRarity) return 0.99
  const typeIdx = Math.floor((c - 6) / 2) % 7
  return (typeIdx + 0.5) / 7
}

function resetRandom() {
  randomCall = 0
  vi.spyOn(Math, 'random').mockImplementation(mockRandom)
}

describe('artifact drops', () => {
  beforeEach(resetRandom)
  afterEach(() => vi.restoreAllMocks())

  it('prints deterministic artifact drops for every op', () => {
    const rows = OP_TEMPLATES.map(template => {
      randomCall = 0
      const reward = rollOpReward(template, [TEST_AGENT], TOTAL_POWER, false)
      const totalCount = reward.artifacts.reduce((s, a) => s + a.count, 0)
      const first = reward.artifacts[0]
      return {
        id: template.id,
        hours: +(template.durationMs / 3_600_000).toFixed(1),
        totalArtifacts: totalCount,
        rarity: first ? RARITY_LABEL[first.rarity] : '—',
        trait: first ? AGENT_TRAIT_LABEL[first.type] : '—',
        adds: first ? formatArtifactAdd(first.type, ARTIFACT_VALUE[first.type][first.rarity]).replace('+', '') : '—',
      }
    })
    console.log('\n\nArtifact drops per op (deterministic 0.99 roll, max count):\n')
    console.log(JSON.stringify(rows, null, 2))
    expect(rows.find(r => r.id === 'project_zero')?.totalArtifacts).toBe(0)
    expect(rows.every(r => r.totalArtifacts === 0 || r.rarity !== '—')).toBe(true)
  })

  it('groups rolled artifacts by trait type + rarity', () => {
    const ghost = OP_TEMPLATES.find(t => t.id === 'ghost_protocol')!
    randomCall = 0
    const reward = rollOpReward(ghost, [TEST_AGENT], TOTAL_POWER, false)
    expect(reward.success).toBe(true)
    expect(reward.artifacts.length).toBeGreaterThan(0)
    expect(reward.artifacts.every(a => a.count >= 1)).toBe(true)
    // With the 0.99 mock all rarity rolls are the same, so all grouping is by trait type.
    const total = reward.artifacts.reduce((s, a) => s + a.count, 0)
    expect(total).toBe(Math.floor(0.25 * (ghost.durationMs / 3_600_000) + 0.99))
  })

  it('respects the artifact rarity table per op tier', () => {
    expect(artifactRarityTable('port_scan')).toEqual({ ghost: 60, operative: 30, specialist: 10, elite: 0, phantom: 0 })
    expect(artifactRarityTable('bank_skim')).toEqual({ ghost: 0, operative: 60, specialist: 30, elite: 10, phantom: 0 })
    expect(artifactRarityTable('telecom_tap')).toEqual({ ghost: 0, operative: 0, specialist: 60, elite: 30, phantom: 10 })
    expect(artifactRarityTable('quantum_heist')).toEqual({ ghost: 0, operative: 0, specialist: 0, elite: 60, phantom: 40 })
    expect(artifactRarityTable('project_zero')).toEqual({ ghost: 0, operative: 0, specialist: 0, elite: 60, phantom: 40 })
    expect(artifactRarityTable('unknown-op')).toBe(null)
  })

  it('keeps every artifact magnitude within the same units as the trait it targets, never overshooting the full range in one apply', () => {
    // Regression: gem_chance is stored as a 0-1 fraction (0.005-0.05) while every
    // other percent trait stores a plain percentage number — a magnitude table
    // using percentage-point units for gem_chance overshot the entire range on a
    // single Ghost apply and rendered as "+20.0%" instead of "+0.2%".
    for (const type of Object.keys(ARTIFACT_VALUE) as AgentTraitType[]) {
      const range = AGENT_TRAIT_RANGES[type]
      const gap = range.max - range.min
      for (const rarity of RARITY_ORDER) {
        expect(ARTIFACT_VALUE[type][rarity]).toBeLessThan(gap)
      }
    }
  })

  it('never displays a nonzero artifact add as +0', () => {
    // Regression: gem_bonus's smallest magnitudes (0.05 Ghost) rounded to "+0 gems"
    // when formatted with the whole-number formatTraitValue instead of formatArtifactAdd.
    for (const type of Object.keys(ARTIFACT_VALUE) as AgentTraitType[]) {
      for (const rarity of RARITY_ORDER) {
        const add = ARTIFACT_VALUE[type][rarity]
        expect(formatArtifactAdd(type, add)).not.toMatch(/^\+0(\.0+)?[^.\d]/)
      }
    }
  })

  it('closes a floor-rolled gem_chance trait in ~5 Phantom applications, matching PLAN.md §4', () => {
    const range = AGENT_TRAIT_RANGES.gem_chance
    const gap = range.max - range.min
    const phantomAdd = ARTIFACT_VALUE.gem_chance.phantom
    expect(Math.round(gap / phantomAdd)).toBe(5)
  })

  it('always pays out a whole number of bonus gems, even from a fractionally-stacked Bonus Gems artifact trait', () => {
    // Regression: gems are never fractional anywhere else in the game, but a Bonus
    // Gems Artifact accumulates in fractional steps (e.g. Ghost +0.05), so a
    // partially-stacked trait like { gem_bonus: 1.65 } used to leak straight into
    // the gems payout and the pre-deploy preview as "1.65 gems".
    const agent = { level: 1, class: 'bruteforce' as AgentClass, traits: [{ type: 'gem_bonus' as AgentTraitType, value: 1.65 }], items: [] as Array<{ mods: ItemMod[] }> }
    const bonuses = collectBonuses([agent])
    expect(bonuses.gemBonus).toBe(2)
    expect(Number.isInteger(bonuses.gemBonus)).toBe(true)
  })
})
