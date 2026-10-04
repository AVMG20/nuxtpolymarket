import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townBuildings, townInventory, townState, townStreak } from '#server/database/schema'
import {
    activateTownBoosts,
    deleteTownForUser,
    finishLongestTownJobs,
    foundTown,
    placeBuilding,
    sellToFloor
} from '#server/utils/town'
import { claimTownStreakStep, getTownStreak } from '#server/utils/town-streak'
import { TOWN_BOOST_MS, TOWN_TEMP_BUILDER_MS } from '#shared/utils/gamelogic/town-boosts'
import { TOWN_FREE_BUILDERS, getTownBuilding, townFloorPrice } from '#shared/utils/gamelogic/town'
import { SKIP, burst, cleanupUser, lockTownRealm, moveTownToFlatGround, seedUser } from '../setup/db-helpers'

// Lets a test pin the chest rolls; every other test draws real numbers.
const rolls = vi.hoisted(() => ({ forced: null as number | null }))
vi.mock('#shared/utils/random', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#shared/utils/random')>()
    return { ...actual, randomFloat: () => rolls.forced ?? actual.randomFloat() }
})

const OWNER = 'test-town-boosts-owner'
const MIN = 60_000

async function cleanup() {
    await db.delete(townStreak).where(eq(townStreak.userId, OWNER))
    await deleteTownForUser(OWNER)
    await cleanupUser(OWNER)
}

async function stateRow() {
    const [row] = await db.select().from(townState).where(eq(townState.userId, OWNER))
    return row!
}

async function building(id: string) {
    const [row] = await db.select().from(townBuildings).where(eq(townBuildings.id, id))
    return row!
}

/** A house under construction, finishing `ms` from now. */
async function job(plotId: string, tileX: number, ms: number, type = 'house') {
    const [row] = await db.insert(townBuildings)
        .values({ userId: OWNER, plotId, type, tileX, tileY: 3, rotation: 0, level: 0, completesAt: new Date(Date.now() + ms) })
        .returning()
    return row!
}

