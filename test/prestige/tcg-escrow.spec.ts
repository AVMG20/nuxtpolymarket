/**
 * The card collection survives a prestige, but the card *market* must not hand
 * coins through one.
 *
 * Every surface here parks a coin claim outside the wallet the ascent burns:
 * a funded buy order, a listing or lot waiting on a buyer, an auction the
 * player is selling or leading. Cancel or settle any of them after the reset
 * and the payout lands in the fresh wallet — which is exactly the balance the
 * ascent was supposed to take. So prestige refuses to run while one is open.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import {
    tcgAuction,
    tcgBuyOrder,
    tcgCard,
    tcgCopy,
    tcgListing,
    tcgLot,
    tcgPack,
    tcgPrinting,
    tcgSet,
    tcgSheet,
    user
} from '#server/database/schema'
import { prestigeBlockers, prestigeUser } from '#server/utils/prestige'
import { mintCondition } from '#shared/utils/tcg/condition'
import { PRESTIGE_TIERS } from '#shared/utils/prestige'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-prestige-tcg-escrow'
const TIER_1 = PRESTIGE_TIERS[0]!
const createdSetIds: string[] = []

let setId: string
let printingId: string
let sheetId: string
let packId: string
let nextSlot = 0

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `prestige escrow set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'PRES',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'pres-0', number: '001', name: 'Escrowling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'pres-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'a', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USER_ID, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    setId = set!.id
    printingId = printing!.id
    sheetId = sheet!.id
    packId = pack!.id
}

async function seedCopy(): Promise<string> {
    const [copy] = await db.insert(tcgCopy).values({
        printingId, setId, ownerId: USER_ID, packId, sheetId,
        cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition()
    }).returning()
    return copy!.id
}

function codes(list: { code: string }[]) {
    return list.map(b => b.code)
}

describe.skipIf(SKIP)('prestige vs card-market escrow', () => {
    beforeAll(async () => {
        await cleanupSets()
        await cleanupUser(USER_ID)
        await seedUser(USER_ID, { balance: `${TIER_1.coinCost}.0000`, gems: TIER_1.gemCost })
        await buildFixture()
    }, 60_000)

    afterEach(async () => {
        // Wipe the market rows between cases; the fixture and user survive.
        await db.delete(tcgBuyOrder).where(eq(tcgBuyOrder.userId, USER_ID))
        await db.delete(tcgListing).where(eq(tcgListing.sellerId, USER_ID))
        await db.delete(tcgLot).where(eq(tcgLot.sellerId, USER_ID))
        await db.delete(tcgAuction).where(eq(tcgAuction.sellerId, USER_ID))
        await db.update(user)
            .set({ balance: `${TIER_1.coinCost}.0000`, gems: TIER_1.gemCost, prestige: 0 })
            .where(eq(user.id, USER_ID))
    })

    afterAll(async () => {
        await cleanupSets()
        await cleanupUser(USER_ID)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
    }

    it('lets a clean collector ascend', async () => {
        // The control: owning cards is not a blocker. Only live coin claims are.
        await seedCopy()
        expect(await prestigeBlockers(USER_ID)).toEqual([])
    })

    it('blocks on a funded buy order', async () => {
        await db.insert(tcgBuyOrder).values({
            userId: USER_ID, printingId, gradeService: 'raw', grade: 'raw',
            price: '500.0000', quantity: 2
        })

        expect(codes(await prestigeBlockers(USER_ID))).toContain('tcg-buy-order')
        await expect(prestigeUser(USER_ID)).rejects.toThrow(/buy order/i)
        // A refused ascent is not a partial one.
        const [after] = await db.select({ prestige: user.prestige }).from(user).where(eq(user.id, USER_ID))
        expect(after?.prestige).toBe(0)
    })

    it('ignores a buy order that is already cancelled', async () => {
        await db.insert(tcgBuyOrder).values({
            userId: USER_ID, printingId, gradeService: 'raw', grade: 'raw',
            price: '500.0000', quantity: 2, status: 'cancelled'
        })

        expect(await prestigeBlockers(USER_ID)).toEqual([])
    })

    it('blocks on a live listing', async () => {
        await db.insert(tcgListing).values({
            copyId: await seedCopy(), sellerId: USER_ID, price: '250.0000'
        })

        expect(codes(await prestigeBlockers(USER_ID))).toContain('tcg-sale')
        await expect(prestigeUser(USER_ID)).rejects.toThrow(/listing|lot/i)
    })

    it('blocks on a live bulk lot', async () => {
        await db.insert(tcgLot).values({ sellerId: USER_ID, setId, price: '900.0000' })

        expect(codes(await prestigeBlockers(USER_ID))).toContain('tcg-sale')
    })

    it('ignores a listing that already sold', async () => {
        await db.insert(tcgListing).values({
            copyId: await seedCopy(), sellerId: USER_ID, price: '250.0000', state: 'sold'
        })

        expect(await prestigeBlockers(USER_ID)).toEqual([])
    })

    it('blocks the seller of a live auction', async () => {
        await db.insert(tcgAuction).values({
            sellerId: USER_ID, kind: 'copy', copyId: await seedCopy(),
            startPrice: '100.0000', endsAt: new Date(Date.now() + 3_600_000)
        })

        expect(codes(await prestigeBlockers(USER_ID))).toContain('tcg-auction')
        await expect(prestigeUser(USER_ID)).rejects.toThrow(/auction/i)
    })

    it('blocks the leading bidder of someone else s auction', async () => {
        // The bid is escrowed: if they are outbid after the reset, the refund
        // lands in the new wallet.
        const OTHER = 'test-prestige-tcg-escrow-other'
        await cleanupUser(OTHER)
        await seedUser(OTHER, { balance: '1000' })
        await db.insert(tcgAuction).values({
            sellerId: OTHER, kind: 'copy',
            startPrice: '100.0000', currentBid: '150.0000', currentBidderId: USER_ID,
            endsAt: new Date(Date.now() + 3_600_000)
        })

        expect(codes(await prestigeBlockers(USER_ID))).toContain('tcg-auction')

        await db.delete(tcgAuction).where(eq(tcgAuction.sellerId, OTHER))
        await cleanupUser(OTHER)
    })

    it('ignores an auction that already settled', async () => {
        await db.insert(tcgAuction).values({
            sellerId: USER_ID, kind: 'copy', copyId: await seedCopy(),
            startPrice: '100.0000', state: 'settled',
            endsAt: new Date(Date.now() - 3_600_000)
        })

        expect(await prestigeBlockers(USER_ID)).toEqual([])
    })

    it('reports every open claim at once, not just the first', async () => {
        await db.insert(tcgBuyOrder).values({
            userId: USER_ID, printingId, gradeService: 'raw', grade: 'raw',
            price: '500.0000', quantity: 1
        })
        await db.insert(tcgLot).values({ sellerId: USER_ID, setId, price: '900.0000' })
        await db.insert(tcgAuction).values({
            sellerId: USER_ID, kind: 'copy', copyId: await seedCopy(),
            startPrice: '100.0000', endsAt: new Date(Date.now() + 3_600_000)
        })

        // The prestige screen lists them all, so one round of cleanup clears
        // the whole gate instead of revealing the next blocker each time.
        expect(codes(await prestigeBlockers(USER_ID)).sort())
            .toEqual(['tcg-auction', 'tcg-buy-order', 'tcg-sale'])
    })
})
