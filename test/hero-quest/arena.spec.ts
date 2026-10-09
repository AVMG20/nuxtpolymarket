import { describe, expect, it } from 'vitest'
import {
    ARENA_DUMMY_ID,
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
    gpnLog10,
    inMatchBand,
    matchBand,
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
    ARENA_EXTRA_ATTEMPT_BASE_GEMS,
    ARENA_FIGHT_SECONDS,
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_MATCH_BAND_PCT,
    ARENA_RATING_FLOOR,
    ARENA_RATING_START,
    ARENA_SEASON_DAYS,
    ARENA_SEASON_EPOCH_MS,
    ARENA_SEASON_REWARDS,
    ARENA_SHOP_GEM_PRICE,
    BATTLE_SPEED_ANCHOR_GEMS,
    GPN_DISPLAY_SCALE,
    K_ATTACK,
    K_DEFEND,
    MEDAL_BASE_LOSS,
    MEDAL_BASE_WIN
} from '#shared/utils/hero-quest/constants'
import { D, ZERO } from '#shared/utils/hero-quest/numbers'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { RARITY_STAT_MULTIPLIER, getChampion } from '#shared/utils/hero-quest/content/champions'
import { RAIDS } from '#shared/utils/hero-quest/content/raids'
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
            expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 10)
            expect(expectedScore(1000, 1400) + expectedScore(1400, 1000)).toBeCloseTo(1, 10)
        })

        it('moves the attacker by K_ATTACK and the defender by K_DEFEND, not by one shared K', () => {
            const win = eloUpdate(1000, 1000, true)
            expect(win.attacker.change).toBe(Math.round(K_ATTACK * 0.5))
            expect(win.defender.change).toBe(Math.round(-K_DEFEND * 0.5))
            const loss = eloUpdate(1000, 1000, false)
            expect(loss.attacker.change).toBe(Math.round(-K_ATTACK * 0.5))
            expect(loss.defender.change).toBe(Math.round(K_DEFEND * 0.5))
            // asymmetric by design: not a zero-sum trade unless the two K happen to match
            if (K_ATTACK !== K_DEFEND) expect(win.attacker.change + win.defender.change).not.toBe(0)
        })

        it('pays an upset more than an expected win', () => {
            const upset = eloUpdate(1000, 1400, true)
            const expected = eloUpdate(1400, 1000, true)
            expect(upset.attacker.change).toBeGreaterThan(expected.attacker.change)
            expect(upset.defender.change).toBeLessThan(expected.defender.change)
        })

        it('never takes a Rating below the floor', () => {
            // an even loss is worth K_ATTACK / 2, more than the 5 points left above the floor
            const r = eloUpdate(ARENA_RATING_FLOOR + 5, ARENA_RATING_FLOOR + 5, false)
            expect(r.attacker.after).toBe(ARENA_RATING_FLOOR)
            expect(r.attacker.change).toBe(-5)
            const d = eloUpdate(3000, ARENA_RATING_FLOOR, true)
            expect(d.defender.after).toBeGreaterThanOrEqual(ARENA_RATING_FLOOR)
        })
    })

    describe('Medals (§5)', () => {
        it('pays a loss the flat floor and a win more, scaled by how unlikely it was', () => {
            expect(medalsFor(false, 0.01)).toBe(MEDAL_BASE_LOSS)
            expect(medalsFor(false, 0.99)).toBe(MEDAL_BASE_LOSS)
            const sure = medalsFor(true, 0.99)
            const longshot = medalsFor(true, 0.01)
            expect(sure).toBeGreaterThanOrEqual(MEDAL_BASE_WIN)
            expect(longshot).toBeGreaterThan(sure)
            expect(sure).toBeGreaterThan(MEDAL_BASE_LOSS)
        })

        it('pays a Training Dummy the base win flat (§2a)', () => {
            expect(medalsFor(true, null)).toBe(MEDAL_BASE_WIN)
        })
    })

    describe('the matchmaking band (§2, #2)', () => {
        it('takes ±ARENA_MATCH_BAND_PCT around the attacker', () => {
            const band = matchBand(1000)!
            expect(10 ** band.lo).toBeCloseTo(1000 * (1 - ARENA_MATCH_BAND_PCT), 6)
            expect(10 ** band.hi).toBeCloseTo(1000 * (1 + ARENA_MATCH_BAND_PCT), 6)
            expect(inMatchBand(1000, 1000 * (1 + ARENA_MATCH_BAND_PCT * 0.99))).toBe(true)
            expect(inMatchBand(1000, 1000 * (1 + ARENA_MATCH_BAND_PCT * 1.01))).toBe(false)
            expect(inMatchBand(1000, 1000 * (1 - ARENA_MATCH_BAND_PCT * 1.01))).toBe(false)
        })

        it('is a ratio, so GPN_DISPLAY_SCALE cancels out of it', () => {
            const pairs = [[1000, 1150], [1000, 1250], [5e12, 4.2e12], [3e40, 3.7e40]] as const
            for (const [a, d] of pairs) {
                expect(inMatchBand(D(a).mul(GPN_DISPLAY_SCALE), D(d).mul(GPN_DISPLAY_SCALE))).toBe(inMatchBand(a, d))
            }
        })

        it('holds Decimal GPNs far past a double', () => {
            const huge = D('1e5000')
            expect(gpnLog10(huge)).toBeCloseTo(5000, 6)
            expect(inMatchBand(huge, huge.mul(1.1))).toBe(true)
            expect(inMatchBand(huge, huge.mul(3))).toBe(false)
            expect(gpnLog10(0)).toBeNull()
            expect(matchBand(0)).toBeNull()
        })
    })

    describe('the candidate draw (§2, §2a)', () => {
        const first = () => 0

        it('fills every slot the pool cannot with a Training Dummy, never widening', () => {
            expect(drawCandidates([], first)).toEqual(Array.from({ length: ARENA_CANDIDATE_COUNT }, () => null))
            const two = drawCandidates(['a', 'b'], first)
            expect(two.filter(c => c === null)).toHaveLength(ARENA_CANDIDATE_COUNT - 2)
            expect(two.filter(c => c !== null).sort()).toEqual(['a', 'b'])
        })

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
            expect(ARENA_DUMMY_ID).toBe('training_dummy')
        })
    })

    describe('attempts and the extra-attempt ladder (§3)', () => {
        it('gives the free attacks each day and does not bank them', () => {
            const today = attemptsOn({ date: null, used: 0, purchased: 0 }, '2026-10-09')
            expect(attemptsLeft(today)).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
            const spentOut = { date: '2026-10-09', used: ARENA_FREE_ATTEMPTS_PER_DAY, purchased: 0 }
            expect(attemptsLeft(attemptsOn(spentOut, '2026-10-09'))).toBe(0)
            // a day with nothing used still opens the next with only the day's free ones
            const idle = { date: '2026-10-08', used: 0, purchased: 3 }
            expect(attemptsLeft(attemptsOn(idle, '2026-10-09'))).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
        })

        it('doubles the price of each extra attack bought, and starts over each day', () => {
            expect([0, 1, 2, 3].map(extraAttemptPrice)).toEqual([1, 2, 4, 8].map(x => x * ARENA_EXTRA_ATTEMPT_BASE_GEMS))
            const bought = { date: '2026-10-09', used: ARENA_FREE_ATTEMPTS_PER_DAY, purchased: 2 }
            expect(attemptsLeft(attemptsOn(bought, '2026-10-09'))).toBe(2)
            expect(attemptsOn(bought, '2026-10-10')).toEqual({ date: '2026-10-10', used: 0, purchased: 0 })
        })
    })

    describe('seasons (§7)', () => {
        const season = ARENA_SEASON_DAYS * DAY

        it('runs two-week seasons back to back from the epoch', () => {
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS)).toBe(1)
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS + season - 1)).toBe(1)
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS + season)).toBe(2)
            expect(arenaSeasonAt(ARENA_SEASON_EPOCH_MS - DAY)).toBe(1)
            expect(arenaSeasonEndsAt(3) - arenaSeasonStartsAt(3)).toBe(season)
            expect(arenaSeasonStartsAt(arenaSeasonAt(ARENA_SEASON_EPOCH_MS + 5 * season + 7))).toBe(ARENA_SEASON_EPOCH_MS + 5 * season)
        })

        it('rolls a standing into a new season at the starting Rating, lazily', () => {
            const stored = { season: 4, rating: 1312, matches: 9 }
            expect(rollStanding(stored, 4)).toBe(stored)
            expect(rollStanding(stored, 5)).toEqual({ season: 5, rating: ARENA_RATING_START, matches: 0 })
            // a player away for several seasons comes back to the same start
            expect(rollStanding(stored, 9)).toEqual({ season: 9, rating: ARENA_RATING_START, matches: 0 })
            expect(ratingIn(stored, 4)).toBe(1312)
            expect(ratingIn(stored, 5)).toBe(ARENA_RATING_START)
            // never backwards: a row another request already rolled stays rolled
            expect(rollStanding({ season: 6, rating: 1016, matches: 1 }, 5)).toEqual({ season: 6, rating: 1016, matches: 1 })
            // never played
            expect(rollStanding({ season: 0, rating: 1000, matches: 0 }, 3)).toEqual({ season: 3, rating: ARENA_RATING_START, matches: 0 })
        })

        it('ranks final standings with shared ranks on ties, and pays by rank', () => {
            const ranked = rankStandings([{ id: 'c', rating: 990 }, { id: 'a', rating: 1200 }, { id: 'b', rating: 1100 }, { id: 'd', rating: 1100 }])
            expect(ranked.map(r => [r.id, r.rank])).toEqual([['a', 1], ['b', 2], ['d', 2], ['c', 4]])
            expect(seasonRewardFor(1)).toBe(ARENA_SEASON_REWARDS[0]!.medals)
            expect(seasonRewardFor(1)).toBeGreaterThan(seasonRewardFor(2))
            expect(seasonRewardFor(10_000)).toBe(ARENA_SEASON_REWARDS[ARENA_SEASON_REWARDS.length - 1]!.medals)
            for (let rank = 1; rank < 200; rank++) expect(seasonRewardFor(rank)).toBeGreaterThanOrEqual(seasonRewardFor(rank + 1))
        })
    })

    describe('the Arena Shop (§6)', () => {
        it('sells all four Seals, all five raids\' Keys, Gold and Gems, each under a stable ID', () => {
            expect(ARENA_SHOP.filter(i => i.kind === 'seals')).toHaveLength(4)
            expect(ARENA_SHOP.filter(i => i.kind === 'keys').map(i => i.kind === 'keys' && i.raid).sort()).toEqual(RAIDS.map(r => r.id).sort())
            expect(ARENA_SHOP.filter(i => i.kind === 'gold')).toHaveLength(1)
            expect(ARENA_SHOP.filter(i => i.kind === 'gems')).toHaveLength(1)
            expect(new Set(ARENA_SHOP.map(i => i.id)).size).toBe(ARENA_SHOP.length)
            expect(arenaShopItem('seals_champion')?.kind).toBe('seals')
            expect(arenaShopItem('nope')).toBeNull()
        })

        it('keeps a day of Medals into Gems well under one Battle Speed block', () => {
            // a generous day: five wins at the biggest upset
            const day = 5 * medalsFor(true, 0)
            expect(day / ARENA_SHOP_GEM_PRICE).toBeLessThan(BATTLE_SPEED_ANCHOR_GEMS / 2)
        })
    })

    describe('the duel', () => {
        const strong = hero(120, 'class_beginner', [champion('champ_borin', 'front'), champion('champ_lys')])
        const weak = hero(5)

        it('is reproducible from its seed', () => {
            const a = runDuel({ attacker: strong, defender: hero(60), seed: 42 })
            const b = runDuel({ attacker: strong, defender: hero(60), seed: 42 })
            expect(b.outcome).toBe(a.outcome)
            expect(b.events).toEqual(a.events)
        })

        it('lets a much stronger party bring the defence down', () => {
            const fight = runDuel({ attacker: strong, defender: weak, seed: 7 })
            expect(fight.outcome).toBe('win')
            expect(fight.enemyHpRemaining).toBe('0')
            expect(fight.secondsElapsed).toBeLessThan(ARENA_FIGHT_SECONDS)
            expect(fight.events.some(e => e.kind === 'enemy_down')).toBe(true)
        })

        it('loses an attack the defence outclasses', () => {
            const fight = runDuel({ attacker: weak, defender: strong, seed: 7 })
            expect(fight.outcome).not.toBe('win')
            expect(fight.events.some(e => e.kind === 'enemy_attack' || e.kind === 'enemy_special')).toBe(true)
        })

        it('counts a defence that holds to the clock as the attacker\'s loss', () => {
            // the same party on both sides at a short clock: nobody falls in three ticks
            const fight = runDuel({ attacker: strong, defender: strong, seed: 3, seconds: 0.3 })
            expect(fight.outcome).toBe('timeout')
            expect(fight.secondsElapsed).toBe(0.3)
        })

        it('gives the attacker no edge in a mirror match', () => {
            // who acts first within a tick is the seed's coin; fixed, the attacker won ~3 in 4
            const party = hero(50, 'class_beginner', [champion('champ_borin', 'front'), champion('champ_lys')])
            let wins = 0
            for (let seed = 1; seed <= 60; seed++) if (runDuel({ attacker: party, defender: party, seed }).outcome === 'win') wins++
            expect(wins).toBeGreaterThan(15)
            expect(wins).toBeLessThan(45)
        })

        it('indexes the attacker as the party and the defender as the enemy side', () => {
            const defender = hero(60, 'class_beginner', [champion('champ_borin', 'front')])
            const fight = runDuel({ attacker: strong, defender, seed: 11 })
            const attackers = partyUnitStats(strong).length
            const defenders = partyUnitStats(defender).length
            expect(fight.partyMaxHps).toHaveLength(attackers)
            expect(fight.enemyMaxHps).toHaveLength(defenders)
            for (const e of fight.events) {
                if (e.unitIndex !== undefined) expect(e.unitIndex).toBeLessThan(attackers)
                if (e.enemyIndex !== undefined) expect(e.enemyIndex).toBeLessThan(defenders)
                if (e.kind === 'attack' || e.kind === 'skill') expect(e.unitIndex).toBeDefined()
                if (e.kind === 'enemy_attack') expect(e.unitIndex).toBeDefined()
            }
        })

        it('crits on both sides, from the seed', () => {
            const crits = new Set<string>()
            for (const seed of [1, 2, 3, 4, 5, 6]) {
                const fight = runDuel({ attacker: hero(80), defender: hero(80), seed })
                crits.add(fight.events.filter(e => e.kind === 'attack' || e.kind === 'enemy_attack').map(e => (e.crit ? 1 : 0)).join(''))
            }
            expect(crits.size).toBeGreaterThan(1)
        })
    })

    describe('the Training Dummy fight (§2a)', () => {
        it('always falls, well inside the clock, at any depth', () => {
            for (const level of [1, 40, 400, 2000]) {
                const fight = runArenaDummy(hero(level), { prestige: 0, world: 1, stage: 1, killsInStage: 0 }, level)
                expect(fight.outcome).toBe('win')
                expect(fight.secondsElapsed).toBeLessThanOrEqual(ARENA_DUMMY_SECONDS * 3)
                expect(fight.enemyMaxHps).toHaveLength(1)
            }
        })
    })
})
