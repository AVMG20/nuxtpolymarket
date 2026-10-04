/**
 * Shared gacha mechanics (`gacha-shared-system.md` §2–6).
 *
 * Several of these assert against **figures the doc states outright** — 1,066 dupes to max a
 * copy, ~50,240 cumulative pulls to reach gacha level 10, drop rows summing to 100%. Those
 * are the checks that catch a transcription slip in a table nobody re-derives by hand.
 */

import { describe, expect, it } from 'vitest'
import {
    applyDupes,
    applyPulls,
    craftCostFor,
    dropRatesFor,
    dupesToLevelUp,
    essenceValueFor,
    investmentScalar,
    isMaxed,
    ladderDateKey,
    newEntry,
    pullCost,
    pullsToNextLevel,
    rarityFromRoll,
    sealLadderPrice,
    sealLadderTotal,
    totalDupesToMax
} from '#shared/utils/hero-quest/gacha'
import {
    DROP_RATE_TABLE,
    LEVELS_PER_STAR,
    MAX_GACHA_LEVEL,
    MAX_STAR,
    PULLS_TO_LEVEL_UP,
    SEAL_LADDER_BASE_GOLD,
    TEN_PULL_SIZE
} from '#shared/utils/hero-quest/constants'
import {
    RARITIES,
    championFromRoll,
    championRarityHasContent
} from '#shared/utils/hero-quest/content/champions'
import { gearFromRoll, gearRarityHasContent } from '#shared/utils/hero-quest/content/gear'
import { skillFromRoll, skillRarityHasContent } from '#shared/utils/hero-quest/content/skills'
import { artifactFromRoll, artifactRarityHasContent } from '#shared/utils/hero-quest/content/artifacts'

describe('gacha leveling', () => {
    it('needs the pull counts the doc locks, and ~50,240 in total', () => {
        expect(PULLS_TO_LEVEL_UP.slice(1)).toEqual([10, 30, 100, 200, 600, 1_700, 4_600, 12_000, 31_000])
        expect(PULLS_TO_LEVEL_UP.reduce((sum, value) => sum + value, 0)).toBe(50_240)
    })

    it('advances a level once its threshold is met, carrying the remainder', () => {
        expect(applyPulls(1, 0, 10)).toEqual({ level: 2, progress: 0 })
        expect(applyPulls(1, 0, 12)).toEqual({ level: 2, progress: 2 })
        // 10 to reach 2, then 30 to reach 3 — one call must be able to cross both.
        expect(applyPulls(1, 0, 40)).toEqual({ level: 3, progress: 0 })
    })

    it('stops accumulating at the cap rather than banking pulls forever', () => {
        expect(pullsToNextLevel(MAX_GACHA_LEVEL)).toBeNull()
        expect(applyPulls(MAX_GACHA_LEVEL, 0, 5_000)).toEqual({ level: MAX_GACHA_LEVEL, progress: 0 })
    })
})

describe('drop table', () => {
    it('has every row summing to exactly 100%', () => {
        for (const [level, row] of DROP_RATE_TABLE.entries()) {
            if (row.length === 0) continue
            const sum = row.reduce((total, rate) => total + rate, 0)
            expect(sum, `level ${level}`).toBeCloseTo(100, 9)
        }
    })

    it('offers Common only at level 1, and Mythic only from level 6', () => {
        expect(dropRatesFor(1)[0]).toBe(100)
        expect(dropRatesFor(5)[5]).toBe(0)
        expect(dropRatesFor(6)[5]).toBeGreaterThan(0)
    })

    it('maps a roll onto the cumulative band it falls in', () => {
        expect(rarityFromRoll(1, 0)).toBe('common')
        expect(rarityFromRoll(1, 0.999)).toBe('common')
        // Level 2 is 75% Common / 25% Uncommon.
        expect(rarityFromRoll(2, 0.74)).toBe('common')
        expect(rarityFromRoll(2, 0.76)).toBe('uncommon')
        expect(rarityFromRoll(MAX_GACHA_LEVEL, 0.999)).toBe('mythic')
    })

    it('never returns a rarity the level cannot roll, at either end of the range', () => {
        for (let level = 1; level <= MAX_GACHA_LEVEL; level++) {
            const rates = dropRatesFor(level)
            for (const roll of [0, 0.5, 0.999999, 1]) {
                const rarity = rarityFromRoll(level, roll)
                expect(rates[RARITIES.indexOf(rarity)], `level ${level} roll ${roll}`).toBeGreaterThan(0)
            }
        }
    })
})

