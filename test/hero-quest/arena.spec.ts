import { describe, expect, it } from 'vitest'
import {
    ARENA_SHOP,
    arenaSeasonAt,
    arenaSeasonEndsAt,
    arenaSeasonStartsAt,
    arenaShopItem,
    attemptsLeft,
    attemptsOn,
    drawCandidates,
    eloUpdate,
    expectedScore,
    extraAttemptPrice,
    refreshesOn,
    medalsFor,
    rankStandings,
    ratingIn,
    rollStanding,
    seasonRewardFor
} from '#shared/utils/hero-quest/arena'
import { runArenaDummy, runDuel } from '#shared/utils/hero-quest/duel'
import {
    ARENA_CANDIDATE_COUNT,
    ARENA_DUMMY_SECONDS,
    ARENA_FIGHT_SECONDS,
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_RATING_FLOOR,
    ARENA_RATING_START,
    ARENA_SEASON_DAYS,
    ARENA_SEASON_EPOCH_MS,
    ARENA_SEASON_REWARDS,
    ARENA_SHOP_GEM_PRICE
} from '#shared/utils/hero-quest/constants'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import { RARITY_STAT_MULTIPLIER, getChampion } from '#shared/utils/hero-quest/content/champions'
import type { ChampionSnapshot, ClassId, HeroSnapshot } from '#shared/utils/hero-quest/types'

const DAY = 86_400_000

function hero(heroLevel: number, classId: ClassId = 'class_beginner', champions: ChampionSnapshot[] = []): HeroSnapshot {
    return { classId, heroLevel, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0, champions }
}

function champion(id: string, row: 'front' | 'back' = 'back'): ChampionSnapshot {
    const def = getChampion(id)
    return {
        championId: def.id,
        archetype: def.archetype,
        rarityMultiplier: RARITY_STAT_MULTIPLIER[def.rarity],
        investment: 1,
        strikesPerAttack: def.strikesPerAttack,
        row,
        abilities: def.abilities
    }
}

