/**
 * End-to-end cover for the actual ascent: the money is taken, the game tables
 * really are emptied, the tables on the preserve list really do survive, and a
 * burst of concurrent requests can only ever buy one level.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { bankState, chatMessages, gemOrders, minerState, transactions, user } from '#server/database/schema'
import { prestigeUser } from '#server/utils/prestige'
import { PRESTIGE_TIERS } from '#shared/utils/prestige'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-prestige-user'
const TIER_1 = PRESTIGE_TIERS[0]!
const TIER_2 = PRESTIGE_TIERS[1]!

async function readUser() {
    return db.query.user.findFirst({ where: eq(user.id, USER_ID) })
}

/**
 * Progress in three different games plus a live market offer.
 *
 * The gem order is deliberately priced far above anything the exchange suite
 * quotes: it lands in the same shared order book those tests match against, and
 * at a crossable price it gets filled out from under them.
 */
const UNCROSSABLE_PRICE = '9999999.0000'

async function seedProgress() {
    await db.insert(minerState).values({ userId: USER_ID, rigLevel: 40, vaultLevel: 25 })
    await db.insert(bankState).values({ userId: USER_ID, balance: '500000.0000', principal: '500000.0000' })
    await db.insert(gemOrders).values({ userId: USER_ID, side: 'sell', price: UNCROSSABLE_PRICE, quantity: 50 })
    await db.insert(chatMessages).values({ userId: USER_ID, content: 'about to ascend' })
}

async function countRows() {
    const [miner, bank, orders, chat, ledger] = await Promise.all([
        db.select().from(minerState).where(eq(minerState.userId, USER_ID)),
        db.select().from(bankState).where(eq(bankState.userId, USER_ID)),
        db.select().from(gemOrders).where(eq(gemOrders.userId, USER_ID)),
        db.select().from(chatMessages).where(eq(chatMessages.userId, USER_ID)),
        db.select().from(transactions).where(eq(transactions.userId, USER_ID))
    ])
    return { miner: miner.length, bank: bank.length, orders: orders.length, chat: chat.length, ledger: ledger.length }
}

async function cleanup() {
    await db.delete(chatMessages).where(eq(chatMessages.userId, USER_ID))
    await cleanupUser(USER_ID)
}

describe.skipIf(SKIP)('prestigeUser', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('wipes game progress, keeps history and pays out tokens', async () => {
        await seedUser(USER_ID, { balance: `${TIER_1.coinCost}.0000`, gems: TIER_1.gemCost })
        await seedProgress()

        const result = await prestigeUser(USER_ID)

        expect(result.level).toBe(1)
        expect(result.tokens).toBe(TIER_1.tokens)

        const after = await readUser()
        expect(after?.prestige).toBe(1)
        expect(after?.prestigeTokens).toBe(TIER_1.tokens)
        expect(after?.balance).toBe('0.0000')
        expect(after?.gems).toBe(0)
        expect(after?.rake).toBe('0.0000')

        const rows = await countRows()
        expect(rows.miner).toBe(0)
        expect(rows.bank).toBe(0)
        expect(rows.orders).toBe(0)
        // Chat is on the preserve list, and the wipe writes one ledger row for
        // the coins it burned.
        expect(rows.chat).toBe(1)
        expect(rows.ledger).toBe(1)
    })

    it('burns the whole balance, not just the tier price', async () => {
        const surplus = TIER_1.coinCost * 3
        await seedUser(USER_ID, { balance: `${surplus}.0000`, gems: TIER_1.gemCost })

        const result = await prestigeUser(USER_ID)

        expect(parseFloat(result.coinsBurned)).toBe(surplus)
        expect((await readUser())?.balance).toBe('0.0000')
    })

    // The tier's `tokens` is the allowance you HOLD at that tier, not a payout
    // added to what you already had: tier II is 10 tokens, never 5 + 10. It is
    // also the refund for whatever the previous run spent in the shop, since
    // the perks those tokens bought are wiped by this same transaction.
    it('sets the token balance to the tier allowance instead of accumulating', async () => {
        await seedUser(USER_ID, { balance: `${TIER_2.coinCost}.0000`, gems: TIER_2.gemCost })
        await db.update(user)
            // Reached tier I already and spent every token it granted.
            .set({ prestige: 1, prestigeTokens: 0 })
            .where(eq(user.id, USER_ID))

        const result = await prestigeUser(USER_ID)

        expect(result.level).toBe(2)
        expect(result.tokens).toBe(TIER_2.tokens)
        expect(TIER_2.tokens).toBe(10)
        expect((await readUser())?.prestigeTokens).toBe(TIER_2.tokens)
    })

    it('rejects an ascent the player cannot afford', async () => {
        await seedUser(USER_ID, { balance: `${TIER_1.coinCost - 1}.0000`, gems: TIER_1.gemCost })
        await expect(prestigeUser(USER_ID)).rejects.toThrow()

        // Nothing may have moved: a failed ascent is not a partial one.
        const after = await readUser()
        expect(after?.prestige).toBe(0)
        expect(after?.gems).toBe(TIER_1.gemCost)
    })

    it('refuses to launder a bank loan away', async () => {
        await seedUser(USER_ID, { balance: `${TIER_1.coinCost}.0000`, gems: TIER_1.gemCost })
        await db.insert(bankState).values({ userId: USER_ID, loanPrincipal: '250000.0000' })

        await expect(prestigeUser(USER_ID)).rejects.toThrow(/loan/i)
        expect((await readUser())?.prestige).toBe(0)
    })

    // The whole point of the FOR UPDATE lock: N concurrent ascents on a balance
    // that only covers one must buy exactly one level, not N.
    it('lets only one of N concurrent ascents through', async () => {
        await seedUser(USER_ID, { balance: `${TIER_1.coinCost}.0000`, gems: TIER_1.gemCost })

        const result = await burst(5, () => prestigeUser(USER_ID))

        expect(result).toEqual({ ok: 1, rejected: 4 })
        const after = await readUser()
        expect(after?.prestige).toBe(1)
        expect(after?.prestigeTokens).toBe(TIER_1.tokens)
    })
})
