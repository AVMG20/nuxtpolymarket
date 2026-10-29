/**
 * Traits (`traits.md`) and the evasion they bring into combat (`classes-and-combat.md` §7): the
 * rules — locking, the roll's price, the Auto Roll reserve, Sets as totals at a count, who each line
 * reaches — and evasion where it lives, in the seeded fight and the idle rate.
 */

import { describe, expect, it } from 'vitest'
import { makeHero, makeParty } from '../../scripts/hero-quest/sim'
import {
    MAX_EVASION,
    TRAIT_AUTO_ROLL_RESERVE,
    TRAIT_GRADE_RATES,
    TRAIT_SLOT_COUNT
} from '#shared/utils/hero-quest/constants'
import { TRAIT_GRADES, TRAIT_SETS, TRAIT_STATS } from '#shared/utils/hero-quest/content/traits'
import {
    activeTraitSets,
    autoRollTraitBoard,
    canRollTraits,
    emptyTraitBoard,
    lockedCount,
    rerollTraitBoard,
    rollTrait,
    traitBoardOf,
    traitGradeFromRoll,
    traitModifiers,
    traitRollCost,
    traitSetTier,
    type TraitSlotState
} from '#shared/utils/hero-quest/traits'
import { deriveUnitStats, heroStatBlock, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { noModifiers } from '#shared/utils/hero-quest/modifiers'
import { runFight } from '#shared/utils/hero-quest/fight'
import { secondsToDie, enemyPackAt } from '#shared/utils/hero-quest/settle'
import { D } from '#shared/utils/hero-quest/numbers'
import type { HeroSnapshot, RunPosition, TraitGrade, TraitRoll, TraitSetId, TraitStatId } from '#shared/utils/hero-quest/types'

/** A uniform draw that walks a fixed sequence, so a roll can be checked draw by draw. */
function sequence(values: readonly number[]): () => number {
    let i = 0
    return () => values[i++ % values.length]!
}

const roll = (stat: TraitStatId, grade: TraitGrade, set: TraitSetId): TraitRoll => ({ stat, grade, set })
/** `n` slots all carrying `set`, on a stat with no combat effect, so only the Set moves anything. */
const setOf = (set: TraitSetId, n: number): TraitRoll[] => Array.from({ length: n }, () => roll('trait_exp_gain', 'F', set))

const gate = (world = 1, stage = 5): RunPosition => ({ prestige: 0, world, stage, killsInStage: 0 })

describe('the roll tables', () => {
    it('weights the grades to exactly 100%', () => {
        const total = TRAIT_GRADES.reduce((sum, grade) => sum + TRAIT_GRADE_RATES[grade], 0)
        expect(total).toBeCloseTo(100, 10)
    })

    it('reads a draw onto the cumulative grade table', () => {
        expect(traitGradeFromRoll(0)).toBe('F')
        expect(traitGradeFromRoll(0.189)).toBe('F')
        expect(traitGradeFromRoll(0.191)).toBe('E')
        expect(traitGradeFromRoll(0.9995)).toBe('SS')
        expect(traitGradeFromRoll(0.99985)).toBe('SSS')
        expect(traitGradeFromRoll(0.999999)).toBe('SSS')
    })

    it('rolls stat and Set uniformly, each from its own draw', () => {
        // eighths walk the stats in order, fifths the Sets
        const stats = TRAIT_STATS.map((_, i) => rollTrait(sequence([(i + 0.5) / 8, 0.5, 0.1])).stat)
        expect(stats).toEqual(TRAIT_STATS.map(stat => stat.id))
        const sets = TRAIT_SETS.map((_, i) => rollTrait(sequence([0.1, 0.5, (i + 0.5) / 5])).set)
        expect(sets).toEqual(TRAIT_SETS.map(set => set.id))
        expect(rollTrait(sequence([0.1, 0.9999, 0.1])).grade).toBe('SSS')
    })
})

describe('rolling and locking', () => {
    it('prices a Roll by the locked slots, 5 to 30', () => {
        expect([0, 1, 2, 3, 4, 5].map(traitRollCost)).toEqual([5, 10, 15, 20, 25, 30])
    })

    it('fills all five empty slots on the first Roll, every one unlocked', () => {
        const board = rerollTraitBoard(emptyTraitBoard())
        expect(board).toHaveLength(TRAIT_SLOT_COUNT)
        expect(board.every(slot => slot && !slot.locked)).toBe(true)
    })

    it('leaves a locked slot exactly as it was, and rerolls the rest', () => {
        const kept: TraitSlotState = { ...roll('trait_atk', 'SSS', 'set_aggression'), locked: true }
        const before = [kept, ...Array.from({ length: 4 }, () => ({ ...roll('trait_lck', 'F', 'set_deep_impact'), locked: false }))]
        // every draw lands on the last stat, a high grade and the last Set
        const after = rerollTraitBoard(before, sequence([0.99, 0.95, 0.99]))
        expect(after[0]).toEqual(kept)
        for (const slot of after.slice(1)) {
            expect(slot).toEqual({ stat: 'trait_exp_gain', grade: 'B', set: 'set_back_to_basics', locked: false })
        }
    })

    it('refuses a Roll with every slot locked, since it would change nothing', () => {
        const board = rerollTraitBoard(emptyTraitBoard()).map(slot => ({ ...slot, locked: true }))
        expect(lockedCount(board)).toBe(5)
        expect(canRollTraits(board)).toBe(false)
        expect(canRollTraits(board.map((slot, i) => i === 2 ? { ...slot, locked: false } : slot))).toBe(true)
    })

    it('reads a stored board back by slot index, dropping anything that is not a known Trait', () => {
        const board = traitBoardOf([
            { slotIndex: 3, stat: 'trait_imp', grade: 'S', setId: 'set_deep_impact', locked: true },
            { slotIndex: 1, stat: 'trait_renamed', grade: 'S', setId: 'set_deep_impact', locked: false },
            { slotIndex: 9, stat: 'trait_imp', grade: 'S', setId: 'set_deep_impact', locked: false }
        ])
        expect(board).toEqual([null, null, null, { stat: 'trait_imp', grade: 'S', set: 'set_deep_impact', locked: true }, null])
    })

    describe('Auto Roll', () => {
        const unlockedBoard = () => Array.from({ length: TRAIT_SLOT_COUNT }, () => ({ ...roll('trait_lck', 'F', 'set_deep_impact'), locked: false }))

        it('stops on the first Roll that lands a slot at the grade, paying for each Roll', () => {
            // every draw near 1: the last stat and Set, and SSS
            const run = autoRollTraitBoard(unlockedBoard(), TRAIT_AUTO_ROLL_RESERVE + 100, 'S', 1000, () => 0.99999)
            expect(run).toMatchObject({ rolls: 1, spent: 5, stoppedBy: 'hit' })
            expect(run.board.every(slot => slot?.grade === 'SSS')).toBe(true)
        })

        it('stops when the next Roll would dip into the reserve, or at the cap', () => {
            // every draw at 0.5: grade E, never S
            expect(autoRollTraitBoard(unlockedBoard(), TRAIT_AUTO_ROLL_RESERVE + 23, 'S', 1000, () => 0.5)).toMatchObject({ rolls: 4, spent: 20, stoppedBy: 'reserve' })
            expect(autoRollTraitBoard(unlockedBoard(), 1000, 'S', 7, () => 0.5)).toMatchObject({ rolls: 7, spent: 35, stoppedBy: 'cap' })
            expect(autoRollTraitBoard(unlockedBoard(), TRAIT_AUTO_ROLL_RESERVE + 4, 'S', 1000, () => 0.5)).toMatchObject({ rolls: 0, spent: 0, stoppedBy: 'reserve' })
        })

        it('keeps the reserve whole, and tells a short balance from one held back by the reserve', () => {
            // a Roll fits but would eat into the reserve; then not even a Roll fits
            expect(autoRollTraitBoard(unlockedBoard(), TRAIT_AUTO_ROLL_RESERVE, 'S', 1000, () => 0.5)).toMatchObject({ rolls: 0, stoppedBy: 'reserve' })
            expect(autoRollTraitBoard(unlockedBoard(), 4, 'S', 1000, () => 0.5)).toMatchObject({ rolls: 0, spent: 0, stoppedBy: 'gems' })
            const run = autoRollTraitBoard(unlockedBoard(), TRAIT_AUTO_ROLL_RESERVE + 5, 'S', 1000, () => 0.5)
            expect(run).toMatchObject({ rolls: 1, spent: 5, stoppedBy: 'reserve' })
        })

        it('prices every Roll by the locks, never rerolls a locked slot, and never stops on one', () => {
            const board = unlockedBoard()
            board[2] = { ...roll('trait_atk', 'SSS', 'set_aggression'), locked: true }
            const run = autoRollTraitBoard(board, TRAIT_AUTO_ROLL_RESERVE + 30, 'S', 1000, () => 0.5)
            expect(run).toMatchObject({ rolls: 3, spent: 30, stoppedBy: 'reserve' })
            expect(run.board[2]).toEqual(board[2])
        })
    })
})

describe('Trait Sets', () => {
    it('gives a Set its total at a count, not the tiers added up', () => {
        expect(traitSetTier('set_deep_impact', 3)?.magnitude).toBe(3)
        const imp = traitModifiers(setOf('set_deep_impact', 3)).party.filter(line => line.stat === 'imp')
        expect(imp.reduce((sum, line) => sum + line.magnitude, 0)).toBe(3)
    })

    it('runs several Sets at once when each meets its own count', () => {
        const rolls = [...setOf('set_deep_impact', 2), ...setOf('set_aggression', 2), ...setOf('set_vital_reflex', 1)]
        expect(activeTraitSets(rolls).map(bonus => [bonus.set, bonus.magnitude])).toEqual([
            ['set_vital_reflex', 0.10],
            ['set_aggression', 0.10],
            ['set_deep_impact', 2]
        ])
    })
})

describe('who a Trait reaches', () => {
    const party = (traits: TraitRoll[]): HeroSnapshot => makeParty('class_beginner', 40, 3, { traits })

    it('lifts the whole party\'s PWR with ATK', () => {
        const [hero, ...champions] = partyUnitStats(party([roll('trait_atk', 'A', 'set_divine_blessing')]))
        const [hero0, ...champions0] = partyUnitStats(party([]))
        expect(hero!.pwr.div(hero0!.pwr).toNumber()).toBeCloseTo(2, 6)
        for (const [i, c] of champions.entries()) expect(c.pwr.div(champions0[i]!.pwr).toNumber()).toBeCloseTo(2, 6)
    })

    it('lifts only the Champions\' PWR with Champion ATK, Tank included', () => {
        const traits = [roll('trait_champion_atk', 'A', 'set_divine_blessing')]
        const [hero, ...champions] = partyUnitStats(party(traits))
        const [hero0, ...champions0] = partyUnitStats(party([]))
        expect(hero!.pwr.eq(hero0!.pwr)).toBe(true)
        // the first stand-in is the Tank
        for (const [i, c] of champions.entries()) expect(c.pwr.div(champions0[i]!.pwr).toNumber()).toBeCloseTo(2, 6)
    })

    it('raises only the Hero\'s skills with Hero Skill DMG', () => {
        const units = partyUnitStats(party([roll('trait_hero_skill_dmg', 'SSS', 'set_divine_blessing')]))
        expect(units[0]!.skillDamageFactor).toBeGreaterThan(1)
        for (const c of units.slice(1)) expect(c.skillDamageFactor).toBe(1)
    })

    it('sums a Trait with the other sources of the same line rather than compounding', () => {
        const traits = [roll('trait_atk', 'A', 'set_divine_blessing'), roll('trait_atk', 'A', 'set_divine_blessing')]
        const hero = partyUnitStats(makeHero('class_beginner', 40, { traits }))[0]!
        const bare = partyUnitStats(makeHero('class_beginner', 40))[0]!
        // +100% and +100% is ×3, not ×4
        expect(hero.pwr.div(bare.pwr).toNumber()).toBeCloseTo(3, 6)
    })
})

describe('evasion', () => {
    it('clamps a unit\'s Evasion Rate at MAX_EVASION, whatever the sources add up to', () => {
        const block = heroStatBlock('class_beginner', 10)
        const unit = deriveUnitStats(block, { strikesPerAttack: 1, row: 'front' }, 0, { ...noModifiers(), evasion: 0.9 })
        expect(unit.eva).toBe(MAX_EVASION)
    })

    it('makes some of the boss\'s hits miss in a seeded fight, and lands nothing on a miss', () => {
        const fight = runFight({ hero: makeHero('class_beginner', 1, { traits: setOf('set_vital_reflex', 5) }), position: gate(), seed: 11 })
        const incoming = fight.events.filter(e => e.kind === 'enemy_attack' || e.kind === 'enemy_special')
        const misses = incoming.filter(e => e.miss)
        expect(incoming.length).toBeGreaterThan(10)
        expect(misses.length).toBeGreaterThan(0)
        expect(misses.length).toBeLessThan(incoming.length)
        for (const miss of misses) expect(miss.damage).toBe('0')
    })

    it('draws no randomness for a party without EVA, so its fights replay exactly as before', () => {
        // EXP Gain on Back-to-nothing Sets: Traits that move no combat number
        const inert = [roll('trait_exp_gain', 'SSS', 'set_aggression')]
        const a = runFight({ hero: makeHero('class_beginner', 30), position: gate(), seed: 5 })
        const b = runFight({ hero: makeHero('class_beginner', 30, { traits: inert }), position: gate(), seed: 5 })
        expect(b.events).toEqual(a.events)
        expect(a.events.some(e => e.miss)).toBe(false)
    })

    it('replays identically from the same seed with EVA in play', () => {
        const input = { hero: makeHero('class_beginner', 1, { traits: setOf('set_vital_reflex', 5) }), position: gate(), seed: 77 }
        expect(runFight(input).events).toEqual(runFight(input).events)
    })

    it('stretches the idle rate\'s time to die by 1 / (1 − EVA)', () => {
        const pack = enemyPackAt(gate(1, 3))
        const units = partyUnitStats(makeHero('class_beginner', 5))
        const evading = units.map(unit => ({ ...unit, eva: 0.5 }))
        expect(secondsToDie(evading, pack) / secondsToDie(units, pack)).toBeCloseTo(2, 6)
    })
})

describe('Divine Blessing in combat', () => {
    it('heals a hurt party member every second in a seeded fight', () => {
        const traits = [roll('trait_exp_gain', 'F', 'set_divine_blessing')]
        const fight = runFight({ hero: makeHero('class_beginner', 1, { traits }), position: gate(), seed: 3 })
        const regen = fight.events.filter(e => e.kind === 'heal' && e.skillId === undefined && !e.onEnemy)
        expect(regen.length).toBeGreaterThan(0)
        for (const heal of regen) expect(D(heal.damage!).gt(0)).toBe(true)
        // never more than once a second per unit
        const times = regen.map(e => e.at)
        expect(new Set(times).size).toBe(times.length)
    })
})
