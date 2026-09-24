/**
 * Gold Miner run lifecycle against the real Postgres from .env: stake, level
 * report, shop, cash-out — and the parallel bursts every value endpoint has to
 * survive. Skips when DATABASE_URL is unset.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { goldMinerState, user } from '#server/database/schema'
import {
    goldMinerBuy,
    goldMinerCashOut,
    goldMinerNextLevel,
    goldMinerStart,
    goldMinerSubmitLevel
} from '#server/utils/gold-miner'
import {
    GM_LEVEL_MS,
    GM_SHOOT_SPEED,
    gmGenerateLevel,
    gmGoal,
    gmLevelSeed,
    gmVeinRoll,
    gmPayout,
    gmReachDistance,
    gmReelSpeed,
    type GmGrab,
    type GmLevel
} from '#shared/utils/gamelogic/gold-miner'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-gold-miner-run'

async function balance() {
    const row = await db.query.user.findFirst({ where: eq(user.id, USER) })
    return parseFloat(row!.balance)
}

async function state() {
    return (await db.query.goldMinerState.findFirst({ where: eq(goldMinerState.userId, USER) }))!
}

/** Every plain gold item, pulled back to back at ideal speed. */
function goldRun(level: GmLevel): GmGrab[] {
    const grabs: GmGrab[] = []
    let at = 0
    for (const item of level.items) {
        if (!item.kind.startsWith('gold')) continue
        const d = gmReachDistance(item)
        const next = at + Math.ceil((d / GM_SHOOT_SPEED + d / gmReelSpeed(item.kind, false)) * 1000)
        if (next > GM_LEVEL_MS) break
        at = next
        grabs.push({ id: item.id, at })
    }
    return grabs
}

/** A secret whose level 1 is a rich vein, so a gold-only run always clears it. */
const RICH_SECRET = (() => {
    for (let secret = 1; ; secret++) {
        if (gmVeinRoll(gmLevelSeed(secret, 1), 1).vein === 'rich') return secret
    }
})()

async function start(stake = 1000) {
    const result = await goldMinerStart(USER, stake)
    await db.update(goldMinerState).set({ secret: RICH_SECRET }).where(eq(goldMinerState.userId, USER))
    return result
}

/** Winds the level clock back so a full-length report is not "ahead of the clock". */
async function fastForward() {
    await db.update(goldMinerState).set({ levelStartsAt: new Date(Date.now() - GM_LEVEL_MS) }).where(eq(goldMinerState.userId, USER))
}

async function clearLevel() {
    const s = await state()
    await fastForward()
    return goldMinerSubmitLevel(USER, goldRun(gmGenerateLevel(gmLevelSeed(s.secret, s.level), s.level)))
}

describe.skipIf(SKIP)('gold miner runs', () => {
    beforeEach(async () => {
        await db.delete(goldMinerState).where(eq(goldMinerState.userId, USER))
        await cleanupUser(USER)
        await seedUser(USER, { balance: '10000' })
    })

    afterAll(async () => {
        await db.delete(goldMinerState).where(eq(goldMinerState.userId, USER))
        await cleanupUser(USER)
    })

    it('takes the stake once, however many starts race', async () => {
        const result = await burst(8, () => goldMinerStart(USER, 1000))
        expect(result.ok).toBe(1)
        expect(await balance()).toBe(9000)
    })

    it('refuses a stake the player cannot cover', async () => {
        await expect(goldMinerStart(USER, 50_000)).rejects.toMatchObject({ statusCode: 400 })
        expect((await state()).phase).toBeNull()
    })

    it('clears a level, shops, and pays the cash-out exactly once', async () => {
        await start()
        const cleared = await clearLevel()
        expect(cleared.cleared).toBe(true)
        expect(cleared.cash).toBeGreaterThanOrEqual(gmGoal(1))

        const results = await burst(10, () => goldMinerCashOut(USER))
        expect(results.ok).toBe(1)
        expect(await balance()).toBeCloseTo(9000 + gmPayout(1000, cleared.cash), 2)
        expect((await state()).phase).toBeNull()
    })

    it('sells each shop item once and never below zero cash', async () => {
        await start()
        await clearLevel()
        const s = await state()
        const offer = s.offers[0]!
        const results = await burst(10, () => goldMinerBuy(USER, offer.item))
        expect(results.ok).toBe(1)
        expect((await state()).cash).toBe(s.cash - offer.price)
    })

    it('only reports a level once', async () => {
        await start()
        const s = await state()
        await fastForward()
        const grabs = goldRun(gmGenerateLevel(gmLevelSeed(s.secret, s.level), s.level))
        const results = await burst(6, () => goldMinerSubmitLevel(USER, grabs))
        expect(results.ok).toBe(1)
    })

    it('loses the stake when the goal is missed', async () => {
        await start()
        await fastForward()
        const result = await goldMinerSubmitLevel(USER, [])
        expect(result).toMatchObject({ cleared: false, reason: 'goal' })
        expect((await state()).phase).toBeNull()
        await expect(goldMinerCashOut(USER)).rejects.toMatchObject({ statusCode: 400 })
        expect(await balance()).toBe(9000)
    })

    it('rejects a report ahead of the level clock', async () => {
        await start()
        const s = await state()
        const grabs = goldRun(gmGenerateLevel(gmLevelSeed(s.secret, s.level), s.level))
        await expect(goldMinerSubmitLevel(USER, grabs)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('forfeits a level abandoned past its deadline', async () => {
        await start()
        await db.update(goldMinerState).set({ levelStartsAt: new Date(Date.now() - 10 * 60_000) }).where(eq(goldMinerState.userId, USER))
        const result = await goldMinerSubmitLevel(USER, [])
        expect(result).toMatchObject({ cleared: false, reason: 'timeout' })
    })

    it('deals the next level only once', async () => {
        await start()
        await clearLevel()
        const results = await burst(6, () => goldMinerNextLevel(USER))
        expect(results.ok).toBe(1)
        expect((await state()).level).toBe(2)
    })
})