describe('hero-quest arena', () => {
    describe('asymmetric Elo (§4)', () => {
        it('gives an even match an even chance', () => {
            expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 10)
            expect(expectedScore(1000, 1400) + expectedScore(1400, 1000)).toBeCloseTo(1, 10)
        })

        it('never takes a Rating below the floor', () => {
            const r = eloUpdate(ARENA_RATING_FLOOR + 5, ARENA_RATING_FLOOR + 5, false)
            expect(r.attacker.after).toBe(ARENA_RATING_FLOOR)
            expect(r.attacker.change).toBe(-5)
            const d = eloUpdate(3000, ARENA_RATING_FLOOR, true)
            expect(d.defender.after).toBeGreaterThanOrEqual(ARENA_RATING_FLOOR)
        })
    })

    describe('refreshes', () => {
        it('starts the free refreshes over each UTC day', () => {
            expect(refreshesOn({ date: '2026-10-10', used: 4 }, '2026-10-10')).toEqual({ date: '2026-10-10', used: 4 })
            expect(refreshesOn({ date: '2026-10-09', used: 4 }, '2026-10-10')).toEqual({ date: '2026-10-10', used: 0 })
        })

        it('never rolls a counter back to an earlier day than the one it holds', () => {
            // a request that read the clock before midnight and queued behind one after it
            expect(refreshesOn({ date: '2026-10-10', used: 4 }, '2026-10-09')).toEqual({ date: '2026-10-10', used: 4 })
        })
    })

    describe('the candidate draw (§2, §2a)', () => {
        it('draws distinct players, at most the list size, from a big pool', () => {
            const pool = Array.from({ length: 50 }, (_, i) => `p${i}`)
            let k = 7
            const drawn = drawCandidates([...pool, 'p3', 'p3'], n => (k = (k * 31 + 11) % 997) % n)
            expect(drawn).toHaveLength(ARENA_CANDIDATE_COUNT)
            expect(new Set(drawn).size).toBe(ARENA_CANDIDATE_COUNT)
            expect(drawn.every(id => id !== null && pool.includes(id))).toBe(true)
        })

        it('keeps an out-of-range pick inside the pool', () => {
            expect(drawCandidates(['a'], () => 99)).toEqual(['a', ...Array.from({ length: ARENA_CANDIDATE_COUNT - 1 }, () => null)])
        })
    })

    describe('attempts and the extra-attempt ladder (§3)', () => {
        it('gives the free attacks each day, does not bank them, and starts the ladder over', () => {
            const today = attemptsOn({ date: null, used: 0, purchased: 0 }, '2026-10-09')
            expect(attemptsLeft(today)).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
            const spentOut = { date: '2026-10-09', used: ARENA_FREE_ATTEMPTS_PER_DAY, purchased: 0 }
            expect(attemptsLeft(attemptsOn(spentOut, '2026-10-09'))).toBe(0)
            // a day with nothing used still opens the next with only the day's free ones
            const idle = { date: '2026-10-08', used: 0, purchased: 3 }
            expect(attemptsLeft(attemptsOn(idle, '2026-10-09'))).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
            const bought = { date: '2026-10-09', used: ARENA_FREE_ATTEMPTS_PER_DAY, purchased: 2 }
            expect(attemptsLeft(attemptsOn(bought, '2026-10-09'))).toBe(2)
            expect(attemptsOn(bought, '2026-10-10')).toEqual({ date: '2026-10-10', used: 0, purchased: 0 })
        })

        it('never rolls the attacks back to an earlier day than the one they hold', () => {
            // a request that read the clock before midnight and queued behind one after it must not
            // start the day over: that would hand out the free attacks and the ladder's cheap rungs again
            const today = { date: '2026-10-10', used: ARENA_FREE_ATTEMPTS_PER_DAY, purchased: 3 }
            expect(attemptsOn(today, '2026-10-09')).toEqual(today)
            expect(attemptsLeft(attemptsOn(today, '2026-10-09'))).toBe(3)
        })
    })

    describe('seasons (§7)', () => {
        const season = ARENA_SEASON_DAYS * DAY

        it('runs seasons back to back from the epoch', () => {
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS)).toBe(1)
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS + season - 1)).toBe(1)
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS + season)).toBe(2)
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS - DAY)).toBe(1)
            expect(arenaSeasonEndsAt(3) - arenaSeasonStartsAt(3)).toBe(season)
        })

        it('rolls a standing into a new season at the starting Rating, lazily', () => {
            const stored = { season: 4, rating: 1312, matches: 9 }
            expect(rollStanding(stored, 4)).toBe(stored)
            expect(rollStanding(stored, 5)).toEqual({ season: 5, rating: ARENA_RATING_START, matches: 0 })
            expect(ratingIn(stored, 4)).toBe(1312)
            expect(ratingIn(stored, 5)).toBe(ARENA_RATING_START)
            // never backwards: a row another request already rolled stays rolled
            expect(rollStanding({ season: 6, rating: 1016, matches: 1 }, 5)).toEqual({ season: 6, rating: 1016, matches: 1 })
        })

        it('ranks final standings one apiece, an equal Rating to whoever reached it first, and pays by rank', () => {
            const at = (minute: number) => new Date(Date.UTC(2026, 9, 15, 12, minute))
            const ranked = rankStandings([
                { userId: 'c', rating: 990, ratingAt: at(0) },
                { userId: 'a', rating: 1200, ratingAt: at(5) },
                { userId: 'd', rating: 1100, ratingAt: at(1) },
                { userId: 'b', rating: 1100, ratingAt: at(3) },
                // never moved by a match: last among its Rating, then by user ID
                { userId: 'f', rating: 1100, ratingAt: null },
                { userId: 'e', rating: 1100, ratingAt: null }
            ])
            expect(ranked.map(r => [r.userId, r.rank])).toEqual([['a', 1], ['d', 2], ['b', 3], ['e', 4], ['f', 5], ['c', 6]])
            expect(seasonRewardFor(1)).toBe(ARENA_SEASON_REWARDS[0]!.medals)
            expect(seasonRewardFor(10_000)).toBe(ARENA_SEASON_REWARDS[ARENA_SEASON_REWARDS.length - 1]!.medals)
        })
    })

    describe('the Arena Shop (§6)', () => {
        it('sells no Gold, each item under a unique ID', () => {
            expect(ARENA_SHOP.some(i => (i.kind as string) === 'gold')).toBe(false)
            expect(new Set(ARENA_SHOP.map(i => i.id)).size).toBe(ARENA_SHOP.length)
            expect(arenaShopItem('nope')).toBeNull()
        })

        it('never lets a paid attack buy back its own price in Gems (issue #30)', () => {
            // the most an attack can pay is a win at the biggest upset; even that, sold for Gems,
            // stays under the cheapest extra attack, so Gems -> attacks -> Medals -> Gems loses
            expect(Math.floor(medalsFor(true, 0) / ARENA_SHOP_GEM_PRICE)).toBeLessThan(extraAttemptPrice(0))
        })
    })

    describe('the duel', () => {
        const strong = hero(120, 'class_beginner', [champion('champ_borin', 'front'), champion('champ_lys')])

        it('is reproducible from its seed', () => {
            const a = runDuel({ attacker: strong, defender: hero(60), seed: 42 })
            const b = runDuel({ attacker: strong, defender: hero(60), seed: 42 })
            expect(b.outcome).toBe(a.outcome)
            expect(b.events).toEqual(a.events)
        })

        it('lets a much stronger party bring the defence down', () => {
            const fight = runDuel({ attacker: strong, defender: hero(5), seed: 7 })
            expect(fight.outcome).toBe('win')
            expect(fight.enemyHpRemaining).toBe('0')
            expect(fight.secondsElapsed).toBeLessThan(ARENA_FIGHT_SECONDS)
        })

        it('gives a timeout to the side with more of its max HP left, a dead heat to the defender', () => {
            // a clock too short for either side to finish: the shares decide
            const ahead = runDuel({ attacker: hero(60), defender: hero(50), seed: 3, seconds: 2 })
            expect(ahead.outcome).toBe('timeout')
            expect(ahead.attackerWon).toBe(true)
            const behind = runDuel({ attacker: hero(50), defender: hero(60), seed: 3, seconds: 2 })
            expect(behind.outcome).toBe('timeout')
            expect(behind.attackerWon).toBe(false)
            // no time at all: both untouched, and the defence holds
            const even = runDuel({ attacker: strong, defender: strong, seed: 3, seconds: 0 })
            expect(even.outcome).toBe('timeout')
            expect(even.attackerWon).toBe(false)
        })
    })

    describe('the Training Dummy fight (§2a)', () => {
        it('always falls, well inside the clock, at any depth', () => {
            for (const level of [1, 2000]) {
                const fight = runArenaDummy(hero(level), { prestige: 0, world: 1, stage: 1, killsInStage: 0 }, level)
                expect(fight.outcome).toBe('win')
                expect(fight.secondsElapsed).toBeLessThanOrEqual(ARENA_DUMMY_SECONDS * 3)
            }
        })
    })
})