describe.skipIf(SKIP)('Polytown boosts (database)', () => {
    let releaseRealm: () => Promise<void>
    let plotId: string
    beforeAll(async () => { releaseRealm = await lockTownRealm() }, 120_000)

    beforeEach(async () => {
        await cleanup()
        await seedUser(OWNER, { balance: '100000000000', gems: 0 })
        plotId = (await foundTown(OWNER)).plotId
    })
    afterEach(async () => {
        rolls.forced = null
        await cleanup()
    })
    afterAll(async () => { await releaseRealm() })

    it('halves a running 30-minute job when a Builder\'s rush day is claimed, once under a burst', async () => {
        const pending = await job(plotId, 0, 30 * MIN)
        await getTownStreak(OWNER)
        // Day 9 is the first Builder's rush; lock it as if it unlocked today.
        await db.update(townStreak).set({ step: 9 }).where(eq(townStreak.userId, OWNER))
        await db.update(townStreak).set({ locked: { 9: { scale: { incomePerDay: 60_000, outputPerHour: {} }, reward: { coins: 0, gems: 0, resources: {}, boosts: { build: TOWN_BOOST_MS } } } } }).where(eq(townStreak.userId, OWNER))

        const before = Date.now()
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => claimTownStreakStep(OWNER, 9)))
        const after = Date.now()
        const won = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
        expect(won).toHaveLength(1)
        expect(won[0]!.reward.boosts).toEqual({ build: TOWN_BOOST_MS })

        const ends = (await building(pending.id)).completesAt.getTime()
        const originalEnd = pending.completesAt.getTime()
        // Rushed at some instant `a` in [before, after]: it ends at a + (end - a) / 2.
        expect(ends).toBeGreaterThanOrEqual(before + (originalEnd - after) / 2 - 5)
        expect(ends).toBeLessThanOrEqual(after + (originalEnd - before) / 2 + 5)
        expect(originalEnd - ends).toBeGreaterThan(14 * MIN)

        const until = (await stateRow()).buildBoostUntil!.getTime()
        expect(until).toBeGreaterThanOrEqual(before + TOWN_BOOST_MS)
        expect(until).toBeLessThanOrEqual(after + TOWN_BOOST_MS)
    })

    it('shortens jobs started while the rush runs, and lengthens the rush on a second one', async () => {
        await moveTownToFlatGround(plotId)
        for (let x = 0; x < 8; x++) await placeBuilding(OWNER, plotId, x, 0, 'road')
        const now = Date.now()
        await db.transaction(tx => activateTownBoosts(tx, OWNER, { build: TOWN_BOOST_MS }, now))
        const placed = await placeBuilding(OWNER, plotId, 0, 1, 'house', 2)
        const plain = getTownBuilding('house')!.buildMs
        // Shorter than the plain build, by the half that ran in the rush.
        expect(placed.completesAt - Date.now()).toBeLessThan(plain)

        await db.transaction(tx => activateTownBoosts(tx, OWNER, { build: TOWN_BOOST_MS }, now))
        expect((await stateRow()).buildBoostUntil!.getTime()).toBe(now + 2 * TOWN_BOOST_MS)
    })

    it('finishes the longest running jobs, never a monument stage', async () => {
        const short = await job(plotId, 0, 10 * MIN)
        const long = await job(plotId, 1, 5 * 60 * MIN)
        const monument = await job(plotId, 2, 50 * 60 * MIN, 'pyramid')
        const now = Date.now()
        const done = await db.transaction(tx => finishLongestTownJobs(tx, OWNER, 1, now))
        expect(done).toHaveLength(1)
        expect(done[0]).toMatchObject({ buildingId: long.id, type: 'house', level: 1 })
        expect(done[0]!.savedMs).toBeGreaterThan(4 * 60 * MIN)
        expect(await building(long.id)).toMatchObject({ level: 1, upgradingTo: null })
        expect((await building(short.id)).level).toBe(0)
        expect((await building(monument.id)).level).toBe(0)

        // Two asked for, one left that qualifies.
        const rest = await db.transaction(tx => finishLongestTownJobs(tx, OWNER, 2, Date.now()))
        expect(rest.map(r => r.buildingId)).toEqual([short.id])
    })

    it('lends one crew for a day, and stops new jobs past the owned crews once it leaves', async () => {
        await moveTownToFlatGround(plotId)
        for (let x = 0; x < 8; x++) await placeBuilding(OWNER, plotId, x, 0, 'road')
        const now = Date.now()
        await db.transaction(tx => activateTownBoosts(tx, OWNER, { builder: TOWN_TEMP_BUILDER_MS }, now))
        await db.transaction(tx => activateTownBoosts(tx, OWNER, { builder: TOWN_TEMP_BUILDER_MS }, now))
        expect((await stateRow()).tempBuilderUntil!.getTime()).toBe(now + 2 * TOWN_TEMP_BUILDER_MS)

        for (let x = 0; x < TOWN_FREE_BUILDERS + 1; x++) await placeBuilding(OWNER, plotId, x, 1, 'house', 2)
        await expect(placeBuilding(OWNER, plotId, 6, 1, 'house', 2)).rejects.toThrow(/builder/i)

        // The crew leaves: the four jobs keep running, but nothing new starts.
        await db.update(townState).set({ tempBuilderUntil: new Date(now - 1) }).where(eq(townState.userId, OWNER))
        const running = await db.select().from(townBuildings).where(and(eq(townBuildings.userId, OWNER), eq(townBuildings.type, 'house')))
        expect(running.filter(b => b.level === 0)).toHaveLength(TOWN_FREE_BUILDERS + 1)
        await expect(placeBuilding(OWNER, plotId, 6, 1, 'house', 2)).rejects.toThrow(/builder/i)
    })

    it('pays market-day coins out of the budget only, however many sells race for it', async () => {
        const budget = 100
        await db.transaction(tx => activateTownBoosts(tx, OWNER, { market: 60 * MIN, marketBudget: budget }, Date.now()))
        expect(parseFloat((await stateRow()).marketBoostBonusLeft)).toBe(budget)
        const qty = Math.ceil(budget / townFloorPrice('wheat'))
        await db.insert(townInventory).values({ userId: OWNER, resource: 'wheat', amount: qty * 10 })
        const bonuses: number[] = []

        const { ok } = await burst(10, async () => bonuses.push((await sellToFloor(OWNER, 'wheat', qty)).marketBonus))
        expect(ok).toBe(10)
        const paid = bonuses.reduce((sum, b) => sum + b, 0)
        expect(paid).toBeCloseTo(budget, 4)
        expect(parseFloat((await stateRow()).marketBoostBonusLeft)).toBe(0)
        // Some sale ran out of budget and got none.
        expect(bonuses.some(b => b === 0)).toBe(true)
    })

    it('drops a lapsed market day\'s budget when a new one starts', async () => {
        await db.update(townState).set({ marketBoostUntil: new Date(Date.now() - 1), marketBoostBonusLeft: '5000' }).where(eq(townState.userId, OWNER))
        await db.transaction(tx => activateTownBoosts(tx, OWNER, { market: 60 * MIN, marketBudget: 100 }, Date.now()))
        expect(parseFloat((await stateRow()).marketBoostBonusLeft)).toBe(100)
        await db.transaction(tx => activateTownBoosts(tx, OWNER, { market: 60 * MIN, marketBudget: 100 }, Date.now()))
        expect(parseFloat((await stateRow()).marketBoostBonusLeft)).toBe(200)
    })

    it('spends a lucky charge on exactly one chest under parallel opens', async () => {
        await getTownStreak(OWNER)
        // Days 7, 14 and 21 are chests, unlocked and unclaimed; one charge waiting.
        await db.update(townStreak).set({ step: 21, lucky: 1 }).where(eq(townStreak.userId, OWNER))
        const claims = [7, 7, 7, 14, 14, 21, 21].map(step => claimTownStreakStep(OWNER, step))
        const settled = await Promise.allSettled(claims)
        const rewards = settled.flatMap(r => r.status === 'fulfilled' ? [r.value.reward] : [])
        expect(rewards.map(r => r.step).sort()).toEqual([14, 21, 7])

        const used = rewards.filter(r => r.upgradedFrom).length
        const won = rewards.reduce((sum, r) => sum + (r.extras ?? []).filter(e => e.kind === 'lucky').length, 0)
        const [row] = await db.select().from(townStreak).where(eq(townStreak.userId, OWNER))
        expect(used).toBeGreaterThanOrEqual(1)
        expect(row!.lucky).toBe(1 + won - used)
        expect(row!.lucky).toBeGreaterThanOrEqual(0)
    })

    it('finishes two different jobs when two instant finishes race', async () => {
        const a = await job(plotId, 0, 60 * MIN)
        const b = await job(plotId, 1, 30 * MIN)
        const done: string[] = []
        const { ok } = await burst(3, async () => {
            const rows = await db.transaction(tx => finishLongestTownJobs(tx, OWNER, 1, Date.now()))
            done.push(...rows.map(r => r.buildingId))
        })
        expect(ok).toBe(3)
        expect(done.sort()).toEqual([a.id, b.id].sort())
    })

    it('never shortens a job twice when rushes are granted in parallel', async () => {
        const pending = await job(plotId, 0, 30 * MIN)
        const now = Date.now()
        const { ok } = await burst(5, () => db.transaction(tx => activateTownBoosts(tx, OWNER, { build: TOWN_BOOST_MS }, now)))
        expect(ok).toBe(5)
        // The first window halves it; the later ones start after it has finished.
        const remaining = (await building(pending.id)).completesAt.getTime() - now
        expect(remaining).toBeGreaterThan(14 * MIN)
        expect(remaining).toBeLessThanOrEqual(15 * MIN + 1_000)
        expect((await stateRow()).buildBoostUntil!.getTime()).toBe(now + 5 * TOWN_BOOST_MS)
    })

    it('starts one job per crew, the borrowed one included, under a burst of builds', async () => {
        await moveTownToFlatGround(plotId)
        for (let x = 0; x < 8; x++) await placeBuilding(OWNER, plotId, x, 0, 'road')
        await db.transaction(tx => activateTownBoosts(tx, OWNER, { builder: TOWN_TEMP_BUILDER_MS }, Date.now()))
        const { ok } = await burst(8, i => placeBuilding(OWNER, plotId, i, 1, 'house', 2))
        expect(ok).toBe(TOWN_FREE_BUILDERS + 1)
    })

    it('sizes a market day\'s budget from the scale the chest was locked at', async () => {
        await getTownStreak(OWNER)
        const locked = 5_000_000
        await db.update(townStreak)
            .set({ step: 30, lastDay: null, locked: { 30: { scale: { incomePerDay: locked, outputPerHour: {} } } } })
            .where(eq(townStreak.userId, OWNER))
        // A golden chest with every slot missing holds its one guaranteed
        // extra, and with no job running this roll lands on a market day.
        rolls.forced = 0.7
        const { reward } = await claimTownStreakStep(OWNER, 30)
        expect(reward.extras).toEqual([expect.objectContaining({ kind: 'market', bonusCoins: locked })])
        expect(parseFloat((await stateRow()).marketBoostBonusLeft)).toBe(locked)
    })
})
