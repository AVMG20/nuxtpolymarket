/**
 * Bulk lots (§7.1): unsorted, uninspected, encumbered while active. Real
 * Postgres from .env; fixture shape follows market.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user, tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgLot, tcgLotItem } from '#server/database/schema'
import { createLot, buyLot, cancelLot } from '#server/utils/tcg/lots'
import { listCopy } from '#server/utils/tcg/market'
import { submitForGrading } from '#server/utils/tcg/grading'
import { vendorCopy } from '#server/utils/tcg/vendor'
import { mintCondition } from '#shared/utils/tcg/condition'
import { sellerProceeds } from '#shared/utils/tcg/market'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    seller: 'test-tcg-lots-seller',
    buyer: 'test-tcg-lots-buyer',
    rival: 'test-tcg-lots-rival'
}
const createdSetIds: string[] = []

let setId: string
let printingId: string
let sheetId: string
let packId: string
let nextSlot = 0

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `lots spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'LOTS',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'lot-0', number: '001', name: 'Lotling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'lot-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'l', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.seller, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    setId = set!.id
    printingId = printing!.id
    sheetId = sheet!.id
    packId = pack!.id
}

async function seedCopies(ownerId: string, count: number): Promise<string[]> {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
        const [copy] = await db.insert(tcgCopy).values({
            printingId, setId, ownerId, packId, sheetId,
            cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition()
        }).returning()
        ids.push(copy!.id)
    }
    return ids
}

async function balanceOf(userId: string): Promise<number> {
    const [row] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    return parseFloat(row!.balance)
}

describe.skipIf(SKIP)('tcg bulk lots integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: '100000000' })
        }
        await buildFixture()
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
        await db.delete(tcgSet).where(eq(tcgSet.code, 'LOTS'))
    }

    it('create picks the counts and encumbers; contents refuse everything else', async () => {
        await seedCopies(USERS.seller, 6)
        const lot = await createLot(USERS.seller, setId, [{ printingId, count: 5 }], 300, 'assorted bulk')

        const items = await db.select().from(tcgLotItem).where(eq(tcgLotItem.lotId, lot.id))
        expect(items).toHaveLength(5)

        const held = items[0]!.copyId
        await expect(listCopy(USERS.seller, held, 100, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is part of a bulk lot' })
        await expect(submitForGrading(USERS.seller, held, 'PSI', null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is part of a bulk lot' })
        await expect(vendorCopy(USERS.seller, held, 1))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is part of a bulk lot' })

        // Only the sixth copy is free — a second lot cannot double-claim
        // copies the first is holding.
        await expect(createLot(USERS.seller, setId, [{ printingId, count: 4 }], 100, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not enough free raw copies for one of the picks' })

        await cancelLot(USERS.seller, lot.id)
        // Released: listable again.
        await listCopy(USERS.seller, held, 100, null)
    }, 30_000)

    it('buy burst: one winner, every copy flips, 95/5 exact', async () => {
        await seedCopies(USERS.seller, 4)
        const lot = await createLot(USERS.seller, setId, [{ printingId, count: 4 }], 1000, null)

        await expect(buyLot(USERS.seller, lot.id))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Lot is gone, or your own' })

        const sellerBefore = await balanceOf(USERS.seller)
        const buyerBefore = await balanceOf(USERS.buyer)
        const result = await burst(6, i => buyLot(i % 2 === 0 ? USERS.buyer : USERS.rival, lot.id))
        expect(result).toEqual({ ok: 1, rejected: 5 })

        const [sold] = await db.select().from(tcgLot).where(eq(tcgLot.id, lot.id))
        expect(sold!.state).toBe('sold')
        const winner = sold!.buyerId!
        const items = await db.select().from(tcgLotItem).where(eq(tcgLotItem.lotId, lot.id))
        const copies = await db.select({ ownerId: tcgCopy.ownerId }).from(tcgCopy)
            .where(inArray(tcgCopy.id, items.map(item => item.copyId)))
        expect(copies.every(copy => copy.ownerId === winner)).toBe(true)

        expect(await balanceOf(USERS.seller)).toBeCloseTo(sellerBefore + sellerProceeds(1000), 4)
        if (winner === USERS.buyer) {
            expect(await balanceOf(USERS.buyer)).toBeCloseTo(buyerBefore - 1000, 4)
        }

        // A sold lot's copies are free for the new owner.
        await listCopy(winner, items[0]!.copyId, 50, null)
    }, 30_000)

    it('validates size bounds and prices', async () => {
        await seedCopies(USERS.seller, 3)
        await expect(createLot(USERS.seller, setId, [{ printingId, count: 3 }], 100, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'A lot holds 4–500 copies' })
        await expect(createLot(USERS.seller, setId, [{ printingId, count: 4 }], 0, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Price out of range' })
    })
})
