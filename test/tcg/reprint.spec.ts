/**
 * Reprints (§3.6): the announcement gate on the buy path. Real Postgres from
 * .env.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate } from '#server/database/schema'
import { commitSet, buyPack } from '#server/utils/tcg/engine'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-tcg-reprint-user'
const createdSetIds: string[] = []

async function buildCommittedSet(overrides: Partial<typeof tcgSet.$inferInsert> = {}): Promise<string> {
    const [set] = await db.insert(tcgSet).values({
        name: `reprint spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'RPRT',
        status: 'draft',
        targetPackCount: 20,
        ...overrides
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'rpt-0', number: '001', name: 'Reprintling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'rpt-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'r', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    await db.insert(tcgPackTemplate).values({
        setId: set!.id, kind: 'base', slots: [{ sheetId: sheet!.id, count: 1 }]
    })
    await commitSet(set!.id)
    return set!.id
}

describe.skipIf(SKIP)('tcg reprints', () => {
    beforeAll(async () => {
        await cleanupSets()
        await cleanupUser(USER)
        await seedUser(USER, { balance: '0', gems: 100 })
    }, 60_000)

    afterAll(async () => {
        await cleanupSets()
        await cleanupUser(USER)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'RPRT'))
    }

    it('the announcement gate: committed but not yet on sale sells nothing', async () => {
        const future = new Date(Date.now() + 3600_000)
        const announced = await buildCommittedSet({ onSaleAt: future, printRunLabel: 'Unlimited' })
        await expect(buyPack(announced, USER))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Not on sale yet' })

        await db.update(tcgSet).set({ onSaleAt: sql`now() - interval '1 second'` }).where(eq(tcgSet.id, announced))
        const pack = await buyPack(announced, USER)
        expect(pack.state).toBe('sealed')

        // NULL onSaleAt (every first run) keeps today's behavior.
        const plain = await buildCommittedSet()
        const pack2 = await buyPack(plain, USER)
        expect(pack2.state).toBe('sealed')
    }, 30_000)
})
