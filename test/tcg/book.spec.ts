/**
 * The bid side (§7.1): standing buy orders for slabbed cards. Real Postgres
 * from .env; fixture shape follows market.spec.ts, slabs minted through the
 * real grading flow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { user, tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgListing, tcgBuyOrder, tcgSubmission } from '#server/database/schema'
import { placeBuyOrder, cancelBuyOrder, sellIntoBid } from '#server/utils/tcg/book'
import type { BookKey } from '#server/utils/tcg/book'
import { submitForGrading, collectSubmission } from '#server/utils/tcg/grading'
import { mintCondition } from '#shared/utils/tcg/condition'
import { TCG_MARKET, sellerProceeds } from '#shared/utils/tcg/market'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    bidder: 'test-tcg-book-bidder',
    rival: 'test-tcg-book-rival',
    seller: 'test-tcg-book-seller'
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
        name: `book spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'BOOK',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'bok-0', number: '001', name: 'Bookling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'bok-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'b', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.seller, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    return { setId: set!.id, printingId: printing!.id, sheetId: sheet!.id, packId: pack!.id }
}

// slotOffset doubles as the numeric serial minus one (packSlots=1, cutIndex=0
// here) — start clear of the low-serial exclusion.
let nextSlot = TCG_MARKET.lowSerialMax + 5

async function seedCopy(ownerId: string, slotOffset: number = nextSlot++): Promise<string> {
    const [copy] = await db.insert(tcgCopy).values({
        printingId: fx.printingId,
        setId: fx.setId,
        ownerId,
        packId: fx.packId,
        sheetId: fx.sheetId,
        cutIndex: 0,
        slotOffset,
        condition: mintCondition()
    }).returning()
    return copy!.id
}

async function slabCopy(ownerId: string, copyId: string): Promise<{ service: string, grade: string, designation: string | null }> {
    const row = await submitForGrading(ownerId, copyId, 'PSI', null)
    await db.update(tcgSubmission)
        .set({ returnsAt: sql`now() - interval '1 second'` })
        .where(eq(tcgSubmission.id, row.id))
    await collectSubmission(ownerId, row.id)
    const [copy] = await db.select().from(tcgCopy).where(eq(tcgCopy.id, copyId))
    return { service: copy!.gradeService!, grade: copy!.grade!, designation: copy!.gradeDesignation }
}

function keyFor(slab: { service: string, grade: string, designation: string | null }): BookKey {
    return {
        printingId: fx.printingId,
        gradeService: slab.service,
        grade: slab.grade,
        gradeDesignation: slab.designation
    }
}

async function balanceOf(userId: string): Promise<number> {
    const [row] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    return parseFloat(row!.balance)
}

describe.skipIf(SKIP)('tcg order book integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: '100000000' })
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
        await db.delete(tcgSet).where(eq(tcgSet.code, 'BOOK'))
    }

    it('place escrows, cancel refunds the remainder; validation holds', async () => {
        const before = await balanceOf(USERS.bidder)
        const order = await placeBuyOrder(USERS.bidder, {
            printingId: fx.printingId, gradeService: 'PSI', grade: '9', gradeDesignation: null
        }, 500, 3)
        expect(await balanceOf(USERS.bidder)).toBeCloseTo(before - 1500, 4)

        await cancelBuyOrder(USERS.bidder, order.id)
        expect(await balanceOf(USERS.bidder)).toBeCloseTo(before, 4)
        // Cancelled orders never fill and cannot cancel twice.
        await expect(cancelBuyOrder(USERS.bidder, order.id))
            .rejects.toMatchObject({ statusCode: 400 })

        await expect(placeBuyOrder(USERS.bidder, {
            printingId: fx.printingId, gradeService: 'PSI', grade: '9', gradeDesignation: null
        }, 0, 1)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Price out of range' })
        await expect(placeBuyOrder(USERS.bidder, {
            printingId: fx.printingId, gradeService: 'PSI', grade: 'nope', gradeDesignation: null
        }, 100, 1)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid grade' })
    })

    it('sell into bid: price-time priority, exact money, ownership, history', async () => {
        const copyId = await seedCopy(USERS.seller)
        const slab = await slabCopy(USERS.seller, copyId)
        const key = keyFor(slab)

        // rival bids 1000 first, bidder outbids at 1200 → bidder must win.
        await placeBuyOrder(USERS.rival, key, 1000, 1)
        await placeBuyOrder(USERS.bidder, key, 1200, 1)

        const sellerBefore = await balanceOf(USERS.seller)
        const fill = await sellIntoBid(USERS.seller, copyId)
        expect(fill.price).toBe(1200)
        expect(fill.buyerId).toBe(USERS.bidder)
        expect(await balanceOf(USERS.seller)).toBeCloseTo(sellerBefore + sellerProceeds(1200), 4)

        const [copy] = await db.select({ ownerId: tcgCopy.ownerId }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.ownerId).toBe(USERS.bidder)
        // The synthetic sold listing feeds sales history.
        const [sale] = await db.select().from(tcgListing)
            .where(and(eq(tcgListing.copyId, copyId), eq(tcgListing.state, 'sold')))
        expect(sale).toMatchObject({ soldGradeService: 'PSI', buyerId: USERS.bidder })

        // rival's untouched bid still rests; clean it up.
        const [resting] = await db.select().from(tcgBuyOrder)
            .where(and(eq(tcgBuyOrder.userId, USERS.rival), eq(tcgBuyOrder.status, 'open')))
        expect(resting!.filled).toBe(0)
        await cancelBuyOrder(USERS.rival, resting!.id)
    }, 30_000)

    it('sell burst against a single-unit bid fills exactly once', async () => {
        const a = await seedCopy(USERS.seller)
        const b = await seedCopy(USERS.seller)
        const slabA = await slabCopy(USERS.seller, a)
        const slabB = await slabCopy(USERS.seller, b)
        // Only test when both slabs landed on the same grade key — otherwise
        // seed one bid per key and only one can fill anyway.
        const sameKey = slabA.grade === slabB.grade && slabA.designation === slabB.designation
        await placeBuyOrder(USERS.bidder, keyFor(slabA), 800, 1)
        if (!sameKey) await placeBuyOrder(USERS.bidder, keyFor(slabB), 800, 1)

        if (sameKey) {
            const result = await burst(2, i => sellIntoBid(USERS.seller, i === 0 ? a : b))
            expect(result).toEqual({ ok: 1, rejected: 1 })
        } else {
            await sellIntoBid(USERS.seller, a)
            await sellIntoBid(USERS.seller, b)
        }
        // Drain any leftovers so later tests see a clean book.
        const leftovers = await db.select().from(tcgBuyOrder)
            .where(and(eq(tcgBuyOrder.userId, USERS.bidder), eq(tcgBuyOrder.status, 'open')))
        for (const order of leftovers) await cancelBuyOrder(USERS.bidder, order.id)
    }, 30_000)

    it('refuses raw copies, low serials, wrong owner and empty books', async () => {
        const raw = await seedCopy(USERS.seller)
        await expect(sellIntoBid(USERS.seller, raw))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Only slabbed copies trade on the book' })

        const low = await seedCopy(USERS.seller, 0) // serial #1
        const slab = await slabCopy(USERS.seller, low)
        await placeBuyOrder(USERS.bidder, keyFor(slab), 700, 1)
        await expect(sellIntoBid(USERS.seller, low))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Low-serial copies do not trade on the book — list or auction them' })

        const normal = await seedCopy(USERS.seller)
        await slabCopy(USERS.seller, normal)
        await expect(sellIntoBid(USERS.rival, normal))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is not yours to sell' })

        const leftovers = await db.select().from(tcgBuyOrder)
            .where(and(eq(tcgBuyOrder.userId, USERS.bidder), eq(tcgBuyOrder.status, 'open')))
        for (const order of leftovers) await cancelBuyOrder(USERS.bidder, order.id)

        const [copyRow] = await db.select().from(tcgCopy).where(eq(tcgCopy.id, normal))
        await expect(sellIntoBid(USERS.seller, normal))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'No standing bid for this card' })
        expect(copyRow!.ownerId).toBe(USERS.seller)
    }, 30_000)
})
