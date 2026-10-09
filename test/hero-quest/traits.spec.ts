/**
 * Traits (`traits.md`) and the evasion they bring into combat (`classes-and-combat.md` §7).
 *
 * The tables are transcribed, so the specs pin the transcription; the rules — locking, the roll's
 * price, Sets as totals at a count, who each line reaches — are pinned as behaviour; and evasion is
 * checked where it lives: the seeded fight, the idle rate and GPN.
 */

import { describe, expect, it } from 'vitest'
import { makeHero, makeParty } from '../../scripts/hero-quest/sim'
import {
    MAX_EVASION,
    MAX_TRAIT_SAVE_SLOTS,
    TRAIT_GRADE_RATES,
    TRAIT_SET_TIERS,
    TRAIT_SLOT_COUNT,
    TRAIT_STAT_VALUES
} from '#shared/utils/hero-quest/constants'
import { TRAIT_GRADES, TRAIT_SETS, TRAIT_STATS } from '#shared/utils/hero-quest/content/traits'
import {
    activeTraitSets,
    canRollTraits,
    emptyTraitBoard,
    lockedCount,
    rerollTraitBoard,
    rollTrait,
    traitBoardOf,
    traitGradeFromRoll,
    traitModifiers,
    traitRollCost,
    traitSaveSlotsAt,
    traitSetTier,
    traitValue,
    type TraitSlotState
} from '#shared/utils/hero-quest/traits'
import { deriveUnitStats, economyBonuses, heroStatBlock, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { noModifiers } from '#shared/utils/hero-quest/modifiers'
import { runFight } from '#shared/utils/hero-quest/fight'
import { secondsToDie, enemyPackAt } from '#shared/utils/hero-quest/settle'
import { globalPower, memberEhp } from '#shared/utils/hero-quest/power'
import { partyDps } from '#shared/utils/hero-quest/combat'
import { partyAbilityDpsByUnit } from '#shared/utils/hero-quest/projection'
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
    it('weights the nine grades exactly as the Acquisition table, summing to 100%', () => {
        expect(TRAIT_GRADES).toEqual(['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'])
        const total = TRAIT_GRADES.reduce((sum, grade) => sum + TRAIT_GRADE_RATES[grade], 0)
        expect(total).toBeCloseTo(100, 10)
        expect(TRAIT_GRADE_RATES).toEqual({ F: 19, E: 37.7, D: 28.3, C: 9.5, B: 4.7, A: 0.5, S: 0.2, SS: 0.07, SSS: 0.03 })
    })

    it('reads a draw onto the cumulative grade table', () => {
        expect(traitGradeFromRoll(0)).toBe('F')
        expect(traitGradeFromRoll(0.189)).toBe('F')
        expect(traitGradeFromRoll(0.191)).toBe('E')
        expect(traitGradeFromRoll(0.5)).toBe('E')
        expect(traitGradeFromRoll(0.8)).toBe('D')
        expect(traitGradeFromRoll(0.9)).toBe('C')
        expect(traitGradeFromRoll(0.95)).toBe('B')
        expect(traitGradeFromRoll(0.995)).toBe('A')
        expect(traitGradeFromRoll(0.9985)).toBe('S')
        expect(traitGradeFromRoll(0.9995)).toBe('SS')
        expect(traitGradeFromRoll(0.99985)).toBe('SSS')
    })

    it('transcribes every stat\'s value table, rising with the grade', () => {
        expect(Object.keys(TRAIT_STAT_VALUES).sort()).toEqual(TRAIT_STATS.map(stat => stat.id).sort())
        for (const stat of TRAIT_STATS) {
            const values = TRAIT_GRADES.map(grade => traitValue(stat.id, grade))
            for (let i = 1; i < values.length; i++) expect(values[i]!, `${stat.id} ${TRAIT_GRADES[i]}`).toBeGreaterThan(values[i - 1]!)
        }
        // spot checks against `traits.md` §4, one per table
        expect(traitValue('trait_atk', 'SSS')).toBe(6)
        expect(traitValue('trait_spd', 'F')).toBe(0.01)
        expect(traitValue('trait_hp', 'A')).toBe(0.23)
        expect(traitValue('trait_champion_atk', 'SSS')).toBe(5)
        expect(traitValue('trait_hero_skill_dmg', 'D')).toBe(0.35)
        expect(traitValue('trait_lck', 'SS')).toBe(0.09)
        expect(traitValue('trait_imp', 'SSS')).toBe(7.5)
        expect(traitValue('trait_exp_gain', 'C')).toBe(0.16)
    })

    it('rolls stat and Set uniformly, each from its own draw', () => {
        // eighths walk the stats in order, fifths the Sets
        const stats = TRAIT_STATS.map((_, i) => rollTrait(sequence([(i + 0.5) / 8, 0.5, 0.1])).stat)
        expect(stats).toEqual(TRAIT_STATS.map(stat => stat.id))
        const sets = TRAIT_SETS.map((_, i) => rollTrait(sequence([0.1, 0.5, (i + 0.5) / 5])).set)
        expect(sets).toEqual(TRAIT_SETS.map(set => set.id))
        expect(rollTrait(sequence([0.1, 0.9999, 0.1])).grade).toBe('SSS')
    })

    it('lands every grade near its rate over many real rolls', () => {
        const counts = Object.fromEntries(TRAIT_GRADES.map(grade => [grade, 0])) as Record<TraitGrade, number>
        const n = 20_000
        for (let i = 0; i < n; i++) counts[rollTrait().grade]++
        // the three common grades, within a generous band so the spec never flakes
        expect(counts.E / n).toBeGreaterThan(0.34)
        expect(counts.E / n).toBeLessThan(0.41)
        expect(counts.F / n).toBeGreaterThan(0.16)
        expect(counts.D / n).toBeGreaterThan(0.25)
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

    it('opens one save slot and sells up to four', () => {
        expect([0, 1, 2, 3, 4].map(traitSaveSlotsAt)).toEqual([1, 2, 3, 4, MAX_TRAIT_SAVE_SLOTS])
    })
})

describe('Trait Sets', () => {
    it('gives a Set its total at a count, not the tiers added up', () => {
        expect(traitSetTier('set_deep_impact', 3)?.magnitude).toBe(12)
        const imp = traitModifiers(setOf('set_deep_impact', 3)).party.filter(line => line.stat === 'imp')
        expect(imp.reduce((sum, line) => sum + line.magnitude, 0)).toBe(12)
    })

    it('starts each Set at its own first count, and holds the top tier past its last', () => {
        expect(traitSetTier('set_aggression', 1)).toBeNull()
        expect(traitSetTier('set_aggression', 2)?.magnitude).toBe(0.10)
        expect(traitSetTier('set_aggression', 5)?.magnitude).toBe(0.30)
        expect(traitSetTier('set_back_to_basics', 2)).toBeNull()
        // 3/4/5, the corrected reading of the doc's 3/5/5
        expect(TRAIT_SET_TIERS.set_back_to_basics.map(t => t.pieces)).toEqual([3, 4, 5])
        expect(traitSetTier('set_back_to_basics', 4)?.magnitude).toBe(1)
        expect(traitSetTier('set_vital_reflex', 2)?.magnitude).toBe(0.10)
        expect(traitSetTier('set_vital_reflex', 4)?.magnitude).toBe(0.25)
        expect(traitSetTier('set_vital_reflex', 5)?.magnitude).toBe(0.50)
        expect(traitSetTier('set_deep_impact', 5)?.magnitude).toBe(12)
        expect(traitSetTier('set_divine_blessing', 5)?.magnitude).toBe(0.05)
    })

    it('runs several Sets at once when each meets its own count', () => {
        const rolls = [...setOf('set_deep_impact', 2), ...setOf('set_aggression', 2), ...setOf('set_vital_reflex', 1)]
        expect(activeTraitSets(rolls).map(bonus => [bonus.set, bonus.magnitude])).toEqual([
            ['set_vital_reflex', 0.10],
            ['set_aggression', 0.10],
            ['set_deep_impact', 8]
        ])
    })

    it('counts a Set whatever the slots rolled', () => {
        const rolls = [roll('trait_atk', 'SSS', 'set_aggression'), roll('trait_lck', 'F', 'set_aggression')]
        expect(activeTraitSets(rolls)).toEqual([{ set: 'set_aggression', pieces: 2, tier: 0, magnitude: 0.10 }])
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
        expect(units[0]!.skillDamageFactor).toBeCloseTo(7, 10)
        for (const c of units.slice(1)) expect(c.skillDamageFactor).toBe(1)
        // and the idle rate prices the Hero's abilities off it
        const base = party([])
        const boosted = party([roll('trait_hero_skill_dmg', 'SSS', 'set_divine_blessing')])
        const heroDps = (h: HeroSnapshot) => partyAbilityDpsByUnit(h, partyUnitStats(h), 0, 1)[0]!
        if (heroDps(base).gt(0)) expect(heroDps(boosted).div(heroDps(base)).toNumber()).toBeGreaterThan(1)
    })

    it('adds EXP Gain to the XP rate', () => {
        expect(economyBonuses(makeHero('class_beginner', 10, { traits: [roll('trait_exp_gain', 'SSS', 'set_aggression')] })).xpPct).toBe(1)
    })

    it('sums a Trait with the other sources of the same line rather than compounding', () => {
        const traits = [roll('trait_atk', 'A', 'set_divine_blessing'), roll('trait_atk', 'A', 'set_divine_blessing')]
        const hero = partyUnitStats(makeHero('class_beginner', 40, { traits }))[0]!
        const bare = partyUnitStats(makeHero('class_beginner', 40))[0]!
        // +100% and +100% is ×3, not ×4
        expect(hero.pwr.div(bare.pwr).toNumber()).toBeCloseTo(3, 6)
    })

    it('gives every member Vital Reflex\'s Evasion Rate, and the Divine Blessing regeneration', () => {
        const units = partyUnitStats(party([...setOf('set_vital_reflex', 4), roll('trait_exp_gain', 'F', 'set_divine_blessing')]))
        for (const unit of units) {
            expect(unit.eva).toBeCloseTo(0.25, 10)
            expect(unit.regenPerSecond).toBeCloseTo(0.05, 10)
        }
    })

    it('multiplies basic attacks with Back to Basics, and nothing else', () => {
        const traits = setOf('set_back_to_basics', 5)
        const unit = partyUnitStats(makeHero('class_beginner', 40, { traits }))[0]!
        const bare = partyUnitStats(makeHero('class_beginner', 40))[0]!
        expect(unit.basicAttackFactor).toBe(3)
        expect(partyDps([unit], 0).div(partyDps([bare], 0)).toNumber()).toBeCloseTo(3, 6)
        expect(unit.skillDamageFactor).toBe(1)
    })
})

describe('evasion', () => {
    it('clamps a unit\'s Evasion Rate at MAX_EVASION, whatever the sources add up to', () => {
        const block = heroStatBlock('class_beginner', 10)
        const unit = deriveUnitStats(block, { strikesPerAttack: 1, row: 'front' }, 0, { ...noModifiers(), evasion: 0.9 })
        expect(unit.eva).toBe(MAX_EVASION)
        // a full Vital Reflex board sits ten points under the cap
        expect(partyUnitStats(makeHero('class_beginner', 10, { traits: setOf('set_vital_reflex', 5) }))[0]!.eva).toBeCloseTo(0.5, 10)
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

    it('misses about half the hits at 50% EVA, over many fights', () => {
        let hits = 0
        let misses = 0
        for (let seed = 1; seed <= 40; seed++) {
            const fight = runFight({ hero: makeHero('class_beginner', 1, { traits: setOf('set_vital_reflex', 5) }), position: gate(), seed })
            for (const e of fight.events) {
                if (e.kind !== 'enemy_attack') continue
                if (e.miss) misses++
                else hits++
            }
        }
        expect(misses / (hits + misses)).toBeGreaterThan(0.4)
        expect(misses / (hits + misses)).toBeLessThan(0.6)
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

    it('counts the evasion term in GPN, capped at ×2.5', () => {
        const unit = partyUnitStats(makeHero('class_beginner', 20))[0]!
        expect(memberEhp({ ...unit, eva: 0.5 }).div(memberEhp(unit)).toNumber()).toBeCloseTo(2, 10)
        const bare = globalPower(makeHero('class_beginner', 20)).ehp
        const reflex = globalPower(makeHero('class_beginner', 20, { traits: setOf('set_vital_reflex', 5) })).ehp
        // ×2 from evasion, and more from Vital Reflex's VIT on top
        expect(reflex.div(bare).toNumber()).toBeGreaterThan(2)
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

    it('extends the idle rate\'s time to die', () => {
        const pack = enemyPackAt(gate(1, 3))
        const units = partyUnitStats(makeHero('class_beginner', 5))
        const blessed = partyUnitStats(makeHero('class_beginner', 5, { traits: [roll('trait_exp_gain', 'F', 'set_divine_blessing')] }))
        expect(secondsToDie(blessed, pack)).toBeGreaterThan(secondsToDie(units, pack))
    })
})
