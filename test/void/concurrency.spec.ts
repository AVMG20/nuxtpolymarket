import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { user, voidItems, voidRunHistory, voidState } from '#server/database/schema'
import { voidBuyPerk, voidBuySupplies, voidBuyTrade, voidBuyUpgrade, voidClaimContract, voidCraftItem, voidFinishRun, voidSalvageItem, voidSell, voidUpgradeItem } from '#server/utils/void'
import { VOID_MARKET_PRICES, voidTradeCost, voidUpgradeCost } from '#shared/utils/gamelogic/void'
import { voidCraftCost, voidItemUpgradeCost } from '#shared/utils/gamelogic/void-items'
import { voidPerkCost } from '#shared/utils/gamelogic/void-pilot'
import { voidContractDay, voidContractsFor, voidSupplyCost } from '#shared/utils/gamelogic/void-station'
import { cleanupUser, seedUser, SKIP } from '../setup/db-helpers'

const userId = 'test-void-concurrency'

async function row() {
    const [s] = await db.select().from(voidState).where(eq(voidState.userId, userId))
    return s!
}

async function balance() {
    const [u] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    return Number(u!.balance)
}

describe.skipIf(SKIP)('void runner value endpoints under a burst', () => {
    beforeAll(async () => {
        await seedUser(userId)
        await db.insert(voidState).values({ userId })
    })

    beforeEach(async () => {
        await db.delete(voidRunHistory).where(eq(voidRunHistory.userId, userId))
        await db.delete(voidItems).where(eq(voidItems.userId, userId))
        await db.update(user).set({ balance: '0' }).where(eq(user.id, userId))
        await db.update(voidState).set({ resources: {}, upgradeLevels: {}, runStartedAt: null, runsPlayed: 0, extractions: 0, totalSold: 0, tradeLevel: 0, pilotXp: 0, supplies: {}, mods: {}, contractsDay: null, contractsDone: [], loadouts: {} }).where(eq(voidState.userId, userId))
    })

    afterAll(async () => {
        await db.delete(voidItems).where(eq(voidItems.userId, userId))
        await db.delete(voidRunHistory).where(eq(voidRunHistory.userId, userId))
        await db.delete(voidState).where(eq(voidState.userId, userId))
        await cleanupUser(userId)
    })

    it('banks a run exactly once when the finish is sent ten times at once', async () => {
        await db.update(voidState).set({
            runStartedAt: new Date(Date.now() - 4 * 60_000),
            runSector: 1,
            runShipId: 'sparrow',
            runCargo: 1000
        }).where(eq(voidState.userId, userId))

        const report = { reason: 'extracted' as const, haul: { ferrite: 500 }, elapsedMs: 4 * 60_000, kills: 3, wardenKilled: false }
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidFinishRun(userId, report)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        const s = await row()
        expect(s.resources).toEqual({ ferrite: 500 })
        expect(s.extractions).toBe(1)
        expect(s.runStartedAt).toBeNull()
        expect(await db.select().from(voidRunHistory).where(eq(voidRunHistory.userId, userId))).toHaveLength(1)
    })

    it('pays for stock only once when the same stack is sold in parallel', async () => {
        await db.update(voidState).set({ resources: { cobalt: 12 } }).where(eq(voidState.userId, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidSell(userId, 'cobalt', 12)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(await balance()).toBe(12 * VOID_MARKET_PRICES.cobalt)
        expect((await row()).resources).toEqual({})
    })

    it('charges one refit level per payment when the same refit is bought in parallel', async () => {
        const price = voidUpgradeCost('cargo', 0)!
        // Enough materials for many levels, coins for exactly one.
        await db.update(voidState).set({ resources: { ferrite: 500_000, scrap: 500_000 } }).where(eq(voidState.userId, userId))
        await db.update(user).set({ balance: String(price.coins) }).where(eq(user.id, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidBuyUpgrade(userId, 'cargo')))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        const s = await row()
        expect(s.upgradeLevels).toEqual(expect.objectContaining({ cargo: 1 }))
        expect(await balance()).toBe(0)
        expect(s.resources).toEqual({ ferrite: 500_000 - price.resources.ferrite!, scrap: 500_000 - price.resources.scrap! })
    })

    it('signs one trade contract level when bought ten times with coins for one', async () => {
        await db.update(user).set({ balance: String(voidTradeCost(0)) }).where(eq(user.id, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidBuyTrade(userId)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect((await row()).tradeLevel).toBe(1)
        expect(await balance()).toBe(0)
    })

    it('credits pilot xp once when the finish is sent ten times at once', async () => {
        await db.update(voidState).set({ runStartedAt: new Date(Date.now() - 5 * 60_000), runSector: 1, runShipId: 'sparrow', runCargo: 1000 }).where(eq(voidState.userId, userId))

        const body = { reason: 'destroyed' as const, haul: {}, elapsedMs: 5 * 60_000, kills: 20, wardenKilled: false, skillUses: 10 }
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidFinishRun(userId, body)))

        const ok = results.filter(r => r.status === 'fulfilled')
        expect(ok).toHaveLength(1)
        expect((await row()).pilotXp).toBe((ok[0] as PromiseFulfilledResult<{ xp: number }>).value.xp)
    })

    it('crafts once per payment when a craft is sent ten times with coins for one', async () => {
        const price = voidCraftCost('turret', 1)
        await db.update(voidState).set({ resources: { ferrite: 100_000, scrap: 100_000 } }).where(eq(voidState.userId, userId))
        await db.update(user).set({ balance: String(price.coins) }).where(eq(user.id, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidCraftItem(userId, 'turret', 'pulse', 1)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(await db.select().from(voidItems).where(eq(voidItems.userId, userId))).toHaveLength(1)
        expect(await balance()).toBe(0)
    })

    it('levels an item once per payment under a burst', async () => {
        const [row] = await db.insert(voidItems).values({ userId, kind: 'turret', type: 'pulse', tier: 1 }).returning()
        const cost = voidItemUpgradeCost({ kind: 'turret', tier: 1, level: 0 })!
        await db.update(voidState).set({ resources: { ferrite: 100_000, scrap: 100_000 } }).where(eq(voidState.userId, userId))
        await db.update(user).set({ balance: String(cost.coins) }).where(eq(user.id, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidUpgradeItem(userId, row!.id)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        const [after] = await db.select().from(voidItems).where(eq(voidItems.id, row!.id))
        expect(after!.level).toBe(1)
    })

    it('refunds a salvaged item exactly once', async () => {
        const [row] = await db.insert(voidItems).values({ userId, kind: 'turret', type: 'pulse', tier: 1 }).returning()

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidSalvageItem(userId, row!.id)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect((await row_()).resources.ferrite).toBeGreaterThan(0)
        expect(await db.select().from(voidItems).where(eq(voidItems.userId, userId))).toHaveLength(0)
    })

    it('pays each daily contract once', async () => {
        const contract = voidContractsFor(userId, voidContractDay(), 0, 0)[0]!
        await db.update(voidState).set({ resources: { [contract.resource]: contract.amount * 10 } }).where(eq(voidState.userId, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidClaimContract(userId, 0)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(await balance()).toBe(contract.coins)
        expect((await row_()).resources[contract.resource]).toBe(contract.amount * 9)
    })

    it('never overfills or overcharges supplies under a burst', async () => {
        const unit = voidSupplyCost('nanites', 0)
        await db.update(voidState).set({ resources: { ferrite: 1_000_000, scrap: 1_000_000 } }).where(eq(voidState.userId, userId))
        await db.update(user).set({ balance: String(unit.coins * 2) }).where(eq(user.id, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidBuySupplies(userId, 'nanites', 1)))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2)
        expect((await row_()).supplies).toEqual(expect.objectContaining({ nanites: 2 }))
        expect(await balance()).toBe(0)
    })

    it('spends Command Marks once per rank under a burst', async () => {
        // Exactly one rank's worth, so a second purchase can only come from a race.
        await db.update(voidState).set({ marks: voidPerkCost('harness', 0)!, perks: {} }).where(eq(voidState.userId, userId))

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => voidBuyPerk(userId, 'harness')))

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        const s = await row_()
        expect(s.marks).toBe(0)
        expect(s.perks).toEqual(expect.objectContaining({ harness: 1 }))
    })
})

async function row_() {
    const [s] = await db.select().from(voidState).where(eq(voidState.userId, userId))
    return s!
}
