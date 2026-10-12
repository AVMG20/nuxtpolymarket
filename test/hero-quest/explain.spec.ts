/**
 * The stat breakdown, checked against the stats the game actually fights with.
 *
 * A breakdown is only worth anything if it is describing the real pipeline. The specs that
 * matter most here are the agreement ones: every stat's last stage must equal what
 * `partyUnitStats` computed, for the Hero and for every fielded Champion. If those hold, the
 * attribution in between is a decomposition rather than a second implementation that can drift.
 *
 * The rest cover the two things a reader of the report could otherwise be misled by: that
 * per-source lines stack **additively** (so they must never be multiplied together), and that
 * exactly one stage in the chain is unbounded.
 */

import { describe, expect, it } from 'vitest'
import { explainStats, levelsToCover, stagesOfCurve } from '#shared/utils/hero-quest/explain'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { maxHpFor } from '#shared/utils/hero-quest/combat'
import {
    BASE_HP,
    DPS_STAT_EXPONENT,
    ENEMY_STEP_BASE,
    HP_PER_VIT,
    LCK_BASE_SCALE,
    STAT_PACE_RATIO,
    STAT_PER_LEVEL_GROWTH,
    STAT_PER_LEVEL_GROWTH_PACED,
    STAT_SCALES_WITH_LEVEL
} from '#shared/utils/hero-quest/constants'
import { CHAMPIONS, RARITY_STAT_MULTIPLIER, getChampion } from '#shared/utils/hero-quest/content/champions'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { ChampionSnapshot, HeroSnapshot } from '#shared/utils/hero-quest/types'

function hero(over: Partial<HeroSnapshot> = {}): HeroSnapshot {
    return {
        classId: 'class_beginner',
        heroLevel: 1,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0,
        ...over
    }
}

function fielded(championId: string): ChampionSnapshot {
    const definition = getChampion(championId)
    return {
        championId: definition.id,
        archetype: definition.archetype,
        rarityMultiplier: RARITY_STAT_MULTIPLIER[definition.rarity],
        investment: 1,
        strikesPerAttack: definition.strikesPerAttack,
        row: 'back',
        abilities: definition.abilities
    }
}

describe('agreement with the stats the game fights with', () => {
    const cases: [string, HeroSnapshot][] = [
        ['level-1 solo Beginner', hero()],
        ['level-40 Berserker', hero({ classId: 'class_berserker', heroLevel: 40 })],
        ['level-200 Sorcerer', hero({ classId: 'class_sorcerer', heroLevel: 200 })],
        ['a hero with a collection passive', hero({
            heroLevel: 30,
            ownedChampions: CHAMPIONS.slice(0, 12).map(c => ({ archetype: c.archetype, investment: 20 }))
        })],
        ['a hero with two fielded Champions', hero({
            heroLevel: 60,
            champions: [fielded(CHAMPIONS[0]!.id), fielded(CHAMPIONS[1]!.id)]
        })]
    ]

    for (const [label, snapshot] of cases) {
        it(`reproduces every final stat for ${label}`, () => {
            const explained = explainStats(snapshot)
            const units = partyUnitStats(snapshot)
            expect(explained.units).toHaveLength(units.length)

            explained.units.forEach((unit, index) => {
                const actual = units[index]!
                const find = (key: string) => unit.stats.find(stat => stat.key === key)!

                expect(find('pwr').final.toString(), `${label} #${index} pwr`).toBe(actual.pwr.toString())
                expect(find('def').final.toString(), `${label} #${index} def`).toBe(actual.def.toString())
                expect(find('spd').final.toString(), `${label} #${index} spd`).toBe(actual.spd.toString())
                // VIT is not on `UnitStats` directly — it is the input to max HP, which is.
                expect(maxHpFor(find('vit').final).toString()).toBe(actual.maxHp.toString())
            })
        })
    }

    it('walks the stages so each one lands on the next one\'s starting point', () => {
        const unit = explainStats(hero({ classId: 'class_knight', heroLevel: 75 })).units[0]!
        for (const stat of unit.stats) {
            let running = stat.stages[0]!.running
            expect(running.toString()).toBe(stat.stages[0]!.factor.toString())
            for (const stage of stat.stages.slice(1)) {
                expect(running.mul(stage.factor).toString(), `${stat.key}/${stage.id}`)
                    .toBe(stage.running.toString())
                running = stage.running
            }
            expect(running.toString()).toBe(stat.final.toString())
        }
    })
})

