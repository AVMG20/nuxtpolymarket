/**
 * Integration tests for the vendor buyback (§7.4) against the real Postgres
 * from .env. Skips when DATABASE_URL is unset. Fixture shape follows
 * market.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user, tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgCopyTransfer, tcgSubmission } from '#server/database/schema'
import { vendorCopy } from '#server/utils/tcg/vendor'
import { listCopy, buyListing } from '#server/utils/tcg/market'
import { submitForGrading, collectSubmission } from '#server/utils/tcg/grading'
import { mintCondition } from '#shared/utils/tcg/condition'
import { vendorPrice } from '#shared/utils/tcg/vendor'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    owner: 'test-tcg-vendor-owner',
    other: 'test-tcg-vendor-other'
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
        name: `vendor spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'VNDR',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'vnd-0', number: '001', name: 'Vendorling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'vnd-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'v', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.owner, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
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

async function balanceOf(userId: string): Promise<number> {
    const [row] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    return parseFloat(row!.balance)
}

describe.skipIf(SKIP)('tcg vendor integration', () => {
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
        await db.delete(tcgSet).where(eq(tcgSet.code, 'VNDR'))
    }

    it('vendor burst pays exactly once and destroys the copy', async () => {
        const copyId = await seedCopy(USERS.owner)
        const before = await balanceOf(USERS.owner)
        const result = await burst(10, () => vendorCopy(USERS.owner, copyId, 7))
        expect(result).toEqual({ ok: 1, rejected: 9 })
        expect(await balanceOf(USERS.owner)).toBeCloseTo(before + 7, 4)

        const [copy] = await db.select({ lifecycle: tcgCopy.lifecycle }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.lifecycle).toBe('destroyed')
    }, 30_000)

    it('refuses a foreign copy, a listed copy, one at the grader and a slab', async () => {
        const foreign = await seedCopy(USERS.owner)
        await expect(vendorCopy(USERS.other, foreign, 1))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is not yours to sell' })

        const listed = await seedCopy(USERS.owner)
        await listCopy(USERS.owner, listed, 500, null)
        await expect(vendorCopy(USERS.owner, listed, 1))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is listed on the market' })

        const atGrader = await seedCopy(USERS.owner)
        await submitForGrading(USERS.owner, atGrader, 'PSI', null)
        await expect(vendorCopy(USERS.owner, atGrader, 1))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'The vendor only buys raw cards' })

        const slabbed = await seedCopy(USERS.owner)
        const submission = await submitForGrading(USERS.owner, slabbed, 'PSI', null)
        await db.update(tcgSubmission)
            .set({ returnsAt: new Date(Date.now() - 1000) })
            .where(eq(tcgSubmission.id, submission.id))
        await collectSubmission(USERS.owner, submission.id)
        await expect(vendorCopy(USERS.owner, slabbed, 1))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'The vendor only buys raw cards' })

        await expect(vendorCopy(USERS.owner, await seedCopy(USERS.owner), 0.5))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Bad vendor price' })
    })

    it('destroyed copies keep their history: transfer rows survive the sale', async () => {
        // other buys a copy from owner, then vendors it — the sale's transfer
        // row must survive the destruction (soft delete, §7.4).
        const copyId = await seedCopy(USERS.owner)
        const listing = await listCopy(USERS.owner, copyId, 1000, null)
        await buyListing(USERS.other, listing.id)
        await vendorCopy(USERS.other, copyId, 3)

        const transfers = await db.select().from(tcgCopyTransfer).where(eq(tcgCopyTransfer.copyId, copyId))
        expect(transfers).toHaveLength(1)
        const [copy] = await db.select({ lifecycle: tcgCopy.lifecycle }).from(tcgCopy).where(eq(tcgCopy.id, copyId))
        expect(copy!.lifecycle).toBe('destroyed')
    })

    it('a destroyed copy cannot be listed, graded or vendored again', async () => {
        const copyId = await seedCopy(USERS.owner)
        await vendorCopy(USERS.owner, copyId, 1)
        await expect(listCopy(USERS.owner, copyId, 100, null))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(submitForGrading(USERS.owner, copyId, 'PSI', null))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(vendorCopy(USERS.owner, copyId, 1))
            .rejects.toMatchObject({ statusCode: 400 })
    })

    it('payouts land in the ledger under tcg:vendor', async () => {
        const copyId = await seedCopy(USERS.owner)
        await vendorCopy(USERS.owner, copyId, 42)
        const { transactions } = await import('#server/database/schema')
        const rows = await db.select().from(transactions)
            .where(and(eq(transactions.userId, USERS.owner), eq(transactions.category, 'tcg:vendor')))
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.some(row => parseFloat(row.amount) === 42)).toBe(true)
    })

    it('vendorPrice: dollars as whole coins, floor of 1, usd over eur', () => {
        expect(vendorPrice(0.03, null)).toBe(1)
        expect(vendorPrice(0.9, null)).toBe(1)
        expect(vendorPrice(1.6, null)).toBe(2)
        expect(vendorPrice(818.65, 333.56)).toBe(819)
        expect(vendorPrice(null, 28.81)).toBe(29)
        expect(vendorPrice(null, null)).toBe(1)
        expect(vendorPrice(undefined, undefined)).toBe(1)
    })
})
