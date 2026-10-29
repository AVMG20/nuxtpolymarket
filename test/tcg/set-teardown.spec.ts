/**
 * Set teardown: deleteSet removes a run nobody has bought into. It is an admin
 * escape hatch, so the guard that keeps players' packs and cards matters more
 * than the happy path. Real Postgres from .env.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate, tcgPack, tcgCopy } from '#server/database/schema'
import { commitSet, buyPack, openPack, deleteSet } from '#server/utils/tcg/engine'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-tcg-teardown-user'
const CODE = 'TRDN'
const createdSetIds: string[] = []

/** A draft set with a four-card checklist and one hand-authored sheet. */
async function buildDraft(overrides: Partial<typeof tcgSet.$inferInsert> = {}): Promise<string> {
    const [set] = await db.insert(tcgSet).values({
        name: `teardown spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: CODE,
        status: 'draft',
        targetPackCount: 10,
        ...overrides
    }).returning()
    createdSetIds.push(set!.id)

    const printingIds: string[] = []
    for (let i = 0; i < 4; i++) {
        const [card] = await db.insert(tcgCard).values({
            setId: set!.id,
            plaatjesBaseId: `trdn-${i}`,
            number: String(i + 1).padStart(3, '0'),
            name: `Teardownling ${i}`,
            rarity: 'Common',
            rarityCode: 'C',
            raw: {}
        }).returning()
        const [printing] = await db.insert(tcgPrinting).values({
            setId: set!.id, cardId: card!.id, plaatjesCardId: `trdn-${i}`, finish: 'nonholo'
        }).returning()
        printingIds.push(printing!.id)
    }

    // The 'manual edit': one sheet holding a single printing, so three of the
    // four cards can never be pulled.
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'hand-authored', role: 'base', packSlots: 1, layout: [printingIds[0]!]
    }).returning()
    await db.insert(tcgPackTemplate).values({
        setId: set!.id, kind: 'base', slots: [{ sheetId: sheet!.id, count: 1 }]
    })
    return set!.id
}

describe.skipIf(SKIP)('tcg draft repair and teardown', () => {
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
        await db.delete(tcgSet).where(eq(tcgSet.code, CODE))
    }

    // The refusal is what keeps a player's collection intact: the cascade
    // from tcg_sets reaches packs and copies, so a delete that got through
    // here would vaporise cards someone owns.
    it('deletes a committed run that has sold nothing, but never one with packs or copies out', async () => {
        const unsold = await buildDraft()
        await commitSet(unsold)
        await expect(deleteSet(unsold)).resolves.toMatchObject({ cards: 4 })

        const sold = await buildDraft()
        await commitSet(sold)
        const sealed = await buyPack(sold, USER)
        const opened = await buyPack(sold, USER)
        await openPack(opened.id, USER)
        await expect(deleteSet(sold)).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: expect.stringContaining('have been sold')
        })
        expect(await db.select().from(tcgPack).where(inArray(tcgPack.id, [sealed.id, opened.id]))).toHaveLength(2)
        expect(await db.select().from(tcgCopy).where(eq(tcgCopy.setId, sold))).toHaveLength(1)
    }, 30_000)
})