describe('which sources have no ceiling', () => {
    it('marks the level curve for the stats it applies to, and nothing else', () => {
        const unit = explainStats(hero({ heroLevel: 50 })).units[0]!
        for (const stat of unit.stats) {
            const unbounded = stat.stages.filter(stage => stage.unbounded).map(stage => stage.id)
            expect(unbounded, stat.key).toEqual(STAT_SCALES_WITH_LEVEL[stat.key] ? ['level'] : [])
        }
    })

    it('leaves LCK with no compounding source whatsoever', () => {
        // The crit retune, stated as an assertion rather than as a constant. Crit chance is
        // `LCK × rate` clamped to 100%, so any unbounded source behind LCK makes the cap a
        // question of when and never of whether.
        const unit = explainStats(hero({ classId: 'class_marksman', heroLevel: 50 })).units[0]!
        const lck = unit.stats.find(stat => stat.key === 'lck')!
        expect(lck.stages.some(stage => stage.unbounded)).toBe(false)
    })

    it('holds LCK still across 400 levels while PWR runs away', () => {
        const finals = (heroLevel: number) => {
            const unit = explainStats(hero({ classId: 'class_marksman', heroLevel })).units[0]!
            return {
                lck: unit.stats.find(stat => stat.key === 'lck')!.final,
                pwr: unit.stats.find(stat => stat.key === 'pwr')!.final
            }
        }
        const early = finals(1)
        const late = finals(400)

        expect(late.lck.toString()).toBe(early.lck.toString())
        expect(late.pwr.gt(early.pwr.mul(100))).toBe(true)
    })
})

describe('per-source lines stack additively', () => {
    /**
     * The trap the report is shaped around. `sumModifiers` sums fractions and converts once, so
     * two +50% lines are ×2.00 and never ×2.25 — a breakdown that reported each source as its own
     * multiplier would invite the reader to compute the wrong number.
     */
    it('reports the passive stage as one factor over additive parts', () => {
        const unit = explainStats(hero({ heroLevel: 20 })).units[0]!
        for (const stat of unit.stats) {
            const passives = stat.stages.find(stage => stage.id === 'passives')!
            const summed = passives.parts.reduce((total, part) => total + part.amount, 0)
            expect(passives.factor.toNumber()).toBeCloseTo(1 + summed, 10)
        }
    })

    it('reports the collection stage the same way', () => {
        const unit = explainStats(hero({
            heroLevel: 20,
            ownedChampions: CHAMPIONS.slice(0, 8).map(c => ({ archetype: c.archetype, investment: 15 }))
        })).units[0]!
        for (const stat of unit.stats) {
            const collection = stat.stages.find(stage => stage.id === 'collection')!
            const summed = collection.parts.reduce((total, part) => total + part.amount, 0)
            expect(collection.factor.toNumber()).toBeCloseTo(1 + summed, 10)
        }
    })
})

describe('the common denominator — stages of enemy curve', () => {
    it('prices one level at exactly STAT_PACE_RATIO stages, which is its definition', () => {
        // `STAT_PER_LEVEL_GROWTH = ENEMY_STEP_BASE^(STAT_PACE_RATIO / DPS_STAT_EXPONENT)`, so
        // converting it back through the same exponent must return the ratio. This is the spec
        // that keeps the report honest if either constant moves.
        expect(stagesOfCurve(STAT_PER_LEVEL_GROWTH)).toBeCloseTo(STAT_PACE_RATIO, 10)
        expect(explainStats(hero()).pacing.stagesPerLevel).toBeCloseTo(STAT_PACE_RATIO, 10)
    })

    it('reports the reciprocal too, because that is the readable direction', () => {
        const pacing = explainStats(hero()).pacing
        expect(pacing.levelsPerStage).toBeCloseTo(1 / STAT_PACE_RATIO, 10)
        expect(levelsToCover(10)).toBeCloseTo(10 / STAT_PACE_RATIO, 10)
    })

    it('prices a flat multiplier against the same curve', () => {
        // A ×1.36 collection passive, at the asymptotic exponent, in the unit everything else
        // is measured in.
        const stages = stagesOfCurve(1.36)
        expect(stages).toBeCloseTo(Math.log(1.36) * DPS_STAT_EXPONENT / Math.log(ENEMY_STEP_BASE), 10)
        expect(stages).toBeGreaterThan(0)
    })

    it('is zero rather than infinite for a factor that cannot be priced', () => {
        expect(stagesOfCurve(0)).toBe(0)
        expect(stagesOfCurve(Number.NaN)).toBe(0)
    })
})