/**
 * Every roster populates every rarity — the invariant the drop table rests on.
 *
 * The moment any roster stops covering a rarity, a pull at that rarity throws instead of silently
 * paying out something else, and this is the test that says so before a player finds it. See the
 * drop-table note in `gacha.ts` for how to repair a partial roster.
 */
describe('roster coverage — why no rarity fold is needed', () => {
    const rosters = [
        ['champion', championRarityHasContent, championFromRoll],
        ['gear', gearRarityHasContent, gearFromRoll],
        ['skill', skillRarityHasContent, skillFromRoll],
        ['artifact', artifactRarityHasContent, artifactFromRoll]
    ] as const

    it('populates all six rarities in all four gachas', () => {
        for (const [system, hasContent] of rosters) {
            for (const rarity of RARITIES) {
                expect(hasContent(rarity), `${system} @ ${rarity}`).toBe(true)
            }
        }
    })

    it('pays out exactly the rarity that was rolled, in every gacha', () => {
        for (const [system, , fromRoll] of rosters) {
            for (const rarity of RARITIES) {
                for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
                    expect(fromRoll(rarity, roll).rarity, `${system} @ ${rarity}`).toBe(rarity)
                }
            }
        }
    })

    it('spreads a roll across the whole pool rather than always picking the first', () => {
        for (const [system, , fromRoll] of rosters) {
            const picked = new Set([0, 0.3, 0.6, 0.9].map(roll => fromRoll('mythic', roll).id))
            expect(picked.size, system).toBeGreaterThan(1)
        }
    })

    it('clamps a roll at both ends rather than indexing off the end of a pool', () => {
        for (const [system, , fromRoll] of rosters) {
            expect(fromRoll('common', -1), system).toBeDefined()
            expect(fromRoll('common', 1), system).toBeDefined()
            expect(fromRoll('common', 1.5), system).toBeDefined()
        }
    })
})

