import { describe, expect, it } from 'vitest'
import {
    TOWN_STREAK_CHESTS,
    TOWN_STREAK_DAYS,
    TOWN_STREAK_EXTRA_KINDS,
    TOWN_STREAK_LUCKY_GOLDEN_MULTIPLIER,
    rollTownStreakExtras,
    townStreakExtraChance,
    townStreakLuckyChest,
    townStreakOpensChest,
    TOWN_STREAK_MIN_INCOME_PER_DAY,
    TOWN_STREAK_TRACK,
    isValidTownStreakStep,
    rollTownStreakChest,
    rollTownStreakReward,
    lockTownStreakStep,
    claimTownStreakReward,
    sumTownStreakRewards,
    townStreakBit,
    townStreakCanReset,
    townStreakClaimable,
    townStreakClaimedSteps,
    townStreakCoins,
    townStreakDayKey,
    townStreakDue,
    townStreakExpectedGems,
    townStreakGoodAmount,
    townStreakGoods,
    townStreakIsClaimed,
    townStreakMaxGems,
    townStreakNextDayAt,
    townStreakPreview,
    townStreakScale,
    townStreakStatus,
    townStreakYesterday,
    type TownStreakScale
} from '#shared/utils/gamelogic/town-streak'
import type { TownSimBuilding } from '#shared/utils/gamelogic/town'
import { TOWN_BOOST_MS, TOWN_MARKET_DAY_MS, TOWN_TEMP_BUILDER_MS } from '#shared/utils/gamelogic/town-boosts'