describe('what the base spread was built from', () => {
    it('itemises the class path rather than reporting one folded integer', () => {
        // Berserker inherits Warrior's and Barbarian's shifts, so its PWR is three numbers, not
        // one — which is the difference between "is 22 right?" and "is +8 on top of +4 right?".
        const pwr = explainStats(hero({ classId: 'class_berserker' })).units[0]!
            .stats.find(stat => stat.key === 'pwr')!
        const base = pwr.stages[0]!
        expect(base.parts.length).toBeGreaterThan(1)
        expect(base.parts.reduce((total, part) => total + part.amount, 0))
            .toBeCloseTo(base.factor.toNumber(), 10)
    })

    it('scales LCK down as its own line rather than folding it into the tier', () => {
        // `LCK_BASE_SCALE` is multiplicative and every other part of the base stage is in
        // points, so it is carried as the points it removed. That keeps "the parts sum to the
        // value" true for all six stats, which is the only reason the panel can render one
        // template per stat.
        const lck = explainStats(hero({ classId: 'class_marksman' })).units[0]!
            .stats.find(stat => stat.key === 'lck')!
        const base = lck.stages[0]!

        expect(base.parts.at(-1)!.label).toContain(String(LCK_BASE_SCALE))
        expect(base.parts.reduce((total, part) => total + part.amount, 0))
            .toBeCloseTo(base.factor.toNumber(), 10)
        expect(base.formula).toContain(`× ${LCK_BASE_SCALE}`)
    })

    it('gives a Champion no class path at all', () => {
        // `champions-guild-gacha.md` §1: Champions never touch the 16-node class tree, so there
        // is no ancestor to inherit a specialization shift from. A base-scale line is not one —
        // it is a global scalar, not an inherited shift — so it is excluded rather than counted.
        const champion = explainStats(hero({
            heroLevel: 10,
            champions: [fielded(CHAMPIONS[0]!.id)]
        })).units[1]!
        for (const stat of champion.stats) {
            expect(stat.stages[0]!.parts.filter(part => part.label.includes('specialization')))
                .toHaveLength(0)
        }
        expect(champion.stats[0]!.stages.map(stage => stage.id))
            .toEqual(['base', 'level', 'investment', 'passives'])
    })
})

describe('the derived values', () => {
    it('says when a flat constant is still carrying the HP pool', () => {
        // `BASE_HP` is the one flat term meeting a compounding curve, and at level 1 it is most
        // of the pool. That is a scaling fact, so the breakdown states it rather than leaving it
        // to be inferred from the arithmetic.
        const opening = explainStats(hero()).units[0]!
        const early = opening.derived.find(d => d.key === 'maxHp')!
        expect(early.note).toMatch(/BASE_HP/)

        // The level at which the compounding half of the pool — VIT on the defensive curve —
        // overtakes the flat half. Derived rather than pinned, because it is precisely what a
        // retune of `BASE_HP` moves.
        const baseVit = opening.stats.find(stat => stat.key === 'vit')!.final.toNumber()
        const parityLevel = 1 + Math.ceil(
            Math.log(BASE_HP / (baseVit * HP_PER_VIT)) / Math.log(STAT_PER_LEVEL_GROWTH_PACED)
        )

        const late = explainStats(hero({ heroLevel: parityLevel })).units[0]!.derived.find(d => d.key === 'maxHp')!
        expect(late.note).toBeUndefined()
    })

    it('says when attack rate has stopped paying for SPD', () => {
        const capped = explainStats(hero({ heroLevel: 400 })).units[0]!
            .derived.find(d => d.key === 'attacksPerSecond')!
        expect(capped.note).toMatch(/MIN_ATTACK_INTERVAL_SECONDS/)
    })

    it('says when crit chance has hit its ceiling — which now takes a build, not a level', () => {
        // Three maxed Artifacts carrying Precision Edge, out of the five slots §4 allows. That is
        // what reaching 100% costs; levelling to 400 does not come close, which is the whole
        // intent of taking LCK off the curve.
        const built = hero({
            classId: 'class_archer',
            equippedArtifacts: ['artifact_offense_1', 'artifact_offense_7', 'artifact_offense_10']
                .map(contentId => ({ contentId, star: 5, level: 10 }))
        })
        const capped = explainStats(built).units[0]!.derived.find(d => d.key === 'critChance')!
        expect(capped.note).toMatch(/100%/)

        const levelled = explainStats(hero({ classId: 'class_archer', heroLevel: 400 })).units[0]!
            .derived.find(d => d.key === 'critChance')!
        expect(levelled.note).toMatch(/off the level curve/)
    })
})
