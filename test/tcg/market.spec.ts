/**
 * Integration tests for the marketplace (§7) against the real Postgres from
 * .env. Skips when DATABASE_URL is unset. Copies are seeded directly with a
 * minted condition, same fixture shape as grading.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user, tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgListing, tcgCopyTransfer, tcgSubmission } from '#server/database/schema'
import { listCopy, cancelListing, buyListing, salesHistory, ownershipChain } from '#server/utils/tcg/market'
import { submitForGrading, collectSubmission, crackSlab } from '#server/utils/tcg/grading'
import type { CrackRng } from '#server/utils/tcg/grading'
import { mintCondition } from '#shared/utils/tcg/condition'
import { TCG_MARKET, sellerProceeds } from '#shared/utils/tcg/market'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    seller: 'test-tcg-market-seller',
    buyer: 'test-tcg-market-buyer',
    broke: 'test-tcg-market-broke'
}
const createdSetIds: string[] = []

interface Fixture {
    setId: string
    printingId: string
    sheetId: string
    packId: string
}

let fx: Fixture

async function buildFixture(): Promise<Fixture> {
    const [set] = await db.insert(tcgSet).values({
        name: `market spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'MRKT',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'mkt-0', number: '001', name: 'Marketling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'mkt-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'm', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.seller, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    return { setId: set!.id, printingId: printing!.id, sheetId: sheet!.id, packId: pack!.id }
}

let nextSlot = 0

async function seedCopy(ownerId: string): Promise<string> {
    const [copy] = await db.insert(tcgCopy).values({
        printingId: fx.printingId,
        setId: fx.setId,
        ownerId,
        packId: fx.packId,
        sheetId: fx.sheetId,
        cutIndex: 0,
        slotOffset: nextSlot++,
        condition: mintCondition()
    }).returning()
    return copy!.id
}

async function slabCopy(ownerId: string, copyId: string): Promise<void> {
    const row = await submitForGrading(ownerId, copyId, 'PSI', null)
    await db.update(tcgSubmission)
        .set({ returnsAt: new Date(Date.now() - 1000) })
        .where(eq(tcgSubmission.id, row.id))
    await collectSubmission(ownerId, row.id)
}

async function balanceOf(userId: string): Promise<number> {
    const [row] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    return parseFloat(row!.balance)
}

async function rakeOf(userId: string): Promise<number> {
    const [row] = await db.select({ rake: user.rake }).from(user).where(eq(user.id, userId))
    return parseFloat(row!.rake)
}

const SAFE_CRACK: CrackRng = { chance: () => false, pick: items => items[0]!, float: () => 0 }

describe.skipIf(SKIP)('tcg market integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: id === USERS.broke ? '0' : '100000000' })
        }
        fx = await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'MRKT'))
    }

    it('double-list burst: one active listing wins; price and note validated', async () => {
        const copyId = await seedCopy(USERS.seller)
        const result = await burst(10, () => listCopy(USERS.seller, copyId, 1000, null))
        expect(result).toEqual({ ok: 1, rejected: 9 })
        const active = await db.select().from(tcgListing)
            .where(and(eq(tcgListing.copyId, copyId), eq(tcgListing.state, 'active')))
        expect(active).toHaveLength(1)

        await expect(listCopy(USERS.seller, copyId, 0, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Price out of range' })
        await expect(listCopy(USERS.seller, copyId, TCG_MARKET.maxPrice + 1, null))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(listCopy(USERS.seller, copyId, 1000, 'x'.repeat(TCG_MARKET.noteMaxLength + 1)))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Note too long' })
    }, 30_000)

    it('cannot list a foreign copy or one at the grader; cannot grade or crack a listed copy', async () => {
        const copyId = await seedCopy(USERS.seller)
        await expect(listCopy(USERS.buyer, copyId, 500, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is not yours to list' })

        // At the grader → not listable.
        const atGrader = await seedCopy(USERS.seller)
        await submitForGrading(USERS.seller, atGrader, 'PSI', null)
        await expect(listCopy(USERS.seller, atGrader, 500, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is not available for listing' })

        // Listed → not gradeable, not crackable.
        await listCopy(USERS.seller, copyId, 500, null)
        await expect(submitForGrading(USERS.seller, copyId, 'PSI', null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is listed on the market' })

        const slabbed = await seedCopy(USERS.seller)
        await slabCopy(USERS.seller, slabbed)
        await listCopy(USERS.seller, slabbed, 500, null)
        await expect(crackSlab(USERS.seller, slabbed, SAFE_CRACK))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is listed on the market' })
    })

    it('buy: atomic, 5% burned exactly, rake untouched, ownership and chain recorded', async () => {
        const copyId = await seedCopy(USERS.seller)
        const listing = await listCopy(USERS.seller, copyId, 10000, 'looks near mint to me')
        const sellerBefore = await balanceOf(USERS.seller)
        const buyerBefore = await balanceOf(USERS.buyer)
        const sellerRake = await rakeOf(USERS.seller)
        const buyerRake = await rakeOf(USERS.buyer)

        const result = await buyListing(USERS.buyer, listing.id)
        expect(result.price).toBe(10000)
        expect(result.proceeds).toBe(sellerProceeds(10000))

        // Buyer pays the full price; seller receives 95%; the 5% vanishes.
        expect(await balanceOf(USERS.buyer)).toBeCloseTo(buyerBefore - 10000, 4)
        expect(await balanceOf(USERS.seller)).toBeCloseTo(sellerBefore + 9500, 4)
        // The burn never touches rake (§7.6).
        expect(await rakeOf(USERS.seller)).toBe(sellerRake)
        expect(await rakeOf(USERS.buyer)).toBe(buyerRake)

        const [copy] = await db.select({ ownerId: tcgCopy.ownerId }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.ownerId).toBe(USERS.buyer)

        const transfers = await db.select().from(tcgCopyTransfer).where(eq(tcgCopyTransfer.copyId, copyId))
        expect(transfers).toHaveLength(1)
        expect(transfers[0]).toMatchObject({ fromUserId: USERS.seller, toUserId: USERS.buyer, kind: 'sale' })

        const chain = await ownershipChain(copyId)
        expect(chain.map(entry => entry.kind)).toEqual(['mint', 'sale'])
        expect(chain[1]!.price).toBe(10000)
    })

    it('buy burst: one winner; own listing refused; broke buyer rolls back cleanly', async () => {
        const copyId = await seedCopy(USERS.seller)
        const listing = await listCopy(USERS.seller, copyId, 2000, null)

        await expect(buyListing(USERS.seller, listing.id))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Listing is gone, or your own' })

        await expect(buyListing(USERS.broke, listing.id))
            .rejects.toMatchObject({ statusCode: 400 })
        // The failed purchase must leave the listing active and the copy put.
        const [after] = await db.select().from(tcgListing).where(eq(tcgListing.id, listing.id))
        expect(after!.state).toBe('active')
        const [copy] = await db.select({ ownerId: tcgCopy.ownerId }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.ownerId).toBe(USERS.seller)

        const result = await burst(10, () => buyListing(USERS.buyer, listing.id))
        expect(result).toEqual({ ok: 1, rejected: 9 })
    }, 30_000)

    it('cancel: claim wins once; sold listings cannot be cancelled', async () => {
        const copyId = await seedCopy(USERS.seller)
        const listing = await listCopy(USERS.seller, copyId, 300, null)
        const result = await burst(10, () => cancelListing(USERS.seller, listing.id))
        expect(result).toEqual({ ok: 1, rejected: 9 })

        // Cancelled → listable again.
        const second = await listCopy(USERS.seller, copyId, 400, null)
        await buyListing(USERS.buyer, second.id)
        await expect(cancelListing(USERS.seller, second.id))
            .rejects.toMatchObject({ statusCode: 400 })
    }, 30_000)

    it('sales history snapshots the grade and survives a post-sale crack', async () => {
        const copyId = await seedCopy(USERS.seller)
        await slabCopy(USERS.seller, copyId)
        const [graded] = await db.select({ grade: tcgCopy.grade }).from(tcgCopy).where(eq(tcgCopy.id, copyId))

        const listing = await listCopy(USERS.seller, copyId, 5000, null)
        await buyListing(USERS.buyer, listing.id)
        // The new owner cracks it — history must keep the sold-as grade.
        await crackSlab(USERS.buyer, copyId, SAFE_CRACK)

        const history = await salesHistory(fx.printingId)
        const sale = history.find(row => row.price === 5000)!
        expect(sale.gradeService).toBe('PSI')
        expect(sale.grade).toBe(graded!.grade)
        expect(sale.sellerName).toBeTruthy()
        expect(sale.buyerName).toBeTruthy()
        // Raw sales in the same history carry no grade — condition unknown.
        const rawSale = history.find(row => row.price === 10000)!
        expect(rawSale.grade).toBeNull()
    })
})