/** Deterministic uniform [0, 1) so rolls are reproducible. */
function mulberry32(seed: number) {
    let a = seed
    return () => {
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const EMPTY: TownStreakScale = { incomePerDay: TOWN_STREAK_MIN_INCOME_PER_DAY, outputPerHour: {} }
const BIG: TownStreakScale = { incomePerDay: 5_000_000_000, outputPerHour: { steel: 4_000, machines: 600, jewels: 50_000 } }

describe('Mayor streak days', () => {
    it('keys days in UTC and knows yesterday across month and year ends', () => {
        expect(townStreakDayKey(Date.UTC(2026, 9, 4, 23, 59, 59))).toBe('2026-10-04')
        expect(townStreakDayKey(Date.UTC(2026, 9, 5, 0, 0, 0))).toBe('2026-10-05')
        expect(townStreakYesterday('2026-10-01')).toBe('2026-09-30')
        expect(townStreakYesterday('2027-01-01')).toBe('2026-12-31')
        expect(townStreakYesterday('2028-03-01')).toBe('2028-02-29')
    })

    it('puts the next unlock at the next UTC midnight', () => {
        expect(townStreakNextDayAt(Date.UTC(2026, 9, 4, 13, 0))).toBe(Date.UTC(2026, 9, 5))
        expect(townStreakNextDayAt(Date.UTC(2026, 9, 5))).toBe(Date.UTC(2026, 9, 6))
    })
})

describe('Mayor streak status', () => {
    const today = '2026-10-04'

    it('advances on the first visit and on the day after the last unlock', () => {
        expect(townStreakDue(null, today)).toBe(true)
        expect(townStreakDue({ step: 3, lastDay: '2026-10-03' }, today)).toBe(true)
        expect(townStreakStatus({ step: 3, lastDay: '2026-10-03' }, today)).toBe('active')
    })

    it('does nothing on a second visit the same day', () => {
        expect(townStreakDue({ step: 3, lastDay: today }, today)).toBe(false)
        expect(townStreakStatus({ step: 3, lastDay: today }, today)).toBe('active')
        expect(townStreakCanReset({ step: 3, lastDay: today }, today)).toBe(false)
    })

    it('breaks after a missed day and never advances on its own', () => {
        const row = { step: 5, lastDay: '2026-10-02' }
        expect(townStreakStatus(row, today)).toBe('broken')
        expect(townStreakDue(row, today)).toBe(false)
        expect(townStreakCanReset(row, today)).toBe(true)
    })

    it('finishes at step 30, even when days were missed since', () => {
        for (const lastDay of [today, '2026-10-03', '2026-08-01']) {
            const row = { step: TOWN_STREAK_DAYS, lastDay }
            expect(townStreakStatus(row, today)).toBe('finished')
            expect(townStreakDue(row, today)).toBe(false)
            expect(townStreakCanReset(row, today)).toBe(true)
        }
    })

    it('cannot reset a track that does not exist yet', () => {
        expect(townStreakCanReset(null, today)).toBe(false)
    })
})

describe('Mayor streak claimed mask', () => {
    it('maps step n to bit n - 1, up to step 30 within a positive int', () => {
        expect(townStreakBit(1)).toBe(1)
        expect(townStreakBit(2)).toBe(2)
        expect(townStreakBit(30)).toBe(2 ** 29)
        expect(townStreakBit(30)).toBeGreaterThan(0)
    })

    it('lists claimed and claimable steps', () => {
        const mask = townStreakBit(1) | townStreakBit(3) | townStreakBit(30)
        expect(townStreakClaimedSteps(mask)).toEqual([1, 3, 30])
        expect(townStreakIsClaimed(mask, 3)).toBe(true)
        expect(townStreakIsClaimed(mask, 2)).toBe(false)
        expect(townStreakClaimable(5, mask)).toEqual([2, 4, 5])
        expect(townStreakClaimable(0, 0)).toEqual([])
        expect(townStreakClaimable(30, 0)).toHaveLength(30)
    })

    it('validates step input', () => {
        expect(isValidTownStreakStep(1)).toBe(true)
        expect(isValidTownStreakStep(30)).toBe(true)
        for (const bad of [0, 31, 1.5, -1, '3', null, undefined, Number.NaN]) expect(isValidTownStreakStep(bad)).toBe(false)
    })
})

describe('Mayor streak track', () => {
    it('has one step per day, in order, with chests on the milestones', () => {
        expect(TOWN_STREAK_TRACK).toHaveLength(TOWN_STREAK_DAYS)
        TOWN_STREAK_TRACK.forEach((def, i) => expect(def.step).toBe(i + 1))
        expect(TOWN_STREAK_TRACK.filter(d => d.kind === 'chest').map(d => d.step)).toEqual([7, 14, 21, 30])
        const last = TOWN_STREAK_TRACK[29]!
        expect(last.kind === 'chest' && last.chest).toBe('golden')
    })

    it('keeps gem days between 1 and 10 and only the golden chest above, at 10 to 15', () => {
        for (const def of TOWN_STREAK_TRACK) {
            if (def.kind !== 'gems') continue
            expect(def.gems).toBeGreaterThanOrEqual(1)
            expect(def.gems).toBeLessThanOrEqual(10)
        }
        expect(TOWN_STREAK_CHESTS.wooden.gems[1]).toBeLessThanOrEqual(10)
        expect(TOWN_STREAK_CHESTS.silver.gems[1]).toBeLessThanOrEqual(10)
        expect(TOWN_STREAK_CHESTS.golden.gems).toEqual([10, 15])
        // Every chest holds gems: a chest that might be empty of them reads as a dud.
        for (const chest of Object.values(TOWN_STREAK_CHESTS)) expect(chest.gemChance).toBe(1)
    })

    it('keeps daily coin rewards between 10% and 40% of a day, ramping up', () => {
        const shares = TOWN_STREAK_TRACK.flatMap(d => d.kind === 'coins' ? [d.share] : [])
        expect(Math.min(...shares)).toBeGreaterThanOrEqual(0.1)
        expect(Math.max(...shares)).toBeLessThanOrEqual(0.4)
        for (let i = 1; i < shares.length; i++) expect(shares[i]!).toBeGreaterThanOrEqual(shares[i - 1]!)
    })

    it('pays 50 to 60 gems a run in expectation, chests included', () => {
        const expected = townStreakExpectedGems()
        expect(expected).toBeGreaterThanOrEqual(50)
        expect(expected).toBeLessThanOrEqual(60)
        expect(townStreakMaxGems()).toBeLessThanOrEqual(65)

        // The rolls agree with the closed form.
        const rng = mulberry32(42)
        const runs = 20_000
        let gems = 0
        for (let r = 0; r < runs; r++) {
            for (const def of TOWN_STREAK_TRACK) gems += rollTownStreakReward(def, EMPTY, rng).gems
        }
        expect(gems / runs).toBeGreaterThan(expected - 0.3)
        expect(gems / runs).toBeLessThan(expected + 0.3)
    })
})

describe('Mayor streak scaling', () => {
    it('floors coin rewards for a new town', () => {
        const scale = townStreakScale([], 50, Date.now())
        expect(scale.incomePerDay).toBe(TOWN_STREAK_MIN_INCOME_PER_DAY)
        expect(townStreakCoins(scale, 0.1)).toBe(Math.round(TOWN_STREAK_MIN_INCOME_PER_DAY * 0.1))
    })

    it('scales coins with a big town', () => {
        expect(townStreakCoins(BIG, 0.4)).toBe(2_000_000_000)
    })

    it('reads output from what the town actually makes', () => {
        const now = Date.now()
        const farm: TownSimBuilding = { id: 'f', type: 'farm', level: 1, completesAt: now - 1, upgradingTo: null, createdAt: now - 1000 }
        const scale = townStreakScale([farm], 50, now)
        expect(scale.incomePerDay).toBeGreaterThanOrEqual(TOWN_STREAK_MIN_INCOME_PER_DAY)
    })

    it('hands a town that makes nothing the basic goods, with a minimum', () => {
        expect(townStreakGoods(EMPTY)).toEqual(['wheat', 'wood', 'stone'])
        const wheat = townStreakGoodAmount(EMPTY, 'wheat', 2)
        expect(wheat).toBeGreaterThan(0)
        expect(wheat * 30).toBeGreaterThanOrEqual(2 * TOWN_STREAK_MIN_INCOME_PER_DAY / 24 - 30)
    })

    it('draws goods from the town output and never hands out jewels', () => {
        expect(townStreakGoods(BIG).sort()).toEqual(['machines', 'steel'])
        expect(townStreakGoodAmount(BIG, 'steel', 5)).toBe(20_000)
        expect(townStreakGoodAmount(BIG, 'machines', 1)).toBe(600)
    })

    it('gives at least one unit of a pricey good', () => {
        expect(townStreakGoodAmount({ incomePerDay: 1, outputPerHour: { luxuries: 0.01 } }, 'luxuries', 2)).toBe(1)
    })
})

describe('Mayor streak rolls', () => {
    it('pays a resources day in one good the town makes', () => {
        const def = TOWN_STREAK_TRACK.find(d => d.kind === 'resources')!
        const reward = rollTownStreakReward(def, BIG, mulberry32(1))
        const goods = Object.keys(reward.resources)
        expect(goods).toHaveLength(1)
        expect(['steel', 'machines']).toContain(goods[0])
        expect(reward.coins).toBe(0)
        expect(reward.gems).toBe(0)
    })

    it('always fills a chest with coins or goods, and stays within its ranges', () => {
        const rng = mulberry32(7)
        for (const chest of ['wooden', 'silver', 'golden'] as const) {
            const def = TOWN_STREAK_CHESTS[chest]
            for (let i = 0; i < 2_000; i++) {
                const r = rollTownStreakChest(chest, BIG, rng)
                expect(r.chest).toBe(chest)
                expect(r.coins > 0 || Object.keys(r.resources).length > 0).toBe(true)
                if (r.coins > 0) {
                    expect(r.coins).toBeGreaterThanOrEqual(townStreakCoins(BIG, def.share[0]))
                    expect(r.coins).toBeLessThanOrEqual(townStreakCoins(BIG, def.share[1]))
                }
                expect(r.gems).toBeGreaterThanOrEqual(0)
                expect(r.gems).toBeLessThanOrEqual(def.gems[1])
                expect(r.resources.jewels).toBeUndefined()
            }
        }
    })

    it('always gives both coins and goods from a golden chest', () => {
        const rng = mulberry32(9)
        for (let i = 0; i < 500; i++) {
            const r = rollTownStreakChest('golden', EMPTY, rng)
            expect(r.coins).toBeGreaterThan(0)
            expect(Object.keys(r.resources).length).toBeGreaterThan(0)
        }
    })

    it('sums rewards for a reset', () => {
        const total = sumTownStreakRewards([
            { step: 1, coins: 10, gems: 0, resources: { wheat: 5 } },
            { step: 2, coins: 0, gems: 2, resources: { wheat: 1, wood: 3 } }
        ])
        expect(total).toEqual({ coins: 10, gems: 2, resources: { wheat: 6, wood: 3 }, boosts: {}, extras: [] })
    })

    it('stacks boost time and lists every extra when summing', () => {
        const total = sumTownStreakRewards([
            { step: 9, coins: 0, gems: 0, resources: {}, boosts: { build: TOWN_BOOST_MS } },
            { step: 14, coins: 0, gems: 3, resources: {}, chest: 'silver', boosts: { build: TOWN_BOOST_MS }, extras: [{ kind: 'build', ms: TOWN_BOOST_MS }, { kind: 'lucky' }] },
            { step: 21, coins: 0, gems: 3, resources: {}, chest: 'silver', extras: [{ kind: 'builder', ms: TOWN_TEMP_BUILDER_MS }] }
        ])
        expect(total.boosts).toEqual({ build: 2 * TOWN_BOOST_MS })
        expect(total.extras.map(e => e.kind)).toEqual(['build', 'lucky', 'builder'])
    })

    it('previews chests as ranges with odds', () => {
        const golden = townStreakPreview(TOWN_STREAK_TRACK[29]!, BIG)
        expect(golden.milestone).toBe(true)
        expect(golden.chest).toBe('golden')
        expect(golden.coins![0]).toBeLessThan(golden.coins![1])
        expect(golden.gemChance).toBe(1)
        expect(Object.keys(golden.resources!).sort()).toEqual(['machines', 'steel'])
        const day1 = townStreakPreview(TOWN_STREAK_TRACK[0]!, EMPTY)
        expect(day1.coins).toEqual([6_000, 6_000])
        expect(day1.milestone).toBe(false)
    })
})

describe('Mayor streak locking', () => {
    const coinDay = TOWN_STREAK_TRACK.find(d => d.kind === 'coins')!
    const chestDay = TOWN_STREAK_TRACK.find(d => d.kind === 'chest')!

    it('pays what a step was worth on the day it unlocked, not what the town is worth at claim time', () => {
        const lock = lockTownStreakStep(coinDay, EMPTY, mulberry32(1))
        const late = claimTownStreakReward(coinDay, lock, BIG, mulberry32(2))
        expect(late.coins).toBe(rollTownStreakReward(coinDay, EMPTY).coins)
    })

    it('rolls a chest on opening, from the scale locked at unlock', () => {
        const lock = lockTownStreakStep(chestDay, EMPTY, mulberry32(1))
        expect(lock.reward).toBeUndefined()
        for (let i = 0; i < 50; i++) {
            const opened = claimTownStreakReward(chestDay, lock, BIG, mulberry32(i))
            expect(opened.coins).toBeLessThanOrEqual(EMPTY.incomePerDay * 3)
        }
    })

    it('falls back to the current scale for a step unlocked before locking', () => {
        expect(claimTownStreakReward(coinDay, undefined, BIG).coins).toBe(rollTownStreakReward(coinDay, BIG).coins)
    })

    it('previews a locked step at its fixed amount and a future one as an estimate', () => {
        const lock = lockTownStreakStep(coinDay, EMPTY)
        const fixed = townStreakPreview(coinDay, BIG, lock)
        expect(fixed.fixed).toBe(true)
        expect(fixed.coins).toEqual([lock.reward!.coins, lock.reward!.coins])
        expect(townStreakPreview(coinDay, BIG).fixed).toBe(false)
    })
})

describe('Mayor streak boost days', () => {
    it('puts Builder\'s rush on days 9 and 23 and Production surge on 12 and 26', () => {
        const boosts = TOWN_STREAK_TRACK.flatMap(d => d.kind === 'boost' ? [[d.step, d.boost]] : [])
        expect(boosts).toEqual([[9, 'build'], [12, 'production'], [23, 'build'], [26, 'production']])
    })

    it('pays an hour of the boost and nothing else, locked at unlock', () => {
        const day9 = TOWN_STREAK_TRACK[8]!
        const lock = lockTownStreakStep(day9, BIG)
        expect(lock.reward).toEqual({ coins: 0, gems: 0, resources: {}, boosts: { build: TOWN_BOOST_MS } })
        expect(claimTownStreakReward(day9, lock, EMPTY).boosts).toEqual({ build: TOWN_BOOST_MS })
        expect(townStreakOpensChest(day9, lock)).toBe(false)
    })

    it('previews a boost day as its boost and length', () => {
        for (const lock of [undefined, lockTownStreakStep(TOWN_STREAK_TRACK[11]!, EMPTY)]) {
            const preview = townStreakPreview(TOWN_STREAK_TRACK[11]!, BIG, lock)
            expect(preview.kind).toBe('boost')
            expect(preview.label).toBe('Production surge')
            expect(preview).toMatchObject({ boost: 'production', boostMs: TOWN_BOOST_MS, coins: null, gems: null, resources: null })
        }
        expect(townStreakPreview(TOWN_STREAK_TRACK[8]!, BIG).label).toBe('Builder\'s rush')
    })
})

describe('Mayor streak chest extras', () => {
    it('rolls one, two or three slots by tier', () => {
        expect(TOWN_STREAK_CHESTS.wooden.extras.slots).toBe(1)
        expect(TOWN_STREAK_CHESTS.silver.extras.slots).toBe(2)
        expect(TOWN_STREAK_CHESTS.golden.extras.slots).toBe(3)
        const rng = mulberry32(3)
        for (const chest of ['wooden', 'silver', 'golden'] as const) {
            const counts = new Set<number>()
            for (let i = 0; i < 3_000; i++) counts.add(rollTownStreakExtras(chest, rng, 5).length)
            const slots = TOWN_STREAK_CHESTS[chest].extras.slots
            expect(Math.max(...counts)).toBe(slots)
            expect(Math.min(...counts)).toBe(chest === 'golden' ? 1 : 0)
        }
    })

    it('hits each slot at the chest\'s odds, and always gives a golden chest one', () => {
        const rng = mulberry32(11)
        const runs = 20_000
        for (const chest of ['wooden', 'silver', 'golden'] as const) {
            let any = 0
            let total = 0
            for (let i = 0; i < runs; i++) {
                const n = rollTownStreakExtras(chest, rng, 5).length
                if (n > 0) any++
                total += n
            }
            const t = TOWN_STREAK_CHESTS[chest].extras
            expect(any / runs).toBeCloseTo(townStreakExtraChance(chest), 1)
            if (!t.guaranteed) expect(total / runs).toBeCloseTo(t.slots * t.chance, 1)
        }
        expect(townStreakExtraChance('golden')).toBe(1)
        expect(townStreakExtraChance('wooden')).toBeCloseTo(0.25)
        expect(townStreakExtraChance('silver')).toBeCloseTo(1 - 0.6 * 0.6)
    })

    it('weighs every kind, better ones more in rarer chests', () => {
        for (const chest of ['wooden', 'silver', 'golden'] as const) {
            for (const kind of TOWN_STREAK_EXTRA_KINDS) expect(TOWN_STREAK_CHESTS[chest].extras.weights[kind]).toBeGreaterThan(0)
        }
        const share = (chest: 'wooden' | 'golden', kind: 'instant' | 'lucky') => {
            const w = TOWN_STREAK_CHESTS[chest].extras.weights
            return w[kind] / Object.values(w).reduce((a, b) => a + b, 0)
        }
        expect(share('golden', 'instant')).toBeGreaterThan(share('wooden', 'instant'))
        expect(share('golden', 'lucky')).toBeGreaterThan(share('wooden', 'lucky'))
    })

    it('gives timed extras their length', () => {
        const rng = mulberry32(5)
        for (let i = 0; i < 2_000; i++) {
            for (const e of rollTownStreakExtras('golden', rng, 3)) {
                if (e.kind === 'build' || e.kind === 'production') expect(e.ms).toBe(TOWN_BOOST_MS)
                else if (e.kind === 'builder') expect(e.ms).toBe(TOWN_TEMP_BUILDER_MS)
                else if (e.kind === 'market') expect(e.ms).toBe(TOWN_MARKET_DAY_MS)
                else expect(e.ms).toBeUndefined()
            }
        }
    })

    it('never rolls an instant finish without a job for it, and no more than there are jobs', () => {
        const rng = mulberry32(13)
        let instants = 0
        for (let i = 0; i < 5_000; i++) {
            expect(rollTownStreakExtras('golden', rng, 0).some(e => e.kind === 'instant')).toBe(false)
            const one = rollTownStreakExtras('golden', rng, 1).filter(e => e.kind === 'instant').length
            expect(one).toBeLessThanOrEqual(1)
            instants += one
        }
        expect(instants).toBeGreaterThan(0)
    })

    it('stacks duplicates: two boost extras sum into two hours', () => {
        let found = false
        const rng = mulberry32(17)
        for (let i = 0; i < 20_000 && !found; i++) {
            const r = rollTownStreakChest('golden', EMPTY, rng, { instantJobs: 3 })
            const builds = r.extras!.filter(e => e.kind === 'build').length
            const surges = r.extras!.filter(e => e.kind === 'production').length
            expect(r.boosts?.build ?? 0).toBe(builds * TOWN_BOOST_MS)
            expect(r.boosts?.production ?? 0).toBe(surges * TOWN_BOOST_MS)
            if (builds >= 2) found = true
        }
        expect(found).toBe(true)
    })

    it('leaves the coin, goods and gem rolls as they were', () => {
        // Extras are rolled last, so the first draws match a roll that ignores them.
        for (let seed = 0; seed < 50; seed++) {
            const a = rollTownStreakChest('silver', BIG, mulberry32(seed))
            const b = rollTownStreakChest('silver', BIG, mulberry32(seed), { instantJobs: 4 })
            expect([a.coins, a.gems, a.resources]).toEqual([b.coins, b.gems, b.resources])
        }
    })
})

describe('Mayor streak lucky chests', () => {
    const wooden = TOWN_STREAK_TRACK[6]!
    const golden = TOWN_STREAK_TRACK[29]!

    it('upgrades one tier, and a golden one pays half as much again', () => {
        expect(townStreakLuckyChest('wooden')).toEqual({ chest: 'silver', multiplier: 1 })
        expect(townStreakLuckyChest('silver')).toEqual({ chest: 'golden', multiplier: 1 })
        expect(townStreakLuckyChest('golden')).toEqual({ chest: 'golden', multiplier: TOWN_STREAK_LUCKY_GOLDEN_MULTIPLIER })
    })

    it('opens a lucky wooden chest as a silver one, with silver slots', () => {
        const lock = lockTownStreakStep(wooden, EMPTY)
        expect(townStreakOpensChest(wooden, lock)).toBe(true)
        const rng = mulberry32(21)
        let maxExtras = 0
        for (let i = 0; i < 2_000; i++) {
            const r = claimTownStreakReward(wooden, lock, EMPTY, rng, { lucky: true, instantJobs: 2 })
            expect(r.chest).toBe('silver')
            expect(r.upgradedFrom).toBe('wooden')
            expect(r.gems).toBeGreaterThanOrEqual(TOWN_STREAK_CHESTS.silver.gems[0])
            maxExtras = Math.max(maxExtras, r.extras!.length)
        }
        expect(maxExtras).toBe(2)
        expect(claimTownStreakReward(wooden, lock, EMPTY, mulberry32(1)).upgradedFrom).toBeUndefined()
    })

    it('pays a lucky golden chest 1.5x its usual rolls', () => {
        const lock = lockTownStreakStep(golden, BIG)
        for (let seed = 0; seed < 50; seed++) {
            const plain = claimTownStreakReward(golden, lock, BIG, mulberry32(seed))
            const lucky = claimTownStreakReward(golden, lock, BIG, mulberry32(seed), { lucky: true })
            expect(lucky.chest).toBe('golden')
            expect(lucky.upgradedFrom).toBe('golden')
            expect(lucky.coins).toBe(Math.round(plain.coins * 1.5))
            expect(lucky.gems).toBe(Math.round(plain.gems * 1.5))
            for (const [id, qty] of Object.entries(plain.resources)) expect(lucky.resources[id as 'steel']).toBe(Math.round(qty * 1.5))
        }
    })

    it('previews chests with their extra odds', () => {
        expect(townStreakPreview(wooden, EMPTY)).toMatchObject({ extraSlots: 1, extraChance: townStreakExtraChance('wooden') })
        expect(townStreakPreview(golden, EMPTY)).toMatchObject({ extraSlots: 3, extraChance: 1 })
    })
})