describe('pull cost', () => {
    it('discounts the 10-pull but still credits ten pulls of progress', () => {
        expect(pullCost(1)).toEqual({ seals: 1, pulls: 1 })
        expect(pullCost(TEN_PULL_SIZE)).toEqual({ seals: 9, pulls: 10 })
    })

    it('escalates the Gold ladder per purchase and resets from the base', () => {
        expect(sealLadderPrice('champion', 0)).toBe(SEAL_LADDER_BASE_GOLD)
        expect(sealLadderPrice('champion', 1)).toBeGreaterThan(SEAL_LADDER_BASE_GOLD)
        // 1.2 a rung for every gacha since the 2026-10-04 repricing: a day's tenth Seal is 1.2^9 of the first
        expect(sealLadderPrice('champion', 9)).toBe(Math.round(SEAL_LADDER_BASE_GOLD * 1.2 ** 9))
        expect(sealLadderPrice('gear', 9)).toBe(sealLadderPrice('champion', 9))
    })

    it('prices a bulk buy rung by rung, so buying together is never a discount', () => {
        const oneAtATime = sealLadderPrice('champion', 4)
            + sealLadderPrice('champion', 5)
            + sealLadderPrice('champion', 6)
        expect(sealLadderTotal('champion', 4, 3)).toBe(oneAtATime)
    })

    it('treats a zero-count bulk buy as free rather than charging a rung', () => {
        expect(sealLadderTotal('champion', 0, 0)).toBe(0)
    })

    it('keys the ladder reset on a UTC date string, never a timestamp', () => {
        expect(ladderDateKey(Date.UTC(2026, 7, 11, 23, 59))).toBe('2026-08-11')
        expect(ladderDateKey(Date.UTC(2026, 7, 12, 0, 1))).toBe('2026-08-12')
        // A plain string compare — the exact thing a microsecond-precision timestamp CAS
        // cannot do reliably against a JS Date.
        expect(ladderDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})

describe('duplicates', () => {
    it('follows the doc dupe table, including the flat cap from 1★ Lv3 on', () => {
        expect(dupesToLevelUp(0, 1)).toBe(2)
        expect(dupesToLevelUp(0, 5)).toBe(8)
        expect(dupesToLevelUp(0, 10)).toBe(16)
        expect(dupesToLevelUp(1, 1)).toBe(18)
        expect(dupesToLevelUp(1, 2)).toBe(19)
        expect(dupesToLevelUp(1, 3)).toBe(20)
        expect(dupesToLevelUp(MAX_STAR, 9)).toBe(20)
    })

    it('takes exactly 1,066 dupes to go from scratch to 5★ Lv10', () => {
        expect(totalDupesToMax()).toBe(1_066)
    })

    it('banks partial progress rather than rounding it away', () => {
        const outcome = applyDupes(newEntry(), 1, 'common')
        expect(outcome.entry).toEqual({ star: 0, level: 1, dupeProgress: 1 })
        expect(outcome.levelsGained).toBe(0)
    })

    it('stars up every ten levels and resets the level', () => {
        let entry = newEntry()
        // Enough dupes to clear all ten levels of 0★.
        let spent = 0
        for (let level = 1; level <= LEVELS_PER_STAR; level++) spent += dupesToLevelUp(0, level)
        entry = applyDupes(entry, spent, 'common').entry

        expect(entry.star).toBe(1)
        expect(entry.level).toBe(1)
        expect(entry.dupeProgress).toBe(0)
    })

    it('converts to Essence once maxed instead of wasting the dupe', () => {
        const maxed = { star: MAX_STAR, level: LEVELS_PER_STAR, dupeProgress: 0 }
        expect(isMaxed(maxed)).toBe(true)

        const outcome = applyDupes(maxed, 3, 'rare')
        expect(outcome.entry).toEqual(maxed)
        expect(outcome.essenceGained).toBe(3 * essenceValueFor('rare'))
    })

    it('splits a batch that maxes a copy partway through', () => {
        // One level short of maxed, with the level's dupes all but banked.
        const nearly = { star: MAX_STAR, level: LEVELS_PER_STAR - 1, dupeProgress: dupesToLevelUp(MAX_STAR, LEVELS_PER_STAR - 1) - 1 }
        const outcome = applyDupes(nearly, 3, 'mythic')

        expect(isMaxed(outcome.entry)).toBe(true)
        expect(outcome.levelsGained).toBe(1)
        // One dupe finished the level; only the remaining two convert.
        expect(outcome.essenceGained).toBe(2 * essenceValueFor('mythic'))
    })
})

describe('essence and crafting', () => {
    it('scales both ladders ×5 per rarity tier', () => {
        expect(RARITIES.map(essenceValueFor)).toEqual([1, 5, 25, 125, 625, 3_125])
        expect(RARITIES.map(craftCostFor)).toEqual([5, 25, 125, 625, 3_125, 15_625])
    })

    it('prices a craft at exactly 5× that rarity’s own dupe value', () => {
        for (const rarity of RARITIES) {
            expect(craftCostFor(rarity), rarity).toBe(essenceValueFor(rarity) * 5)
        }
    })
})

describe('investment scalar', () => {
    it('runs 1 at 0★ Lv1 through 60 at 5★ Lv10', () => {
        expect(investmentScalar(0, 1)).toBe(1)
        expect(investmentScalar(MAX_STAR, LEVELS_PER_STAR)).toBe(60)
    })
})
